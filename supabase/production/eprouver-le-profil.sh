#!/bin/sh
# LE PROFIL DE PRODUCTION, ÉPROUVÉ CONTRE UN VRAI POSTGRESQL ET UN VRAI PG_CRON.
#
#     sh supabase/production/eprouver-le-profil.sh
#
# Joue la commande d'installation de docs/PRODUCTION.md (annonce + consolidé +
# constat, en UNE transaction) sur une base neuve, puis attend que les tâches
# planifiées tournent : aucun franc de test ne doit apparaître. Ses témoins :
#   · la FENÊTRE : le même consolidé joué hors transaction et sans annonce
#     laisse les robots se doter au premier tour de pg_cron — c'est pour cela
#     que l'installation tient en une transaction. S'il ne voit rien, le
#     harnais est aveugle, et il le dit ;
#   · la MAUVAISE BASE : annoncer la production sur une base qui a vécu est
#     refusé, et rien ne reste.
# Puis : le consolidé rejoué sur la production re-tient le profil ; une faute
# de frappe dans l'annonce est refusée ; le constat voit une tâche de robot
# reposée et un secret d'essai au coffre.
#
# Il exige le vrai pg_cron (apt : postgresql-16-cron) : sans lui, les tâches ne
# tourneraient pas, et le harnais passerait sans avoir rien vu.

set -eu

PORT=${PORT:-5457}
ICI=$(cd "$(dirname "$0")/../.." && pwd)
GRAPPE=$(mktemp -d /tmp/glisil-profil.XXXXXX)

