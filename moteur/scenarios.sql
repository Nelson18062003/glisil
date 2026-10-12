-- Les scénarios du moteur. Chaque bloc exige un résultat ; le premier écart arrête tout.
\set ON_ERROR_STOP on
\set QUIET on

-- ─────────────────────────────── décor ─────────────────────────────────────
insert into terminaux (id, nom, lieu, vu_le) values ('akwa-1', 'Akwa 1', 'Douala', now());
insert into floats (operateur, numero, terminal) values ('mtn', '677000000', 'akwa-1'), ('om', '699000000', 'akwa-1');

insert into comptes (id, telephone, nom, palier) values
  ('11111111-1111-1111-1111-111111111111', '677123456', 'Alice', 2),
  ('22222222-2222-2222-2222-222222222222', '677999999', 'Bob', 0),
  ('33333333-3333-3333-3333-333333333333', '655111111', 'Chantal', 1);
insert into numeros (id, compte_id, operateur, numero, verifie_le, actif_des) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'mtn', '677123456', now() - interval '2 days', now() - interval '1 day'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'om',  '699123456', now() - interval '2 days', now() - interval '1 day'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'mtn', '655000000', now(), now() + interval '1 day'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'mtn', '677999999', now() - interval '2 days', now() - interval '1 day'),
  ('cccccccc-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'mtn', '655111111', now() - interval '2 days', now() - interval '1 day');
update floats set code_agent = '480213' where operateur = 'mtn';

create function solde(p_compte uuid, p_actif text, p_quoi text) returns numeric language sql as $$
  select case p_quoi when 'dispo' then disponible else bloque end from soldes where compte_id = p_compte and actif = p_actif
$$;
create function total(p_actif text) returns numeric language sql as $$
  select coalesce(sum(disponible + bloque), 0) from soldes where actif = p_actif
$$;

-- ────────────────────── 1 · un dépôt en trois transaction ID ───────────────
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare r jsonb;
begin
  r := ouvrir_depot('mtn', 'k-dep-1');
  assert r ->> 'etat' = 'en_attente', r;
  assert r ->> 'float_numero' = '677000000' and r ->> 'code_agent' = '480213', r;
  assert (ouvrir_depot('mtn', 'k-dep-1') ->> 'reference') = (r ->> 'reference'), 'la même clé rend le même dossier';
  raise notice '✓ 1.1 un dossier de dépôt dit où payer, et une clé rejouée n''en ouvre pas deux';
end $$;
commit;

-- L'ID avant le SMS : la déclaration attend, le SMS la trouve.
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare r jsonb; ref text := (select reference from depots where cle = 'k-dep-1');
begin
  r := declarer_transaction(ref, '2039 4817 101');
  assert r ->> 'etat' = 'attendu' and r ->> 'transaction_id' = '20394817101', r;
  assert (declarer_transaction(ref, '20394817101') ->> 'id') = (r ->> 'id'), 'le même ID sur le même dossier est le même geste';
end $$;
commit;
do $$
declare r jsonb; a uuid := '11111111-1111-1111-1111-111111111111';
begin
  r := totem_sms_recu('akwa-1', 1, 'mtn', '677000000', '677123456', 1000000, '20394817101', 'Vous avez recu 1,000,000 FCFA de ALICE (677123456). ID: 20394817101', now());
  assert r ->> 'resultat' = 'credite' and r ->> 'etat' = 'credite', r;
  assert solde(a, 'XAFe', 'dispo') = 1000000, 'l''ID attendait : 1 000 000 crédités à l''arrivée du SMS';
  r := totem_sms_recu('akwa-1', 1, 'mtn', '677000000', '677123456', 1000000, '20394817101', '…', now());
  assert (r ->> 'deja')::boolean and solde(a, 'XAFe', 'dispo') = 1000000, 'le même SMS relu ne crédite pas deux fois';
  -- Le SMS avant l'ID : retenu, puis rapproché quand l'ID arrive.
  r := totem_sms_recu('akwa-1', 2, 'mtn', '677000000', '677123456', 1000000, '20394817102', '…', now());
  assert r ->> 'resultat' = 'retenue', 'sans déclaration, un SMS est retenu';
  assert solde(a, 'XAFe', 'dispo') = 1000000, 'rien n''est crédité au hasard';
  r := totem_sms_recu('akwa-1', 3, 'mtn', '677000000', '677123456', 1000000, '20394817103', '…', now());
  assert (select count(*) from entrees_retenues where etat = 'retenue') = 2;
  assert (select count(*) from notifications where compte_id = a) = 1, 'le crédit a prévenu une fois';
end $$;
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare r jsonb; a uuid := '11111111-1111-1111-1111-111111111111'; ref text := (select reference from depots where cle = 'k-dep-1');
begin
  r := declarer_transaction(ref, '20394817102');
  assert r ->> 'etat' = 'credite' and (r ->> 'montant')::numeric = 1000000, r;
  assert solde(a, 'XAFe', 'dispo') = 2000000, 'le SMS attendait : crédité à la déclaration';
  r := declarer_transaction(ref, 'mp 20394817103');
  assert r ->> 'etat' = 'attendu', 'un ID mal recopié ne trouve rien et attend';
  r := declarer_transaction(ref, '20394817103');
  assert r ->> 'etat' = 'credite' and solde(a, 'XAFe', 'dispo') = 3000000, 'le bon ID trouve le SMS retenu';
  assert (select count(*) from entrees_retenues where etat = 'retenue') = 0, 'les deux SMS retenus sont rapprochés';
  assert circulation() = 3000000, 'trois millions de XAFe émis';
  assert (mon_depot(ref) ->> 'montant_recu')::numeric = 3000000 and jsonb_array_length(mon_depot(ref) -> 'declarations') = 4, mon_depot(ref);
  raise notice '✓ 1.2 l''ID avant le SMS et le SMS avant l''ID créditent tous deux ; rien au hasard, rien deux fois';
end $$;
commit;

-- Un ID déjà crédité, déclaré par un AUTRE compte : refusé.
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
select ouvrir_depot('mtn', 'k-dep-b0') \gset b0_
do $$
begin
  begin
    perform declarer_transaction((select reference from depots where cle = 'k-dep-b0'), '20394817101');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'transaction ID déjà utilisé', sqlerrm;
  end;
  raise notice '✓ 1.3 un transaction ID ne crédite qu''un compte, une fois';
end $$;
rollback;

-- ──────────────────────── 2 · annulation et expiration ─────────────────────
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
declare r jsonb;
begin
  r := ouvrir_depot('mtn', 'k-dep-ann');
  r := terminer_depot(r ->> 'reference');
  assert r ->> 'etat' = 'annule', 'terminer un dossier vide le ferme';
  r := ouvrir_depot('mtn', 'k-dep-ann2');
  r := annuler_depot(r ->> 'reference');
  assert r ->> 'etat' = 'annule', r;
  begin
    perform declarer_transaction(r ->> 'reference', '20394817200');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'ce dépôt est annulé', sqlerrm;
  end;
  raise notice '✓ 2.1 un dossier annulé ne reçoit plus de déclaration';
end $$;
commit;

begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
select ouvrir_depot('mtn', 'k-dep-exp') \gset dep_
update depots set expire_le = now() - interval '1 minute' where cle = 'k-dep-exp';
select ouvrir_depot('mtn', 'k-dep-att') \gset dep2_
select declarer_transaction((select reference from depots where cle = 'k-dep-att'), '20394817300') \gset att_
update depots set expire_le = now() - interval '3 hours' where cle = 'k-dep-att';
commit;
do $$
declare r jsonb; b uuid := '22222222-2222-2222-2222-222222222222';
begin
  assert expirer_depots() = 1, 'seul le dossier sans déclaration expire';
  assert (select etat from depots where cle = 'k-dep-exp') = 'expire';
  assert (select etat from depots where cle = 'k-dep-att') = 'en_attente', 'une déclaration en attente n''expire jamais';
  r := totem_sms_recu('akwa-1', 6, 'mtn', '677000000', '677999999', 200000, '20394817300', '…', now());
  assert r ->> 'resultat' = 'credite', 'le SMS arrive trois heures après l''ID : crédité quand même';
  assert solde(b, 'XAFe', 'dispo') = 200000;
  raise notice '✓ 2.2 un dossier vide expire, une déclaration attend son SMS autant qu''il faut';
end $$;

-- ─────────────────────────── 3 · le palier 0 ───────────────────────────────
-- Bob (palier 0) a déjà reçu 200 000 aujourd'hui : un SMS de 400 000 dépasse.
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
select ouvrir_depot('mtn', 'k-dep-pal') \gset pal_
select declarer_transaction((select reference from depots where cle = 'k-dep-pal'), '20394817400') \gset pal2_
commit;
do $$
declare r jsonb; b uuid := '22222222-2222-2222-2222-222222222222';
begin
  r := totem_sms_recu('akwa-1', 7, 'mtn', '677000000', '677999999', 400000, '20394817400', '…', now());
  assert r ->> 'resultat' = 'retenue' and r ->> 'motif' like 'plafond du palier%', r;
  assert solde(b, 'XAFe', 'dispo') = 200000, 'rien n''est crédité au-delà du palier';
  assert (select etat from depot_declarations where transaction_id = '20394817400') = 'refuse';
  assert (select count(*) from entrees_retenues where etat = 'retenue' and transaction_id = '20394817400') = 1, 'l''argent est retenu pour remboursement';
  raise notice '✓ 3.1 le palier 0 refuse un crédit au-delà de 500 000 par jour : l''argent est retenu, pas perdu';
end $$;

-- ───────────────────────── 4 · de l''USDT par la chaîne ────────────────────
do $$
declare r jsonb; b uuid := '22222222-2222-2222-2222-222222222222';
begin
  r := crediter_crypto(b, 'USDT', 'bep20', 5000, '0xhash-1', '0xadresse-b');
  assert solde(b, 'USDT', 'dispo') = 5000, 'Bob a 5 000 USDT';
  r := crediter_crypto(b, 'USDT', 'bep20', 5000, '0xhash-1', '0xadresse-b');
  assert (r ->> 'deja')::boolean and solde(b, 'USDT', 'dispo') = 5000, 'la même transaction ne crédite pas deux fois';
  raise notice '✓ 4.1 une transaction de chaîne crédite une fois';
end $$;

-- ─────────────────────────────── 5 · le carnet ─────────────────────────────
-- Alice : 3 000 000 XAFe. Bob : 200 000 XAFe, 5 000 USDT.
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
select placer_ordre('vente', 'limite', 1000, 618.40, 'o1') \gset o1_
commit;
do $$
declare b uuid := '22222222-2222-2222-2222-222222222222';
begin
  assert solde(b, 'USDT', 'dispo') = 4000 and solde(b, 'USDT', 'bloque') = 1000, 'la vente limite bloque 1 000 USDT';
  assert (carnet() -> 'ventes' -> 0 ->> 'prix')::numeric = 618.40, carnet()::text;
  raise notice '✓ 5.1 une vente limite bloque ses USDT et s''inscrit au carnet';
end $$;

begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
select placer_ordre('achat', 'limite', 400, 618.00, 'o2') \gset o2_
commit;
do $$
declare a uuid := '11111111-1111-1111-1111-111111111111';
begin
  assert solde(a, 'XAFe', 'dispo') = 2752800 and solde(a, 'XAFe', 'bloque') = 247200, 'l''achat limite bloque 247 200 XAFe';
  assert (select count(*) from executions) = 0, 'pas de croisement : rien ne s''exécute';
  raise notice '✓ 5.2 un achat limite sous le prix de vente attend, ses XAFe bloqués';
end $$;

begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare r jsonb; a uuid := '11111111-1111-1111-1111-111111111111'; b uuid := '22222222-2222-2222-2222-222222222222'; m uuid := compte_maison();
begin
  r := placer_ordre('achat', 'marche', 300, null, 'o3');
  assert jsonb_array_length(r -> 'executions') = 1, r;
  assert (r -> 'executions' -> 0 ->> 'prix')::numeric = 618.40, 'au prix de l''ordre qui attendait';
  assert r -> 'ordre' ->> 'etat' = 'execute', r;
  assert solde(a, 'XAFe', 'dispo') = 2567280, format('Alice XAFe %s', solde(a, 'XAFe', 'dispo'));
  assert solde(a, 'USDT', 'dispo') = 299.70, format('Alice USDT %s (300 moins 0,10 %%)', solde(a, 'USDT', 'dispo'));
  assert solde(b, 'USDT', 'bloque') = 700, 'Bob garde 700 USDT bloqués';
  assert solde(b, 'XAFe', 'dispo') = 385427, format('Bob XAFe %s (185 520 moins 0,05 %%)', solde(b, 'XAFe', 'dispo'));
  assert solde(m, 'USDT', 'dispo') = 0.30 and solde(m, 'XAFe', 'dispo') = 93, 'la maison encaisse les deux frais';
  raise notice '✓ 5.3 un achat au marché prend la meilleure vente, au prix du vendeur, frais dans l''actif reçu';
end $$;
commit;

begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare r jsonb; a uuid := '11111111-1111-1111-1111-111111111111'; b uuid := '22222222-2222-2222-2222-222222222222'; m uuid := compte_maison();
begin
  r := placer_ordre('achat', 'limite', 800, 619.00, 'o4');
  assert jsonb_array_length(r -> 'executions') = 1 and (r -> 'executions' -> 0 ->> 'quantite')::numeric = 700, r;
  assert r -> 'ordre' ->> 'etat' = 'partiel' and (r -> 'ordre' ->> 'restant')::numeric = 100, r;
  assert (r -> 'ordre' ->> 'bloque')::numeric = 61900, format('il reste 100 × 619 bloqués, pas %s', r -> 'ordre' ->> 'bloque');
  assert solde(a, 'XAFe', 'dispo') = 2072500 and solde(a, 'XAFe', 'bloque') = 61900 + 247200, format('Alice %s / %s', solde(a, 'XAFe', 'dispo'), solde(a, 'XAFe', 'bloque'));
  assert solde(a, 'USDT', 'dispo') = 999.00, format('Alice USDT %s', solde(a, 'USDT', 'dispo'));
  assert solde(b, 'USDT', 'bloque') = 0 and solde(b, 'XAFe', 'dispo') = 818091, format('Bob %s', solde(b, 'XAFe', 'dispo'));
  assert solde(m, 'XAFe', 'dispo') = 309 and solde(m, 'USDT', 'dispo') = 1.00;
  raise notice '✓ 5.4 un achat limite qui croise s''exécute au prix du vendeur et rend la différence ; le reste attend';
end $$;
commit;

begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
declare r jsonb; a uuid := '11111111-1111-1111-1111-111111111111'; b uuid := '22222222-2222-2222-2222-222222222222'; m uuid := compte_maison();
begin
  r := placer_ordre('vente', 'marche', 500, null, 'o5');
  assert jsonb_array_length(r -> 'executions') = 2, r;
  assert (r -> 'executions' -> 0 ->> 'prix')::numeric = 619.00 and (r -> 'executions' -> 1 ->> 'prix')::numeric = 618.00, 'le meilleur achat d''abord';
  assert solde(a, 'XAFe', 'bloque') = 0, 'les deux achats d''Alice sont réglés';
  assert solde(a, 'USDT', 'dispo') = 1498.75, format('Alice USDT %s', solde(a, 'USDT', 'dispo'));
  assert solde(b, 'USDT', 'dispo') = 3500 and solde(b, 'XAFe', 'dispo') = 1126882, format('Bob %s XAFe', solde(b, 'XAFe', 'dispo'));
  assert solde(m, 'XAFe', 'dispo') = 618 and solde(m, 'USDT', 'dispo') = 1.25;
  assert (select count(*) from ordres where etat in ('ouvert', 'partiel')) = 0, 'le carnet est vide';
  raise notice '✓ 5.5 une vente au marché balaie les achats du meilleur au moins bon';
end $$;
commit;

begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare r jsonb; a uuid := '11111111-1111-1111-1111-111111111111';
begin
  r := placer_ordre('achat', 'limite', 10, 617.00, 'o6');
  r := placer_ordre('vente', 'marche', 10, null, 'o7');
  assert (r ->> 'auto_negociation')::boolean and r -> 'ordre' ->> 'etat' = 'annule', r;
  assert jsonb_array_length(r -> 'executions') = 0, 'on ne se vend pas à soi-même';
  assert (select etat from ordres where cle = 'o6') = 'ouvert', 'l''achat reste au carnet';
  begin
    perform placer_ordre('achat', 'limite', 1000000, 618.00, 'o-trop');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'solde insuffisant', sqlerrm;
  end;
  begin
    perform placer_ordre('achat', 'limite', 10, 618.01, 'o-pas');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'prix invalide', sqlerrm;
  end;
  raise notice '✓ 5.6 pas d''auto-négociation, pas d''ordre sans fonds, pas de prix hors du pas';
end $$;
commit;

-- Chantal n'a que 50 000 XAFe : un achat au marché s'arrête à ce qu'elle a.
do $$
begin
  perform totem_sms_recu('akwa-1', 9, 'mtn', '677000000', '655111111', 50000, 'MP261012.1402.C00009', '…', now());
end $$;
begin;
set local xafe.compte = '33333333-3333-3333-3333-333333333333';
select ouvrir_depot('mtn', 'k-dep-c') \gset c_
do $$
declare r jsonb; c uuid := '33333333-3333-3333-3333-333333333333';
begin
  r := declarer_transaction((select reference from depots where cle = 'k-dep-c'), 'mp261012.1402.c00009');
  assert r ->> 'etat' = 'credite' and solde(c, 'XAFe', 'dispo') = 50000, r;
end $$;
commit;
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
select placer_ordre('vente', 'limite', 98.75, 618.00, 'o10') \gset o10_
commit;
begin;
set local xafe.compte = '33333333-3333-3333-3333-333333333333';
do $$
declare r jsonb; c uuid := '33333333-3333-3333-3333-333333333333';
begin
  r := placer_ordre('achat', 'marche', 98.75, null, 'o11');
  assert (r -> 'ordre' ->> 'executee')::numeric = 80.90, format('elle n''achète que ce que 50 000 paient : %s', r -> 'ordre' ->> 'executee');
  assert solde(c, 'XAFe', 'dispo') = 3.80 and solde(c, 'USDT', 'dispo') = 80.82, format('Chantal %s XAFe, %s USDT', solde(c, 'XAFe', 'dispo'), solde(c, 'USDT', 'dispo'));
  assert (select etat from ordres where cle = 'o10') = 'partiel' and (select restant from ordres where cle = 'o10') = 17.85;
  raise notice '✓ 5.7 un achat au marché s''arrête à ce que le compte peut payer';
end $$;
commit;

begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare r jsonb; a uuid := '11111111-1111-1111-1111-111111111111'; avant numeric := solde(a, 'USDT', 'dispo');
begin
  r := annuler_ordre((select id from ordres where cle = 'o10'));
  assert r ->> 'etat' = 'annule' and solde(a, 'USDT', 'bloque') = 0 and solde(a, 'USDT', 'dispo') = avant + 17.85, r;
  r := annuler_ordre((select id from ordres where cle = 'o6'));
  assert solde(a, 'XAFe', 'bloque') = 0, 'tout est libéré';
  assert (select count(*) from ordres where etat in ('ouvert', 'partiel')) = 0;
  raise notice '✓ 5.8 annuler rend exactement ce qui restait bloqué';
end $$;
commit;

do $$
begin
  assert total('XAFe') = circulation(), format('XAFe : %s en soldes, %s émis', total('XAFe'), circulation());
  assert total('USDT') = 5000, format('USDT : %s en soldes pour 5 000 entrés', total('USDT'));
  raise notice '✓ 5.9 la somme des soldes vaut exactement les émissions moins les destructions';
end $$;

-- ─────────────────────────────── 6 · une sortie ────────────────────────────
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare r jsonb; a uuid := '11111111-1111-1111-1111-111111111111'; avant numeric := solde(a, 'XAFe', 'dispo');
begin
  perform completer_profil('Alice Ngo', '1234');
  r := demander_sortie(1500000, 'aaaaaaaa-0000-0000-0000-000000000001', 'k-s1', '0000');
  assert r ->> 'erreur' = 'code secret incorrect' and (r ->> 'essais_restants')::int = 2, r;
  assert solde(a, 'XAFe', 'bloque') = 0, 'un code faux ne bloque rien';
  r := demander_sortie(1500000, 'aaaaaaaa-0000-0000-0000-000000000001', 'k-s1', '1234');
  assert (r ->> 'transferts')::int = 2, r;
  assert (r ->> 'frais')::numeric = 7500 and (r ->> 'montant_xaf')::numeric = 1492500, r;
  assert solde(a, 'XAFe', 'dispo') = avant - 1500000 and solde(a, 'XAFe', 'bloque') = 1500000, 'les XAFe sont bloqués';
  assert (demander_sortie(1500000, 'aaaaaaaa-0000-0000-0000-000000000001', 'k-s1', '1234') ->> 'reference') = (r ->> 'reference'), 'la même clé rend la même sortie';
  assert jsonb_array_length(ma_sortie(r ->> 'reference') -> 'transferts') = 2, ma_sortie(r ->> 'reference');
  assert (select count(*) from commandes) = 2, 'toujours deux transferts';
  begin
    perform demander_sortie(1000, 'aaaaaaaa-0000-0000-0000-000000000003', null, '1234');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'numéro pas encore actif', sqlerrm;
  end;
  raise notice '✓ 6.1 une sortie de 1 500 000 par MTN fait deux transferts ; un numéro de moins de 24 h est refusé';
end $$;
commit;

do $$
declare c commandes; r jsonb; a uuid := '11111111-1111-1111-1111-111111111111'; m uuid := compte_maison();
        maison_avant numeric := solde(m, 'XAFe', 'dispo'); dispo_avant numeric := solde(a, 'XAFe', 'dispo'); circ numeric := circulation();
        id1 bigint; id2 bigint;
begin
  assert (select count(*) from totem_commandes_en_attente('akwa-1')) = 2;
  select min(id), max(id) into id1, id2 from commandes;
  c := totem_reclamer_commande(id1, 'akwa-1');
  assert c.etat = 'en_cours' and (c.parametres ->> 'montant')::numeric = 746250, c.parametres::text;
  begin
    perform totem_reclamer_commande(id1, 'akwa-1');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm like 'commande déjà prise%', sqlerrm;
  end;
  r := totem_resultat_commande(id1, 'akwa-1', true, 'Transfert reussi', 'MP-1');
  assert r ->> 'sortie' = 'en_cours', r;
  assert circulation() = circ - 746250, 'les XAF partis sont détruits';
  assert solde(m, 'XAFe', 'dispo') = maison_avant + 3750, 'les frais du transfert vont à la maison';
  assert solde(a, 'XAFe', 'bloque') = 750000, 'il reste le second transfert bloqué';
  -- le second échoue trois fois
  c := totem_reclamer_commande(id2, 'akwa-1');
  r := totem_resultat_commande(id2, 'akwa-1', false, 'réseau muet');
  assert r ->> 'commande' = 'en_attente' and (r ->> 'reprises')::int = 1, r;
  c := totem_reclamer_commande(id2, 'akwa-1');
  r := totem_resultat_commande(id2, 'akwa-1', false, 'réseau muet');
  c := totem_reclamer_commande(id2, 'akwa-1');
  r := totem_resultat_commande(id2, 'akwa-1', false, 'réseau muet');
  assert r ->> 'commande' = 'echouee' and r ->> 'sortie' = 'partielle', r;
  assert solde(a, 'XAFe', 'bloque') = 0 and solde(a, 'XAFe', 'dispo') = dispo_avant + 750000, 'le transfert échoué revient au client';
  assert (select montant_envoye from sorties where cle = 'k-s1') = 746250 and (select montant_rendu from sorties where cle = 'k-s1') = 750000;
  r := totem_resultat_commande(id2, 'akwa-1', false, 'encore');
  assert (r ->> 'deja')::boolean, 'un résultat rejoué ne change rien';
  raise notice '✓ 6.2 un transfert passé détruit ses XAFe, un transfert échoué trois fois revient au client';
end $$;

-- Le moteur regarde dans cet ordre : le numéro, le palier, puis le solde (au verrou).
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
begin
  begin
    perform demander_sortie(600000, 'bbbbbbbb-0000-0000-0000-000000000001');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm like 'plafond du palier%', sqlerrm;
  end;
end $$;
rollback;
begin;
set local xafe.compte = '33333333-3333-3333-3333-333333333333';
do $$
begin
  begin
    perform demander_sortie(400000, 'cccccccc-0000-0000-0000-000000000001');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'solde insuffisant', sqlerrm;
  end;
  raise notice '✓ 6.3 pas de sortie au-delà du palier, pas de sortie sans fonds';
end $$;
rollback;

do $$
begin
  assert total('XAFe') = circulation(), format('XAFe : %s en soldes, %s en circulation', total('XAFe'), circulation());
  raise notice '✓ 6.4 après la sortie, la somme des soldes vaut encore la circulation';
end $$;

-- ───────────────────────── 7 · ce que le client voit ───────────────────────
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare r jsonb;
begin
  r := mes_soldes();
  assert (r -> 'XAFe' ->> 'disponible')::numeric > 0 and (r -> 'XAFe' ->> 'bloque')::numeric = 0, r;
  r := cotation();
  assert (r ->> 'dernier')::numeric = 618.00 and (r ->> 'haut')::numeric = 619.00 and (r ->> 'bas')::numeric = 618.00, r;
  assert (r ->> 'volume_usdt')::numeric = 300 + 700 + 100 + 400 + 80.90, r;
  assert jsonb_array_length(transactions_recentes(3)) = 3;
  raise notice '✓ 7.1 soldes, cotation et transactions se lisent';
end $$;
commit;

-- ───────────────────── 8 · un client n'écrit jamais en direct ──────────────
begin;
set local role authenticated;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
begin
  assert (select count(*) from soldes) = 2, 'Bob ne voit que ses deux soldes';
  assert (select count(*) from ordres) = (select count(*) from ordres where compte_id = '22222222-2222-2222-2222-222222222222'), 'Bob ne voit que ses ordres';
  begin
    update soldes set disponible = disponible + 1000000 where compte_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'aurait dû refuser';
  exception when insufficient_privilege then null;
  end;
  begin
    perform totem_sms_recu('akwa-1', 99, 'mtn', '677000000', '677999999', 1000000, 'x', 'x', now());
    raise exception 'aurait dû refuser';
  exception when insufficient_privilege then null;
  end;
  begin
    perform demander_sortie(1000, 'bbbbbbbb-0000-0000-0000-000000000001', null);
    raise exception 'aurait dû refuser';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from notifications) = (select count(*) from notifications where compte_id = '22222222-2222-2222-2222-222222222222'), 'Bob ne lit que ses notifications';
  raise notice '✓ 8.1 un client lit ses lignes, ne peut ni écrire un solde, ni jouer TOTEM, ni sortir sans code';
