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
$COMME "PATH=$PATH pg_ctl -D $GRAPPE/donnees -l $JOURNAL -o '-p $PORT -k /tmp -c listen_addresses=' start -w" >/dev/null

PSQL="psql -h /tmp -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"

$COMME "PATH=$PATH $PSQL -c 'create database xafe'" >/dev/null

# auth.uid() : chez Supabase, c'est le compte du jeton ; ici, une variable de session.
cat >"$GRAPPE/auth.sql" <<'SQL'
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('xafe.compte', true), '')::uuid
$$;
SQL
$COMME "PATH=$PATH $PSQL -d xafe -f $GRAPPE/auth.sql" >/dev/null

for m in "$ICI"/supabase/migrations/*.sql; do
  echo "· migration $(basename "$m")"
  $COMME "PATH=$PATH $PSQL -d xafe -f $m" >"$GRAPPE/migration.log" 2>&1 || { cat "$GRAPPE/migration.log"; echo "✗ la migration $(basename "$m") ne passe pas"; exit 1; }
done

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
echo "✓ le moteur tient"
