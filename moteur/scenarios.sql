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
  r := totem_sms_recu('akwa-1', 1, 'mtn', '677000000', '677123456', 1000000, '20394817101', 'Vous avez recu 1,000,000 FCFA de ALICE (677123456). ID: 20394817101', now());
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
  r := confirmer_numero(v_id, '000000');
  assert r ->> 'erreur' = 'code SMS incorrect' and (r ->> 'essais_restants')::int = 4, r;
  assert (select essais from numeros_codes where numero_id = v_id) = 1, 'un code SMS faux se COMPTE : il ne lève pas, son écriture reste';
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

-- Le SMS du code, vu du boîtier : relevé, réclamé une seule fois, rendu.
do $$
declare v_id bigint; r jsonb;
begin
  select id into v_id from totem_messages_en_attente('akwa-1') limit 1;
  assert v_id is not null, 'le SMS du code attend le boîtier';
  perform totem_reclamer_message(v_id, 'akwa-1');
  begin
    perform totem_reclamer_message(v_id, 'akwa-1');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'commande déjà prise ou inconnue', sqlerrm;
  end;
  r := totem_resultat_message(v_id, 'akwa-1', true);
  assert r ->> 'message' = 'envoye', r;
  assert (totem_resultat_message(v_id, 'akwa-1', false, 'x') ->> 'deja')::boolean, 'un résultat rejoué ne change rien';
  assert (select count(*) from totem_messages_en_attente('akwa-1')) = 0;
  raise notice '✓ 9.2b le SMS du code passe par le guichet de TOTEM : réclamé une fois, rendu une fois';
end $$;

