#!/bin/sh
# Le jeton fuzzé par Echidna (binaire : github.com/crytic/echidna, solc 0.8.28).
#   cd contracts && sh echidna/eprouver.sh
# TEMOIN=1 : rejoue aussi contre un jeton SANS plafond de frappe — Echidna
# doit l'y prendre, sinon l'épreuve ne prouve rien.
set -eu
cd "$(dirname "$0")/.."
ECHIDNA=${ECHIDNA:-echidna}
$ECHIDNA echidna/EpreuveXAFe.sol --contract EpreuveXAFe --config echidna/echidna.yaml --format text
if [ "${TEMOIN:-0}" = "1" ]; then
  T=$(mktemp -d); mkdir -p "$T/contracts" "$T/echidna"
  sed 's/if (deja + montant > plafondJour) revert PlafondJourAtteint(deja, montant, plafondJour);//; s/if (!estAdresseDeDepot\[adresse\]) revert PasUneAdresseDeDepot(adresse);//' contracts/XAFe.sol >"$T/contracts/XAFe.sol"
  cp echidna/EpreuveXAFe.sol echidna/echidna.yaml "$T/echidna/"; ln -s "$PWD/node_modules" "$T/node_modules"
  if (cd "$T" && $ECHIDNA echidna/EpreuveXAFe.sol --contract EpreuveXAFe --config echidna/echidna.yaml --format text >"$T/temoin.log" 2>&1); then
    echo "✗ témoin : le jeton sans plafond passe aussi — l'épreuve ne prouve rien"; exit 1
  fi
  grep -E "plafond|hors_d_une_adresse" "$T/temoin.log" | grep -i "fail" | head -3
  for p in plafond_du_jour hors_d_une_adresse_de_depot; do
    grep -q "$p.*fail" "$T/temoin.log" || { echo "✗ témoin : sans sa garde, la promesse « $p » n'est pas prise"; exit 1; }
  done
  echo "✓ témoin : sans plafond et sans registre des adresses de dépôt, Echidna prend le jeton en défaut, deux fois"
  rm -rf "$T"
  # le correctif de la réserve : deux mutants, chacun pris par SA promesse
  for m in reserve plafond; do
    T=$(mktemp -d); mkdir -p "$T/contracts" "$T/echidna"
    if [ "$m" = "reserve" ]; then
      sed '/if (vers == address(this) \&\& depuis != address(0)) revert VersLaReserve();/d' contracts/XAFe.sol >"$T/contracts/XAFe.sol"; p=rien_n_entre_dans_la_reserve
    else
      sed 's/_mint(address(this), montant);/_mint(address(this), montant); frappeLeJour[block.timestamp \/ 1 days] += montant;/' contracts/XAFe.sol >"$T/contracts/XAFe.sol"; p=le_plafond_ne_compte_que_l_exterieur
    fi
    cmp -s contracts/XAFe.sol "$T/contracts/XAFe.sol" && { echo "✗ témoin $m : la mutation n'a rien changé"; exit 1; }
    cp echidna/EpreuveXAFe.sol echidna/echidna.yaml "$T/echidna/"; ln -s "$PWD/node_modules" "$T/node_modules"
    (cd "$T" && $ECHIDNA echidna/EpreuveXAFe.sol --contract EpreuveXAFe --config echidna/echidna.yaml --format text >"$T/temoin.log" 2>&1) || true
    grep -q "$p.*fail" "$T/temoin.log" || { echo "✗ témoin $m : la promesse « $p » n'est pas prise"; exit 1; }
    echo "✓ témoin $m : sans sa garde, Echidna prend « $p »"
    rm -rf "$T"
  done
fi
