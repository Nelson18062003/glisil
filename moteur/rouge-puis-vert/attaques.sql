-- LES ATTAQUES DE LA REVUE, REJOUÉES TELLES QUELLES.
--
-- Ce fichier tourne SANS CHANGEMENT sur le code d'avant les corrections
-- (6d453d3) et sur celui d'aujourd'hui : il n'appelle que des fonctions
-- présentes dans les deux. Chaque attaque note si le DÉFAUT se produit.
-- Sur le code d'avant, chacune doit le produire (sinon elle ne prouve pas
-- que le défaut existait) ; aujourd'hui, aucune. Le banc
-- (rouge-puis-vert.sh) compare les deux colonnes.

\set ON_ERROR_STOP on
\set QUIET on

create table _attaques (n text primary key, constat text not null, defaut boolean, detail text);

create function _qui(p uuid) returns void language sql as $$ select set_config('xafe.compte', p::text, true) $$;

do $$
begin
  insert into terminaux (id, nom, vu_le) values ('akwa-1', 'Akwa 1', now());
  insert into floats (operateur, numero, terminal) values ('mtn', '677000000', 'akwa-1'), ('om', '699000000', 'akwa-1');
  insert into comptes (id, telephone, nom, palier) values
    ('a0000000-0000-0000-0000-000000000001', '677100001', 'Alice', 1),
    ('a0000000-0000-0000-0000-000000000002', '677100002', 'Mallory', 1),
    ('a0000000-0000-0000-0000-000000000003', '677100003', 'Bob', 0),
    ('a0000000-0000-0000-0000-000000000004', '677100004', 'Chantal', 2);
  insert into numeros (compte_id, operateur, numero, verifie_le, actif_des) values
    ('a0000000-0000-0000-0000-000000000001', 'mtn', '677100001', now() - interval '2 days', now() - interval '1 day'),
    ('a0000000-0000-0000-0000-000000000002', 'mtn', '677100002', now() - interval '2 days', now() - interval '1 day'),
    ('a0000000-0000-0000-0000-000000000003', 'mtn', '677100003', now() - interval '2 days', now() - interval '1 day'),
    ('a0000000-0000-0000-0000-000000000004', 'mtn', '677100004', now() - interval '2 days', now() - interval '1 day');
  insert into administrateurs (id, email, nom, role) values ('a0000000-0000-0000-0000-0000000000ad', 'a@x', 'Admin', 'super_admin');
end $$;

-- #10 · pgcrypto vit dans « extensions » : un code secret se choisit-il seulement ?
do $$
declare d text;
begin
  insert into comptes (id, telephone, nom) values ('a0000000-0000-0000-0000-000000000010', '677100010', 'Dix');
  perform _qui('a0000000-0000-0000-0000-000000000010');
  begin perform completer_profil('Dix', '1010'); d := null; exception when others then d := sqlerrm; end;
  insert into _attaques values ('#10', 'aucun code secret ne se choisit (crypt introuvable hors de public)', d is not null, d);
end $$;

-- Pour que le code d'avant ATTEIGNE ses autres défauts, une cale : crypt, gen_salt et
-- gen_random_bytes appelables depuis public. Sans effet sur le code d'aujourd'hui, qui les qualifie.
do $$
begin
  if to_regprocedure('public.crypt(text,text)') is null then
    create function public.crypt(text, text) returns text language sql as 'select extensions.crypt($1, $2)';
    create function public.gen_salt(text, integer) returns text language sql as 'select extensions.gen_salt($1, $2)';
    create function public.gen_random_bytes(integer) returns bytea language sql as 'select extensions.gen_random_bytes($1)';
  end if;
end $$;

-- #1 · Mallory tape d'avance un ID ; Alice paie depuis SON numéro vérifié.
do $$
declare r jsonb;
begin
  perform _qui('a0000000-0000-0000-0000-000000000002');
  perform declarer_transaction(ouvrir_depot('mtn') ->> 'reference', '20390000001');
  r := totem_sms_recu('akwa-1', 1, 'mtn', '677000000', '677100001', 300000, '20390000001', '…', now());
  insert into _attaques values ('#1', 'un ID tapé d''avance prend le paiement d''un autre',
    coalesce((select disponible from soldes where compte_id = 'a0000000-0000-0000-0000-000000000002' and actif = 'XAFe'), 0) > 0, r::text);
end $$;

-- #14 · un achat limite au repos dont le bloqué arrondi bouche le carnet.
do $$
declare d text;
begin
  perform crediter_crypto('a0000000-0000-0000-0000-000000000004', 'USDT', 'bep20', 1000, '0xr1', 'x');
  perform _qui('a0000000-0000-0000-0000-000000000001');
  perform declarer_transaction(ouvrir_depot('mtn') ->> 'reference', '20390000014');
  perform totem_sms_recu('akwa-1', 14, 'mtn', '677000000', '677100001', 1000000, '20390000014', '…', now());
  perform _qui('a0000000-0000-0000-0000-000000000001');
  perform placer_ordre('achat', 'limite', 10.22, 600.05);
  perform _qui('a0000000-0000-0000-0000-000000000004');
  perform placer_ordre('vente', 'marche', 10.11, null);
  begin
    perform placer_ordre('vente', 'marche', 10, null);
    d := null;
  exception when others then d := sqlerrm;
  end;
  insert into _attaques values ('#14', 'l''arrondi d''un achat limite bouche le carnet (« solde insuffisant » pour tout vendeur)', d is not null, d);