insert into adresses_libres (actif, reseau, adresse) values ('USDT', 'bep20', '0x1111111111111111111111111111111111111111'), ('USDT', 'bep20', '0x2222222222222222222222222222222222222222');
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
declare r jsonb; b uuid := '22222222-2222-2222-2222-222222222222'; usdt_avant numeric := solde(b, 'USDT', 'dispo');
begin
  assert adresse_depot('USDT', 'bep20') = '0x1111111111111111111111111111111111111111';
  assert adresse_depot('USDT', 'bep20') = '0x1111111111111111111111111111111111111111', 'la même adresse à chaque fois';
  assert adresse_depot('USDT', 'trc20') is null, 'aucune adresse préparée : rien à inventer';
  begin
    perform demander_retrait_crypto('USDT', 'bep20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 100, 'k-cr-0', '1357');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'retraits crypto pas encore ouverts', sqlerrm;
  end;
  assert solde(b, 'USDT', 'bloque') = 0, 'fermés : rien ne se bloque sans issue';
  update parametres set valeur = valeur || '{"retraits_ouverts": true}' where cle = 'crypto';
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


-- ───────────────────────── 10 · l'administration ──────────────────────────
insert into administrateurs (id, email, nom, role) values
  ('dddddddd-0000-0000-0000-000000000001', 'nelson@xafe.exchange', 'Nelson', 'super_admin'),
  ('dddddddd-0000-0000-0000-000000000002', 'ops@xafe.exchange', 'Opérateur', 'operateur'),
  ('dddddddd-0000-0000-0000-000000000003', 'support@xafe.exchange', 'Support', 'support');

-- Le support voit, mais ne rapproche pas, ne rembourse pas, ne touche pas aux paliers.
begin;
set local xafe.compte = 'dddddddd-0000-0000-0000-000000000003';
do $$
declare r jsonb;
begin
  assert (mon_profil_admin() ->> 'role') = 'support';
  r := admin_tableau();
  assert (r ->> 'circulation')::numeric = circulation(), r;
  assert jsonb_array_length(r -> 'terminaux') = 1 and jsonb_array_length(r -> 'floats') = 2, r;
  assert (r -> 'retenues' ->> 'nombre')::int >= 1, 'une entrée retenue au moins (le palier de Bob)';
  begin
    perform admin_rapprocher_retenue((select id from entrees_retenues where etat = 'retenue' limit 1), 'XAFe-DP-000001');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'accès non autorisé', sqlerrm;
  end;
  begin
    perform admin_changer_palier('22222222-2222-2222-2222-222222222222', 2);
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'accès non autorisé', sqlerrm;
  end;
  assert jsonb_array_length(admin_clients('bob', 10)) = 1, admin_clients('bob', 10);
  raise notice '✓ 10.1 un administrateur n''a que les droits de son rôle, et un client lambda n''en a aucun';
end $$;
rollback;

-- Un client (Alice) qui appellerait une RPC d'administration : refusé.
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
begin
  begin
    perform admin_tableau();
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'accès non autorisé', sqlerrm;
  end;
  assert mon_profil_admin() is null;
end $$;
rollback;

-- L'opérateur rapproche à la main un SMS retenu : le client avait mal recopié son ID (scénario 1, « mp 20394817103 »).
begin;
set local xafe.compte = 'dddddddd-0000-0000-0000-000000000002';
do $$
declare r jsonb; v_id bigint; b uuid := '22222222-2222-2222-2222-222222222222'; avant numeric := solde(b, 'XAFe', 'dispo');
begin
  -- un SMS que personne n'a déclaré, sur le float MTN, venant du numéro de Bob
  r := totem_sms_recu('akwa-1', 21, 'mtn', '677000000', '677999999', 75000, '20394817777', '…', now());
  assert r ->> 'resultat' = 'retenue', r;
  v_id := (r ->> 'id')::bigint;
  r := admin_retenues('retenue', 50);
  assert (select count(*) from jsonb_array_elements(r) x where (x ->> 'id')::bigint = v_id and x -> 'compte_suggere' ->> 'nom' = 'Bob Essomba') = 1, 'le numéro payeur suggère le compte de Bob';
  r := admin_rapprocher_retenue(v_id, (select reference from depots where cle = 'k-dep-pal'));
  assert r ->> 'etat' = 'credite' and (r ->> 'montant')::numeric = 75000, r;
  assert solde(b, 'XAFe', 'dispo') = avant + 75000, 'Bob est crédité par la même voie que l''automatique';
  assert (select etat from entrees_retenues where id = v_id) = 'rapprochee';
  begin
    perform admin_rapprocher_retenue(v_id, (select reference from depots where cle = 'k-dep-pal'));
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm like 'cette entrée n''est plus retenue%', sqlerrm;
  end;
  assert (select count(*) from admin_journal(10) j) = 1 and (admin_journal(10) -> 0 ->> 'action') = 'rapprocher_retenue', admin_journal(10);
  raise notice '✓ 10.2 un SMS retenu se rapproche à la main, une fois, et le journal le dit';
end $$;
commit;

-- Le super admin rembourse le SMS que le palier de Bob a refusé : TOTEM composera le transfert.
begin;
set local xafe.compte = 'dddddddd-0000-0000-0000-000000000001';
do $$
declare r jsonb; v_id bigint; v_rbt bigint;
begin
  select id into v_id from entrees_retenues where etat = 'retenue' and transaction_id = '20394817400';
  r := admin_rembourser_retenue(v_id, 'au-delà du palier 0');
  assert (r ->> 'montant')::numeric = 400000 and r ->> 'numero' = '677999999', r;
  assert (select etat from entrees_retenues where id = v_id) = 'remboursee';
  select id into v_rbt from totem_remboursements_en_attente('akwa-1') limit 1;
  assert v_rbt is not null, 'le remboursement attend le boîtier';
  perform totem_reclamer_remboursement(v_rbt, 'akwa-1');
  r := totem_resultat_remboursement(v_rbt, 'akwa-1', true, 'Transfert reussi', '20394817999');
  assert r ->> 'remboursement' = 'fait', r;
  raise notice '✓ 10.3 un paiement au-delà du palier se rembourse par TOTEM, et l''entrée se ferme';
end $$;
commit;

-- Terminaux et floats : une clé rendue une fois ; un float qui se désactive ne reçoit plus de dossier.
begin;
set local xafe.compte = 'dddddddd-0000-0000-0000-000000000001';
do $$
declare r jsonb; r2 jsonb;
begin
  r := admin_creer_terminal('bonaberi-2', 'Bonabéri 2', 'Douala');
  assert length(r ->> 'cle') = 64, r;
  assert (select cle from terminaux where id = 'bonaberi-2') = r ->> 'cle';
  r2 := admin_renouveler_cle('bonaberi-2');
  assert r2 ->> 'cle' <> r ->> 'cle', 'la clé a changé';
  assert (select count(*) from jsonb_array_elements(admin_terminaux()) t where t ->> 'id' = 'bonaberi-2' and (t ->> 'a_cle')::boolean and (t ->> 'muet')::boolean) = 1, admin_terminaux();
  r := admin_creer_float('om', '6 99 00 00 01', 'bonaberi-2', null);
  perform admin_activer_float((r ->> 'id')::int, false);
  assert (select actif from floats where id = (r ->> 'id')::int) = false;
  begin
    perform admin_creer_terminal('Mauvais ID', 'x', 'x');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'identifiant invalide', sqlerrm;
  end;
  raise notice '✓ 10.4 un terminal naît avec une clé rendue une fois, un float se met en pause';
end $$;
commit;

-- Clients : les pièces de Chantal sont validées, elle passe au palier 2 et le sait.
begin;
set local xafe.compte = '33333333-3333-3333-3333-333333333333';
select completer_profil('Chantal Mbarga', '9876') \gset ch_
select demander_verification('entreprise', '["33333333-3333-3333-3333-333333333333/entreprise/rccm.jpg"]'::jsonb) \gset chv_
commit;
begin;
set local xafe.compte = 'dddddddd-0000-0000-0000-000000000001';
do $$
declare r jsonb; c uuid := '33333333-3333-3333-3333-333333333333';
begin
  assert (admin_tableau() ->> 'verifications')::int = 1;
  r := admin_client(c);
  assert r -> 'compte' ->> 'verification_en_cours' = 'entreprise' and jsonb_array_length(r -> 'numeros') = 1, r;
  r := admin_valider_verification(c, true, 'RCCM conforme');
  assert (r ->> 'palier')::int = 2, r;
  assert (select verification_en_cours from comptes where id = c) is null;
  assert (select count(*) from notifications where compte_id = c and titre = 'Vérification acceptée') = 1;
  begin
    perform admin_valider_verification(c, true);
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'aucune vérification en cours', sqlerrm;
  end;
  r := admin_modifier_parametre('marche', '{"paire": "USDT/XAFe", "pas_prix": 0.05, "quantite_min": 10, "ouvert": false}'::jsonb);
  assert (admin_parametres() -> 'marche' ->> 'ouvert')::boolean = false;
  raise notice '✓ 10.5 une vérification validée monte le palier et prévient ; un paramètre se change et se relit';
end $$;
commit;

-- Le marché fermé par l'admin refuse les ordres, puis rouvre.
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
begin
  begin
    perform placer_ordre('achat', 'limite', 10, 600.00, 'o-ferme');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'marché fermé', sqlerrm;
  end;
end $$;
rollback;
begin;
set local xafe.compte = 'dddddddd-0000-0000-0000-000000000001';
select admin_modifier_parametre('marche', '{"paire": "USDT/XAFe", "pas_prix": 0.05, "quantite_min": 10, "ouvert": true}'::jsonb) \gset ouv_
do $$
begin
  assert jsonb_array_length(admin_marche() -> 'chandelles') >= 1;
  assert (admin_marche() -> 'parametres' ->> 'ouvert')::boolean;
  raise notice '✓ 10.6 fermer le marché ferme vraiment le carnet ; le rouvrir le rouvre';
end $$;
commit;

-- ───────────────── 11 · ce que la revue adverse a trouvé ──────────────────
-- Chaque bloc rejoue une attaque ou une panne trouvée par la revue, et exige
-- qu'elle ne passe plus.

insert into comptes (id, telephone, nom, palier) values
  ('44444444-4444-4444-4444-444444444444', '670444444', 'Mallory', 1),
  ('55555555-5555-5555-5555-555555555555', '670555000', 'Eve', 1);
insert into numeros (compte_id, operateur, numero, verifie_le, actif_des) values
  ('44444444-4444-4444-4444-444444444444', 'mtn', '670444444', now() - interval '2 days', now() - interval '1 day'),
  ('55555555-5555-5555-5555-555555555555', 'mtn', '670555000', now() - interval '2 days', now() - interval '1 day');

-- 11.1 · les droits. anon n'exécute RIEN ; authenticated n'exécute que ce qui
-- lit auth.uid() (ou se garde par _exiger_droit), plus quatre lectures
-- publiques du marché. Aucune fonction de service ne lui est ouverte.
do $$
declare v text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v from pg_proc p
   where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute');
  assert v is null, 'anon exécute : ' || v;
  select string_agg(p.oid::regprocedure::text, ', ') into v from pg_proc p
   where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname !~ '^(carnet|transactions_recentes|cotation|chandelles)$'
     and p.prosrc !~ 'auth\.uid\(\)' and p.prosrc !~ '_exiger_droit';
  assert v is null, 'authenticated exécute sans lire la session : ' || v;
  select string_agg(p.oid::regprocedure::text, ', ') into v from pg_proc p
   where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')
     and (p.proname ~ '^(totem_|chaine_|_)' or p.proname in ('crediter_crypto', 'expirer_depots', 'circulation', 'parametre'));
  assert v is null, 'une fonction de service est ouverte aux clients : ' || v;
  assert not has_function_privilege('authenticated', 'demander_sortie(numeric, uuid, text)', 'execute'), 'la sortie sans code reste au moteur';
  select string_agg(c.relname, ', ') into v from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'insert')
          or has_table_privilege('authenticated', c.oid, 'update') or has_table_privilege('authenticated', c.oid, 'delete'));
  assert v is null, 'une table s''ouvre à anon ou s''écrit en direct : ' || v;
  select string_agg(c.relname, ', ') into v from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and has_table_privilege('authenticated', c.oid, 'select')
     and c.relname in ('codes_secrets', 'numeros_codes', 'terminaux', 'floats', 'entrees_retenues', 'commandes', 'messages_sortants',
                       'remboursements', 'journal_admin', 'adresses_libres', 'emissions');
  assert v is null, 'un client lit une table de service : ' || v;
  -- le témoin : une fonction née APRÈS les migrations n'est ouverte à personne (le robinet par défaut est coupé)
  create function _temoin_droits() returns int language sql as $f$ select 1 $f$;
  assert not has_function_privilege('authenticated', '_temoin_droits()', 'execute')
     and not has_function_privilege('anon', '_temoin_droits()', 'execute'), 'une fonction neuve naît ouverte : les droits par défaut ne sont pas coupés';
  drop function _temoin_droits();
  raise notice '✓ 11.1 anon n''exécute rien, un client n''exécute que ce qui lit sa session ; une fonction neuve naît fermée';
