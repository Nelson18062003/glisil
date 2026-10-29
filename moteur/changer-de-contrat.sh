# Éprouve supabase/beta/changer-de-contrat.sql (bêta seulement, pas une migration).
# Chaque cas tourne dans une transaction annulée : la base du harnais n'en garde rien.
# Sourcé par verifier-le-moteur.sh (ICI, GRAPPE, COMME, PSQL, PATH).

SCRIPT_BETA="$ICI/supabase/beta/changer-de-contrat.sql"

# Ce que chaque cas pose avant le script : une bêta active sur un réseau d'essai,
# un ancien contrat bep20, des XAFe partis vers un wallet externe (300) et revenus (100).
PREPARER="
update parametres set valeur = valeur || '{\"actif\": true}' where cle = 'beta';
update parametres set valeur = jsonb_build_object('essai', true, 'reserve', 'bep20',
  'bep20', jsonb_build_object('xafe', '0xANCIEN', 'depart', 10)) where cle = 'chaine';
do \$\$
declare a uuid := '11111111-1111-1111-1111-111111111111'; v_t bigint;
begin
  insert into emissions (sens, montant, source_table, source_id) values ('emission', 1000, 'depots', 'XAFe-DP-BETA01');
  perform _mouvement(a, 'XAFe', 1000, 0, 'depot', 'depots', 'XAFe-DP-BETA01');
  insert into retraits_crypto (reference, compte_id, actif, reseau, adresse, montant, etat, tx_hash, cree_le)
  values ('XAFe-CR-BETA01', a, 'XAFe', 'bep20', '0x' || repeat('be', 20), 300, 'envoye', '0xancienbeta', now() - interval '1 day');
  perform _mouvement(a, 'XAFe', -300, 0, 'retrait_crypto_envoye', 'retraits_crypto', 'XAFe-CR-BETA01');
  insert into emissions (sens, montant, source_table, source_id) values ('vers_chaine', 300, 'retraits_crypto', 'XAFe-CR-BETA01');
  insert into transferts_crypto (compte_id, actif, reseau, sens, montant, adresse, tx_hash)
  values (a, 'XAFe', 'bep20', 'entree', 100, '0x' || repeat('bf', 20), '0xretourbeta') returning id into v_t;
  perform _mouvement(a, 'XAFe', 100, 0, 'depot_crypto', 'transferts_crypto', v_t::text);
  insert into emissions (sens, montant, source_table, source_id) values ('depuis_chaine', 100, 'transferts_crypto', v_t::text);
  -- l'ancien contrat a déjà joué la réserve et été relu
  update reserve_chaine set etat = 'confirme', tx_hash = '0xjoue' || id, bloc = 42 where reseau = 'bep20';
  insert into chaine_mouvements_jeton (reseau, tx_hash, idx, bloc, genre, adresse, montant) values ('bep20', '0xvieux', 0, 42, 'frappe', '0xANCIEN', 1);
  insert into chaine_curseurs (reseau, bloc) values ('bep20', 9000), ('bep20:jeton', 9000)
  on conflict (reseau) do update set bloc = excluded.bloc;
end \$\$;
-- E attendu, compté AVANT : tout ce qui est parti sur bep20 moins tout ce qui en est revenu
create temp table attendu as
select (select coalesce(sum(e.montant), 0) from emissions e join retraits_crypto x on x.reference = e.source_id
         where e.sens = 'vers_chaine' and x.reseau = 'bep20')
     - (select coalesce(sum(e.montant), 0) from emissions e join transferts_crypto t on t.id::text = e.source_id
         where e.sens = 'depuis_chaine' and e.source_table = 'transferts_crypto' and t.reseau = 'bep20') as e,
       (select disponible from soldes where compte_id = compte_maison() and actif = 'XAFe') as maison;
"

# cas <nom> <ok|refus:motif> <sql en plus avant le script> <variables psql> <assertions après>
N_BETA=0
cas_beta() {
  N_BETA=$((N_BETA + 1))
  f="$GRAPPE/beta-$N_BETA.sql"; j="$GRAPPE/beta-$N_BETA.log"
  { echo "begin;"; echo "$PREPARER"; echo "$3"; echo "\\i $SCRIPT_BETA"; echo "$5"; echo "rollback;"; } >"$f"
  chmod a+r "$f"
  STATUT=0
  $COMME "PATH=$PATH $PSQL -d xafe $4 -f $f" >"$j" 2>&1 || STATUT=$?
  case "$2" in
    ok)
      [ "$STATUT" = "0" ] || { cat "$j"; echo "✗ changer de contrat ($1) : le script est tombé"; exit 1; } ;;
    refus:*)
      motif=${2#refus:}
      [ "$STATUT" != "0" ] && grep -q "$motif" "$j" \
        || { cat "$j"; echo "✗ changer de contrat ($1) : devait refuser « $motif »"; exit 1; } ;;
  esac
  echo "  ✓ $1"
}

