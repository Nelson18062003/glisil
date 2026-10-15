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
  sed 's/if (deja + montant > plafondJour) revert PlafondJourAtteint(deja, montant, plafondJour);//' contracts/XAFe.sol >"$T/contracts/XAFe.sol"
  cp echidna/EpreuveXAFe.sol echidna/echidna.yaml "$T/echidna/"; ln -s "$PWD/node_modules" "$T/node_modules"
  if (cd "$T" && $ECHIDNA echidna/EpreuveXAFe.sol --contract EpreuveXAFe --config echidna/echidna.yaml --format text >"$T/temoin.log" 2>&1); then
    echo "✗ témoin : le jeton sans plafond passe aussi — l'épreuve ne prouve rien"; exit 1
  fi
  grep -i "plafond" "$T/temoin.log" | head -2
  echo "✓ témoin : sans plafond, Echidna prend le jeton en défaut"
  rm -rf "$T"
fi