end $$;

begin;
set local role authenticated;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
begin
  begin perform crediter_crypto('22222222-2222-2222-2222-222222222222', 'USDT', 'bep20', 1000000, '0xvol', 'x'); raise exception 'aurait dû refuser';
  exception when insufficient_privilege then null; end;
  begin perform _mouvement('22222222-2222-2222-2222-222222222222', 'XAFe', 1000000, 0, 'vol', null, null); raise exception 'aurait dû refuser';
  exception when insufficient_privilege then null; end;
  begin perform chaine_resultat_retrait('XAFe-CR-000001', false, null); raise exception 'aurait dû refuser';
  exception when insufficient_privilege then null; end;
  begin perform * from totem_messages_en_attente('akwa-1'); raise exception 'aurait dû refuser';
  exception when insufficient_privilege then null; end;
  begin perform * from codes_secrets; raise exception 'aurait dû refuser';
  exception when insufficient_privilege then null; end;
  raise notice '✓ 11.1b un client ne frappe pas d''USDT, n''écrit pas un solde, ne joue ni la chaîne ni TOTEM, ne lit aucune empreinte';
end $$;
rollback;

-- 11.2 · pgcrypto vit dans « extensions » (comme chez Supabase) : les codes
-- ont été hachés et vérifiés plus haut, donc chaque appel est qualifié.
do $$
begin
  assert not exists (select 1 from pg_proc where proname = 'crypt' and pronamespace = 'public'::regnamespace), 'le harnais doit garder pgcrypto hors de public';
  assert exists (select 1 from codes_secrets where empreinte like '$2a$%'), 'les codes secrets sont des empreintes bcrypt';
  assert not exists (select 1 from information_schema.columns where table_schema = 'public' and column_name = 'code_hash'), 'plus aucune empreinte dans une table lisible';
  raise notice '✓ 11.2 pgcrypto hors de public, et aucune empreinte dans une table que le client lit';
end $$;

-- 11.3 · des transaction ID tapés d'avance ne prennent pas le paiement d'un autre.
-- a) Le payeur est le numéro vérifié d'Alice : la déclaration de Mallory est refusée, Alice reprend son SMS.
begin;
set local xafe.compte = '44444444-4444-4444-4444-444444444444';
select ouvrir_depot('mtn', 'k-mal-1') \gset m1_
select declarer_transaction((select reference from depots where cle = 'k-mal-1'), '20394900001') \gset m1d_
commit;
do $$
declare r jsonb; m uuid := '44444444-4444-4444-4444-444444444444';
begin
  r := totem_sms_recu('akwa-1', 101, 'mtn', '677000000', '677123456', 10000, '20394900001', '…', now());
  assert r ->> 'resultat' = 'retenue', r;
  assert coalesce(solde(m, 'XAFe', 'dispo'), 0) = 0, 'Mallory n''est pas créditée';
  assert (select etat from depot_declarations where compte_id = m and transaction_id = '20394900001') = 'refuse';
  assert (select montant from depot_declarations where compte_id = m and transaction_id = '20394900001') is null, 'le refus ne lui dit pas combien';
