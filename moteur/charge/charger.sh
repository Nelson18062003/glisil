# LA CHARGE : seize connexions en même temps, pour de vrai (pgbench).
#
# Lancé par verifier-le-moteur.sh après le hasard (même base ; COMME, PATH,
# PSQL, PORT, GRAPPE, ICI viennent de lui). Les courses mettent DEUX
# connexions face à face sur un cas choisi ; ici, seize clients mêlent
# pendant DUREE secondes des SMS (qui se répètent d'un client à l'autre),
# des transaction ID, des ordres sur la même paire, des annulations, des
# sorties et des transferts que TOTEM rend. Un refus métier est normal ; une
# étreinte mortelle (deux transactions qui s'attendent l'une l'autre) ou
# toute autre erreur est un défaut : le client qui la reçoit voit son geste
# tomber. À la fin, les sept règles du hasard doivent tenir.
CHARGE=${CHARGE:-$ICI/moteur/charge}
DUREE=${DUREE:-20}
$COMME "PATH=$PATH $PSQL -d ${BASE:-xafe} -f $CHARGE/preparer.sql" >"$GRAPPE/charge-preparer.log" 2>&1 \
  || { cat "$GRAPPE/charge-preparer.log"; echo "✗ la charge ne se prépare pas"; exit 1; }
STATUT=0
$COMME "PATH=$PATH pgbench -h ${HOTE:-/tmp} -p $PORT -U postgres -n -c 16 -j 4 -T $DUREE --max-tries=1 --failures-detailed \
  -f $CHARGE/sms.sql@3 -f $CHARGE/declarer.sql@2 -f $CHARGE/ordre.sql@4 -f $CHARGE/annuler.sql@1 \
  -f $CHARGE/sortie.sql@2 -f $CHARGE/totem.sql@2 ${BASE:-xafe}" >"$GRAPPE/charge.log" 2>&1 || STATUT=$?
FAITES=$(sed -n 's/^number of transactions actually processed: \([0-9]*\).*/\1/p' "$GRAPPE/charge.log")
RATEES=$(sed -n 's/^number of failed transactions: \([0-9]*\).*/\1/p' "$GRAPPE/charge.log")
if [ "$STATUT" != "0" ] || [ "${RATEES:-1}" != "0" ]; then
  grep -E "^SQL script|deadlock failures: [1-9]" "$GRAPPE/charge.log" | grep -B1 "deadlock failures: [1-9]" | grep -v "^--"
  cp "$GRAPPE/charge.log" /tmp/xafe-charge.log 2>/dev/null || true; cp "${JOURNAL:-/dev/null}" /tmp/xafe-pg.log 2>/dev/null || true
  echo "✗ sous charge, des gestes sont tombés (statut $STATUT, ${RATEES:-?} ratés sur ${FAITES:-?})"; exit 1
fi
echo "select _hasard_invariants();" >"$GRAPPE/charge-regles.sql"
$COMME "PATH=$PATH $PSQL -d ${BASE:-xafe} -f $GRAPPE/charge-regles.sql" >"$GRAPPE/charge-regles.log" 2>&1 \
  || { cat "$GRAPPE/charge-regles.log"; echo "✗ après la charge, une règle a cassé"; exit 1; }
echo "✓ 14.1 seize clients pendant ${DUREE} s : $FAITES gestes, aucun tombé, aucune étreinte mortelle, et les sept règles tiennent"
