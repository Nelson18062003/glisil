#!/bin/sh
# L'ÉPREUVE SUR UNE VRAIE PILE SUPABASE.
#
#     sh supabase/epreuve/eprouver.sh            (Docker requis)
#     TEMOIN=1 sh supabase/epreuve/eprouver.sh   (rejoue AUSSI l'API contre le code d'avant)
#
# Le harnais du moteur (moteur/verifier-le-moteur.sh) imite Supabase sur un
# PostgreSQL nu ; ici on n'imite plus. Les images de production — la base de
# Supabase où « postgres » n'est PAS superutilisateur, GoTrue qui migre le
# schéma auth, PostgREST — reçoivent nos migrations, puis :
#   1. les scénarios du moteur, avec le vrai auth.uid() de Supabase ;
#   2. les courses à deux connexions, avec leurs témoins ;
#   3. l'API attaquée comme un client (attaquer-par-l-api.mjs) ;
#   4. avec TEMOIN=1, la même attaque contre les migrations d'avant les
#      corrections (6d453d3) : elle DOIT échouer, sinon elle ne prouve rien.
# Ce qu'elle a trouvé que l'imitation ne voyait pas : auth.users sans
# « phone » tant que GoTrue n'a pas migré, un téléphone unique dans
# auth.users, les colonnes de storage.buckets posées par le service de
# stockage et non par la base.
set -eu
ICI=$(cd "$(dirname "$0")/../.." && pwd)
. "$ICI/supabase/epreuve/reglages.sh"
export PORT_REST PORT_AUTH PORT_DB SECRET MDP
trap 'sh "$ICI/supabase/epreuve/demonter.sh" >/dev/null 2>&1' EXIT
TMP=$(mktemp -d /tmp/xafe-epreuve.XXXXXX)

sh "$ICI/supabase/epreuve/monter.sh"

echo "· scénarios du moteur (auth.uid() de Supabase : request.jwt.claim.sub)"
sed 's/xafe\.compte/request.jwt.claim.sub/g' "$ICI/moteur/scenarios.sql" >"$TMP/scenarios.sql"
STATUT=0
psql_postgres -v ON_ERROR_STOP=1 -q -f "$TMP/scenarios.sql" >"$TMP/scenarios.log" 2>&1 || STATUT=$?
sed 's/^psql:.*NOTICE:  //; s/^NOTICE:  //' "$TMP/scenarios.log" | grep -v '^$'
[ "$STATUT" = "0" ] || { echo "✗ un scénario est tombé sur la vraie pile"; exit 1; }

echo "· courses"
COMME="sh -c"; PSQL="psql -h 127.0.0.1 -p $PORT_DB -U postgres -v ON_ERROR_STOP=1 -q"; GRAPPE=$TMP; BASE=postgres; CLE_COMPTE=request.jwt.claim.sub
. "$ICI/moteur/courses.sh"

echo "· au hasard"
sed 's/xafe\.compte/request.jwt.claim.sub/g' "$ICI/moteur/hasard.sql" >"$TMP/hasard.sql"
STATUT=0
psql_postgres -v ON_ERROR_STOP=1 -q -f "$TMP/hasard.sql" >"$TMP/hasard.log" 2>&1 || STATUT=$?
sed 's/^psql:.*NOTICE:  //; s/^NOTICE:  //' "$TMP/hasard.log" | grep -v '^$'
[ "$STATUT" = "0" ] || { echo "✗ le hasard a cassé une règle sur la vraie pile"; exit 1; }

echo "· la charge : seize clients en même temps"
mkdir -p "$TMP/charge" && for f in "$ICI"/moteur/charge/*.sql; do sed 's/xafe\.compte/request.jwt.claim.sub/g' "$f" >"$TMP/charge/$(basename "$f")"; done
CHARGE="$TMP/charge"; HOTE=127.0.0.1; PORT=$PORT_DB
. "$ICI/moteur/charge/charger.sh"

echo "· l'API, attaquée"
node "$ICI/supabase/epreuve/attaquer-par-l-api.mjs"

# La chaîne réelle : le robot TOTEM (son lecteur, sa ligne, sa signature) → porte.ts → ce moteur.
TOTEM=${TOTEM:-$ICI/../totem}
chaine() {
  PORT_PORTE=54321 node --experimental-strip-types "$ICI/supabase/epreuve/porte-locale.mjs" >"$TMP/porte.log" 2>&1 &
  PORTE_PID=$!
  sleep 2
  STATUT=0
  TOTEM="$TOTEM" python3 "$ICI/supabase/epreuve/la-chaine-reelle.py" >"$TMP/chaine.log" 2>&1 || STATUT=$?
  kill $PORTE_PID 2>/dev/null || true
  return $STATUT
}
if [ -f "$TOTEM/totem/xafe.py" ]; then
  echo "· la chaîne réelle : de vrais formats de SMS, lus par TOTEM ($TOTEM), jusqu'à ce moteur"
  chaine || { cat "$TMP/chaine.log"; echo "✗ la chaîne réelle ne tient pas"; exit 1; }
  cat "$TMP/chaine.log"
else
  echo "· la chaîne réelle : SAUTÉE — le dépôt TOTEM n'est pas à $TOTEM (TOTEM=… pour le dire)"
fi

if [ "${TEMOIN:-0}" = "1" ]; then
  echo "· témoin : la même attaque contre les migrations d'avant les corrections (6d453d3)"
  mkdir -p "$TMP/avant" && git -C "$ICI" archive 6d453d3 supabase/migrations | tar -x -C "$TMP/avant"
  MIGRATIONS="$TMP/avant/supabase/migrations" sh "$ICI/supabase/epreuve/monter.sh" >/dev/null
  if node "$ICI/supabase/epreuve/attaquer-par-l-api.mjs" >"$TMP/temoin.log" 2>&1; then
    echo "✗ témoin : l'attaque passe aussi sur le code d'avant — elle ne prouve rien"; exit 1
  fi
  echo "✓ témoin : sur le code d'avant, l'attaque échoue $(grep -c '^✗ ' "$TMP/temoin.log") fois, dont :"
  grep '^✗ ' "$TMP/temoin.log" | grep -v 'exigence' | head -4 | sed 's/^/    /'
  if [ -f "$TOTEM/totem/xafe.py" ]; then
    if chaine; then echo "✗ témoin : la chaîne réelle passe aussi sur le code d'avant — elle ne prouve rien"; exit 1; fi
    echo "✓ témoin : sur le code d'avant, la chaîne réelle échoue :"
    grep '^✗ ' "$TMP/chaine.log" | grep -v 'exigence' | head -3 | sed 's/^/    /'
  fi
fi
rm -rf "$TMP"
echo "✓ sur une vraie pile Supabase, le moteur et son API tiennent"