NEUF="-v bep20_xafe=0xNEUF -v bep20_depart=1234"

cas_beta "refuse hors de la bêta" "refus:la bêta n'est pas active" \
  "update parametres set valeur = valeur || '{\"actif\": false}' where cle = 'beta';" "$NEUF" ""
cas_beta "refuse hors d'un réseau d'essai" "refus:chaine.essai" \
  "update parametres set valeur = valeur || '{\"essai\": false}' where cle = 'chaine';" "$NEUF" ""
cas_beta "refuse un réseau configuré laissé sans nouveau contrat" "refus:trc20 est configuré" \
  "update parametres set valeur = valeur || '{\"trc20\": {\"xafe\": \"TANCIEN\"}}' where cle = 'chaine';" "$NEUF" ""
cas_beta "refuse sans aucun nouveau contrat" "refus:aucun nouveau contrat" \
  "update parametres set valeur = valeur - 'bep20' where cle = 'chaine';" "" ""
cas_beta "refuse le contrat déjà en place (deux passages)" "refus:déjà le contrat" "" "-v bep20_xafe=0xANCIEN -v bep20_depart=1234" ""
cas_beta "refuse un bloc de départ qui n'est pas un nombre" "refus:doit être le bloc" "" "-v bep20_xafe=0xNEUF -v bep20_depart=demain" ""
cas_beta "refuse tant qu'un retrait XAFe est en cours" "refus:encore en cours" \
  "insert into retraits_crypto (reference, compte_id, actif, reseau, adresse, montant, etat)
   values ('XAFe-CR-BETA02', '11111111-1111-1111-1111-111111111111', 'XAFe', 'bep20', '0x' || repeat('bd', 20), 5, 'en_attente');" "$NEUF" ""

cas_beta "change de contrat : la maison reprend E, la réserve se rejoue, le jeton se relit" ok "" "$NEUF" "
do \$\$
declare v_e numeric := (select e from attendu); v_m numeric := (select maison from attendu); v_c jsonb := parametre('chaine') -> 'bep20';
begin
  assert v_e >= 200, 'E compte au moins les 300 partis moins les 100 revenus : ' || v_e;
  assert (select disponible from soldes where compte_id = compte_maison() and actif = 'XAFe') = coalesce(v_m, 0) + v_e,
         'la maison reprend exactement E';
  assert exists (select 1 from emissions where sens = 'depuis_chaine' and source_table = 'rebase_essai' and montant = v_e
                   and source_id = 'bep20-' || to_char(now(), 'YYYYMMDD')), 'le retour est écrit aux émissions';
  assert exists (select 1 from reserve_chaine r join emissions e on e.id = r.emission_id
                  where e.source_table = 'rebase_essai' and r.operation = 'frapper' and r.montant = v_e), 'la frappe de réserve est en file';
  assert not exists (select 1 from reserve_chaine where reseau = 'bep20' and (etat <> 'a_faire' or tx_hash is not null or bloc is not null)),
         'toute la réserve se rejoue sur le nouveau contrat';
  assert not exists (select 1 from chaine_mouvements_jeton where reseau = 'bep20'), 'le jeton de l''ancien contrat est oublié';
  assert not exists (select 1 from chaine_curseurs where reseau = 'bep20:jeton'), 'le jeton se relit depuis le déploiement';
  assert (select bloc from chaine_curseurs where reseau = 'bep20') = 9000, 'le curseur des dépôts (USDT compris) est gardé';
  assert v_c ->> 'xafe' = '0xNEUF' and (v_c ->> 'depart')::bigint = 1234 and (v_c ->> 'depuis_le')::timestamptz <= now(), v_c::text;
  assert not exists (select 1 from _parite_lignes() where reference = 'XAFe-CR-BETA01' and nature = 'retrait'), 'le retrait fait sur l''ancien n''est plus attendu (sa destruction de réserve, elle, se rejoue)';
  assert total('XAFe') = circulation(), 'la somme des soldes vaut toujours la circulation';
end \$\$;
"