end $$;
rollback;

-- ──────────────────── 9 · le compte, les numéros, la crypto ────────────────
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
declare r jsonb; b uuid := '22222222-2222-2222-2222-222222222222';
begin
  assert (mon_compte() ->> 'a_code')::boolean = false, mon_compte();
  r := completer_profil('Bob Essomba', '2468');
  assert (r ->> 'a_code')::boolean and r ->> 'nom' = 'Bob Essomba', r;
  assert (verifier_code_secret('2468') ->> 'ok')::boolean, 'le bon code passe';
  r := verifier_code_secret('0000'); assert not (r ->> 'ok')::boolean and (r ->> 'essais_restants')::int = 2, r;
  r := verifier_code_secret('0000'); assert (r ->> 'essais_restants')::int = 1, r;
  r := verifier_code_secret('0000'); assert r ->> 'erreur' = 'compte verrouillé' and r ->> 'verrou_jusqua' is not null, r;
  r := verifier_code_secret('2468'); assert r ->> 'erreur' = 'compte verrouillé', 'même le bon code ne passe plus pendant le verrou';
  assert (mon_compte() ->> 'verrou_jusqua') is not null;
  update comptes set code_verrou_jusqua = now() - interval '1 minute' where id = b;
  assert (verifier_code_secret('2468') ->> 'ok')::boolean, 'le verrou levé, le bon code passe';
  r := changer_code_secret('2468', '1357'); assert (r ->> 'ok')::boolean, r;
  assert (verifier_code_secret('1357') ->> 'ok')::boolean and not (verifier_code_secret('2468') ->> 'ok')::boolean;
  raise notice '✓ 9.1 le code secret : trois erreurs verrouillent 15 minutes, et l''échec se compte même quand on refuse';