end $$;
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
select ouvrir_depot('mtn', 'k-al-11') \gset a11_
do $$
declare r jsonb; a uuid := '11111111-1111-1111-1111-111111111111'; avant numeric := solde(a, 'XAFe', 'dispo');
begin
  r := declarer_transaction((select reference from depots where cle = 'k-al-11'), '20394900001');
  assert r ->> 'etat' = 'credite' and solde(a, 'XAFe', 'dispo') = avant + 10000, r;
  raise notice '✓ 11.3a un ID tapé par un autre compte ne prend pas un paiement venu de mon numéro ; je le reprends en le tapant';
end $$;
commit;

-- b) Payeur inconnu, ID tapé vingt minutes AVANT le paiement : impossible pour celui qui a payé.
begin;
set local xafe.compte = '44444444-4444-4444-4444-444444444444';
select declarer_transaction((select reference from depots where cle = 'k-mal-1'), '20394900002') \gset m2d_
commit;
update depot_declarations set declare_le = now() - interval '20 minutes' where transaction_id = '20394900002';
do $$
declare r jsonb;
begin
  r := totem_sms_recu('akwa-1', 102, 'mtn', '677000000', '670999111', 20000, '20394900002', '…', now());
  assert r ->> 'resultat' = 'retenue' and r ->> 'motif' like '%tapé avant le paiement%', r;
end $$;
begin;
set local xafe.compte = '55555555-5555-5555-5555-555555555555';
select ouvrir_depot('mtn', 'k-eve-1') \gset e1_
do $$
declare r jsonb;
begin
  r := declarer_transaction((select reference from depots where cle = 'k-eve-1'), '20394900002');
  assert r ->> 'etat' = 'credite' and solde('55555555-5555-5555-5555-555555555555', 'XAFe', 'dispo') = 20000, r;
  raise notice '✓ 11.3b un ID tapé avant le paiement est refusé ; celui qui le tape après l''avoir reçu est crédité';
end $$;
commit;

-- c) Payeur inconnu, deux comptes en lice : on ne tire pas au sort, l'équipe tranche.
begin;
set local xafe.compte = '44444444-4444-4444-4444-444444444444';
select declarer_transaction((select reference from depots where cle = 'k-mal-1'), '20394900003') \gset m3d_
commit;
begin;
set local xafe.compte = '55555555-5555-5555-5555-555555555555';
select declarer_transaction((select reference from depots where cle = 'k-eve-1'), '20394900003') \gset e3d_
commit;
do $$
declare r jsonb;
begin
  r := totem_sms_recu('akwa-1', 103, 'mtn', '677000000', '670999222', 30000, '20394900003', '…', now() - interval '1 minute');
  assert r ->> 'resultat' = 'retenue' and r ->> 'motif' like 'plusieurs comptes%', r;
  assert (select count(*) from depot_declarations where transaction_id = '20394900003' and etat = 'refuse') = 2;
  assert (select bloquee from entrees_retenues where transaction_id = '20394900003'), 'l''équipe seule la dénoue';
end $$;
begin;
set local xafe.compte = '33333333-3333-3333-3333-333333333333';
select ouvrir_depot('mtn', 'k-ch-11') \gset c11_
do $$
declare r jsonb;
begin
  r := declarer_transaction((select reference from depots where cle = 'k-ch-11'), '20394900003');
  assert r ->> 'etat' = 'attendu', 'un troisième venu ne la prend pas non plus';
end $$;
commit;
begin;
set local xafe.compte = 'dddddddd-0000-0000-0000-000000000002';
do $$
declare r jsonb;
begin
  r := admin_rapprocher_retenue((select id from entrees_retenues where transaction_id = '20394900003'), (select reference from depots where cle = 'k-eve-1'));
  assert r ->> 'etat' = 'credite' and solde('55555555-5555-5555-5555-555555555555', 'XAFe', 'dispo') = 50000, r;
  assert (select etat from depot_declarations where transaction_id = '20394900003' and compte_id = '33333333-3333-3333-3333-333333333333') = 'refuse',
         'le troisième apprend que l''ID est pris';
  raise notice '✓ 11.3c deux comptes sur un même ID d''un payeur inconnu : personne n''est crédité au hasard, l''équipe rattache';
end $$;
commit;

-- d) Taper des ID au hasard ne coûte rien : cinq en attente au plus.
begin;
set local xafe.compte = '44444444-4444-4444-4444-444444444444';
do $$
declare ref text := (select reference from depots where cle = 'k-mal-1'); i int;
begin
  for i in 1 .. 5 loop perform declarer_transaction(ref, '2039495000' || i); end loop;
  begin
    perform declarer_transaction(ref, '20394950009');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'trop de transaction ID en attente', sqlerrm;
  end;
  raise notice '✓ 11.3d pas plus de cinq transaction ID en attente par compte';
end $$;
rollback;

