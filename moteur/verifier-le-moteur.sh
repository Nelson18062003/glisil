#!/bin/sh
# LE MOTEUR, ÉPROUVÉ CONTRE UN VRAI POSTGRESQL.
#
#     sh moteur/verifier-le-moteur.sh
#
# Monte un PostgreSQL neuf dans un dossier temporaire, sur un port à lui, y
# joue les migrations de supabase/migrations/ dans l'ordre, puis rejoue la vie
# d'un dépôt, d'une sortie et d'un carnet (moteur/scenarios.sql) en exigeant
# les bons soldes au franc près. Il ne touche à aucune base réelle et détruit
# la sienne en partant.

set -eu

PORT=5456
ICI=$(cd "$(dirname "$0")/.." && pwd)
GRAPPE=$(mktemp -d /tmp/xafe-moteur.XXXXXX)
JOURNAL=$GRAPPE/postgres.log

for chemin in /usr/lib/postgresql/*/bin /usr/local/pgsql/bin; do
  [ -x "$chemin/initdb" ] && PATH="$chemin:$PATH" && break
done
export PATH

if ! command -v initdb >/dev/null 2>&1; then
  echo "✗ PostgreSQL n'est pas installé ici : rien ne peut être éprouvé."
  exit 1
fi

if pg_isready -h /tmp -p "$PORT" >/dev/null 2>&1; then
  echo "✗ Un PostgreSQL écoute déjà sur le port $PORT : il mesurerait SA base, pas ce schéma."
  exit 1
fi

# Postgres refuse de tourner en root : on passe alors par l'utilisateur postgres.
if [ "$(id -u)" = "0" ]; then
  chown -R postgres "$GRAPPE"
  COMME="su postgres -c"
else
  COMME="sh -c"
fi

arreter() {
  $COMME "PATH=$PATH pg_ctl -D $GRAPPE/donnees stop -m fast" >/dev/null 2>&1 || true
  rm -rf "$GRAPPE"
}
trap arreter EXIT

$COMME "PATH=$PATH initdb -D $GRAPPE/donnees --auth=trust --encoding=UTF8 --locale=C.UTF-8" >"$GRAPPE/initdb.log" 2>&1
# pg_cron installé ici : chargé comme sur Supabase (les migrations créent l'extension et posent
# leurs tâches), mais aucune tâche ne se LANCE — un tour de robot au milieu d'un scénario
# changerait les soldes qu'il compte. Absent : les migrations le disent et passent outre.
CRON=""
if ls "$(pg_config --sharedir 2>/dev/null)/extension/pg_cron.control" >/dev/null 2>&1; then
  CRON="-c shared_preload_libraries=pg_cron -c cron.database_name=xafe -c cron.launch_active_jobs=off"
fi
$COMME "PATH=$PATH pg_ctl -D $GRAPPE/donnees -l $JOURNAL -o '-p $PORT -k /tmp -c listen_addresses= $CRON' start -w" >/dev/null

PSQL="psql -h /tmp -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"

$COMME "PATH=$PATH $PSQL -c 'create database xafe'" >/dev/null

# Ce que Supabase pose AVANT nos migrations, imité au plus près — sinon le
# harnais éprouverait un PostgreSQL plus sage que la production :
#   · anon et authenticated reçoivent d'office ALL sur toute table et EXECUTE
#     sur toute fonction de public (les « default privileges » du projet) ;
#   · pgcrypto vit dans le schéma « extensions », pas dans public ;
#   · auth.uid() est le compte du jeton — ici, une variable de session ;
#   · auth.users existe, et nos migrations y posent un déclencheur.
cp "$ICI/moteur/auth.sql" "$GRAPPE/auth.sql" && chmod a+r "$GRAPPE/auth.sql"
$COMME "PATH=$PATH $PSQL -d xafe -f $GRAPPE/auth.sql" >/dev/null

for m in "${MIGRATIONS:-$ICI/supabase/migrations}"/*.sql; do
  echo "· migration $(basename "$m")"
  $COMME "PATH=$PATH $PSQL -d xafe -f $m" >"$GRAPPE/migration.log" 2>&1 || { cat "$GRAPPE/migration.log"; echo "✗ la migration $(basename "$m") ne passe pas"; exit 1; }
done

# Les règles d'avant, pour les scénarios écrits avant elles : un seul fichier, joué aussi par la vraie pile.
cp "$ICI/moteur/regles-d-avant.sql" "$GRAPPE/regles-d-avant.sql" && chmod a+r "$GRAPPE/regles-d-avant.sql"
$COMME "PATH=$PATH $PSQL -d xafe -f $GRAPPE/regles-d-avant.sql" >/dev/null

# ATTAQUES=1 : les migrations, puis les attaques de la revue seules (moteur/rouge-puis-vert).
if [ "${ATTAQUES:-0}" = "1" ]; then
  $COMME "PATH=$PATH $PSQL -d xafe -f $ICI/moteur/rouge-puis-vert/attaques.sql" 2>&1 | grep -E '^#|ERROR|CONTEXT'
  exit 0
fi

# Le test différentiel : le vrai moteur et le moteur de référence (moteur/differentiel/reference.py,
# le règlement écrit une seconde fois, en Python), sur les mêmes ordres tirés au hasard, doivent
# tomber d'accord sur chaque réponse, chaque échange et chaque solde, au centime.
differentiel() {
  echo "· différentiel : le moteur et sa référence, sur les mêmes ordres au hasard"
  for graine in 0.11 0.42 0.77; do
    $COMME "PATH=$PATH $PSQL -d xafe -v graine=$graine -v n=1500 -f $ICI/moteur/differentiel/flux.sql" >"$GRAPPE/diff.log" 2>&1 \
      || { cat "$GRAPPE/diff.log"; echo "✗ le flux différentiel ne se joue pas"; exit 1; }
    $COMME "PATH=$PATH psql -h /tmp -p $PORT -U postgres -d xafe -At -c 'select _diff_json()'" >"$GRAPPE/diff.json"
    printf "  graine %s :" "$graine"
    python3 "$ICI/moteur/differentiel/differentiel.py" "$GRAPPE/diff.json" --temoins || exit 1
  done
}
if [ "${DIFF_SEUL:-0}" = "1" ]; then differentiel; echo "✓ le moteur et sa référence tombent d'accord"; exit 0; fi

# HASARD_SEUL=1 : les migrations, puis le hasard seul (pour éprouver le hasard lui-même).
if [ "${HASARD_SEUL:-0}" != "1" ]; then
echo "· scénarios"
# La sortie passe par un fichier : derrière un tube, le statut de psql se perdrait
# et le harnais annoncerait « tient » sur un scénario tombé.
STATUT=0
$COMME "PATH=$PATH $PSQL -d xafe -f $ICI/moteur/scenarios.sql" >"$GRAPPE/scenarios.log" 2>&1 || STATUT=$?
sed 's/^psql:.*NOTICE:  //; s/^NOTICE:  //' "$GRAPPE/scenarios.log"
if [ "$STATUT" != "0" ]; then
  echo "✗ un scénario est tombé (voir ci-dessus)"
  exit 1
fi
echo "· courses"
. "$ICI/moteur/courses.sh"
echo "· la bêta change de contrat (supabase/beta/changer-de-contrat.sql)"
. "$ICI/moteur/changer-de-contrat.sh"
fi

echo "· au hasard"
STATUT=0
$COMME "PATH=$PATH $PSQL -d xafe -f $ICI/moteur/hasard.sql" >"$GRAPPE/hasard.log" 2>&1 || STATUT=$?
sed 's/^psql:.*NOTICE:  //; s/^NOTICE:  //' "$GRAPPE/hasard.log"
[ "$STATUT" = "0" ] || { echo "✗ le hasard a cassé une règle (voir ci-dessus)"; exit 1; }

echo "· la charge : seize clients en même temps"
. "$ICI/moteur/charge/charger.sh"
differentiel
echo "✓ le moteur tient"