end $$;

-- #15 · un compte désactivé fait encore des gestes d'argent.
do $$
declare d text;
begin
  update comptes set desactive_le = now() where id = 'a0000000-0000-0000-0000-000000000003';
  perform _qui('a0000000-0000-0000-0000-000000000003');
  begin perform ouvrir_depot('mtn'); d := null; exception when others then d := sqlerrm; end;
  insert into _attaques values ('#15', 'un compte désactivé dépose encore', d is null, d);
  update comptes set desactive_le = null where id = 'a0000000-0000-0000-0000-000000000003';
end $$;

-- #18 · le compteur d'essais du code SMS : six codes faux, puis le bon.
do $$
declare r jsonb; v_id uuid; v_code text; i int; ok boolean;
begin
  perform _qui('a0000000-0000-0000-0000-000000000003');
  r := ajouter_numero('om', '699100018');
  v_id := (r ->> 'id')::uuid;
  select substring(texte from 'code est ([0-9]{6})') into v_code from messages_sortants where numero = '699100018' order by id desc limit 1;
  for i in 1 .. 6 loop
    begin perform confirmer_numero(v_id, '000000'); exception when others then null; end;
  end loop;
  begin r := confirmer_numero(v_id, v_code); exception when others then r := null; end;
  ok := (select verifie_le is not null from numeros where id = v_id);
  insert into _attaques values ('#18', 'six codes SMS faux ne comptent pas : le bon passe encore', ok, coalesce(r::text, '—'));
end $$;

-- #20 · completer_profil remplace le code secret sans l'ancien.
do $$
declare d text;
begin
  perform _qui('a0000000-0000-0000-0000-000000000001');
  perform completer_profil('Alice', '1111');
  begin perform completer_profil('Alice', '2222'); d := null; exception when others then d := sqlerrm; end;
  insert into _attaques values ('#20', 'le code secret se rechoisit sans l''ancien', d is null, d);
end $$;

-- #21 · un numéro ajouté (jamais prouvé) bloque son vrai propriétaire.
do $$
declare d text;
begin
  perform _qui('a0000000-0000-0000-0000-000000000002');
  perform ajouter_numero('mtn', '677100021');
  perform _qui('a0000000-0000-0000-0000-000000000004');
  begin perform ajouter_numero('mtn', '677100021'); d := null; exception when others then d := sqlerrm; end;
  insert into _attaques values ('#21', 'un numéro réservé sans preuve bloque son propriétaire', d is not null, d);
end $$;

-- #22 · deux administrateurs par e-mail : le second fait tomber l'inscription.
do $$
declare d text;
begin
  begin
    insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000e1', 'a1@x'), ('a0000000-0000-0000-0000-0000000000e2', 'a2@x');
    d := null;
  exception when others then d := sqlerrm;
  end;
  insert into _attaques values ('#22', 'le second utilisateur sans téléphone fait tomber l''inscription', d is not null, d);
end $$;

-- #24 · un compte au palier 0 sort sans limite par la chaîne.
do $$
declare d text;
begin
  update parametres set valeur = valeur || '{"retraits_ouverts": true}' where cle = 'crypto';
  perform crediter_crypto('a0000000-0000-0000-0000-000000000003', 'USDT', 'bep20', 5000, '0xr24', 'x');
  perform _qui('a0000000-0000-0000-0000-000000000003');
  perform completer_profil('Bob', '3333');
  begin
    perform demander_retrait_crypto('USDT', 'bep20', '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', 4000, null, '3333');
    d := null;
  exception when others then d := sqlerrm;
  end;
  insert into _attaques values ('#24', 'le palier 0 retire 4 000 USDT (≈ 2,4 M XAF) par la chaîne', d is null, d);
end $$;

-- #29 · un remboursement échoué ne se relance pas.
do $$
declare r jsonb; v_id bigint; v_rbt bigint; d text;
begin
  r := totem_sms_recu('akwa-1', 29, 'mtn', '677000000', '670999029', 15000, '20390000029', '…', now());
  v_id := (r ->> 'id')::bigint;
  perform _qui('a0000000-0000-0000-0000-0000000000ad');
  perform admin_rembourser_retenue(v_id, 'essai');
  select id into v_rbt from remboursements where retenue_id = v_id;
  perform totem_reclamer_remboursement(v_rbt, 'akwa-1');
  perform totem_resultat_remboursement(v_rbt, 'akwa-1', false, 'réseau muet');
  begin perform admin_rembourser_retenue(v_id, 'deuxième essai'); d := null; exception when others then d := sqlerrm; end;
  insert into _attaques values ('#29', 'un remboursement échoué ne se relance jamais', d is not null, d);
