#!/bin/sh
# ROUGE PUIS VERT : chaque défaut trouvé par la revue, rejoué sur le code
# d'AVANT les corrections (6d453d3) puis sur celui d'aujourd'hui, par le même
# fichier d'attaques. Une attaque qui ne produit pas son défaut sur le code
# d'avant ne prouve rien : le banc échoue alors aussi.
#
#     sh moteur/rouge-puis-vert/rouge-puis-vert.sh
set -eu
ICI=$(cd "$(dirname "$0")/../.." && pwd)
AVANT=$(mktemp -d /tmp/xafe-avant.XXXXXX)
trap 'rm -rf "$AVANT"' EXIT
git -C "$ICI" archive 6d453d3 supabase/migrations | tar -x -C "$AVANT"
chmod -R a+rX "$AVANT"

MIGRATIONS="$AVANT/supabase/migrations" ATTAQUES=1 sh "$ICI/moteur/verifier-le-moteur.sh" | grep '^#' >"$AVANT/avant.txt"
ATTAQUES=1 sh "$ICI/moteur/verifier-le-moteur.sh" | grep '^#' >"$AVANT/apres.txt"

ECHEC=0
printf '%-5s %-8s %-8s %s\n' "" "avant" "après" "le défaut"
while IFS='|' read -r n etat constat detail; do
  apres=$(grep "^$n|" "$AVANT/apres.txt" | cut -d'|' -f2)
  if [ "$etat" = "DEFAUT" ] && [ "$apres" = "tenu" ]; then marque="✓"; else marque="✗"; ECHEC=1; fi
  printf '%s %-4s %-8s %-8s %s\n' "$marque" "$n" "$etat" "${apres:-absent}" "$constat"
done <"$AVANT/avant.txt"
[ "$(wc -l <"$AVANT/avant.txt")" -ge 17 ] || { echo "✗ moins d'attaques rejouées que prévu"; ECHEC=1; }
[ "$ECHEC" = "0" ] && echo "✓ chaque défaut se produit sur le code d'avant, aucun aujourd'hui" || { echo "✗ rouge puis vert : voir ci-dessus"; exit 1; }