for chemin in /usr/lib/postgresql/*/bin /usr/local/pgsql/bin; do
  [ -x "$chemin/initdb" ] && PATH="$chemin:$PATH" && break
done
export PATH
command -v initdb >/dev/null 2>&1 || { echo "✗ PostgreSQL n'est pas installé ici : rien ne peut être éprouvé."; exit 1; }
if ! ls "$(pg_config --sharedir)/extension/pg_cron.control" >/dev/null 2>&1; then
  echo "✗ pg_cron n'est pas installé ici (apt install postgresql-16-cron) : sans lui, aucune tâche ne tourne et le harnais ne verrait rien."
  exit 1
fi
for p in "$PORT" $((PORT + 1)); do
  if pg_isready -h /tmp -p "$p" >/dev/null 2>&1; then
    echo "✗ Un PostgreSQL écoute déjà sur le port $p : il mesurerait SA base, pas ce schéma."
    exit 1
  fi
done

# Le consolidé le plus récent, et il doit porter les migrations d'AUJOURD'HUI.
CONSOLIDE=$(ls "$ICI"/migrations/*_consolidated.sql | sort | tail -1)
for m in "$ICI"/supabase/migrations/*.sql; do
  empreinte=$(md5sum "$m" | cut -d' ' -f1)
  grep -q -- "$(basename "$m") (md5 $empreinte)" "$CONSOLIDE" \
    || { echo "✗ $(basename "$CONSOLIDE") ne porte pas $(basename "$m") d'aujourd'hui : python3 supabase/consolider.py"; exit 1; }
done
cp "$CONSOLIDE" "$GRAPPE/consolide.sql"
cp "$ICI/supabase/production/annoncer-la-production.sql" "$ICI/supabase/production/verifier-la-production.sql" "$GRAPPE/"
cp "$ICI/moteur/auth.sql" "$GRAPPE/auth.sql"
# Supabase a un coffre (Vault) : le constat le lit ; ici, sa table seulement.
echo "create schema if not exists vault; create table if not exists vault.secrets (name text);" >>"$GRAPPE/auth.sql"

if [ "$(id -u)" = "0" ]; then chown -R postgres "$GRAPPE"; COMME="su postgres -c"; else COMME="sh -c"; fi

arreter() {
  for d in "$GRAPPE"/grappe-*; do
    [ -d "$d" ] && $COMME "PATH=$PATH pg_ctl -D $d stop -m fast" >/dev/null 2>&1 || true
  done
  rm -rf "$GRAPPE"
}
trap arreter EXIT

# Une grappe neuve par base : pg_cron ne tourne que dans UNE base par grappe.
monter() {  # monter <nom> <port>
  $COMME "PATH=$PATH initdb -D $GRAPPE/grappe-$1 --auth=trust --encoding=UTF8 --locale=C.UTF-8" >/dev/null 2>&1
  $COMME "PATH=$PATH pg_ctl -D $GRAPPE/grappe-$1 -l $GRAPPE/$1.log -o '-p $2 -k /tmp -c listen_addresses= -c shared_preload_libraries=pg_cron -c cron.database_name=xafe -c cron.use_background_workers=on -c max_worker_processes=32' start -w" >/dev/null
  $COMME "PATH=$PATH psql -h /tmp -p $2 -U postgres -q -c 'create database xafe'" >/dev/null
  $COMME "PATH=$PATH psql -h /tmp -p $2 -U postgres -q -v ON_ERROR_STOP=1 -d xafe -f $GRAPPE/auth.sql" >/dev/null
}
# sql <port> <requête> : une valeur, sans fioritures
sql() { $COMME "PATH=$PATH psql -h /tmp -p $1 -U postgres -d xafe -At -v ON_ERROR_STOP=1 -c \"$2\""; }
# jouer <port> <journal> [-c GUC] fichiers… : en UNE transaction, statut rendu
jouer() {
  port=$1; journal=$2; shift 2
  opts=""
  if [ "$1" = "-c" ]; then opts="PGOPTIONS='-c $2'"; shift 2; fi
  fichiers=""; for f in "$@"; do fichiers="$fichiers -f $GRAPPE/$f"; done
  STATUT=0
  $COMME "PATH=$PATH $opts psql -h /tmp -p $port -U postgres -d xafe -X -q -v ON_ERROR_STOP=1 --single-transaction $fichiers" >"$GRAPPE/$journal" 2>&1 || STATUT=$?
}
exiger() { if [ "$1" != "$2" ]; then echo "✗ $3 (attendu « $2 », lu « $1 »)"; exit 1; fi; echo "  ✓ $3"; }

P1=$PORT
P2=$((PORT + 1))

echo "· 1. l'installation : annonce + consolidé + constat, en une transaction"
monter prod "$P1"
jouer "$P1" install.log annoncer-la-production.sql consolide.sql verifier-la-production.sql
[ "$STATUT" = "0" ] || { cat "$GRAPPE/install.log"; echo "✗ l'installation est tombée"; exit 1; }
grep -q '"ok": true' "$GRAPPE/install.log" || { cat "$GRAPPE/install.log"; echo "✗ le constat n'a pas dit ok"; exit 1; }
exiger "$(sql "$P1" "select nom from profil_de_la_base")" production "le profil est posé"
exiger "$(sql "$P1" "select parametre('beta') ->> 'actif'")" false "la bêta est éteinte"
exiger "$(sql "$P1" "select parametre('chaine') ->> 'essai'")" false "le réseau n'est plus d'essai"
exiger "$(sql "$P1" "select count(*) from comptes where not maison")" 0 "aucun compte, hors la maison"
exiger "$(sql "$P1" "select count(*) from robots")" 0 "aucun robot"
exiger "$(sql "$P1" "select parametre('sortie') ->> 'mode'")" manuel "les sorties sont manuelles"
exiger "$(sql "$P1" "select string_agg(id, ',' order by id) from reseaux where actif")" bep20 "seul le réseau maison est ouvert"
TACHES=$(sql "$P1" "select string_agg(jobname, ',' order by jobname) from cron.job")
for t in $(echo "$TACHES" | tr ',' ' '); do
  case "$t" in
    xafe-expirer-depots|glisil-rapprocher|glisil-cours|glisil-menage-cron|glisil-courriels) ;;
    *) echo "✗ une tâche inattendue est planifiée sur la production : $t"; exit 1 ;;
  esac
done
case ",$TACHES," in *,xafe-expirer-depots,*) ;; *) echo "✗ la tâche xafe-expirer-depots manque ($TACHES)"; exit 1 ;; esac
case ",$TACHES," in *,glisil-rapprocher,*) ;; *) echo "✗ la tâche glisil-rapprocher manque ($TACHES)"; exit 1 ;; esac
echo "  ✓ tâches planifiées : $TACHES"
# une sonde du harnais, toutes les cinq secondes : la preuve que pg_cron tourne VRAIMENT ici
sql "$P1" "select cron.schedule('sonde-du-harnais', '5 seconds', 'select 1')" >/dev/null
echo "  … quarante secondes : plus qu'un tour de robots"
sleep 40
TOURS=$(sql "$P1" "select count(*) from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'sonde-du-harnais' and d.status = 'succeeded'")
sql "$P1" "select cron.unschedule('sonde-du-harnais')" >/dev/null
[ "$TOURS" -gt 0 ] || { sql "$P1" "select jobid, status, return_message from cron.job_run_details limit 5"; echo "✗ aucune tâche n'a tourné : le harnais ne prouverait rien"; exit 1; }
echo "  ✓ pg_cron tourne vraiment : la sonde a tourné $TOURS fois"
exiger "$(sql "$P1" "select count(*) from dotations_beta")" 0 "aucune dotation après les tâches"
exiger "$(sql "$P1" "select count(*) from emissions")" 0 "aucune émission après les tâches"

echo "· 5. une faute de frappe dans l'annonce : refusée, rien ne reste"
monter beta "$P2"
jouer "$P2" faute.log -c glisil.profil=prod consolide.sql
[ "$STATUT" != "0" ] && grep -q "profil annoncé inconnu" "$GRAPPE/faute.log" \
  || { cat "$GRAPPE/faute.log"; echo "✗ « prod » aurait dû être refusé"; exit 1; }
exiger "$(sql "$P2" "select to_regclass('public.parametres') is null")" t "la transaction est annulée : aucun schéma"

echo "· 2. témoin : la FENÊTRE — hors transaction et sans annonce, les robots se dotent"
STATUT=0
$COMME "PATH=$PATH psql -h /tmp -p $P2 -U postgres -d xafe -X -q -v ON_ERROR_STOP=1 -f $GRAPPE/consolide.sql" >"$GRAPPE/fenetre.log" 2>&1 || STATUT=$?
[ "$STATUT" = "0" ] || { cat "$GRAPPE/fenetre.log"; echo "✗ le consolidé ne se joue pas sur une base neuve"; exit 1; }
echo "  … quarante secondes"
sleep 40
DOTES=$(sql "$P2" "select count(*) from dotations_beta")
if [ "$DOTES" = "0" ]; then
  echo "✗ témoin aveugle : sans la transaction unique, les robots auraient dû se doter — le harnais ne verrait pas la fenêtre"
  exit 1
fi
echo "  ✓ le témoin voit la fenêtre : $DOTES dotations de robots en quarante secondes"

echo "· 3. témoin : la MAUVAISE BASE — on n'annonce pas la production sur une base qui a vécu"
jouer "$P2" mauvaise1.log annoncer-la-production.sql consolide.sql verifier-la-production.sql
[ "$STATUT" != "0" ] && grep -q "déjà un schéma" "$GRAPPE/mauvaise1.log" \
  || { cat "$GRAPPE/mauvaise1.log"; echo "✗ l'annonce aurait dû refuser une base qui a un schéma"; exit 1; }
echo "  ✓ l'annonce refuse : déjà un schéma"
jouer "$P2" mauvaise2.log -c glisil.profil=production consolide.sql verifier-la-production.sql
[ "$STATUT" != "0" ] && grep -q "cette base a déjà vécu" "$GRAPPE/mauvaise2.log" \
  || { cat "$GRAPPE/mauvaise2.log"; echo "✗ 0041 aurait dû refuser une base qui a vécu"; exit 1; }
echo "  ✓ 0041 refuse : $(grep -o 'cette base a déjà vécu[^"]*' "$GRAPPE/mauvaise2.log" | head -1)"
exiger "$(sql "$P2" "select parametre('beta') ->> 'actif'")" true "rien ne reste : la bêta est toujours la bêta"
exiger "$(sql "$P2" "select count(*) from profil_de_la_base")" 0 "rien ne reste : aucun profil"

echo "· 4. le consolidé rejoué sur la production re-tient le profil"
jouer "$P1" rejeu.log consolide.sql verifier-la-production.sql
[ "$STATUT" = "0" ] || { cat "$GRAPPE/rejeu.log"; echo "✗ le consolidé rejoué sur la production est tombé"; exit 1; }
exiger "$(sql "$P1" "select count(*) from cron.job where jobname in ('glisil-robots', 'glisil-menage-robots')")" 0 "la tâche des robots, reposée par 0023, est retirée"
exiger "$(sql "$P1" "select count(*) from pg_trigger where tgname in ('comptes_dotation_beta', 'depots_pendant_la_beta', 'sorties_reveiller_totem_demo')")" 0 "les déclencheurs de bêta et de démo, reposés, sont retirés"
exiger "$(sql "$P1" "select count(*) from comptes where not maison")" 0 "aucun robot n'est revenu"

echo "· 6. le constat voit ce qu'on y glisse"
sql "$P1" "select cron.schedule('glisil-robots', '30 seconds', 'select 1')" >/dev/null
jouer "$P1" mutation1.log verifier-la-production.sql
[ "$STATUT" != "0" ] && grep -q "tâche pg_cron des robots" "$GRAPPE/mutation1.log" \
  || { cat "$GRAPPE/mutation1.log"; echo "✗ le constat aurait dû voir la tâche des robots"; exit 1; }
echo "  ✓ une tâche de robot reposée : le constat tombe"
sql "$P1" "select cron.unschedule('glisil-robots')" >/dev/null
sql "$P1" "insert into vault.secrets (name) values ('essai_admin_cle')" >/dev/null
jouer "$P1" mutation2.log verifier-la-production.sql
[ "$STATUT" != "0" ] && grep -q "secret d'essai" "$GRAPPE/mutation2.log" \
  || { cat "$GRAPPE/mutation2.log"; echo "✗ le constat aurait dû voir le secret d'essai"; exit 1; }
echo "  ✓ un secret d'essai au coffre : le constat tombe"

echo "✓ le profil de production tient : installé en une transaction, sans un franc de test, et il le reste"
