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

create function solde(p_compte uuid, p_actif text, p_quoi text) returns numeric language sql set search_path = public as $$
  select case p_quoi when 'dispo' then disponible else bloque end from soldes where compte_id = p_compte and actif = p_actif
$$;
create function total(p_actif text) returns numeric language sql set search_path = public as $$
  select coalesce(sum(disponible + bloque), 0) from soldes where actif = p_actif
$$;
-- 0035 : une personne prête à ouvrir son compte (ou à entrer dans l'administration) a un mot
-- de passe posé et des codes de secours notés. Le mot de passe d'essai est un vrai bcrypt « $2a$ »,
-- comme ceux de GoTrue (coût 4 : le harnais n'a pas à attendre).
create function _essai_pret(p_id uuid, p_mdp boolean default true) returns void language sql set search_path = public, extensions, pg_temp as $$
  update auth.users set encrypted_password = case when p_mdp then extensions.crypt('Mot-de-passe-2026', extensions.gen_salt('bf', 4)) else '' end
   where id = p_id;
  insert into lots_de_secours (utilisateur_id, confirme_le) values (p_id, now())
  on conflict (utilisateur_id) do update set confirme_le = now();
$$;
create function _essai_utilisateur(p_id uuid, p_email text, p_mdp boolean default true) returns void language sql set search_path = public as $$
  insert into auth.users (id, email, email_confirmed_at) values (p_id, p_email, now()) on conflict (id) do nothing;
  select _essai_pret(p_id, p_mdp);
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
-- Par défaut, aucun plafond par transfert (0031). Ici l'équipe en pose un sur
-- MTN, pour éprouver le découpage qu'il commande.
begin;
update operateurs set plafond_par_transfert = 1000000 where id = 'mtn';
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare r jsonb; a uuid := '11111111-1111-1111-1111-111111111111'; avant numeric := solde(a, 'XAFe', 'dispo');
begin
  -- (0036) le code secret est parti : la vérification avant sortie a ses propres scénarios (11.60+)
  update comptes set nom = 'Alice Ngo' where id = a;
  r := _demander_sortie(1500000, 'aaaaaaaa-0000-0000-0000-000000000001', 'k-s1');
  assert (r ->> 'transferts')::int = 2, r;
  assert (r ->> 'frais')::numeric = 7500 and (r ->> 'montant_xaf')::numeric = 1492500, r;
  assert solde(a, 'XAFe', 'dispo') = avant - 1500000 and solde(a, 'XAFe', 'bloque') = 1500000, 'les XAFe sont bloqués';
  assert (_demander_sortie(1500000, 'aaaaaaaa-0000-0000-0000-000000000001', 'k-s1') ->> 'reference') = (r ->> 'reference'), 'la même clé rend la même sortie';
  assert jsonb_array_length(ma_sortie(r ->> 'reference') -> 'transferts') = 2, ma_sortie(r ->> 'reference');
  assert (select count(*) from commandes) = 2, 'toujours deux transferts';
  begin
    perform _demander_sortie(1000, 'aaaaaaaa-0000-0000-0000-000000000003', null);
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
  -- (0036) le code secret à 4 chiffres n'existe plus : ses fonctions sont parties, sans reste
  assert to_regprocedure('public.verifier_code_secret(text)') is null and to_regprocedure('public.completer_profil(text,text)') is null
     and to_regprocedure('public._controler_code(uuid,text)') is null, 'le code secret a des restes';
  update comptes set nom = 'Bob Essomba' where id = b;
  raise notice '✓ 9.1 le code secret à 4 chiffres est parti : la vérification avant sortie le remplace (11.60+)';
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
  assert (select texte like 'Glisil : %' from messages_sortants where numero = '699112233'), 'le SMS du code se signe Glisil';
  assert (select nom from comptes where maison) = 'Glisil', 'le compte de la maison s''appelle Glisil';
  begin
    perform _demander_sortie(1000, v_id, null);
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
    perform _demander_sortie(1000, v_id, null);
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
  r := _retirer_numero(auth.uid(),v_id); assert (r ->> 'ok')::boolean, r;
  assert jsonb_array_length(mes_numeros()) = 1;
  begin
    perform _retirer_numero(auth.uid(),'bbbbbbbb-0000-0000-0000-000000000001');
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
    perform _demander_retrait_crypto('USDT', 'bep20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 100, 'k-cr-0');
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'retraits crypto pas encore ouverts', sqlerrm;
  end;
  assert solde(b, 'USDT', 'bloque') = 0, 'fermés : rien ne se bloque sans issue';
  update parametres set valeur = valeur || '{"retraits_ouverts": true}' where cle = 'crypto';
  r := _demander_retrait_crypto('USDT', 'bep20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 100, 'k-cr-1');
  assert r ->> 'etat' = 'en_attente' and (r ->> 'frais')::numeric = 1, r;
  assert solde(b, 'USDT', 'dispo') = usdt_avant - 101 and solde(b, 'USDT', 'bloque') = 101, 'montant et frais bloqués';
  assert (_demander_retrait_crypto('USDT', 'bep20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 100, 'k-cr-1') ->> 'reference') = (r ->> 'reference'), 'la même clé rend le même retrait';
  begin
    perform _demander_retrait_crypto('USDT', 'trc20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 100, null);
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'adresse invalide', sqlerrm;
  end;
  r := chaine_resultat_retrait(r ->> 'reference', true, '0xtx-1');
  assert r ->> 'etat' = 'envoye' and solde(b, 'USDT', 'bloque') = 0 and solde(b, 'USDT', 'dispo') = usdt_avant - 101, r;
  assert solde(compte_maison(), 'USDT', 'dispo') >= 1, 'les frais vont à la maison';
  r := _demander_retrait_crypto('USDT', 'bep20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 50, 'k-cr-2');
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
update comptes set nom = 'Chantal Mbarga' where id = '33333333-3333-3333-3333-333333333333';
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

-- 11.1 · les droits. anon n'exécute RIEN (sauf la preuve de réserve, publique
-- à dessein) ; authenticated n'exécute que ce qui
-- lit auth.uid() (ou se garde par _exiger_droit), plus quatre lectures
-- publiques du marché. Aucune fonction de service ne lui est ouverte.
do $$
declare v text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v from pg_proc p
   where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')
     -- la seule exception, voulue : la preuve de réserve se lit sans compte (0016) — des totaux, aucun nom
     and p.oid <> 'preuve_de_reserve()'::regprocedure
     -- et le crochet de PostgREST (0035), que PostgREST appelle avant CHAQUE requête, anon compris : il ne lit rien
     and p.oid <> 'avant_chaque_requete()'::regprocedure;
  assert v is null, 'anon exécute : ' || v;
  select string_agg(p.oid::regprocedure::text, ', ') into v from pg_proc p
   where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname !~ '^(carnet|transactions_recentes|cotation|chandelles|bougies|preuve_de_reserve|session_forte|avant_chaque_requete)$'
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
     and c.relname in ('verifications', 'verification_echecs', 'courriels_a_envoyer', 'numeros_codes', 'terminaux', 'floats', 'entrees_retenues', 'commandes', 'messages_sortants',
                       'remboursements', 'journal_admin', 'adresses_libres', 'emissions',
                       'lots_de_secours', 'codes_de_secours', 'journal_securite', 'reinitialisations_2fa');
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
  begin perform * from codes_de_secours; raise exception 'aurait dû refuser';
  exception when insufficient_privilege then null; end;
  raise notice '✓ 11.1b un client ne frappe pas d''USDT, n''écrit pas un solde, ne joue ni la chaîne ni TOTEM, ne lit aucune empreinte';
end $$;
rollback;

-- 11.2 · pgcrypto vit dans « extensions » (comme chez Supabase) : les codes
-- ont été hachés et vérifiés plus haut, donc chaque appel est qualifié.
do $$
begin
  assert not exists (select 1 from pg_proc where proname = 'crypt' and pronamespace = 'public'::regnamespace), 'le harnais doit garder pgcrypto hors de public';
  assert to_regclass('public.codes_secrets') is null, '(0036) la table des codes secrets est partie';
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
                           'demander_sortie(1000, ''cccccccc-0000-0000-0000-000000000001'', null, gen_random_uuid(), ''x'', ''000000'')',
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

-- 11.8 · un compte ne naît que dans ouvrir_mon_compte (0035) : ni d'une ligne
-- auth.users, ni d'un téléphone prouvé (plus de connexion par SMS). Témoin : sur
-- le code d'avant, le téléphone prouvé faisait naître le compte « 677333444 ».
do $$
begin
  insert into auth.users (id, email) values ('eeeeeeee-0000-0000-0000-000000000001', 'a@xafe.exchange'), ('eeeeeeee-0000-0000-0000-000000000002', 'b@xafe.exchange');
  insert into auth.users (id, phone) values ('eeeeeeee-0000-0000-0000-000000000003', '+237677333444');
  update auth.users set phone_confirmed_at = now() where id = 'eeeeeeee-0000-0000-0000-000000000003';
  insert into auth.users (id, email, email_confirmed_at) values ('eeeeeeee-0000-0000-0000-000000000004', 'c@xafe.exchange', now());
  assert not exists (select 1 from comptes where id::text like 'eeeeeeee-%'), 'un compte est né hors de ouvrir_mon_compte';
  assert not exists (select 1 from comptes where telephone = '677333444'), 'le téléphone prouvé a fait naître un compte';
  assert to_regprocedure('handle_nouvel_utilisateur()') is null, 'le déclencheur de naissance est encore là';
  delete from auth.users where id::text like 'eeeeeeee-%';
  raise notice '✓ 11.8 un compte ne naît que dans ouvrir_mon_compte : ni d''une inscription, ni d''un téléphone prouvé';
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
select _demander_sortie(10000, 'aaaaaaaa-0000-0000-0000-000000000001', 'k-s-11') \gset s11_
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
    perform _demander_retrait_crypto('USDT', 'bep20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 1000, null);
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'plafond du palier atteint', 'Bob (palier 0) ne sort pas 600 000 XAF par la chaîne : ' || sqlerrm;
  end;
  r := _demander_retrait_crypto('XAFe', 'bep20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 20000, 'k-cr-x');
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
    perform _demander_sortie(10000, 'aaaaaaaa-0000-0000-0000-000000000001', null);
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
select _demander_sortie(1500000, 'aaaaaaaa-0000-0000-0000-000000000001', 'k-s-19') \gset s19_
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

-- 11.23 · les petits défauts : sortie à zéro, journée de Douala, plafond restant, administrateur inconnu, pièces gardées.
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare c jsonb := mon_compte();
begin
  begin
    perform _demander_sortie(1, 'aaaaaaaa-0000-0000-0000-000000000001', 'k-s-23');
    raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'montant trop petit', sqlerrm; end;
  assert extract(hour from debut_du_jour() at time zone 'Africa/Douala') = 0 and debut_du_jour() <= now()
         and now() - debut_du_jour() < interval '24 hours', 'la journée commence à minuit à Douala : ' || debut_du_jour();
  assert (c ->> 'entre_du_jour')::numeric = (select coalesce(sum(montant), 0) from depot_declarations
          where compte_id = '11111111-1111-1111-1111-111111111111' and etat = 'credite' and credite_le >= debut_du_jour()), c;
end $$;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
select demander_verification('entreprise', '["22222222-2222-2222-2222-222222222222/entreprise/rccm.pdf"]'::jsonb) \gset v23_
set local xafe.compte = 'dddddddd-0000-0000-0000-000000000001';
do $$
begin
  begin
    perform admin_desactiver_administrateur('00000000-0000-0000-0000-00000000abcd', false);
    raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'administrateur inconnu', sqlerrm; end;
  perform admin_changer_palier('22222222-2222-2222-2222-222222222222', 1, 'à la main');
  assert (select verification_en_cours from comptes where id = '22222222-2222-2222-2222-222222222222') = 'entreprise',
         'le palier 1 posé à la main ne jette pas les pièces de l''entreprise';
  perform admin_changer_palier('22222222-2222-2222-2222-222222222222', 2, 'à la main');
  assert (select verification_en_cours from comptes where id = '22222222-2222-2222-2222-222222222222') is null, 'le palier 2 la satisfait';
  assert exists (select 1 from depot_declarations x where x.etat = 'credite' and (_declaration_json(x) ->> 'lu_le') is not null),
         'une déclaration créditée dit quand TOTEM a lu son SMS';
  raise notice '✓ 11.23 une sortie qui n''enverrait rien est refusée ; la journée est celle de Douala ; le compte dit ce qui est entré aujourd''hui ; un administrateur inconnu ne s''« active » pas ; changer le palier ne jette pas des pièces qui attendent';
end $$;
rollback;

-- 11.24 · l'achat rapide : un prix ferme pris au carnet, plus la marge ; rejoué, expiré, carnet qui bouge, vente.
begin;
-- le carnet vidé le temps du scénario (tout est annulé au rollback)
update ordres set etat = 'annule' where etat in ('ouvert', 'partiel');
select _mouvement('22222222-2222-2222-2222-222222222222', 'USDT', 500, 0, 'essai', 'essai', '11.24'),
       _mouvement('33333333-3333-3333-3333-333333333333', 'XAFe', 100000, 0, 'essai', 'essai', '11.24'),
       _mouvement('11111111-1111-1111-1111-111111111111', 'XAFe', 200000, 0, 'essai', 'essai', '11.24'),
       _mouvement('11111111-1111-1111-1111-111111111111', 'USDT', 100, 0, 'essai', 'essai', '11.24');
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
select placer_ordre('vente', 'limite', 100, 600), placer_ordre('vente', 'limite', 50, 610);
set local xafe.compte = '33333333-3333-3333-3333-333333333333';
select placer_ordre('achat', 'limite', 80, 590);
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare a uuid := '11111111-1111-1111-1111-111111111111'; e jsonb; d jsonb; r jsonb;
        x0 numeric := solde(a, 'XAFe', 'dispo'); u0 numeric := solde(a, 'USDT', 'dispo'); m0 numeric := solde(compte_maison(), 'XAFe', 'dispo');
        tx numeric := total('XAFe'); tu numeric := total('USDT');
begin
  -- 70 000 XAFe, marge 1 % : 69 306,93 au carnet → 100 à 600 puis 15,25 à 610 = 69 302,50 ; payés 69 995,53
  e := devis_rapide('achat', 70000, false);
  assert (e ->> 'quantite')::numeric = 115.25 and (e ->> 'total')::numeric = 69995.53, e;
  assert not exists (select 1 from devis_rapides where compte_id = a), 'une estimation n''écrit rien';
  d := devis_rapide('achat', 70000);
  r := executer_devis((d ->> 'id')::uuid);
  assert r ->> 'etat' = 'execute', r;
  assert solde(a, 'USDT', 'dispo') = u0 + 115.25, 'le client reçoit exactement les USDT promis, sans frais du carnet';
  assert solde(a, 'XAFe', 'dispo') = x0 - 69995.53, 'il paie exactement le prix promis';
  assert solde(compte_maison(), 'XAFe', 'dispo') >= m0 + 693.03, 'la marge va à la plateforme';
  assert (mon_ordre((select ordre_id from devis_rapides where id = (d ->> 'id')::uuid)) -> 'ordre' -> 'rapide' ->> 'total')::numeric = 69995.53,
         'l''historique montre ce que le client a payé, marge comprise, pas le seul coût du carnet';
  assert (executer_devis((d ->> 'id')::uuid) ->> 'deja')::boolean, 'rejoué : la même réponse, rien de plus';
  assert solde(a, 'USDT', 'dispo') = u0 + 115.25, 'et rien n''a bougé une seconde fois';

  -- expiré
  d := devis_rapide('achat', 8000);
  update devis_rapides set expire_le = now() - interval '1 second' where id = (d ->> 'id')::uuid;
  begin perform executer_devis((d ->> 'id')::uuid); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'devis expiré', sqlerrm; end;

  -- le carnet monte entre le devis et la signature : refusé, rien n'a bougé
  d := devis_rapide('achat', 8000);
  update ordres set prix = prix + 50 where cote = 'vente' and etat in ('ouvert', 'partiel');
  x0 := solde(a, 'XAFe', 'dispo');
  begin perform executer_devis((d ->> 'id')::uuid); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'le prix a changé', sqlerrm; end;
  assert solde(a, 'XAFe', 'dispo') = x0, 'un devis refusé ne coûte rien';

  -- la vente : 50 USDT à l'acheteur à 590 = 29 500 ; reçus 29 205 (marge 1 %)
  x0 := solde(a, 'XAFe', 'dispo'); u0 := solde(a, 'USDT', 'dispo');
  d := devis_rapide('vente', 50);
  assert (d ->> 'total')::numeric = 29205, d;
  perform executer_devis((d ->> 'id')::uuid);
  assert solde(a, 'XAFe', 'dispo') = x0 + 29205 and solde(a, 'USDT', 'dispo') = u0 - 50, 'la vente rapide rend exactement le prix promis';

  begin perform devis_rapide('vente', 1000); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'pas assez d''acheteurs au carnet', sqlerrm; end;
  assert total('XAFe') = tx and total('USDT') = tu, 'l''achat rapide déplace, il ne crée ni ne perd rien';
  raise notice '✓ 11.24 l''achat rapide : un prix ferme pris au carnet, marge comprise, exact au centime ; rejoué il ne rejoue rien ; expiré ou dépassé par le carnet, il ne coûte rien ; la vente rapide aussi';
end $$;
rollback;

-- 11.25 · le veilleur de chaîne : une transaction notée ne se remplace que nommée, et la base garde l'ancienne ;
--         ce que le chaud doit encore, les dépôts orphelins, l'état publié — lus par l'équipe, pas par un client.
begin;
select _mouvement('22222222-2222-2222-2222-222222222222', 'USDT', 100, 0, 'essai', 'essai', '11.25');
update parametres set valeur = jsonb_set(valeur, '{retraits_ouverts}', 'true') where cle = 'crypto';
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
declare r jsonb; ref text; dus jsonb;
begin
  r := _demander_retrait_crypto('USDT', 'trc20', 'TPL66VK2gCXNCD7EJg9pgJRfqcRazjhUZY', 10, 'k-11.25');
  ref := r ->> 'reference';
  dus := chaine_retraits_en_attente('trc20');
  assert dus @> jsonb_build_array(jsonb_build_object('reference', ref)), 'en attente, il est dû au chaud : ' || dus;
  perform chaine_retraits_a_envoyer('trc20');
  assert chaine_retraits_en_attente('trc20') @> jsonb_build_array(jsonb_build_object('reference', ref)), 'pris mais pas signé : toujours dû';
  perform chaine_marquer_envoi(ref, 'aa01', '{"raw_data":{"expiration":1}}');
  assert not chaine_retraits_en_attente('trc20') @> jsonb_build_array(jsonb_build_object('reference', ref)), 'signé : il ne compte plus dans ce que le froid doit laisser';
  begin perform chaine_marquer_envoi(ref, 'aa02', '{}'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'un autre envoi est déjà signé', sqlerrm; end;
  begin perform chaine_marquer_envoi(ref, 'aa02', '{}', 'ffff'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'un autre envoi est déjà signé', 'remplacer une transaction qu''on ne nomme pas : ' || sqlerrm; end;
  perform chaine_marquer_envoi(ref, 'aa02', '{"raw_data":{"expiration":2}}', 'aa01');
  assert (select tx_hash = 'aa02' and tx_remplacees = array['aa01'] from retraits_crypto where reference = ref), 'la nouvelle est notée, l''ancienne gardée';
  perform chaine_marquer_envoi(ref, 'aa02', '{"raw_data":{"expiration":2}}');  -- renoter la même : rien de neuf
  assert (select cardinality(tx_remplacees) = 1 from retraits_crypto where reference = ref);

  perform chaine_signaler_orphelin('trc20', 'USDT', 'TPL66VK2gCXNCD7EJg9pgJRfqcRazjhUZY', 7, 'bb:0', 'adresse jamais attribuée à un client');
  perform chaine_signaler_orphelin('trc20', 'USDT', 'TPL66VK2gCXNCD7EJg9pgJRfqcRazjhUZY', 7, 'bb:0', 'adresse jamais attribuée à un client');
  assert (select count(*) from chaine_orphelins where preuve = 'bb:0') = 1, 'un orphelin, une ligne, même revu';
  perform chaine_publier_etat('trc20', '{"chaud": "Tchaud", "alertes": ["a"]}');
  perform chaine_publier_etat('trc20', '{"chaud": "Tchaud", "alertes": []}');
  assert chaine_etat('trc20') ->> 'chaud' = 'Tchaud' and jsonb_array_length(chaine_etat('trc20') -> 'alertes') = 0, 'le dernier état remplace le précédent';
  -- un tour à la fois : le second réveil, pendant que le premier tourne, ne prend pas la main
  assert chaine_prendre_tour('trc20', 60) and not chaine_prendre_tour('trc20', 60), 'deux tours en même temps';
  perform chaine_rendre_tour('trc20');
  assert chaine_prendre_tour('trc20', 60), 'rendu, le bail se reprend';
  perform chaine_rendre_tour('trc20');
  begin perform admin_wallets(); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'accès non autorisé', 'un client ne lit pas les wallets : ' || sqlerrm; end;
end $$;
set local xafe.compte = 'dddddddd-0000-0000-0000-000000000003';
do $$
declare w jsonb := admin_wallets(); t jsonb;
begin
  select x into t from jsonb_array_elements(w -> 'reseaux') x where x ->> 'reseau' = 'trc20';
  assert t -> 'etat' ->> 'chaud' = 'Tchaud' and not (t ->> 'muet')::boolean and (t ->> 'retraits_remplaces')::int >= 1, t;
  assert w -> 'orphelins' @> '[{"preuve": "bb:0"}]' and (w ->> 'du_usdt')::numeric > 0, w;
  raise notice '✓ 11.25 le veilleur ne remplace qu''une transaction qu''il nomme, la base garde l''ancienne ; un seul tour à la fois par réseau ; ce que le chaud doit, les dépôts orphelins et l''état publié se lisent par l''équipe, pas par un client';
end $$;
rollback;

-- 11.26 · l'inscription par e-mail : une adresse non prouvée n'ouvre rien ;
-- tout le profil est vérifié et mis en forme par la base, pas par l'écran.
begin;
insert into auth.users (id, email, email_confirmed_at) values
  ('f1000000-0000-0000-0000-000000000001', 'Awa.Ngono@Example.com', now()),
  ('f1000000-0000-0000-0000-000000000002', 'pas-prouve@example.com', null),
  ('f1000000-0000-0000-0000-000000000003', 'jules@example.fr', now());
select _essai_pret(id) from auth.users where id::text like 'f%';  -- 0035 : un mot de passe et des codes notés
do $$
declare r jsonb;
begin
  perform set_config('xafe.compte', 'f1000000-0000-0000-0000-000000000002', true);
  begin perform ouvrir_mon_compte('Awa', 'Ngono', date '1990-05-14', '+237677123499', 'Douala', 'CM', '2026-10-29'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'adresse e-mail non vérifiée', sqlerrm; end;

  perform set_config('xafe.compte', 'f1000000-0000-0000-0000-000000000001', true);
  begin perform ouvrir_mon_compte('Awa', 'Ngono', ((now() at time zone 'Africa/Douala')::date - interval '17 years')::date, '+237677123499', 'Douala', 'CM', '2026-10-29'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'il faut avoir 18 ans', sqlerrm; end;
  begin perform ouvrir_mon_compte('Awa', 'Ngono', date '1990-05-14', '+23767712349', 'Douala', 'CM', '2026-10-29'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'numéro de téléphone invalide', sqlerrm; end;
  begin perform ouvrir_mon_compte('Awa', 'Ngono', date '1990-05-14', '+237577123499', 'Douala', 'CM', '2026-10-29'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'numéro de téléphone invalide', sqlerrm; end;
  begin perform ouvrir_mon_compte('A1', 'Ngono', date '1990-05-14', '+237677123499', 'Douala', 'CM', '2026-10-29'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'prénom invalide', sqlerrm; end;
  begin perform ouvrir_mon_compte('Awa', 'Ngono', date '1990-05-14', '+237677123499', 'Douala', 'Cameroun', '2026-10-29'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'pays invalide', sqlerrm; end;
  assert not exists (select 1 from comptes where id = 'f1000000-0000-0000-0000-000000000001'), 'un refus n''ouvre rien';

  r := ouvrir_mon_compte('  awa ', 'NGONO-MBALLA', date '1990-05-14', '+237 6 77 12 34 99', 'douala', 'cm', '2026-10-29');
  assert r ->> 'prenom' = 'Awa' and r ->> 'nom_de_famille' = 'Ngono-Mballa' and r ->> 'nom' = 'Awa Ngono-Mballa', r;
  assert r ->> 'telephone' = '+237677123499' and r ->> 'email' = 'awa.ngono@example.com', r;
  assert r ->> 'ville' = 'Douala' and r ->> 'pays' = 'CM' and r ->> 'date_naissance' = '1990-05-14', r;
  begin perform ouvrir_mon_compte('Awa', 'Ngono', date '1990-05-14', '+237677123400', 'Douala', 'CM', '2026-10-29'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'compte déjà ouvert', sqlerrm; end;
  assert mon_compte() ->> 'email' = 'awa.ngono@example.com', mon_compte();

  perform set_config('xafe.compte', 'f1000000-0000-0000-0000-000000000003', true);
  begin perform ouvrir_mon_compte('Jules', 'Martin', date '1985-01-02', '+237677123499', 'Paris', 'FR', '2026-10-29'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'ce numéro est déjà utilisé', sqlerrm; end;
  r := ouvrir_mon_compte('jules', 'd''almeida', date '1985-01-02', '+33 6 12 34 56 78', 'saint-étienne', 'FR', '2026-10-29');
  assert r ->> 'nom' = 'Jules D''Almeida' and r ->> 'ville' = 'Saint-Étienne' and r ->> 'telephone' = '+33612345678', r;
  raise notice '✓ 11.26 l''inscription par e-mail : une adresse non prouvée n''ouvre rien ; mineur, numéro, nom ou pays faux sont refusés par la base ; le profil est mis en forme ; un numéro ne sert qu''à un compte';
end $$;
rollback;

-- 11.27 · l'administration sans mot de passe : une adresse invitée devient
-- administrateur à son premier code ; une adresse non invitée, ou non
-- prouvée, n'administre rien ; seul le super admin invite.
begin;
insert into auth.users (id, email, email_confirmed_at) values
  ('f2000000-0000-0000-0000-000000000001', 'fatou@example.com', now()),
  ('f2000000-0000-0000-0000-000000000002', 'curieux@example.com', now()),
  ('f2000000-0000-0000-0000-000000000003', 'zoe@example.com', null);
select _essai_pret(id) from auth.users where id::text like 'f%';  -- 0035 : un mot de passe et des codes notés
do $$
declare r jsonb;
begin
  perform set_config('xafe.compte', '22222222-2222-2222-2222-222222222222', true);
  begin perform admin_inviter_administrateur('pirate@example.com', 'Pirate', 'super_admin'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'accès non autorisé', sqlerrm; end;

  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000001', true);
  r := admin_inviter_administrateur('  Fatou@Example.com ', 'Fatou Bello', 'support');
  assert r ->> 'email' = 'fatou@example.com', r;
  perform admin_inviter_administrateur('zoe@example.com', 'Zoé', 'operateur');
  begin perform admin_inviter_administrateur('pas-une-adresse', 'X', 'support'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'adresse e-mail invalide', sqlerrm; end;

  perform set_config('xafe.compte', 'f2000000-0000-0000-0000-000000000002', true);
  assert entrer_administration() is null, 'une adresse non invitée n''administre rien';
  assert not admin_a_droit('voir');

  perform set_config('xafe.compte', 'f2000000-0000-0000-0000-000000000003', true);
  assert entrer_administration() is null, 'une adresse non prouvée n''administre rien';
  assert exists (select 1 from administrateurs_invites where email = 'zoe@example.com'), 'son invitation attend';

  perform set_config('xafe.compte', 'f2000000-0000-0000-0000-000000000001', true);
  r := entrer_administration();
  assert r ->> 'role' = 'support' and r ->> 'email' = 'fatou@example.com', r;
  assert admin_a_droit('voir') and not admin_a_droit('administrateurs');
  assert not exists (select 1 from administrateurs_invites where email = 'fatou@example.com'), 'l''invitation est consommée';
  assert (entrer_administration() ->> 'id')::uuid = 'f2000000-0000-0000-0000-000000000001', 'le second passage rend la même fiche';
  assert not has_table_privilege('authenticated', 'administrateurs_invites', 'select'), 'les invitations ne se lisent pas';
  raise notice '✓ 11.27 l''administration par code : une adresse invitée devient administrateur à son premier passage ; non invitée ou non prouvée, rien ; seul le super admin invite';
end $$;
rollback;

-- 11.28 · la vue clients de l'équipe : les compteurs, la liste qui se
-- cherche et se filtre, la fiche complète ; rien de tout cela pour un client.
begin;
insert into auth.users (id, email, email_confirmed_at, last_sign_in_at) values
  ('f3000000-0000-0000-0000-000000000001', 'mireille@example.com', now(), now()),
  ('f3000000-0000-0000-0000-000000000002', 'inacheve@example.com', now(), now());
select _essai_pret(id) from auth.users where id::text like 'f%';  -- 0035 : un mot de passe et des codes notés
do $$
declare s jsonb; l jsonb; f jsonb;
begin
  perform set_config('xafe.compte', 'f3000000-0000-0000-0000-000000000001', true);
  perform ouvrir_mon_compte('Mireille', 'Essomba', date '1992-03-08', '+237699001122', 'Yaoundé', 'CM', '2026-10-29');

  perform set_config('xafe.compte', '22222222-2222-2222-2222-222222222222', true);
  begin perform admin_statistiques_clients(); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'accès non autorisé', sqlerrm; end;
  begin perform admin_client('f3000000-0000-0000-0000-000000000001'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'accès non autorisé', sqlerrm; end;

  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000003', true);  -- le support : droit « clients »
  s := admin_statistiques_clients();
  assert (s ->> 'total')::int = (select count(*) from comptes where not maison and genre = 'client'), s;  -- les robots de la bêta (0023) n'y sont pas
  assert (s ->> 'nouveaux_7j')::int >= 1 and (s ->> 'connectes_7j')::int >= 1 and (s ->> 'inscriptions_inachevees')::int >= 1, s;
  assert (s ->> 'actifs_30j')::int <= (s ->> 'total')::int and jsonb_array_length(s -> 'inscriptions_30j') = 30, s;
  assert (s -> 'par_pays' ->> 'CM')::int >= 1, s;

  l := admin_clients('mireille@', 50, null);
  assert jsonb_array_length(l) = 1 and l -> 0 ->> 'ville' = 'Yaoundé' and l -> 0 ->> 'derniere_connexion' is not null, l;
  l := admin_clients('99 00 11', 50, null);
  assert l @> '[{"email": "mireille@example.com"}]', l;
  l := admin_clients(null, 500, 'nouveaux');
  assert l @> '[{"email": "mireille@example.com"}]', 'une inscription du jour est « nouvelle »';
  l := admin_clients(null, 500, 'actifs');
  assert not l @> '[{"email": "mireille@example.com"}]', 'sans opération, pas « actif »';
  l := admin_clients(null, 500, 'inactifs');
  assert l @> '[{"email": "mireille@example.com"}]', l;

  f := admin_client('f3000000-0000-0000-0000-000000000001');
  assert f -> 'compte' ->> 'date_naissance' = '1992-03-08' and f -> 'compte' ->> 'derniere_connexion' is not null, f;
  assert f ? 'retraits_crypto' and f ? 'transferts_crypto' and (f -> 'totaux' ->> 'ordres')::int = 0, f;
  raise notice '✓ 11.28 la vue clients : compteurs, inscriptions inachevées, recherche par e-mail ou numéro, filtres actifs/inactifs/nouveaux, fiche complète — et rien pour un client';
end $$;
rollback;

-- 11.29 · l'équipe : seul le super admin la voit et la change, jamais sur lui-même.
begin;
do $$
declare e jsonb;
begin
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000003', true);  -- le support
  begin perform admin_equipe(); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'accès non autorisé', sqlerrm; end;

  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000001', true);  -- le super admin
  perform admin_inviter_administrateur('awa@example.com', 'Awa', 'tresorier');
  e := admin_equipe();
  assert e -> 'invitations' @> '[{"email": "awa@example.com", "role": "tresorier"}]', e;
  assert e -> 'administrateurs' @> '[{"id": "dddddddd-0000-0000-0000-000000000001", "moi": true}]', e;
  perform admin_retirer_invitation('AWA@example.com');
  assert not (admin_equipe() -> 'invitations' @> '[{"email": "awa@example.com"}]');
  begin perform admin_changer_role('dddddddd-0000-0000-0000-000000000001', 'support'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'on ne change pas son propre rôle', sqlerrm; end;
  perform admin_changer_role('dddddddd-0000-0000-0000-000000000003', 'operateur');
  assert (select role from administrateurs where id = 'dddddddd-0000-0000-0000-000000000003') = 'operateur';
  raise notice '✓ 11.29 l''équipe : le super admin voit, invite, retire une invitation, change un rôle — jamais le sien ; le support ne voit rien';
end $$;
rollback;

-- 11.30 · aucune de nos fonctions ne cherche ses objets dans le chemin de
-- celui qui l'appelle : toutes ont le leur, figé (0012). Une migration future
-- qui l'oublierait échoue ici.
do $$
declare v text;
begin
  select string_agg(p.proname, ', ') into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
     and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');
  assert v is null, 'sans chemin figé : ' || v;
  raise notice '✓ 11.30 chaque fonction a son chemin de recherche figé';
end $$;

-- 11.31 · les conditions : on n'ouvre pas un compte sans accepter la version
-- EN VIGUEUR ; quand elle change, le compte le sait et la réaccepte.
begin;
insert into auth.users (id, email, email_confirmed_at) values ('f3000000-0000-0000-0000-000000000001', 'paul@example.com', now());
select _essai_pret(id) from auth.users where id::text like 'f%';  -- 0035 : un mot de passe et des codes notés
do $$
declare r jsonb;
begin
  perform set_config('xafe.compte', 'f3000000-0000-0000-0000-000000000001', true);
  begin perform ouvrir_mon_compte('Paul', 'Biya', date '1990-01-01', '+237677000111', 'Douala', 'CM', null); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'conditions non acceptées', sqlerrm; end;
  begin perform ouvrir_mon_compte('Paul', 'Biya', date '1990-01-01', '+237677000111', 'Douala', 'CM', '2020-01-01'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'conditions non acceptées', sqlerrm; end;
  r := ouvrir_mon_compte('Paul', 'Biya', date '1990-01-01', '+237677000111', 'Douala', 'CM', '2026-10-29');
  assert r ->> 'conditions_version' = '2026-10-29' and (r ->> 'conditions_a_jour')::boolean and r ->> 'conditions_acceptees_le' is not null, r;
  update parametres set valeur = '{"version": "2027-01-01"}' where cle = 'conditions';
  assert not (mon_compte() ->> 'conditions_a_jour')::boolean, 'une nouvelle version : à relire';
  assert parametres_publics() -> 'conditions' ->> 'version' = '2027-01-01';
  begin perform accepter_conditions('2026-10-29'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'conditions non acceptées', sqlerrm; end;
  r := accepter_conditions('2027-01-01');
  assert (r ->> 'conditions_a_jour')::boolean, r;
  raise notice '✓ 11.31 les conditions : sans la version en vigueur, pas de compte ; une nouvelle version se réaccepte';
end $$;
rollback;

-- 11.32 · fermer son compte : jamais avec de l'argent dessus ni une opération
-- en cours ; avec le code secret ; ensuite plus aucun geste ; l'équipe rouvre.
begin;
insert into auth.users (id, email, email_confirmed_at) values ('f3000000-0000-0000-0000-000000000002', 'marie@example.com', now());
select _essai_pret(id) from auth.users where id::text like 'f%';  -- 0035 : un mot de passe et des codes notés
do $$
declare r jsonb;
begin
  perform set_config('xafe.compte', 'f3000000-0000-0000-0000-000000000002', true);
  perform ouvrir_mon_compte('Marie', 'Ekane', date '1991-02-02', '+237677000222', 'Douala', 'CM', '2026-10-29');
  insert into soldes (compte_id, actif, disponible, bloque) values ('f3000000-0000-0000-0000-000000000002', 'XAFe', 1500, 0);
  begin perform _fermer_compte(auth.uid()); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'il reste de l''argent sur le compte', sqlerrm; end;
  update soldes set disponible = 0 where compte_id = 'f3000000-0000-0000-0000-000000000002';
  -- (0036) la fermeture vérifiée (mot de passe + code e-mail + 2FA) a son scénario (11.60+)
  r := _fermer_compte(auth.uid(), 'je n''en ai plus besoin');
  assert (r ->> 'ok')::boolean and r -> 'compte' ->> 'ferme_le' is not null and (r -> 'compte' ->> 'desactive')::boolean, r;
  assert (select fermeture_motif from comptes where id = 'f3000000-0000-0000-0000-000000000002') = 'je n''en ai plus besoin';
  begin perform ouvrir_depot('mtn'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'compte fermé', sqlerrm; end;
  begin perform _fermer_compte(auth.uid()); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'compte déjà fermé', sqlerrm; end;
  assert mon_compte() ->> 'ferme_le' is not null, 'le client voit que son compte est fermé';

  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000001', true);  -- le super admin
  perform admin_desactiver_compte('f3000000-0000-0000-0000-000000000002', true, 'rouvert à sa demande');
  assert (select ferme_le is null and desactive_le is null from comptes where id = 'f3000000-0000-0000-0000-000000000002');
  raise notice '✓ 11.32 fermer son compte : refusé avec de l''argent dessus ou un code faux ; fermé, plus aucun geste ; l''équipe le rouvre';
end $$;
rollback;

-- 11.33 · le contact du support se règle par l'équipe, et se vérifie.
begin;
do $$
begin
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000001', true);
  begin perform admin_modifier_parametre('support', '{"email": "pas-une-adresse", "whatsapp": null}'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paramètre invalide', sqlerrm; end;
  begin perform admin_modifier_parametre('support', '{"email": "aide@glisil.com", "whatsapp": "677123456"}'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paramètre invalide', sqlerrm; end;
  perform admin_modifier_parametre('support', '{"email": "aide@glisil.com", "whatsapp": "+237677123456"}');
  perform set_config('xafe.compte', '22222222-2222-2222-2222-222222222222', true);
  assert parametres_publics() -> 'support' ->> 'whatsapp' = '+237677123456';
  raise notice '✓ 11.33 le support : l''équipe le règle, une adresse ou un numéro mal formé est refusé, l''écran le lit';
end $$;
rollback;

-- 11.34 · un dépôt se déclare en entier (0013) : numéro qui a payé, montant
-- exact, nom, transaction ID. Le crédit n'est automatique que si le SMS dit la
-- même chose ; un écart se corrige deux fois, la troisième va à l'équipe.
begin;
update parametres set valeur = valeur || '{"declaration_complete": true}' where cle = 'depot';
update terminaux set vu_le = now() where id = 'akwa-1';
insert into auth.users (id, email, email_confirmed_at) values ('f4000000-0000-0000-0000-000000000001', 'depot@example.com', now());
select _essai_pret(id) from auth.users where id::text like 'f%';  -- 0035 : un mot de passe et des codes notés
do $$
declare r jsonb; ref text; c uuid := 'f4000000-0000-0000-0000-000000000001';
begin
  perform set_config('xafe.compte', c::text, true);
  perform ouvrir_mon_compte('Awa', 'Ngono', date '1994-03-12', '+237677555111', 'Douala', 'CM', '2026-10-29');
  ref := ouvrir_depot('mtn') ->> 'reference';
  assert (mon_depot(ref) ? 'titulaire'), 'l''écran reçoit le titulaire du float';

  begin perform declarer_transaction(ref, '50000000001'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'numéro du payeur invalide', sqlerrm; end;
  begin perform declarer_transaction(ref, '50000000001', '699111222', 25000, 'Awa Ngono'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'numéro du payeur invalide', sqlerrm; end;  -- un numéro Orange pour un dépôt MTN
  begin perform declarer_transaction(ref, '50000000001', '677555111', 0, 'Awa Ngono'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'montant invalide', sqlerrm; end;
  begin perform declarer_transaction(ref, '50000000001', '677555111', 25000.5, 'Awa Ngono'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'montant invalide', sqlerrm; end;
  begin perform declarer_transaction(ref, '50000000001', '677555111', 25000, ' '); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'nom du payeur invalide', sqlerrm; end;

  -- A · le SMS d'abord, la déclaration juste : crédité tout de suite
  r := totem_sms_recu('akwa-1', 9001, 'mtn', '677000000', '677555111', 25000, '50000000001', 'Vous avez recu 25,000 FCFA de AWA NGONO (677555111). ID: 50000000001', now());
  assert r ->> 'resultat' = 'retenue', r;
  r := declarer_transaction(ref, '5000 0000 001', '+237 6 77 55 51 11', 25000, '  awa   NGONO ');
  assert r ->> 'etat' = 'credite' and (r ->> 'montant')::numeric = 25000 and r ->> 'nom_declare' = 'awa NGONO', r;
  assert solde(c, 'XAFe', 'dispo') = 25000, 'crédité au franc près';

  -- B · la déclaration d'abord, un montant faux : refusée mais corrigible, rien n'est crédité ; corrigée, créditée
  r := declarer_transaction(ref, '50000000002', '677555111', 30000, 'Awa Ngono');
  assert r ->> 'etat' = 'attendu', r;
  r := totem_sms_recu('akwa-1', 9002, 'mtn', '677000000', '677555111', 20000, '50000000002', '…', now());
  assert r ->> 'resultat' = 'retenue' and coalesce(r ->> 'motif', '') like 'le montant déclaré%', r;
  r := (select _declaration_json(x) from depot_declarations x where transaction_id = '50000000002');
  assert r ->> 'etat' = 'refuse' and (r ->> 'corrigible')::boolean and r ->> 'motif' not like '%20%', 'le motif ne dit pas le vrai montant : ' || r::text;
  assert solde(c, 'XAFe', 'dispo') = 25000, 'un écart ne crédite rien';
  assert not (select bloquee from entrees_retenues where transaction_id = '50000000002'), 'l''argent attend la correction, il n''est pas bloqué';
  r := declarer_transaction(ref, '50000000002', '677555111', 20000, 'Awa Ngono');
  assert r ->> 'etat' = 'credite' and solde(c, 'XAFe', 'dispo') = 45000, r;

  -- C · trois numéros faux : la troisième fois, l'équipe tranche, et une quatrième ne rouvre rien
  perform declarer_transaction(ref, '50000000003', '677555222', 15000, 'Awa Ngono');
  perform totem_sms_recu('akwa-1', 9003, 'mtn', '677000000', '677555111', 15000, '50000000003', '…', now());
  r := declarer_transaction(ref, '50000000003', '677555333', 15000, 'Awa Ngono');
  assert r ->> 'etat' = 'refuse' and (r ->> 'corrigible')::boolean, 'deuxième essai, encore faux : encore corrigible ' || r::text;
  r := declarer_transaction(ref, '50000000003', '677555444', 15000, 'Awa Ngono');
  assert r ->> 'etat' = 'refuse' and not (r ->> 'corrigible')::boolean and r ->> 'motif' like 'trois déclarations%', r;
  r := declarer_transaction(ref, '50000000003', '677555111', 15000, 'Awa Ngono');
  assert r ->> 'etat' = 'refuse' and solde(c, 'XAFe', 'dispo') = 45000, 'après trois essais, plus de correction : ' || r::text;
  raise notice '✓ 11.34 un dépôt se déclare en entier : numéro, montant et nom exigés ; le SMS qui concorde crédite tout de suite ; un écart se corrige deux fois et ne crédite jamais ; le motif ne trahit pas le SMS';
end $$;
rollback;

-- 11.35 · ouvrir par les dépôts : les sorties et les adresses crypto se ferment
-- d'un paramètre, et le refus vient de la base, pas seulement de l'écran.
begin;
do $$
declare r jsonb;
begin
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000001', true);  -- le super admin
  perform admin_modifier_parametre('sortie', parametre('sortie') || '{"ouvertes": false}');
  perform admin_modifier_parametre('crypto', parametre('crypto') || '{"depots_ouverts": false}');
  begin perform admin_modifier_parametre('sortie', parametre('sortie') || '{"ouvertes": "non"}'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paramètre invalide', sqlerrm; end;

  perform set_config('xafe.compte', '11111111-1111-1111-1111-111111111111', true);  -- Alice, qui a de l'argent et un numéro
  begin perform _demander_sortie(1000, (select id from numeros where compte_id = '11111111-1111-1111-1111-111111111111' limit 1), 'k-fermee'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'sorties pas encore ouvertes', sqlerrm; end;
  assert adresse_depot('USDT', 'bep20') is null, 'dépôts crypto fermés : aucune adresse, même déjà attribuée';
  r := parametres_publics();
  assert not (r -> 'sortie' ->> 'ouvertes')::boolean and not (r -> 'crypto' ->> 'depots_ouverts')::boolean, r;
  raise notice '✓ 11.35 ouvrir par les dépôts : sorties et adresses crypto se ferment d''un paramètre, la base refuse, l''écran le lit';
end $$;
rollback;

-- 11.36 · le remboursement en XAF, fait à la main (0014). Les XAFe sont mis
-- de côté à la demande ; l'équipe paie et donne l'ID ; le SMS de la puce le
-- prouve ; au-delà d'un seuil, une AUTRE personne confirme ; payé, ça ne se
-- refuse plus ; refusé avant, les XAFe reviennent.
begin;
insert into numeros (compte_id, operateur, numero, verifie_le, actif_des)
values ('11111111-1111-1111-1111-111111111111', 'mtn', '677444001', now() - interval '3 days', now() - interval '2 days');
do $$
declare
  a   uuid := '11111111-1111-1111-1111-111111111111';
  nid uuid := (select id from numeros where numero = '677444001');
  r jsonb; ref1 text; ref2 text; ref3 text;
  dispo0 numeric; bloque0 numeric; detruit0 numeric; taux numeric := (parametre('frais') ->> 'sortie')::numeric;
begin
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000001', true);  -- Nelson, super admin
  begin perform admin_modifier_parametre('sortie', parametre('sortie') || '{"mode": "a_la_main"}'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paramètre invalide', sqlerrm; end;
  perform admin_modifier_parametre('sortie', parametre('sortie') || '{"ouvertes": true, "mode": "manuel", "seuil_deux_personnes": 100000}');
  update terminaux set vu_le = now() where id = 'akwa-1';

  perform set_config('xafe.compte', a::text, true);
  assert parametres_publics() -> 'sortie' ->> 'mode' = 'manuel', 'l''écran sait que l''équipe paie';
  dispo0 := solde(a, 'XAFe', 'dispo'); bloque0 := solde(a, 'XAFe', 'bloque');
  detruit0 := (select coalesce(sum(montant), 0) from emissions where sens = 'destruction');
  begin perform _demander_sortie(50000, nid, 'm-1'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'nom du bénéficiaire invalide', sqlerrm; end;

  -- A · demandée : mise de côté tout de suite, aucun transfert pour un boîtier
  r := _demander_sortie(50000, nid, 'm-1', '  Alice   Mballa ');
  ref1 := r ->> 'reference';
  assert r ->> 'mode' = 'manuel' and r ->> 'etat' = 'en_attente' and r ->> 'nom_beneficiaire' = 'Alice Mballa', r;
  assert solde(a, 'XAFe', 'dispo') = dispo0 - 50000 and solde(a, 'XAFe', 'bloque') = bloque0 + 50000, 'mis de côté à la demande';
  assert not exists (select 1 from commandes k join sorties s on s.id = k.sortie_id where s.reference = ref1), 'aucune commande pour TOTEM';
  assert (_demander_sortie(50000, nid, 'm-1', 'Alice Mballa') ->> 'deja')::boolean, 'le même geste rejoué ne demande pas deux fois';

  -- B · le support ne paie pas ; l'opérateur prend, le SMS de la puce arrive, il paie : sous le seuil, c'est clos
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000003', true);
  begin perform admin_payer_sortie(ref1, 'MP261016.1200.A00001'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'accès non autorisé', sqlerrm; end;
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000002', true);
  assert admin_prendre_sortie(ref1) ->> 'etat' = 'en_cours';
  assert (admin_a_traiter() ->> 'sorties_manuelles')::int >= 1;
  r := totem_sms_sortant('akwa-1', 7001, 'mtn', '677000000', '677444001', 50000 - ceil(50000 * taux), 'MP261016.1200.A00001',
                         'Transfert de 49 750 FCFA a ALICE MBALLA (677444001) reussi. ID: MP261016.1200.A00001', now());
  assert r ->> 'resultat' = 'constatee' and not (r ? 'sortie'), 'le SMS arrive avant l''ID tapé : rien encore à quoi le rattacher ' || r::text;
  assert (totem_sms_sortant('akwa-1', 7001, 'mtn', '677000000', '677444001', 50000 - ceil(50000 * taux), 'MP261016.1200.A00001',
                            'Transfert de 49 750 FCFA a ALICE MBALLA (677444001) reussi. ID: MP261016.1200.A00001', now()) ->> 'deja')::boolean,
         'un SMS relu après une coupure n''est compté qu''une fois';
  begin perform admin_payer_sortie(ref1, 'MP261016.1200.A00001', 'ailleurs/capture.png'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'capture invalide', sqlerrm; end;
  begin perform admin_payer_sortie(ref1, '12'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'transaction ID invalide', sqlerrm; end;
  r := admin_payer_sortie(ref1, 'mp261016.1200.a00001', ref1 || '/capture.png');
  assert r ->> 'etat' = 'envoyee' and r -> 'rapprochement' ->> 'etat' = 'concorde' and not coalesce((r ->> 'a_confirmer')::boolean, false), r;
  assert solde(a, 'XAFe', 'bloque') = bloque0, 'les XAFe mis de côté sont partis';
  assert (select s.reference from sorties_constatees k join sorties s on s.id = k.sortie_id where k.source_id = 7001) = ref1, 'le SMS est rattaché au paiement';
  assert (select coalesce(sum(montant), 0) from emissions where sens = 'destruction') = detruit0 + 50000 - ceil(50000 * taux), 'détruits : ce qui est parti en XAF';
  -- (0038) le client est prévenu par e-mail, une seule fois, avec l'ID et ce qui est parti
  assert (select count(*) from courriels_a_envoyer where cle = 'sortie_payee:' || ref1) = 1, 'l''e-mail de la sortie payée est en file';
  assert (select donnees ->> 'transaction_id' = 'MP2610161200A00001' and (donnees ->> 'montant_xaf')::numeric = 50000 - ceil(50000 * taux)
            from courriels_a_envoyer where cle = 'sortie_payee:' || ref1), 'l''e-mail dit l''ID et le montant envoyé';
  begin perform admin_refuser_sortie(ref1, 'trop tard'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'un paiement est enregistré', sqlerrm; end;

  -- C · au-dessus du seuil : le même ID ne prouve pas deux sorties ; payé, il attend une AUTRE personne ; il ne se refuse plus
  perform set_config('xafe.compte', a::text, true);
  ref2 := _demander_sortie(200000, nid, 'm-2', 'Alice Mballa') ->> 'reference';
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000002', true);
  begin perform admin_payer_sortie(ref2, 'MP261016.1200.A00001'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'ce transaction ID prouve déjà une autre sortie', sqlerrm; end;
  r := admin_payer_sortie(ref2, 'MP261016.1300.B00002');
  assert (r ->> 'a_confirmer')::boolean and r ->> 'etat' = 'en_preuve' and r -> 'rapprochement' ->> 'etat' = 'absent', r;
  assert solde(a, 'XAFe', 'bloque') = bloque0 + 200000, 'pas encore détruits : la preuve n''a vu qu''un œil';
  begin perform admin_confirmer_sortie(ref2); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'une autre personne confirme', sqlerrm; end;
  begin perform admin_refuser_sortie(ref2, 'je me ravise'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'un paiement est enregistré', sqlerrm; end;
  perform totem_sms_sortant('akwa-1', 7002, 'mtn', '677000000', '677444001', 150000, 'MP261016.1300.B00002', 'Transfert de 150 000 FCFA…', now());
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000001', true);
  r := admin_confirmer_sortie(ref2);
  -- (0038) une seconde personne ne remplace pas le SMS : il dit 150 000, la sortie reste ouverte et dit pourquoi
  -- (avant 0038, elle se clôturait sur l'écart : c'est ce que ce scénario figeait)
  assert r ->> 'etat' = 'en_preuve' and r -> 'rapprochement' ->> 'etat' = 'ecart' and r -> 'rapprochement' ->> 'motif' like 'le SMS dit 150%', 'le SMS dit 150 000 : l''écart garde la sortie ouverte ' || r::text;
  assert solde(a, 'XAFe', 'bloque') = bloque0 + 200000, 'en écart, rien n''est détruit';

  -- D · refusée avant paiement : tout revient, avec le motif
  perform set_config('xafe.compte', a::text, true);
  ref3 := _demander_sortie(10000, nid, 'm-3', 'Alice Mballa') ->> 'reference';
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000002', true);
  begin perform admin_refuser_sortie(ref3, ' '); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'un motif est exigé', sqlerrm; end;
  r := admin_refuser_sortie(ref3, 'le nom MoMo ne correspond pas au compte');
  assert r ->> 'etat' = 'annulee' and r ->> 'motif' like 'le nom MoMo%', r;
  assert solde(a, 'XAFe', 'dispo') = dispo0 - 250000 and solde(a, 'XAFe', 'bloque') = bloque0 + 200000, 'les 10 000 sont revenus (les 200 000 en écart restent de côté)';

  -- E · ce que la puce a vu partir et que rien n'explique se voit
  perform totem_sms_sortant('akwa-1', 7003, 'mtn', '677000000', '677999000', 30000, 'MP261016.1400.C00003', 'Transfert de 30 000 FCFA…', now());
  r := admin_sorties_non_expliquees();
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'transaction_id' = normaliser_transaction_id('MP261016.1400.C00003'), r;
  assert (admin_a_traiter() ->> 'sorties_non_expliquees')::int = 1;
  assert total('XAFe') = circulation(), format('XAFe : %s en soldes, %s en circulation', total('XAFe'), circulation());
  raise notice '✓ 11.36 remboursement manuel : mis de côté à la demande, payé avec un ID qui ne sert qu''une fois, prouvé par le SMS de la puce, confirmé par une seconde personne au-delà du seuil, jamais refusé après paiement ; refusé avant, tout revient';
end $$;
rollback;

-- 11.37 · chaque XAFe aussi sur la chaîne (0015) : un dépôt crédité, une
-- sortie payée, un retrait vers un wallet deviennent chacun UNE opération sur
-- la réserve, dans l'ordre, sous la référence du mouvement. La somme des
-- frappes moins les destructions vaut ce que Glisil doit dans ses comptes.
begin;
do $$
declare r jsonb; n_avant bigint := (select count(*) from reserve_chaine);
begin
  assert (select count(*) from reserve_chaine) = (select count(*) from emissions), 'chaque mouvement passé a sa ligne de réserve';
  assert (select coalesce(sum(case operation when 'frapper' then montant else -montant end), 0) from reserve_chaine) = circulation(),
         format('la réserve attendue (%s) vaut ce que les comptes portent (%s)',
                (select sum(case operation when 'frapper' then montant else -montant end) from reserve_chaine), circulation());
  insert into emissions (sens, montant, source_table, source_id) values ('emission', 2500, 'depots', 'XAFe-DP-990001');
  insert into emissions (sens, montant, source_table, source_id) values ('emission', 500, 'depots', 'XAFe-DP-990001');
  insert into emissions (sens, montant, source_table, source_id) values ('destruction', 1000, 'sorties', 'XAFe-WD-990002');
  assert (select array_agg(reference || ':' || operation order by id) from reserve_chaine where id > (select coalesce(max(id), 0) from reserve_chaine) - 3)
         = array['XAFe-DP-990001:frapper', 'XAFe-DP-990001#' || (select max(id) - 1 from emissions) || ':frapper', 'XAFe-WD-990002:detruire'],
         'la référence du mouvement, un suffixe au second crédit du même dossier, l''ordre gardé';
  r := chaine_reserve_a_jouer('bep20');
  assert jsonb_array_length(r) >= 3 and (r -> 0 ->> 'id')::bigint < (r -> 1 ->> 'id')::bigint, 'dans l''ordre';
  perform chaine_reserve_marquer_envoi((r -> 0 ->> 'id')::bigint, '0xabc', 'brut');
  perform chaine_reserve_resultat((r -> 0 ->> 'id')::bigint, true, 42, 'bloc 42');
  begin perform chaine_reserve_resultat((r -> 0 ->> 'id')::bigint, true, 42, 'bloc 42'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'opération de réserve pas en cours', sqlerrm; end;
  assert (select _trace_chaine('depots', 'XAFe-DP-990001') -> 0 ->> 'operation') = 'frapper', 'le dépôt porte sa trace';
  assert not has_function_privilege('authenticated', 'chaine_reserve_marquer_envoi(bigint, text, text)', 'execute'), 'le veilleur seul joue la réserve';
  raise notice '✓ 11.37 chaque XAFe aussi sur la chaîne : un mouvement, une opération de réserve, dans l''ordre, sous sa référence ; la réserve attendue vaut la circulation';
end $$;
rollback;

-- 11.38 · la parité à trois colonnes (0016). Une chaîne qui montre exactement
-- ce que le registre attend : écart 0, aucune anomalie. Puis chaque façon de
-- mentir, une à une : une frappe que personne n'explique, une opération qui
-- n'arrive pas, une offre que la lecture n'explique pas, des floats qui ne
-- couvrent plus — chacune ouvre son alarme, et l'alarme vue deux fois part par SMS.
begin;
do $$
declare r jsonb; l record; v_empr text; n int;
begin
  update parametres set valeur = '{"essai": true, "bep20": {"xafe": "0xabc"}, "trc20": null}' where cle = 'chaine';
  -- le veilleur a appris l'empreinte de chaque référence…
  perform chaine_noter_empreintes((select jsonb_agg(jsonb_build_object('reference', x, 'empreinte', '0x' || md5(x) || md5(x || '#')))
                                     from jsonb_array_elements_text(chaine_references_sans_empreinte(1000)) x));
  assert jsonb_array_length(chaine_references_sans_empreinte(1000)) = 0, 'chaque référence a son empreinte';
  -- … et relu sur la chaîne chaque opération attendue, telle quelle
  n := 0;
  for l in select * from _parite_lignes() loop
    n := n + 1;
    insert into chaine_mouvements_jeton (reseau, tx_hash, idx, bloc, genre, adresse, montant, empreinte)
    values ('bep20', '0xt' || n, 0, n, l.genre, '0xchaud', l.montant, (select empreinte from chaine_empreintes where reference = l.reference));
  end loop;
  insert into chaine_etats (reseau, etat) values ('bep20', jsonb_build_object('chaud', '0xchaud', 'jeton', jsonb_build_object(
    'offre', (select sum(case genre when 'frappe' then montant else -montant end) from chaine_mouvements_jeton), 'bloc', 100000, 'a_jour', true)))
  on conflict (reseau) do update set etat = excluded.etat;
  -- les floats : le solde que l'opérateur annonce, assez pour couvrir
  perform totem_solde_float('akwa-1', 'mtn', '677000000', 1e9, now(), 'sms', 900001);
  assert (totem_solde_float('akwa-1', 'mtn', '677000000', 1e9, now(), 'sms', 900001) ->> 'resultat') = 'deja', 'un SMS relu ne compte qu''une fois';
  assert (totem_solde_float('secours-3', 'mtn', '677000000', 5, now(), 'ussd') ->> 'resultat') = 'refuse', 'un float d''un autre terminal est refusé';
  -- 0039 : un solde lu dans un SMS SEUL n'est jamais sûr (un faux SMS l'écrirait) : il ne fait pas la colonne « floats »
  assert (_solde_float((select id from floats where numero = '677000000'))).id is null, 'un solde de SMS seul ne compte pas';
  insert into soldes_floats (float_id, solde, annonce_le, source) select id, 1e9, now(), 'releve' from floats where actif and (_solde_float(id)).id is null;
  r := rapprocher();
  assert (r ->> 'ecart')::numeric = 0 and (r ->> 'anomalies')::int = 0, format('la chaîne montre ce que le registre attend : %s', r);
  assert (r ->> 'statut') in ('juste', 'en_cours'), r;
  assert (r ->> 'registre')::numeric = circulation() + circulation_chaine(), 'le registre : dans les comptes plus sur les wallets';
  assert (r ->> 'couverture')::numeric > 0, r;

  -- 1. une frappe que le registre n'explique pas : grave, et l'écart se dit au franc
  insert into chaine_mouvements_jeton (reseau, tx_hash, idx, bloc, genre, adresse, montant, empreinte) values ('bep20', '0xpirate', 0, 99999, 'frappe', '0xinconnu', 5, null);
  update chaine_etats set etat = jsonb_set(etat, '{jeton,offre}', to_jsonb((etat #>> '{jeton,offre}')::numeric + 5)) where reseau = 'bep20';
  r := rapprocher();
  assert (r ->> 'ecart')::numeric = 5 and (r ->> 'statut') = 'ecart', r;
  assert exists (select 1 from parite_alertes where code = 'ligne:bep20:0xpirate' and gravite = 'grave' and close_le is null), 'la frappe inconnue est une alarme grave';
  assert exists (select 1 from parite_alertes where code = 'ecart_chaine' and close_le is null), 'l''écart au franc est une alarme';
  -- l'alarme vue deux fois part par SMS, une seule fois, au numéro posé
  update parametres set valeur = valeur || '{"alerte_numero": "677 11 22 33"}' where cle = 'parite';
  perform rapprocher(); perform rapprocher();
  assert (select count(*) from messages_sortants where cle like 'parite-%' and numero = '677112233') >= 2, 'l''inconnue et l''écart partent par SMS';
  n := (select count(*) from messages_sortants where cle like 'parite-%');
  perform rapprocher();
  assert (select count(*) from messages_sortants where cle like 'parite-%') = n, 'une alarme ne part qu''une fois';
  delete from chaine_mouvements_jeton where tx_hash = '0xpirate';
  update chaine_etats set etat = jsonb_set(etat, '{jeton,offre}', to_jsonb((etat #>> '{jeton,offre}')::numeric - 5)) where reseau = 'bep20';
  r := rapprocher();
  assert (r ->> 'ecart')::numeric = 0 and not exists (select 1 from parite_alertes where code in ('ecart_chaine', 'ligne:bep20:0xpirate') and close_le is null),
         'ce qui n''est plus vrai se ferme';

  -- 2. un dépôt crédité : en route, l'écart reste nul ; trop vieux, il devient une anomalie
  insert into emissions (sens, montant, source_table, source_id) values ('emission', 700, 'depots', 'XAFe-DP-990038');
  r := rapprocher();
  assert (r ->> 'ecart')::numeric = 0 and (r ->> 'statut') = 'en_cours' and (r ->> 'en_route')::numeric = 700, r;
  update reserve_chaine set cree_le = now() - interval '2 hours' where reference = 'XAFe-DP-990038';
  r := rapprocher();
  assert exists (select 1 from parite_alertes where code = 'ligne:bep20:XAFe-DP-990038' and close_le is null), 'une frappe attendue qui n''arrive pas';
  -- refusée par la chaîne : plus « en route », l'écart la montre
  update reserve_chaine set etat = 'echoue' where reference = 'XAFe-DP-990038';
  r := rapprocher();
  assert (r ->> 'ecart')::numeric = -700, format('une frappe refusée manque à la chaîne : %s', r);
  -- relue mais pas du bon montant : un écart de ligne
  perform chaine_noter_empreintes(jsonb_build_array(jsonb_build_object('reference', 'XAFe-DP-990038', 'empreinte', '0x' || md5('XAFe-DP-990038') || md5('XAFe-DP-990038#'))));
  update reserve_chaine set etat = 'confirme' where reference = 'XAFe-DP-990038';
  perform chaine_noter_mouvements('bep20', 100001, jsonb_build_array(jsonb_build_object('tx', '0xcourt', 'index', 0, 'bloc', 100001, 'genre', 'frappe',
    'adresse', '0xchaud', 'montant', 690, 'empreinte', '0x' || md5('XAFe-DP-990038') || md5('XAFe-DP-990038#'))));
  assert (select verdict from _parite_lignes() where reference = 'XAFe-DP-990038') = 'ecart', 'dix francs de moins sur la chaîne';

  -- 3. la lecture : le contrat dit plus que les mouvements relus
  update chaine_etats set etat = jsonb_set(etat, '{jeton,offre}', to_jsonb((etat #>> '{jeton,offre}')::numeric + 1)) where reseau = 'bep20';
  perform rapprocher();
  assert exists (select 1 from parite_alertes where code = 'lecture:bep20' and close_le is null), 'une offre que la lecture n''explique pas';

  -- 4. les floats ne couvrent plus
  insert into soldes_floats (float_id, solde, annonce_le, source) select id, 0, now(), 'releve' from floats where actif;
  r := rapprocher();
  assert (r ->> 'couverture')::numeric < 0 and exists (select 1 from parite_alertes where code = 'couverture' and close_le is null), r;
  -- un float sans solde récent : le total ne se dit pas (jamais 0 à la place de « non connu »)
  update soldes_floats set annonce_le = now() - interval '3 days';
  r := rapprocher();
  assert r ->> 'floats' is null and r ->> 'couverture' is null, r;

  -- la page publique : sans compte, des totaux et des transactions, aucun numéro
  assert has_function_privilege('anon', 'preuve_de_reserve()', 'execute'), 'la preuve se lit sans compte';
  assert not has_function_privilege('anon', 'rapprocher()', 'execute') and not has_function_privilege('authenticated', 'totem_solde_float(text, text, text, numeric, timestamptz, text, bigint)', 'execute');
  assert not has_table_privilege('anon', 'soldes_floats', 'select') and not has_table_privilege('authenticated', 'parite_alertes', 'select');
  r := preuve_de_reserve();
  assert r::text !~ '677000000' and r::text !~ '677112233', 'aucun numéro de float ni d''alerte sur la page publique';
  assert jsonb_array_length(r -> 'lignes') > 0 and (r -> 'lignes' -> 0) ? 'empreinte' and not ((r -> 'lignes' -> 0) ? 'adresse_vue'), r -> 'lignes' -> 0;
  raise notice '✓ 11.38 la parité à trois colonnes : écart nul quand la chaîne montre le registre ; inconnue, retard, refus, montant faux, lecture incomplète, floats courts — chacun son alarme, et le SMS une fois';
end $$;
rollback;

-- 11.39 · les règles du marché (0017). Chaque garde-fou refuse avec SA règle et
-- SA borne : bande de prix par côté, taille maximale, plafond au marché, ordres
-- ouverts par compte ; un ordre au marché ne s'exécute pas hors de la bande
-- d'exécution ; le prix de référence est une moyenne de cinq minutes, puis le
-- dernier échange, puis celui de l'équipe, puis rien (le premier ordre fait le
-- marché).
begin;
do $$
declare r jsonb; a uuid := 'a1700000-0000-0000-0000-000000000001'; b uuid := 'a1700000-0000-0000-0000-000000000002';
        ref numeric;
begin
  insert into comptes (id, telephone, nom, palier) values (a, '670170001', 'Règle A', 2), (b, '670170002', 'Règle B', 2);
  perform _mouvement(a, 'XAFe', 50000000, 0, 'essai', 'essai', 'r1');
  perform _mouvement(b, 'USDT', 50000, 0, 'essai', 'essai', 'r2');
  -- un carnet propre : les ordres des scénarios précédents sortent (la transaction est annulée à la fin)
  update ordres set etat = 'annule', restant = 0, bloque = 0 where etat in ('ouvert', 'partiel');
  delete from executions;
  update parametres set valeur = valeur || '{"prix_reference": null}' where cle = 'marche';
  assert _prix_reference() is null, 'sans échange ni référence posée : pas de référence';

  -- 1. sans référence, pas de bande : le premier ordre fait le marché
  perform set_config('xafe.compte', b::text, true);
  r := placer_ordre('vente', 'limite', 100, 600, 'v-600');
  perform set_config('xafe.compte', a::text, true);
  r := placer_ordre('achat', 'limite', 100, 600, 'a-600');
  assert jsonb_array_length(r -> 'executions') = 1, r;
  assert _prix_reference() = 600, format('la référence est l''échange : %s', _prix_reference());

  -- 2. la moyenne pondérée de cinq minutes : un échange minuscule au bord ne déplace pas la bande d'un coup
  perform set_config('xafe.compte', b::text, true);
  r := placer_ordre('vente', 'limite', 10, 650, 'v-650');
  perform set_config('xafe.compte', a::text, true);
  r := placer_ordre('achat', 'limite', 10, 650, 'a-650');
  ref := _prix_reference();
  assert ref = round((60000 + 6500) / 110.0, 2), format('moyenne pondérée attendue (604,55, pas 650), lu %s', ref);

  -- 3. la bande de prix, par côté (achat 80 %–110 %, vente 90 %–120 %)
  begin perform placer_ordre('achat', 'limite', 10, round(ref * 1.15 / 0.05) * 0.05, 'a-haut'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'prix hors de la bande', sqlerrm; end;
  begin perform placer_ordre('achat', 'limite', 10, round(ref * 0.75 / 0.05) * 0.05, 'a-bas'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'prix hors de la bande', sqlerrm; end;
  r := placer_ordre('achat', 'limite', 10, round(ref * 0.85 / 0.05) * 0.05, 'a-dans');
  assert r -> 'ordre' ->> 'etat' = 'ouvert', r;
  perform set_config('xafe.compte', b::text, true);
  begin perform placer_ordre('vente', 'limite', 10, round(ref * 0.85 / 0.05) * 0.05, 'v-bas'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'prix hors de la bande', sqlerrm; end;
  -- une vente à 108 % de la référence est permise au carnet…
  r := placer_ordre('vente', 'limite', 50, round(ref * 1.08 / 0.05) * 0.05, 'v-loin');
  assert r -> 'ordre' ->> 'etat' = 'ouvert', r;

  -- 4. …mais un achat AU MARCHÉ ne la prend pas : elle est au-delà de la bande d'exécution (5 %)
  perform set_config('xafe.compte', a::text, true);
  r := placer_ordre('achat', 'marche', 10, null, 'a-marche');
  assert jsonb_array_length(r -> 'executions') = 0 and r -> 'ordre' ->> 'etat' = 'annule', format('rien dans la bande : %s', r);
  assert (select quantite from _parcourir_carnet(a, 'achat', 10, null)) = 0, 'le devis de l''achat rapide suit la même bande';

  -- 5. la taille maximale, le plafond au marché, les ordres ouverts
  update parametres set valeur = valeur || '{"quantite_max": 5000, "marche_quantite_max": 1000, "ordres_ouverts_max": 2}' where cle = 'marche';
  begin perform placer_ordre('achat', 'limite', 6000, round(ref / 0.05) * 0.05, 'a-gros'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'quantité trop grande', sqlerrm; end;
  begin perform placer_ordre('achat', 'marche', 2000, null, 'a-gros-marche'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'ordre au marché trop grand', sqlerrm; end;
  r := placer_ordre('achat', 'limite', 10, round(ref * 0.9 / 0.05) * 0.05, 'a-deux');   -- le second ouvert d'A
  begin perform placer_ordre('achat', 'limite', 10, round(ref * 0.9 / 0.05) * 0.05, 'a-trois'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'trop d''ordres ouverts', sqlerrm; end;
  r := placer_ordre('achat', 'marche', 10, null, 'a-marche-2');   -- un ordre au marché ne reste pas ouvert : il ne compte pas

  -- 6. la référence posée par l'équipe, quand aucun échange n'existe
  delete from executions;
  update parametres set valeur = valeur || '{"prix_reference": 600}' where cle = 'marche';
  assert _prix_reference() = 600;
  perform set_config('xafe.compte', b::text, true);
  begin perform placer_ordre('vente', 'limite', 10, 500, 'v-500'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'prix hors de la bande', sqlerrm; end;

  -- 7. la règle se lit : l'écran reçoit la référence et les bornes
  perform set_config('xafe.compte', a::text, true);
  assert (parametres_publics() -> 'marche' ->> 'reference')::numeric = 600 and parametres_publics() -> 'marche' ? 'bande_achat', parametres_publics() -> 'marche';
  assert (cotation() ->> 'reference')::numeric = 600, cotation();
  -- un paramètre réécrit en entier, sans les clés des règles, ne fait disparaître aucun garde-fou
  update parametres set valeur = '{"paire": "USDT/XAFe", "pas_prix": 0.05, "quantite_min": 10, "ouvert": true}' where cle = 'marche';
  assert (_marche() ->> 'ordres_ouverts_max')::int = 200 and _marche() -> 'bande_achat' = '[0.8, 1.1]'::jsonb, _marche();
  -- et un paramètre abîmé ne s'écrit pas
  begin perform _verifier_parametre('marche', parametre('marche') || '{"bande_achat": [1.2, 1.1]}'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paramètre invalide', sqlerrm; end;
  raise notice '✓ 11.39 les règles du marché : bande de prix par côté, bande d''exécution au marché (devis compris), taille maximale, plafond au marché, ordres ouverts ; la référence est une moyenne de cinq minutes, puis l''échange, puis celle de l''équipe, puis aucune';
end $$;
rollback;

-- 11.40 · le registre des réseaux (0018). Un réseau du registre, et lui seul,
-- entre dans une adresse, un retrait, la réserve. Un réseau FERMÉ ne montre pas
-- d'adresse et refuse un retrait ; une adresse a la forme de SA famille (une
-- adresse 0x vaut pour Base comme pour BSC, jamais pour Tron). Ouvrir un réseau
-- exige qu'un veilleur sache le lire et que le contrat XAFe y soit posé ; le
-- réseau maison ne se ferme pas. Le veilleur reçoit chaque réseau configuré.
begin;
select _mouvement('22222222-2222-2222-2222-222222222222', 'USDT', 500, 0, 'essai', 'essai', '11.40');
update parametres set valeur = jsonb_set(valeur, '{retraits_ouverts}', 'true') where cle = 'crypto';
do $$
declare r jsonb; c jsonb;
begin
  -- un réseau que le registre ne connaît pas n'entre nulle part, même écrit à la main
  begin
    insert into adresses_libres (actif, reseau, adresse, indice) values ('USDT', 'dogecoin', 'D' || md5('x'), 1);
    raise exception 'aurait dû refuser';
  exception when foreign_key_violation then null; end;

  -- l'écran ne propose que les réseaux ouverts, le maison en premier
  perform set_config('xafe.compte', '22222222-2222-2222-2222-222222222222', true);
  r := parametres_publics() -> 'crypto' -> 'reseaux';
  assert (select array_agg(x ->> 'id' order by o) from jsonb_array_elements(r) with ordinality t(x, o)) = array['bep20', 'trc20'], r;
  assert (r -> 0 ->> 'maison')::boolean and not (r -> 1 ->> 'maison')::boolean, r;

  -- Base est au registre, mais fermé : pas d'adresse, pas de retrait
  insert into adresses_libres (actif, reseau, adresse, indice) values ('USDT', 'base', '0xbA5e00000000000000000000000000000000ba5e', 0);
  assert adresse_depot('USDT', 'base') is null, 'réseau fermé : aucune adresse';
  begin
    perform _demander_retrait_crypto('USDT', 'base', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 10, null);
    raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'réseau pas encore ouvert', sqlerrm; end;
  begin
    perform _demander_retrait_crypto('USDT', 'dogecoin', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 10, null);
    raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'réseau inconnu', sqlerrm; end;

  -- l'équipe ouvre Base : refusé tant que le contrat XAFe n'y est pas posé
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000003', true);   -- le support : voit, ne règle pas
  begin perform admin_activer_reseau('base', true); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'accès non autorisé', sqlerrm; end;
  assert jsonb_array_length(admin_reseaux()) = 6, 'le support voit le registre';
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000001', true);   -- le super admin
  begin perform admin_activer_reseau('base', true); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'réseau pas configuré', sqlerrm; end;
  -- Solana ne s'ouvre pas, même configuré : aucun veilleur ne sait le lire
  update parametres set valeur = valeur || '{"solana": {"xafe": "So1anaXafe1111111111111111111111111111111"}, "base": {"xafe": "0xbase", "noeud": "https://base.example"}}' where cle = 'chaine';
  begin perform admin_activer_reseau('solana', true); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'réseau pas encore lisible', sqlerrm; end;
  -- le réseau maison ne se ferme pas
  begin perform admin_activer_reseau('bep20', false); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'le réseau maison ne se ferme pas', sqlerrm; end;
  r := admin_activer_reseau('base', true);
  assert (r ->> 'actif')::boolean, r;
  assert exists (select 1 from journal_admin where action = 'ouvrir_reseau' and cible = 'base'), 'l''ouverture se journalise';

  -- le veilleur reçoit Base, avec sa famille et son compte de dérivation ; pas Solana
  c := chaine_configuration() -> 'reseaux';
  assert c -> 'base' ->> 'famille' = 'evm' and (c -> 'base' ->> 'compte_hd')::int = 2 and c -> 'base' ->> 'noeud' = 'https://base.example', c;
  assert not (c ? 'solana'), 'un réseau qu''aucun veilleur ne lit ne lui est pas donné';
  assert (planifier_veilleurs() -> 'reseaux') ? 'base' and not ((planifier_veilleurs() -> 'reseaux') ? 'solana'), planifier_veilleurs();

  -- ouvert, Base donne son adresse et accepte un retrait — une adresse 0x, pas une adresse Tron
  perform set_config('xafe.compte', '22222222-2222-2222-2222-222222222222', true);
  assert adresse_depot('USDT', 'base') = '0xbA5e00000000000000000000000000000000ba5e', 'Base ouvert : l''adresse préparée';
  begin
    perform _demander_retrait_crypto('USDT', 'base', 'TPL66VK2gCXNCD7EJg9pgJRfqcRazjhUZY', 10, null);
    raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'adresse invalide', sqlerrm; end;
  r := _demander_retrait_crypto('USDT', 'base', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 10, 'k-11.40');
  assert r ->> 'reseau' = 'base' and r ->> 'etat' = 'en_attente', r;
  assert jsonb_array_length(chaine_retraits_a_envoyer('base')) = 1, 'le veilleur de Base le voit';
  assert (select array_agg(x ->> 'id' order by o) from jsonb_array_elements(parametres_publics() -> 'crypto' -> 'reseaux') with ordinality t(x, o))
         = array['bep20', 'trc20', 'base'], parametres_publics() -> 'crypto' -> 'reseaux';
  assert _explorateur('base') = 'https://sepolia.basescan.org', 'réseau d''essai : l''explorateur d''essai';
  -- le contrat XAFe de chaque réseau ouvert est dit à l'écran (0019) : de quoi l'ajouter à son wallet
  assert (select x ->> 'contrat_xafe' from jsonb_array_elements(parametres_publics() -> 'crypto' -> 'reseaux') x where x ->> 'id' = 'base') = '0xbase', parametres_publics() -> 'crypto' -> 'reseaux';

  -- la parité compte chaque réseau où le contrat est posé
  assert (select array_agg(x ->> 'reseau') from jsonb_array_elements(_parite_json(false) -> 'contrats') x) @> array['base'], _parite_json(false) -> 'contrats';

  -- fermé à nouveau : plus d'adresse ni de retrait neuf, mais le retrait déjà demandé part toujours
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000001', true);
  perform admin_activer_reseau('base', false);
  perform set_config('xafe.compte', '22222222-2222-2222-2222-222222222222', true);
  assert adresse_depot('USDT', 'base') is null, 'fermé : l''adresse ne se montre plus';
  assert jsonb_array_length(chaine_retraits_a_envoyer('base')) = 1, 'fermer n''abandonne pas un retrait en route';
  raise notice '✓ 11.40 le registre des réseaux : un réseau inconnu n''entre nulle part ; fermé, pas d''adresse ni de retrait ; une adresse a la forme de sa famille ; ouvrir exige un veilleur et un contrat ; le maison ne se ferme pas ; le veilleur et la parité suivent le registre';
end $$;
rollback;

-- 11.41 · un numéro sans code SMS ni délai (0020), le réglage de la phase
-- d'essai : le numéro tapé est retenu et reçoit une sortie tout de suite. Ce
-- qui reste vrai : un numéro n'est qu'à un compte, il a la forme de son
-- opérateur, la sortie exige le code secret. Remis à « avec code », la garde
-- d'avant revient telle quelle.
begin;
update parametres set valeur = '{"verification_sms": false, "delai_heures": 0}' where cle = 'numeros';
do $$
declare r jsonb; v_id uuid; c uuid := 'a1410000-0000-0000-0000-000000000001'; d uuid := 'a1410000-0000-0000-0000-000000000002';
begin
  insert into comptes (id, telephone, nom, palier) values (c, '670141001', 'Sans code', 2), (d, '670141002', 'Autre', 2);
  perform set_config('xafe.compte', c::text, true);
  r := ajouter_numero('om', '699141001');
  assert r ->> 'verifie_le' is not null and (r ->> 'actif_des')::timestamptz <= now(), format('retenu et actif tout de suite : %s', r);
  assert not exists (select 1 from messages_sortants where numero = '699141001'), 'aucun SMS ne part';
  assert (ajouter_numero('om', '699141001') ->> 'id') = r ->> 'id', 'le redemander rend le même, sans faute';
  begin perform ajouter_numero('mtn', '699141002'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'numéro invalide', sqlerrm; end;
  -- un numéro n'est qu'à un compte
  perform set_config('xafe.compte', d::text, true);
  begin perform ajouter_numero('om', '699141001'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'ce numéro est déjà sur un autre compte', sqlerrm; end;
  -- l'écran lit le réglage
  assert parametres_publics() -> 'numeros' = '{"verification_sms": false, "delai_heures": 0}'::jsonb, parametres_publics() -> 'numeros';
  -- remis à « avec code » : la garde d'avant revient (pas de numéro retenu sans code)
  update parametres set valeur = '{"verification_sms": true, "delai_heures": 24}' where cle = 'numeros';
  r := ajouter_numero('mtn', '677141003');
  assert r ->> 'verifie_le' is null and (r ->> 'actif_des')::timestamptz > now() + interval '23 hours', r;
  assert exists (select 1 from messages_sortants where numero = '677141003'), 'le code SMS part';
  -- un paramètre abîmé ne s'écrit pas
  begin perform _verifier_parametre('numeros', '{"verification_sms": "non", "delai_heures": 0}'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paramètre invalide', sqlerrm; end;
  raise notice '✓ 11.41 sans code SMS ni délai : le numéro tapé est retenu et actif tout de suite, sans SMS ; il reste à un seul compte et à son opérateur ; remis « avec code », la garde d''avant revient';
end $$;
rollback;

-- 11.42 · la bêta (0021). Un nouvel inscrit reçoit son argent de test, dit
-- comme tel dans son historique ; ses XAFe passent par le registre (une
-- émission, une frappe dans la réserve) et la parité les compte à part. Les
-- dépôts réels sont fermés, sauf pour un compte autorisé. Un robot ou un
-- compte de test ne reçoit rien et n'entre pas dans les chiffres des clients.
-- L'équipe dote un compte, avec son droit, et rien hors de la bêta.
begin;
update parametres set valeur = '{"actif": true, "message": "bêta", "dotation": {"XAFe": 1000000, "USDT": 2000}, "depots_reels": false}' where cle = 'beta';  -- 11.42 éprouve la dotation de 0021 telle quelle
do $$
declare r jsonb; c uuid := 'b1420000-0000-0000-0000-000000000001'; rb uuid := 'b1420000-0000-0000-0000-000000000002';
        v_registre numeric; v_test numeric;
begin
  v_registre := circulation(); v_test := _xafe_de_test();
  insert into comptes (id, telephone, nom, palier) values (c, '670142001', 'Testeur bêta', 2);
  insert into comptes (id, telephone, nom, palier, genre) values (rb, '670142002', 'Robot', 2, 'robot');
  assert solde(c, 'XAFe', 'dispo') = 1000000 and solde(c, 'USDT', 'dispo') = 2000, 'la dotation d''inscription';
  assert not exists (select 1 from soldes where compte_id = rb and disponible > 0), 'un robot ne reçoit rien à l''inscription';
  assert circulation() = v_registre + 1000000, 'les XAFe de test passent par le registre';
  assert _xafe_de_test() = v_test + 1000000, 'et sont comptés à part';
  assert exists (select 1 from reserve_chaine where reference = _reference_dotation((select max(id) from dotations_beta)) and operation = 'frapper'),
         'une frappe attend dans la réserve : registre et chaîne restent égaux';
  assert (_parite_json(false) ->> 'xafe_de_test')::numeric = _xafe_de_test(), 'la page de la preuve dit la part de test';

  -- l'historique le dit
  perform set_config('xafe.compte', c::text, true);
  assert exists (select 1 from jsonb_array_elements(mon_historique()) x where x ->> 'nature' = 'dotation'
                   and (x -> 'detail' ->> 'xafe')::numeric = 1000000), mon_historique();
  -- l'écran sait que c'est la bêta, et que CE compte ne paie pas en vrai
  r := parametres_publics() -> 'beta';
  assert (r ->> 'actif')::boolean and not (r ->> 'depots_reels')::boolean and (r -> 'dotation' ->> 'XAFe')::numeric = 1000000, r;

  -- les dépôts réels : fermés, sauf pour un compte autorisé
  begin perform ouvrir_depot('mtn', 'k-11.42'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'dépôts fermés pendant la bêta', sqlerrm; end;
  update comptes set argent_reel = true where id = c;
  assert (parametres_publics() -> 'beta' ->> 'depots_reels')::boolean, 'autorisé : l''écran le sait';
  begin perform ouvrir_depot('mtn', 'k-11.42b');
  exception when others then assert sqlerrm <> 'dépôts fermés pendant la bêta', 'autorisé : la bêta ne bloque plus'; end;

  -- l'équipe dote : le support non, le super admin oui, avec ses bornes
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000003', true);
  begin perform admin_doter(c, 500000, 0, 'essai'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'accès non autorisé', sqlerrm; end;
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000001', true);
  r := admin_doter(c, 500000, 100.5, 'pour trader');
  assert (r ->> 'ok')::boolean and solde(c, 'XAFe', 'dispo') = 1500000 and solde(c, 'USDT', 'dispo') = 2100.5, r;
  assert exists (select 1 from journal_admin where action = 'doter' and cible = c::text), 'la dotation se journalise';
  begin perform admin_doter(c, 200000000, 0); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'montant trop grand', sqlerrm; end;
  begin perform admin_doter(c, 10.5, 0); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'montant invalide', sqlerrm; end;

  -- les chiffres de l'équipe : les clients, pas les robots
  assert not exists (select 1 from jsonb_array_elements(admin_clients()) x where (x ->> 'id')::uuid = rb), 'un robot n''est pas un client';
  assert exists (select 1 from jsonb_array_elements(admin_clients(null, 100, 'robots')) x where (x ->> 'id')::uuid = rb), 'il a son filtre';

  -- un paramètre abîmé ne s'écrit pas ; hors bêta, pas d'argent de test
  begin perform _verifier_parametre('beta', '{"actif": "oui"}'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paramètre invalide', sqlerrm; end;
  update parametres set valeur = valeur || '{"actif": false}' where cle = 'beta';
  begin perform admin_doter(c, 1000, 0); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'la bêta n''est pas active', sqlerrm; end;
  raise notice '✓ 11.42 la bêta : la dotation d''inscription passe par le registre et se dit dans l''historique, la parité la compte à part ; dépôts réels fermés sauf compte autorisé ; l''équipe dote avec son droit et ses bornes ; robots hors des chiffres ; rien hors bêta';
end $$;
rollback;

-- 11.43 · le vrai dollar (0022). 1 EUR = 655,957 XAF, fixe : le prix d'un
-- USDT se déduit du cours EUR/USD. Un cours posé devient la référence du
-- marché ; un cours aberrant ou un saut trop grand est noté, pas posé ; la
-- prime de l'équipe se pose par-dessus ; sans réseau, rien ne casse ; seule
-- l'équipe avec son droit force un cours.
begin;
update parametres set valeur = '{"actif": true, "prime": 0, "saut_max": 0.05}' where cle = 'cours';
delete from cours_externes;
do $$
declare c cours_externes; r jsonb;
begin
  c := _poser_le_cours('frankfurter', 1.1253, '2026-10-29');
  -- 655,957 / 1,1253 = 582,9174… ; au pas du marché
  assert c.pose and c.usd_xaf = 582.9174 and c.prix = round(582.9174 / (parametre('marche') ->> 'pas_prix')::numeric) * (parametre('marche') ->> 'pas_prix')::numeric, to_jsonb(c);
  assert (parametre('marche') ->> 'prix_reference')::numeric = c.prix, 'le cours posé devient la référence du marché';
  assert (parametre('marche') ->> 'paire') = 'USDT/XAFe' and parametre('marche') ? 'pas_prix', 'le reste des règles ne bouge pas';
  assert (cotation() -> 'cours_reel' ->> 'usd_xaf')::numeric = 582.9174, 'la cotation publique dit le vrai dollar';

  -- un cours aberrant, un saut de plus de 5 % : notés, pas posés
  c := _poser_le_cours('frankfurter', 9, null);
  assert not c.pose and c.erreur like 'cours aberrant%', to_jsonb(c);
  c := _poser_le_cours('frankfurter', 1.0, null);
  assert not c.pose and c.erreur like 'saut de%', to_jsonb(c);
  assert (parametre('marche') ->> 'prix_reference')::numeric = (_cours_reel() ->> 'prix')::numeric
     and (_cours_reel() ->> 'eur_usd')::numeric = 1.1253, 'la référence garde le dernier cours sain';
  -- un petit mouvement passe
  c := _poser_le_cours('frankfurter', 1.12, null);
  assert c.pose, to_jsonb(c);

  -- la prime de l'équipe, par-dessus
  update parametres set valeur = valeur || '{"prime": 0.02}' where cle = 'cours';
  c := _poser_le_cours('frankfurter', 1.12, null);
  assert c.pose and c.prix > c.usd_xaf * 1.019 and c.prix < c.usd_xaf * 1.021, to_jsonb(c);

  -- sans l'extension http (cette base) : noté, rien ne casse
  r := relever_le_cours();
  if to_regprocedure('extensions.http_get(character varying)') is null then
    assert not (r ->> 'pose')::boolean and r ->> 'erreur' like 'extension http absente%', r;
  end if;
  update parametres set valeur = valeur || '{"actif": false}' where cle = 'cours';
  assert relever_le_cours() = '{"actif": false}'::jsonb, 'éteint : rien ne part';

  -- l'équipe : le support voit, ne force pas ; le super admin force, journalisé
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000003', true);
  assert jsonb_array_length(admin_cours() -> 'releves') >= 5, 'l''historique des relevés';
  begin perform admin_poser_le_cours(1.0); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'accès non autorisé', sqlerrm; end;
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000001', true);
  r := admin_poser_le_cours(1.0);
  assert (r ->> 'ok')::boolean and (parametre('marche') ->> 'prix_reference')::numeric = (r ->> 'prix')::numeric, r;
  assert exists (select 1 from journal_admin where action = 'poser_le_cours'), 'le cours forcé se journalise';
  begin perform admin_poser_le_cours(7); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'cours invalide', sqlerrm; end;
  begin perform _verifier_parametre('cours', '{"actif": true, "prime": 0.5, "saut_max": 0.05}'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paramètre invalide', sqlerrm; end;
  raise notice '✓ 11.43 le vrai dollar : 655,957 / EUR/USD devient la référence du marché ; aberrant et saut refusés et notés ; prime par-dessus ; sans réseau rien ne casse ; seule l''équipe force un cours';
end $$;
rollback;

-- 11.44 · le marché vivant (0023). Quinze robots, dotés une fois : le teneur
-- cote des deux côtés autour du vrai dollar, dans la bande, et ne recote pas
-- ce qui n'a pas bougé ; les traders échangent avec lui ; les soldes restent
-- justes ; robots éteints ou bêta finie, tout est retiré ; le ménage n'efface
-- que des ordres de robot sans échange, et rien ne se perd.
begin;
update parametres set valeur = valeur || '{"actif": true}' where cle = 'beta';
select setseed(0.44);
do $$
declare r jsonb; v_ref numeric; v_tn uuid := _robot_teneur(); n int; v_exec bigint; v_o ordres; v_bas numeric; v_haut numeric;
begin
  assert (select count(*) from robots) = 15 and (select count(*) from robots where role = 'teneur') = 1, 'quinze robots, un teneur';
  assert (select count(*) from comptes c join robots r on r.compte_id = c.id where c.genre = 'robot') = 15, 'tous du genre robot';
  assert not exists (select 1 from dotations_beta d join robots b on b.compte_id = d.compte_id), 'pas d''argent avant le premier tour';

  -- l'ancre : un prix de référence posé, dans la bande du carnet tel qu'il est
  v_ref := coalesce(_prix_reference(), 600);
  update parametres set valeur = valeur || jsonb_build_object('prix_reference', v_ref) where cle = 'marche';
  -- un premier tour sans hasard : seul le teneur agit
  update parametres set valeur = jsonb_set(jsonb_set(jsonb_set(jsonb_set(valeur, '{derive,volatilite}', '0'), '{derive,choc_probabilite}', '0'),
                                           '{traders,probabilite}', '0'),
                                           -- les réglages de 0023 : cinq niveaux (0026 en pose vingt, éprouvés en 11.47)
                                           '{teneur}', '{"ecart": 0.004, "niveaux": 5, "pas": 0.0015, "taille_usdt": 120, "tolerance": 0.0006, "inventaire": 0.01}')
   where cle = 'robots';
  update robots_etat set derive = 0 where id = 1;
  r := tourner_les_robots();
  assert (r ->> 'actif')::boolean and (r ->> 'poses')::int = 10 and (r ->> 'refus')::int = 0, r;
  assert solde(v_tn, 'XAFe', 'dispo') + solde(v_tn, 'XAFe', 'bloque') <= 22000000
     and (select xafe from dotations_beta where compte_id = v_tn) = 22000000, 'le teneur est doté au premier tour';
  assert (select count(*) from dotations_beta d join robots b on b.compte_id = d.compte_id) = 15 and _doter_les_robots() = 0, 'une seule fois';
  assert (select count(*) from ordres where compte_id = v_tn and etat = 'ouvert' and cote = 'achat') = 5
     and (select count(*) from ordres where compte_id = v_tn and etat = 'ouvert' and cote = 'vente') = 5, 'cinq niveaux de chaque côté';
  select max(prix) into v_bas from ordres where compte_id = v_tn and etat = 'ouvert' and cote = 'achat';
  select min(prix) into v_haut from ordres where compte_id = v_tn and etat = 'ouvert' and cote = 'vente';
  assert v_bas < (r ->> 'milieu')::numeric and v_haut > (r ->> 'milieu')::numeric and v_bas < v_haut, r;
  assert v_haut / v_bas - 1 between 0.003 and 0.006, format('l''écart du teneur : %s / %s', v_bas, v_haut);

  -- rien n'a bougé : rien n'est recoté (les ordres gardent leur place dans la file)
  n := (select count(*) from ordres where compte_id = v_tn);
  r := tourner_les_robots();
  assert (r ->> 'poses')::int = 0 and (r ->> 'annules')::int = 0 and (select count(*) from ordres where compte_id = v_tn) = n, r;

  -- l'ancre monte de 2 % : le teneur suit
  update parametres set valeur = valeur || jsonb_build_object('prix_reference', round(v_ref * 1.02 / 0.05) * 0.05) where cle = 'marche';
  r := tourner_les_robots();
  assert (r ->> 'annules')::int = 10 and (r ->> 'poses')::int = 10, r;
  assert (select min(prix) from ordres where compte_id = v_tn and etat = 'ouvert' and cote = 'achat') > v_bas, 'les achats montent';

  -- les traders s'en mêlent : des échanges, avec de vrais règlements
  update parametres set valeur = jsonb_set(jsonb_set(valeur, '{traders,probabilite}', '1'), '{derive,volatilite}', '0.0005') where cle = 'robots';
  v_exec := (select count(*) from executions);
  for n in 1 .. 6 loop r := tourner_les_robots(); end loop;
  assert (select count(*) from executions) > v_exec + 5, format('des échanges : %s', (select count(*) from executions) - v_exec);
  assert (select tours from robots_etat) >= 9, 'les tours se comptent';
  assert total('XAFe') = circulation(), format('XAFe : %s en soldes, %s en circulation', total('XAFe'), circulation());
  assert not exists (select 1 from soldes where disponible < 0 or bloque < 0) and not exists (select 1 from ordres where bloque < 0), 'aucun solde négatif';
  assert not exists (select 1 from ordres o join robots b on b.compte_id = o.compte_id where o.etat in ('ouvert', 'partiel') and o.type = 'limite'
                       and o.bloque <> case when o.cote = 'achat' then round(o.restant * o.prix, 2) else o.restant end), 'le bloqué de chaque ordre juste';

  -- un testeur pose un bon prix : un robot le sert
  insert into comptes (id, telephone, nom, palier) values ('b1440000-0000-0000-0000-000000000001', '670144001', 'Testeur', 2);
  r := _placer_ordre('b1440000-0000-0000-0000-000000000001', 'achat', 'limite', 50,
                        (select min(prix) from ordres where compte_id = v_tn and etat in ('ouvert', 'partiel') and cote = 'vente'), null, null);
  assert jsonb_array_length(r -> 'executions') > 0 and solde('b1440000-0000-0000-0000-000000000001', 'USDT', 'dispo') > 2000, format('le testeur est servi : %s', r);

  -- éteints : tout est retiré au tour suivant, et plus rien ne bouge
  update parametres set valeur = valeur || '{"actif": false}' where cle = 'robots';
  r := tourner_les_robots();
  assert not (r ->> 'actif')::boolean and not exists (select 1 from ordres o join robots b on b.compte_id = o.compte_id
                                                        where o.etat in ('ouvert', 'partiel')), r;
  assert not exists (select 1 from soldes s join robots b on b.compte_id = s.compte_id where s.bloque <> 0), 'plus rien de bloqué';
  -- bêta finie : de même
  update parametres set valeur = valeur || '{"actif": true}' where cle = 'robots';
  r := tourner_les_robots();
  assert (r ->> 'actif')::boolean, r;
  update parametres set valeur = valeur || '{"actif": false}' where cle = 'beta';
  r := tourner_les_robots();
  assert not (r ->> 'actif')::boolean and not exists (select 1 from ordres o join robots b on b.compte_id = o.compte_id
                                                        where o.etat in ('ouvert', 'partiel')), 'hors bêta, aucun ordre de robot';

  -- le ménage : seuls les ordres de robot sans échange, vieux de deux jours ; rien ne se perd
  update ordres set maj_le = now() - interval '3 days' where compte_id in (select compte_id from robots);
  update ordres set maj_le = now() - interval '3 days' where compte_id = 'b1440000-0000-0000-0000-000000000001';
  n := (select count(*) from ordres o join robots b on b.compte_id = o.compte_id where o.etat = 'annule' and o.executee = 0);
  r := menage_des_robots();
  assert (r ->> 'ordres')::int = n and n > 0, r;
  assert (r ->> 'ecritures')::int > 0, r;
  assert exists (select 1 from ordres where compte_id = 'b1440000-0000-0000-0000-000000000001'), 'rien d''un testeur ne s''efface';
  assert exists (select 1 from ordres o join robots b on b.compte_id = o.compte_id where o.executee > 0), 'ce qui a échangé reste';
  assert not exists (select 1 from soldes s where s.disponible <> coalesce((select sum(disponible_delta) from ecritures x where x.compte_id = s.compte_id and x.actif = s.actif), 0)
                                             or s.bloque <> coalesce((select sum(bloque_delta) from ecritures x where x.compte_id = s.compte_id and x.actif = s.actif), 0)),
         'chaque solde vaut toujours la somme de ses écritures';
  assert total('XAFe') = circulation(), 'et la circulation tient';

  -- l'équipe : le support voit ; un paramètre abîmé ne s'écrit pas
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000003', true);
  r := admin_robots();
  assert jsonb_array_length(r -> 'robots') = 15 and (r -> 'echanges_24h' ->> 'total')::int > 0, r -> 'echanges_24h';
  begin perform _verifier_parametre('robots', parametre('robots') || '{"actif": "oui"}'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paramètre invalide', sqlerrm; end;
  perform _verifier_parametre('robots', parametre('robots'));
  -- un client ne fait pas tourner les robots
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    assert not has_function_privilege('authenticated', 'tourner_les_robots()', 'execute')
       and not has_function_privilege('authenticated', '_annuler_ordre(uuid, uuid)', 'execute')
       and has_function_privilege('authenticated', 'annuler_ordre(uuid)', 'execute'), 'les droits des robots';
  end if;
  raise notice '✓ 11.44 le marché vivant : quinze robots dotés une fois ; le teneur cote cinq niveaux de chaque côté autour du vrai dollar, ne recote pas ce qui n''a pas bougé, suit l''ancre ; les traders échangent, soldes et bloqués justes ; un testeur est servi ; éteints ou hors bêta tout est retiré ; le ménage n''efface que des ordres de robot sans échange';
end $$;
rollback;

-- 11.45 · observer la bêta (0024). Le testeur signale un problème depuis son
-- écran ; un texte vide, trop long ou trop fréquent est refusé ; un écran qui
-- n'est pas un chemin est oublié. L'équipe lit, marque vu ou réglé, et la page
-- Bêta compte les testeurs, l'argent de test, les robots et les signalements.
begin;
do $$
declare r jsonb; c uuid := 'b1450000-0000-0000-0000-000000000001'; i int;
begin
  insert into comptes (id, telephone, nom, palier) values (c, '670145001', 'Testeuse', 1);
  perform set_config('xafe.compte', c::text, true);
  r := signaler_un_probleme('Le bouton Acheter ne répond pas', '/marche?paire=USDT', 'Android 14 · Chrome 130');
  assert (r ->> 'ok')::boolean and r ->> 'reference' like 'SIG-%', r;
  r := signaler_un_probleme('  Rien ne s''affiche  ', 'javascript:alert(1)', null);
  assert (select ecran from signalements where compte_id = c order by id desc limit 1) is null, 'un écran qui n''est pas un chemin est oublié';
  assert (select texte from signalements where compte_id = c order by id desc limit 1) = 'Rien ne s''affiche', 'le texte est rogné';
  begin perform signaler_un_probleme('  ', null, null); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'texte invalide', sqlerrm; end;
  begin perform signaler_un_probleme(repeat('x', 2001), null, null); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'texte invalide', sqlerrm; end;
  for i in 3 .. 20 loop perform signaler_un_probleme('encore ' || i, null, null); end loop;
  begin perform signaler_un_probleme('le vingt et unième', null, null); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'trop de signalements', sqlerrm; end;
  -- un client ne lit pas les signalements
  begin perform admin_signalements(); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'accès non autorisé', sqlerrm; end;
  begin perform admin_beta(); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'accès non autorisé', sqlerrm; end;

  -- le support lit et traite, journalisé
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000003', true);
  r := admin_signalements('nouveau');
  assert jsonb_array_length(r) = 20 and r -> 19 ->> 'ecran' = '/marche?paire=USDT' and r -> 19 ->> 'nom' = 'Testeuse', r -> 19;
  r := admin_traiter_signalement((select min(id) from signalements where compte_id = c), 'regle', 'corrigé dans la version du 18');
  assert r ->> 'etat' = 'regle' and exists (select 1 from journal_admin where action = 'traiter_signalement'), r;
  begin perform admin_traiter_signalement(1, 'perdu'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'état invalide', sqlerrm; end;

  -- la page Bêta
  r := admin_beta();
  assert (r -> 'testeurs' ->> 'total')::int = (select count(*) from comptes where not maison and genre = 'client' and ferme_le is null), r -> 'testeurs';
  assert (r -> 'testeurs' ->> 'nouveaux_24h')::int >= 1, r -> 'testeurs';
  assert (r -> 'signalements' ->> 'nouveaux')::int = 19 and (r -> 'signalements' ->> 'regles')::int = 1, r -> 'signalements';
  assert jsonb_array_length(r -> 'robots' -> 'robots') = 15 and r ? 'cours' and r -> 'argent_de_test' ? 'xafe_robots', r;
  assert jsonb_array_length(r -> 'derniers_signalements') = 20, 'le support voit les derniers signalements';
  raise notice '✓ 11.45 observer la bêta : le testeur signale depuis son écran (texte rogné, écran douteux oublié, vingt par jour) ; l''équipe lit et traite, journalisé ; la page Bêta compte testeurs, argent de test, robots et signalements';
end $$;
rollback;

-- 11.46 · le graphique (0025). Avant le premier échange, le cours de
-- référence jour par jour (la BCE), dit « reference » ; après, les échanges,
-- dits « marche ». Les bougies sont datées, rangées, et se lisent page par
-- page vers le passé ; un intervalle inconnu est refusé ; le relevé de
-- l'heure entre dans l'historique.
begin;
do $$
declare r jsonb; p jsonb; v_debut date; i int; t0 timestamptz; t1 timestamptz;
begin
  -- quatre cents jours de cours avant le premier échange de cette base
  select (min(cree_le) at time zone 'Africa/Douala')::date into v_debut from executions;
  v_debut := coalesce(v_debut, current_date);
  for i in 1 .. 400 loop
    perform _noter_cours_du_jour(v_debut - i, round((1.10 + 0.05 * sin(i / 30.0))::numeric, 6), 'bce');
  end loop;
  r := bougies('1j', null, 1000);
  assert jsonb_array_length(r -> 'bougies') > 400, jsonb_array_length(r -> 'bougies');
  assert r -> 'bougies' -> 0 ->> 'source' = 'reference', 'le plus ancien est le cours de référence';
  assert r -> 'bougies' -> -1 ->> 'source' = 'marche' or not exists (select 1 from executions), 'le plus récent, le marché';
  assert not exists (select 1 from jsonb_array_elements(r -> 'bougies') b
                      where (b ->> 'h')::numeric < greatest((b ->> 'o')::numeric, (b ->> 'c')::numeric)
                         or (b ->> 'l')::numeric > least((b ->> 'o')::numeric, (b ->> 'c')::numeric)), 'haut et bas encadrent chaque bougie';
  -- rangées, sans doublon
  assert (select bool_and(a < b) from (select (x ->> 't')::timestamptz a, lead((x ->> 't')::timestamptz) over (order by n) b
                                         from jsonb_array_elements(r -> 'bougies') with ordinality as e(x, n)) z where b is not null), 'rangées, une par jour';
  -- la référence vaut 655,957 / EUR/USD
  assert abs((r -> 'bougies' -> 0 ->> 'c')::numeric - 655.957 / round((1.10 + 0.05 * sin(400 / 30.0))::numeric, 6)) < 0.01, r -> 'bougies' -> 0;

  -- page par page vers le passé : la page d'avant s'arrête juste avant la première bougie de celle-ci
  p := bougies('1j', null, 50);
  t0 := (p -> 'bougies' -> 0 ->> 't')::timestamptz;
  assert jsonb_array_length(p -> 'bougies') = 50 and (p ->> 'plus_ancien')::boolean, p ->> 'plus_ancien';
  p := bougies('1j', t0, 50);
  t1 := (p -> 'bougies' -> -1 ->> 't')::timestamptz;
  assert t1 < t0 and jsonb_array_length(p -> 'bougies') = 50, format('%s / %s', t1, t0);
  -- semaines et mois : moins de bougies, les mêmes années
  assert jsonb_array_length(bougies('1s', null, 1000) -> 'bougies') between 55 and 62, 'environ 58 semaines';
  assert jsonb_array_length(bougies('1M', null, 1000) -> 'bougies') between 13 and 16, 'environ 14 mois';
  -- à l'heure, seulement le marché
  assert not exists (select 1 from jsonb_array_elements(bougies('1h', null, 1000) -> 'bougies') b where b ->> 'source' = 'reference'), 'pas de référence à l''heure';
  begin perform bougies('2h'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'intervalle invalide', sqlerrm; end;

  -- un cours relevé à l'heure entre dans l'historique ; un cours posé par l'équipe, non
  perform _poser_le_cours('frankfurter', 1.0987, current_date + 1);
  assert (select eur_usd from cours_historiques where jour = current_date + 1) = 1.0987, 'le relevé de l''heure est noté';
  raise notice '✓ 11.46 le graphique : la référence BCE avant le premier échange, le marché ensuite ; bougies datées, rangées, encadrées ; page par page vers le passé ; semaines et mois ; un intervalle inconnu refusé';
end $$;
rollback;

-- 11.47 · le carnet profond (0026), et du capital pour trader. Avec ses réglages, le teneur pose vingt
-- niveaux de chaque côté, serrés près du prix, qui grossissent en s'éloignant.
begin;
update parametres set valeur = valeur || '{"actif": true}' where cle = 'beta';
select setseed(0.47);
do $$
declare r jsonb; v_tn uuid := _robot_teneur(); v_bas numeric; v_haut numeric; v_premier numeric; v_dernier numeric;
begin
  assert parametre('robots') -> 'teneur' ->> 'niveaux' = '20', parametre('robots');
  assert (parametre('beta') -> 'dotation' ->> 'USDT')::numeric = 20000, 'un nouvel inscrit reçoit 20 000 USDT de test';
  assert (parametre('robots') -> 'derive' ->> 'volatilite')::numeric = 0.0004, 'un prix plus vivant';
  update parametres set valeur = valeur || jsonb_build_object('prix_reference', coalesce(_prix_reference(), 600)) where cle = 'marche';
  update parametres set valeur = jsonb_set(jsonb_set(jsonb_set(valeur, '{derive,volatilite}', '0'), '{derive,choc_probabilite}', '0'),
                                           '{traders,probabilite}', '0') where cle = 'robots';
  update robots_etat set derive = 0 where id = 1;
  r := tourner_les_robots();
  assert (r ->> 'poses')::int = 40 and (r ->> 'refus')::int = 0, r;
  assert (select xafe from dotations_beta where compte_id = v_tn) = 22000000, 'le teneur neuf reçoit tout d''un coup';
  select max(prix), min(prix) into v_bas, v_haut from ordres where compte_id = v_tn and etat = 'ouvert' and cote = 'achat';
  select min(prix) into v_haut from ordres where compte_id = v_tn and etat = 'ouvert' and cote = 'vente';
  assert v_haut / v_bas - 1 between 0.001 and 0.0025, format('l''écart est serré : %s / %s', v_bas, v_haut);
  select restant into v_premier from ordres where compte_id = v_tn and etat = 'ouvert' and cote = 'vente' order by prix asc limit 1;
  select restant into v_dernier from ordres where compte_id = v_tn and etat = 'ouvert' and cote = 'vente' order by prix desc limit 1;
  assert v_dernier > v_premier * 5, format('les murs : %s au premier niveau, %s au dernier', v_premier, v_dernier);
  assert (select sum(restant) from ordres where compte_id = v_tn and etat = 'ouvert' and cote = 'vente') > 25000, 'plus de 25 000 USDT à la vente';
  assert jsonb_array_length(carnet(30) -> 'ventes') >= 20, 'le carnet les montre';
  raise notice '✓ 11.47 le carnet profond : vingt niveaux de chaque côté, écart serré, des murs qui grossissent, plus de 25 000 USDT de chaque côté';
end $$;
rollback;

-- 11.48 · sans plafond (0027). La plateforme ne borne pas le capital : pas
-- de taille maximale, ni au marché, ni de plafond de palier. Un seul minimum,
-- en XAFe : 1 500 par ordre, compté au prix de l'ordre (ou de la référence au
-- marché). Le reste — la bande, les ordres ouverts — tient toujours.
begin;
update parametres set valeur = (valeur - 'quantite_max' - 'marche_quantite_max') || '{"quantite_min": 0.01, "montant_min": 1500}' where cle = 'marche';
update parametres set valeur = '{"0": null, "1": null, "2": null}' where cle = 'paliers';
do $$
declare c uuid := 'b1480000-0000-0000-0000-000000000001'; v_px numeric; q numeric; r jsonb;
begin
  insert into comptes (id, telephone, nom, palier) values (c, '670148001', 'Gros trader', 0);
  perform _mouvement(c, 'XAFe', 3000000000, 0, 'essai', 'essai', '11.48');
  perform _mouvement(c, 'USDT', 3000000, 0, 'essai', 'essai', '11.48');
  v_px := round(coalesce(_prix_reference(), 600) / 0.05) * 0.05;
  assert _marche() -> 'quantite_max' = 'null'::jsonb and _marche() -> 'marche_quantite_max' = 'null'::jsonb, _marche();

  -- en dessous de 1 500 XAFe : refusé, avec la règle
  begin perform _placer_ordre(c, 'achat', 'limite', 2, v_px * 0.9 - mod(v_px * 0.9, 0.05), null, null); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'ordre trop petit', sqlerrm; end;
  -- à 1 500 XAFe (et au centime d'USDT) : accepté
  q := ceil(1500 / (v_px * 0.9 - mod(v_px * 0.9, 0.05)) * 100) / 100;
  r := _placer_ordre(c, 'achat', 'limite', q, v_px * 0.9 - mod(v_px * 0.9, 0.05), null, null);
  assert r -> 'ordre' ->> 'etat' in ('ouvert', 'execute', 'partiel'), r;

  -- deux millions d'USDT d'un coup, au bas de la bande : pas de plafond
  r := _placer_ordre(c, 'achat', 'limite', 2000000, ceil(_prix_reference() * 0.8 / 0.05) * 0.05, null, null);
  assert (r -> 'ordre' ->> 'quantite')::numeric = 2000000, r;
  -- au marché, cinq cent mille USDT : pas de plafond non plus (ce que le carnet ne sert pas est annulé)
  r := _placer_ordre(c, 'vente', 'marche', 500000, null, null, null);
  assert r ? 'ordre', r;

  -- les paliers : plus de plafond par jour
  perform set_config('xafe.compte', c::text, true);
  assert parametres_publics() -> 'paliers' = '{"0": null, "1": null, "2": null}'::jsonb, parametres_publics() -> 'paliers';
  -- un réglage sans plafond s'écrit ; un minimum négatif, non
  perform _verifier_parametre('marche', parametre('marche'));
  begin perform _verifier_parametre('marche', parametre('marche') || '{"montant_min": -5}'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paramètre invalide', sqlerrm; end;
  raise notice '✓ 11.48 sans plafond : deux millions d''USDT d''un ordre, cinq cent mille au marché, aucun plafond de palier ; un seul minimum, 1 500 XAFe par ordre, au centime d''USDT';
end $$;
rollback;

-- 11.49 · la démo vivante de TOTEM (0028). Pendant la bêta, les numéros de
-- démo (600 0x, 600 9x) sont des numéros MTN et Orange ; un terminal
-- « totem-demo » naît démo, toujours entendu ; ses floats reçoivent les
-- dépôts que la bêta ferme partout ailleurs ; un retrait vers un numéro de
-- démo passe la porte fermée des sorties, un vrai numéro non.
begin;
update parametres set valeur = valeur || '{"actif": true, "depots_reels": false}' where cle = 'beta';
update parametres set valeur = valeur || '{"ouvertes": false}' where cle = 'sortie';
insert into terminaux (id, nom) values ('totem-demo', 'TOTEM démo');
insert into floats (operateur, numero, terminal) values ('mtn', '600000001', 'totem-demo'), ('om', '600900002', 'totem-demo');
do $$
declare c uuid := 'b1490000-0000-0000-0000-000000000001'; r jsonb; n_demo uuid; n_vrai uuid;
begin
  assert (select demo from terminaux where id = 'totem-demo'), 'le terminal nommé totem-demo naît démo';
  assert not (select demo from terminaux where id = 'akwa-1'), 'un vrai boîtier ne l''est pas';
  assert operateur_du_numero('600000005') = 'mtn' and operateur_du_numero('+237 600 90 00 05') = 'om', 'les tranches de démo';
  assert operateur_du_numero('600500005') is null, 'hors des deux tranches, rien';
  assert operateur_du_numero('677123456') = 'mtn' and operateur_du_numero('699123456') = 'om', 'les vrais préfixes, inchangés';

  insert into comptes (id, telephone, nom, palier) values (c, '670149001', 'Testeur démo', 0);
  perform set_config('xafe.compte', c::text, true);
  perform ajouter_numero('mtn', '600000005');
  perform ajouter_numero('mtn', '677149002');
  select id into n_demo from numeros where compte_id = c and numero = '600000005';
  select id into n_vrai from numeros where compte_id = c and numero = '677149002';
  assert n_demo is not null and n_vrai is not null, 'les deux numéros s''ajoutent';
  -- l'écran l'apprend (0029) : il ouvre Entrer et Sortir vers la démo, au lieu de « Fermé (bêta) »
  assert (parametres_publics() -> 'beta' ->> 'demo_totem')::boolean, parametres_publics() -> 'beta';

  -- le dépôt : SEUL le float de démo est proposé, et il est « ouvert » sans boîtier qui parle
  r := ouvrir_depot('mtn', 'k-demo-1');
  assert r ->> 'float_numero' = '600000001' and r ->> 'reception' = 'ouverte', r;
  -- un dépôt posé sur un vrai float reste refusé à la source
  begin
    insert into depots (reference, compte_id, operateur, float_id, expire_le)
    values ('XAFe-DP-T11490', c, 'mtn', (select id from floats where numero = '677000000'), now() + interval '1 hour');
    raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'dépôts fermés pendant la bêta', sqlerrm; end;
  -- le SMS du float de démo est reconnu comme le SIEN (pas « ce numéro n'est pas un float »)
  r := totem_sms_recu('totem-demo', 1149, 'mtn', '600000001', '600000005', 5000, '18300000003',
                      'DEMO MTN MoMo : Vous avez recu 5 000 FCFA de TESTEUR (600000005).', now());
  assert coalesce(r ->> 'motif', '') not like '%pas un float%', r;

  -- les retraits : la porte fermée des sorties s'ouvre pour un numéro de démo, pas pour un vrai
  begin perform _demander_sortie(5000, n_vrai, 'k-demo-s1', 'TESTEUR');
        raise exception 'aurait dû refuser';
  -- (0034) l'argent de test ne sort pas en vrai, porte ouverte ou non : c'est ce refus-là qui tombe d'abord
  exception when others then assert sqlerrm = 'l''argent de test ne sort pas en vrai', sqlerrm; end;
  begin perform _demander_sortie(5000, n_demo, 'k-demo-s2', 'TESTEUR');
  exception when others then assert sqlerrm <> 'sorties pas encore ouvertes', 'un numéro de démo passe la porte : ' || sqlerrm; end;

  -- hors bêta, la démo n'existe plus : 600 n'est le numéro de personne
  update parametres set valeur = valeur || '{"actif": false}' where cle = 'beta';
  assert operateur_du_numero('600000005') is null, 'hors bêta, les tranches de démo ne sont à personne';
  raise notice '✓ 11.49 la démo vivante de TOTEM : numéros de démo pendant la bêta seulement, le float de démo seul proposé et toujours entendu, son SMS reconnu, un vrai float toujours fermé, un retrait de démo passe la porte, un vrai non';
end $$;
rollback;

-- 11.50 · la démo et l'argent réel ne se croisent jamais (0030). Un compte
-- « argent réel » ne se voit jamais proposer un float de démo, même quand le
-- vrai boîtier se tait ; il ne retire pas ses vrais XAFe vers un numéro de
-- démo. L'administration dit « démo », pas « muet », d'un terminal de démo.
begin;
update parametres set valeur = valeur || '{"actif": true, "depots_reels": false}' where cle = 'beta';
update parametres set valeur = valeur || '{"ouvertes": false}' where cle = 'sortie';
insert into terminaux (id, nom) values ('totem-demo', 'TOTEM démo');
insert into floats (operateur, numero, terminal) values ('mtn', '600000001', 'totem-demo');
-- le vrai boîtier se tait : c'est là qu'un float de démo, « toujours entendu », passait devant
update terminaux set vu_le = now() - interval '1 day' where not demo;
do $$
declare reel uuid := 'b1500000-0000-0000-0000-000000000001'; essai uuid := 'b1500000-0000-0000-0000-000000000002';
        r jsonb; n uuid; t jsonb;
begin
  insert into comptes (id, telephone, nom, palier, argent_reel) values (reel, '670150001', 'Compte réel', 0, true);
  insert into comptes (id, telephone, nom, palier) values (essai, '670150002', 'Testeur', 0);

  perform set_config('xafe.compte', reel::text, true);
  r := ouvrir_depot('mtn', 'k-reel-1');
  assert r ->> 'float_numero' <> '600000001', format('un compte réel envoyé payer un float de démo : %s', r);
  begin
    insert into depots (reference, compte_id, operateur, float_id, expire_le)
    values ('XAFe-DP-T11500', reel, 'mtn', (select id from floats where numero = '600000001'), now() + interval '1 hour');
    raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'un float de démo ne reçoit que l''argent de test', sqlerrm; end;
  perform ajouter_numero('mtn', '600000007');
  select id into n from numeros where compte_id = reel and numero = '600000007';
  begin perform _demander_sortie(5000, n, 'k-reel-s1', 'REEL');
        raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'un numéro de démo ne reçoit que l''argent de test', sqlerrm; end;

  -- le testeur, lui, a toujours le float de démo
  perform set_config('xafe.compte', essai::text, true);
  r := ouvrir_depot('mtn', 'k-essai-1');
  assert r ->> 'float_numero' = '600000001', r;

  -- l'administration
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000001', true);  -- le super admin
  select x into t from jsonb_array_elements(admin_terminaux()) x where x ->> 'id' = 'totem-demo';
  assert (t ->> 'demo')::boolean and not (t ->> 'muet')::boolean, t;
  raise notice '✓ 11.50 la démo et l''argent réel ne se croisent pas : float de démo refusé au compte réel (même boîtier muet), retrait réel vers un numéro de démo refusé, le terminal de démo dit « démo »';
end $$;
rollback;

-- 11.51 · aucun plafond par transfert (0031). Le client envoie ce qu'il veut :
-- l'écran ne lui dicte plus « 5 transferts de 1 000 000 au plus », et une
-- sortie automatique part en UN transfert. Un plafond posé par l'équipe
-- découpe encore (scénario 6).
begin;
update operateurs set plafond_par_transfert = null, plafond_jour = null;
update terminaux set vu_le = now() where id = 'akwa-1';
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare r jsonb; a uuid := '11111111-1111-1111-1111-111111111111'; avant bigint := (select count(*) from commandes);
begin
  perform _mouvement(a, 'XAFe', 6000000, 0, 'test', 'test', 'T-11.51');
  r := demander_sortie(6000000, 'aaaaaaaa-0000-0000-0000-000000000001', 'k-1151');
  assert (r ->> 'transferts')::int = 1, r;
  assert (select count(*) from commandes) = avant + 1, 'une sortie de 6 000 000, un seul transfert';
  r := parametres_publics();
  assert r -> 'operateurs' -> 0 -> 'plafond_par_transfert' = 'null'::jsonb and r -> 'operateurs' -> 0 -> 'plafond_jour' = 'null'::jsonb, r;
  raise notice '✓ 11.51 aucun plafond par transfert : 6 000 000 partent en un transfert, l''écran ne lit aucun plafond';
end $$;
rollback;

-- 11.52 · les retraits de démo se paient tout seuls (0032). Le terminal de démo
-- relève les sorties de démo, en prend une (une seule fois), la paie et rend
-- l'ID — ou rend l'échec, et les XAFe reviennent. Un vrai terminal n'y touche
-- pas ; un réveil impossible ne fait jamais tomber la demande.
begin;
update parametres set valeur = valeur || '{"actif": true, "depots_reels": false}' where cle = 'beta';
update parametres set valeur = valeur || '{"ouvertes": false, "mode": "manuel"}' where cle = 'sortie';
update parametres set valeur = '{"reveil": "https://totem.exemple.test/api/demo/reveil"}' where cle = 'demo_totem';
insert into terminaux (id, nom, cle) values ('totem-demo', 'TOTEM démo', 'cle-de-demo-assez-longue');
insert into floats (operateur, numero, terminal) values ('mtn', '600000001', 'totem-demo');
insert into numeros (compte_id, operateur, numero, verifie_le, actif_des)
values ('11111111-1111-1111-1111-111111111111', 'mtn', '600000007', now() - interval '3 days', now() - interval '2 days');
do $$
declare
  a uuid := '11111111-1111-1111-1111-111111111111';
  nid uuid := (select id from numeros where numero = '600000007');
  r jsonb; ref1 text; ref2 text; dispo0 numeric; bloque0 numeric; detruit0 numeric;
begin
  perform set_config('xafe.compte', a::text, true);
  perform _mouvement(a, 'XAFe', 100000, 0, 'test', 'test', 'T-11.52');
  dispo0 := solde(a, 'XAFe', 'dispo'); bloque0 := solde(a, 'XAFe', 'bloque');
  detruit0 := (select coalesce(sum(montant), 0) from emissions where sens = 'destruction');

  -- la demande passe, même avec un réveil qui ne peut pas partir (pas de pg_net ici)
  r := _demander_sortie(20000, nid, 'k-1152-1', 'Alice Demo');
  ref1 := r ->> 'reference';
  assert r ->> 'etat' = 'en_attente' and r ->> 'mode' = 'manuel', r;

  -- relevée par le terminal de démo seulement
  assert jsonb_array_length(totem_sorties_demo('akwa-1')) = 0, 'un vrai terminal ne voit pas les sorties de démo';
  assert (select count(*) from jsonb_array_elements(totem_sorties_demo('totem-demo')) x where x ->> 'reference' = ref1) = 1, totem_sorties_demo('totem-demo');
  begin perform totem_prendre_sortie_demo('akwa-1', ref1); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'seul un terminal de démo paie les sorties de démo', sqlerrm; end;

  -- prise une fois
  perform totem_prendre_sortie_demo('totem-demo', ref1);
  begin perform totem_prendre_sortie_demo('totem-demo', ref1); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'sortie déjà prise', sqlerrm; end;
  assert jsonb_array_length(totem_sorties_demo('totem-demo')) = 0, 'une sortie prise ne se relève plus';

  -- payée : close comme « J'ai payé », ses XAFe détruits
  r := totem_sortie_demo_payee('totem-demo', ref1, '18300000077');
  assert r ->> 'etat' = 'envoyee' and r ->> 'transaction_id' = '18300000077', r;
  assert solde(a, 'XAFe', 'dispo') = dispo0 - 20000 and solde(a, 'XAFe', 'bloque') = bloque0, 'les XAFe mis de côté sont partis';
  assert (select coalesce(sum(montant), 0) from emissions where sens = 'destruction') = detruit0 + (r ->> 'montant_xaf')::numeric, 'détruits';
  assert (totem_sortie_demo_payee('totem-demo', ref1, '18300000077') ->> 'deja')::boolean, 'le même ID rendu deux fois ne clôt pas deux fois';
  assert not exists (select 1 from courriels_a_envoyer where cle like 'sortie_%:' || ref1), '(0038) une sortie de démo n''envoie pas d''e-mail';

  -- échouée : rien n'est parti, les XAFe reviennent avec le motif
  r := _demander_sortie(30000, nid, 'k-1152-2', 'Alice Demo');
  ref2 := r ->> 'reference';
  perform totem_prendre_sortie_demo('totem-demo', ref2);
  begin perform totem_sortie_demo_payee('totem-demo', ref2, '18300000077'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'ce transaction ID prouve déjà une autre sortie', sqlerrm; end;
  r := totem_sortie_demo_echouee('totem-demo', ref2, 'Solde insuffisant : 0 FCFA.');
  assert r ->> 'etat' = 'annulee' and r ->> 'motif' like 'Démo : Solde insuffisant%', r;
  assert solde(a, 'XAFe', 'dispo') = dispo0 - 20000 and solde(a, 'XAFe', 'bloque') = bloque0, 'les 30 000 sont revenus';
  raise notice '✓ 11.52 les retraits de démo se paient tout seuls : relevés par le terminal de démo seul, pris une fois, payés (XAFe détruits) ou échoués (XAFe rendus) ; un réveil impossible ne fait pas tomber la demande';
end $$;
rollback;

-- 11.53 · la revue d'attaque du 22/10 (0034). Chaque attaque est rejouée
-- telle que la revue l'a prouvée, et doit échouer :
--  a. un compte de la bêta retire son argent de test vers un VRAI numéro ;
--  b. un vrai retrait, faute de vrai boîtier en ligne, part au terminal de démo ;
--  c. un SMS du terminal de démo crédite un VRAI dépôt (même transaction ID) ;
--  d. deux comptes s'échangent quelques USDT au bord de la bande pour la promener ;
--  e. un compte gelé garde des ordres qui s'exécutent.
begin;
update parametres set valeur = valeur || '{"actif": true, "depots_reels": false}' where cle = 'beta';
update parametres set valeur = valeur || '{"ouvertes": true, "mode": "totem"}' where cle = 'sortie';
insert into terminaux (id, nom, cle) values ('totem-demo', 'TOTEM démo', 'cle-de-demo-assez-longue') on conflict (id) do nothing;
update terminaux set demo = true, vu_le = now() where id = 'totem-demo';
insert into floats (operateur, numero, terminal) values ('mtn', '600000001', 'totem-demo');
do $$
declare
  a uuid := '11111111-1111-1111-1111-111111111111';          -- un testeur : argent de test seulement
  reel uuid := 'b1530000-0000-0000-0000-000000000001';       -- un compte d'argent réel
  x uuid := 'b1530000-0000-0000-0000-000000000002'; y uuid := 'b1530000-0000-0000-0000-000000000003';
  v uuid := 'b1530000-0000-0000-0000-000000000004'; g uuid := 'b1530000-0000-0000-0000-000000000005';
  nid uuid; r jsonb; dep text; i int; p numeric; avant numeric;
begin
  -- a. l'argent de test ne sort pas vers un vrai numéro…
  update terminaux set vu_le = now() where id = 'akwa-1';
  perform set_config('xafe.compte', a::text, true);
  perform _mouvement(a, 'XAFe', 1000000, 0, 'test', 'test', 'T-11.53');
  begin perform _demander_sortie(900000, 'aaaaaaaa-0000-0000-0000-000000000001', 'k-1153-a', 'TESTEUR');
        raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'l''argent de test ne sort pas en vrai', sqlerrm; end;
  -- … et le témoin : le même compte, passé à l'argent réel, retire normalement
  update comptes set argent_reel = true where id = a;
  r := _demander_sortie(900000, 'aaaaaaaa-0000-0000-0000-000000000001', 'k-1153-a', 'TESTEUR');
  assert r ->> 'etat' = 'en_attente', r;
  assert (select t.demo from commandes c join terminaux t on t.id = c.terminal
           join sorties s on s.id = c.sortie_id where s.reference = r ->> 'reference' limit 1) = false, 'payé par un vrai boîtier';

  -- b. le vrai boîtier se tait : le vrai retrait ne part PAS au terminal de démo
  update terminaux set vu_le = now() - interval '1 day' where not demo;   -- tous les vrais boîtiers se taisent
  begin perform demander_sortie(5000, 'aaaaaaaa-0000-0000-0000-000000000001', 'k-1153-b');
        raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'aucun boîtier en ligne pour cet opérateur', sqlerrm; end;
  update terminaux set vu_le = now() where not demo;

  -- c. un SMS de la démo ne paie pas un vrai dépôt, même avec le bon transaction ID
  insert into comptes (id, telephone, nom, palier, argent_reel) values (reel, '670153001', 'Compte réel', 0, true);
  avant := solde(reel, 'XAFe', 'dispo');   -- la dotation de bienvenue de la bêta, s'il y en a une
  perform set_config('xafe.compte', reel::text, true);
  r := ouvrir_depot('mtn', 'k-1153-c');
  dep := r ->> 'reference';
  assert r ->> 'float_numero' not like '600%', format('un compte réel ne paie qu''un vrai float : %s', r);
  perform declarer_transaction(dep, 'DEMO1153TX', '600000002', 7500000, 'Payeur Demo');
  r := totem_sms_recu('totem-demo', 115301, 'mtn', '600000001', '600000002', 7500000, 'DEMO1153TX',
                      'You have received 7500000 FCFA from 600000002. Transaction Id: DEMO1153TX.', now());
  assert r ->> 'resultat' = 'retenue', format('un SMS de démo a payé un vrai dépôt : %s', r);
  assert (select etat from depot_declarations where transaction_id = 'DEMO1153TX') = 'attendu', 'la déclaration attend toujours SON paiement';
  assert solde(reel, 'XAFe', 'dispo') = avant, 'aucun vrai XAFe crédité';
  -- dans l'autre sens, la déclaration faite APRÈS le SMS de démo ne le reprend pas non plus
  perform set_config('xafe.compte', reel::text, true);
  r := ouvrir_depot('mtn', 'k-1153-c2');
  r := totem_sms_recu('totem-demo', 115302, 'mtn', '600000001', '600000002', 6000000, 'DEMO1153TY',
                      'You have received 6000000 FCFA from 600000002. Transaction Id: DEMO1153TY.', now());
  r := declarer_transaction((select reference from depots where cle = 'k-1153-c2'), 'DEMO1153TY', '600000002', 6000000, 'Payeur Demo');
  assert r ->> 'etat' = 'attendu' and solde(reel, 'XAFe', 'dispo') = avant, format('la démo a payé le vrai : %s', r);

  -- d. la référence ne se promène pas : huit échanges entre deux comptes du même joueur
  update ordres set etat = 'annule', restant = 0, bloque = 0 where etat in ('ouvert', 'partiel');
  delete from executions;
  update parametres set valeur = valeur || '{"prix_reference": 600}' where cle = 'marche';
  insert into comptes (id, telephone, nom, palier) values (x, '670153002', 'Joueur X', 2), (y, '670153003', 'Joueur Y', 2),
                                                          (v, '670153004', 'Vendeur honnête', 2);
  perform _mouvement(x, 'XAFe', 10000000, 0, 'test', 'test', 'T-11.53x');
  perform _mouvement(y, 'USDT', 1000, 0, 'test', 'test', 'T-11.53y');
  perform _mouvement(v, 'USDT', 100, 0, 'test', 'test', 'T-11.53v');
  for i in 1..8 loop
    p := floor(_prix_reference() * 1.1 / 0.05) * 0.05;
    perform set_config('xafe.compte', x::text, true);
    begin perform placer_ordre('achat', 'limite', 10, p, null); exception when others then null; end;
    perform set_config('xafe.compte', y::text, true);
    begin perform placer_ordre('vente', 'limite', 10, p, null); exception when others then null; end;
  end loop;
  assert _prix_reference() <= 660, format('la référence s''est promenée jusqu''à %s', _prix_reference());
  perform set_config('xafe.compte', v::text, true);
  r := placer_ordre('vente', 'limite', 10, 600, 'k-1153-v');       -- vendre au vrai cours reste possible
  assert r -> 'ordre' ->> 'etat' in ('ouvert', 'partiel', 'execute'), r;

  -- e. un compte gelé n'a plus d'ordres au carnet
  insert into comptes (id, telephone, nom, palier) values (g, '670153005', 'Compte volé', 2);
  perform _mouvement(g, 'USDT', 100, 0, 'test', 'test', 'T-11.53g');
  avant := solde(g, 'USDT', 'dispo');
  perform set_config('xafe.compte', g::text, true);
  r := placer_ordre('vente', 'limite', 50, 640, 'k-1153-g');
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000001', true);   -- le super admin
  perform admin_desactiver_compte(g, false, 'compte volé');
  assert not exists (select 1 from ordres where compte_id = g and etat in ('ouvert', 'partiel')), 'ordre du compte gelé encore au carnet';
  assert solde(g, 'USDT', 'dispo') = avant and solde(g, 'USDT', 'bloque') = 0, 'ses USDT lui sont rendus, rien ne s''exécute';
  raise notice '✓ 11.53 la revue d''attaque : argent de test bloqué vers un vrai numéro, vrai retrait jamais confié à la démo, SMS de démo sans effet sur un vrai dépôt (dans les deux ordres), référence tenue à 10 %% du cours externe, compte gelé sorti du carnet';
end $$;
rollback;

-- 11.54 · une session faible n'atteint RIEN (0035). Chaque fonction ouverte
-- aux clients, l'une après l'autre, appelée en session aal1 — puis en aal2
-- ouverte par un simple code e-mail (amr « otp ») — doit lever exactement
-- « double authentification requise ». La liste est lue dans pg_proc : une
-- fonction ajoutée demain par n'importe quelle migration y entre d'office.
-- Cinq exceptions, chacune avec sa raison. Le contrôle statique dit, lui,
-- QUELLE fonction a oublié sa garde en tête ; il porte son propre témoin.
begin;
create function _appels_faibles() returns text language plpgsql set search_path = public as $f$
declare r record; v_args text; v_err text; v_faux text := '';
begin
  for r in select p.oid, p.oid::regprocedure::text sig, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')
              -- preuve_de_reserve : publique (anon), des totaux sans nom · mon_etat_d_entree : l'écran d'entrée, avant le TOTP ·
              -- session_forte et admin_a_droit : rendent « faux » (vérifié plus bas) · avant_chaque_requete : le crochet (11.59)
              and p.proname not in ('preuve_de_reserve', 'mon_etat_d_entree', 'session_forte', 'admin_a_droit', 'avant_chaque_requete')
              and p.oid <> '_appels_faibles()'::regprocedure
            order by 2 loop
    select coalesce(string_agg('null::' || format_type(t, null), ', ' order by o), '') into v_args
      from unnest((select proargtypes::oid[] from pg_proc where oid = r.oid)) with ordinality a(t, o);
    begin
      execute format('select %I(%s)', r.proname, v_args);
      v_err := 'aucune erreur';
    exception when others then v_err := sqlerrm;
    end;
    if v_err is distinct from 'double authentification requise' then v_faux := v_faux || r.sig || ' → ' || v_err || E'\n'; end if;
  end loop;
  return nullif(v_faux, '');
end $f$;
grant execute on function _appels_faibles() to authenticated;
set local role authenticated;
do $$
declare v text; n int;
begin
  perform set_config('xafe.compte', '11111111-1111-1111-1111-111111111111', true);
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute');
  assert n > 100, format('la liste est trop courte pour être la vraie : %s', n);
  -- aal1 : le mot de passe, sans le code de l'application
  perform set_config('xafe.aal', 'aal1', true);
  perform set_config('xafe.amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint))::text, true);
  assert not session_forte() and not admin_a_droit('voir'), 'aal1 n''est pas une session forte';
  v := _appels_faibles();
  assert v is null, E'en aal1, ces fonctions ne refusent pas :\n' || v;
  -- aal2 atteint par un code e-mail (signInWithOtp) puis le TOTP : sans mot de passe, pas forte
  perform set_config('xafe.aal', 'aal2', true);
  perform set_config('xafe.amr', jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint),
                                                   jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint))::text, true);
  assert not session_forte(), 'un code e-mail et le TOTP ne font pas une session forte';
  v := _appels_faibles();
  assert v is null, E'en aal2 ouvert par code e-mail, ces fonctions ne refusent pas :\n' || v;
  -- le contrôle positif : la même personne, mot de passe puis TOTP (le « mfa/totp » de certaines versions de GoTrue compte aussi)
  perform set_config('xafe.amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint),
                                                   jsonb_build_object('method', 'mfa/totp', 'timestamp', extract(epoch from now())::bigint))::text, true);
  assert session_forte() and mon_compte() ->> 'id' = '11111111-1111-1111-1111-111111111111', 'mot de passe + TOTP : la session est forte';
  perform set_config('xafe.amr', jsonb_build_array(jsonb_build_object('method', 'oauth', 'timestamp', extract(epoch from now())::bigint))::text, true);
  assert session_forte(), 'Google + TOTP : forte';
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  assert not session_forte(), 'anon n''est jamais fort';
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  assert session_forte(), 'la clé de service passe';
  perform set_config('request.jwt.claims', '', true);
end $$;
reset role;
drop function _appels_faibles();
do $$
declare v text;
  -- la règle, lue dans le texte : la PREMIÈRE instruction est la garde (ou une porte qui la porte)
  c_regle constant text := '^\s*(declare[\s\S]*?)?begin\s+perform\s+(public\.)?_exiger_(aal2|droit|compte_actif)\(';
begin
  create function temoin_sans_garde() returns jsonb language plpgsql security definer set search_path = public as $f$
  begin return jsonb_build_object('compte', auth.uid()); end $f$;
  grant execute on function temoin_sans_garde() to authenticated;
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v from pg_proc p join pg_language l on l.oid = p.prolang
   where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname not in ('preuve_de_reserve', 'mon_etat_d_entree', 'session_forte', 'admin_a_droit', 'avant_chaque_requete')
     and (l.lanname <> 'plpgsql' or p.prosrc !~* c_regle);
  assert v = 'temoin_sans_garde()', 'le témoin doit être vu, et lui seul : ' || coalesce(v, 'personne');
  drop function temoin_sans_garde();
  raise notice '✓ 11.54 en aal1, et en aal2 ouvert par un code e-mail, chacune des fonctions ouvertes aux clients refuse « double authentification requise » ; la garde est leur première instruction (témoin pris)';
end $$;
rollback;

-- 11.55 · les codes de secours (0035). Dix codes distincts, montrés une fois,
-- gardés en empreintes ; sans les avoir notés, pas de compte ; un code ne
-- sert qu'une fois, ni à un autre, ni pendant le verrou (cinq essais, puis
-- quinze minutes) ; un lot confirmé ne se remplace qu'avec un TOTP frais.
-- Témoin : un code consommé qui passerait deux fois fait tomber l'assertion
-- « ne sert qu'une fois ».
begin;
select _essai_utilisateur('f5500000-0000-0000-0000-000000000001', 'secours@example.com');
select _essai_utilisateur('f5500000-0000-0000-0000-000000000002', 'autre@example.com');
delete from lots_de_secours where utilisateur_id::text like 'f5500000-%';      -- pas encore de codes
do $$
declare
  u uuid := 'f5500000-0000-0000-0000-000000000001'; v uuid := 'f5500000-0000-0000-0000-000000000002';
  r jsonb; codes text[]; neufs text[]; autres text[]; variante text; i int;
begin
  perform set_config('xafe.compte', u::text, true);
  r := generer_codes_de_secours();
  select array_agg(x) into codes from jsonb_array_elements_text(r -> 'codes') x;
  assert array_length(codes, 1) = 10 and (select count(distinct x) from unnest(codes) x) = 10, r;
  assert (select bool_and(x ~ '^[0-9A-Z]{5}-[0-9A-Z]{5}$') from unnest(codes) x), r;
  assert (select count(*) from codes_de_secours where utilisateur_id = u and empreinte ~ '^[0-9a-f]{64}$') = 10, 'dix empreintes';
  assert not exists (select 1 from codes_de_secours k, unnest(codes) x where position(replace(x, '-', '') in k::text) > 0)
     and not exists (select 1 from journal_securite j, unnest(codes) x where position(replace(x, '-', '') in j::text) > 0)
     and not exists (select 1 from lots_de_secours l, unnest(codes) x where position(replace(x, '-', '') in l::text) > 0),
         'aucune ligne ne garde un code en clair';
  assert not (mes_codes_de_secours() ->> 'confirmes')::boolean and (mes_codes_de_secours() ->> 'restants')::int = 10;
  begin perform ouvrir_mon_compte('Awa', 'Secours', date '1990-05-14', '+237677550001', 'Douala', 'CM', '2026-10-29'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'codes de secours à noter', sqlerrm; end;
  r := confirmer_codes_de_secours();
  assert (r ->> 'restants')::int = 10, r;
  r := ouvrir_mon_compte('Awa', 'Secours', date '1990-05-14', '+237677550001', 'Douala', 'CM', '2026-10-29');
  assert (r ->> 'id')::uuid = u, r;

  -- un lot confirmé ne se remplace pas avec un TOTP vieux de dix minutes…
  perform set_config('xafe.amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint),
                                                   jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now() - interval '10 minutes')::bigint))::text, true);
  begin perform generer_codes_de_secours(); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'confirmez avec votre application d''authentification', sqlerrm; end;
  -- …mais avec un code tout neuf : un lot neuf, et l'ancien ne vaut plus rien
  perform set_config('xafe.amr', '', true);
  select array_agg(x) into neufs from jsonb_array_elements_text(generer_codes_de_secours() -> 'codes') x;
  assert not (mes_codes_de_secours() ->> 'confirmes')::boolean, 'un lot neuf se renote';
  r := _consommer_code_de_secours(u, codes[1]);
  assert not (r ->> 'ok')::boolean and r ->> 'erreur' = 'code de secours incorrect', 'un code de l''ancien lot passe encore : ' || r;

  -- ce que la personne recopie : minuscules, espaces, O pour 0, I ou L pour 1
  variante := translate(lower(replace(neufs[1], '-', '  ')), '01', 'ol');
  r := _consommer_code_de_secours(u, variante);
  assert (r ->> 'ok')::boolean and (r ->> 'restants')::int = 9, format('%s → %s', variante, r);
  r := _consommer_code_de_secours(u, neufs[1]);
  assert not (r ->> 'ok')::boolean and r ->> 'erreur' = 'code de secours incorrect', 'un code ne sert qu''une fois : ' || r;
  -- rendu (GoTrue n'a pas pu retirer le facteur) : il resservira
  perform _code_de_secours_rendu((select id from codes_de_secours where utilisateur_id = u and utilise_le is not null));
  assert (select count(*) from codes_de_secours where utilisateur_id = u and utilise_le is null) = 10, 'le code brûlé est rendu';

  -- le code d'un autre n'ouvre pas mon compte
  perform set_config('xafe.compte', v::text, true);
  select array_agg(x) into autres from jsonb_array_elements_text(generer_codes_de_secours() -> 'codes') x;
  r := _consommer_code_de_secours(u, autres[1]);
  assert not (r ->> 'ok')::boolean, 'le code d''un autre passe : ' || r;

  -- cinq essais faux, puis quinze minutes de verrou, même pour le bon code
  update lots_de_secours set essais_rates = 0 where utilisateur_id = u;
  for i in 1 .. 4 loop
    r := _consommer_code_de_secours(u, 'ZZZZZ-ZZZZZ');
    assert r ->> 'erreur' = 'code de secours incorrect' and (r ->> 'essais_restants')::int = 5 - i, r;
  end loop;
  r := _consommer_code_de_secours(u, 'ZZZZZ-ZZZZZ');
  assert r ->> 'erreur' = 'trop d''essais' and (r ->> 'verrou_jusqua')::timestamptz > now() + interval '14 minutes', r;
  r := _consommer_code_de_secours(u, neufs[2]);
  assert r ->> 'erreur' = 'trop d''essais', 'pendant le verrou, même le bon code est refusé : ' || r;
  assert (select count(*) from journal_securite where utilisateur_id = u and evenement = 'code_de_secours_refuse') >= 6, 'chaque refus est journalisé';

  -- la double authentification retirée : codes et lot partent, la personne est prévenue
  r := _deux_facteurs_retires(u, 'code_de_secours', null, 1);
  assert not exists (select 1 from codes_de_secours where utilisateur_id = u) and not exists (select 1 from lots_de_secours where utilisateur_id = u), r;
  assert exists (select 1 from journal_securite where utilisateur_id = u and evenement = 'deux_facteurs_retires' and detail ->> 'cause' = 'code_de_secours');
  assert exists (select 1 from notifications where compte_id = u and titre = 'Double authentification retirée'), 'la notification part';
  assert exists (select 1 from courriels_a_envoyer where compte_id = u and gabarit = 'deux_facteurs_retires'
                  and cle = 'deux_facteurs_retires:' || u || ':' || (now() at time zone 'Africa/Douala')::date), 'l''e-mail attend dans la boîte d''envoi (0036)';
  begin perform _deux_facteurs_retires(u, 'au hasard', null, 1); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'cause inconnue', sqlerrm; end;
  raise notice '✓ 11.55 les codes de secours : dix, distincts, en empreintes ; sans les noter, pas de compte ; un code ne sert qu''une fois, ni à un autre ni pendant le verrou ; un lot confirmé ne se remplace qu''avec un TOTP frais';
end $$;
-- un client n'atteint pas la consommation : seule la fonction deux-facteurs, avec la clé de service
set local role authenticated;
do $$
begin
  perform set_config('xafe.compte', 'f5500000-0000-0000-0000-000000000002', true);
  begin perform _consommer_code_de_secours('f5500000-0000-0000-0000-000000000002', 'ABCDE-FGHJK'); raise exception 'aurait dû refuser';
  exception when insufficient_privilege then null; end;
  begin perform _deux_facteurs_retires('f5500000-0000-0000-0000-000000000002', 'administration', null, 0); raise exception 'aurait dû refuser';
  exception when insufficient_privilege then null; end;
  begin perform * from codes_de_secours; raise exception 'aurait dû refuser';
  exception when insufficient_privilege then null; end;
  raise notice '✓ 11.55b un client ne consomme pas de code, ne retire pas de facteur, ne lit aucune empreinte';
end $$;
rollback;

-- 11.56 · ouvrir son compte en production (0035). Chaque manque a son refus :
-- session faible, premier facteur « code e-mail », compte Google sans mot de
-- passe, codes pas notés. Le téléphone reste unique parmi les comptes
-- ouverts — même écrit autrement, même quand deux inscriptions se croisent —
-- et celui d'un compte fermé se réutilise. Une personne créée à la main dans
-- le tableau de bord (adresse confirmée) suit le même chemin.
-- Témoin : l'ouverture d'avant acceptait l'aal1, le compte Google sans mot
-- de passe et la personne sans codes.
begin;
select _essai_utilisateur('f5600000-0000-0000-0000-000000000001', 'prod@example.com');
select _essai_utilisateur('f5600000-0000-0000-0000-000000000002', 'google@example.com', false);
select _essai_utilisateur('f5600000-0000-0000-0000-000000000003', 'sanscodes@example.com');
select _essai_utilisateur('f5600000-0000-0000-0000-000000000004', 'meme-numero@example.com');
select _essai_utilisateur('f5600000-0000-0000-0000-000000000005', 'course@example.com');
select _essai_utilisateur('f5600000-0000-0000-0000-000000000006', 'reprise@example.com');
-- créée dans le tableau de bord : adresse confirmée, mot de passe posé, rien d'autre
insert into auth.users (id, email, email_confirmed_at, encrypted_password)
values ('f5600000-0000-0000-0000-000000000007', 'tableau@example.com', now(), extensions.crypt('Mot-de-passe-2026', extensions.gen_salt('bf', 4)));
update lots_de_secours set confirme_le = null where utilisateur_id = 'f5600000-0000-0000-0000-000000000003';
do $$
declare r jsonb; e jsonb;
  c_faible constant text := jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint))::text;
  c_otp constant text := jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint),
                                           jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint))::text;
begin
  perform set_config('xafe.compte', 'f5600000-0000-0000-0000-000000000001', true);
  perform set_config('xafe.aal', 'aal1', true); perform set_config('xafe.amr', c_faible, true);
  begin perform ouvrir_mon_compte('Pierre', 'Prod', date '1990-05-14', '+237677560001', 'Douala', 'CM', '2026-10-29'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'double authentification requise', sqlerrm; end;
  -- en session faible, l'écran d'entrée sait où en est la personne
  e := mon_etat_d_entree();
  assert (e ->> 'email_confirme')::boolean and (e ->> 'mot_de_passe')::boolean and not (e ->> 'session_forte')::boolean
         and (e ->> 'codes_de_secours')::boolean and not (e ->> 'compte')::boolean, e;
  perform set_config('xafe.aal', 'aal2', true); perform set_config('xafe.amr', c_otp, true);
  begin perform ouvrir_mon_compte('Pierre', 'Prod', date '1990-05-14', '+237677560001', 'Douala', 'CM', '2026-10-29'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'double authentification requise', sqlerrm; end;
  perform set_config('xafe.amr', '', true);

  perform set_config('xafe.compte', 'f5600000-0000-0000-0000-000000000002', true);
  assert not (mon_etat_d_entree() ->> 'mot_de_passe')::boolean, 'un compte Google n''a pas de mot de passe';
  begin perform ouvrir_mon_compte('Gaby', 'Google', date '1990-05-14', '+237677560002', 'Douala', 'CM', '2026-10-29'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'mot de passe à choisir', sqlerrm; end;

  perform set_config('xafe.compte', 'f5600000-0000-0000-0000-000000000003', true);
  begin perform ouvrir_mon_compte('Sans', 'Codes', date '1990-05-14', '+237677560003', 'Douala', 'CM', '2026-10-29'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'codes de secours à noter', sqlerrm; end;
  assert not exists (select 1 from comptes where id::text like 'f5600000-%'), 'aucun refus n''a ouvert de compte';

  -- le chemin entier : la session forte, et tout est mis en forme comme avant
  perform set_config('xafe.compte', 'f5600000-0000-0000-0000-000000000001', true);
  r := ouvrir_mon_compte('  pierre ', 'PROD', date '1990-05-14', '+237 6 77 56 00 01', 'douala', 'cm', '2026-10-29');
  assert r ->> 'nom' = 'Pierre Prod' and r ->> 'telephone' = '+237677560001' and r ->> 'ville' = 'Douala' and r ->> 'pays' = 'CM', r;
  -- le même numéro, écrit autrement
  perform set_config('xafe.compte', 'f5600000-0000-0000-0000-000000000004', true);
  begin perform ouvrir_mon_compte('Marc', 'Meme', date '1990-05-14', '+237 6 77 56 00 01', 'Douala', 'CM', '2026-10-29'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'ce numéro est déjà utilisé', sqlerrm; end;

  -- deux inscriptions qui se croisent : l'autre compte naît APRÈS la vérification (un déclencheur l'y glisse) ;
  -- c'est l'index qui refuse, et le refus dit encore le numéro, pas un message passe-partout
  create function _course_au_numero() returns trigger language plpgsql set search_path = public as $f$
  begin
    if new.id = 'f5600000-0000-0000-0000-000000000005' then
      insert into comptes (id, telephone, nom) values ('f5600000-0000-0000-0000-0000000000aa', new.telephone, 'L''autre');
    end if;
    return new;
  end $f$;
  create trigger course_au_numero before insert on comptes for each row execute function _course_au_numero();
  perform set_config('xafe.compte', 'f5600000-0000-0000-0000-000000000005', true);
  begin perform ouvrir_mon_compte('Carla', 'Course', date '1990-05-14', '+237677560005', 'Douala', 'CM', '2026-10-29'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'ce numéro est déjà utilisé', 'la course rend : ' || sqlerrm; end;
  drop trigger course_au_numero on comptes; drop function _course_au_numero();
  assert not exists (select 1 from comptes where telephone = '+237677560005'), 'rien n''est resté de la course';

  -- le numéro d'un compte fermé se réutilise (décision du propriétaire)
  update comptes set ferme_le = now(), desactive_le = now() where id = 'f5600000-0000-0000-0000-000000000001';
  perform set_config('xafe.compte', 'f5600000-0000-0000-0000-000000000006', true);
  r := ouvrir_mon_compte('Rita', 'Reprise', date '1990-05-14', '+237677560001', 'Douala', 'CM', '2026-10-29');
  assert r ->> 'telephone' = '+237677560001', r;

  -- créée dans le tableau de bord : en aal1, l'écran voit ce qui manque ; en aal2, les codes, puis le compte
  perform set_config('xafe.compte', 'f5600000-0000-0000-0000-000000000007', true);
  perform set_config('xafe.aal', 'aal1', true); perform set_config('xafe.amr', c_faible, true);
  e := mon_etat_d_entree();
  assert (e ->> 'email_confirme')::boolean and (e ->> 'mot_de_passe')::boolean and not (e ->> 'session_forte')::boolean
         and not (e ->> 'codes_de_secours')::boolean and not (e ->> 'compte')::boolean, e;
  perform set_config('xafe.aal', '', true); perform set_config('xafe.amr', '', true);
  perform generer_codes_de_secours(); perform confirmer_codes_de_secours();
  r := ouvrir_mon_compte('Tania', 'Tableau', date '1990-05-14', '+237677560007', 'Yaoundé', 'CM', '2026-10-29');
  assert (mon_etat_d_entree() ->> 'compte')::boolean and (mon_etat_d_entree() ->> 'session_forte')::boolean, mon_etat_d_entree();
  raise notice '✓ 11.56 ouvrir son compte : session faible, code e-mail, Google sans mot de passe ou codes pas notés, chacun refusé ; un numéro, même écrit autrement ou en course, ne sert qu''à un compte ouvert, celui d''un compte fermé se réutilise ; une personne du tableau de bord suit le même chemin';
end $$;
rollback;

-- 11.57 · l'administration (0035). En session faible, l'équipe ne voit rien et
-- n'entre pas ; sans mot de passe ni codes notés non plus. Réinitialiser la
-- double authentification de quelqu'un : le super admin seul, jamais la
-- sienne, avec un motif, trois fois par jour et par personne au plus, et
-- c'est journalisé. La fiche « Sécurité » ne montre jamais d'empreinte.
-- Témoin : avant 0035, admin_a_droit était vrai en aal1.
begin;
select _essai_utilisateur('f5700000-0000-0000-0000-000000000001', 'nouvel-admin@example.com', false);
select _essai_utilisateur('f5700000-0000-0000-0000-000000000002', 'cible@example.com');
insert into administrateurs_invites (email, nom, role) values ('nouvel-admin@example.com', 'Nouvel', 'support');
insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at) values (gen_random_uuid(), 'f5700000-0000-0000-0000-000000000002', 'totp', 'verified', now(), now());
insert into codes_de_secours (utilisateur_id, empreinte)
values ('f5700000-0000-0000-0000-000000000002', _empreinte_de_secours('f5700000-0000-0000-0000-000000000002', 'ABCDEFGHJK'));
do $$
declare r jsonb; i int; a uuid := 'f5700000-0000-0000-0000-000000000001'; c uuid := 'f5700000-0000-0000-0000-000000000002';
begin
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000001', true);   -- le super admin
  perform set_config('xafe.aal', 'aal1', true);
  assert not admin_a_droit('voir'), 'en aal1, aucun droit';
  begin perform admin_tableau(); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'double authentification requise', sqlerrm; end;
  begin perform entrer_administration(); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'double authentification requise', sqlerrm; end;
  begin perform mon_profil_admin(); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'double authentification requise', sqlerrm; end;
  perform set_config('xafe.aal', '', true);
  assert admin_a_droit('voir'), 'en aal2, le droit revient';

  -- une invitée sans mot de passe, puis sans codes : refusée ; avec les deux, elle entre
  perform set_config('xafe.compte', a::text, true);
  begin perform entrer_administration(); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'mot de passe à choisir', sqlerrm; end;
  perform _essai_pret(a); update lots_de_secours set confirme_le = null where utilisateur_id = a;
  begin perform entrer_administration(); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'codes de secours à noter', sqlerrm; end;
  update lots_de_secours set confirme_le = now() where utilisateur_id = a;
  assert entrer_administration() ->> 'role' = 'support', 'l''invitée entre';

  -- la réinitialisation : le support ne peut pas
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000003', true);
  begin perform admin_autoriser_reinitialisation_2fa(c, 'pièce d''identité vue en agence'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'accès non autorisé', sqlerrm; end;
  r := admin_securite_utilisateur(c);
  assert (r ->> 'deux_facteurs')::boolean and (r ->> 'codes_restants')::int = 1, r;
  assert position((select empreinte from codes_de_secours where utilisateur_id = c) in r::text) = 0, 'la fiche montre une empreinte';

  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000001', true);
  begin perform admin_autoriser_reinitialisation_2fa('dddddddd-0000-0000-0000-000000000001', 'je me suis vérifié moi-même'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'vous ne réinitialisez pas votre propre double authentification', sqlerrm; end;
  begin perform admin_autoriser_reinitialisation_2fa(c, 'vu'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'motif trop court', sqlerrm; end;
  begin perform admin_autoriser_reinitialisation_2fa(gen_random_uuid(), 'pièce d''identité vue en agence'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'utilisateur inconnu', sqlerrm; end;
  for i in 1 .. 3 loop
    r := admin_autoriser_reinitialisation_2fa(c, 'pièce d''identité vue en agence, appel vidéo ' || i);
    assert r ->> 'email' = 'cible@example.com' and (r ->> 'utilisateur_id')::uuid = c, r;
  end loop;
  begin perform admin_autoriser_reinitialisation_2fa(c, 'une quatrième fois dans la journée'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'trop de réinitialisations', sqlerrm; end;
  assert (select count(*) from reinitialisations_2fa where utilisateur_id = c) = 3;
  assert (select count(*) from journal_admin where action = 'deux_facteurs_reinitialisation' and cible = c::text) = 3, 'journalisé';
  r := _deux_facteurs_retires(c, 'administration', (r ->> 'id')::uuid, 1);
  assert (select count(*) from reinitialisations_2fa where utilisateur_id = c and faite_le is not null and facteurs = 1) = 1, 'la réinitialisation est notée faite';
  assert exists (select 1 from journal_securite where utilisateur_id = c and evenement = 'deux_facteurs_retires' and par_admin = 'dddddddd-0000-0000-0000-000000000001');
  -- c n'a pas de ligne « comptes » : l'e-mail part à son adresse d'Auth, sans clé étrangère cassée
  assert exists (select 1 from courriels_a_envoyer where compte_id is null and destinataire = 'cible@example.com' and gabarit = 'deux_facteurs_retires');
  -- le super admin lit le motif, le support non
  assert admin_securite_utilisateur(c) -> 'reinitialisations' -> 0 ? 'motif';
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000003', true);
  assert not (admin_securite_utilisateur(c) -> 'reinitialisations' -> 0 ? 'motif'), 'le motif est pour le super admin';
  raise notice '✓ 11.57 l''administration : en aal1 rien ; sans mot de passe ni codes, pas d''entrée ; réinitialiser : le super admin seul, jamais pour lui, motif exigé, trois par jour, journalisé ; aucune empreinte montrée';
end $$;
rollback;

-- 11.58 · les tables (0035). Toute table qu'un client peut lire porte la
-- politique RESTRICTIVE de la session forte ; en aal1, il n'y lit rien — et
-- en aal2 il y relit ses lignes, preuve que c'est la politique, et pas
-- l'absence de lignes, qui filtre. Les tables des codes de secours ne se
-- lisent pas. Témoin : une table neuve lisible sans la politique est vue.
begin;
do $$
declare v text;
  c_sans constant text := $q$
    select string_agg(c.relname, ', ' order by c.relname) from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and has_table_privilege('authenticated', c.oid, 'select')
       and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.permissive = 'RESTRICTIVE'
                        and p.cmd in ('SELECT', 'ALL') and p.qual like '%session_forte%')$q$;
begin
  execute c_sans into v;
  assert v is null, 'lisibles sans la politique de la session forte : ' || v;
  create table temoin_lisible (id int);
  grant select on temoin_lisible to authenticated;
  execute c_sans into v;
  assert v = 'temoin_lisible', 'le témoin doit être vu : ' || coalesce(v, 'personne');
  drop table temoin_lisible;
  assert not has_table_privilege('authenticated', 'lots_de_secours', 'select') and not has_table_privilege('authenticated', 'codes_de_secours', 'select')
     and not has_table_privilege('authenticated', 'journal_securite', 'select') and not has_table_privilege('authenticated', 'reinitialisations_2fa', 'select');
end $$;
set local role authenticated;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare n_soldes int; n_comptes int; n_numeros int; n_parametres int;
begin
  perform set_config('xafe.aal', 'aal1', true);
  select count(*) into n_soldes from soldes; select count(*) into n_comptes from comptes;
  select count(*) into n_numeros from numeros; select count(*) into n_parametres from parametres;
  assert n_soldes + n_comptes + n_numeros + n_parametres = 0, format('en aal1 : %s soldes, %s comptes, %s numéros, %s paramètres', n_soldes, n_comptes, n_numeros, n_parametres);
  perform set_config('xafe.aal', 'aal2', true);
  assert (select count(*) from comptes) = 1 and (select count(*) from parametres) > 0 and (select count(*) from numeros) > 0, 'en aal2, ses lignes reviennent';
  raise notice '✓ 11.58 chaque table lisible porte la politique de la session forte (témoin pris) ; en aal1 rien ne se lit, en aal2 ses lignes reviennent';
end $$;
rollback;

-- 11.59 · le crochet de PostgREST (0035), la troisième couche : en aal1, une
-- requête vers /rpc/mon_compte est refusée avant la fonction ; l'écran
-- d'entrée et la preuve de réserve passent ; anon, la clé de service et la
-- base elle-même ne sont pas touchés. (Que PostgREST l'appelle se vérifie
-- dans supabase/epreuve : le harnais n'a pas de rôle authenticator.)
begin;
do $$
begin
  perform set_config('request.jwt.claims', '{"role": "authenticated", "aal": "aal1", "sub": "11111111-1111-1111-1111-111111111111", "amr": [{"method": "password", "timestamp": 1}]}', true);
  perform set_config('request.path', '/rpc/mon_compte', true);
  begin perform avant_chaque_requete(); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'double authentification requise', sqlerrm; end;
  perform set_config('request.path', '/rpc/mon_etat_d_entree', true);
  perform avant_chaque_requete();
  perform set_config('request.path', '/rpc/preuve_de_reserve', true);
  perform avant_chaque_requete();
  perform set_config('request.path', '/soldes', true);
  begin perform avant_chaque_requete(); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'double authentification requise', sqlerrm; end;
  -- le contrôle : la même requête, en session forte, passe
  perform set_config('request.jwt.claims', format('{"role": "authenticated", "aal": "aal2", "sub": "11111111-1111-1111-1111-111111111111", "amr": [{"method": "password", "timestamp": %s}, {"method": "totp", "timestamp": %s}]}',
                                                  extract(epoch from now())::bigint, extract(epoch from now())::bigint), true);
  perform avant_chaque_requete();
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform avant_chaque_requete();
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform avant_chaque_requete();
  perform set_config('request.jwt.claims', '', true);
  perform avant_chaque_requete();
  raise notice '✓ 11.59 le crochet : en aal1 la requête est refusée avant la fonction, sauf l''écran d''entrée et la preuve ; aal2, anon, service et la base passent';
end $$;
rollback;

-- 11.60 · la vérification avant sortie (0036), le chemin normal. Le code part
-- par e-mail avec le montant et la destination ; un mauvais mot de passe, un
-- mauvais code, un autre montant sont refusés ; la bonne combinaison sert UNE
-- fois, et le code s'efface de la boîte d'envoi. Rejouer la même clé rend la
-- sortie faite sans consommer de vérification.
begin;
update parametres set valeur = valeur || '{"ouvertes": true, "mode": "manuel"}' where cle = 'sortie';
do $$
declare
  c uuid := 'b1600000-0000-0000-0000-000000000001'; nid uuid; v jsonb; vid uuid; code text; r jsonb; ref text;
begin
  insert into comptes (id, telephone, nom, palier, argent_reel) values (c, '+237677160001', 'Vérifié Un', 0, true);
  insert into auth.users (id, email, encrypted_password) values (c, 'verifie.un@example.com', extensions.crypt('Glisil-2026-sur', extensions.gen_salt('bf', 10)));
  insert into numeros (compte_id, operateur, numero, verifie_le, actif_des) values (c, 'mtn', '677160001', now() - interval '2 days', now() - interval '1 day')
  returning id into nid;
  perform _mouvement(c, 'XAFe', 100000, 0, 'test', 'test', 'T-11.60');
  perform set_config('xafe.compte', c::text, true);

  v := preparer_verification('sortie_momo', jsonb_build_object('montant', 50000, 'numero_id', nid, 'nom', 'Vérifié Un'));
  vid := (v ->> 'id')::uuid;
  assert v -> 'affichage' ->> 'numero' = '677160001' and (v -> 'affichage' ->> 'montant')::numeric = 50000, v;
  assert v ->> 'email_masque' = 'v•••@example.com', v;
  select k.donnees ->> 'code' into code from courriels_a_envoyer k join verifications w on w.courriel_id = k.id where w.id = vid;
  assert code ~ '^[0-9]{6}$', 'le code part dans la boîte d''envoi';
  assert (select donnees ->> 'numero' = '677160001' and (donnees ->> 'montant')::numeric = 50000
            from courriels_a_envoyer k join verifications w on w.courriel_id = k.id where w.id = vid), 'l''e-mail dit le montant et la destination';
  assert (select code_empreinte <> code and code_empreinte like '$2a$%' from verifications where id = vid), 'la base ne garde qu''une empreinte';

  -- un autre montant : jamais ce code, et ce n'est pas un essai
  r := demander_sortie(90000, nid, 'k-1160', vid, 'Glisil-2026-sur', code, 'Vérifié Un');
  assert r ->> 'erreur' = 'la vérification ne correspond pas à cette opération', r;
  assert (select essais from verifications where id = vid) = 0, 'un autre montant ne compte pas d''essai';
  -- un mauvais mot de passe, puis un mauvais code : chacun compté, rien de bloqué
  r := demander_sortie(50000, nid, 'k-1160', vid, 'faux-mot-de-passe', code, 'Vérifié Un');
  assert r ->> 'erreur' = 'mot de passe incorrect' and (r ->> 'essais_restants')::int = 4, r;
  r := demander_sortie(50000, nid, 'k-1160', vid, 'Glisil-2026-sur', case when code = '000000' then '111111' else '000000' end, 'Vérifié Un');
  assert r ->> 'erreur' = 'code e-mail incorrect' and (r ->> 'essais_restants')::int = 3, r;
  assert solde(c, 'XAFe', 'bloque') = 0 and not exists (select 1 from sorties where compte_id = c), 'un facteur faux ne sort rien';
  -- la bonne combinaison
  r := demander_sortie(50000, nid, 'k-1160', vid, 'Glisil-2026-sur', code, 'Vérifié Un');
  ref := r ->> 'reference';
  assert ref like 'XAFe-WD-%' and solde(c, 'XAFe', 'bloque') = 50000, r;
  assert (select verification_id from sorties where reference = ref) = vid, 'la sortie garde sa vérification';
  assert (select consommee_le is not null and operation_ref = ref from verifications where id = vid), 'la vérification est consommée';
  assert not (select donnees ? 'code' from courriels_a_envoyer k join verifications w on w.courriel_id = k.id where w.id = vid), 'le code s''efface après usage';
  -- rejouer la même clé : la sortie faite, sans « vérification déjà utilisée »
  r := demander_sortie(50000, nid, 'k-1160', vid, 'Glisil-2026-sur', code, 'Vérifié Un');
  assert (r ->> 'deja')::boolean and r ->> 'reference' = ref, r;
  -- la même vérification pour une NOUVELLE sortie : refusée
  r := demander_sortie(50000, nid, 'k-1160-bis', vid, 'Glisil-2026-sur', code, 'Vérifié Un');
  assert r ->> 'erreur' = 'vérification déjà utilisée', r;
  assert solde(c, 'XAFe', 'bloque') = 50000, 'une vérification ne sort qu''une fois';
  raise notice '✓ 11.60 la vérification avant sortie : le code part avec le montant et la destination ; autre montant, mot de passe ou code faux refusés ; la bonne combinaison sert une fois, puis s''efface ; la même clé rend la sortie faite';
end $$;
rollback;

-- 11.60b · rouvrir l'écran ne coûte pas une minute. Le même écran rouvert
-- (retour arrière, rechargement) rend le code déjà parti, sans nouvel e-mail ;
-- une AUTRE opération dans la minute attend ; un code qui a servi, ou dont
-- l'e-mail n'a pas pu partir, ne retient pas le suivant. Sans cela, revenir
-- après une réponse perdue butait sur « attendez une minute ».
begin;
update parametres set valeur = valeur || '{"ouvertes": true, "mode": "manuel"}' where cle = 'sortie';
do $$
declare
  c uuid := 'b1600000-0000-0000-0000-00000000000b'; nid uuid; v1 jsonb; v2 jsonb; v3 jsonb; v4 jsonb; code text; r jsonb; n int;
begin
  insert into comptes (id, telephone, nom, palier, argent_reel) values (c, '+237677160011', 'Rouvre Un', 0, true);
  insert into auth.users (id, email, encrypted_password) values (c, 'rouvre.un@example.com', extensions.crypt('Glisil-2026-sur', extensions.gen_salt('bf', 10)));
  insert into numeros (compte_id, operateur, numero, verifie_le, actif_des) values (c, 'mtn', '677160011', now() - interval '2 days', now() - interval '1 day')
  returning id into nid;
  perform _mouvement(c, 'XAFe', 100000, 0, 'test', 'test', 'T-11.60b');
  perform set_config('xafe.compte', c::text, true);

  v1 := preparer_verification('sortie_momo', jsonb_build_object('montant', 50000, 'numero_id', nid, 'nom', 'Rouvre Un'));
  n := (select count(*) from courriels_a_envoyer where compte_id = c);
  v2 := preparer_verification('sortie_momo', jsonb_build_object('montant', 50000, 'numero_id', nid, 'nom', 'Rouvre Un'));
  assert v2 ->> 'id' = v1 ->> 'id' and (v2 ->> 'meme_code')::boolean, 'le même écran rouvert rend la même vérification';
  assert (select count(*) from courriels_a_envoyer where compte_id = c) = n, 'sans nouvel e-mail';
  assert v2 ->> 'renvoi_des' = v1 ->> 'renvoi_des', 'et sans repousser le renvoi';
  -- une autre opération dans la minute : elle attend
  begin
    perform preparer_verification('sortie_momo', jsonb_build_object('montant', 40000, 'numero_id', nid, 'nom', 'Rouvre Un'));
    raise exception 'aurait dû refuser';
  exception when others then
    assert sqlerrm = 'trop de codes demandés : attendez une minute', sqlerrm;
  end;
  -- le code sert : il ne retient plus le suivant
  select k.donnees ->> 'code' into code from courriels_a_envoyer k join verifications w on w.courriel_id = k.id where w.id = (v1 ->> 'id')::uuid;
  r := demander_sortie(50000, nid, 'k-1160b', (v1 ->> 'id')::uuid, 'Glisil-2026-sur', code, 'Rouvre Un');
  assert r ->> 'reference' like 'XAFe-WD-%', r;
  v3 := preparer_verification('sortie_momo', jsonb_build_object('montant', 40000, 'numero_id', nid, 'nom', 'Rouvre Un'));
  assert v3 ->> 'id' <> v1 ->> 'id' and not coalesce((v3 ->> 'meme_code')::boolean, false), 'un code qui a servi ne retient pas le suivant';
  -- un e-mail qui n'a pas pu partir : « renvoyer » envoie vraiment un nouveau code
  update courriels_a_envoyer set etat = 'echoue' where id = (select courriel_id from verifications where id = (v3 ->> 'id')::uuid);
  v4 := preparer_verification('sortie_momo', jsonb_build_object('montant', 40000, 'numero_id', nid, 'nom', 'Rouvre Un'));
  assert v4 ->> 'id' <> v3 ->> 'id', 'un e-mail en panne ne se rend pas tel quel';
  assert (select remplacee_le is not null from verifications where id = (v3 ->> 'id')::uuid), 'l''ancien code ne vaut plus rien';
  -- une réponse perdue : la même demande refaite avec un NOUVEAU code rend la sortie faite,
  -- et ce second code se clôt — sinon il retiendrait la prochaine demande une minute
  r := demander_sortie(50000, nid, 'k-1160b', (v4 ->> 'id')::uuid, 'peu-importe', '000000', 'Rouvre Un');
  assert (r ->> 'deja')::boolean, r;
  assert (select remplacee_le is not null and consommee_le is null and essais = 0 from verifications where id = (v4 ->> 'id')::uuid), 'le code du second essai est clos, sans compter d''essai';
  perform preparer_verification('sortie_momo', jsonb_build_object('montant', 30000, 'numero_id', nid, 'nom', 'Rouvre Un'));
  raise notice '✓ 11.60b le même écran rouvert rend le code déjà parti (sans e-mail) ; une autre opération attend la minute ; un code consommé, clos par une demande rejouée, ou dont l''e-mail est en panne ne retient pas le suivant';
end $$;
rollback;

-- 11.61 · le TOTP doit être FRAIS et la vérification reste à SA session. Un
-- TOTP vieux de dix minutes est refusé sans compter d'essai (une session volée
-- sans le téléphone ne devine pas le mot de passe) ; une autre session ne
-- consomme pas le code ; en aal1, rien ne se demande.
begin;
update parametres set valeur = valeur || '{"ouvertes": true, "mode": "manuel"}' where cle = 'sortie';
do $$
declare
  c uuid := 'b1610000-0000-0000-0000-000000000001'; nid uuid; v jsonb; vid uuid; code text; r jsonb; t bigint := extract(epoch from now())::bigint;
begin
  insert into comptes (id, telephone, nom, palier, argent_reel) values (c, '+237677161001', 'Vérifié Deux', 0, true);
  insert into auth.users (id, email, encrypted_password) values (c, 'verifie.deux@example.com', extensions.crypt('Glisil-2026-sur', extensions.gen_salt('bf', 10)));
  insert into numeros (compte_id, operateur, numero, verifie_le, actif_des) values (c, 'mtn', '677161001', now() - interval '2 days', now() - interval '1 day')
  returning id into nid;
  perform _mouvement(c, 'XAFe', 100000, 0, 'test', 'test', 'T-11.61');
  perform set_config('xafe.compte', c::text, true);
  v := preparer_verification('sortie_momo', jsonb_build_object('montant', 20000, 'numero_id', nid, 'nom', 'Vérifié Deux'));
  vid := (v ->> 'id')::uuid;
  select k.donnees ->> 'code' into code from courriels_a_envoyer k join verifications w on w.courriel_id = k.id where w.id = vid;

  -- un TOTP d'il y a dix minutes (la session tient, le téléphone n'est plus là)
  perform set_config('xafe.amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', t - 900),
                                                   jsonb_build_object('method', 'totp', 'timestamp', t - 600))::text, true);
  r := demander_sortie(20000, nid, 'k-1161', vid, 'faux-mot-de-passe', code, 'Vérifié Deux');
  assert r ->> 'facteur' = 'totp', r;
  assert (select essais from verifications where id = vid) = 0, 'sans TOTP frais, le mot de passe n''est même pas essayé';
  -- « mfa/totp » (l'autre écriture de GoTrue) frais : accepté
  perform set_config('xafe.amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', t - 900),
                                                   jsonb_build_object('method', 'mfa/totp', 'timestamp', t))::text, true);
  -- une autre session, avec tous les bons facteurs : la vérification ne lui appartient pas
  perform set_config('xafe.session', gen_random_uuid()::text, true);
  r := demander_sortie(20000, nid, 'k-1161', vid, 'Glisil-2026-sur', code, 'Vérifié Deux');
  assert r ->> 'erreur' = 'vérification inconnue', r;
  perform set_config('xafe.session', '', true);
  -- la bonne session, TOTP frais : la sortie part
  r := demander_sortie(20000, nid, 'k-1161', vid, 'Glisil-2026-sur', code, 'Vérifié Deux');
  assert r ->> 'reference' like 'XAFe-WD-%', r;
  -- aal1 (mot de passe sans TOTP) : rien ne se demande
  perform set_config('xafe.aal', 'aal1', true);
  begin perform preparer_verification('sortie_momo', jsonb_build_object('montant', 1000, 'numero_id', nid, 'nom', 'Vérifié Deux'));
        raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'double authentification requise', sqlerrm; end;
  perform set_config('xafe.aal', '', true);
  perform set_config('xafe.amr', '', true);
  raise notice '✓ 11.61 un TOTP vieux de dix minutes est refusé sans compter d''essai ; « mfa/totp » frais vaut « totp » ; une autre session ne consomme pas le code ; en aal1 rien ne se demande';
end $$;
rollback;

-- 11.62 · dix échecs dans l'heure bloquent les sorties une heure : la demande
-- comme la consommation, même avec les bons facteurs. Un e-mail prévient une
-- fois. L'équipe lève le blocage, avec une note, et c'est journalisé.
begin;
update parametres set valeur = valeur || '{"ouvertes": true, "mode": "manuel"}' where cle = 'sortie';
do $$
declare
  c uuid := 'b1620000-0000-0000-0000-000000000001'; nid uuid; v jsonb; vid uuid; code text; r jsonb; i int;
begin
  insert into comptes (id, telephone, nom, palier, argent_reel) values (c, '+237677162001', 'Vérifié Trois', 0, true);
  insert into auth.users (id, email, encrypted_password) values (c, 'verifie.trois@example.com', extensions.crypt('Glisil-2026-sur', extensions.gen_salt('bf', 10)));
  insert into numeros (compte_id, operateur, numero, verifie_le, actif_des) values (c, 'mtn', '677162001', now() - interval '2 days', now() - interval '1 day')
  returning id into nid;
  perform _mouvement(c, 'XAFe', 100000, 0, 'test', 'test', 'T-11.62');
  perform set_config('xafe.compte', c::text, true);
  -- deux vérifications (cinq essais chacune) : dix mots de passe faux
  for i in 1..2 loop
    update verifications set cree_le = cree_le - interval '2 minutes' where compte_id = c;
    v := preparer_verification('sortie_momo', jsonb_build_object('montant', 10000, 'numero_id', nid, 'nom', 'Vérifié Trois'));
    vid := (v ->> 'id')::uuid;
    for j in 1..5 loop
      r := demander_sortie(10000, nid, null, vid, 'faux-' || i || j, '123456', 'Vérifié Trois');
    end loop;
  end loop;
  assert _verrou_verification(c) is not null, 'dix échecs : verrouillé';
  assert (select count(*) from courriels_a_envoyer where compte_id = c and gabarit = 'verification_verrouillee') = 1, 'un e-mail prévient, une fois';
  update verifications set cree_le = cree_le - interval '2 minutes' where compte_id = c;
  begin perform preparer_verification('sortie_momo', jsonb_build_object('montant', 10000, 'numero_id', nid, 'nom', 'Vérifié Trois'));
        raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'vérifications verrouillées', sqlerrm; end;

  -- l'équipe lève le blocage (note exigée, journalisée)
  perform set_config('xafe.compte', 'dddddddd-0000-0000-0000-000000000001', true);   -- le super admin
  begin perform admin_lever_verrou_verification(c, 'ok'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'note trop courte', sqlerrm; end;
  r := admin_lever_verrou_verification(c, 'appel du client, identité vérifiée');
  assert (r ->> 'echecs_effaces')::int = 10, r;
  assert exists (select 1 from journal_admin where action = 'lever_verrou_verification' and cible = c::text), 'journalisé';
  perform set_config('xafe.compte', c::text, true);
  assert _verrou_verification(c) is null, 'le blocage est levé';
  v := preparer_verification('sortie_momo', jsonb_build_object('montant', 10000, 'numero_id', nid, 'nom', 'Vérifié Trois'));
  vid := (v ->> 'id')::uuid;
  select k.donnees ->> 'code' into code from courriels_a_envoyer k join verifications w on w.courriel_id = k.id where w.id = vid;
  r := demander_sortie(10000, nid, 'k-1162', vid, 'Glisil-2026-sur', code, 'Vérifié Trois');
  assert r ->> 'reference' like 'XAFe-WD-%', r;
  raise notice '✓ 11.62 dix échecs dans l''heure bloquent les sorties (un e-mail prévient une fois) ; l''équipe lève le blocage avec une note journalisée, et la sortie repart';
end $$;
rollback;

-- 11.63 · les trois autres sorties d'argent passent par la même vérification :
-- le retrait crypto (lié à l'adresse et au montant), la fermeture du compte,
-- le retrait d'un numéro. Un compte Google sans mot de passe doit le choisir
-- d'abord. Les anciennes entrées au code secret n'existent plus.
begin;
update parametres set valeur = valeur || '{"retraits_ouverts": true}' where cle = 'crypto';
do $$
declare
  c uuid := 'b1630000-0000-0000-0000-000000000001'; g uuid := 'b1630000-0000-0000-0000-000000000002';
  n1 uuid; n2 uuid; v jsonb; vid uuid; code text; r jsonb;
  a1 text := '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21'; a2 text := '0x1111111111111111111111111111111111111111';
begin
  insert into comptes (id, telephone, nom, palier, argent_reel) values (c, '+237677163001', 'Vérifié Quatre', 0, true);
  insert into auth.users (id, email, encrypted_password) values (c, 'verifie.quatre@example.com', extensions.crypt('Glisil-2026-sur', extensions.gen_salt('bf', 10)));
  insert into numeros (compte_id, operateur, numero, verifie_le, actif_des) values (c, 'mtn', '677163001', now() - interval '2 days', now() - interval '1 day')
  returning id into n1;
  insert into numeros (compte_id, operateur, numero, verifie_le, actif_des) values (c, 'om', '699163001', now() - interval '2 days', now() - interval '1 day')
  returning id into n2;
  perform crediter_crypto(c, 'USDT', 'bep20', 500, '0x1163', 'x');
  perform set_config('xafe.compte', c::text, true);

  -- le retrait crypto : lié à l'adresse ET au montant
  v := preparer_verification('retrait_crypto', jsonb_build_object('actif', 'USDT', 'reseau', 'bep20', 'adresse', a1, 'montant', 100));
  vid := (v ->> 'id')::uuid;
  assert v -> 'affichage' ->> 'adresse' = a1, v;
  select k.donnees ->> 'code' into code from courriels_a_envoyer k join verifications w on w.courriel_id = k.id where w.id = vid;
  r := demander_retrait_crypto('USDT', 'bep20', a2, 100, 'k-1163', vid, 'Glisil-2026-sur', code);
  assert r ->> 'erreur' = 'la vérification ne correspond pas à cette opération', format('une autre adresse avec le même code : %s', r);
  r := demander_retrait_crypto('USDT', 'bep20', a1, 100, 'k-1163', vid, 'Glisil-2026-sur', code);
  assert r ->> 'reference' like 'XAFe-CR-%' and (select verification_id from retraits_crypto where reference = r ->> 'reference') = vid, r;

  -- retirer un numéro
  update verifications set cree_le = cree_le - interval '2 minutes' where compte_id = c;
  v := preparer_verification('retirer_numero', jsonb_build_object('numero_id', n2));
  vid := (v ->> 'id')::uuid;
  select k.donnees ->> 'code' into code from courriels_a_envoyer k join verifications w on w.courriel_id = k.id where w.id = vid;
  r := retirer_numero(n1, vid, 'Glisil-2026-sur', code);
  assert r ->> 'erreur' = 'la vérification ne correspond pas à cette opération', format('un autre numéro avec le même code : %s', r);
  r := retirer_numero(n2, vid, 'Glisil-2026-sur', code);
  assert (r ->> 'ok')::boolean and (select retire_le is not null from numeros where id = n2), r;

  -- un compte Google sans mot de passe : il le choisit d'abord
  insert into comptes (id, telephone, nom, palier, argent_reel) values (g, '+237677163002', 'Google Seul', 0, true);
  insert into auth.users (id, email, encrypted_password) values (g, 'google.seul@example.com', null);
  perform set_config('xafe.compte', g::text, true);
  perform set_config('xafe.amr', jsonb_build_array(jsonb_build_object('method', 'oauth', 'timestamp', extract(epoch from now())::bigint),
                                                   jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint))::text, true);
  v := preparer_verification('fermer_compte', '{}'::jsonb);
  vid := (v ->> 'id')::uuid;
  select k.donnees ->> 'code' into code from courriels_a_envoyer k join verifications w on w.courriel_id = k.id where w.id = vid;
  r := fermer_mon_compte(vid, '', code, 'essai');
  assert r ->> 'erreur' = 'mot de passe à choisir', r;
  assert (select ferme_le from comptes where id = g) is null, 'rien n''est fermé';
  -- le mot de passe choisi, la fermeture passe
  update auth.users set encrypted_password = extensions.crypt('Glisil-2026-sur', extensions.gen_salt('bf', 10)) where id = g;
  r := fermer_mon_compte(vid, 'Glisil-2026-sur', code, 'essai');
  assert (r ->> 'ok')::boolean and (select ferme_le is not null from comptes where id = g), r;
  perform set_config('xafe.amr', '', true);

  -- les anciennes entrées, au code secret, n'existent plus
  assert to_regprocedure('public.demander_sortie(numeric,uuid,text,text,text)') is null
     and to_regprocedure('public.demander_retrait_crypto(text,text,text,numeric,text,text)') is null
     and to_regprocedure('public.fermer_mon_compte(text,text)') is null
     and to_regprocedure('public.retirer_numero(uuid,text)') is null, 'une sortie au code secret reste ouverte';
  raise notice '✓ 11.63 le retrait crypto (lié à l''adresse et au montant), le retrait d''un numéro et la fermeture passent par la vérification ; un compte Google choisit d''abord son mot de passe ; aucune sortie au code secret ne reste';
end $$;
rollback;

-- 11.76 · choisir sa langue (0037). Le choix se range dans le compte (lu par
-- la boîte d'envoi) ET dans les métadonnées d'Auth (lues par les gabarits de
-- Supabase), sans effacer ce que signUp y avait mis. Une langue qu'on ne sait
-- pas écrire est refusée à la lettre ; une session faible ne choisit rien.
-- Témoin : le compte voisin, qui n'a rien choisi, reste en anglais.
begin;
do $$
declare c uuid := 'b1760000-0000-0000-0000-000000000001'; t uuid := 'b1760000-0000-0000-0000-000000000002'; r jsonb;
begin
  insert into comptes (id, telephone, nom) values (c, '+237677176001', 'Langue Un'), (t, '+237677176002', 'Langue Témoin');
  insert into auth.users (id, email, raw_user_meta_data) values (c, 'langue.un@example.com', '{"prenom": "Lou"}'),
                                                                (t, 'langue.temoin@example.com', null);
  assert (select langue from comptes where id = c) = 'en', 'l''anglais est la langue par défaut';
  perform set_config('xafe.compte', c::text, true);
  r := choisir_ma_langue('fr');
  assert (r ->> 'ok')::boolean and r ->> 'langue' = 'fr', r;
  assert (select langue from comptes where id = c) = 'fr', 'le compte garde le choix';
  assert (select raw_user_meta_data from auth.users where id = c) = '{"prenom": "Lou", "langue": "fr"}'::jsonb,
         format('les métadonnées d''Auth suivent, le reste intact : %s', (select raw_user_meta_data from auth.users where id = c));
  begin perform choisir_ma_langue('de'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'langue inconnue', sqlerrm; end;
  begin perform choisir_ma_langue('FR'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'langue inconnue', sqlerrm; end;
  begin perform choisir_ma_langue(null); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'langue inconnue', sqlerrm; end;
  assert (select langue from comptes where id = c) = 'fr', 'un refus ne change rien';
  -- aal1 : le mot de passe sans le code de l'application
  perform set_config('xafe.aal', 'aal1', true);
  perform set_config('xafe.amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint))::text, true);
  begin perform choisir_ma_langue('en'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'double authentification requise', sqlerrm; end;
  assert (select langue from comptes where id = c) = 'fr' and (select raw_user_meta_data ->> 'langue' from auth.users where id = c) = 'fr',
         'en session faible, rien ne bouge';
  perform set_config('xafe.aal', '', true); perform set_config('xafe.amr', '', true);
  -- et l'on revient à l'anglais
  r := choisir_ma_langue('en');
  assert (select langue from comptes where id = c) = 'en' and (select raw_user_meta_data ->> 'langue' from auth.users where id = c) = 'en', r;
  assert (select langue from comptes where id = t) = 'en' and (select raw_user_meta_data from auth.users where id = t) is null,
         'le voisin n''a rien choisi : rien n''a changé chez lui';
  assert not has_function_privilege('anon', 'choisir_ma_langue(text)', 'execute')
     and has_function_privilege('authenticated', 'choisir_ma_langue(text)', 'execute')
     and not has_function_privilege('authenticated', '_langue_d_auth(uuid)', 'execute'), 'les droits de la langue';
  raise notice '✓ 11.76 choisir sa langue : le compte et les métadonnées d''Auth suivent (le reste intact) ; « de », « FR » et rien refusés ; en aal1 rien ne bouge ; le voisin reste en anglais';
end $$;
rollback;

-- 11.77 · ouvrir son compte dans sa langue (0037). L'écran d'inscription a
-- passé la langue à signUp : elle devient celle du compte. Sans langue, ou
-- avec une qu'on ne sait pas écrire, c'est l'anglais.
begin;
select _essai_utilisateur('f5770000-0000-0000-0000-000000000001', 'inscrit.fr@example.com');
select _essai_utilisateur('f5770000-0000-0000-0000-000000000002', 'inscrit.sans@example.com');
select _essai_utilisateur('f5770000-0000-0000-0000-000000000003', 'inscrit.de@example.com');
select _essai_utilisateur('f5770000-0000-0000-0000-000000000004', 'inscrit.en@example.com');
update auth.users set raw_user_meta_data = '{"langue": "fr"}' where id = 'f5770000-0000-0000-0000-000000000001';
update auth.users set raw_user_meta_data = '{"langue": "de"}' where id = 'f5770000-0000-0000-0000-000000000003';
update auth.users set raw_user_meta_data = '{"langue": "en"}' where id = 'f5770000-0000-0000-0000-000000000004';
do $$
declare r jsonb; v_cond text := parametre('conditions') ->> 'version';
begin
  perform set_config('xafe.compte', 'f5770000-0000-0000-0000-000000000001', true);
  r := ouvrir_mon_compte('Fanny', 'Francaise', date '1990-05-14', '+237677177001', 'Douala', 'CM', v_cond);
  assert r ->> 'langue' = 'fr' and (select langue from comptes where id = 'f5770000-0000-0000-0000-000000000001') = 'fr', r;
  perform set_config('xafe.compte', 'f5770000-0000-0000-0000-000000000002', true);
  r := ouvrir_mon_compte('Sam', 'Sanslangue', date '1990-05-14', '+237677177002', 'Douala', 'CM', v_cond);
  assert r ->> 'langue' = 'en', format('sans langue donnée, l''anglais : %s', r);
  perform set_config('xafe.compte', 'f5770000-0000-0000-0000-000000000003', true);
  r := ouvrir_mon_compte('Dieter', 'Deutsch', date '1990-05-14', '+237677177003', 'Douala', 'CM', v_cond);
  assert r ->> 'langue' = 'en', format('une langue qu''on ne sait pas écrire, l''anglais : %s', r);
  perform set_config('xafe.compte', 'f5770000-0000-0000-0000-000000000004', true);
  r := ouvrir_mon_compte('Emma', 'English', date '1990-05-14', '+237677177004', 'Douala', 'CM', v_cond);
  assert r ->> 'langue' = 'en', r;
  raise notice '✓ 11.77 ouvrir son compte : la langue donnée à l''inscription devient celle du compte ; sans elle, ou inconnue, l''anglais';
end $$;
rollback;

-- 11.78 · la boîte d'envoi dit dans quelle langue écrire (0037). Celle du
-- compte, lue AU MOMENT de prendre la ligne : un client qui change d'avis est
-- entendu pour l'e-mail déjà en file. Une adresse de l'équipe (sans compte)
-- prend la langue que le moteur a posée, sinon l'anglais.
begin;
do $$
declare
  c uuid := 'b1780000-0000-0000-0000-000000000001'; e uuid := 'b1780000-0000-0000-0000-000000000002';
  k1 bigint; k2 bigint; k3 bigint; k4 bigint; k5 bigint; r jsonb;
begin
  insert into comptes (id, telephone, nom, langue) values (c, '+237677178001', 'Boîte Française', 'fr'), (e, '+237677178002', 'Boîte Anglaise', 'en');
  insert into auth.users (id, email, raw_user_meta_data) values (c, 'boite.fr@example.com', '{"langue": "fr"}'),
                                                                (e, 'boite.en@example.com', '{"langue": "fr"}');
  insert into courriels_a_envoyer (compte_id, gabarit, donnees) values (c, 'essai', '{}') returning id into k1;
  insert into courriels_a_envoyer (compte_id, gabarit, donnees) values (e, 'essai', '{"langue": "fr"}') returning id into k2;
  insert into courriels_a_envoyer (destinataire, gabarit, donnees) values ('equipe@example.com', 'essai', '{}') returning id into k3;
  insert into courriels_a_envoyer (destinataire, gabarit, donnees) values ('equipe@example.com', 'essai', '{"langue": "fr"}') returning id into k4;
  insert into courriels_a_envoyer (destinataire, gabarit, donnees) values ('equipe@example.com', 'essai', '{"langue": "de"}') returning id into k5;
  r := courriel_prendre(k1);
  assert r ->> 'langue' = 'fr' and r ->> 'email' = 'boite.fr@example.com', r;
  -- le COMPTE décide, ni les métadonnées ni les données de la ligne
  r := courriel_prendre(k2);
  assert r ->> 'langue' = 'en', format('le compte est en anglais : %s', r);
  r := courriel_prendre(k3);
  assert r ->> 'langue' = 'en' and r ->> 'email' = 'equipe@example.com', format('l''équipe, sans langue posée : l''anglais — %s', r);
  r := courriel_prendre(k4);
  assert r ->> 'langue' = 'fr', r;
  r := courriel_prendre(k5);
  assert r ->> 'langue' = 'en', format('une langue qu''on ne sait pas écrire : l''anglais — %s', r);
  -- changer d'avis avec un e-mail en file : il part dans la nouvelle langue
  insert into courriels_a_envoyer (compte_id, gabarit, donnees) values (c, 'essai', '{}') returning id into k1;
  perform set_config('xafe.compte', c::text, true);
  perform choisir_ma_langue('en');
  perform set_config('xafe.compte', '', true);
  r := courriel_prendre(k1);
  assert r ->> 'langue' = 'en', format('le choix d''après l''inscription en file compte : %s', r);
  raise notice '✓ 11.78 la boîte d''envoi dit la langue du compte, lue au moment d''envoyer ; une adresse de l''équipe prend celle posée par le moteur, sinon l''anglais';
end $$;
rollback;

-- 11.79 · l'écran lit la langue du compte (0037) : mon_compte la montre, et
-- elle suit le choix.
begin;
do $$
declare c uuid := 'b1790000-0000-0000-0000-000000000001';
begin
  insert into comptes (id, telephone, nom) values (c, '+237677179001', 'Écran Langue');
  insert into auth.users (id, email) values (c, 'ecran.langue@example.com');
  perform set_config('xafe.compte', c::text, true);
  assert mon_compte() ->> 'langue' = 'en', mon_compte();
  perform choisir_ma_langue('fr');
  assert mon_compte() ->> 'langue' = 'fr', mon_compte();
  raise notice '✓ 11.79 mon_compte montre la langue du compte, et elle suit le choix';
end $$;
rollback;

-- 11.80 · le remboursement manuel PROUVÉ par la puce (0038). Taper un ID ne
-- détruit plus rien : la sortie passe « en preuve », et ses XAFe ne sont
-- détruits que lorsque TOTEM relève, sur un float de Glisil, le SMS qui montre
-- CE paiement (même ID, même montant, même numéro, après la demande, du même
-- monde, ne prouvant pas déjà une autre sortie). Témoin : avant 0038,
-- admin_payer_sortie rendait « envoyee » à la première ligne de A.
begin;
update parametres set valeur = valeur || '{"ouvertes": true, "mode": "manuel", "seuil_deux_personnes": null, "forcage": false}' where cle = 'sortie';
insert into numeros (compte_id, operateur, numero, verifie_le, actif_des)
values ('11111111-1111-1111-1111-111111111111', 'mtn', '677444054', now() - interval '3 days', now() - interval '2 days');
insert into terminaux (id, nom, cle, demo) values ('demo-80', 'Démo 80', 'cle-demo-80-assez-longue', true);
insert into floats (operateur, numero, terminal) values ('mtn', '600000080', 'demo-80');
create or replace function pg_temp.demander(p_montant numeric, p_cle text) returns text language plpgsql as $f$
begin
  perform set_config('xafe.compte', '11111111-1111-1111-1111-111111111111', true);
  return _demander_sortie(p_montant, (select id from numeros where numero = '677444054'), p_cle, 'Alice Mballa') ->> 'reference';
end $f$;
do $$
declare
  a     uuid := '11111111-1111-1111-1111-111111111111';
  nelson text := 'dddddddd-0000-0000-0000-000000000001'; ops text := 'dddddddd-0000-0000-0000-000000000002';
  r jsonb; ref text; x numeric; bloque0 numeric; detruit0 numeric;
begin
  perform _mouvement(a, 'XAFe', 5000000, 0, 'test', 'test', 'T-11.80');
  insert into emissions (sens, montant, source_table, source_id) values ('emission', 5000000, 'test', 'T-11.80');   -- l'argent d'essai est créé, comme un dépôt
  update terminaux set vu_le = now() where id = 'akwa-1';
  detruit0 := (select coalesce(sum(montant), 0) from emissions where sens = 'destruction');

  -- A · l'ID d'abord, le SMS ensuite (le propriétaire seul)
  ref := pg_temp.demander(100000, 'k-80-a');
  x := (select montant_xaf from sorties where reference = ref);
  bloque0 := solde(a, 'XAFe', 'bloque');
  perform set_config('xafe.compte', nelson, true);
  r := admin_payer_sortie(ref, 'MP261029.0900.A54001');
  assert r ->> 'etat' = 'en_preuve' and r -> 'rapprochement' ->> 'etat' = 'absent', 'A · un ID tapé ne détruit rien ' || r::text;
  assert solde(a, 'XAFe', 'bloque') = bloque0 and (select coalesce(sum(montant), 0) from emissions where sens = 'destruction') = detruit0, 'A · rien de détruit';
  assert not exists (select 1 from notifications where compte_id = a and titre = 'Sortie envoyée' and cible = '/historique/' || ref), 'A · pas encore de « Sortie envoyée »';
  assert not exists (select 1 from courriels_a_envoyer where cle = 'sortie_payee:' || ref), 'A · pas encore d''e-mail';
  begin perform admin_refuser_sortie(ref, 'je me ravise'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'un paiement est enregistré', sqlerrm; end;
  r := totem_sms_sortant('akwa-1', 75401, 'mtn', '677000000', '677444054', x, 'MP261029.0900.A54001', 'Transfert reussi. ID: MP261029.0900.A54001', now());
  assert (r ->> 'cloture')::boolean, 'A · le SMS clôt la sortie ' || r::text;
  assert (select etat = 'envoyee' and prouvee_le is not null from sorties where reference = ref), 'A · envoyée, prouvée';
  assert (select constatee_id = (r ->> 'id')::bigint from sortie_paiements where sortie_id = (select id from sorties where reference = ref)), 'A · le paiement garde son SMS';
  assert (select sortie_id = (select id from sorties where reference = ref) from sorties_constatees where id = (r ->> 'id')::bigint), 'A · le SMS garde sa sortie';
  assert solde(a, 'XAFe', 'bloque') = bloque0 - 100000 and (select coalesce(sum(montant), 0) from emissions where sens = 'destruction') = detruit0 + x, 'A · détruits : ce qui est parti';
  assert (select texte from notifications where compte_id = a and cible = '/historique/' || ref and titre = 'Sortie envoyée')
         = format('%s XAF envoyés au %s. Transaction ID : %s.', to_char(x, 'FM999G999G999G999'), '677444054', 'MP2610290900A54001'), 'A · la notification d''avant, au caractère près';
  assert (select count(*) from courriels_a_envoyer where cle = 'sortie_payee:' || ref) = 1, 'A · un e-mail';
  r := totem_sms_sortant('akwa-1', 75401, 'mtn', '677000000', '677444054', x, 'MP261029.0900.A54001', 'Transfert reussi. ID: MP261029.0900.A54001', now());
  assert (r ->> 'deja')::boolean and (select coalesce(sum(montant), 0) from emissions where sens = 'destruction') = detruit0 + x
     and (select count(*) from courriels_a_envoyer where cle = 'sortie_payee:' || ref) = 1, 'A · le même SMS relu : rien de plus';
  detruit0 := detruit0 + x;

  -- B · le SMS d'abord, l'ID ensuite : clos dans le même geste
  ref := pg_temp.demander(80000, 'k-80-b');
  x := (select montant_xaf from sorties where reference = ref);
  perform totem_sms_sortant('akwa-1', 75402, 'mtn', '677000000', '677444054', x, 'MP261029.0900.A54002', '…', now());
  perform set_config('xafe.compte', nelson, true);
  assert admin_payer_sortie(ref, 'MP261029.0900.A54002') ->> 'etat' = 'envoyee', 'B · le SMS était là : clos tout de suite';
  detruit0 := detruit0 + x;

  -- C · un montant mal tapé, corrigé, puis le reste payé en un second transfert
  ref := pg_temp.demander(300000, 'k-80-c');
  x := (select montant_xaf from sorties where reference = ref);
  perform totem_sms_sortant('akwa-1', 75403, 'mtn', '677000000', '677444054', x - 1000, 'MP261029.0900.A54003', '…', now());
  perform set_config('xafe.compte', nelson, true);
  r := admin_payer_sortie(ref, 'MP261029.0900.A54003');
  assert r ->> 'etat' = 'en_preuve' and r -> 'rapprochement' ->> 'etat' = 'ecart' and r -> 'rapprochement' ->> 'motif' like 'le SMS dit %', 'C · l''écart se dit ' || r::text;
  assert admin_verifier_sortie(ref) ->> 'etat' = 'en_preuve', 'C · revérifier ne clôt pas un écart';
  begin perform admin_corriger_paiement(ref, 'MP261029.0900.A54003', 'MP261029.0900.A54003', '', x - 1000); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'une note est exigée', sqlerrm; end;
  r := admin_corriger_paiement(ref, 'MP261029.0900.A54003', 'MP261029.0900.A54003', 'montant mal tapé', x - 1000);
  assert r -> 'rapprochement' ->> 'etat' = 'partiel' and (r -> 'rapprochement' ->> 'reste')::numeric = 1000, 'C · il reste 1 000 ' || r::text;
  begin perform admin_corriger_paiement(ref, 'MP261029.0900.A54003', 'MP261029.0900.A54099', 'essai', null); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'ce paiement est prouvé', sqlerrm; end;
  r := admin_payer_sortie(ref, 'MP261029.0900.A54004');   -- le montant : ce qui reste
  assert r ->> 'etat' = 'en_preuve' and (r -> 'paiements' -> 1 ->> 'montant')::numeric = 1000, 'C · le reste, par défaut ' || r::text;
  r := totem_sms_sortant('akwa-1', 75404, 'mtn', '677000000', '677444054', 1000, 'MP261029.0900.A54004', '…', now());
  assert (r ->> 'cloture')::boolean, 'C · les deux paiements prouvés : clos';
  assert (select texte like '%Transaction ID : MP2610290900A54003, MP2610290900A54004.' from notifications where cible = '/historique/' || ref and titre = 'Sortie envoyée'), 'C · la notification dit les deux ID';
  assert (select jsonb_array_length(donnees -> 'paiements') = 2 from courriels_a_envoyer where cle = 'sortie_payee:' || ref), 'C · l''e-mail aussi';
  detruit0 := detruit0 + x;

  -- D · le bon ID, le bon montant, un autre bénéficiaire
  ref := pg_temp.demander(50000, 'k-80-d');
  x := (select montant_xaf from sorties where reference = ref);
  perform totem_sms_sortant('akwa-1', 75405, 'mtn', '677000000', '677999054', x, 'MP261029.0900.A54005', '…', now());
  perform set_config('xafe.compte', nelson, true);
  r := admin_payer_sortie(ref, 'MP261029.0900.A54005');
  assert r ->> 'etat' = 'en_preuve' and r -> 'rapprochement' ->> 'motif' like 'le SMS dit le 677999054%', 'D · un autre numéro ' || r::text;

  -- E · un SMS sans numéro, relu avec : il se complète et clôt
  ref := pg_temp.demander(40000, 'k-80-e');
  x := (select montant_xaf from sorties where reference = ref);
  perform set_config('xafe.compte', nelson, true);
  perform admin_payer_sortie(ref, 'MP261029.0900.A54006');
  r := totem_sms_sortant('akwa-1', 75406, 'mtn', '677000000', null, x, 'MP261029.0900.A54006', 'Transfert reussi', now());
  assert (select _rapprochement(s) ->> 'motif' from sorties s where reference = ref) like 'le SMS ne dit pas le numéro%', 'E · le numéro manque';
  r := totem_sms_sortant('akwa-1', 75406, 'mtn', '677000000', '677444054', x, 'MP261029.0900.A54006', 'Transfert reussi', now());
  assert (r ->> 'deja')::boolean and (r ->> 'cloture')::boolean, 'E · le même SMS, relu avec le numéro : complété, et clos ' || r::text;
  detruit0 := detruit0 + x;

  -- F · un paiement relevé AVANT la demande ne la prouve pas
  perform totem_sms_sortant('akwa-1', 75407, 'mtn', '677000000', '677444054', 29850, 'MP261029.0800.A54007', '…', now());
  update sorties_constatees set recu_le = now() - interval '1 hour' where source_id = 75407;
  ref := pg_temp.demander(30000, 'k-80-f');
  perform set_config('xafe.compte', nelson, true);
  r := admin_payer_sortie(ref, 'MP261029.0800.A54007');
  assert r -> 'rapprochement' ->> 'motif' like '%avant la demande%', 'F · antérieur à la demande ' || r::text;

  -- G · le bon SMS, mais d'un terminal de démo ; puis d'une puce qui n'est pas un float
  ref := pg_temp.demander(20000, 'k-80-g');
  x := (select montant_xaf from sorties where reference = ref);
  perform totem_sms_sortant('demo-80', 75408, 'mtn', '600000080', '677444054', x, 'MP261029.0900.A54008', '…', now());
  perform set_config('xafe.compte', nelson, true);
  r := admin_payer_sortie(ref, 'MP261029.0900.A54008');
  assert r -> 'rapprochement' ->> 'motif' = 'le SMS vient d''un terminal de démo', 'G · terminal de démo ' || r::text;
  ref := pg_temp.demander(20000, 'k-80-g2');
  x := (select montant_xaf from sorties where reference = ref);
  perform totem_sms_sortant('akwa-1', 75409, 'mtn', '699999999', '677444054', x, 'MP261029.0900.A54009', '…', now());
  perform set_config('xafe.compte', nelson, true);
  assert admin_payer_sortie(ref, 'MP261029.0900.A54009') -> 'rapprochement' ->> 'motif' like '%pas un float Glisil%', 'G · une puce inconnue ne prouve rien';

  -- H · au-delà du seuil : prouvé, il attend une AUTRE personne
  update parametres set valeur = valeur || '{"seuil_deux_personnes": 100000}' where cle = 'sortie';
  ref := pg_temp.demander(200000, 'k-80-h');
  x := (select montant_xaf from sorties where reference = ref);
  perform set_config('xafe.compte', ops, true);
  perform admin_payer_sortie(ref, 'MP261029.0900.A54010');
  perform totem_sms_sortant('akwa-1', 75410, 'mtn', '677000000', '677444054', x, 'MP261029.0900.A54010', '…', now());
  assert (select etat from sorties where reference = ref) = 'en_preuve' and (admin_a_traiter() ->> 'sorties_a_confirmer')::int >= 1, 'H · prouvé, mais une seule personne';
  begin perform admin_confirmer_sortie(ref); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'une autre personne confirme', sqlerrm; end;
  perform set_config('xafe.compte', nelson, true);
  assert admin_confirmer_sortie(ref) ->> 'etat' = 'envoyee', 'H · la seconde personne clôt';
  detruit0 := detruit0 + x;
  update parametres set valeur = valeur || '{"seuil_deux_personnes": null}' where cle = 'sortie';

  -- I · la règle vit DANS la clôture : sans preuve, ou deux fois, elle refuse
  ref := pg_temp.demander(15000, 'k-80-i');
  perform set_config('xafe.compte', nelson, true);
  perform admin_payer_sortie(ref, 'MP261029.0900.A54011');
  begin perform _clore_sortie_manuelle((select id from sorties where reference = ref)); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paiement pas encore prouvé', sqlerrm; end;
  begin perform _clore_sortie_manuelle((select id from sorties where cle = 'k-80-a')); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'cette sortie ne se clôt pas', sqlerrm; end;
  assert (select coalesce(sum(montant), 0) from emissions where sens = 'destruction') = detruit0, 'I · aucune destruction de trop';

  -- J · forcer : fermé, réservé au super admin, trente minutes après, journalisé, une alerte
  begin perform admin_forcer_sortie(ref, 'relevé MTN reçu par e-mail'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'le forçage est fermé', sqlerrm; end;
  update parametres set valeur = valeur || '{"forcage": true}' where cle = 'sortie';
  perform set_config('xafe.compte', ops, true);
  begin perform admin_forcer_sortie(ref, 'relevé MTN reçu par e-mail'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'accès non autorisé', sqlerrm; end;
  perform set_config('xafe.compte', nelson, true);
  begin perform admin_forcer_sortie(ref, 'relevé MTN reçu par e-mail'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'attendez le SMS de la puce', sqlerrm; end;
  update sorties set payee_le = now() - interval '31 minutes' where reference = ref;
  begin perform admin_forcer_sortie(ref, 'court'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'une note est exigée', sqlerrm; end;
  r := admin_forcer_sortie(ref, 'relevé MTN reçu par e-mail');
  assert r ->> 'etat' = 'envoyee' and (select forcee_le is not null and prouvee_le is null from sorties where reference = ref), 'J · forcée, pas prouvée ' || r::text;
  assert exists (select 1 from journal_admin where action = 'forcer_sortie' and cible = ref), 'J · journalisé';
  assert exists (select 1 from parite_alertes where code = 'sortie_forcee:' || ref and close_le is null), 'J · une alerte';
  update parametres set valeur = valeur || '{"forcage": false}' where cle = 'sortie';

  -- K · un ID ne prouve qu'une sortie ; le même ID retapé sur la même : rien de plus
  ref := pg_temp.demander(10000, 'k-80-k');
  perform set_config('xafe.compte', nelson, true);
  begin perform admin_payer_sortie(ref, 'MP261029.0900.A54001'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'ce transaction ID prouve déjà une autre sortie', sqlerrm; end;
  perform admin_payer_sortie(ref, 'MP261029.0900.A54012');
  assert (admin_payer_sortie(ref, 'mp261029.0900.a54012') ->> 'deja')::boolean, 'K · le même ID retapé : rien de plus';

  -- L · on ne paie pas plus que la sortie
  ref := pg_temp.demander(10000, 'k-80-l');
  perform set_config('xafe.compte', nelson, true);
  begin perform admin_payer_sortie(ref, 'MP261029.0900.A54013', null, 1000000); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'montant du paiement invalide', sqlerrm; end;

  -- le SMS d'un second paiement n'est pas « inexpliqué »
  assert not exists (select 1 from jsonb_array_elements(admin_sorties_non_expliquees()) k where k ->> 'transaction_id' = 'MP2610290900A54004'), 'le second paiement de C est expliqué';
  assert total('XAFe') = circulation(), format('XAFe : %s en soldes, %s en circulation', total('XAFe'), circulation());
  raise notice '✓ 11.80 le remboursement manuel prouvé : un ID tapé ne détruit rien ; le SMS de la puce (même ID, montant, numéro, après la demande, d''un float du même monde) clôt, une fois ; payé en plusieurs transferts ; corrigé ; au-delà du seuil, deux personnes ; forcé seulement par le super admin, tard, journalisé ; un e-mail au client';
end $$;
rollback;

-- 11.81 · la continuité des soldes (0039) : un SMS d'encaissement n'est crédité
-- que si le nouveau solde qu'il annonce suit le dernier solde SÛR du float
-- (consultation USSD, relevé, SMS déjà vérifié). Un faux SMS — un faussaire
-- ne connaît pas le solde — est retenu, bloqué, ni rapproché ni remboursé.
-- Témoin : avant 0039, B créditait Alice de 25 000 XAFe sur un solde faux.
begin;
update parametres set valeur = valeur || '{"mode": "exiger", "demo": "eteinte"}' where cle = 'continuite';
update terminaux set vu_le = now() where id = 'akwa-1';
insert into floats (operateur, numero, terminal) values ('mtn', '677000081', 'akwa-1'), ('mtn', '670540054', 'akwa-1');
insert into terminaux (id, nom, cle, demo) values ('demo-81', 'Démo 81', 'cle-demo-81-assez-longue', true);
insert into floats (operateur, numero, terminal) values ('mtn', '600000081', 'demo-81');
create or replace function pg_temp.declarer(p_id text) returns text language plpgsql as $f$
declare ref text;
begin
  perform set_config('xafe.compte', '11111111-1111-1111-1111-111111111111', true);
  ref := ouvrir_depot('mtn') ->> 'reference';
  perform declarer_transaction(ref, p_id);
  return ref;
end $f$;
create or replace function pg_temp.recu(p_source bigint, p_montant numeric, p_id text, p_quand timestamptz, p_solde numeric,
                                        p_float text default '677000081', p_texte text default null, p_terminal text default 'akwa-1') returns jsonb language sql as $f$
  select totem_sms_recu(p_terminal, p_source, 'mtn', p_float, '677123456', p_montant, p_id,
                        coalesce(p_texte, format('Vous avez recu %s FCFA de ALICE NGONO (677123456). Ref: %s.', p_montant, p_id)
                                          || coalesce(format(' Nouveau solde: %s FCFA.', p_solde), '')),
                        p_quand, p_solde_apres => p_solde)
$f$;
do $$
declare
  a uuid := '11111111-1111-1111-1111-111111111111';
  nelson text := 'dddddddd-0000-0000-0000-000000000001'; support text := 'dddddddd-0000-0000-0000-000000000003';
  t0 timestamptz := now() - interval '3 hours';
  f int := (select id from floats where numero = '677000081');
  f2 int := (select id from floats where numero = '670540054');
  r jsonb; x0 numeric; idb bigint; idf bigint; idh bigint; idi bigint; idk bigint; ref text; p jsonb; n int;
begin
  x0 := coalesce(solde(a, 'XAFe', 'dispo'), 0);

  -- A · le solde d'appui : une consultation USSD, étiquetée par le boîtier
  r := totem_solde_float('akwa-1', 'mtn', '677000081', 500000, t0, 'ussd');
  assert r ->> 'resultat' = 'note' and (_solde_float(f)).solde = 500000, 'A · ' || r::text;

  -- B · LE TÉMOIN : un faux SMS, au solde inventé, suivi de la même déclaration
  ref := pg_temp.declarer('20395400001');
  r := pg_temp.recu(95401, 25000, '20395400001', t0 + interval '5 min', 1525000);
  assert r ->> 'resultat' = 'retenue' and r ->> 'continuite' = 'incoherente' and r ->> 'motif' = 'solde incohérent : à vérifier', 'B · retenu ' || r::text;
  idb := (r ->> 'id')::bigint;
  assert coalesce(solde(a, 'XAFe', 'dispo'), 0) = x0, 'B · rien de crédité';
  assert (select etat from depot_declarations where transaction_id = '20395400001') = 'attendu', 'B · la déclaration attend encore';
  assert (select bloquee and solde_attendu = 525000 from entrees_retenues where id = idb), 'B · bloquée, 525 000 attendu';
  assert (select not fiable from soldes_floats where retenue_id = idb) and (_solde_float(f)).solde = 500000, 'B · un faux solde n''est pas un appui';
  assert exists (select 1 from notifications where compte_id = a and titre = 'Paiement en vérification' and cible = '/historique/' || ref), 'B · Alice sait que son paiement est vérifié';
  perform set_config('xafe.compte', nelson, true);
  begin perform admin_rembourser_retenue(idb, 'rendre'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'solde à vérifier : libérez ou rejetez d''abord ce SMS', sqlerrm; end;
  begin perform admin_rapprocher_retenue(idb, ref); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'solde à vérifier : libérez ou rejetez d''abord ce SMS', sqlerrm; end;

  -- C · un vrai paiement : le solde suit, crédité, et il devient l'appui
  perform pg_temp.declarer('20395400002');
  r := pg_temp.recu(95402, 25000, '20395400002', t0 + interval '10 min', 525000);
  assert r ->> 'resultat' = 'credite' and r ->> 'continuite' = 'verifiee', 'C · ' || r::text;
  assert solde(a, 'XAFe', 'dispo') = x0 + 25000 and (_solde_float(f)).solde = 525000, 'C · crédité, nouvel appui';

  -- D · le désordre : le SMS de 04 arrive avant celui de 03 ; 03 le répare tout seul
  perform pg_temp.declarer('20395400003'); perform pg_temp.declarer('20395400004');
  r := pg_temp.recu(95404, 20000, '20395400004', t0 + interval '30 min', 555000);
  assert r ->> 'resultat' = 'retenue' and r ->> 'continuite' = 'incoherente', 'D · 04 trop tôt ' || r::text;
  assert (select solde_attendu from entrees_retenues where id = (r ->> 'id')::bigint) = 545000, 'D · 545 000 attendu';
  r := pg_temp.recu(95403, 10000, '20395400003', t0 + interval '20 min', 535000);
  assert r ->> 'resultat' = 'credite', 'D · 03 ' || r::text;
  assert (select etat = 'rapprochee' and continuite = 'verifiee' from entrees_retenues where transaction_id = '20395400004'), 'D · 04 repris par le réexamen';
  assert solde(a, 'XAFe', 'dispo') = x0 + 55000, 'D · les deux crédités';

  -- E · une sortie entre deux prolonge la chaîne ; avec ses frais aussi
  r := totem_sms_sortant('akwa-1', 95405, 'mtn', '677000081', '677999999', 100000, '30395400005', 'Transfert de 100000 FCFA reussi. ID: 30395400005', t0 + interval '40 min', p_solde_apres => 455000);
  assert r ->> 'continuite' = 'verifiee', 'E · ' || r::text;
  perform pg_temp.declarer('20395400005');
  r := pg_temp.recu(95406, 15000, '20395400005', t0 + interval '50 min', 470000);
  assert r ->> 'resultat' = 'credite', 'E · après la sortie ' || r::text;
  r := totem_sms_sortant('akwa-1', 95407, 'mtn', '677000081', '677999998', 50000, '30395400007', 'Transfert de 50000 FCFA reussi. Frais 500. ID: 30395400007', t0 + interval '52 min', p_solde_apres => 419500, p_frais => 500);
  assert r ->> 'continuite' = 'verifiee', 'E · avec frais ' || r::text;

  -- F · omettre le solde ne contourne pas la garde ; l'équipe libère, avec une note
  perform pg_temp.declarer('20395400006');
  r := pg_temp.recu(95408, 9000, '20395400006', t0 + interval '54 min', null);
  assert r ->> 'resultat' = 'retenue' and r ->> 'continuite' = 'absente' and r ->> 'motif' = 'solde non annoncé : à vérifier', 'F · ' || r::text;
  idf := (r ->> 'id')::bigint;
  perform set_config('xafe.compte', nelson, true);
  begin perform admin_liberer_retenue(idf, false, 'court'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'dites comment le paiement a été vérifié', sqlerrm; end;
  begin perform admin_liberer_retenue(idf, true, 'vu dans l''historique MoMo *126#'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'ce SMS n''annonce pas de solde', sqlerrm; end;
  r := admin_liberer_retenue(idf, false, 'vu dans l''historique MoMo *126#');
  assert (r ->> 'credite')::boolean and solde(a, 'XAFe', 'dispo') = x0 + 79000, 'F · libéré, crédité ' || r::text;
  assert exists (select 1 from journal_admin where action = 'liberer_retenue' and cible = idf::text and detail::text not like '%677123456%'), 'F · au journal, sans le numéro';

  -- G · le rejet : un faux reste faux, même si un appui l'« expliquerait » ensuite
  r := admin_rejeter_retenue(idb, 'absent de l''historique MoMo');
  assert (select etat = 'rejetee' and continuite = 'rejetee' from entrees_retenues where id = idb), 'G · rejeté';
  begin perform admin_liberer_retenue(idb, false, 'je change d''avis, finalement'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'ce SMS n''attend pas de vérification de solde', sqlerrm; end;
  perform totem_solde_float('akwa-1', 'mtn', '677000081', 1500000, t0 + interval '4 min', 'ussd');
  assert (select etat from entrees_retenues where id = idb) = 'rejetee' and coalesce(solde(a, 'XAFe', 'dispo'), 0) = x0 + 79000, 'G · jamais repris';

  -- H · l'empoisonnement : un solde lu dans un SMS seul ne sert jamais d'appui
  perform totem_solde_float('akwa-1', 'mtn', '677000081', 2000000, t0 + interval '55 min', 'sms');
  perform pg_temp.declarer('20395400008');
  r := pg_temp.recu(95409, 5000, '20395400008', t0 + interval '60 min', 2005000);
  assert r ->> 'resultat' = 'retenue' and r ->> 'continuite' = 'incoherente', 'H · ' || r::text;
  idh := (r ->> 'id')::bigint;
  assert (select solde_attendu from entrees_retenues where id = (r ->> 'id')::bigint) = 424500, 'H · attendu depuis le dernier appui SÛR';

  -- I · le premier solde d'un float : sans appui, retenu ; libéré et ancré, il devient l'appui
  assert _continuite((select x from floats x where id = f2), 1, 20000, 100000, null, null, t0 + interval '61 min') ->> 'etat' = 'sans_ancre', 'I · sans appui';
  perform pg_temp.declarer('20395400009');
  r := pg_temp.recu(95410, 20000, '20395400009', t0 + interval '61 min', 100000, '670540054');
  assert r ->> 'continuite' = 'sans_ancre' and r ->> 'motif' = 'premier solde du float inconnu : à vérifier', 'I · ' || r::text;
  idi := (r ->> 'id')::bigint;
  perform pg_temp.declarer('20395400010');
  r := pg_temp.recu(95411, 5000, '20395400010', t0 + interval '62 min', 105000, '670540054');
  assert r ->> 'resultat' = 'retenue', 'I · le suivant attend aussi ' || r::text;
  perform set_config('xafe.compte', nelson, true);
  r := admin_liberer_retenue(idi, true, 'solde vu sur la puce, *126# : 100 000');
  assert (r ->> 'credite')::boolean and (r ->> 'reexaminees')::int = 1, 'I · ancré, et le suivant se vérifie de lui-même ' || r::text;
  assert solde(a, 'XAFe', 'dispo') = x0 + 104000, 'I · les deux crédités';

  -- J · les modes : la démo est exemptée ; « surveiller » crédite et signale ; un réglage faux est refusé
  assert _continuite((select x from floats x where numero = '600000081'), 1, 5000, null, null, null, now()) ->> 'etat' = 'ignoree', 'J · démo';
  r := totem_sms_recu('demo-81', 95412, 'mtn', '600000081', '600000999', 5000, '20395400099', 'BANQUE DEMO', now());
  assert r ->> 'resultat' = 'retenue' and r ->> 'continuite' = 'ignoree' and not (select bloquee from entrees_retenues where id = (r ->> 'id')::bigint), 'J · démo, chemin d''avant ' || r::text;
  update parametres set valeur = valeur || '{"mode": "surveiller"}' where cle = 'continuite';
  perform pg_temp.declarer('20395400011');
  r := pg_temp.recu(95413, 5000, '20395400011', t0 + interval '70 min', 999);
  assert r ->> 'resultat' = 'credite' and r ->> 'continuite' = 'incoherente', 'J · surveiller ' || r::text;
  assert (select not fiable from soldes_floats where terminal = 'akwa-1' and source_id = 95413), 'J · signalé, pas un appui';
  update parametres set valeur = valeur || '{"mode": "exiger"}' where cle = 'continuite';
  begin perform _verifier_parametre('continuite', '{"mode": "oui", "demo": "eteinte"}'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paramètre invalide', sqlerrm; end;

  -- K · le message complet referme sa moitié tronquée
  perform pg_temp.declarer('20395400012');
  r := pg_temp.recu(95414, 7000, '20395400012', t0 + interval '75 min', null, '677000081', 'Vous avez recu 7000 FCFA de ALICE NGONO (677123456). Ref: 20395400012.');
  assert r ->> 'continuite' = 'absente', 'K · la moitié ' || r::text;
  idk := (r ->> 'id')::bigint;
  r := pg_temp.recu(95414, 7000, '20395400012', t0 + interval '75 min', 426500, '677000081', 'Vous avez recu 7000 FCFA de ALICE NGONO (677123456). Ref: 20395400012. Nouveau solde: 426500 FCFA.');
  assert r ->> 'resultat' = 'credite' and solde(a, 'XAFe', 'dispo') = x0 + 116000, 'K · le complet crédite ' || r::text;
  assert (select etat = 'rejetee' and motif = 'remplacé par le message complet' from entrees_retenues where id = idk), 'K · la moitié se referme';

  -- L · la page publique arrondit au million ; l'équipe garde l'exact
  perform set_config('xafe.compte', nelson, true);
  for n in select id from floats where actif loop
    perform admin_saisir_releve(n, 1234567.6, now(), 'releve/essai.pdf');
  end loop;
  perform rapprocher();
  p := preuve_de_reserve();
  assert (p -> 'releve' ->> 'floats')::numeric % 1000000 = 0 and (p -> 'releve' ->> 'couverture')::numeric % 1000000 = 0
     and (p -> 'releve' ->> 'floats_arrondi')::numeric = 1000000, 'L · arrondi ' || (p -> 'releve')::text;
  assert not exists (select 1 from jsonb_array_elements(p -> 'releve' -> 'floats_detail') d where (d ->> 'solde')::numeric % 1000000 <> 0), 'L · chaque opérateur arrondi';
  assert p::text not like '%1234567%', 'L · rien d''exact ne fuit';
  assert (admin_parite() -> 'releve' ->> 'floats')::numeric % 1000000 <> 0, 'L · l''équipe garde l''exact';

  -- M · les droits
  assert not has_function_privilege('authenticated', 'totem_sms_recu(text,bigint,text,text,text,numeric,text,text,timestamptz,numeric,numeric,numeric)', 'execute')
     and not has_function_privilege('anon', 'totem_sms_recu(text,bigint,text,text,text,numeric,text,text,timestamptz,numeric,numeric,numeric)', 'execute')
     and not has_function_privilege('authenticated', 'totem_sms_sortant(text,bigint,text,text,text,numeric,text,text,timestamptz,numeric,numeric,numeric)', 'execute')
     and not has_function_privilege('authenticated', '_continuite(floats,int,numeric,numeric,numeric,numeric,timestamptz,bigint)', 'execute')
     and not has_function_privilege('authenticated', '_reexaminer_continuite(int,timestamptz)', 'execute')
     and not has_function_privilege('authenticated', '_reprendre_retenue(bigint,text)', 'execute'), 'M · les fonctions de service restent fermées';
  perform set_config('xafe.compte', support, true);
  begin perform admin_liberer_retenue(idh, false, 'le support essaie de libérer'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'accès non autorisé', sqlerrm; end;
  begin perform admin_rejeter_retenue(idk, 'le support essaie'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'accès non autorisé', sqlerrm; end;
  assert total('XAFe') = circulation(), format('XAFe : %s en soldes, %s en circulation', total('XAFe'), circulation());
  raise notice '✓ 11.81 la continuité des soldes : un SMS dont le solde ne suit pas le dernier solde sûr est retenu, bloqué, ni rapproché ni remboursé ; le désordre se répare seul ; les sorties prolongent la chaîne ; omettre le solde ne passe pas ; un solde lu dans un SMS seul n''est jamais un appui ; l''équipe libère avec une note ou rejette ; la page publique arrondit';
end $$;
rollback;

-- 11.82 · la réserve se montre à l'adresse du CONTRAT (0040) : le contrat XAFe
-- tient lui-même la réserve. Témoin : avant 0040, la trace et la page
-- publique disaient l'adresse du wallet chaud publiée par le veilleur.
begin;
update parametres set valeur = valeur || jsonb_build_object('reserve', 'bep20',
  'bep20', case when jsonb_typeof(valeur -> 'bep20') = 'object' then valeur -> 'bep20' else '{}'::jsonb end || '{"xafe": "0xCONTRAT"}') where cle = 'chaine';
insert into chaine_etats (reseau, etat) values ('bep20', '{"chaud": "0xchaud", "plafond_jour": 1000000000, "en_pause": false}')
on conflict (reseau) do update set etat = excluded.etat;
do $$
begin
  insert into emissions (sens, montant, source_table, source_id) values ('emission', 2500, 'depots', 'XAFe-DP-990082');
  assert _trace_chaine('depots', 'XAFe-DP-990082') -> 0 ->> 'reserve' = '0xCONTRAT', 'la trace d''un dépôt montre le contrat ' || _trace_chaine('depots', 'XAFe-DP-990082')::text;
  assert exists (select 1 from jsonb_array_elements(_parite_json(false) -> 'contrats') c where c ->> 'reseau' = 'bep20' and c ->> 'reserve' = '0xCONTRAT'
                                                                                          and c ->> 'plafond_jour' = '1000000000' and c ->> 'en_pause' = 'false'),
         'la page publique montre la réserve au contrat, le plafond du jour et la pause ' || (_parite_json(false) -> 'contrats')::text;
  assert (_parite_json(false))::text not like '%0xchaud%', 'le wallet chaud n''est plus montré comme réserve';
  raise notice '✓ 11.82 la réserve se montre à l''adresse du contrat, avec le plafond de frappe du jour et la pause — plus jamais le wallet chaud';
end $$;
rollback;

-- 11.83 · un réseau qui change de contrat (la bêta) : les retraits faits sur
-- l'ancien ne sont plus attendus sur le nouveau ; la réserve, rejouée, l'est.
begin;
do $$
declare a uuid := '11111111-1111-1111-1111-111111111111';
begin
  insert into retraits_crypto (reference, compte_id, actif, reseau, adresse, montant, etat, tx_hash, cree_le)
  values ('XAFe-CR-990083', a, 'XAFe', 'bep20', '0x' || repeat('83', 20), 150, 'envoye', '0xancien83', now() - interval '1 day');
  insert into emissions (sens, montant, source_table, source_id) values ('emission', 700, 'depots', 'XAFe-DP-990083');
  assert exists (select 1 from _parite_lignes() where reference = 'XAFe-CR-990083' and nature = 'retrait'), 'sans depuis_le : attendu (rien ne change en production)';
  update parametres set valeur = valeur || jsonb_build_object('bep20',
    case when jsonb_typeof(valeur -> 'bep20') = 'object' then valeur -> 'bep20' else '{}'::jsonb end || jsonb_build_object('depuis_le', now())) where cle = 'chaine';
  assert not exists (select 1 from _parite_lignes() where reference = 'XAFe-CR-990083'), 'fait sur l''ancien contrat : plus attendu sur le nouveau';
  assert exists (select 1 from _parite_lignes() where reference = 'XAFe-DP-990083' and nature = 'reserve'), 'la réserve, elle, reste attendue (rejouée sur le nouveau contrat)';
  raise notice '✓ 11.83 un contrat remplacé (chaine.<réseau>.depuis_le) : ce qui s''est fait sur l''ancien n''est plus attendu sur le nouveau, la réserve l''est toujours';
end $$;
rollback;

-- 11.84 · le profil de production : l'argent de test n'existe pas (0041).
-- La bêta est allumée AVANT le profil (comme sur une base d'hier) : la garde
-- doit tenir là où _doter, lui, laisserait passer. Témoin : sans 0041, la
-- table du profil n'existe pas et _doter dote.
begin;
update parametres set valeur = '{"actif": true, "message": "bêta", "dotation": {"XAFe": 1000000, "USDT": 2000}, "depots_reels": false}' where cle = 'beta';
insert into profil_de_la_base (nom) values ('production');
do $$
declare a uuid := '11111111-1111-1111-1111-111111111111'; n int; v_detail text;
begin
  begin perform _doter(a, 1000, 0, 'essai', null); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm like 'argent de test refusé%', 'une dotation sur la production : ' || sqlerrm; end;
  begin insert into comptes (id, telephone, nom, palier) values ('b1840000-0000-0000-0000-000000000001', '670184001', 'Inscrit', 2); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm like 'argent de test refusé%', 'la dotation d''inscription aussi : ' || sqlerrm; end;
  -- éteindre la bêta : permis ; la rallumer : jamais
  update parametres set valeur = valeur || '{"actif": false, "dotation": {"XAFe": 0, "USDT": 0}}' where cle = 'beta';
  begin update parametres set valeur = valeur || '{"actif": true}' where cle = 'beta'; raise exception 'aurait dû refuser';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    assert sqlerrm like 'argent de test refusé%' and v_detail like '%la bêta ne s''allume pas%', sqlerrm || ' / ' || v_detail; end;
  begin update parametres set valeur = valeur || '{"dotation": {"XAFe": 5, "USDT": 0}}' where cle = 'beta'; raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm like 'argent de test refusé%', sqlerrm; end;
  begin update parametres set valeur = valeur || '{"actif": true}' where cle = 'robots'; raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm like 'argent de test refusé%', sqlerrm; end;
  begin update parametres set valeur = '{"essai": true}' where cle = 'chaine'; raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm like 'argent de test refusé%', sqlerrm; end;
  begin update parametres set valeur = '{"bep20": null}' where cle = 'chaine'; raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm like 'argent de test refusé%', 'chaine sans « essai » : refusée aussi'; end;
  update parametres set valeur = '{"essai": false, "bep20": null, "trc20": null}' where cle = 'chaine';
  begin update parametres set valeur = '{"reveil": "https://x"}' where cle = 'demo_totem'; raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm like 'argent de test refusé%', sqlerrm; end;
  -- pas de terminal de démo, ni par son nom ni par l'interrupteur
  begin insert into terminaux (id, nom) values ('totem-demo', 'x'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm like 'terminal de démo refusé%', sqlerrm; end;
  begin update terminaux set demo = true where id = 'akwa-1'; raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm like 'terminal de démo refusé%', sqlerrm; end;
  -- un robot rejoué par 0023 est ignoré, sans casser le passage ; un client ne devient pas robot
  insert into comptes (id, nom, palier, genre) values (gen_random_uuid(), 'r', 2, 'robot');
  get diagnostics n = row_count;
  assert n = 0, 'un compte robot ne s''écrit pas sur la production';
  begin update comptes set genre = 'test' where id = a; raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm like 'argent de test refusé%', sqlerrm; end;
  -- une migration rejouée (« on conflict do nothing ») passe, et ne change rien
  insert into parametres (cle, valeur) values ('beta', '{"actif": true}') on conflict (cle) do nothing;
  assert not (parametre('beta') ->> 'actif')::boolean, 'la bêta reste éteinte';
  -- le profil ne se change pas
  begin update profil_de_la_base set pose_par = 'x'; raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'le profil de la base ne se change pas', sqlerrm; end;
  begin delete from profil_de_la_base; raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'le profil de la base ne se change pas', sqlerrm; end;
  raise notice '✓ 11.84 sur la production, aucune dotation, ni bêta, ni robot, ni réseau d''essai, ni démo — même en SQL, même rejoué';
end $$;
rollback;

-- 11.85 · hors production, 0041 ne change rien. Témoin : un 0041 qui
-- s'installerait sans annonce échouerait ici.
begin;
update parametres set valeur = '{"actif": true, "message": "bêta", "dotation": {"XAFe": 1000000, "USDT": 2000}, "depots_reels": false}' where cle = 'beta';
do $$
declare c uuid := 'b1850000-0000-0000-0000-000000000001';
begin
  assert not exists (select 1 from profil_de_la_base), 'aucun profil posé';
  assert (select count(*) from comptes where genre = 'robot' and id::text like 'b0b00000-%') = 15, 'les quinze robots de 0023 sont là';
  assert (select count(*) from pg_trigger where tgname in ('comptes_dotation_beta', 'depots_pendant_la_beta', 'sorties_reveiller_totem_demo')) = 3,
         'les déclencheurs de la bêta et de la démo sont là';
  insert into comptes (id, telephone, nom, palier) values (c, '670185001', 'Testeur', 2);
  assert solde(c, 'XAFe', 'dispo') = 1000000, 'la bêta dote toujours';
  insert into terminaux (id, nom) values ('totem-demo-1185', 'x');
  update terminaux set demo = true where id = 'totem-demo-1185';
  raise notice '✓ 11.85 hors production, 0041 est inerte : robots, dotation, démo, tout est là';
end $$;
rollback;

-- 11.86 · une base qui a vécu ne devient jamais la production, même annoncée.
-- Témoin : sans le regard sur ce que la base a vécu, l'installation passe.
begin;
do $$
declare v_detail text;
begin
  perform set_config('glisil.profil', 'production', true);
  begin perform _installer_le_profil_production(); raise exception 'aurait dû refuser';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    assert sqlerrm = 'cette base a déjà vécu : elle ne devient pas la production', sqlerrm;
    assert v_detail like '%comptes (clients)%' and v_detail like '%ecritures%', v_detail;
  end;
  assert not exists (select 1 from profil_de_la_base), 'rien n''est posé';
  assert not _en_production();
  raise notice '✓ 11.86 une base qui a déjà vécu ne devient pas la production (%)', left(v_detail, 60);
end $$;
rollback;

-- 11.87 · le constat refuse ce qu'il doit refuser. Témoin : un constat qui ne
-- regarderait que beta.actif passerait.
begin;
insert into profil_de_la_base (nom) values ('production');
do $$
declare v_detail text; v_res jsonb;
begin
  begin perform verifier_le_profil_production(); raise exception 'aurait dû refuser';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    assert sqlerrm = 'le profil de production ne tient pas', sqlerrm;
    assert v_detail like '%robot%' and v_detail like '%comptes_dotation_beta%' and v_detail like '%chaine.essai%', v_detail;
  end;
  perform _tenir_le_profil_production();
  begin perform verifier_le_profil_production(); raise exception 'aurait dû refuser';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    assert v_detail not like '%comptes_dotation_beta%' and v_detail not like '%depots_pendant_la_beta%', 'tenu : les déclencheurs de bêta sont partis ' || v_detail;
    -- un robot qui a joué ne s'efface pas : le constat le dit, il ne l'oublie pas
    assert not exists (select 1 from robots r where not exists (select 1 from ecritures e where e.compte_id = r.compte_id)), 'les robots sans activité sont partis';
    assert (not exists (select 1 from robots)) or v_detail like '%un robot a de l''activité%', v_detail;
  end;
  -- un secret d'essai au coffre est refusé
  if to_regclass('vault.secrets') is null then
    create schema if not exists vault;
    create table vault.secrets (name text);
  end if;
  -- le vrai coffre de Supabase ne s'écrit que par vault.create_secret (la table chiffre elle-même) ; l'imitation, à la main
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'vault' and p.proname = 'create_secret') then
    perform vault.create_secret('essai', 'essai_graine', 'secret d''essai du scénario 11.87');
  else
    insert into vault.secrets (name) values ('essai_graine');
  end if;
  v_res := _constats_du_profil(false);
  assert v_res -> 'refus' @> to_jsonb('un secret d''essai est au coffre (essai_graine ou essai_admin_cle)'::text), v_res -> 'refus';
  raise notice '✓ 11.87 le constat refuse robots, déclencheurs de bêta, réseau d''essai et secrets d''essai ; tenu, il ne garde que ce qui a vécu';
end $$;
rollback;

-- 11.88 · cent déclarations par compte et par jour (0042, décision du 29/10). Témoin : le
-- code d'avant (0034) refusait dès la trente et unième.
begin;
set local xafe.compte = '11111111-1111-1111-1111-111111111111';
do $$
declare v_ref text := ouvrir_depot('mtn', 'k-11.88') ->> 'reference'; v_d uuid; i int;
begin
  select id into v_d from depots where reference = v_ref;
  -- 99 déclarations déjà faites aujourd'hui (refusées : aucune n'est « en attente »)
  -- celles d'Alice dans les scénarios d'avant : d'hier, et plus en attente
  update depot_declarations set declare_le = now() - interval '2 days',
         etat = case when etat = 'attendu' then 'refuse' else etat end
   where compte_id = '11111111-1111-1111-1111-111111111111';
  for i in 1..99 loop
    insert into depot_declarations (depot_id, compte_id, operateur, transaction_id, etat)
    values (v_d, '11111111-1111-1111-1111-111111111111', 'mtn', 'TX11880000' || lpad(i::text, 3, '0'), 'refuse');
  end loop;
  perform declarer_transaction(v_ref, 'TX11889999100');
  assert exists (select 1 from depot_declarations where transaction_id = normaliser_transaction_id('TX11889999100')), 'la centième passe';
  begin perform declarer_transaction(v_ref, 'TX11889999101'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'trop de transaction ID aujourd''hui', sqlerrm; end;
  -- le nombre se règle
  update parametres set valeur = valeur || '{"declarations_jour": 150}' where cle = 'depot';
  perform declarer_transaction(v_ref, 'TX11889999102');
  raise notice '✓ 11.88 cent déclarations par jour passent, la cent et unième attend (réglable : depot.declarations_jour)';
end $$;
rollback;

-- 11.89 · deux carnets (0045) : un ordre d'USDC/XAFe ne rencontre jamais un
-- ordre d'USDT/XAFe ; chaque paire a son carnet, sa cotation, ses bougies, son
-- achat rapide, ses règles. Témoin : l'appariement d'avant (sans « paire = »)
-- servirait l'acheteur d'USDT avec les USDC de la vente posée ici.
begin;
do $$
declare a uuid := '11111111-1111-1111-1111-111111111111'; b uuid := '22222222-2222-2222-2222-222222222222';
        r jsonb; v_vente uuid; xa numeric; xb numeric; m jsonb; d jsonb;
begin
  perform crediter_crypto(b, 'USDC', 'bep20', 500, '0xusdc-11.89-b', '0x00000000000000000000000000000000000000b0');
  assert solde(b, 'USDC', 'dispo') = 500 and total('USDC') = 500, 'cinq cents USDC arrivés';
  -- Bob vend 100 USDC à 600 sur le carnet USDC
  perform set_config('xafe.compte', b::text, true);
  r := placer_ordre('vente', 'limite', 100, 600.00, 'k-11.89-v', 'USDC/XAFe');
  v_vente := (r -> 'ordre' ->> 'id')::uuid;
  assert r -> 'ordre' ->> 'paire' = 'USDC/XAFe' and solde(b, 'USDC', 'bloque') = 100 and solde(b, 'USDT', 'bloque') >= 0, r;
  -- Alice achète de l'USDT à 650, au marché : la vente d'USDC à 600 n'est pas dans SON carnet
  perform set_config('xafe.compte', a::text, true);
  r := placer_ordre('achat', 'limite', 10, 650.00, 'k-11.89-a0');
  assert (select restant from ordres where id = v_vente) = 100, 'la vente d''USDC n''a pas servi un achat d''USDT';
  assert coalesce(solde(a, 'USDC', 'dispo'), 0) = 0, 'aucun USDC chez Alice';
  if r -> 'ordre' ->> 'etat' in ('ouvert', 'partiel') then perform annuler_ordre((r -> 'ordre' ->> 'id')::uuid); end if;
  assert not exists (select 1 from executions where paire = 'USDC/XAFe'), 'rien ne s''est échangé en USDC';
  -- les lectures d'une paire ne montrent que la sienne
  assert jsonb_array_length(carnet(20, 'USDC/XAFe') -> 'ventes') = 1 and (carnet(20, 'USDC/XAFe') -> 'ventes' -> 0 ->> 'quantite')::numeric = 100,
         carnet(20, 'USDC/XAFe');
  assert not exists (select 1 from jsonb_array_elements(carnet(50) -> 'ventes') x where (x ->> 'quantite')::numeric = 100 and (x ->> 'prix')::numeric = 600),
         'le carnet USDT ne montre pas la vente d''USDC';
  -- Alice achète 40 USDC à 600 : elle paie 24 000 XAFe, reçoit 40 moins 0,1 % ; Bob reçoit 24 000 moins 0,05 %
  xa := solde(a, 'XAFe', 'dispo'); xb := solde(b, 'XAFe', 'dispo');
  r := placer_ordre('achat', 'limite', 40, 600.00, 'k-11.89-a1', 'USDC/XAFe');
  assert r -> 'ordre' ->> 'etat' = 'execute' and jsonb_array_length(r -> 'executions') = 1 and r -> 'executions' -> 0 ->> 'paire' = 'USDC/XAFe', r;
  assert solde(a, 'XAFe', 'dispo') = xa - 24000 and solde(a, 'USDC', 'dispo') = 39.96, format('Alice : %s XAFe, %s USDC', solde(a, 'XAFe', 'dispo') - xa, solde(a, 'USDC', 'dispo'));
  assert solde(b, 'XAFe', 'dispo') = xb + 23988 and solde(b, 'USDC', 'bloque') = 60, format('Bob : %s XAFe, %s USDC bloqués', solde(b, 'XAFe', 'dispo') - xb, solde(b, 'USDC', 'bloque'));
  assert solde(compte_maison(), 'USDC', 'dispo') = 0.04, 'les frais de l''acheteur, en USDC, vont à la maison';
  assert total('USDC') = 500, 'un échange ne crée ni ne détruit d''USDC';
  -- la cotation, les échanges récents, les bougies : par paire
  assert cotation('USDC/XAFe') ->> 'paire' = 'USDC/XAFe' and cotation('USDC/XAFe') ->> 'base' = 'USDC'
         and (cotation('USDC/XAFe') ->> 'dernier')::numeric = 600 and (cotation('USDC/XAFe') ->> 'volume_base')::numeric = 40, cotation('USDC/XAFe');
  assert cotation() ->> 'paire' = 'USDT/XAFe'
         and (cotation() ->> 'dernier')::numeric is not distinct from (select prix from executions where paire = 'USDT/XAFe' order by cree_le desc, id desc limit 1)
         and (cotation() ->> 'volume_base')::numeric = (select coalesce(sum(quantite), 0) from executions where paire = 'USDT/XAFe' and cree_le > now() - interval '24 hours'),
         'la cotation USDT ne lit pas l''USDC';
  assert jsonb_array_length(transactions_recentes(50, 'USDC/XAFe')) = 1, transactions_recentes(50, 'USDC/XAFe');
  assert (select (x ->> 'v')::numeric from jsonb_array_elements(bougies('1m', null, 300, 'USDC/XAFe') -> 'bougies') x where x ->> 'source' = 'marche') = 40,
         bougies('1m', null, 300, 'USDC/XAFe');
  assert jsonb_array_length(chandelles(60, 28, 'USDC/XAFe')) = 1;
  -- l'achat rapide sur le carnet USDC : le devis porte sa paire, et se rejoue sur SON carnet
  d := devis_rapide('achat', 12000, true, 'USDC/XAFe');
  assert d ->> 'paire' = 'USDC/XAFe' and (d ->> 'quantite')::numeric between 19 and 20, d;
  r := executer_devis((d ->> 'id')::uuid);
  assert r ->> 'etat' = 'execute' and solde(a, 'USDC', 'dispo') = 39.96 + (d ->> 'quantite')::numeric, r;
  -- l'annulation libère des USDC, pas des USDT
  perform set_config('xafe.compte', b::text, true);
  r := annuler_ordre(v_vente);
  assert r ->> 'etat' = 'annule' and solde(b, 'USDC', 'bloque') = 0 and solde(b, 'USDC', 'dispo') = 500 - 40 - (d ->> 'quantite')::numeric, r;
  assert total('USDC') = 500 and total('XAFe') = circulation(), 'rien de créé';
  -- une paire qui n'existe pas
  begin perform placer_ordre('achat', 'limite', 10, 600.00, null, 'BTC/XAFe'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paire inconnue', sqlerrm; end;
  begin perform carnet(20, 'XAFe/USDT'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paire inconnue', sqlerrm; end;
  -- les règles d'une paire : « marche.paires » change ce qu'il nomme, le reste vient de « marche »
  m := parametre('marche');
  perform _verifier_parametre('marche', m || '{"paires": {"USDC/XAFe": {"ouvert": false, "quantite_min": 1}}}');
  begin perform _verifier_parametre('marche', m || '{"paires": {"BTC/XAFe": {"ouvert": false}}}'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paramètre invalide', sqlerrm; end;
  begin perform _verifier_parametre('marche', m || '{"paires": {"USDC/XAFe": {"pas": 1}}}'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paramètre invalide', sqlerrm; end;
  begin perform _verifier_parametre('marche', m || '{"paires": {"USDC/XAFe": {"bande_execution": 2}}}'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paramètre invalide', sqlerrm; end;
  update parametres set valeur = m || '{"paires": {"USDC/XAFe": {"ouvert": false, "quantite_min": 1}}}' where cle = 'marche';
  assert not (_marche('USDC/XAFe') ->> 'ouvert')::boolean and (_marche('USDC/XAFe') ->> 'quantite_min')::numeric = 1, _marche('USDC/XAFe');
  assert (_marche() ->> 'ouvert')::boolean and (_marche() ->> 'quantite_min')::numeric = (m ->> 'quantite_min')::numeric and _marche() ->> 'paire' = 'USDT/XAFe', _marche();
  assert not (_marche() ? 'paires'), 'les règles d''une paire ne fuient pas dans une autre';
  begin perform placer_ordre('vente', 'limite', 10, 600.00, null, 'USDC/XAFe'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'marché fermé', sqlerrm; end;
  -- l'écran reçoit les deux paires, chacune avec ses règles et sa référence
  r := parametres_publics();
  assert r -> 'paires' = '["USDT/XAFe", "USDC/XAFe"]'::jsonb and r -> 'marches' ? 'USDC/XAFe'
         and not (r -> 'marches' -> 'USDC/XAFe' ->> 'ouvert')::boolean and (r -> 'marches' -> 'USDT/XAFe' ->> 'ouvert')::boolean, r -> 'marches';
  assert r -> 'marche' ->> 'paire' = 'USDT/XAFe', 'l''écran d''hier lit toujours sa paire';
  raise notice '✓ 11.89 deux carnets : USDC/XAFe et USDT/XAFe ne se rencontrent jamais ; carnet, cotation, bougies, achat rapide et règles par paire';
end $$;
rollback;

-- 11.90 · l'USDC passe par BNB Chain et Ethereum, jamais par Tron (0045).
-- Témoin : sans « reseaux.actifs », une adresse d'USDC se donnerait sur Tron
-- et un envoi d'USDC n'y arriverait nulle part.
begin;
set local xafe.compte = '22222222-2222-2222-2222-222222222222';
do $$
declare b uuid := '22222222-2222-2222-2222-222222222222'; r jsonb; v_pub jsonb;
begin
  assert _actif_sur_reseau('USDC', 'bep20') and _actif_sur_reseau('USDC', 'erc20') and not _actif_sur_reseau('USDC', 'trc20');
  assert _actif_sur_reseau('USDT', 'trc20') and _actif_sur_reseau('XAFe', 'trc20') and not _actif_sur_reseau('BTC', 'bep20');
  -- les adresses : une réserve par actif, jamais d'USDC sur Tron
  assert chaine_ajouter_adresses('USDC', 'bep20', '[{"adresse": "0xc0c0000000000000000000000000000000000001", "indice": 901}]') = 1;
  begin perform chaine_ajouter_adresses('USDC', 'trc20', '[{"adresse": "TUsdcSurTron000000000000000000001", "indice": 902}]'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'actif absent de ce réseau', sqlerrm; end;
  insert into adresses_libres (actif, reseau, adresse, indice) values ('USDC', 'trc20', 'TUsdcGlisseeALaMain00000000000001', 903);
  assert adresse_depot('USDC', 'trc20') is null, 'une adresse glissée à la main ne se montre pas';
  assert adresse_depot('USDC', 'bep20') = '0xc0c0000000000000000000000000000000000001';
  assert adresse_depot('USDC', 'bep20') = '0xc0c0000000000000000000000000000000000001', 'la même à chaque fois';
  assert adresse_depot('USDT', 'bep20') <> '0xc0c0000000000000000000000000000000000001', 'l''USDT garde la sienne';
  assert (chaine_adresses('bep20') -> 'libres') ? 'USDC' and not ((chaine_adresses('trc20') -> 'libres') ? 'USDC'), chaine_adresses('trc20') -> 'libres';
  -- un dépôt d'USDC sur Tron ne crédite personne
  begin perform crediter_crypto(b, 'USDC', 'trc20', 10, 'tx-usdc-tron', 'TUsdcGlisseeALaMain00000000000001'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'actif absent de ce réseau', sqlerrm; end;
  perform crediter_crypto(b, 'USDC', 'bep20', 100, '0xusdc-11.90', '0xc0c0000000000000000000000000000000000001');
  assert solde(b, 'USDC', 'dispo') = 100;
  -- les retraits : l'actif sur SON réseau, au centime, avec ses frais
  begin perform _demander_retrait_crypto('USDC', 'trc20', 'TXYZ', 10, null); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'actif absent de ce réseau', sqlerrm; end;
  begin perform _demander_retrait_crypto('BTC', 'bep20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 10, null); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'actif inconnu', sqlerrm; end;
  begin perform _demander_retrait_crypto('USDC', 'bep20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 10.005, null); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'montant invalide', sqlerrm; end;
  assert (parametre('crypto') -> 'frais' ->> 'USDC')::numeric = (parametre('crypto') -> 'frais' ->> 'USDT')::numeric, 'l''USDC a les frais de l''USDT';
  r := _demander_retrait_crypto('USDC', 'bep20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 10.5, 'k-11.90');
  assert r ->> 'actif' = 'USDC' and (r ->> 'frais')::numeric = (parametre('crypto') -> 'frais' ->> 'USDC')::numeric
         and solde(b, 'USDC', 'bloque') = 10.5 + (r ->> 'frais')::numeric, r;
  assert exists (select 1 from jsonb_array_elements(chaine_retraits_a_envoyer('bep20')) x where x ->> 'reference' = r ->> 'reference' and x ->> 'actif' = 'USDC'),
         'le veilleur de BNB Chain reçoit le retrait d''USDC à envoyer';
  -- les frais d'un réseau : Ethereum peut coûter plus que BNB Chain
  begin perform _verifier_parametre('crypto', parametre('crypto') || '{"frais_reseaux": {"trc20": {"USDC": 1}}}'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paramètre invalide', sqlerrm; end;
  begin perform _verifier_parametre('crypto', parametre('crypto') || '{"frais_reseaux": {"erc20": {"USDC": 5000}}}'); raise exception 'aurait dû refuser';
  exception when others then assert sqlerrm = 'paramètre invalide', sqlerrm; end;
  perform _verifier_parametre('crypto', parametre('crypto') || '{"frais_reseaux": {"erc20": {"USDC": 4, "USDT": 4, "XAFe": 2500}}}');
  update parametres set valeur = valeur || '{"frais_reseaux": {"erc20": {"USDC": 4}}}' where cle = 'crypto';
  assert _frais_retrait('USDC', 'erc20') = 4 and _frais_retrait('USDC', 'bep20') = (parametre('crypto') -> 'frais' ->> 'USDC')::numeric
         and _frais_retrait('USDT', 'erc20') = (parametre('crypto') -> 'frais' ->> 'USDT')::numeric;
  -- l'écran sait ce que chaque réseau porte, avec ses frais
  v_pub := (select x from jsonb_array_elements(parametres_publics() -> 'crypto' -> 'reseaux') x where x ->> 'id' = 'trc20');
  assert v_pub -> 'actifs' = '["XAFe", "USDT"]'::jsonb and not (v_pub -> 'frais' ? 'USDC'), v_pub;
  v_pub := (select x from jsonb_array_elements(parametres_publics() -> 'crypto' -> 'reseaux') x where x ->> 'id' = 'bep20');
  assert v_pub -> 'actifs' = '["XAFe", "USDT", "USDC"]'::jsonb and v_pub -> 'contrats' ? 'USDC', v_pub;
  assert (select count(*) from jsonb_array_elements(parametres_publics() -> 'actifs')) = 3;
  -- la liste des actifs tient les tables : un actif inconnu n'a pas de solde
  begin insert into soldes (compte_id, actif) values (b, 'BTC'); raise exception 'aurait dû refuser';
  exception when foreign_key_violation then null; end;
  raise notice '✓ 11.90 l''USDC passe par BNB Chain et Ethereum, jamais par Tron : adresse, dépôt, retrait et frais par réseau';
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
  assert jsonb_array_length(r -> 'operateurs') = 2
         and r -> 'operateurs' -> 0 -> 'plafond_par_transfert' = to_jsonb((select plafond_par_transfert from operateurs where id = 'mtn')), r;
  assert not (r ? 'code_secret') and not (r ? 'depot'), 'rien d''autre que ce que l''écran montre';
  -- le bandeau de la bêta, dans les deux langues (0033)
  assert r -> 'beta' ->> 'message_en' = parametre('beta') ->> 'message_en' and length(r -> 'beta' ->> 'message_en') > 20, r -> 'beta';
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
