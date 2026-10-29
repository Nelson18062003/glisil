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

# Ce que Supabase pose AVANT nos migrations, imité au plus près — sinon le
# harnais éprouverait un PostgreSQL plus sage que la production :
#   · anon et authenticated reçoivent d'office ALL sur toute table et EXECUTE
#     sur toute fonction de public (les « default privileges » du projet) ;
#   · pgcrypto vit dans le schéma « extensions », pas dans public ;
#   · auth.uid() est le compte du jeton — ici, une variable de session ;
#   · auth.users existe, et nos migrations y posent un déclencheur.
cat >"$GRAPPE/auth.sql" <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema extensions;
create extension pgcrypto with schema extensions;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('xafe.compte', true), '')::uuid
$$;
-- Le jeton (0035) : les claims de la requête si un scénario les pose (comme
-- PostgREST), sinon un jeton FORT fabriqué depuis xafe.compte — aal2, mot de
-- passe puis TOTP à l'instant — pour que les scénarios d'avant gardent leur
-- sens. xafe.aal, xafe.amr et xafe.session le font faiblir à la demande.
create function auth.jwt() returns jsonb language sql stable as $$ select case
  when nullif(current_setting('request.jwt.claims', true), '') is not null then current_setting('request.jwt.claims', true)::jsonb
  when nullif(current_setting('xafe.compte', true), '') is null then null
  else jsonb_build_object('sub', current_setting('xafe.compte', true), 'role', 'authenticated',
    'aal', coalesce(nullif(current_setting('xafe.aal', true), ''), 'aal2'),
    'session_id', coalesce(nullif(current_setting('xafe.session', true), ''), md5(current_setting('xafe.compte', true))::uuid::text),
    'amr', coalesce(nullif(current_setting('xafe.amr', true), '')::jsonb,
      jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint),
                        jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))) end $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
create table auth.users (id uuid primary key, phone text, email text, phone_confirmed_at timestamptz, email_confirmed_at timestamptz,
                         last_sign_in_at timestamptz, encrypted_password text, banned_until timestamptz);
-- les facteurs de GoTrue : lus seulement (la fiche « Sécurité » de l'équipe), jamais écrits par nos migrations
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, factor_type text, status text, created_at timestamptz default now());
SQL
$COMME "PATH=$PATH $PSQL -d xafe -f $GRAPPE/auth.sql" >/dev/null

for m in "${MIGRATIONS:-$ICI/supabase/migrations}"/*.sql; do
  echo "· migration $(basename "$m")"
  $COMME "PATH=$PATH $PSQL -d xafe -f $m" >"$GRAPPE/migration.log" 2>&1 || { cat "$GRAPPE/migration.log"; echo "✗ la migration $(basename "$m") ne passe pas"; exit 1; }
done

# Les scénarios, les courses, le hasard et la charge ont été écrits avant 0013 : ils déclarent
# l'ID seul. La règle stricte (numéro, montant, nom) est éprouvée à part, par le scénario 11.34,
# qui la rallume dans sa transaction ; ailleurs, on l'éteint ici — et SEULEMENT ici.
$COMME "PATH=$PATH $PSQL -d xafe -c \"update parametres set valeur = valeur || '{\\\"declaration_complete\\\": false}' where cle = 'depot'\"" >/dev/null
# Même chose pour les numéros (0020) : les scénarios d'avant éprouvent le code SMS et le délai de 24 h.
# La règle d'aujourd'hui (ni code ni délai) est éprouvée par le scénario 11.41, dans sa transaction.
$COMME "PATH=$PATH $PSQL -d xafe -c \"update parametres set valeur = '{\\\"verification_sms\\\": true, \\\"delai_heures\\\": 24}' where cle = 'numeros'\"" >/dev/null
# La bêta (0021) ferme les dépôts réels et dote chaque inscrit : les scénarios d'avant jouent hors bêta.
# La bêta elle-même est éprouvée par le scénario 11.42, dans sa transaction.
$COMME "PATH=$PATH $PSQL -d xafe -c \"update parametres set valeur = valeur || '{\\\"actif\\\": false}' where cle = 'beta'\"" >/dev/null
# Sans plafond (0027) : la plateforme n'a plus de taille maximale ni de plafond de palier, et compte un minimum
# en XAFe. Les scénarios d'avant éprouvent les plafonds (le mécanisme existe toujours, vide en service) :
# ils jouent avec les règles d'avant. La règle d'aujourd'hui est éprouvée par le scénario 11.48.
$COMME "PATH=$PATH $PSQL -d xafe -c \"update parametres set valeur = valeur || '{\\\"quantite_min\\\": 10, \\\"quantite_max\\\": 1000000, \\\"marche_quantite_max\\\": 100000, \\\"montant_min\\\": 0}' where cle = 'marche'\"" >/dev/null
$COMME "PATH=$PATH $PSQL -d xafe -c \"update parametres set valeur = '{\\\"0\\\": {\\\"entree_jour\\\": 500000, \\\"sortie_jour\\\": 500000}, \\\"1\\\": {\\\"entree_jour\\\": 5000000, \\\"sortie_jour\\\": 5000000}, \\\"2\\\": null}' where cle = 'paliers'\"" >/dev/null

# 0038 met les sorties en manuel : les scénarios d'avant éprouvent la composition par TOTEM. La règle
# d'aujourd'hui (le remboursement manuel prouvé par la puce) est éprouvée par 11.36 et 11.80+, dans leur transaction.
$COMME "PATH=$PATH $PSQL -d xafe -c \"update parametres set valeur = valeur || '{\\\"mode\\\": \\\"totem\\\"}' where cle = 'sortie'\"" >/dev/null
# 0039 retient tout SMS d'argent dont le solde ne suit pas : les scénarios d'avant n'annoncent aucun solde.
# Ils jouent la garde en « surveiller » (crédité, signalé) ; la garde elle-même (« exiger ») est éprouvée
# par le scénario 11.81, dans sa transaction, et par l'attaque #F1 de rouge-puis-vert.
$COMME "PATH=$PATH $PSQL -d xafe -c \"update parametres set valeur = valeur || '{\\\"mode\\\": \\\"surveiller\\\"}' where cle = 'continuite'\"" >/dev/null

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
