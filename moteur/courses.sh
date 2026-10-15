# LES COURSES : deux connexions EN MÊME TEMPS, pour de vrai.
#
# Lancé par verifier-le-moteur.sh après les scénarios (même base, mêmes
# variables : COMME, PATH, PSQL, GRAPPE). Les scénarios ne parlent qu'à une
# connexion à la fois : ils ne peuvent pas voir une faute qui n'existe
# qu'entre deux transactions ouvertes ensemble. Ici, A ouvre sa transaction,
# fait son geste et ATTEND avant de valider ; B fait le même geste pendant ce
# temps. Chaque course a son témoin : la même fonction privée de son verrou
# doit reproduire la faute — sinon la course ne prouve rien.

sql() { # sql <fichier> : joue un fichier, sortie dans $GRAPPE/<fichier>.log
  $COMME "PATH=$PATH $PSQL -d ${BASE:-xafe} -f $GRAPPE/$1" >"$GRAPPE/$1.log" 2>&1
}
valeur() { # valeur "<select>" : une seule valeur
  echo "$1" >"$GRAPPE/valeur.sql"
  $COMME "PATH=$PATH $PSQL -d ${BASE:-xafe} -At -f $GRAPPE/valeur.sql"
}
ensemble() { # ensemble <a.sql> <b.sql> : A commence, B le rejoint pendant qu'A attend
  sql "$1" & a=$!
  sleep 0.5
  sql "$2" || true
  wait $a || true
}
# Retirer une ligne d'une fonction (le témoin), puis la rendre.
sans() { # sans <signature> <ligne exacte>
  cat >"$GRAPPE/sans.sql" <<SQL
insert into _temoins (signature, def) values ('$1', pg_get_functiondef('$1'::regprocedure)) on conflict (signature) do nothing;
do \$\$
declare d text := (select def from _temoins where signature = '$1');
begin
  if position(\$l\$$2\$l\$ in d) = 0 then raise exception 'témoin impossible : la ligne n''est plus dans $1'; end if;
  execute replace(d, \$l\$$2\$l\$, '');
end \$\$;
SQL
  sql sans.sql || { cat "$GRAPPE/sans.sql.log"; echo "✗ témoin impossible"; exit 1; }
}
rendre() { # rendre <signature>
  echo "do \$\$ begin execute (select def from _temoins where signature = '$1'); end \$\$;" >"$GRAPPE/rendre.sql"
  sql rendre.sql || { cat "$GRAPPE/rendre.sql.log"; exit 1; }
}

cat >"$GRAPPE/decor.sql" <<'SQL'
create table _temoins (signature text primary key, def text);
update terminaux set vu_le = now();
SQL
sql decor.sql

ALICE=11111111-1111-1111-1111-111111111111
EVE=55555555-5555-5555-5555-555555555555
BOB=22222222-2222-2222-2222-222222222222

# ── 1 · le même SMS poussé deux fois en même temps (le robot n'a pas eu l'accusé)
course_sms() { # course_sms <source_id> <transaction id>
  cat >"$GRAPPE/c1-decl.sql" <<SQL
begin; set local ${CLE_COMPTE:-xafe.compte} = '$ALICE';
select declarer_transaction((select reference from depots where cle = 'k-al-11'), '$2');
commit;
SQL
  sql c1-decl.sql
  for x in a b; do
    cat >"$GRAPPE/c1-$x.sql" <<SQL
begin;
select totem_sms_recu('akwa-1', $1, 'mtn', '677000000', '677123456', 5000, '$2', '…', now());
select pg_sleep(1.5);
commit;
SQL
  done
  ensemble c1-a.sql c1-b.sql
  echo "$(valeur "select count(*) from depot_paiements where terminal = 'akwa-1' and source_id = $1") $(valeur "select count(*) from entrees_retenues where terminal = 'akwa-1' and source_id = $1")"
}
sans 'totem_sms_recu(text,bigint,text,text,text,numeric,text,text,timestamp with time zone)' "perform pg_advisory_xact_lock(hashtext('sms:' || p_terminal || ':' || p_source_id::text));"
r=$(course_sms 9101 20394991101)
rendre 'totem_sms_recu(text,bigint,text,text,text,numeric,text,text,timestamp with time zone)'
[ "$r" = "1 1" ] || { echo "✗ témoin : sans son verrou, le même SMS devait finir crédité ET retenu (vu : $r)"; exit 1; }
# le témoin a fabriqué exprès un SMS crédité ET retenu : on retire sa retenue, pour que la suite (le hasard) parte d'une base saine
echo "delete from entrees_retenues where terminal = 'akwa-1' and source_id = 9101;" >"$GRAPPE/c1-nettoyer.sql"
sql c1-nettoyer.sql
r=$(course_sms 9102 20394991102)
[ "$r" = "1 0" ] || { echo "✗ 12.1 le même SMS poussé deux fois ensemble : $r (crédité, retenu) au lieu de « 1 0 »"; exit 1; }
echo "✓ 12.1 le même SMS poussé deux fois en même temps est crédité une fois, et pas retenu en plus (témoin : sans verrou, les deux)"