-- 11.4 · un boîtier n'écrit que pour SES cartes : un SMS sur le float d'un
-- autre terminal (ici l'Orange de bonaberi-2, poussé par akwa-1) ne crédite rien.
begin;
set local xafe.compte = '55555555-5555-5555-5555-555555555555';
select ouvrir_depot('om', 'k-eve-om') \gset eom_
select declarer_transaction((select reference from depots where cle = 'k-eve-om'), 'MP261015.0900.E00004') \gset e4d_
commit;
do $$
declare r jsonb;
begin
  assert (select terminal from floats where numero = '699000001') = 'bonaberi-2', 'le décor : cette carte est à un autre boîtier';
  r := totem_sms_recu('akwa-1', 104, 'om', '699000001', '670555000', 4900000, 'MP261015.0900.E00004', '…', now());
  assert r ->> 'resultat' = 'retenue' and r ->> 'motif' like '%pas un float de ce terminal%', r;
  r := totem_sms_recu('akwa-1', 105, 'om', '690000000', '670555000', 4900000, 'MP261015.0900.E00004', '…', now());
  assert r ->> 'resultat' = 'retenue', 'un float inconnu ne crédite pas';
  assert solde('55555555-5555-5555-5555-555555555555', 'XAFe', 'dispo') = 50000, 'Eve n''a rien reçu de plus';
  assert (select etat from depot_declarations where transaction_id = 'MP2610150900E00004') = 'attendu';
  raise notice '✓ 11.4 un SMS hors des floats du terminal qui l''envoie est retenu, jamais crédité';
end $$;

-- 11.5 · les arrondis d'un achat limite au repos ne bouchent plus le carnet (et ne laissent pas un centime bloqué).
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
select placer_ordre('achat', 'limite', 10.22, 600.05, 'o-arr') \gset arr_
commit;
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare r jsonb;
begin
  assert (select bloque from ordres where cle = 'o-arr') = 6132.51;
  r := placer_ordre('vente', 'marche', 10.11, null, 'o-arr-v1');
  assert (select bloque from ordres where cle = 'o-arr') = 66.01, (select bloque from ordres where cle = 'o-arr');
  r := placer_ordre('vente', 'marche', 10, null, 'o-arr-v2');
  assert (r -> 'ordre' ->> 'executee')::numeric = 0.11, r;
  assert (select etat from ordres where cle = 'o-arr') = 'execute' and (select bloque from ordres where cle = 'o-arr') = 0;
  assert solde('22222222-2222-2222-2222-222222222222', 'XAFe', 'bloque') = 0, 'pas un centime ne reste bloqué';
end $$;
commit;
-- le preneur limite payé sous sa limite : 10,05 à 600,10 contre une vente à 600,05
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
select placer_ordre('vente', 'limite', 10.05, 600.05, 'o-arr2-v') \gset arr2_
commit;
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
declare r jsonb;
begin
  r := placer_ordre('achat', 'limite', 10.05, 600.10, 'o-arr2-a');
  assert r -> 'ordre' ->> 'etat' = 'execute' and (r -> 'ordre' ->> 'bloque')::numeric = 0, r;
  assert solde('22222222-2222-2222-2222-222222222222', 'XAFe', 'bloque') = 0, 'le centime de trop revient';
  assert total('XAFe') = circulation(), format('XAFe : %s en soldes, %s en circulation', total('XAFe'), circulation());
  raise notice '✓ 11.5 un achat limite se règle au centime : ni carnet bouché, ni centime bloqué, ni XAFe créé';
end $$;
commit;

-- 11.6 · un compte désactivé ne fait plus aucun geste d'argent ; réactivé, il les retrouve.
begin;
set local xafe.compte = 'dddddddd-0000-0000-0000-000000000001';
select admin_desactiver_compte('33333333-3333-3333-3333-333333333333', false, 'enquête') \gset des_
commit;
begin;
set local xafe.compte = '33333333-3333-3333-3333-333333333333';
do $$
declare v text; f text;
begin
  foreach f in array array['ouvrir_depot(''mtn'')', 'placer_ordre(''achat'', ''limite'', 10, 600.00)',
                           'demander_sortie(1000, ''cccccccc-0000-0000-0000-000000000001'', null, ''9876'')',
                           'ajouter_numero(''mtn'', ''677888777'')', 'declarer_transaction((select reference from depots where cle = ''k-ch-11''), ''20394900099'')'] loop
    begin
      execute 'select ' || f;
      raise exception 'aurait dû refuser : %', f;
    exception when others then
      assert sqlerrm = 'compte désactivé', f || ' → ' || sqlerrm;
    end;
  end loop;
  assert mes_soldes() is not null, 'il lit encore ses soldes';
  raise notice '✓ 11.6 un compte désactivé ne dépose, ne déclare, ne négocie, ne sort ni n''ajoute de numéro';
end $$;
rollback;
begin;
set local xafe.compte = 'dddddddd-0000-0000-0000-000000000001';
select admin_desactiver_compte('33333333-3333-3333-3333-333333333333', true) \gset rea_
commit;

-- 11.7 · le code secret ne se remplace pas sans l'ancien ; un numéro ne se réserve pas sans preuve.
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
declare r jsonb;
begin
  begin
    perform completer_profil('Bob', '0000');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'code secret déjà choisi', sqlerrm;
  end;
  assert (verifier_code_secret('1357') ->> 'ok')::boolean, 'l''ancien code tient toujours';
  begin
    perform ajouter_numero('om', '677111222');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'numéro invalide', '677 n''est pas Orange : ' || sqlerrm;
  end;
  begin
    perform ajouter_numero('mtn', '677123456');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'ce numéro est déjà sur un autre compte', sqlerrm;
  end;
  r := ajouter_numero('mtn', '677666555');
  assert r ->> 'verifie_le' is null, r;
end $$;
commit;
begin;
set local xafe.compte = '55555555-5555-5555-5555-555555555555';
do $$
declare r jsonb;
begin
  r := ajouter_numero('mtn', '677666555');
  assert r ->> 'numero' = '677666555', 'un numéro seulement AJOUTÉ par un autre ne retient rien';
  begin
    perform renvoyer_code_numero((r ->> 'id')::uuid);
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'un code vient de partir', sqlerrm;
  end;
  raise notice '✓ 11.7 le premier code ne se rechoisit pas ; un numéro non prouvé ne bloque personne ; les codes ont leur cadence';
end $$;
rollback;

-- 11.8 · le déclencheur de naissance : un administrateur par e-mail n'est pas un client, et rien ne fait échouer une inscription.
do $$
begin
  insert into auth.users (id, email) values ('eeeeeeee-0000-0000-0000-000000000001', 'a@xafe.exchange'), ('eeeeeeee-0000-0000-0000-000000000002', 'b@xafe.exchange');
  assert not exists (select 1 from comptes where id::text like 'eeeeeeee-%'), 'pas de compte client pour un administrateur';
  -- le code est DEMANDÉ : GoTrue crée l'utilisateur, le téléphone n'est pas encore prouvé
  insert into auth.users (id, phone) values ('eeeeeeee-0000-0000-0000-000000000003', '+237677333444');
  assert not exists (select 1 from comptes where id = 'eeeeeeee-0000-0000-0000-000000000003'), 'pas de compte sur une simple demande de code';
  -- le bon code revient : GoTrue pose phone_confirmed_at
  update auth.users set phone_confirmed_at = now() where id = 'eeeeeeee-0000-0000-0000-000000000003';
  assert (select telephone from comptes where id = 'eeeeeeee-0000-0000-0000-000000000003') = '677333444';
  assert (select verifie_le from numeros where compte_id = 'eeeeeeee-0000-0000-0000-000000000003') is not null, 'le téléphone de connexion est son premier numéro';
  -- l'utilisateur est supprimé de l'auth (sa ligne « comptes » reste : pas de clé étrangère), puis se réinscrit
  delete from auth.users where id = 'eeeeeeee-0000-0000-0000-000000000003';
  insert into auth.users (id, phone, phone_confirmed_at) values ('eeeeeeee-0000-0000-0000-000000000004', '+237677333444', now());
  assert not exists (select 1 from comptes where id = 'eeeeeeee-0000-0000-0000-000000000004'), 'le téléphone garde son compte : pas un second';
  raise notice '✓ 11.8 un compte naît quand le téléphone est prouvé, pas quand le code est demandé ; deux administrateurs par e-mail, un téléphone qui se réinscrit : aucune inscription ne tombe';
end $$;

-- 11.9 · un remboursement : jamais d'un SMS déjà crédité, relançable après un échec, un résultat rejoué ne compte pas.
begin;
set local xafe.compte = 'dddddddd-0000-0000-0000-000000000001';
do $$
declare r jsonb; v_id bigint; v_rbt bigint; v_rbt2 bigint;
begin
  r := totem_sms_recu('akwa-1', 120, 'mtn', '677000000', '670999333', 15000, '20394900120', '…', now());
  v_id := (r ->> 'id')::bigint;
  perform admin_rembourser_retenue(v_id, 'payé par erreur');
  select id into v_rbt from remboursements where retenue_id = v_id;
  assert (totem_resultat_remboursement(v_rbt, 'akwa-1', false, 'x') ->> 'deja')::boolean, 'pas réclamé : un résultat ne compte pas';
  perform totem_reclamer_remboursement(v_rbt, 'akwa-1');
  r := totem_resultat_remboursement(v_rbt, 'akwa-1', false, 'réseau muet');
  assert (select etat from entrees_retenues where id = v_id) = 'retenue', 'échoué : l''entrée revient';
  r := admin_rembourser_retenue(v_id, 'deuxième essai');
  select id into v_rbt2 from remboursements where retenue_id = v_id and etat = 'en_attente';
  assert v_rbt2 is not null and v_rbt2 <> v_rbt, 'un second essai a sa propre clé';
  begin
    perform admin_rembourser_retenue((select id from entrees_retenues where transaction_id = '20394817102'), 'x');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm like 'cette entrée n''est plus retenue%' or sqlerrm = 'ce paiement a déjà été crédité', sqlerrm;
  end;
  raise notice '✓ 11.9 un remboursement se relance après un échec, un résultat non réclamé ne compte pas';
end $$;
commit;

-- 11.10 · un « échouée » renvoyé faute d'accusé ne compte pas comme un second échec.
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
select demander_sortie(10000, 'aaaaaaaa-0000-0000-0000-000000000001', 'k-s-11', '1234') \gset s11_
commit;
do $$
declare c commandes; r jsonb; v_id bigint := (select k.id from commandes k join sorties s on s.id = k.sortie_id where s.cle = 'k-s-11');
begin
  c := totem_reclamer_commande(v_id, 'akwa-1');
  r := totem_resultat_commande(v_id, 'akwa-1', false, 'réseau muet', null, 0);
  assert (r ->> 'reprises')::int = 1, r;
  r := totem_resultat_commande(v_id, 'akwa-1', false, 'réseau muet', null, 0);
  assert (r ->> 'deja')::boolean, 'le même échec renvoyé est un doublon';
  c := totem_reclamer_commande(v_id, 'akwa-1');
  r := totem_resultat_commande(v_id, 'akwa-1', false, 'en retard', null, 0);
  assert (r ->> 'deja')::boolean and (select reprises from commandes where id = v_id) = 1, 'un échec de la tentative 0 ne compte pas pendant la tentative 1';
  r := totem_resultat_commande(v_id, 'akwa-1', true, 'Transfert reussi', 'MP-11', 1);
  assert r ->> 'sortie' = 'envoyee', r;
  raise notice '✓ 11.10 un résultat vaut pour SA tentative : rejoué ou en retard, il ne rend pas les XAFe d''un transfert parti';
end $$;

-- 11.11 · un paramètre mal formé est refusé avant d'être écrit.
begin;
set local xafe.compte = 'dddddddd-0000-0000-0000-000000000001';
do $$
declare v jsonb;
begin
  foreach v in array array['{"placeur": 0.0005, "preneur": "0.001", "sortie": 0.005}'::jsonb, '{"placeur": 0.0005, "preneur": 0.001, "sortie": 0.5}'::jsonb, '{"placeur": 0.0005}'::jsonb] loop
    begin
      perform admin_modifier_parametre('frais', v);
      raise exception 'aurait dû refuser : %', v;
    exception when others then
      assert sqlerrm = 'paramètre invalide', sqlerrm;
    end;
  end loop;
  begin
    perform admin_modifier_parametre('paliers', '{"0": {"entree_jour": 500000}, "1": null, "2": null}');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'paramètre invalide', sqlerrm;
  end;
  assert (parametre('frais') ->> 'sortie')::numeric = 0.005, 'rien n''a été écrit';
  raise notice '✓ 11.11 des frais en texte, à 50 %%, ou un palier incomplet sont refusés avant d''arrêter le moteur';
end $$;
rollback;

-- 11.12 · le plafond du palier compte aussi la chaîne, et des XAFe partis sur la chaîne restent comptés.
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
declare r jsonb;
begin
  begin
    perform demander_retrait_crypto('USDT', 'bep20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 1000, null, '1357');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'plafond du palier atteint', 'Bob (palier 0) ne sort pas 600 000 XAF par la chaîne : ' || sqlerrm;
  end;
  r := demander_retrait_crypto('XAFe', 'bep20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 20000, 'k-cr-x', '1357');
  r := chaine_resultat_retrait(r ->> 'reference', true, '0xtx-x');
  assert total('XAFe') = circulation() and circulation_chaine() = 20000, format('soldes %s, circulation %s, chaîne %s', total('XAFe'), circulation(), circulation_chaine());
  raise notice '✓ 11.12 un retrait crypto compte dans le plafond ; des XAFe partis sur la chaîne restent dus et comptés';
end $$;
commit;

-- 11.13 · une pièce de vérification est un fichier du dossier du compte, pas celui d'un autre.
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
begin
  begin
    perform demander_verification('identite', '["33333333-3333-3333-3333-333333333333/entreprise/rccm.jpg"]');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'pièce invalide', sqlerrm;
  end;
  raise notice '✓ 11.13 on ne joint pas les papiers d''un autre client';
end $$;
rollback;

-- 11.14 · une sortie ne se cloue pas à un boîtier muet.
update terminaux set vu_le = now() - interval '1 hour' where id = 'akwa-1';
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare avant numeric := solde('11111111-1111-1111-1111-111111111111', 'XAFe', 'dispo');
begin
  begin
    perform demander_sortie(10000, 'aaaaaaaa-0000-0000-0000-000000000001', null, '1234');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'aucun boîtier en ligne pour cet opérateur', sqlerrm;
  end;
  assert solde('11111111-1111-1111-1111-111111111111', 'XAFe', 'dispo') = avant, 'rien n''est bloqué';
  raise notice '✓ 11.14 sans boîtier en ligne, une sortie est refusée au lieu de bloquer les XAFe';
end $$;
rollback;
update terminaux set vu_le = now() where id = 'akwa-1';

-- 11.17 · un boîtier réinstallé repart à la ligne 1 : ses SMS neufs ne passent pas pour « déjà vus ».
do $$
declare r jsonb;
begin
  r := totem_sms_recu('akwa-1', 1, 'mtn', '677000000', '670999170', 61000, '20394917001', 'Vous avez recu 61000 FCFA… (après réinstallation)', now());
  assert not coalesce((r ->> 'deja')::boolean, false), 'un SMS neuf sur une ligne déjà vue est traité : ' || r;
  assert (r ->> 'source_id_reutilise')::boolean, 'et la réponse dit que le numéro de ligne a resservi';
  r := totem_sms_recu('akwa-1', 1, 'mtn', '677000000', '670999170', 61000, '20394917001', 'Vous avez recu 61000 FCFA… (après réinstallation)', now());
  assert (r ->> 'deja')::boolean, 'le même SMS relu reste reconnu';
  raise notice '✓ 11.17 un boîtier réinstallé : ses SMS neufs sont traités, un SMS relu reste reconnu';
end $$;

-- 11.18 · un transaction ID mal recopié se retire ; un ID crédité, jamais.
begin;
set local xafe.compte = '55555555-5555-5555-5555-555555555555';
do $$
declare r jsonb; ref text := (select reference from depots where cle = 'k-eve-1');
begin
  perform declarer_transaction(ref, '20399999918');
  r := retirer_declaration(ref, '2039 9999 918');
  assert not exists (select 1 from depot_declarations where transaction_id = '20399999918'), 'l''ID mal recopié est parti';
  begin
    perform retirer_declaration(ref, '20394900002');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'cette déclaration ne se retire plus', sqlerrm;
  end;
  raise notice '✓ 11.18 un transaction ID qui attend se retire ; un ID crédité ne se retire jamais';
end $$;
rollback;

-- 11.19 · une sortie clouée à un boîtier muet : l'équipe la réaffecte, ou l'annule et les XAFe reviennent.
insert into terminaux (id, nom, vu_le) values ('secours-3', 'Secours 3', now());
insert into floats (operateur, numero, terminal) values ('mtn', '677000333', 'secours-3');
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
select declarer_transaction((select reference from depots where cle = 'k-dep-1'), '20390000190') \gset d19_
commit;
select totem_sms_recu('akwa-1', 190, 'mtn', '677000000', '677123456', 2000000, '20390000190', 'Vous avez recu 2,000,000 FCFA (19)', now()) \gset sms19_
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
select demander_sortie(1500000, 'aaaaaaaa-0000-0000-0000-000000000001', 'k-s-19', '1234') \gset s19_
commit;
begin;
set local xafe.compte = 'dddddddd-0000-0000-0000-000000000002';
do $$
declare r jsonb; a uuid := '11111111-1111-1111-1111-111111111111'; v_s sorties := (select s from sorties s where cle = 'k-s-19');
        k1 bigint; k2 bigint; dispo numeric := solde(a, 'XAFe', 'dispo');
begin
  select min(id), max(id) into k1, k2 from commandes where sortie_id = v_s.id;
  r := admin_reaffecter_commande(k1, 'secours-3');
  assert (select terminal from commandes where id = k1) = 'secours-3' and (select parametres ->> 'float_numero' from commandes where id = k1) = '677000333', r;
  begin perform admin_reaffecter_commande(k1, 'bonaberi-2'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'ce terminal ne porte aucune carte de cet opérateur', sqlerrm; end;
  perform totem_reclamer_commande(k1, 'secours-3');
  begin perform admin_annuler_sortie(v_s.reference, 'boîtier en panne'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'un transfert est en cours de composition', sqlerrm; end;
  perform totem_resultat_commande(k1, 'secours-3', true, 'Transfert reussi', 'MP-19', 0);
  r := admin_annuler_sortie(v_s.reference, 'boîtier en panne');
  assert (r ->> 'rendu')::numeric = (select montant_xafe from commandes where id = k2) and r ->> 'etat' = 'partielle', r;
  assert solde(a, 'XAFe', 'dispo') = dispo + (r ->> 'rendu')::numeric, 'les XAFe du transfert annulé sont revenus';
  assert total('XAFe') = circulation(), 'rien n''est créé ni perdu';
  raise notice '✓ 11.19 une sortie clouée à un boîtier muet se réaffecte, ou s''annule et ses XAFe reviennent — jamais un transfert réclamé';
end $$;
commit;

-- 11.20 · le détail d'une opération ancienne se lit encore (au-delà des 200 dernières lignes).
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
declare plus_vieille text := (select reference from depots where compte_id = '22222222-2222-2222-2222-222222222222' and etat = 'credite' order by cree_le limit 1);
begin
  assert (mon_operation(plus_vieille) -> 'detail' ->> 'reference') = plus_vieille, mon_operation(plus_vieille);
  assert jsonb_array_length(mon_historique(1)) = 1, 'la liste se borne';
  assert mon_operation((select reference from depots where compte_id = '11111111-1111-1111-1111-111111111111' limit 1)) is null, 'jamais l''opération d''un autre';
  raise notice '✓ 11.20 le détail d''une opération se lit par sa référence, quel que soit son âge, et jamais celle d''un autre';
end $$;
rollback;

-- 11.21 · les pièces d'un compte ancien attendent l'équipe : elle les trouve ; le journal ne garde pas le numéro du payeur.
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
select demander_verification('identite', '["22222222-2222-2222-2222-222222222222/identite/cni.jpg"]'::jsonb) \gset v21_
set local xafe.compte = 'dddddddd-0000-0000-0000-000000000001';
do $$
declare r jsonb;
begin
  insert into comptes (telephone, nom) select '6779' || lpad(g::text, 5, '0'), 'Récent ' || g from generate_series(1, 30) g;
  r := admin_clients(null, 5, 'verifications');
  assert exists (select 1 from jsonb_array_elements(r) c where c ->> 'id' = '22222222-2222-2222-2222-222222222222'), 'le compte ancien qui attend est trouvé : ' || r;
  assert not exists (select 1 from journal_admin where action = 'rembourser_retenue' and detail ? 'numero'), 'aucun numéro de payeur au journal';
  raise notice '✓ 11.21 les vérifications se cherchent dans tous les comptes ; le journal ne garde que des références';
end $$;
rollback;

-- 11.22 · le dossier redit si son numéro reçoit encore : boîtier muet, float retiré.
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
select ouvrir_depot('mtn', 'k-22') ->> 'reference' as d22 \gset
create temp table s22 on commit drop as select d.reference, f.id as float_id, f.numero, f.terminal
  from depots d join floats f on f.id = d.float_id where d.reference = :'d22';
do $$
declare v s22 := (select s from s22 s);
begin
  assert mon_depot(v.reference) ->> 'reception' = 'ouverte', 'un boîtier qui parle : on paie';
  update terminaux set vu_le = now() - interval '1 hour' where id = v.terminal;
  assert mon_depot(v.reference) ->> 'reception' = 'retardee', 'le boîtier se tait : le dossier le dit';
end $$;
set local xafe.compte = 'dddddddd-0000-0000-0000-000000000001';
do $$
declare v s22 := (select s from s22 s);
begin
  assert (select (x ->> 'dossiers_ouverts')::int from jsonb_array_elements(admin_terminaux()) t, jsonb_array_elements(t -> 'floats') x
           where (x ->> 'id')::int = v.float_id) >= 1, 'l''équipe voit que des dossiers ouverts donnent ce numéro à payer';
  perform admin_activer_float(v.float_id, false);
end $$;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
declare v s22 := (select s from s22 s); r jsonb;
begin
  assert mon_depot(v.reference) ->> 'reception' = 'fermee', 'le float est retiré : le dossier dit de ne plus payer';
  assert (select x ->> 'reception' from jsonb_array_elements(mes_depots_en_attente()) x where x ->> 'reference' = v.reference) = 'fermee',
         'la liste des dépôts en cours le dit aussi';
  -- un paiement fait AVANT le retrait reste traité : retirer un float ne perd l'argent de personne
  perform declarer_transaction(v.reference, '20390000222');
  r := totem_sms_recu(v.terminal, 222, 'mtn', v.numero, '670999222', 5000, '20390000222', 'Vous avez recu 5000 FCFA (22)', now());
  assert r ->> 'resultat' = 'credite', 'le SMS d''un float retiré crédite encore : ' || r;
  raise notice '✓ 11.22 un dossier redit si son numéro reçoit : boîtier muet « retardée », float retiré « fermée » (l''équipe voit les dossiers touchés) — un paiement déjà fait reste crédité';
end $$;
rollback;

-- 11.16 · l'écran lit les paramètres que l'équipe a posés, pas une copie figée.
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
declare r jsonb := parametres_publics();
begin
  assert (r -> 'frais' ->> 'sortie')::numeric = (parametre('frais') ->> 'sortie')::numeric, r;
  assert (r -> 'crypto' ->> 'retraits_ouverts')::boolean, 'ouverts plus haut dans ces scénarios';
  assert jsonb_array_length(r -> 'operateurs') = 2 and (r -> 'operateurs' -> 0 ->> 'plafond_par_transfert')::numeric = 1000000, r;
  assert not (r ? 'code_secret') and not (r ? 'depot'), 'rien d''autre que ce que l''écran montre';
end $$;
rollback;
do $$
begin
  assert parametres_publics() is null, 'sans session, rien';
  raise notice '✓ 11.16 l''écran lit les frais, plafonds et pas que l''équipe a posés';
end $$;

do $$
begin
  assert total('XAFe') = circulation(), format('XAFe : %s en soldes, %s en circulation', total('XAFe'), circulation());
  assert not exists (select 1 from ordres where bloque < 0) and not exists (select 1 from soldes where bloque < 0 or disponible < 0);
  raise notice '✓ 11.15 à la fin, la somme des soldes vaut toujours la circulation';
end $$;