end $$;
commit;

begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
declare r jsonb; b uuid := '22222222-2222-2222-2222-222222222222'; v_id uuid; v_code text;
begin
  r := ajouter_numero('om', '+237 6 99 11 22 33');
  v_id := (r ->> 'id')::uuid;
  assert r ->> 'numero' = '699112233' and r ->> 'verifie_le' is null, r;
  assert jsonb_array_length(mes_numeros()) = 2;
  select substring(texte from 'code est ([0-9]{6})') into v_code from messages_sortants where numero = '699112233';
  assert v_code is not null, 'un SMS avec le code attend TOTEM';
  begin
    perform demander_sortie(1000, v_id, null, '1357');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'numéro pas encore vérifié', sqlerrm;
  end;
  begin
    perform confirmer_numero(v_id, '000000');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'code SMS incorrect', sqlerrm;
  end;
  r := confirmer_numero(v_id, v_code);
  assert r ->> 'verifie_le' is not null and (r ->> 'actif_des')::timestamptz > now() + interval '23 hours', r;
  begin
    perform demander_sortie(1000, v_id, null, '1357');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'numéro pas encore actif', sqlerrm;
  end;
  begin
    perform ajouter_numero('om', '699112233');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'ce numéro est déjà sur votre compte', sqlerrm;
  end;
  r := retirer_numero(v_id, '1357'); assert (r ->> 'ok')::boolean, r;
  assert jsonb_array_length(mes_numeros()) = 1;
  begin
    perform retirer_numero('bbbbbbbb-0000-0000-0000-000000000001', '1357');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'le dernier numéro ne se retire pas', sqlerrm;
  end;
  raise notice '✓ 9.2 un numéro ajouté se prouve par SMS, n''est actif que 24 h après, et le dernier ne se retire pas';
