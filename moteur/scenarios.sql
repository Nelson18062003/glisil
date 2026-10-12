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
insert into numeros (id, compte_id, operateur, numero, actif_des) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'mtn', '677123456', now() - interval '1 day'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'om',  '699123456', now() - interval '1 day'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'mtn', '655000000', now() + interval '1 day'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'mtn', '677999999', now() - interval '1 day'),
  ('cccccccc-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'mtn', '655111111', now() - interval '1 day');

create function solde(p_compte uuid, p_actif text, p_quoi text) returns numeric language sql as $$
  select case p_quoi when 'dispo' then disponible else bloque end from soldes where compte_id = p_compte and actif = p_actif
$$;
create function total(p_actif text) returns numeric language sql as $$
  select coalesce(sum(disponible + bloque), 0) from soldes where actif = p_actif
$$;

-- ─────────────────────────── 1 · un dépôt en trois SMS ─────────────────────
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare r jsonb;
begin
  r := creer_depot('mtn', 3000000, '677123456', 'k-dep-1');
  assert r ->> 'etat' = 'en_attente', r;
  assert (r ->> 'transferts')::int = 3, r;
  assert r ->> 'float_numero' = '677000000', r;
  assert (creer_depot('mtn', 3000000, '677123456', 'k-dep-1') ->> 'reference') = (r ->> 'reference'), 'la même clé rend le même dépôt';
  raise notice '✓ 1.1 un dépôt de 3 000 000 par MTN demande trois transferts, et une clé rejouée ne crée rien';
end $$;
commit;

do $$
declare r jsonb; a uuid := '11111111-1111-1111-1111-111111111111';
begin
  r := totem_sms_recu('akwa-1', 1, 'mtn', '677000000', '677123456', 1000000, 'REF-1', 'Vous avez recu 1,000,000 FCFA de ALICE (677123456)', now());
  assert r ->> 'resultat' = 'credite' and r ->> 'etat' = 'partiel', r;
  assert solde(a, 'XAFe', 'dispo') = 1000000, 'premier SMS : 1 000 000 crédités tout de suite';
  r := totem_sms_recu('akwa-1', 2, 'mtn', '677000000', '677123456', 1000000, 'REF-2', '…', now());
  assert solde(a, 'XAFe', 'dispo') = 2000000, 'deuxième SMS : 2 000 000';
  r := totem_sms_recu('akwa-1', 2, 'mtn', '677000000', '677123456', 1000000, 'REF-2', '…', now());
  assert (r ->> 'deja')::boolean, 'le même SMS relu rend « déjà »';
  assert solde(a, 'XAFe', 'dispo') = 2000000, 'le même SMS relu ne crédite pas deux fois';
  r := totem_sms_recu('akwa-1', 3, 'mtn', '677000000', '677123456', 1000000, 'REF-3', '…', now());
  assert r ->> 'etat' = 'credite', r;
  assert solde(a, 'XAFe', 'dispo') = 3000000, 'troisième SMS : le dépôt est complet';
  assert circulation() = 3000000, 'trois millions de XAFe émis';
  r := totem_sms_recu('akwa-1', 4, 'mtn', '677000000', '688000000', 250000, 'REF-4', '…', now());
  assert r ->> 'resultat' = 'retenue', r;
  assert (select count(*) from entrees_retenues where etat = 'retenue') = 1, 'un SMS sans référence est retenu';
  assert total('XAFe') = 3000000, 'rien n''est crédité au hasard';
  raise notice '✓ 1.2 trois SMS créditent au fur et à mesure, un SMS relu ne compte pas deux fois, un SMS étranger est retenu';
end $$;

-- ──────────────────────── 2 · annulation et expiration ─────────────────────
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
declare r jsonb;
begin
  r := creer_depot('mtn', 400000, '677999999');
  r := annuler_depot(r ->> 'reference');
  assert r ->> 'etat' = 'annule', r;
end $$;
commit;
do $$
declare r jsonb; b uuid := '22222222-2222-2222-2222-222222222222';
begin
  r := totem_sms_recu('akwa-1', 5, 'mtn', '677000000', '677999999', 400000, 'REF-5', '…', now());
  assert r ->> 'resultat' = 'retenue', 'un dépôt annulé ne se crédite plus';
  assert coalesce(solde(b, 'XAFe', 'dispo'), 0) = 0;
  raise notice '✓ 2.1 un dépôt annulé ne se crédite plus : le SMS est retenu';
end $$;

begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
select creer_depot('mtn', 200000, '677999999', 'k-dep-exp') \gset dep_
update depots set etat = 'expire', expire_le = now() - interval '30 minutes' where cle = 'k-dep-exp';
select creer_depot('mtn', 100000, '677999999', 'k-dep-mort') \gset dep2_
update depots set etat = 'expire', expire_le = now() - interval '3 hours' where cle = 'k-dep-mort';
commit;
do $$
declare r jsonb; b uuid := '22222222-2222-2222-2222-222222222222';
begin
  r := totem_sms_recu('akwa-1', 6, 'mtn', '677000000', '677999999', 200000, 'REF-6', '…', now());
  assert r ->> 'resultat' = 'credite', 'expiré depuis 30 min : encore dans la grâce, crédité';
  assert solde(b, 'XAFe', 'dispo') = 200000;
  r := totem_sms_recu('akwa-1', 7, 'mtn', '677000000', '677999999', 100000, 'REF-7', '…', now());
  assert r ->> 'resultat' = 'retenue', 'expiré depuis 3 h : hors grâce, retenu';
  assert solde(b, 'XAFe', 'dispo') = 200000;
  raise notice '✓ 2.2 un dépôt expiré depuis peu est encore crédité, un dépôt trop vieux est retenu';
end $$;

-- ─────────────────────────── 3 · le palier 0 ───────────────────────────────
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
begin
  begin
    perform creer_depot('mtn', 600000, '677999999');
    raise exception 'le palier 0 aurait dû refuser';
  exception when others then
    assert sqlerrm like 'plafond du palier%', sqlerrm;
  end;
  raise notice '✓ 3.1 le palier 0 refuse un dépôt au-delà de 500 000 par jour';
end $$;
rollback;

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
  perform totem_sms_recu('akwa-1', 8, 'mtn', '677000000', '655111111', 50000, 'REF-8', '…', now());
end $$;
begin;
set local xafe.compte = '33333333-3333-3333-3333-333333333333';
select creer_depot('mtn', 50000, '655111111', 'k-dep-c') \gset c_
commit;
do $$
declare r jsonb; c uuid := '33333333-3333-3333-3333-333333333333';
begin
  r := totem_sms_recu('akwa-1', 9, 'mtn', '677000000', '655111111', 50000, 'REF-9', '…', now());
  assert r ->> 'resultat' = 'credite' and solde(c, 'XAFe', 'dispo') = 50000, r;
end $$;
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
  r := demander_sortie(1500000, 'aaaaaaaa-0000-0000-0000-000000000001', 'k-s1');
  assert (r ->> 'transferts')::int = 2, r;
  assert (r ->> 'frais')::numeric = 7500 and (r ->> 'montant_xaf')::numeric = 1492500, r;
  assert solde(a, 'XAFe', 'dispo') = avant - 1500000 and solde(a, 'XAFe', 'bloque') = 1500000, 'les XAFe sont bloqués';
  assert (demander_sortie(1500000, 'aaaaaaaa-0000-0000-0000-000000000001', 'k-s1') ->> 'reference') = (r ->> 'reference'), 'la même clé rend la même sortie';
  assert (select count(*) from commandes) = 2, 'toujours deux transferts';
  begin
    perform demander_sortie(1000, 'aaaaaaaa-0000-0000-0000-000000000003');
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
  raise notice '✓ 8.1 un client lit ses lignes, ne peut ni écrire un solde ni jouer TOTEM';
end $$;
rollback;