# ── 2 · l'ID tapé au moment même où TOTEM pousse le SMS
course_id() { # course_id <source_id> <transaction id>
  cat >"$GRAPPE/c2-a.sql" <<SQL
begin; set local ${CLE_COMPTE:-xafe.compte} = '$EVE';
select declarer_transaction((select reference from depots where cle = 'k-eve-1'), '$2');
select pg_sleep(1.5);
commit;
SQL
  cat >"$GRAPPE/c2-b.sql" <<SQL
select totem_sms_recu('akwa-1', $1, 'mtn', '677000000', '670555000', 7000, '$2', '…', now());
SQL
  ensemble c2-a.sql c2-b.sql
  echo "$(valeur "select etat from depot_declarations where transaction_id = '$2'") $(valeur "select count(*) from entrees_retenues where transaction_id = '$2' and etat = 'retenue'")"
}
sans 'declarer_transaction(text,text)' "perform pg_advisory_xact_lock(hashtext('tx:' || v_d.operateur || ':' || v_id));"
r=$(course_id 9201 20394992201)
rendre 'declarer_transaction(text,text)'
[ "$r" = "attendu 1" ] || { echo "✗ témoin : sans son verrou, l'ID et le SMS devaient se rater (vu : $r)"; exit 1; }
r=$(course_id 9202 20394992202)
[ "$r" = "credite 0" ] || { echo "✗ 12.2 l'ID et le SMS au même instant : $r au lieu de « credite 0 »"; exit 1; }
echo "✓ 12.2 l'ID tapé à l'instant où le SMS arrive : ils se trouvent (témoin : sans verrou, ils se ratent et l'argent reste retenu)"

# ── 3 · deux sorties lancées ensemble contre le plafond du palier 0. La
# version qui exige le code secret verrouille déjà le compte en contrôlant le
# code ; la course se joue donc sur la version sans code (celle du service),
# où le verrou de demander_sortie est le seul rempart.
course_sorties() { # course_sorties <préfixe de clé>
  for x in a b; do
    cat >"$GRAPPE/c3-$x.sql" <<SQL
begin; set local ${CLE_COMPTE:-xafe.compte} = '$BOB';
select demander_sortie(300000, 'bbbbbbbb-0000-0000-0000-000000000001', '$1-$x');
select pg_sleep(1.5);
commit;
SQL
  done
  ensemble c3-a.sql c3-b.sql
  valeur "select count(*) from sorties where cle like '$1-%'"
}
sans 'demander_sortie(numeric,uuid,text)' "perform 1 from comptes where id = v_compte for no key update;"
r=$(course_sorties k-c3t)
rendre 'demander_sortie(numeric,uuid,text)'
# le témoin a laissé deux sorties : on les rend, pour que la vraie course parte du même plafond
cat >"$GRAPPE/c3-nettoyer.sql" <<SQL
do \$\$
declare s sorties;
begin
  for s in select * from sorties where cle like 'k-c3t-%' loop
    perform _mouvement(s.compte_id, 'XAFe', s.montant, -s.montant, 'temoin_rendu', 'sorties', s.reference);
    delete from commandes where sortie_id = s.id;
    delete from sorties where id = s.id;
  end loop;
end \$\$;
SQL
sql c3-nettoyer.sql || { cat "$GRAPPE/c3-nettoyer.sql.log"; exit 1; }
[ "$r" = "2" ] || { echo "✗ témoin : sans verrou du compte, les deux sorties devaient passer le plafond (vu : $r)"; exit 1; }
r=$(course_sorties k-c3)
[ "$r" = "1" ] || { echo "✗ 12.3 deux sorties ensemble : $r passées au lieu d'une"; exit 1; }
echo "✓ 12.3 deux sorties lancées ensemble ne franchissent pas le plafond du palier (témoin : sans verrou, les deux passent)"