end $$;
commit;

insert into adresses_libres (actif, reseau, adresse) values ('USDT', 'bep20', '0x1111111111111111111111111111111111111111'), ('USDT', 'bep20', '0x2222222222222222222222222222222222222222');
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
declare r jsonb; b uuid := '22222222-2222-2222-2222-222222222222'; usdt_avant numeric := solde(b, 'USDT', 'dispo');
begin
  assert adresse_depot('USDT', 'bep20') = '0x1111111111111111111111111111111111111111';
  assert adresse_depot('USDT', 'bep20') = '0x1111111111111111111111111111111111111111', 'la même adresse à chaque fois';
  assert adresse_depot('USDT', 'trc20') is null, 'aucune adresse préparée : rien à inventer';
  r := demander_retrait_crypto('USDT', 'bep20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 100, 'k-cr-1', '1357');
  assert r ->> 'etat' = 'en_attente' and (r ->> 'frais')::numeric = 1, r;
  assert solde(b, 'USDT', 'dispo') = usdt_avant - 101 and solde(b, 'USDT', 'bloque') = 101, 'montant et frais bloqués';
  assert (demander_retrait_crypto('USDT', 'bep20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 100, 'k-cr-1', '1357') ->> 'reference') = (r ->> 'reference'), 'la même clé rend le même retrait';
  begin
    perform demander_retrait_crypto('USDT', 'trc20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 100, null, '1357');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'adresse invalide', sqlerrm;
  end;
  r := chaine_resultat_retrait(r ->> 'reference', true, '0xtx-1');
  assert r ->> 'etat' = 'envoye' and solde(b, 'USDT', 'bloque') = 0 and solde(b, 'USDT', 'dispo') = usdt_avant - 101, r;
  assert solde(compte_maison(), 'USDT', 'dispo') >= 1, 'les frais vont à la maison';
  r := demander_retrait_crypto('USDT', 'bep20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 50, 'k-cr-2', '1357');
  r := chaine_resultat_retrait(r ->> 'reference', false, null, 'gas insuffisant');
  assert r ->> 'etat' = 'echoue' and solde(b, 'USDT', 'dispo') = usdt_avant - 101 and solde(b, 'USDT', 'bloque') = 0, 'un envoi refusé par la chaîne revient entier';
  raise notice '✓ 9.3 une adresse de dépôt se prend dans la réserve, un retrait bloque montant et frais, un échec rend tout';
end $$;
commit;

begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
declare h jsonb; r jsonb;
begin
  h := mon_historique(50);
  assert jsonb_array_length(h) >= 4, h;
  assert (select count(*) from jsonb_array_elements(h) x where x ->> 'nature' = 'retrait') = 2, 'les deux retraits crypto sont là';
  assert (select count(*) from jsonb_array_elements(h) x where x ->> 'nature' = 'depot') >= 1;
  assert jsonb_array_length(mes_ordres()) >= 1;
  r := mon_ordre((select id from ordres where compte_id = '22222222-2222-2222-2222-222222222222' and executee > 0 limit 1));
  assert jsonb_array_length(r -> 'executions') >= 1 and (r -> 'executions' -> 0 ->> 'mon_role') in ('preneur', 'placeur'), r;
  assert jsonb_array_length(chandelles(60, 28)) >= 1, 'les exécutions font au moins une chandelle';
  assert (chandelles(60, 28) -> 0 ->> 'h')::numeric >= (chandelles(60, 28) -> 0 ->> 'l')::numeric;
  assert jsonb_array_length(mes_notifications()) >= 1;
  perform marquer_notifications_lues();
  assert (select count(*) from jsonb_array_elements(mes_notifications()) n where n ->> 'lue_le' is null) = 0;
  raise notice '✓ 9.4 l''historique, les ordres, les chandelles et les notifications se lisent';
end $$;
commit;