end $$;

-- #32 · un SMS sur un float inconnu du terminal crédite une déclaration.
do $$
declare r jsonb;
begin
  perform _qui('a0000000-0000-0000-0000-000000000004');
  perform declarer_transaction(ouvrir_depot('mtn') ->> 'reference', '20390000032');
  r := totem_sms_recu('akwa-1', 32, 'mtn', '670000000', '677100004', 4900000, '20390000032', '…', now());
  insert into _attaques values ('#32', 'un SMS sur un float inconnu du terminal crédite', r ->> 'resultat' = 'credite', r::text);
end $$;

-- #55 · un « échouée » renvoyé faute d'accusé compte deux fois.
do $$
declare k commandes; r jsonb;
begin
  perform _qui('a0000000-0000-0000-0000-000000000001');
  perform demander_sortie(50000, (select id from numeros where numero = '677100001'));
  select * into k from commandes order by id desc limit 1;
  k := totem_reclamer_commande(k.id, 'akwa-1');
  perform totem_resultat_commande(k.id, 'akwa-1', false, 'réseau muet');
  perform totem_resultat_commande(k.id, 'akwa-1', false, 'réseau muet');
  insert into _attaques values ('#55', 'un échec renvoyé compte comme un second échec', (select reprises from commandes where id = k.id) > 1,
    (select format('reprises = %s', reprises) from commandes where id = k.id));
end $$;

-- #53 · deux SMS sans référence : le second ne se rapproche plus.
do $$
declare r1 jsonb; r2 jsonb; ref text; d text;
begin
  r1 := totem_sms_recu('akwa-1', 531, 'mtn', '677000000', '677100004', 1000, null, '…', now());
  r2 := totem_sms_recu('akwa-1', 532, 'mtn', '677000000', '677100004', 2000, null, '…', now());
  perform _qui('a0000000-0000-0000-0000-000000000004');
  ref := ouvrir_depot('mtn') ->> 'reference';
  perform _qui('a0000000-0000-0000-0000-0000000000ad');
  perform admin_rapprocher_retenue((r1 ->> 'id')::bigint, ref);
  begin perform admin_rapprocher_retenue((r2 ->> 'id')::bigint, ref); d := null; exception when others then d := sqlerrm; end;
  insert into _attaques values ('#53', 'un second SMS sans référence ne se rapproche plus', d is not null, d);
end $$;

-- #26 · joindre les papiers d'un autre client à sa propre demande.
do $$
declare d text;
begin
  perform _qui('a0000000-0000-0000-0000-000000000002');
  begin perform demander_verification('identite', '["a0000000-0000-0000-0000-000000000001/identite/cni.jpg"]'); d := null; exception when others then d := sqlerrm; end;
  insert into _attaques values ('#26', 'on joint les papiers d''un autre client', d is null, d);
end $$;

-- #3, #4, #16 · un client (rôle authenticated) appelle les fonctions de service.
do $$
declare v text;
begin
  select string_agg(f, ', ') into v from unnest(array['totem_sms_recu(text,bigint,text,text,text,numeric,text,text,timestamp with time zone)',
    'crediter_crypto(uuid,text,text,numeric,text,text)', '_mouvement(uuid,text,numeric,numeric,text,text,text)',
    'totem_resultat_commande(bigint,text,boolean,text,text)', 'chaine_resultat_retrait(text,boolean,text,text)']) f
   where to_regprocedure(f) is not null and has_function_privilege('authenticated', to_regprocedure(f), 'execute');
  insert into _attaques values ('#3', 'un client exécute des fonctions de service (se créditer, jouer TOTEM)', v is not null, v);
end $$;

-- #58 · un boîtier réinstallé repart à la ligne 1 : son premier SMS neuf passe pour « déjà vu ».
do $$
declare r jsonb;
begin
  r := totem_sms_recu('akwa-1', 1, 'mtn', '677000000', '670999058', 58000, '20390000058', 'un SMS NEUF, après réinstallation', now());
  insert into _attaques values ('#58', 'un SMS neuf d''un boîtier réinstallé passe pour « déjà vu » : jamais crédité ni retenu',
    coalesce((r ->> 'deja')::boolean, false), r::text);
end $$;

-- #78 · le compte et son numéro « vérifié » naissent sur une simple DEMANDE de code.
do $$
declare d boolean;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'phone_confirmed_at') then
    alter table auth.users add column phone_confirmed_at timestamptz;
  end if;
  insert into auth.users (id, phone) values ('a0000000-0000-0000-0000-0000000000f8', '+237677100078');
  d := exists (select 1 from numeros where numero = '677100078' and verifie_le is not null);
  insert into _attaques values ('#78', 'un numéro naît « vérifié » sur une simple demande de code', d, null);
end $$;

\pset format unaligned
\pset tuples_only on
select n || '|' || (case when defaut then 'DEFAUT' else 'tenu' end) || '|' || constat || '|' || left(coalesce(detail, ''), 90) from _attaques order by n;
