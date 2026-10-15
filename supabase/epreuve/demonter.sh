#!/bin/sh
# Démonte la pile d'épreuve : conteneurs et réseau. Rien d'autre n'est touché.
docker rm -f xafe-rest xafe-auth xafe-db >/dev/null 2>&1
docker network rm xafe-epreuve >/dev/null 2>&1
echo "· pile d'épreuve démontée"
