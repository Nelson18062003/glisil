#!/bin/sh
# Arrête le nœud Hardhat de l'épreuve des wallets : les processus node dont
# la ligne de commande porte « hardhat » et le port donné (58545 par défaut).
# On lit /proc au lieu de « pkill -f » : le motif de pkill se trouve aussi dans
# la ligne de commande de qui l'appelle, et pkill l'arrête avec.
PORT=${1:-58545}
moi=$$
for d in /proc/[0-9]*; do
  p=${d#/proc/}
  [ "$p" = "$moi" ] && continue
  c=$( { tr '\0' ' ' < "$d/cmdline"; } 2>/dev/null) || continue
  case "$c" in
    sh\ *|bash\ *|*/sh\ *|*/bash\ *) continue ;;
    *hardhat*"$PORT"*) kill "$p" 2>/dev/null ;;
  esac
done
exit 0
