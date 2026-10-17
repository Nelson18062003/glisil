-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · toutes les migrations, en un seul fichier             ║
-- ║  Fabriqué par supabase/consolider.py à partir de supabase/migrations : ║
-- ║  ne pas modifier à la main, le refaire.                                 ║
-- ║                                                                        ║
-- ║  Supabase → SQL Editor → coller → Run. Sur une base neuve, tout est    ║
-- ║  créé dans l'ordre ; sur une base où une partie est déjà en place,     ║
-- ║  cette partie le dit (NOTICE) et ne fait rien.                         ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ─── 0001_socle.sql (md5 92617a2a1b93a2bb4bb631cfdcb9cec6) ───
-- déjà en place si : la table des soldes
do $consolide$
begin
  if to_regclass('public.soldes') is not null then
    raise notice '0001_socle.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ============================================================================
-- XAFe Exchange · 0001 · le socle
--
-- Comptes, soldes, grand livre, émissions ; dépôts payés par MoMo et lus par
-- TOTEM ; sorties découpées en transferts que TOTEM compose ; carnet d'ordres
-- USDT/XAFe et appariement prix-temps. Tout mouvement d'argent passe par une
-- fonction d'ici, qui verrouille la ligne de solde et écrit en relatif.
-- Lire docs/ARCHITECTURE.md avant de toucher à ce fichier.
-- ============================================================================

-- pgcrypto vit dans le schéma « extensions » chez Supabase, pas dans public :
-- chaque appel s'écrit donc extensions.crypt(…), extensions.gen_salt(…),
-- jamais nu — sous « set search_path = public » il serait introuvable.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Les rôles de Supabase. Sur un PostgreSQL nu (le harnais), on les crée.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

-- Supabase donne d'office EXECUTE (et ALL sur les tables) à anon et à
-- authenticated sur tout ce qui naît dans public : « revoke … from public »
-- ne retire RIEN de ces deux-là. On coupe ce robinet AVANT de créer quoi que
-- ce soit ; la liste de ce qui s'ouvre est écrite une seule fois, dans
-- 0004_droits.sql, et le harnais vérifie qu'il n'y a rien d'autre.
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges revoke execute on functions from public;

-- ───────────────────────────── paramètres ──────────────────────────────────
create table parametres (
  cle    text primary key,
  valeur jsonb not null,
  maj_le timestamptz not null default now()
);
insert into parametres (cle, valeur) values
  ('frais',   '{"placeur": 0.0005, "preneur": 0.0010, "sortie": 0.005}'),
  ('marche',  '{"paire": "USDT/XAFe", "pas_prix": 0.05, "quantite_min": 10, "ouvert": true}'),
  ('depot',   '{"validite_minutes": 30, "grace_minutes": 120}'),
  ('sortie',  '{"reprises_max": 3}'),
  -- l'achat (et la vente) rapide : un prix ferme, pris au carnet, plus la marge de la plateforme
  ('rapide',  '{"marge": 0.01, "validite_secondes": 20, "ouvert": true}'),
  ('paliers', '{"0": {"entree_jour": 500000, "sortie_jour": 500000},
                "1": {"entree_jour": 5000000, "sortie_jour": 5000000},
                "2": null}');

create function parametre(p_cle text) returns jsonb
language sql stable as $$ select valeur from parametres where cle = p_cle $$;

-- ───────────────────────── opérateurs, terminaux, floats ───────────────────
create table operateurs (
  id                    text primary key,          -- 'mtn', 'om'
  nom                   text not null,
  plafond_par_transfert numeric(20,2) not null,
  plafond_jour          numeric(20,2)
);
insert into operateurs values
  ('mtn', 'MTN MoMo',     1000000, 100000000),
  ('om',  'Orange Money',  500000,   1500000);

create table terminaux (
  id       text primary key,                        -- 'akwa-1'
  nom      text not null,
  lieu     text,
  cle      text,                                    -- la clé HMAC du boîtier : lisible par la clé de service seulement
  vu_le    timestamptz
);

create table floats (
  id        serial primary key,
  operateur text not null references operateurs(id),
  numero    text not null,                          -- le numéro que les clients paient
  terminal  text references terminaux(id),
  code_agent text,                                 -- le code marchand/agent, quand on peut y faire un retrait
  actif     boolean not null default true,
  unique (operateur, numero)
);

create function normaliser_numero(p text) returns text
language sql immutable as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 9)
$$;

-- ───────────────────────────── comptes ─────────────────────────────────────
create table comptes (
  id           uuid primary key default gen_random_uuid(),
  telephone    text unique,
  nom          text,
  palier       smallint not null default 0 check (palier between 0 and 2),
  maison       boolean not null default false,
  cree_le      timestamptz not null default now(),
  desactive_le timestamptz
);
insert into comptes (id, telephone, nom, palier, maison)
values ('00000000-0000-0000-0000-000000000001', 'maison', 'XAFe Exchange', 2, true);

-- « Aujourd'hui » commence à minuit À DOUALA, pas à minuit UTC (la base est
-- en UTC chez Supabase) : un dépôt de 00:30 comptait pour la veille, et les
-- plafonds du jour se rouvraient à 01:00. Un seul endroit pour le dire.
create function debut_du_jour() returns timestamptz language sql stable as $$
  select date_trunc('day', now() at time zone 'Africa/Douala') at time zone 'Africa/Douala'
$$;

create function compte_maison() returns uuid
language sql immutable as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;

create table numeros (
  id         uuid primary key default gen_random_uuid(),
  compte_id  uuid not null references comptes(id),
  operateur  text not null references operateurs(id),
  numero     text not null,
  verifie_le timestamptz,                         -- null tant que le code SMS n'a pas été confirmé
  actif_des  timestamptz not null default now() + interval '24 hours',
  retire_le  timestamptz
);
-- Un numéro VÉRIFIÉ n'appartient qu'à un compte à la fois : c'est lui qui
-- décide à qui va un paiement. Un numéro seulement ajouté (code SMS pas encore
-- confirmé) ne prouve rien et ne retient rien : sinon n'importe qui
-- réserverait le numéro d'un autre avant lui.
create unique index numeros_un_proprietaire on numeros (numero) where retire_le is null and verifie_le is not null;
create index numeros_du_compte on numeros (compte_id) where retire_le is null;

-- Le compte qui possède un numéro (vérifié, pas retiré), ou null.
create function _proprietaire_du_numero(p_numero text) returns uuid
language sql stable as $$
  select compte_id from numeros
   where numero = normaliser_numero(p_numero) and retire_le is null and verifie_le is not null
   limit 1
$$;

-- Un compte que l'administration a désactivé ne fait plus aucun geste
-- d'argent. Il garde ses lectures, et un ordre se retire toujours (cela rend).
create function _exiger_compte_actif(p_compte uuid) returns void
language plpgsql as $$
begin
  if p_compte is null then raise exception 'non connecté'; end if;
  if exists (select 1 from comptes where id = p_compte and desactive_le is not null) then
    raise exception 'compte désactivé' using detail = 'contactez l''équipe XAFe';
  end if;
end $$;

-- ───────────────────── soldes, grand livre, émissions ──────────────────────
create table soldes (
  compte_id  uuid not null references comptes(id),
  actif      text not null check (actif in ('XAFe', 'USDT')),
  disponible numeric(20,2) not null default 0 check (disponible >= 0),
  bloque     numeric(20,2) not null default 0 check (bloque >= 0),
  maj_le     timestamptz not null default now(),
  primary key (compte_id, actif)
);

create table ecritures (
  id               bigint generated always as identity primary key,
  compte_id        uuid not null references comptes(id),
  actif            text not null,
  disponible_delta numeric(20,2) not null default 0,
  bloque_delta     numeric(20,2) not null default 0,
  nature           text not null,
  source_table     text,
  source_id        text,
  cree_le          timestamptz not null default now()
);
create index ecritures_du_compte on ecritures (compte_id, cree_le desc);

-- Chaque XAFe créé (un XAF reçu) ou détruit (un XAF sorti). La circulation,
-- c'est la différence des deux.
-- Ce qu'on dit au client, sur son téléphone : un titre, une phrase, un écran.
create table notifications (
  id        uuid primary key default gen_random_uuid(),
  compte_id uuid not null references comptes(id),
  titre     text not null,
  texte     text not null,
  cible     text not null default '/',
  cree_le   timestamptz not null default now(),
  lue_le    timestamptz
);
create index notifications_compte on notifications (compte_id, cree_le desc);

create function _notifier(p_compte uuid, p_titre text, p_texte text, p_cible text) returns void
language sql as $$
  insert into notifications (compte_id, titre, texte, cible) values (p_compte, p_titre, p_texte, p_cible)
$$;

-- « vers_chaine » / « depuis_chaine » : des XAFe qui quittent la plateforme
-- pour la chaîne (frappés là-bas) ou qui en reviennent. Ils restent dus en XAF,
-- mais ne sont plus dans un solde : on les compte à part pour que la somme des
-- soldes vaille toujours circulation(), et la réserve circulation() +
-- circulation_chaine().
create table emissions (
  id           bigint generated always as identity primary key,
  sens         text not null check (sens in ('emission', 'destruction', 'vers_chaine', 'depuis_chaine')),
  montant      numeric(20,2) not null check (montant > 0),
  source_table text,
  source_id    text,
  cree_le      timestamptz not null default now()
);

-- L'ORDRE DES VERROUS, pour qu'aucune transaction n'attende une transaction
-- qui l'attend (une « étreinte mortelle », que PostgreSQL tranche en tuant
-- l'une des deux : le geste d'un client tombe). La charge de seize clients
-- (moteur/charge) en a trouvé deux ; la règle qui les empêche :
--   · le compte MAISON se touche en DERNIER, dans toute transaction : un
--     ordre encaisse ses frais une fois, à la fin, pas à chaque tranche ;
--   · un compte se sérialise par « for no key update », jamais « for
--     update » : ce dernier bloque aussi les clés étrangères, et chaque
--     écriture au grand livre en porte une vers « comptes ».
--
-- LE seul chemin vers un solde. Verrouille la ligne, écrit en relatif, laisse
-- une écriture. La contrainte « disponible >= 0 » fait le dernier contrôle.
create function _mouvement(p_compte uuid, p_actif text, p_dispo numeric, p_bloque numeric,
                           p_nature text, p_table text, p_id text)
returns void language plpgsql as $$
begin
  insert into soldes (compte_id, actif) values (p_compte, p_actif) on conflict do nothing;
  perform 1 from soldes where compte_id = p_compte and actif = p_actif for update;
  begin
    update soldes
       set disponible = disponible + p_dispo, bloque = bloque + p_bloque, maj_le = now()
     where compte_id = p_compte and actif = p_actif;
  exception when check_violation then
    raise exception 'solde insuffisant' using errcode = 'P0001',
      detail = format('%s : %s disponible, %s bloqué', p_actif, p_dispo, p_bloque);
  end;
  insert into ecritures (compte_id, actif, disponible_delta, bloque_delta, nature, source_table, source_id)
  values (p_compte, p_actif, p_dispo, p_bloque, p_nature, p_table, p_id);
end $$;

-- Les XAFe dans les soldes de la plateforme.
create function circulation() returns numeric
language sql stable as $$
  select coalesce(sum(case when sens in ('emission', 'depuis_chaine') then montant else -montant end), 0) from emissions
$$;

-- Les XAFe partis sur la chaîne et pas revenus : dus aussi, en XAF.
create function circulation_chaine() returns numeric
language sql stable as $$
  select coalesce(sum(case sens when 'vers_chaine' then montant when 'depuis_chaine' then -montant else 0 end), 0) from emissions
$$;

-- ───────────────────────────── dépôts ──────────────────────────────────────
create sequence depots_numero;

-- Le DOSSIER d'un dépôt : il dit où payer. Le client paie d'abord, comme il
-- sait le faire (transfert, flotte, retrait chez notre agent), puis tape le
-- transaction ID du SMS de l'opérateur. Pas de montant tapé d'avance : c'est
-- le SMS que TOTEM lit sur le float qui le dit.
create table depots (
  id            uuid primary key default gen_random_uuid(),
  reference     text not null unique,                  -- XAFe-DP-000418
  compte_id     uuid not null references comptes(id),
  operateur     text not null references operateurs(id),
  float_id      int  not null references floats(id),
  montant_recu  numeric(20,2) not null default 0,
  etat          text not null default 'en_attente'
                check (etat in ('en_attente', 'credite', 'expire', 'annule')),
  cle           text,
  cree_le       timestamptz not null default now(),
  expire_le     timestamptz not null,
  credite_le    timestamptz
);
create unique index depots_cle on depots (compte_id, cle) where cle is not null;
create index depots_du_compte on depots (compte_id, cree_le desc);

-- Un transaction ID que le client a tapé. Un paiement ne crédite qu'une fois
-- (l'index partiel ci-dessous), mais plusieurs comptes peuvent avoir tapé le
-- même ID : ce n'est pas le premier arrivé qui gagne, c'est le NUMÉRO qui a
-- payé qui décide (_apparier). Sinon il suffirait de déclarer d'avance des ID
-- au hasard pour encaisser le paiement d'un autre.
create table depot_declarations (
  id             uuid primary key default gen_random_uuid(),
  depot_id       uuid not null references depots(id),
  compte_id      uuid not null references comptes(id),
  operateur      text not null references operateurs(id),
  transaction_id text not null,
  etat           text not null default 'attendu' check (etat in ('attendu', 'credite', 'refuse')),
  montant        numeric(20,2),
  numero_payeur  text,
  motif          text,
  paiement_id    bigint,
  declare_le     timestamptz not null default now(),
  credite_le     timestamptz,
  unique (compte_id, operateur, transaction_id)
);
create unique index depot_declarations_un_credit on depot_declarations (operateur, transaction_id) where etat = 'credite';
create index depot_declarations_depot on depot_declarations (depot_id);
create index depot_declarations_attendues on depot_declarations (operateur, transaction_id) where etat = 'attendu';
create index depot_declarations_du_jour on depot_declarations (compte_id, credite_le) where etat = 'credite';
create index depot_declarations_creditees on depot_declarations (credite_le) where etat = 'credite';

-- L'identité d'un SMS. Le numéro de ligne du robot (source_id) ne suffit
-- pas : il vit sur la carte SD du boîtier, et un boîtier réinstallé repart à
-- 1 — ses SMS NEUFS passaient alors pour « déjà vus », de l'argent reçu et
-- jamais crédité, sans un mot. Un SMS relu après une coupure garde le même
-- texte, la même référence, le même montant : la même empreinte.
create function _empreinte_sms(p_texte text, p_reference text, p_montant numeric) returns text
language sql immutable as $$
  select md5(coalesce(p_texte, '') || '|' || coalesce(p_reference, '') || '|' || coalesce(p_montant::text, ''))
$$;

-- Les SMS qui ont crédité un dépôt. (terminal, source_id, empreinte) : un SMS
-- ne crédite qu'une fois, même relu après une coupure.
create table depot_paiements (
  id                  bigint generated always as identity primary key,
  depot_id            uuid not null references depots(id),
  declaration_id      uuid references depot_declarations(id),
  terminal            text not null,
  source_id           bigint not null,
  montant             numeric(20,2) not null,
  numero_payeur       text,
  reference_operateur text,
  texte               text,
  emis_le             timestamptz,
  cree_le             timestamptz not null default now(),
  empreinte           text not null,
  unique (terminal, source_id, empreinte)
);

-- Un SMS d'argent que personne n'a encore déclaré : retenu, jamais crédité
-- au hasard. Il attend son transaction ID, ou un remboursement par l'équipe.
create table entrees_retenues (
  id                  bigint generated always as identity primary key,
  terminal            text not null,
  source_id           bigint not null,
  float_id            int references floats(id),
  operateur           text,
  float_numero        text,
  numero_payeur       text,
  montant             numeric(20,2),
  reference_operateur text,
  transaction_id      text,                         -- la référence, normalisée
  texte               text,
  emis_le             timestamptz,
  etat                text not null default 'retenue' check (etat in ('retenue', 'rapprochee', 'remboursee')),
  depot_id            uuid references depots(id),
  -- Pourquoi l'appariement automatique a refusé, s'il a refusé. « bloquee » :
  -- seule l'équipe la dénoue (float inconnu sur ce terminal, ID tapé par
  -- plusieurs comptes, palier dépassé). Sans « bloquee », la prochaine
  -- déclaration la reprend — et le numéro payeur décide encore (_apparier).
  motif               text,
  bloquee             boolean not null default false,  -- vrai : aucune déclaration ne la prendra plus seule
  cree_le             timestamptz not null default now(),
  empreinte           text not null,
  unique (terminal, source_id, empreinte)
);
create index entrees_retenues_transaction on entrees_retenues (operateur, transaction_id) where etat = 'retenue';

-- Un transaction ID se compare en majuscules, sans espace ni ponctuation :
-- MTN écrit « 20394817104 », Orange « MP261012.1402.A12345 », le client le
-- recopie comme il peut.
create function normaliser_transaction_id(p text) returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- « lu_le » : quand TOTEM a lu le SMS qui a payé (« Lu par TOTEM » sur le reçu).
create function _declaration_json(x depot_declarations) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', x.id, 'transaction_id', x.transaction_id, 'etat', x.etat, 'montant', x.montant,
                            'numero_payeur', x.numero_payeur, 'motif', x.motif, 'declare_le', x.declare_le, 'credite_le', x.credite_le,
                            'lu_le', (select p.cree_le from depot_paiements p where p.id = x.paiement_id))
$$;

-- « reception » dit au client si le numéro qu'on lui a donné reçoit ENCORE :
--   ouverte   le float est actif et son boîtier a parlé il y a moins de 10 min ;
--   retardee  le boîtier se tait : on peut payer, le SMS sera lu à son retour
--             (le boîtier garde ses SMS), le crédit attendra ;
--   fermee    l'équipe a retiré ce float (puce perdue, saisie, changée) : ne
--             plus payer à ce numéro. Un paiement déjà fait reste traité —
--             totem_sms_recu ne regarde pas « actif » —, mais un client qui
--             paie APRÈS pourrait ne jamais être lu.
-- Le dossier gardait le numéro choisi à l'ouverture sans jamais redire s'il
-- valait encore : le client payait un float retiré une heure plus tôt.
create function _depot_json(d depots) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'reference', d.reference, 'etat', d.etat, 'operateur', d.operateur,
    'montant_recu', d.montant_recu,
    'float_numero', f.numero,
    'code_agent', f.code_agent,
    'reception', case when not coalesce(f.actif, false) then 'fermee'
                      when t.vu_le is null or t.vu_le < now() - interval '10 minutes' then 'retardee'
                      else 'ouverte' end,
    'declarations', (select coalesce(jsonb_agg(_declaration_json(x) order by x.declare_le), '[]'::jsonb)
                       from depot_declarations x where x.depot_id = d.id),
    'cree_le', d.cree_le, 'expire_le', d.expire_le, 'credite_le', d.credite_le)
    from (select 1) _ left join floats f on f.id = d.float_id left join terminaux t on t.id = f.terminal
$$;

-- On ouvre le dossier AVANT de payer : il dit à quel float payer.
create function ouvrir_depot(p_operateur text, p_cle text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_compte uuid := auth.uid();
  v_d      depots;
  v_float  floats;
begin
  perform _exiger_compte_actif(v_compte);
  if p_cle is not null then
    select * into v_d from depots where compte_id = v_compte and cle = p_cle;
    if found then return _depot_json(v_d) || '{"deja": true}'; end if;
  end if;
  perform 1 from operateurs where id = p_operateur;
  if not found then raise exception 'opérateur inconnu'; end if;

  -- Le float : sur cet opérateur, actif, porté par un terminal vu récemment,
  -- le moins chargé de dossiers ouverts.
  select f.* into v_float
    from floats f join terminaux t on t.id = f.terminal
   where f.operateur = p_operateur and f.actif
   order by (t.vu_le is not null and t.vu_le > now() - interval '10 minutes') desc,
            (select count(*) from depots d where d.float_id = f.id and d.etat = 'en_attente') asc,
            f.id
   limit 1;
  if not found then raise exception 'aucun float disponible pour cet opérateur'; end if;

  insert into depots (reference, compte_id, operateur, float_id, cle, expire_le)
  values ('XAFe-DP-' || lpad(nextval('depots_numero')::text, 6, '0'), v_compte, p_operateur, v_float.id,
          p_cle, now() + make_interval(mins => (parametre('depot') ->> 'validite_minutes')::int))
  returning * into v_d;
  return _depot_json(v_d);
end $$;

create function mon_depot(p_reference text) returns jsonb
language sql stable security definer set search_path = public as $$
  select _depot_json(d) from depots d where d.reference = p_reference and d.compte_id = auth.uid()
$$;

create function mes_depots_en_attente() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(_depot_json(d) order by d.cree_le desc), '[]'::jsonb)
    from depots d
   where d.compte_id = auth.uid()
     and ((d.etat = 'en_attente' and d.expire_le > now())
          or exists (select 1 from depot_declarations x where x.depot_id = d.id and x.etat = 'attendu'))
$$;

-- L'APPARIEMENT : à quelle déclaration va ce paiement ? Ce n'est pas « la
-- première qui a tapé l'ID » : c'est le NUMÉRO qui a payé qui décide.
--   · Le numéro est vérifié sur un compte : seule la déclaration de CE compte
--     peut le prendre ; les autres sont refusées.
--   · Un ID tapé plus de cinq minutes AVANT le paiement (l'heure du SMS) ne
--     peut pas venir de celui qui a payé : il ne le connaissait pas encore.
--   · Le numéro n'est à personne et plusieurs comptes restent en lice : on ne
--     tire pas au sort, l'équipe tranche.
-- Rend {"id": …} (la déclaration à créditer) ou {"motif": …, "bloquee": …}.
-- Appelée sous le verrou consultatif du transaction ID.
create function _apparier(p_operateur text, p_tx text, p_payeur text, p_emis_le timestamptz)
returns jsonb language plpgsql as $$
declare
  v_proprio uuid := _proprietaire_du_numero(p_payeur);
  v_x       depot_declarations;
  v_elus    uuid[] := '{}';
  v_motif   text;
  v_vues    int := 0;
begin
  for v_x in select * from depot_declarations
              where operateur = p_operateur and transaction_id = p_tx and etat = 'attendu'
              order by declare_le, id for update loop
    v_vues := v_vues + 1;
    if v_proprio is not null and v_x.compte_id <> v_proprio then
      v_motif := 'le numéro qui a payé est celui d''un autre compte : l''équipe vérifie';
    elsif p_emis_le is not null and v_x.declare_le < p_emis_le - interval '5 minutes' then
      v_motif := 'ce transaction ID a été tapé avant le paiement : l''équipe vérifie';
    else
      v_elus := v_elus || v_x.id;
      continue;
    end if;
    update depot_declarations set etat = 'refuse', motif = v_motif where id = v_x.id;
    perform _notifier(v_x.compte_id, 'Transaction ID en vérification', v_motif || '.',
                      '/historique/' || (select reference from depots where id = v_x.depot_id));
  end loop;

  if cardinality(v_elus) = 1 then return jsonb_build_object('id', v_elus[1]); end if;
  if cardinality(v_elus) > 1 then
    v_motif := 'plusieurs comptes ont tapé ce transaction ID : l''équipe vérifie';
    update depot_declarations set etat = 'refuse', motif = v_motif where id = any (v_elus);
    perform _notifier(x.compte_id, 'Transaction ID en vérification', v_motif || '.', '/historique/' || d.reference)
       from depot_declarations x join depots d on d.id = x.depot_id where x.id = any (v_elus);
    return jsonb_build_object('motif', v_motif, 'bloquee', true);
  end if;
  if v_vues > 0 then return jsonb_build_object('motif', v_motif, 'bloquee', false); end if;
  return '{}'::jsonb;
end $$;

-- LE CRÉDIT : une déclaration et le SMS qui lui correspond se rencontrent.
-- Appelé par declarer_transaction (l'ID arrive après le SMS), par
-- totem_sms_recu (le SMS arrive après l'ID) et par l'équipe qui rapproche à la
-- main. Le palier se vérifie ICI, sur le montant lu dans le SMS : au-delà, la
-- déclaration est refusée, l'argent reste retenu et l'équipe rembourse — on ne
-- crédite jamais ce qu'on ne peut pas. Le compte est verrouillé AVANT de
-- compter ce qu'il a reçu aujourd'hui : deux SMS dans la même rafale du robot
-- liraient sinon le même total, et passeraient tous deux.
create function _crediter_declaration(p_decl_id uuid, p_terminal text, p_source_id bigint, p_montant numeric,
                                      p_numero_payeur text, p_reference_operateur text, p_texte text, p_emis_le timestamptz,
                                      p_retenue_id bigint)
returns depot_declarations language plpgsql as $$
declare
  v_x      depot_declarations;
  v_d      depots;
  v_palier jsonb;
  v_jour   numeric;
  v_paiement bigint;
begin
  select * into v_x from depot_declarations where id = p_decl_id for update;
  select * into v_d from depots where id = v_x.depot_id for update;
  if v_x.etat <> 'attendu' then return v_x; end if;
  perform 1 from comptes where id = v_d.compte_id for no key update;

  v_palier := parametre('paliers') -> (select palier::text from comptes where id = v_d.compte_id);
  if v_palier is not null and v_palier <> 'null'::jsonb then
    select coalesce(sum(montant), 0) into v_jour from depot_declarations
     where compte_id = v_d.compte_id and etat = 'credite' and credite_le >= debut_du_jour();
    if v_jour + p_montant > (v_palier ->> 'entree_jour')::numeric then
      update depot_declarations
         set etat = 'refuse', montant = p_montant, numero_payeur = p_numero_payeur,
             motif = format('plafond du palier atteint (%s XAF par jour) : l''argent est retenu, l''équipe vous rembourse', v_palier ->> 'entree_jour')
       where id = v_x.id returning * into v_x;
      if p_retenue_id is not null then
        update entrees_retenues set motif = v_x.motif, bloquee = true, depot_id = v_d.id where id = p_retenue_id;
      end if;
      perform _notifier(v_d.compte_id, 'Paiement retenu', format('%s XAF reçus au-delà de votre palier : ils vous seront remboursés.', to_char(p_montant, 'FM999G999G999G999')), '/historique/' || v_d.reference);
      return v_x;
    end if;
  end if;

  insert into depot_paiements (depot_id, declaration_id, terminal, source_id, montant, numero_payeur, reference_operateur, texte, emis_le, empreinte)
  values (v_d.id, v_x.id, p_terminal, p_source_id, p_montant, p_numero_payeur, p_reference_operateur, p_texte, p_emis_le,
          _empreinte_sms(p_texte, p_reference_operateur, p_montant))
  returning id into v_paiement;
  perform _mouvement(v_d.compte_id, 'XAFe', p_montant, 0, 'depot', 'depots', v_d.reference);
  insert into emissions (sens, montant, source_table, source_id) values ('emission', p_montant, 'depots', v_d.reference);
  update depots set montant_recu = montant_recu + p_montant, etat = 'credite', credite_le = now() where id = v_d.id;
  update depot_declarations
     set etat = 'credite', montant = p_montant, numero_payeur = p_numero_payeur, credite_le = now(),
         paiement_id = v_paiement
   where id = v_x.id returning * into v_x;
  if p_retenue_id is not null then
    update entrees_retenues set etat = 'rapprochee', depot_id = v_d.id where id = p_retenue_id;
  end if;
  perform _notifier(v_d.compte_id, 'XAFe crédités', format('+%s XAFe reçus par %s.', to_char(p_montant, 'FM999G999G999G999'), (select nom from operateurs where id = v_d.operateur)), '/historique/' || v_d.reference);
  return v_x;
end $$;

-- Le client tape le transaction ID de son SMS. Le verrou consultatif du
-- transaction ID passe AVANT toute lecture : un SMS qui arrive au même instant
-- (totem_sms_recu prend le même) attend, puis se voit — sinon chacun ne verrait
-- pas l'autre, et l'argent resterait retenu sans que personne ne le sache.
create function declarer_transaction(p_reference text, p_transaction_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_compte uuid := auth.uid();
  v_d      depots;
  v_x      depot_declarations;
  v_r      entrees_retenues;
  v_a      jsonb;
  v_id     text := normaliser_transaction_id(p_transaction_id);
begin
  perform _exiger_compte_actif(v_compte);
  select * into v_d from depots where reference = p_reference and compte_id = v_compte for update;
  if not found then raise exception 'dépôt inconnu'; end if;
  if v_d.etat in ('annule') then raise exception 'ce dépôt est annulé'; end if;
  if length(v_id) < 6 or length(v_id) > 40 then
    raise exception 'transaction ID invalide' using detail = 'au moins six caractères, tel qu''il est écrit dans le SMS';
  end if;
  perform pg_advisory_xact_lock(hashtext('tx:' || v_d.operateur || ':' || v_id));

  -- Le même ID, déjà tapé par ce compte : sur ce dossier, c'est le même geste rejoué.
  select * into v_x from depot_declarations where compte_id = v_compte and operateur = v_d.operateur and transaction_id = v_id;
  if found then
    if v_x.depot_id = v_d.id then return _declaration_json(v_x); end if;
    raise exception 'transaction ID déjà déclaré' using detail = format('sur le dossier %s', (select reference from depots where id = v_x.depot_id));
  end if;
  if exists (select 1 from depot_declarations where operateur = v_d.operateur and transaction_id = v_id and etat = 'credite') then
    raise exception 'transaction ID déjà utilisé' using detail = 'ce paiement a déjà été crédité';
  end if;
  -- Taper des ID au hasard ne coûte rien : on le borne.
  if (select count(*) from depot_declarations where compte_id = v_compte and etat = 'attendu') >= 5 then
    raise exception 'trop de transaction ID en attente' using detail = 'attendez que les premiers soient lus';
  end if;
  if (select count(*) from depot_declarations where compte_id = v_compte and declare_le > now() - interval '24 hours') >= 30 then
    raise exception 'trop de transaction ID aujourd''hui' using detail = 'l''équipe peut rapprocher les autres';
  end if;

  insert into depot_declarations (depot_id, compte_id, operateur, transaction_id)
  values (v_d.id, v_compte, v_d.operateur, v_id) returning * into v_x;

  -- TOTEM a peut-être déjà lu le SMS : il est alors parmi les entrées retenues.
  select * into v_r from entrees_retenues
   where operateur = v_d.operateur and transaction_id = v_id and etat = 'retenue' and not bloquee
     and coalesce(montant, 0) > 0
   order by cree_le limit 1 for update;
  if found then
    v_a := _apparier(v_d.operateur, v_id, v_r.numero_payeur, v_r.emis_le);
    if v_a ? 'id' then
      v_x := _crediter_declaration((v_a ->> 'id')::uuid, v_r.terminal, v_r.source_id, v_r.montant, v_r.numero_payeur,
                                   v_r.reference_operateur, v_r.texte, v_r.emis_le, v_r.id);
    else
      update entrees_retenues set motif = coalesce(v_a ->> 'motif', motif), bloquee = bloquee or coalesce((v_a ->> 'bloquee')::boolean, false)
       where id = v_r.id;
      select * into v_x from depot_declarations where id = v_x.id;
    end if;
  end if;
  return _declaration_json(v_x);
end $$;

-- « Terminer » : un dossier sans aucune déclaration se ferme comme annulé ; sinon il reste ce qu'il est.
create function terminer_depot(p_reference text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_d depots;
begin
  select * into v_d from depots where reference = p_reference and compte_id = auth.uid() for update;
  if not found then raise exception 'dépôt inconnu'; end if;
  if v_d.etat = 'en_attente' and not exists (select 1 from depot_declarations where depot_id = v_d.id) then
    update depots set etat = 'annule' where id = v_d.id returning * into v_d;
  end if;
  return _depot_json(v_d);
end $$;

create function annuler_depot(p_reference text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_d depots;
begin
  select * into v_d from depots where reference = p_reference and compte_id = auth.uid() for update;
  if not found then raise exception 'dépôt inconnu'; end if;
  if v_d.etat <> 'en_attente' or exists (select 1 from depot_declarations where depot_id = v_d.id and etat = 'attendu') then
    raise exception 'ce dépôt ne peut plus être annulé' using detail = v_d.etat;
  end if;
  update depots set etat = 'annule' where id = v_d.id returning * into v_d;
  return _depot_json(v_d);
end $$;

-- Retirer un transaction ID mal recopié. Il attendait un SMS qui ne viendra
-- jamais : le dossier restait « en attente » pour toujours, l'accueil le
-- montrait sans fin, et rien ne permettait de l'effacer. Seule une
-- déclaration qui ATTEND se retire : une déclaration créditée est de
-- l'argent, une refusée est entre les mains de l'équipe. Le verrou du
-- transaction ID passe d'abord : un SMS qui arrive au même instant crédite,
-- ou trouve la déclaration partie — jamais entre les deux.
create function retirer_declaration(p_reference text, p_transaction_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_d depots; v_x depot_declarations; v_id text := normaliser_transaction_id(p_transaction_id);
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  select * into v_d from depots where reference = p_reference and compte_id = auth.uid() for update;
  if not found then raise exception 'dépôt inconnu'; end if;
  perform pg_advisory_xact_lock(hashtext('tx:' || v_d.operateur || ':' || v_id));
  select * into v_x from depot_declarations where depot_id = v_d.id and transaction_id = v_id for update;
  if not found then raise exception 'transaction ID inconnu sur ce dépôt'; end if;
  if v_x.etat <> 'attendu' then
    raise exception 'cette déclaration ne se retire plus' using detail = case v_x.etat when 'credite' then 'elle a été créditée' else 'l''équipe la vérifie' end;
  end if;
  delete from depot_declarations where id = v_x.id;
  return _depot_json(v_d);
end $$;

-- Un dossier ouvert, sans déclaration, passé sa validité : expiré. Une
-- déclaration en attente, elle, n'expire jamais : le SMS peut arriver tard.
create function expirer_depots() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- une déclaration qui attend son SMS, ou que l'équipe doit trancher, garde son dossier ouvert ; une
  -- déclaration retirée par le client (un ID mal recopié) ne le retient plus
  update depots d set etat = 'expire'
   where etat = 'en_attente' and expire_le < now()
     and not exists (select 1 from depot_declarations x where x.depot_id = d.id and x.etat in ('attendu', 'refuse'));
  get diagnostics n = row_count;
  return n;
end $$;

-- Ce que TOTEM a lu : un SMS d'argent sur un float.
--
-- Deux verrous consultatifs, toujours dans cet ordre : le SMS (terminal,
-- source_id), puis le transaction ID. Le robot renvoie un lot dont il n'a pas
-- eu l'accusé : le même SMS peut arriver deux fois EN MÊME TEMPS. Sans le
-- premier verrou, le second appel ne voyait pas le crédit du premier (pas
-- encore commis), sautait la déclaration verrouillée, et RETENAIT le même
-- SMS : crédité ET à rembourser. Avec lui, le second attend, relit, et
-- reconnaît un SMS déjà vu.
--
-- Un boîtier n'écrit que pour SES cartes : un SMS dont le float n'est pas
-- porté par ce terminal ne crédite jamais rien, il est retenu pour l'équipe.
create function totem_sms_recu(p_terminal text, p_source_id bigint, p_operateur text, p_float_numero text,
                               p_numero_payeur text, p_montant numeric, p_reference text, p_texte text,
                               p_emis_le timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_float floats;
  v_d     depots;
  v_p     depot_paiements;
  v_r     entrees_retenues;
  v_x     depot_declarations;
  v_a     jsonb := '{}'::jsonb;
  v_num   text := nullif(normaliser_numero(p_numero_payeur), '');
  v_id    text := normaliser_transaction_id(p_reference);
  v_emp   text := _empreinte_sms(p_texte, p_reference, p_montant);
  v_reutilise boolean;
begin
  perform pg_advisory_xact_lock(hashtext('sms:' || p_terminal || ':' || p_source_id::text));
  -- Le même SMS, relu après une coupure : la même réponse, rien de plus.
  select * into v_p from depot_paiements where terminal = p_terminal and source_id = p_source_id and empreinte = v_emp;
  if found then
    select * into v_d from depots where id = v_p.depot_id;
    return jsonb_build_object('resultat', 'credite', 'reference', v_d.reference, 'etat', v_d.etat, 'deja', true);
  end if;
  select * into v_r from entrees_retenues where terminal = p_terminal and source_id = p_source_id and empreinte = v_emp;
  if found then return jsonb_build_object('resultat', 'retenue', 'id', v_r.id, 'deja', true); end if;
  -- Ce numéro de ligne a déjà servi à un AUTRE SMS : le boîtier a été réinstallé. Ce SMS est neuf ; on le
  -- traite, et on le dit (la réponse et le journal du robot le portent).
  v_reutilise := exists (select 1 from depot_paiements where terminal = p_terminal and source_id = p_source_id)
              or exists (select 1 from entrees_retenues where terminal = p_terminal and source_id = p_source_id);

  update terminaux set vu_le = now() where id = p_terminal;
  select * into v_float from floats
   where operateur = p_operateur and numero = normaliser_numero(p_float_numero) and terminal = p_terminal;
  if not found then
    insert into entrees_retenues (terminal, source_id, operateur, float_numero, numero_payeur, montant,
                                  reference_operateur, transaction_id, texte, emis_le, motif, bloquee, empreinte)
    values (p_terminal, p_source_id, p_operateur, p_float_numero, v_num, p_montant, p_reference, v_id, p_texte, p_emis_le,
            'ce numéro n''est pas un float de ce terminal : l''équipe vérifie', true, v_emp)
    returning * into v_r;
    return jsonb_build_object('resultat', 'retenue', 'id', v_r.id, 'motif', v_r.motif);
  end if;

  -- Le client a peut-être déjà tapé l'ID de ce paiement.
  if coalesce(p_montant, 0) > 0 and length(v_id) >= 6 then
    perform pg_advisory_xact_lock(hashtext('tx:' || p_operateur || ':' || v_id));
    v_a := _apparier(p_operateur, v_id, v_num, p_emis_le);
    if v_a ? 'id' then
      v_x := _crediter_declaration((v_a ->> 'id')::uuid, p_terminal, p_source_id, p_montant, v_num, p_reference, p_texte, p_emis_le, null);
      select * into v_d from depots where id = v_x.depot_id;
      if v_x.etat = 'credite' then
        return jsonb_strip_nulls(jsonb_build_object('resultat', 'credite', 'reference', v_d.reference, 'etat', v_d.etat,
                                                    'montant_recu', v_d.montant_recu, 'source_id_reutilise', case when v_reutilise then true end));
      end if;
      -- refusée (palier) : le SMS est retenu, rattaché au dossier pour l'équipe
      v_a := jsonb_build_object('motif', v_x.motif, 'bloquee', true, 'depot_id', v_d.id);
    end if;
  end if;

  insert into entrees_retenues (terminal, source_id, float_id, operateur, float_numero, numero_payeur, montant,
                                reference_operateur, transaction_id, texte, emis_le, depot_id, motif, bloquee, empreinte)
  values (p_terminal, p_source_id, v_float.id, p_operateur, p_float_numero, v_num, p_montant, p_reference, v_id, p_texte, p_emis_le,
          (v_a ->> 'depot_id')::uuid, v_a ->> 'motif', coalesce((v_a ->> 'bloquee')::boolean, false), v_emp)
  returning * into v_r;
  return jsonb_strip_nulls(jsonb_build_object('resultat', 'retenue', 'id', v_r.id, 'motif', v_r.motif,
                                              'source_id_reutilise', case when v_reutilise then true end));
end $$;

-- ───────────────────────────── sorties ─────────────────────────────────────
create sequence sorties_numero;

create table sorties (
  id             uuid primary key default gen_random_uuid(),
  reference      text not null unique,                 -- XAFe-WD-000207
  compte_id      uuid not null references comptes(id),
  numero_id      uuid not null references numeros(id),
  operateur      text not null,
  numero         text not null,
  montant        numeric(20,2) not null check (montant > 0),  -- XAFe débités
  frais          numeric(20,2) not null default 0,
  montant_xaf    numeric(20,2) not null,                       -- ce qui part en XAF
  montant_envoye numeric(20,2) not null default 0,
  montant_rendu  numeric(20,2) not null default 0,
  etat           text not null default 'en_attente'
                 check (etat in ('en_attente', 'en_cours', 'envoyee', 'partielle', 'echouee', 'annulee')),
  cle            text,
  cree_le        timestamptz not null default now(),
  terminee_le    timestamptz
);
create unique index sorties_cle on sorties (compte_id, cle) where cle is not null;
create index sorties_du_compte on sorties (compte_id, cree_le desc);
create index sorties_par_date on sorties (cree_le);                 -- « aujourd'hui » du tableau

-- Un transfert à composer par TOTEM. C'est le seul endroit d'où de l'argent
-- peut SORTIR : la ligne est réclamée avant d'être composée, et sa clé est
-- unique : le même transfert ne peut pas être composé deux fois.
create table commandes (
  id                  bigint generated always as identity primary key,
  terminal            text not null references terminaux(id),
  sortie_id           uuid not null references sorties(id),
  float_id            int not null references floats(id),
  type                text not null default 'transfert',
  parametres          jsonb not null,        -- operateur, float_numero, numero, montant (XAF à envoyer)
  montant_xafe        numeric(20,2) not null, -- la part des XAFe bloqués que ce transfert couvre (envoi + frais)
  frais               numeric(20,2) not null default 0,
  etat                text not null default 'en_attente' check (etat in ('en_attente', 'en_cours', 'faite', 'echouee')),
  resultat            text,
  reference_operateur text,
  reprises            int not null default 0,
  cle                 text not null unique,
  demandee_le         timestamptz not null default now(),
  reclamee_le         timestamptz,
  traitee_le          timestamptz
);
create index commandes_a_faire on commandes (terminal) where etat = 'en_attente';
create index commandes_de_la_sortie on commandes (sortie_id);

create function _sortie_json(s sorties) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'reference', s.reference, 'etat', s.etat, 'operateur', s.operateur, 'numero', s.numero,
    'montant', s.montant, 'frais', s.frais, 'montant_xaf', s.montant_xaf,
    'montant_envoye', s.montant_envoye, 'montant_rendu', s.montant_rendu,
    'transferts', (select count(*) from commandes where sortie_id = s.id),
    'cree_le', s.cree_le, 'terminee_le', s.terminee_le)
$$;

-- Ce qui est déjà sorti aujourd'hui, en XAF, pour le plafond du palier. 0002
-- y ajoute les retraits crypto : un plafond qu'on contourne par la chaîne
-- n'est pas un plafond.
create function _sorties_du_jour(p_compte uuid) returns numeric
language plpgsql stable as $$
begin
  return (select coalesce(sum(montant), 0) from sorties
           where compte_id = p_compte and cree_le >= debut_du_jour() and etat not in ('annulee', 'echouee'));
end $$;

create function demander_sortie(p_montant numeric, p_numero_id uuid, p_cle text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_compte uuid := auth.uid();
  v_s      sorties;
  v_n      numeros;
  v_op     operateurs;
  v_float  floats;
  v_taux   numeric := (parametre('frais') ->> 'sortie')::numeric;
  v_palier jsonb;
  v_jour   numeric;
  v_n_tr   int;
  v_part   numeric;
  v_reste  numeric;
  v_chunk  numeric;
  v_frais  numeric;
  v_frais_total numeric := 0;
  v_envoi_total numeric := 0;
  v_ref    text;
  i        int;
begin
  perform _exiger_compte_actif(v_compte);
  if p_cle is not null then
    select * into v_s from sorties where compte_id = v_compte and cle = p_cle;
    if found then return _sortie_json(v_s) || '{"deja": true}'; end if;
  end if;
  if p_montant is null or p_montant <= 0 or p_montant <> trunc(p_montant) then raise exception 'montant invalide'; end if;

  select * into v_n from numeros where id = p_numero_id and compte_id = v_compte and retire_le is null;
  if not found then raise exception 'numéro inconnu sur ce compte'; end if;
  if v_n.verifie_le is null then raise exception 'numéro pas encore vérifié'; end if;
  if v_n.actif_des > now() then
    raise exception 'numéro pas encore actif' using detail = format('actif à partir du %s', v_n.actif_des);
  end if;
  select * into v_op from operateurs where id = v_n.operateur;

  -- Le compte est verrouillé AVANT de compter : deux demandes lancées ensemble
  -- liraient sinon le même total, et passeraient toutes deux le plafond.
  perform 1 from comptes where id = v_compte for no key update;
  v_palier := parametre('paliers') -> (select palier::text from comptes where id = v_compte);
  if v_palier is not null and v_palier <> 'null'::jsonb then
    v_jour := _sorties_du_jour(v_compte);
    if v_jour + p_montant > (v_palier ->> 'sortie_jour')::numeric then
      raise exception 'plafond du palier atteint' using detail = format('%s XAF par jour', v_palier ->> 'sortie_jour');
    end if;
  end if;

  -- Le float qui envoie : sur cet opérateur, porté par un terminal qui a donné
  -- signe de vie depuis dix minutes, le plus récent d'abord. Clouer une sortie
  -- à un boîtier muet bloquerait les XAFe du client sans que rien ne parte.
  select f.* into v_float from floats f join terminaux t on t.id = f.terminal
   where f.operateur = v_n.operateur and f.actif and t.vu_le > now() - interval '10 minutes'
   order by t.vu_le desc, f.id limit 1;
  if not found then
    raise exception 'aucun boîtier en ligne pour cet opérateur' using detail = 'réessayez dans quelques minutes : rien n''a été débité';
  end if;

  -- Découpage : autant de transferts qu'il faut pour rester sous le plafond.
  v_n_tr := greatest(1, ceil(p_montant / v_op.plafond_par_transfert))::int;
  v_part := trunc(p_montant / v_n_tr);
  v_reste := p_montant - v_part * v_n_tr;
  for i in 1 .. v_n_tr loop
    v_chunk := v_part + (case when i = v_n_tr then v_reste else 0 end);
    v_frais := ceil(v_chunk * v_taux);
    -- un transfert à 0 XAF ne part jamais, et sa commande ne se clôt pas : on refuse avant
    if v_chunk - v_frais <= 0 then
      raise exception 'montant trop petit' using detail = 'après les frais, rien ne partirait';
    end if;
    v_frais_total := v_frais_total + v_frais;
    v_envoi_total := v_envoi_total + (v_chunk - v_frais);
  end loop;

  v_ref := 'XAFe-WD-' || lpad(nextval('sorties_numero')::text, 6, '0');
  perform _mouvement(v_compte, 'XAFe', -p_montant, p_montant, 'sortie_bloquee', 'sorties', v_ref);
  insert into sorties (reference, compte_id, numero_id, operateur, numero, montant, frais, montant_xaf, cle)
  values (v_ref, v_compte, v_n.id, v_n.operateur, v_n.numero, p_montant, v_frais_total, v_envoi_total, p_cle)
  returning * into v_s;

  for i in 1 .. v_n_tr loop
    v_chunk := v_part + (case when i = v_n_tr then v_reste else 0 end);
    v_frais := ceil(v_chunk * v_taux);
    insert into commandes (terminal, sortie_id, float_id, parametres, montant_xafe, frais, cle)
    values (v_float.terminal, v_s.id, v_float.id,
            jsonb_build_object('operateur', v_n.operateur, 'float_numero', v_float.numero,
                               'numero', v_n.numero, 'montant', v_chunk - v_frais),
            v_chunk, v_frais, v_ref || '-' || i);
  end loop;
  return _sortie_json(v_s);
end $$;

create function totem_commandes_en_attente(p_terminal text)
returns setof commandes language plpgsql security definer set search_path = public as $$
begin
  update terminaux set vu_le = now() where id = p_terminal;
  return query select * from commandes where terminal = p_terminal and etat = 'en_attente' order by id;
end $$;

create function totem_reclamer_commande(p_id bigint, p_terminal text)
returns commandes language plpgsql security definer set search_path = public as $$
declare v_c commandes;
begin
  update commandes set etat = 'en_cours', reclamee_le = now()
   where id = p_id and terminal = p_terminal and etat = 'en_attente'
  returning * into v_c;
  if not found then raise exception 'commande déjà prise ou inconnue'; end if;
  update sorties set etat = 'en_cours' where id = v_c.sortie_id and etat = 'en_attente';
  return v_c;
end $$;

-- Un résultat ne vaut que pour une commande RÉCLAMÉE, et pour la tentative
-- qu'il décrit (p_tentative = « reprises » au moment de la réclamation). Un
-- « échouée » renvoyé faute d'accusé, ou arrivé en retard pendant la tentative
-- suivante, est un doublon, pas un nouvel échec : compté comme tel, il rendait
-- les XAFe au client pendant que le transfert partait.
create function totem_resultat_commande(p_id bigint, p_terminal text, p_ok boolean, p_resultat text,
                                        p_reference_operateur text default null, p_tentative int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c     commandes;
  v_s     sorties;
  v_max   int := (parametre('sortie') ->> 'reprises_max')::int;
  v_envoi numeric;
  v_faites int;
  v_echouees int;
begin
  select * into v_c from commandes where id = p_id and terminal = p_terminal for update;
  if not found then raise exception 'commande inconnue'; end if;
  if v_c.etat <> 'en_cours' or (p_tentative is not null and p_tentative <> v_c.reprises) then
    return jsonb_build_object('commande', v_c.etat, 'deja', true);
  end if;
  select * into v_s from sorties where id = v_c.sortie_id for update;
  v_envoi := (v_c.parametres ->> 'montant')::numeric;

  if p_ok then
    update commandes set etat = 'faite', resultat = p_resultat, reference_operateur = p_reference_operateur, traitee_le = now()
     where id = p_id;
    -- Les XAF sont partis : les XAFe qui les couvraient sont détruits, les frais vont à la maison.
    perform _mouvement(v_s.compte_id, 'XAFe', 0, -v_c.montant_xafe, 'sortie_envoyee', 'commandes', p_id::text);
    if v_c.frais > 0 then
      perform _mouvement(compte_maison(), 'XAFe', v_c.frais, 0, 'frais_sortie', 'commandes', p_id::text);
    end if;
    if v_envoi > 0 then
      insert into emissions (sens, montant, source_table, source_id) values ('destruction', v_envoi, 'commandes', p_id::text);
    end if;
    update sorties set montant_envoye = montant_envoye + v_envoi where id = v_s.id;
  elsif v_c.reprises + 1 < v_max then
    update commandes set etat = 'en_attente', reprises = reprises + 1, resultat = p_resultat, reclamee_le = null
     where id = p_id;
    update sorties set etat = 'en_cours' where id = v_s.id;
    return jsonb_build_object('commande', 'en_attente', 'reprises', v_c.reprises + 1);
  else
    update commandes set etat = 'echouee', reprises = reprises + 1, resultat = p_resultat, traitee_le = now()
     where id = p_id;
    -- Rien n'est parti pour ce transfert : ses XAFe reviennent au client.
    perform _mouvement(v_s.compte_id, 'XAFe', v_c.montant_xafe, -v_c.montant_xafe, 'sortie_rendue', 'commandes', p_id::text);
    update sorties set montant_rendu = montant_rendu + v_c.montant_xafe where id = v_s.id;
  end if;

  if exists (select 1 from commandes where sortie_id = v_s.id and etat in ('en_attente', 'en_cours')) then
    update sorties set etat = 'en_cours' where id = v_s.id returning * into v_s;
  else
    select count(*) filter (where etat = 'faite'), count(*) filter (where etat = 'echouee')
      into v_faites, v_echouees from commandes where sortie_id = v_s.id;
    update sorties
       set etat = case when v_echouees = 0 then 'envoyee' when v_faites = 0 then 'echouee' else 'partielle' end,
           terminee_le = now()
     where id = v_s.id returning * into v_s;
    perform _notifier(v_s.compte_id,
      case v_s.etat when 'envoyee' then 'Sortie envoyée' when 'echouee' then 'Sortie échouée' else 'Sortie partielle' end,
      case v_s.etat when 'envoyee' then format('%s XAF envoyés au %s.', to_char(v_s.montant_envoye, 'FM999G999G999G999'), v_s.numero)
                    else format('%s XAFe sont revenus sur votre compte.', to_char(v_s.montant_rendu, 'FM999G999G999G999')) end,
      '/historique/' || v_s.reference);
  end if;
  return jsonb_build_object('commande', (select etat from commandes where id = p_id), 'sortie', v_s.etat);
end $$;

-- ───────────────────────────── crypto ──────────────────────────────────────
create table adresses_crypto (
  id        bigint generated always as identity primary key,
  compte_id uuid not null references comptes(id),
  actif     text not null check (actif in ('XAFe', 'USDT')),
  reseau    text not null check (reseau in ('bep20', 'trc20')),
  adresse   text not null,
  cree_le   timestamptz not null default now(),
  unique (compte_id, actif, reseau)
);

create table transferts_crypto (
  id        bigint generated always as identity primary key,
  compte_id uuid not null references comptes(id),
  actif     text not null check (actif in ('XAFe', 'USDT')),
  reseau    text not null,
  sens      text not null check (sens in ('entree', 'sortie')),
  montant   numeric(20,2) not null check (montant > 0),
  adresse   text,
  tx_hash   text,
  etat      text not null default 'confirme',
  cree_le   timestamptz not null default now(),
  unique (reseau, tx_hash, sens)
);

-- Le veilleur de chaîne a vu arriver de l'USDT (ou des XAFe rendus) sur l'adresse d'un compte.
create function crediter_crypto(p_compte uuid, p_actif text, p_reseau text, p_montant numeric, p_tx_hash text, p_adresse text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t transferts_crypto;
begin
  insert into transferts_crypto (compte_id, actif, reseau, sens, montant, adresse, tx_hash)
  values (p_compte, p_actif, p_reseau, 'entree', p_montant, p_adresse, p_tx_hash)
  on conflict (reseau, tx_hash, sens) do nothing
  returning * into v_t;
  if not found then return jsonb_build_object('deja', true); end if;
  perform _mouvement(p_compte, p_actif, p_montant, 0, 'crypto_entree', 'transferts_crypto', v_t.id::text);
  if p_actif = 'XAFe' then
    insert into emissions (sens, montant, source_table, source_id) values ('depuis_chaine', p_montant, 'transferts_crypto', v_t.id::text);
  end if;
  return jsonb_build_object('id', v_t.id, 'montant', v_t.montant);
end $$;

-- ───────────────────────────── carnet ──────────────────────────────────────
create sequence ordres_numero;

create table ordres (
  id         uuid primary key default gen_random_uuid(),
  numero     bigint not null default nextval('ordres_numero'),
  compte_id  uuid not null references comptes(id),
  paire      text not null default 'USDT/XAFe',
  cote       text not null check (cote in ('achat', 'vente')),
  type       text not null check (type in ('limite', 'marche')),
  prix       numeric(20,2),                         -- XAFe pour 1 USDT ; nul pour un ordre marché
  quantite   numeric(20,2) not null check (quantite > 0),   -- en USDT
  restant    numeric(20,2) not null,
  executee   numeric(20,2) not null default 0,
  total_xafe numeric(20,2) not null default 0,
  bloque     numeric(20,2) not null default 0 check (bloque >= 0),  -- XAFe (achat limite) ou USDT (vente limite) encore bloqués
  etat       text not null default 'ouvert' check (etat in ('ouvert', 'partiel', 'execute', 'annule')),
  cle        text,
  cree_le    timestamptz not null default now(),
  maj_le     timestamptz not null default now()
);
create unique index ordres_cle on ordres (compte_id, cle) where cle is not null;
create index ordres_achats on ordres (paire, prix desc, cree_le, numero) where etat in ('ouvert', 'partiel') and cote = 'achat';
create index ordres_ventes on ordres (paire, prix asc, cree_le, numero)  where etat in ('ouvert', 'partiel') and cote = 'vente';
create index ordres_du_compte on ordres (compte_id, cree_le desc);

create table executions (
  id             bigint generated always as identity primary key,
  paire          text not null,
  ordre_achat    uuid not null references ordres(id),
  ordre_vente    uuid not null references ordres(id),
  preneur        text not null check (preneur in ('achat', 'vente')),
  prix           numeric(20,2) not null,
  quantite       numeric(20,2) not null,
  montant_xafe   numeric(20,2) not null,
  frais_acheteur numeric(20,2) not null default 0,  -- en USDT
  frais_vendeur  numeric(20,2) not null default 0,  -- en XAFe
  cree_le        timestamptz not null default now()
);
create index executions_recentes on executions (paire, cree_le desc);
create index executions_par_date on executions (cree_le desc);
create index executions_achat on executions (ordre_achat);
create index executions_vente on executions (ordre_vente);

create function _ordre_json(o ordres) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', o.id, 'numero', 'ORD-' || lpad(o.numero::text, 6, '0'), 'paire', o.paire,
    'cote', o.cote, 'type', o.type, 'prix', o.prix, 'quantite', o.quantite,
    'restant', o.restant, 'executee', o.executee, 'total_xafe', o.total_xafe,
    'prix_moyen', case when o.executee > 0 then round(o.total_xafe / o.executee, 2) end,
    'bloque', o.bloque, 'etat', o.etat, 'cree_le', o.cree_le, 'maj_le', o.maj_le)
$$;

create function _execution_json(e executions) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', e.id, 'prix', e.prix, 'quantite', e.quantite, 'montant_xafe', e.montant_xafe,
                            'preneur', e.preneur, 'frais_acheteur', e.frais_acheteur, 'frais_vendeur', e.frais_vendeur,
                            'cree_le', e.cree_le)
$$;

-- Le cœur de l'appariement, pour un compte donné. placer_ordre (le client) et
-- l'achat rapide (executer_devis) l'appellent ; p_t_preneur remplace le taux
-- du preneur — l'achat rapide ne paie pas les frais du carnet, il paie la marge.
create function _placer_ordre(p_compte uuid, p_cote text, p_type text, p_quantite numeric, p_prix numeric, p_cle text, p_t_preneur numeric)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_compte  uuid := p_compte;
  v_frais   jsonb := parametre('frais');
  v_marche  jsonb := parametre('marche');
  v_paire   text := v_marche ->> 'paire';
  v_pas     numeric := (v_marche ->> 'pas_prix')::numeric;
  v_qmin    numeric := (v_marche ->> 'quantite_min')::numeric;
  v_t_pren  numeric := coalesce(p_t_preneur, (v_frais ->> 'preneur')::numeric);
  v_t_plac  numeric := (v_frais ->> 'placeur')::numeric;
  v_o       ordres;
  v_c       ordres;
  v_e       executions;
  v_q       numeric;
  v_px      numeric;
  v_xafe    numeric;
  v_fa      numeric;   -- frais de l'acheteur, en USDT
  v_fv      numeric;   -- frais du vendeur, en XAFe
  v_diff    numeric;
  v_cible   numeric;   -- ce que l'achat limite doit garder bloqué après la tranche
  v_frais_usdt numeric := 0;   -- les frais de toutes les tranches, encaissés par la maison À LA FIN
  v_frais_xafe numeric := 0;
  v_dispo   numeric;
  v_auto    boolean := false;
  v_execs   jsonb := '[]'::jsonb;
  v_achet   uuid;
  v_vend    uuid;
  v_id      text;
begin
  perform _exiger_compte_actif(v_compte);
  if not coalesce((v_marche ->> 'ouvert')::boolean, true) then raise exception 'marché fermé'; end if;
  if p_cle is not null then
    select * into v_o from ordres where compte_id = v_compte and cle = p_cle;
    if found then return jsonb_build_object('ordre', _ordre_json(v_o), 'executions', '[]'::jsonb, 'deja', true); end if;
  end if;
  if p_cote not in ('achat', 'vente') then raise exception 'côté invalide'; end if;
  if p_type not in ('limite', 'marche') then raise exception 'type invalide'; end if;
  if p_quantite is null or p_quantite < v_qmin or p_quantite <> round(p_quantite, 2) then
    raise exception 'quantité invalide' using detail = format('au moins %s USDT, deux décimales', v_qmin);
  end if;
  if p_type = 'limite' then
    if p_prix is null or p_prix <= 0 or mod(p_prix, v_pas) <> 0 then
      raise exception 'prix invalide' using detail = format('un multiple de %s', v_pas);
    end if;
  else
    p_prix := null;
  end if;

  -- Une paire s'apparie en file : un seul ordre entrant à la fois. Toute écriture
  -- au carnet (placer, annuler, l'achat rapide) prend ce même verrou ; la ligne en
  -- face se lit donc « for update » SANS « skip locked » : un chemin qui oublierait
  -- le verrou ferait ATTENDRE l'ordre, jamais sauter un meilleur prix.
  perform pg_advisory_xact_lock(hashtext(v_paire));

  insert into ordres (compte_id, paire, cote, type, prix, quantite, restant, cle)
  values (v_compte, v_paire, p_cote, p_type, p_prix, p_quantite, p_quantite, p_cle)
  returning * into v_o;
  v_id := v_o.numero::text;

  -- Tout ce qui est au carnet est déjà déposé : un ordre limite bloque avant d'être inscrit.
  if p_type = 'limite' then
    if p_cote = 'achat' then
      v_o.bloque := round(p_prix * p_quantite, 2);
      perform _mouvement(v_compte, 'XAFe', -v_o.bloque, v_o.bloque, 'ordre_bloque', 'ordres', v_id);
    else
      v_o.bloque := p_quantite;
      perform _mouvement(v_compte, 'USDT', -p_quantite, p_quantite, 'ordre_bloque', 'ordres', v_id);
    end if;
    update ordres set bloque = v_o.bloque where id = v_o.id;
  end if;

  -- Appariement prix-temps : le meilleur prix d'abord, puis le plus ancien.
  -- Le prix d'exécution est celui de l'ordre qui attendait.
  loop
    exit when v_o.restant <= 0;
    if p_cote = 'achat' then
      select * into v_c from ordres
       where paire = v_paire and cote = 'vente' and etat in ('ouvert', 'partiel') and (p_type = 'marche' or prix <= p_prix)
       order by prix asc, cree_le asc, numero asc for update limit 1;
    else
      select * into v_c from ordres
       where paire = v_paire and cote = 'achat' and etat in ('ouvert', 'partiel') and (p_type = 'marche' or prix >= p_prix)
       order by prix desc, cree_le asc, numero asc for update limit 1;
    end if;
    exit when not found;
    if v_c.compte_id = v_compte then v_auto := true; exit; end if;

    v_q := least(v_o.restant, v_c.restant);
    v_px := v_c.prix;
    -- Un acheteur au marché ne dépense que ce qu'il a.
    if p_type = 'marche' and p_cote = 'achat' then
      select disponible into v_dispo from soldes where compte_id = v_compte and actif = 'XAFe' for update;
      v_dispo := coalesce(v_dispo, 0);
      if v_dispo < round(v_q * v_px, 2) then v_q := trunc(v_dispo / v_px, 2); end if;
      exit when v_q <= 0;
    end if;

    -- Ce que paie l'acheteur. Un achat LIMITE a bloqué round(restant × limite) ;
    -- après cette tranche il doit garder exactement round(reste × limite), et
    -- tout le reste quand il n'en reste rien (v_cible). On ne soustrait jamais
    -- un arrondi de tranche d'un arrondi de total : la somme des arrondis n'est
    -- pas l'arrondi de la somme, et l'écart d'un centime finissait en bloqué
    -- négatif — « solde insuffisant » pour tout vendeur qui l'atteignait.
    --   · L'acheteur limite au repos est payé à SA limite : il donne ce que son
    --     bloqué dit (bloqué − cible), au centime près de round(q × prix).
    --   · L'acheteur limite qui prend paie round(q × prix du vendeur), jamais
    --     plus que ce que son bloqué peut donner, et récupère le reste.
    if p_cote = 'achat' and p_type = 'limite' then
      v_cible := case when v_o.restant - v_q = 0 then 0 else round((v_o.restant - v_q) * p_prix, 2) end;
      v_xafe := case when v_px = p_prix then v_o.bloque - v_cible
                     else least(round(v_q * v_px, 2), v_o.bloque - v_cible) end;
    elsif p_cote = 'vente' then
      v_cible := case when v_c.restant - v_q = 0 then 0 else round((v_c.restant - v_q) * v_c.prix, 2) end;
      v_xafe := v_c.bloque - v_cible;
    else
      v_xafe := round(v_q * v_px, 2);
    end if;

    if p_cote = 'achat' then
      v_achet := v_compte; v_vend := v_c.compte_id;
      v_fa := round(v_q * v_t_pren, 2);  v_fv := round(v_xafe * v_t_plac, 0);
    else
      v_achet := v_c.compte_id; v_vend := v_compte;
      v_fa := round(v_q * v_t_plac, 2);  v_fv := round(v_xafe * v_t_pren, 0);
    end if;

    -- L'acheteur paie v_xafe (de son bloqué s'il est limite, de son disponible au marché) et reçoit v_q moins ses frais.
    if (p_cote = 'achat' and p_type = 'limite') or p_cote = 'vente' then
      perform _mouvement(v_achet, 'XAFe', 0, -v_xafe, 'achat_regle', 'ordres', v_id);
    else
      perform _mouvement(v_achet, 'XAFe', -v_xafe, 0, 'achat_regle', 'ordres', v_id);
    end if;
    perform _mouvement(v_achet, 'USDT', v_q - v_fa, 0, 'achat_recu', 'ordres', v_id);
    -- Le vendeur donne v_q (de son bloqué s'il est limite) et reçoit v_xafe moins ses frais.
    if (p_cote = 'vente' and p_type = 'limite') or p_cote = 'achat' then
      perform _mouvement(v_vend, 'USDT', 0, -v_q, 'vente_reglee', 'ordres', v_id);
    else
      perform _mouvement(v_vend, 'USDT', -v_q, 0, 'vente_reglee', 'ordres', v_id);
    end if;
    perform _mouvement(v_vend, 'XAFe', v_xafe - v_fv, 0, 'vente_recue', 'ordres', v_id);
    v_frais_usdt := v_frais_usdt + v_fa;
    v_frais_xafe := v_frais_xafe + v_fv;

    -- L'acheteur limite qui prend : ce que son bloqué gardait au-delà de la cible et du prix payé lui revient.
    if p_cote = 'achat' and p_type = 'limite' then
      v_diff := v_o.bloque - v_cible - v_xafe;
      if v_diff > 0 then
        perform _mouvement(v_compte, 'XAFe', v_diff, -v_diff, 'ordre_libere', 'ordres', v_id);
      end if;
      v_o.bloque := v_cible;
    elsif p_type = 'limite' then
      v_o.bloque := v_o.bloque - v_q;
    end if;

    v_o.restant := v_o.restant - v_q;
    v_o.executee := v_o.executee + v_q;
    v_o.total_xafe := v_o.total_xafe + v_xafe;
    update ordres
       set restant = v_o.restant, executee = v_o.executee, total_xafe = v_o.total_xafe, bloque = v_o.bloque,
           etat = case when v_o.restant = 0 then 'execute' else 'partiel' end, maj_le = now()
     where id = v_o.id;
    update ordres
       set restant = restant - v_q, executee = executee + v_q, total_xafe = total_xafe + v_xafe,
           bloque = case when cote = 'achat' then v_cible else bloque - v_q end,
           etat = case when restant - v_q = 0 then 'execute' else 'partiel' end, maj_le = now()
     where id = v_c.id;
    if v_c.restant - v_q = 0 then
      perform _notifier(v_c.compte_id, 'Ordre exécuté',
        format('%s de %s USDT à %s.', case when v_c.cote = 'achat' then 'Achat' else 'Vente' end, v_c.quantite, v_px), '/marche/ordres/' || v_c.id);
    end if;

    insert into executions (paire, ordre_achat, ordre_vente, preneur, prix, quantite, montant_xafe, frais_acheteur, frais_vendeur)
    values (v_paire,
            case when p_cote = 'achat' then v_o.id else v_c.id end,
            case when p_cote = 'achat' then v_c.id else v_o.id end,
            p_cote, v_px, v_q, v_xafe, v_fa, v_fv)
    returning * into v_e;
    v_execs := v_execs || _execution_json(v_e);
  end loop;

  -- La maison en dernier : voir « l'ordre des verrous », au-dessus de _mouvement.
  if v_frais_usdt > 0 then perform _mouvement(compte_maison(), 'USDT', v_frais_usdt, 0, 'frais_achat', 'ordres', v_id); end if;
  if v_frais_xafe > 0 then perform _mouvement(compte_maison(), 'XAFe', v_frais_xafe, 0, 'frais_vente', 'ordres', v_id); end if;

  -- Ce qui reste d'un ordre marché, ou d'un ordre arrêté par l'auto-négociation, est annulé.
  if v_o.restant > 0 and (p_type = 'marche' or v_auto) then
    if p_type = 'limite' and v_o.bloque > 0 then
      if p_cote = 'achat' then
        perform _mouvement(v_compte, 'XAFe', v_o.bloque, -v_o.bloque, 'ordre_libere', 'ordres', v_id);
      else
        perform _mouvement(v_compte, 'USDT', v_o.bloque, -v_o.bloque, 'ordre_libere', 'ordres', v_id);
      end if;
    end if;
    update ordres
       set etat = case when v_o.executee > 0 then 'execute' else 'annule' end, restant = 0, bloque = 0, maj_le = now()
     where id = v_o.id;
  end if;

  select * into v_o from ordres where id = v_o.id;
  return jsonb_build_object('ordre', _ordre_json(v_o), 'executions', v_execs, 'auto_negociation', v_auto);
end $$;

create function placer_ordre(p_cote text, p_type text, p_quantite numeric, p_prix numeric default null, p_cle text default null)
returns jsonb language sql security definer set search_path = public as $$
  select _placer_ordre(auth.uid(), p_cote, p_type, p_quantite, p_prix, p_cle, null)
$$;

create function annuler_ordre(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_o ordres;
begin
  perform pg_advisory_xact_lock(hashtext((parametre('marche') ->> 'paire')));
  select * into v_o from ordres where id = p_id and compte_id = auth.uid() for update;
  if not found then raise exception 'ordre inconnu'; end if;
  if v_o.etat not in ('ouvert', 'partiel') then raise exception 'cet ordre ne peut plus être annulé' using detail = v_o.etat; end if;
  if v_o.bloque > 0 then
    if v_o.cote = 'achat' then
      perform _mouvement(v_o.compte_id, 'XAFe', v_o.bloque, -v_o.bloque, 'ordre_libere', 'ordres', v_o.numero::text);
    else
      perform _mouvement(v_o.compte_id, 'USDT', v_o.bloque, -v_o.bloque, 'ordre_libere', 'ordres', v_o.numero::text);
    end if;
  end if;
  update ordres set etat = 'annule', restant = 0, bloque = 0, maj_le = now() where id = v_o.id returning * into v_o;
  return _ordre_json(v_o);
end $$;

-- ─────────────────────────────── l'achat rapide ──────────────────────────────
-- « Acheter des USDT » en un geste : le client donne un montant, voit un prix
-- FERME pendant quelques secondes, confirme. La plateforme n'a pas de stock :
-- elle prend au carnet, pour lui, les USDT que d'autres clients vendent (ou y
-- vend les siens), et gagne sa marge, plus forte que les frais du carnet.
--   · le devis parcourt le carnet avec LES MÊMES arrondis que l'appariement ;
--   · l'exécution le rejoue sous le verrou de la paire : si le carnet a bougé
--     contre le client, elle refuse (« le prix a changé ») ; s'il a bougé pour
--     lui, le prix promis tient et l'écart revient à la plateforme ;
--   · tout ou rien : un devis à moitié servi ne se signe pas.
create table devis_rapides (
  id          uuid primary key default gen_random_uuid(),
  compte_id   uuid not null references comptes(id),
  sens        text not null check (sens in ('achat', 'vente')),
  quantite    numeric(20,2) not null check (quantite > 0),      -- USDT reçus (achat) ou donnés (vente)
  cout        numeric(20,2) not null check (cout > 0),          -- ce que le carnet coûte (achat) ou rend (vente)
  total       numeric(20,2) not null check (total > 0),         -- ce que le client paie (achat) ou reçoit (vente)
  marge       numeric not null,
  etat        text not null default 'propose' check (etat in ('propose', 'execute')),
  ordre_id    uuid references ordres(id),
  cree_le     timestamptz not null default now(),
  expire_le   timestamptz not null,
  execute_le  timestamptz
);
create index devis_rapides_du_compte on devis_rapides (compte_id, cree_le desc);
create unique index devis_rapides_ordre on devis_rapides (ordre_id) where ordre_id is not null;
alter table devis_rapides enable row level security;

-- Un ordre passé par l'achat rapide porte ce que le client a VRAIMENT payé (ou
-- reçu), marge comprise : l'historique ne montre pas le seul coût du carnet.
create or replace function _ordre_json(o ordres) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', o.id, 'numero', 'ORD-' || lpad(o.numero::text, 6, '0'), 'paire', o.paire,
    'cote', o.cote, 'type', o.type, 'prix', o.prix, 'quantite', o.quantite,
    'restant', o.restant, 'executee', o.executee, 'total_xafe', o.total_xafe,
    'prix_moyen', case when o.executee > 0 then round(o.total_xafe / o.executee, 2) end,
    'bloque', o.bloque, 'etat', o.etat, 'cree_le', o.cree_le, 'maj_le', o.maj_le,
    'rapide', (select jsonb_build_object('total', d.total, 'frais', abs(d.total - d.cout)) from devis_rapides d where d.ordre_id = o.id))
$$;

-- Le carnet, parcouru sans rien écrire, comme l'appariement le prendrait pour
-- ce compte (il s'arrête sur un ordre du compte lui-même, comme l'appariement).
-- Achat : par budget en XAFe (p_budget) ou par quantité ; vente : par quantité.
create function _parcourir_carnet(p_compte uuid, p_sens text, p_quantite numeric, p_budget numeric,
                                  out quantite numeric, out montant numeric)
language plpgsql stable set search_path = public as $$
declare
  v_paire text := parametre('marche') ->> 'paire';
  v_c ordres; v_q numeric; v_x numeric; v_cible numeric;
begin
  quantite := 0; montant := 0;
  for v_c in
    select * from ordres
     where paire = v_paire and etat in ('ouvert', 'partiel')
       and cote = case when p_sens = 'achat' then 'vente' else 'achat' end
     order by case when p_sens = 'achat' then prix else -prix end, cree_le, numero
  loop
    exit when v_c.compte_id = p_compte;
    if p_budget is not null then
      v_q := least(v_c.restant, trunc((p_budget - montant) / v_c.prix, 2));
    else
      v_q := least(v_c.restant, p_quantite - quantite);
    end if;
    exit when v_q <= 0;
    if p_sens = 'achat' then
      v_x := round(v_q * v_c.prix, 2);
    else
      v_cible := case when v_c.restant - v_q = 0 then 0 else round((v_c.restant - v_q) * v_c.prix, 2) end;
      v_x := v_c.bloque - v_cible;
    end if;
    quantite := quantite + v_q;
    montant := montant + v_x;
  end loop;
end $$;

-- Le devis. Achat : p_montant est ce que le client veut payer, en XAFe ; vente :
-- ce qu'il vend, en USDT. p_ferme = false : une estimation, rien n'est écrit
-- (l'écran la montre pendant qu'on tape) ; true : un devis ferme, à confirmer.
create function devis_rapide(p_sens text, p_montant numeric, p_ferme boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_compte uuid := auth.uid();
  v_r      jsonb := parametre('rapide');
  v_m      numeric := (v_r ->> 'marge')::numeric;
  v_qmin   numeric := (parametre('marche') ->> 'quantite_min')::numeric;
  v_q      numeric; v_cout numeric; v_total numeric;
  v_d      devis_rapides;
begin
  perform _exiger_compte_actif(v_compte);
  if not coalesce((parametre('marche') ->> 'ouvert')::boolean, true) then raise exception 'marché fermé'; end if;
  if not coalesce((v_r ->> 'ouvert')::boolean, false) then raise exception 'achat rapide fermé'; end if;
  if p_sens not in ('achat', 'vente') then raise exception 'côté invalide'; end if;
  if p_montant is null or p_montant <= 0 or p_montant <> round(p_montant, 2) then raise exception 'montant invalide'; end if;

  if p_sens = 'achat' then
    select quantite, montant into v_q, v_cout
      from _parcourir_carnet(v_compte, 'achat', null, trunc(p_montant / (1 + v_m), 2));
    if v_q < v_qmin then
      raise exception 'pas assez de vendeurs au carnet' using detail = format('au moins %s USDT, et des offres pour les servir', v_qmin);
    end if;
    v_total := ceil(v_cout * (1 + v_m) * 100) / 100;           -- ce que le client paie, marge comprise
  else
    if p_montant < v_qmin then raise exception 'quantité invalide' using detail = format('au moins %s USDT', v_qmin); end if;
    select quantite, montant into v_q, v_cout from _parcourir_carnet(v_compte, 'vente', p_montant, null);
    if v_q < p_montant then
      raise exception 'pas assez d''acheteurs au carnet' using detail = format('le carnet n''en prend que %s USDT', v_q);
    end if;
    v_total := floor(v_cout * (1 - v_m) * 100) / 100;          -- ce que le client reçoit, marge déduite
  end if;

  if not p_ferme then
    return jsonb_build_object('sens', p_sens, 'quantite', v_q, 'total', v_total, 'prix', round(v_total / v_q, 2),
                              'frais', abs(v_total - v_cout), 'marge', v_m);
  end if;
  insert into devis_rapides (compte_id, sens, quantite, cout, total, marge, expire_le)
  values (v_compte, p_sens, v_q, v_cout, v_total, v_m,
          now() + make_interval(secs => coalesce((v_r ->> 'validite_secondes')::int, 20)))
  returning * into v_d;
  return _devis_json(v_d);
end $$;

create function _devis_json(d devis_rapides) returns jsonb language sql stable as $$
  select jsonb_build_object('id', d.id, 'sens', d.sens, 'quantite', d.quantite, 'total', d.total,
                            'prix', round(d.total / d.quantite, 2), 'frais', abs(d.total - d.cout), 'marge', d.marge,
                            'etat', d.etat, 'expire_le', d.expire_le, 'execute_le', d.execute_le,
                            'ordre', (select numero from ordres where id = d.ordre_id))
$$;

-- Signer le devis. Rejoué : la même réponse (deja). Expiré, ou le carnet a
-- bougé contre le client : refusé, rien n'a bougé.
create function executer_devis(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_compte uuid := auth.uid();
  v_d      devis_rapides;
  v_q      numeric; v_cout numeric; v_dispo numeric; v_frais numeric;
  v_r      jsonb; v_o jsonb;
begin
  perform _exiger_compte_actif(v_compte);
  -- le même verrou que placer et annuler : personne ne touche au carnet pendant qu'on rejoue
  perform pg_advisory_xact_lock(hashtext(parametre('marche') ->> 'paire'));
  select * into v_d from devis_rapides where id = p_id and compte_id = v_compte for update;
  if not found then raise exception 'devis inconnu'; end if;
  if v_d.etat = 'execute' then return _devis_json(v_d) || '{"deja": true}'; end if;
  if v_d.expire_le < now() then raise exception 'devis expiré' using detail = 'demandez un nouveau prix'; end if;

  select quantite, montant into v_q, v_cout from _parcourir_carnet(v_compte, v_d.sens, v_d.quantite, null);
  if v_q < v_d.quantite
     or (v_d.sens = 'achat' and v_cout > v_d.cout)
     or (v_d.sens = 'vente' and v_cout < v_d.cout) then
    raise exception 'le prix a changé' using detail = 'le carnet a bougé : demandez un nouveau prix';
  end if;

  if v_d.sens = 'achat' then
    select disponible into v_dispo from soldes where compte_id = v_compte and actif = 'XAFe';
    if coalesce(v_dispo, 0) < v_d.total then raise exception 'solde insuffisant' using detail = format('%s XAFe disponibles', coalesce(v_dispo, 0)); end if;
  else
    select disponible into v_dispo from soldes where compte_id = v_compte and actif = 'USDT';
    if coalesce(v_dispo, 0) < v_d.quantite then raise exception 'solde insuffisant' using detail = format('%s USDT disponibles', coalesce(v_dispo, 0)); end if;
  end if;

  -- Au carnet, comme un ordre au marché, sans les frais du preneur.
  v_r := _placer_ordre(v_compte, v_d.sens, 'marche', v_d.quantite, null, 'rapide-' || v_d.id::text, 0);
  v_o := v_r -> 'ordre';
  if (v_o ->> 'executee')::numeric <> v_d.quantite then
    raise exception 'le prix a changé' using detail = 'le carnet n''a pas tout servi : rien n''a bougé';
  end if;
  -- La marge : la différence entre le prix promis et ce que le carnet a coûté
  -- (ou rendu). Le compte du client est déjà verrouillé par l'appariement ; la
  -- maison vient en dernier (voir « l'ordre des verrous »).
  v_frais := case when v_d.sens = 'achat' then v_d.total - (v_o ->> 'total_xafe')::numeric
                  else (v_o ->> 'total_xafe')::numeric - v_d.total end;
  if v_frais > 0 then
    perform _mouvement(v_compte, 'XAFe', -v_frais, 0, 'frais_rapide', 'devis_rapides', v_d.id::text);
    perform _mouvement(compte_maison(), 'XAFe', v_frais, 0, 'frais_rapide', 'devis_rapides', v_d.id::text);
  end if;
  update devis_rapides set etat = 'execute', ordre_id = (v_o ->> 'id')::uuid, execute_le = now()
   where id = v_d.id returning * into v_d;
  return _devis_json(v_d);
end $$;

-- Le carnet, par niveau de prix.
create function carnet(p_profondeur int default 20) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'achats', (select coalesce(jsonb_agg(jsonb_build_object('prix', prix, 'quantite', q, 'ordres', n) order by prix desc), '[]'::jsonb)
                 from (select prix, sum(restant) q, count(*) n from ordres
                        where etat in ('ouvert', 'partiel') and cote = 'achat' group by prix order by prix desc limit p_profondeur) a),
    'ventes', (select coalesce(jsonb_agg(jsonb_build_object('prix', prix, 'quantite', q, 'ordres', n) order by prix asc), '[]'::jsonb)
                 from (select prix, sum(restant) q, count(*) n from ordres
                        where etat in ('ouvert', 'partiel') and cote = 'vente' group by prix order by prix asc limit p_profondeur) v),
    'dernier', (select prix from executions order by cree_le desc, id desc limit 1))
$$;

create function transactions_recentes(p_n int default 50) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('prix', prix, 'quantite', quantite, 'preneur', preneur, 'cree_le', cree_le)
                            order by cree_le desc, id desc), '[]'::jsonb)
    from (select * from executions order by cree_le desc, id desc limit p_n) e
$$;

create function cotation() returns jsonb
language sql stable security definer set search_path = public as $$
  with e as (select * from executions where cree_le > now() - interval '24 hours'),
       d as (select prix from executions order by cree_le desc, id desc limit 1),
       p as (select prix from executions where cree_le <= now() - interval '24 hours' order by cree_le desc, id desc limit 1)
  select jsonb_build_object(
    'paire', parametre('marche') ->> 'paire',
    'dernier', (select prix from d),
    'il_y_a_24h', (select prix from p),
    'haut', (select max(prix) from e), 'bas', (select min(prix) from e),
    'volume_usdt', (select coalesce(sum(quantite), 0) from e),
    'volume_xafe', (select coalesce(sum(montant_xafe), 0) from e),
    'meilleur_achat', (select max(prix) from ordres where etat in ('ouvert', 'partiel') and cote = 'achat'),
    'meilleure_vente', (select min(prix) from ordres where etat in ('ouvert', 'partiel') and cote = 'vente'))
$$;

-- ───────────────────────── ce que le client lit ────────────────────────────
create function mes_soldes() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(actif, jsonb_build_object('disponible', disponible, 'bloque', bloque)), '{}'::jsonb)
    from soldes where compte_id = auth.uid()
$$;

-- ───────────────────────────── droits ──────────────────────────────────────
alter table parametres        enable row level security;
alter table operateurs        enable row level security;
alter table terminaux         enable row level security;
alter table floats            enable row level security;
alter table comptes           enable row level security;
alter table numeros           enable row level security;
alter table soldes            enable row level security;
alter table ecritures         enable row level security;
alter table emissions         enable row level security;
alter table depots            enable row level security;
alter table depot_paiements   enable row level security;
alter table depot_declarations enable row level security;
alter table notifications     enable row level security;
alter table entrees_retenues  enable row level security;
alter table sorties           enable row level security;
alter table commandes         enable row level security;
alter table adresses_crypto   enable row level security;
alter table transferts_crypto enable row level security;
alter table ordres            enable row level security;
alter table executions        enable row level security;

-- Le client lit ses lignes ; il n'écrit jamais directement.
create policy lire_parametres on parametres for select to authenticated using (true);
create policy lire_operateurs on operateurs for select to authenticated using (true);
create policy lire_mon_compte on comptes for select to authenticated using (id = auth.uid());
create policy lire_mes_numeros on numeros for select to authenticated using (compte_id = auth.uid());
create policy lire_mes_soldes on soldes for select to authenticated using (compte_id = auth.uid());
create policy lire_mes_ecritures on ecritures for select to authenticated using (compte_id = auth.uid());
create policy lire_mes_depots on depots for select to authenticated using (compte_id = auth.uid());
create policy lire_mes_depot_paiements on depot_paiements for select to authenticated
  using (depot_id in (select id from depots where compte_id = auth.uid()));
create policy lire_mes_declarations on depot_declarations for select to authenticated using (compte_id = auth.uid());
create policy lire_mes_notifications on notifications for select to authenticated using (compte_id = auth.uid());
create policy lire_mes_sorties on sorties for select to authenticated using (compte_id = auth.uid());
create policy lire_mes_adresses on adresses_crypto for select to authenticated using (compte_id = auth.uid());
create policy lire_mes_transferts on transferts_crypto for select to authenticated using (compte_id = auth.uid());
create policy lire_mes_ordres on ordres for select to authenticated using (compte_id = auth.uid());
create policy lire_mes_executions on executions for select to authenticated
  using (ordre_achat in (select id from ordres where compte_id = auth.uid())
      or ordre_vente in (select id from ordres where compte_id = auth.uid()));

-- Les GRANT (qui lit quelle table, qui exécute quelle fonction) sont tous dans
-- 0004_droits.sql : une seule liste, que le harnais compare à ce qui est ouvert.
$sql$;
    raise notice '0001_socle.sql : appliquée';
  end if;
end $consolide$;

-- ─── 0002_compte_et_lectures.sql (md5 2f4397914ac80c3916bfdca4e2fff824) ───
-- déjà en place si : la table des retraits crypto
do $consolide$
begin
  if to_regclass('public.retraits_crypto') is not null then
    raise notice '0002_compte_et_lectures.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  XAFe Exchange · 0002 · le compte et ce que l'application lit         ║
-- ║  Profil et code secret, numéros vérifiés par SMS, retraits crypto,    ║
-- ║  chandelles, historique — tout ce que app/src/guichet/supabase.ts     ║
-- ║  appelle. Une règle d'argent vit ici, pas dans l'écran.               ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ───────────────────────────── le compte ───────────────────────────────────
alter table comptes
  add column entreprise            text,
  add column code_echecs           int not null default 0,
  add column code_verrou_jusqua    timestamptz,
  add column verification_en_cours text check (verification_en_cours in ('identite', 'entreprise')),
  add column verification_pieces   jsonb;
create index comptes_verifications on comptes (verification_en_cours) where verification_en_cours is not null;

-- L'empreinte du code secret vit À PART, dans une table qu'aucun client ne lit
-- (RLS sans politique, aucun GRANT) : dans « comptes », le titulaire la lisait
-- par l'API et le temps réel, et cassait hors ligne dix mille codes à quatre
-- chiffres sans jamais toucher au verrou des trois essais.
create table codes_secrets (
  compte_id uuid primary key references comptes(id),
  empreinte text not null,
  maj_le    timestamptz not null default now()
);
alter table codes_secrets enable row level security;

insert into parametres (cle, valeur) values
  ('code_secret', '{"essais": 3, "verrou_minutes": 15, "longueur_min": 4, "longueur_max": 6}'),
  -- Les retraits crypto restent FERMÉS tant qu'aucun veilleur de chaîne ne les
  -- envoie : sinon l'argent se bloque sans que rien ne parte.
  ('crypto', '{"frais": {"USDT": 1, "XAFe": 500}, "confirmations": {"bep20": 15, "trc20": 20}, "retraits_ouverts": false}');

-- L'opérateur qu'un numéro camerounais laisse deviner, d'après son préfixe.
create function operateur_du_numero(p text) returns text language sql immutable as $$
  select case
    when left(normaliser_numero(p), 3)::int between 650 and 654 or left(normaliser_numero(p), 3)::int between 670 and 689 then 'mtn'
    when left(normaliser_numero(p), 3)::int between 655 and 659 or left(normaliser_numero(p), 3)::int between 690 and 699 then 'om'
  end
$$;

-- Un compte naît avec son utilisateur Supabase : le téléphone de connexion,
-- prouvé par l'OTP, est son premier numéro — actif tout de suite. Un
-- utilisateur SANS téléphone (un administrateur, qui entre par e-mail) n'est
-- pas un client : pas de compte. Et rien ici ne doit faire échouer
-- l'inscription — un téléphone déjà connu, un numéro déjà vérifié ailleurs —
-- sinon Supabase répond « Database error saving new user », sans rien dire.
--
-- Et pas avant que le téléphone soit PROUVÉ : GoTrue crée la ligne auth.users
-- dès qu'on DEMANDE un code, puis pose phone_confirmed_at quand le bon code
-- revient. Le numéro « vérifié » naissait sur une simple demande.
create function handle_nouvel_utilisateur() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_num text := nullif(normaliser_numero(new.phone), '');
begin
  if v_num is null or new.phone_confirmed_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.phone_confirmed_at is not null then return new; end if;
  insert into comptes (id, telephone) values (new.id, v_num) on conflict do nothing;
  if found and length(v_num) = 9 and operateur_du_numero(v_num) is not null then
    insert into numeros (compte_id, operateur, numero, verifie_le, actif_des)
    values (new.id, operateur_du_numero(v_num), v_num, now(), now())
    on conflict do nothing;
  end if;
  return new;
end $$;

do $$
begin
  if to_regclass('auth.users') is not null then
    execute 'create trigger comptes_naissance after insert or update of phone_confirmed_at on auth.users for each row execute function public.handle_nouvel_utilisateur()';
  end if;
end $$;

create function _compte_json(c comptes) returns jsonb language sql stable as $$
  select jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'entreprise', c.entreprise, 'palier', c.palier,
                            'a_code', exists (select 1 from codes_secrets k where k.compte_id = c.id), 'verrou_jusqua', c.code_verrou_jusqua,
                            'verification_en_cours', c.verification_en_cours,
                            -- ce qui est déjà entré aujourd'hui : l'écran montre ce qui RESTE du plafond, pas le plafond
                            'entre_du_jour', (select coalesce(sum(montant), 0) from depot_declarations
                                               where compte_id = c.id and etat = 'credite' and credite_le >= debut_du_jour()))
$$;

create function mon_compte() returns jsonb
language sql stable security definer set search_path = public as $$
  select _compte_json(c) from comptes c where c.id = auth.uid()
$$;

-- Le contrôle du code secret, et son compteur. Il ÉCRIT (échecs, verrou) et
-- ne lève jamais : une fonction qui lève annule son écriture, et un essai
-- raté ne compterait pas. Les appelants rendent {"erreur": …} plutôt que de
-- lever, pour la même raison.
create function _controler_code(p_compte uuid, p_code text) returns jsonb
language plpgsql as $$
declare
  v_c       comptes;
  v_hash    text;
  v_essais  int := (parametre('code_secret') ->> 'essais')::int;
  v_minutes int := (parametre('code_secret') ->> 'verrou_minutes')::int;
begin
  select * into v_c from comptes where id = p_compte for no key update;
  if not found then return jsonb_build_object('ok', false, 'erreur', 'non connecté'); end if;
  if v_c.code_verrou_jusqua is not null and v_c.code_verrou_jusqua > now() then
    return jsonb_build_object('ok', false, 'erreur', 'compte verrouillé', 'essais_restants', 0, 'verrou_jusqua', v_c.code_verrou_jusqua);
  end if;
  select empreinte into v_hash from codes_secrets where compte_id = p_compte;
  if v_hash is null or p_code is null or extensions.crypt(p_code, v_hash) <> v_hash then
    if v_c.code_echecs + 1 >= v_essais then
      update comptes set code_echecs = 0, code_verrou_jusqua = now() + make_interval(mins => v_minutes) where id = p_compte;
      return jsonb_build_object('ok', false, 'erreur', 'compte verrouillé', 'essais_restants', 0, 'verrou_jusqua', now() + make_interval(mins => v_minutes));
    end if;
    update comptes set code_echecs = code_echecs + 1 where id = p_compte;
    return jsonb_build_object('ok', false, 'erreur', 'code secret incorrect', 'essais_restants', v_essais - v_c.code_echecs - 1, 'verrou_jusqua', null);
  end if;
  update comptes set code_echecs = 0, code_verrou_jusqua = null where id = p_compte;
  return jsonb_build_object('ok', true);
end $$;

create function verifier_code_secret(p_code text) returns jsonb
language sql security definer set search_path = public as $$
  select _controler_code(auth.uid(), p_code)
$$;

-- Le profil se complète UNE fois : le premier code secret se choisit ici, sans
-- l'ancien puisqu'il n'y en a pas. Ensuite, seul changer_code_secret le
-- change — avec l'ancien. Sinon trois codes faux, puis completer_profil, et
-- le verrou des trois essais ne verrouillait plus rien.
create function completer_profil(p_nom text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c comptes; v_min int := (parametre('code_secret') ->> 'longueur_min')::int; v_max int := (parametre('code_secret') ->> 'longueur_max')::int;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  perform 1 from comptes where id = auth.uid() for no key update;
  if not found then raise exception 'non connecté'; end if;
  if exists (select 1 from codes_secrets where compte_id = auth.uid()) then
    raise exception 'code secret déjà choisi' using detail = 'il se change depuis le compte, avec l''ancien';
  end if;
  if length(trim(coalesce(p_nom, ''))) < 2 then raise exception 'nom manquant'; end if;
  if coalesce(p_code, '') !~ ('^[0-9]{' || v_min || ',' || v_max || '}$') then raise exception 'code secret invalide' using detail = format('%s à %s chiffres', v_min, v_max); end if;
  insert into codes_secrets (compte_id, empreinte) values (auth.uid(), extensions.crypt(p_code, extensions.gen_salt('bf', 10)));
  update comptes set nom = trim(p_nom), code_echecs = 0, code_verrou_jusqua = null
   where id = auth.uid() returning * into v_c;
  return _compte_json(v_c);
end $$;

create function changer_code_secret(p_ancien text, p_nouveau text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_min int := (parametre('code_secret') ->> 'longueur_min')::int; v_max int := (parametre('code_secret') ->> 'longueur_max')::int;
begin
  v := _controler_code(auth.uid(), p_ancien);
  if not (v ->> 'ok')::boolean then return v; end if;
  if coalesce(p_nouveau, '') !~ ('^[0-9]{' || v_min || ',' || v_max || '}$') then raise exception 'code secret invalide'; end if;
  update codes_secrets set empreinte = extensions.crypt(p_nouveau, extensions.gen_salt('bf', 10)), maj_le = now() where compte_id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

-- Les pièces d'un passage de palier : des chemins dans le stockage, que l'équipe examine.
create function demander_verification(p_type text, p_pieces jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c comptes;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  if p_type not in ('identite', 'entreprise') then raise exception 'type de vérification inconnu'; end if;
  if jsonb_typeof(p_pieces) <> 'array' or jsonb_array_length(p_pieces) = 0 then raise exception 'aucune pièce jointe'; end if;
  if jsonb_array_length(p_pieces) > 10 then raise exception 'trop de pièces' using detail = 'dix au plus'; end if;
  -- Une pièce est un fichier du dossier de CE compte dans le stockage, rien d'autre :
  -- le chemin d'un autre client ferait voir ses papiers à l'équipe comme les siens.
  if exists (select 1 from jsonb_array_elements(p_pieces) e
              where jsonb_typeof(e) <> 'string'
                 or left(e #>> '{}', 37) <> auth.uid()::text || '/'
                 or (e #>> '{}') ~ '\.\.' or length(e #>> '{}') > 300) then
    raise exception 'pièce invalide' using detail = 'une pièce se dépose dans le dossier du compte';
  end if;
  update comptes set verification_en_cours = p_type, verification_pieces = p_pieces where id = auth.uid() returning * into v_c;
  perform _notifier(auth.uid(), 'Pièces reçues', 'L''équipe vérifie votre dossier, en général sous 24 h ouvrées.', '/compte/paliers');
  return _compte_json(v_c);
end $$;

-- ─────────────────────────── notifications ─────────────────────────────────
create function mes_notifications() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'titre', titre, 'texte', texte, 'cible', cible, 'cree_le', cree_le, 'lue_le', lue_le) order by cree_le desc), '[]'::jsonb)
    from (select * from notifications where compte_id = auth.uid() order by cree_le desc limit 100) n
$$;

create function marquer_notifications_lues() returns void
language sql security definer set search_path = public as $$
  update notifications set lue_le = now() where compte_id = auth.uid() and lue_le is null
$$;

-- ─────────────────────────────── numéros ───────────────────────────────────
-- Le code SMS qui prouve un numéro : son empreinte vit à part, comme celle du
-- code secret, hors de portée du titulaire — qui est justement la personne
-- que ce code doit mettre en échec quand le numéro n'est pas le sien.
create table numeros_codes (
  numero_id uuid primary key references numeros(id),
  empreinte text not null,
  expire_le timestamptz not null,
  essais    int not null default 0,
  envoye_le timestamptz not null default now()
);
alter table numeros_codes enable row level security;

-- Les SMS que TOTEM doit ENVOYER : le code qui prouve qu'un numéro est à son
-- propriétaire. Même guichet que les transferts : relever, réclamer, rendre compte.
create table messages_sortants (
  id        bigint generated always as identity primary key,
  terminal  text references terminaux(id),
  operateur text not null references operateurs(id),
  numero    text not null,
  texte     text not null,
  etat      text not null default 'en_attente' check (etat in ('en_attente', 'en_cours', 'envoye', 'echoue')),
  cle       text not null unique,
  cree_le   timestamptz not null default now(),
  expire_le timestamptz,                       -- un code périmé ne part plus
  traite_le timestamptz
);
alter table messages_sortants enable row level security;
create index messages_sortants_par_numero on messages_sortants (numero, cree_le desc);

create function _numero_json(n numeros) returns jsonb language sql stable as $$
  select jsonb_build_object('id', n.id, 'operateur', n.operateur, 'numero', n.numero, 'verifie_le', n.verifie_le,
                            'actif_des', n.actif_des, 'retire_le', n.retire_le)
$$;

create function mes_numeros() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(_numero_json(n) order by n.verifie_le nulls last, n.id), '[]'::jsonb)
    from numeros n where n.compte_id = auth.uid() and n.retire_le is null
$$;

-- Un nouveau code pour une ligne pas encore vérifiée, et son SMS. Cadence
-- bornée : une minute entre deux envois, cinq par numéro et par heure — chaque
-- appel fait partir un vrai SMS d'une de nos cartes.
create function _envoyer_code_numero(p_n numeros) returns void
language plpgsql as $$
declare
  v_code  text := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_float floats;
begin
  if exists (select 1 from numeros_codes where numero_id = p_n.id and envoye_le > now() - interval '1 minute') then
    raise exception 'un code vient de partir' using detail = 'attendez une minute avant d''en demander un autre';
  end if;
  if (select count(*) from messages_sortants where numero = p_n.numero and cree_le > now() - interval '1 hour') >= 5 then
    raise exception 'trop de codes demandés pour ce numéro' using detail = 'réessayez dans une heure';
  end if;
  insert into numeros_codes (numero_id, empreinte, expire_le)
  values (p_n.id, extensions.crypt(v_code, extensions.gen_salt('bf', 8)), now() + interval '10 minutes')
  on conflict (numero_id) do update set empreinte = excluded.empreinte, expire_le = excluded.expire_le, essais = 0, envoye_le = now();
  -- le SMS part d'un float de cet opérateur, par TOTEM
  select f.* into v_float from floats f join terminaux t on t.id = f.terminal
   where f.operateur = p_n.operateur and f.actif order by t.vu_le desc nulls last, f.id limit 1;
  insert into messages_sortants (terminal, operateur, numero, texte, cle, expire_le)
  values (v_float.terminal, p_n.operateur, p_n.numero,
          format('XAFe Exchange : votre code est %s. Il vaut 10 minutes. Ne le partagez avec personne.', v_code),
          'num-' || p_n.id::text || '-' || extract(epoch from clock_timestamp())::bigint::text, now() + interval '10 minutes');
end $$;

-- Ajouter un numéro : il ne retient RIEN tant que son code n'est pas confirmé
-- (l'index d'unicité ne porte que sur les numéros vérifiés). L'opérateur est
-- celui que le numéro dit : un 677 n'est pas un numéro Orange. Redemander le
-- même numéro réarme son code au lieu de refuser.
create function ajouter_numero(p_operateur text, p_numero text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_compte uuid := auth.uid();
  v_num    text := normaliser_numero(p_numero);
  v_n      numeros;
begin
  perform _exiger_compte_actif(v_compte);
  perform 1 from comptes where id = v_compte for no key update;
  perform 1 from operateurs where id = p_operateur;
  if not found then raise exception 'opérateur inconnu'; end if;
  if v_num !~ '^6[0-9]{8}$' then raise exception 'numéro invalide'; end if;
  if operateur_du_numero(v_num) is distinct from p_operateur then
    raise exception 'numéro invalide' using detail = format('ce numéro n''est pas un numéro %s', (select nom from operateurs where id = p_operateur));
  end if;
  select * into v_n from numeros where compte_id = v_compte and numero = v_num and retire_le is null;
  if found then
    if v_n.verifie_le is not null then raise exception 'ce numéro est déjà sur votre compte'; end if;
    perform _envoyer_code_numero(v_n);
    return _numero_json(v_n);
  end if;
  if _proprietaire_du_numero(v_num) is not null then
    raise exception 'ce numéro est déjà sur un autre compte';
  end if;
  if (select count(*) from numeros where compte_id = v_compte and retire_le is null and verifie_le is null) >= 3 then
    raise exception 'trop de numéros en attente de code' using detail = 'confirmez ou retirez les premiers';
  end if;
  insert into numeros (compte_id, operateur, numero, verifie_le, actif_des)
  values (v_compte, p_operateur, v_num, null, now() + interval '24 hours')
  returning * into v_n;
  perform _envoyer_code_numero(v_n);
  return _numero_json(v_n);
end $$;

-- Confirmer : un code faux se COMPTE (on rend {"erreur": …} au lieu de lever,
-- sinon l'essai raté serait annulé avec la fonction), cinq faux et il faut
-- un nouveau code.
create function confirmer_numero(p_id uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n numeros; v_k numeros_codes;
begin
  select * into v_n from numeros where id = p_id and compte_id = auth.uid() and retire_le is null for update;
  if not found then raise exception 'numéro inconnu sur ce compte'; end if;
  if v_n.verifie_le is not null then return _numero_json(v_n); end if;
  select * into v_k from numeros_codes where numero_id = p_id for update;
  if not found or v_k.expire_le < now() or v_k.essais >= 5 then
    return jsonb_build_object('ok', false, 'erreur', 'code SMS expiré', 'detail', 'demandez un nouveau code');
  end if;
  if p_code is null or extensions.crypt(p_code, v_k.empreinte) <> v_k.empreinte then
    update numeros_codes set essais = essais + 1 where numero_id = p_id;
    return jsonb_build_object('ok', false, 'erreur', 'code SMS incorrect', 'essais_restants', 4 - v_k.essais);
  end if;
  begin
    update numeros set verifie_le = now(), actif_des = now() + interval '24 hours' where id = p_id returning * into v_n;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'erreur', 'ce numéro est déjà sur un autre compte');
  end;
  delete from numeros_codes where numero_id = p_id;
  return _numero_json(v_n);
end $$;

-- Redemander le code d'un numéro pas encore vérifié (le SMS est arrivé trop tard).
create function renvoyer_code_numero(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n numeros;
begin
  perform _exiger_compte_actif(auth.uid());
  select * into v_n from numeros where id = p_id and compte_id = auth.uid() and retire_le is null for update;
  if not found then raise exception 'numéro inconnu sur ce compte'; end if;
  if v_n.verifie_le is not null then return _numero_json(v_n); end if;
  perform _envoyer_code_numero(v_n);
  return _numero_json(v_n);
end $$;

-- Retirer : le dernier numéro VÉRIFIÉ reste (c'est lui qui reçoit les sorties) ;
-- un numéro jamais confirmé se retire toujours.
create function retirer_numero(p_id uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_n numeros;
begin
  v := _controler_code(auth.uid(), p_code);
  if not (v ->> 'ok')::boolean then return v; end if;
  select * into v_n from numeros where id = p_id and compte_id = auth.uid() and retire_le is null for update;
  if not found then raise exception 'numéro inconnu sur ce compte'; end if;
  if v_n.verifie_le is not null
     and (select count(*) from numeros where compte_id = auth.uid() and retire_le is null and verifie_le is not null) <= 1 then
    raise exception 'le dernier numéro ne se retire pas';
  end if;
  update numeros set retire_le = now() where id = p_id;
  delete from numeros_codes where numero_id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Le guichet de TOTEM pour ces SMS : relever, réclamer, rendre compte — comme les transferts.
create function totem_messages_en_attente(p_terminal text)
returns setof messages_sortants language plpgsql security definer set search_path = public as $$
begin
  update terminaux set vu_le = now() where id = p_terminal;
  -- un code périmé ne part plus : on le dit échoué plutôt que de l'envoyer
  update messages_sortants set etat = 'echoue', traite_le = now() where etat = 'en_attente' and expire_le < now();
  return query select * from messages_sortants where (terminal = p_terminal or terminal is null) and etat = 'en_attente' order by id;
end $$;

create function totem_reclamer_message(p_id bigint, p_terminal text)
returns messages_sortants language plpgsql security definer set search_path = public as $$
declare v messages_sortants;
begin
  update messages_sortants set etat = 'en_cours', terminal = p_terminal
   where id = p_id and (terminal = p_terminal or terminal is null) and etat = 'en_attente'
  returning * into v;
  if not found then raise exception 'commande déjà prise ou inconnue'; end if;
  return v;
end $$;

create function totem_resultat_message(p_id bigint, p_terminal text, p_ok boolean, p_resultat text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v messages_sortants;
begin
  select * into v from messages_sortants where id = p_id and terminal = p_terminal for update;
  if not found then raise exception 'message inconnu'; end if;
  -- un résultat ne vaut que pour un message réclamé ; le reste est un doublon
  if v.etat <> 'en_cours' then return jsonb_build_object('message', v.etat, 'deja', true); end if;
  update messages_sortants set etat = case when p_ok then 'envoye' else 'echoue' end, traite_le = now() where id = p_id;
  return jsonb_build_object('message', case when p_ok then 'envoye' else 'echoue' end);
end $$;

-- Le signe de vie d'un boîtier, avec ce qu'il dit de sa santé.
create function totem_signe_de_vie(p_terminal text, p_sante jsonb default null) returns void
language sql security definer set search_path = public as $$
  update terminaux set vu_le = now() where id = p_terminal
$$;

-- ─────────────────────────────── sorties ───────────────────────────────────
-- La sortie demandée par l'application : avec le code secret. La version sans
-- code reste au moteur (service) et n'est plus exécutable par un client.
create function demander_sortie(p_montant numeric, p_numero_id uuid, p_cle text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  v := _controler_code(auth.uid(), p_code);
  if not (v ->> 'ok')::boolean then return v; end if;
  return demander_sortie(p_montant, p_numero_id, p_cle);
end $$;

create function ma_sortie(p_reference text) returns jsonb
language sql stable security definer set search_path = public as $$
  select _sortie_json(s) || jsonb_build_object('transferts',
           (select coalesce(jsonb_agg(jsonb_build_object('etat', c.etat, 'montant_xafe', c.montant_xafe,
                                                        'montant_envoye', (c.parametres ->> 'montant')::numeric,
                                                        'reference_operateur', c.reference_operateur) order by c.id), '[]'::jsonb)
              from commandes c where c.sortie_id = s.id))
    from sorties s where s.reference = p_reference and s.compte_id = auth.uid()
$$;

-- ─────────────────────────────── marché ────────────────────────────────────
-- Les chandelles, calculées depuis les exécutions : o/h/l/c/volume par
-- intervalle. Un intervalle sans exécution n'existe pas (le graphe le sait).
create function chandelles(p_minutes int default 60, p_n int default 28) returns jsonb
language sql stable security definer set search_path = public as $$
  with e as (
    select date_bin(make_interval(mins => p_minutes), cree_le, timestamptz '2000-01-01') t, prix, quantite, cree_le, id
      from executions
     where cree_le > now() - make_interval(mins => p_minutes * (p_n + 1))
  ),
  c as (
    select t,
           (array_agg(prix order by cree_le, id))[1] o,
           max(prix) h, min(prix) l,
           (array_agg(prix order by cree_le desc, id desc))[1] c,
           sum(quantite) v
      from e group by t order by t desc limit p_n
  )
  select coalesce(jsonb_agg(jsonb_build_object('t', t, 'o', o, 'h', h, 'l', l, 'c', c, 'v', v) order by t), '[]'::jsonb) from c
$$;

-- Ce que l'écran doit savoir pour MONTRER d'avance ce que le moteur fera :
-- frais, pas de prix, plafonds. L'équipe les change en base ; une copie figée
-- dans l'application annonçait 0,5 % de frais au moment de signer quand le
-- moteur en prenait 1 %. Le moteur reste seul juge : ceci n'est qu'un miroir.
create function parametres_publics() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'frais', parametre('frais'),
    'marche', parametre('marche'),
    'paliers', parametre('paliers'),
    'rapide', jsonb_build_object('marge', parametre('rapide') -> 'marge', 'ouvert', coalesce((parametre('rapide') ->> 'ouvert')::boolean, false),
                                 'validite_secondes', parametre('rapide') -> 'validite_secondes'),
    'crypto', jsonb_build_object('frais', parametre('crypto') -> 'frais',
                                 'retraits_ouverts', coalesce((parametre('crypto') ->> 'retraits_ouverts')::boolean, false)),
    'operateurs', (select jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'plafond_par_transfert', plafond_par_transfert,
                                                       'plafond_jour', plafond_jour) order by id) from operateurs))
   where auth.uid() is not null
$$;

create function mes_ordres() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(_ordre_json(o) order by o.cree_le desc, o.numero desc), '[]'::jsonb)
    from (select * from ordres where compte_id = auth.uid() order by cree_le desc limit 100) o
$$;

create function mon_ordre(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ordre', _ordre_json(o),
    'executions', (select coalesce(jsonb_agg(_execution_json(e) || jsonb_build_object('mon_role', case when e.preneur = o.cote then 'preneur' else 'placeur' end)
                                              order by e.cree_le, e.id), '[]'::jsonb)
                     from executions e where (o.cote = 'achat' and e.ordre_achat = o.id) or (o.cote = 'vente' and e.ordre_vente = o.id)))
    from ordres o where o.id = p_id and o.compte_id = auth.uid()
$$;

-- ─────────────────────────────── crypto ────────────────────────────────────
-- Les adresses de dépôt : un veilleur de chaîne en prépare d'avance ; la
-- première demande d'un compte en prend une, pour toujours.
create table adresses_libres (
  id      bigint generated always as identity primary key,
  actif   text not null check (actif in ('XAFe', 'USDT')),
  reseau  text not null check (reseau in ('bep20', 'trc20')),
  adresse text not null unique,
  indice  int,                     -- le chemin de dérivation (m/44'/60'/0'/0/indice) : sans lui, la clé ne se retrouve pas
  cree_le timestamptz not null default now()
);
alter table adresses_libres enable row level security;
alter table adresses_crypto add column indice int;
create unique index adresses_crypto_une_adresse on adresses_crypto (reseau, lower(adresse));

create function adresse_depot(p_actif text, p_reseau text) returns text
language plpgsql security definer set search_path = public as $$
declare v_compte uuid := auth.uid(); v_adresse text; v_libre adresses_libres;
begin
  perform _exiger_compte_actif(v_compte);
  -- deux premières demandes ensemble prenaient chacune une adresse libre, et la seconde était perdue
  perform 1 from comptes where id = v_compte for no key update;
  select adresse into v_adresse from adresses_crypto where compte_id = v_compte and actif = p_actif and reseau = p_reseau;
  if found then return v_adresse; end if;
  select * into v_libre from adresses_libres where actif = p_actif and reseau = p_reseau order by id for update skip locked limit 1;
  if not found then return null; end if;
  delete from adresses_libres where id = v_libre.id;
  insert into adresses_crypto (compte_id, actif, reseau, adresse, indice) values (v_compte, p_actif, p_reseau, v_libre.adresse, v_libre.indice)
  on conflict (compte_id, actif, reseau) do update set adresse = adresses_crypto.adresse
  returning adresse into v_adresse;
  return v_adresse;
end $$;

create sequence retraits_crypto_numero;
create table retraits_crypto (
  id        uuid primary key default gen_random_uuid(),
  reference text not null unique,                      -- XAFe-CR-000012
  compte_id uuid not null references comptes(id),
  actif     text not null check (actif in ('XAFe', 'USDT')),
  reseau    text not null check (reseau in ('bep20', 'trc20')),
  adresse   text not null,
  montant   numeric(20,2) not null check (montant > 0),
  frais     numeric(20,2) not null default 0,
  etat      text not null default 'en_attente' check (etat in ('en_attente', 'en_cours', 'envoye', 'echoue', 'annule')),
  tx_hash   text,
  resultat  text,
  cle       text,
  cree_le   timestamptz not null default now(),
  traite_le timestamptz
);
create unique index retraits_crypto_cle on retraits_crypto (compte_id, cle) where cle is not null;
create index retraits_crypto_du_compte on retraits_crypto (compte_id, cree_le desc);
create index transferts_crypto_du_compte on transferts_crypto (compte_id, cree_le desc);

-- Le plafond du palier compte TOUT ce qui sort : les sorties MoMo et les
-- retraits crypto, l'USDT au dernier cours. Sans cela, un compte non vérifié
-- sortait sans limite par la chaîne.
create or replace function _sorties_du_jour(p_compte uuid) returns numeric
language plpgsql stable as $$
declare v_cours numeric := (select prix from executions order by cree_le desc, id desc limit 1);
begin
  return (select coalesce(sum(montant), 0) from sorties
           where compte_id = p_compte and cree_le >= debut_du_jour() and etat not in ('annulee', 'echouee'))
       + (select coalesce(sum(case actif when 'XAFe' then montant + frais else (montant + frais) * coalesce(v_cours, 0) end), 0)
            from retraits_crypto
           where compte_id = p_compte and cree_le >= debut_du_jour() and etat not in ('echoue', 'annule'));
end $$;
alter table retraits_crypto enable row level security;
create policy lire_mes_retraits on retraits_crypto for select to authenticated using (compte_id = auth.uid());

create function _retrait_json(r retraits_crypto) returns jsonb language sql stable as $$
  select jsonb_build_object('reference', r.reference, 'actif', r.actif, 'reseau', r.reseau, 'adresse', r.adresse, 'montant', r.montant,
                            'frais', r.frais, 'etat', r.etat, 'tx_hash', r.tx_hash, 'cree_le', r.cree_le)
$$;

create function demander_retrait_crypto(p_actif text, p_reseau text, p_adresse text, p_montant numeric, p_cle text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_compte uuid := auth.uid();
  v        jsonb;
  v_r      retraits_crypto;
  v_frais  numeric;
  v_palier jsonb;
  v_cours  numeric;
  v_xaf    numeric;
begin
  perform _exiger_compte_actif(v_compte);
  if p_cle is not null then
    select * into v_r from retraits_crypto where compte_id = v_compte and cle = p_cle;
    if found then return _retrait_json(v_r) || '{"deja": true}'; end if;
  end if;
  if not coalesce((parametre('crypto') ->> 'retraits_ouverts')::boolean, false) then
    raise exception 'retraits crypto pas encore ouverts' using detail = 'l''envoi sur la chaîne arrive bientôt ; vos fonds restent disponibles';
  end if;
  if p_actif not in ('XAFe', 'USDT') then raise exception 'actif inconnu'; end if;
  if p_reseau not in ('bep20', 'trc20') then raise exception 'réseau inconnu'; end if;
  if not (case p_reseau when 'bep20' then p_adresse ~ '^0x[0-9a-fA-F]{40}$' else p_adresse ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' end) then
    raise exception 'adresse invalide' using detail = format('ce n''est pas une adresse %s', upper(p_reseau));
  end if;
  if p_montant is null or p_montant <= 0 or p_montant <> round(p_montant, case p_actif when 'USDT' then 2 else 0 end) then
    raise exception 'montant invalide';
  end if;
  v := _controler_code(v_compte, p_code);
  if not (v ->> 'ok')::boolean then return v; end if;
  v_frais := (parametre('crypto') -> 'frais' ->> p_actif)::numeric;

  perform 1 from comptes where id = v_compte for no key update;
  v_palier := parametre('paliers') -> (select palier::text from comptes where id = v_compte);
  if v_palier is not null and v_palier <> 'null'::jsonb then
    if p_actif = 'USDT' then
      v_cours := (select prix from executions order by cree_le desc, id desc limit 1);
      if v_cours is null then raise exception 'pas de cours de référence' using detail = 'le plafond du palier se compte en XAF'; end if;
      v_xaf := (p_montant + v_frais) * v_cours;
    else
      v_xaf := p_montant + v_frais;
    end if;
    if _sorties_du_jour(v_compte) + v_xaf > (v_palier ->> 'sortie_jour')::numeric then
      raise exception 'plafond du palier atteint' using detail = format('%s XAF par jour, retraits crypto compris', v_palier ->> 'sortie_jour');
    end if;
  end if;
  insert into retraits_crypto (reference, compte_id, actif, reseau, adresse, montant, frais, cle)
  values ('XAFe-CR-' || lpad(nextval('retraits_crypto_numero')::text, 6, '0'), v_compte, p_actif, p_reseau, p_adresse, p_montant, v_frais, p_cle)
  returning * into v_r;
  perform _mouvement(v_compte, p_actif, -(p_montant + v_frais), p_montant + v_frais, 'retrait_crypto_bloque', 'retraits_crypto', v_r.reference);
  return _retrait_json(v_r);
end $$;

create function mon_retrait_crypto(p_reference text) returns jsonb
language sql stable security definer set search_path = public as $$
  select _retrait_json(r) from retraits_crypto r where r.reference = p_reference and r.compte_id = auth.uid()
$$;

-- Le veilleur de chaîne rend compte (clé de service seulement).
create function chaine_resultat_retrait(p_reference text, p_ok boolean, p_tx_hash text, p_resultat text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r retraits_crypto;
begin
  select * into v_r from retraits_crypto where reference = p_reference for update;
  if not found then raise exception 'retrait inconnu'; end if;
  if v_r.etat in ('envoye', 'echoue', 'annule') then return _retrait_json(v_r) || '{"deja": true}'; end if;
  if p_ok then
    update retraits_crypto set etat = 'envoye', tx_hash = p_tx_hash, resultat = p_resultat, traite_le = now() where id = v_r.id returning * into v_r;
    perform _mouvement(v_r.compte_id, v_r.actif, 0, -(v_r.montant + v_r.frais), 'retrait_crypto_envoye', 'retraits_crypto', v_r.reference);
    perform _mouvement(compte_maison(), v_r.actif, v_r.frais, 0, 'frais_retrait_crypto', 'retraits_crypto', v_r.reference);
    -- Des XAFe partis sur la chaîne ne sont plus dans un solde, mais restent dus.
    if v_r.actif = 'XAFe' then
      insert into emissions (sens, montant, source_table, source_id) values ('vers_chaine', v_r.montant, 'retraits_crypto', v_r.reference);
    end if;
    insert into transferts_crypto (compte_id, actif, reseau, sens, montant, adresse, tx_hash)
    values (v_r.compte_id, v_r.actif, v_r.reseau, 'sortie', v_r.montant, v_r.adresse, p_tx_hash);
    perform _notifier(v_r.compte_id, v_r.actif || ' envoyés', format('%s %s partis vers %s… (%s).', v_r.montant, v_r.actif, left(v_r.adresse, 8), upper(v_r.reseau)), '/historique/' || v_r.reference);
  else
    update retraits_crypto set etat = 'echoue', resultat = p_resultat, traite_le = now() where id = v_r.id returning * into v_r;
    perform _mouvement(v_r.compte_id, v_r.actif, v_r.montant + v_r.frais, -(v_r.montant + v_r.frais), 'retrait_crypto_rendu', 'retraits_crypto', v_r.reference);
    perform _notifier(v_r.compte_id, 'Envoi non parti', format('%s %s sont revenus sur votre compte.', v_r.montant + v_r.frais, v_r.actif), '/historique/' || v_r.reference);
  end if;
  return _retrait_json(v_r);
end $$;

-- ─────────────────────────── le veilleur de chaîne ──────────────────────────
-- Le service chaine/ (clé de service seulement) : il prépare les adresses de
-- dépôt depuis la graine, crédite ce qu'il voit arriver après assez de
-- confirmations, et envoie les retraits depuis le wallet chaud. La graine ne
-- quitte jamais le service : la base ne connaît que des adresses et des indices.

create function chaine_ajouter_adresses(p_actif text, p_reseau text, p_adresses jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into adresses_libres (actif, reseau, adresse, indice)
  select p_actif, p_reseau, x.adresse, x.indice from jsonb_to_recordset(p_adresses) as x(adresse text, indice int)
  on conflict (adresse) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Tout ce que le veilleur doit regarder sur un réseau : les adresses attribuées
-- (à qui créditer) et les libres (pour savoir combien en préparer, et à partir
-- de quel indice).
create function chaine_adresses(p_reseau text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'attribuees', coalesce((select jsonb_agg(jsonb_build_object('adresse', a.adresse, 'actif', a.actif, 'indice', a.indice, 'compte_id', a.compte_id))
                              from adresses_crypto a where a.reseau = p_reseau), '[]'::jsonb),
    'libres', (select jsonb_build_object('USDT', count(*) filter (where actif = 'USDT'), 'XAFe', count(*) filter (where actif = 'XAFe'))
                 from adresses_libres where reseau = p_reseau),
    -- la réserve aussi se surveille : un dépôt sur une adresse jamais montrée ne crédite personne, mais il se voit
    'reserve', coalesce((select jsonb_agg(jsonb_build_object('adresse', l.adresse, 'actif', l.actif, 'indice', l.indice))
                           from adresses_libres l where l.reseau = p_reseau), '[]'::jsonb),
    'indice_max', greatest((select max(indice) from adresses_libres where reseau = p_reseau),
                           (select max(indice) from adresses_crypto where reseau = p_reseau), 0))
$$;

-- Jusqu'où le veilleur a lu chaque réseau : redémarré, il reprend là, sans
-- relire la chaîne depuis le premier bloc (relire ne crédite pas deux fois,
-- mais coûte des heures sur la vraie BNB Smart Chain).
create table chaine_curseurs (reseau text primary key, bloc bigint not null, maj_le timestamptz not null default now());
alter table chaine_curseurs enable row level security;
create function chaine_curseur(p_reseau text, p_bloc bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if p_bloc is not null then
    insert into chaine_curseurs (reseau, bloc) values (p_reseau, p_bloc)
    on conflict (reseau) do update set bloc = greatest(chaine_curseurs.bloc, excluded.bloc), maj_le = now();
  end if;
  select bloc into v from chaine_curseurs where reseau = p_reseau;
  return v;
end $$;

-- Un dépôt vu sur la chaîne, assez confirmé. p_preuve = « tx_hash:index du
-- journal » : une transaction peut porter plusieurs transferts, et rejouée,
-- elle ne crédite pas deux fois (crediter_crypto).
create function chaine_crediter_depot(p_reseau text, p_adresse text, p_actif text, p_montant numeric, p_preuve text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_compte uuid;
begin
  select compte_id into v_compte from adresses_crypto
   where reseau = p_reseau and lower(adresse) = lower(p_adresse) and actif = p_actif;
  if not found then raise exception 'adresse non attribuée' using detail = format('%s %s %s', p_reseau, p_actif, p_adresse); end if;
  if p_montant is null or p_montant <= 0 then raise exception 'montant invalide'; end if;
  return crediter_crypto(v_compte, p_actif, p_reseau, p_montant, p_preuve, p_adresse);
end $$;

-- Les retraits à envoyer sur un réseau : ceux qui attendent passent « en_cours »
-- (pris par ce veilleur) ; ceux déjà en cours reviennent aussi, pour reprendre
-- après une coupure — avec le hash déjà signé, s'il y en a un.
create function chaine_retraits_a_envoyer(p_reseau text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  update retraits_crypto set etat = 'en_cours'
   where id in (select id from retraits_crypto where reseau = p_reseau and etat = 'en_attente' order by cree_le for update skip locked);
  select coalesce(jsonb_agg(_retrait_json(x) || jsonb_build_object('tx_brut', x.tx_brut) order by x.cree_le), '[]'::jsonb) into r
    from retraits_crypto x where x.reseau = p_reseau and x.etat = 'en_cours';
  return r;
end $$;

-- Le hash est noté AVANT la diffusion, avec la transaction signée (publique dès
-- qu'elle part) : après une coupure, le veilleur rediffuse CETTE transaction
-- au lieu d'en signer une seconde — un retrait ne part jamais deux fois.
alter table retraits_crypto add column tx_brut text;
-- Les transactions signées puis REMPLACÉES : une seule cause admise, elle ne
-- peut plus jamais entrer dans un bloc (Tron : passé son échéance ; EVM : son
-- nonce a été pris par une autre). Gardées toutes : si deux envois partaient,
-- on saurait lesquels.
alter table retraits_crypto add column tx_remplacees text[] not null default '{}';
create function chaine_marquer_envoi(p_reference text, p_tx_hash text, p_brut text, p_remplace text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_r retraits_crypto;
begin
  select * into v_r from retraits_crypto where reference = p_reference for update;
  if not found then raise exception 'retrait inconnu'; end if;
  if v_r.etat <> 'en_cours' then raise exception 'retrait pas en cours' using detail = v_r.etat; end if;
  if v_r.tx_hash is not null and v_r.tx_hash <> p_tx_hash then
    -- remplacer se dit : le veilleur nomme la transaction qu'il sait morte (jugée sur la chaîne, pas sur une horloge)
    if p_remplace is null or p_remplace <> v_r.tx_hash then
      raise exception 'un autre envoi est déjà signé' using detail = v_r.tx_hash;
    end if;
    update retraits_crypto set tx_remplacees = tx_remplacees || v_r.tx_hash where id = v_r.id;
  end if;
  update retraits_crypto set tx_hash = p_tx_hash, tx_brut = p_brut where id = v_r.id returning * into v_r;
  return _retrait_json(v_r) || jsonb_build_object('tx_brut', v_r.tx_brut);
end $$;

-- Ce que les retraits d'un réseau doivent encore au wallet chaud : pris mais
-- pas encore signés. Le veilleur n'envoie au froid que ce qui dépasse.
create function chaine_retraits_en_attente(p_reseau text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('reference', x.reference, 'actif', x.actif, 'montant', x.montant) order by x.cree_le), '[]'::jsonb)
    from retraits_crypto x where x.reseau = p_reseau and (x.etat = 'en_attente' or (x.etat = 'en_cours' and x.tx_hash is null))
$$;

-- Ce que le veilleur voit à chaque tour, publié pour l'administration (page
-- « Wallets ») : soldes du chaud, froid, alertes. Il n'y a pas de clé ici,
-- seulement des adresses et des chiffres.
create table chaine_etats (reseau text primary key, etat jsonb not null, maj_le timestamptz not null default now());
alter table chaine_etats enable row level security;
create function chaine_publier_etat(p_reseau text, p_etat jsonb) returns void
language sql security definer set search_path = public as $$
  insert into chaine_etats (reseau, etat) values (p_reseau, p_etat)
  on conflict (reseau) do update set etat = excluded.etat, maj_le = now()
$$;
create function chaine_etat(p_reseau text) returns jsonb
language sql stable security definer set search_path = public as $$
  select etat from chaine_etats where reseau = p_reseau
$$;

-- Un dépôt que le veilleur voit mais ne peut créditer (une adresse jamais
-- montrée à un client, un XAFe qui ne se détruit pas) : il ne crédite
-- personne, mais il ne se perd pas — l'équipe le voit tant qu'il n'est pas
-- traité, même après un redémarrage du veilleur. Une preuve, une ligne.
create table chaine_orphelins (
  preuve  text primary key,
  reseau  text not null,
  actif   text not null,
  adresse text not null,
  montant numeric(20,2) not null,
  raison  text not null,
  vu_le   timestamptz not null default now()
);
alter table chaine_orphelins enable row level security;
create function chaine_signaler_orphelin(p_reseau text, p_actif text, p_adresse text, p_montant numeric, p_preuve text, p_raison text) returns void
language sql security definer set search_path = public as $$
  insert into chaine_orphelins (preuve, reseau, actif, adresse, montant, raison) values (p_preuve, p_reseau, p_actif, p_adresse, p_montant, left(p_raison, 500))
  on conflict (preuve) do nothing
$$;

-- ───────────────────────────── historique ──────────────────────────────────
-- Les lignes de l'historique d'un compte, une fois pour toutes : la liste
-- (mon_historique) et le détail d'une seule (mon_operation) lisent la même.
-- « cle » est ce que l'écran donne pour retrouver une ligne : la référence,
-- ou l'identifiant d'un ordre ou d'un transfert de chaîne.
create function _lignes_historique(p_compte uuid) returns table (quand timestamptz, cle text, ligne jsonb)
language sql stable as $$
    select coalesce(d.credite_le, d.cree_le), d.reference, jsonb_build_object('nature', 'depot', 'detail', _depot_json(d))
      from depots d where d.compte_id = p_compte and d.etat not in ('annule', 'expire')
    union all
    select s.cree_le, s.reference, jsonb_build_object('nature', 'sortie', 'detail', _sortie_json(s) || jsonb_build_object('transferts',
             (select coalesce(jsonb_agg(jsonb_build_object('etat', c.etat, 'montant_xafe', c.montant_xafe, 'montant_envoye', (c.parametres ->> 'montant')::numeric, 'reference_operateur', c.reference_operateur) order by c.id), '[]'::jsonb)
                from commandes c where c.sortie_id = s.id)))
      from sorties s where s.compte_id = p_compte
    union all
    select o.cree_le, o.id::text, jsonb_build_object('nature', 'ordre', 'detail', _ordre_json(o))
      from ordres o where o.compte_id = p_compte and (o.executee > 0 or o.etat <> 'annule')
    union all
    select r.cree_le, r.reference, jsonb_build_object('nature', 'retrait', 'detail', _retrait_json(r))
      from retraits_crypto r where r.compte_id = p_compte
    union all
    select t.cree_le, t.id::text, jsonb_build_object('nature', 'transfert', 'detail', jsonb_build_object('id', t.id, 'actif', t.actif, 'reseau', t.reseau, 'sens', t.sens, 'montant', t.montant, 'adresse', t.adresse, 'tx_hash', t.tx_hash, 'cree_le', t.cree_le))
      from transferts_crypto t where t.compte_id = p_compte and t.sens = 'entree'
$$;

create function mon_historique(p_n int default 200) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(ligne order by quand desc), '[]'::jsonb)
    from (select ligne, quand from _lignes_historique(auth.uid()) order by quand desc limit least(greatest(coalesce(p_n, 200), 1), 500)) page
$$;

-- Le détail d'UNE opération, quel que soit son âge. L'écran la cherchait dans
-- les 200 dernières lignes, et au-delà affirmait « Cette opération n'est pas
-- sur votre compte » — alors que les notifications y renvoient.
create function mon_operation(p_reference text) returns jsonb
language sql stable security definer set search_path = public as $$
  select ligne from _lignes_historique(auth.uid()) where cle = p_reference limit 1
$$;

-- ─────────────────────────── temps réel ────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table soldes, depots, depot_declarations, sorties, ordres, notifications, numeros, retraits_crypto, transferts_crypto, comptes';
  end if;
end $$;

-- Les GRANT sont dans 0004_droits.sql.
$sql$;
    raise notice '0002_compte_et_lectures.sql : appliquée';
  end if;
end $consolide$;

-- ─── 0003_administration.sql (md5 fe22bc5d5473abe3cded8c8b626ef46d) ───
-- déjà en place si : la table des administrateurs
do $consolide$
begin
  if to_regclass('public.administrateurs') is not null then
    raise notice '0003_administration.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  XAFe Exchange · 0003 · l'administration                               ║
-- ║  Qui administre, avec quels droits ; les réserves ; les entrées       ║
-- ║  retenues à rapprocher ou rembourser ; les sorties ; les terminaux et ║
-- ║  les floats ; les clients et leurs paliers ; les paramètres.          ║
-- ║  Règle absolue : une RPC d'administration est gardée par              ║
-- ║  admin_a_droit('<droit>'), jamais par « est administrateur » seul.   ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ──────────────────────────── qui administre ───────────────────────────────
create table administrateurs (
  id          uuid primary key,                      -- = auth.users.id (connexion par e-mail)
  email       text not null unique,
  nom         text not null,
  role        text not null check (role in ('super_admin', 'operateur', 'tresorier', 'support')),
  actif       boolean not null default true,
  cree_le     timestamptz not null default now()
);
alter table administrateurs enable row level security;
create policy lire_sa_fiche on administrateurs for select to authenticated using (id = auth.uid());
grant select on administrateurs to authenticated;

-- La matrice des droits, en un seul endroit. L'application en a une copie
-- (admin/src/noyau/droits.ts) ; le test de parité les compare.
create function droits_du_role(p_role text) returns text[] language sql immutable as $$
  select case p_role
    when 'super_admin' then array['voir', 'rapprocher', 'rembourser', 'sorties', 'terminaux', 'clients', 'paliers', 'parametres', 'marche', 'administrateurs']
    when 'operateur'   then array['voir', 'rapprocher', 'sorties', 'terminaux', 'clients']
    when 'tresorier'   then array['voir', 'rembourser', 'parametres', 'marche', 'clients']
    when 'support'     then array['voir', 'clients']
    else array[]::text[]
  end
$$;

-- Le garde-fou : actif ET le droit demandé. Un administrateur désactivé est
-- refusé tout de suite, quel que soit son jeton.
create function admin_a_droit(p_droit text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from administrateurs a where a.id = auth.uid() and a.actif and p_droit = any (droits_du_role(a.role)))
$$;

create function _exiger_droit(p_droit text) returns void language plpgsql as $$
begin
  if not admin_a_droit(p_droit) then raise exception 'accès non autorisé' using detail = p_droit; end if;
end $$;

-- Le journal de ce que l'administration FAIT : qui, quoi, sur quoi, quand.
create table journal_admin (
  id        bigint generated always as identity primary key,
  admin_id  uuid not null,
  action    text not null,
  cible     text,
  detail    jsonb,
  cree_le   timestamptz not null default now()
);
alter table journal_admin enable row level security;

create function _journaliser(p_action text, p_cible text, p_detail jsonb default null) returns void language sql as $$
  insert into journal_admin (admin_id, action, cible, detail) values (auth.uid(), p_action, p_cible, p_detail)
$$;

create function mon_profil_admin() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', a.id, 'email', a.email, 'nom', a.nom, 'role', a.role, 'actif', a.actif, 'droits', to_jsonb(droits_du_role(a.role)))
    from administrateurs a where a.id = auth.uid() and a.actif
$$;

create function admin_creer_administrateur(p_id uuid, p_email text, p_nom text, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('administrateurs');
  insert into administrateurs (id, email, nom, role) values (p_id, lower(p_email), p_nom, p_role);
  perform _journaliser('creer_administrateur', p_id::text, jsonb_build_object('role', p_role));
  return jsonb_build_object('ok', true);
end $$;

create function admin_desactiver_administrateur(p_id uuid, p_actif boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('administrateurs');
  if p_id = auth.uid() then raise exception 'on ne se désactive pas soi-même'; end if;
  update administrateurs set actif = p_actif where id = p_id;
  if not found then raise exception 'administrateur inconnu'; end if;
  perform _journaliser(case when p_actif then 'activer_administrateur' else 'desactiver_administrateur' end, p_id::text);
  return jsonb_build_object('ok', true);
end $$;

-- ──────────────────────────── le tableau ───────────────────────────────────
-- Les réserves : ce que la plateforme doit (les XAFe des clients) et ce
-- qu'elle a (la circulation, les floats). La première question du matin.
create function admin_tableau() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select jsonb_build_object(
    'circulation', circulation(),
    'circulation_chaine', circulation_chaine(),
    'soldes', (select coalesce(jsonb_object_agg(actif, jsonb_build_object('disponible', d, 'bloque', b)), '{}'::jsonb)
                 from (select actif, sum(disponible) d, sum(bloque) b from soldes where compte_id <> compte_maison() group by actif) s),
    'maison', (select coalesce(jsonb_object_agg(actif, disponible), '{}'::jsonb) from soldes where compte_id = compte_maison()),
    'comptes', (select count(*) from comptes where not maison),
    'jour', jsonb_build_object(
      'entrees', (select coalesce(sum(montant), 0) from depot_declarations where etat = 'credite' and credite_le >= debut_du_jour()),
      'sorties', (select coalesce(sum(montant_envoye), 0) from sorties where cree_le >= debut_du_jour()),
      'volume_usdt', (select coalesce(sum(quantite), 0) from executions where cree_le >= debut_du_jour()),
      'frais_xafe', (select coalesce(sum(disponible_delta), 0) from ecritures where compte_id = compte_maison() and actif = 'XAFe' and cree_le >= debut_du_jour())),
    'retenues', (select jsonb_build_object('nombre', count(*), 'montant', coalesce(sum(montant), 0)) from entrees_retenues where etat = 'retenue'),
    'sorties_en_cours', (select count(*) from sorties where etat in ('en_attente', 'en_cours')),
    'declarations_attendues', (select count(*) from depot_declarations where etat = 'attendu'),
    'verifications', (select count(*) from comptes where verification_en_cours is not null),
    'terminaux', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'lieu', lieu, 'vu_le', vu_le,
                                   'muet', vu_le is null or vu_le < now() - interval '10 minutes') order by id), '[]'::jsonb) from terminaux),
    'floats', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'operateur', f.operateur, 'numero', f.numero, 'terminal', f.terminal,
                                   'code_agent', f.code_agent, 'actif', f.actif,
                                   'dossiers_ouverts', (select count(*) from depots d where d.float_id = f.id and d.etat = 'en_attente')) order by f.id), '[]'::jsonb) from floats f),
    'cotation', cotation())
  into r;
  return r;
end $$;

-- ──────────────────────────── les entrées ──────────────────────────────────
create function admin_entrees(p_etat text default null, p_n int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(_depot_json(d) || jsonb_build_object('compte', jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'palier', c.palier)) order by d.cree_le desc), '[]'::jsonb)
    into r
    from (select * from depots where (p_etat is null or etat = p_etat) order by cree_le desc limit p_n) d
    join comptes c on c.id = d.compte_id;
  return r;
end $$;

create function admin_retenues(p_etat text default 'retenue', p_n int default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'terminal', e.terminal, 'operateur', e.operateur, 'float_numero', e.float_numero,
                            'numero_payeur', e.numero_payeur, 'montant', e.montant, 'reference_operateur', e.reference_operateur,
                            'transaction_id', e.transaction_id, 'texte', e.texte, 'emis_le', e.emis_le, 'etat', e.etat,
                            'motif', e.motif, 'bloquee', e.bloquee,
                            'depot_reference', (select reference from depots where id = e.depot_id), 'cree_le', e.cree_le,
                            'compte_suggere', (select jsonb_build_object('id', c.id, 'nom', c.nom, 'telephone', c.telephone)
                                                 from comptes c where c.id = _proprietaire_du_numero(e.numero_payeur))) order by e.cree_le desc), '[]'::jsonb)
    into r
    from (select * from entrees_retenues where etat = p_etat order by cree_le desc limit p_n) e;
  return r;
end $$;

-- Rapprocher à la main : le client a mal recopié son ID, ou n'a rien
-- déclaré, ou l'appariement a refusé (payeur d'un autre compte, ID tapé par
-- plusieurs) ; l'opérateur rattache le SMS retenu au dossier qu'il a vérifié.
-- C'est la seule voie qui passe outre la règle du numéro payeur : un humain a
-- regardé. Le crédit suit la voie automatique (_crediter_declaration), palier
-- compris. Le verrou du transaction ID est pris AVANT celui de la ligne,
-- dans le même ordre que declarer_transaction : jamais d'étreinte mortelle.
create function admin_rapprocher_retenue(p_id bigint, p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_r entrees_retenues; v_d depots; v_x depot_declarations; v_tx text;
begin
  perform _exiger_droit('rapprocher');
  select * into v_r from entrees_retenues where id = p_id;
  if not found then raise exception 'entrée inconnue'; end if;
  if v_r.operateur is null or coalesce(v_r.montant, 0) <= 0 then
    raise exception 'opérateur ou montant inconnu' using detail = 'ce SMS ne se crédite pas : remboursement manuel';
  end if;
  -- un SMS dont la référence n'a pas été lue reçoit un identifiant à lui, pour qu'un second ne lui soit pas confondu
  v_tx := case when length(coalesce(v_r.transaction_id, '')) >= 6 then v_r.transaction_id
               else 'SMSRETENU' || v_r.id::text end;
  perform pg_advisory_xact_lock(hashtext('tx:' || v_r.operateur || ':' || v_tx));
  select * into v_r from entrees_retenues where id = p_id for update;
  if v_r.etat <> 'retenue' then raise exception 'cette entrée n''est plus retenue' using detail = v_r.etat; end if;
  if exists (select 1 from depot_paiements where terminal = v_r.terminal and source_id = v_r.source_id and empreinte = v_r.empreinte) then
    raise exception 'ce SMS a déjà crédité un dépôt';
  end if;
  select * into v_d from depots where reference = p_reference for update;
  if not found then raise exception 'dépôt inconnu'; end if;
  if v_d.etat = 'annule' then raise exception 'ce dépôt est annulé'; end if;
  if v_d.operateur <> v_r.operateur then raise exception 'l''opérateur du SMS n''est pas celui du dossier'; end if;
  if exists (select 1 from depot_declarations where operateur = v_r.operateur and transaction_id = v_tx and etat = 'credite') then
    raise exception 'transaction ID déjà utilisé';
  end if;
  -- la déclaration de CE compte pour cet ID est reprise sur ce dossier ; sinon on l'écrit
  select * into v_x from depot_declarations where compte_id = v_d.compte_id and operateur = v_r.operateur and transaction_id = v_tx for update;
  if found then
    update depot_declarations set depot_id = v_d.id, etat = 'attendu', motif = 'rapproché par l''administration'
     where id = v_x.id returning * into v_x;
  else
    insert into depot_declarations (depot_id, compte_id, operateur, transaction_id, motif)
    values (v_d.id, v_d.compte_id, v_r.operateur, v_tx, 'rapproché par l''administration')
    returning * into v_x;
  end if;
  v_x := _crediter_declaration(v_x.id, v_r.terminal, v_r.source_id, v_r.montant, v_r.numero_payeur, v_r.reference_operateur, v_r.texte, v_r.emis_le, v_r.id);
  if v_x.etat = 'credite' then
    -- les autres comptes qui attendaient ce même ID savent qu'il est pris
    update depot_declarations set etat = 'refuse', motif = 'rattaché à un autre dossier par l''équipe'
     where operateur = v_r.operateur and transaction_id = v_tx and etat = 'attendu';
  end if;
  perform _journaliser('rapprocher_retenue', p_id::text, jsonb_build_object('reference', p_reference, 'resultat', v_x.etat));
  return _declaration_json(v_x);
end $$;

-- Rembourser : l'argent repart au payeur par TOTEM, depuis le float qui l'a
-- reçu, et l'entrée est close (elle revient « retenue » si le transfert
-- échoue). Jamais un SMS qui a déjà crédité quelqu'un : ce serait payer deux
-- fois. Un remboursement échoué se relance : chaque essai a sa clé.
create function admin_rembourser_retenue(p_id bigint, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_r entrees_retenues; v_float floats; v_n int;
begin
  perform _exiger_droit('rembourser');
  select * into v_r from entrees_retenues where id = p_id for update;
  if not found then raise exception 'entrée inconnue'; end if;
  if v_r.etat <> 'retenue' then raise exception 'cette entrée n''est plus retenue' using detail = v_r.etat; end if;
  if v_r.numero_payeur is null or coalesce(v_r.montant, 0) <= 0 then raise exception 'payeur ou montant inconnu : remboursement manuel'; end if;
  if exists (select 1 from depot_paiements where terminal = v_r.terminal and source_id = v_r.source_id and empreinte = v_r.empreinte)
     or (length(coalesce(v_r.transaction_id, '')) >= 6
         and exists (select 1 from depot_declarations where operateur = v_r.operateur and transaction_id = v_r.transaction_id and etat = 'credite')) then
    raise exception 'ce paiement a déjà été crédité' using detail = 'le rembourser le paierait deux fois';
  end if;
  select * into v_float from floats where id = v_r.float_id;
  if not found or v_float.terminal is null then
    raise exception 'float inconnu : remboursement manuel' using detail = 'aucun boîtier ne porte la carte qui a reçu cet argent';
  end if;
  if exists (select 1 from remboursements where retenue_id = p_id and etat in ('en_attente', 'en_cours')) then
    raise exception 'un remboursement est déjà en route';
  end if;
  select count(*) + 1 into v_n from remboursements where retenue_id = p_id;
  insert into remboursements (retenue_id, terminal, float_id, operateur, numero, montant, note, cle)
  values (p_id, v_float.terminal, v_float.id, v_r.operateur, v_r.numero_payeur, v_r.montant, p_note, 'rbt-' || p_id::text || '-' || v_n::text);
  update entrees_retenues set etat = 'remboursee' where id = p_id;
  -- le journal se garde longtemps et se lit à plusieurs : la référence de l'entrée, jamais le numéro du payeur
  perform _journaliser('rembourser_retenue', p_id::text, jsonb_build_object('montant', v_r.montant, 'note', p_note, 'essai', v_n));
  return jsonb_build_object('ok', true, 'montant', v_r.montant, 'numero', v_r.numero_payeur);
end $$;

-- Les remboursements, que TOTEM compose comme des transferts (même guichet, type 'remboursements').
create table remboursements (
  id         bigint generated always as identity primary key,
  retenue_id bigint not null references entrees_retenues(id),
  terminal   text references terminaux(id),
  float_id   int references floats(id),
  operateur  text not null,
  numero     text not null,
  montant    numeric(20,2) not null check (montant > 0),
  note       text,
  etat       text not null default 'en_attente' check (etat in ('en_attente', 'en_cours', 'fait', 'echoue')),
  resultat   text,
  reference_operateur text,
  cle        text not null unique,
  cree_le    timestamptz not null default now(),
  reclamee_le timestamptz,
  traite_le  timestamptz
);
alter table remboursements enable row level security;
create index remboursements_de_la_retenue on remboursements (retenue_id);

create function totem_remboursements_en_attente(p_terminal text)
returns setof remboursements language plpgsql security definer set search_path = public as $$
begin
  update terminaux set vu_le = now() where id = p_terminal;
  return query select * from remboursements where (terminal = p_terminal or terminal is null) and etat = 'en_attente' order by id;
end $$;

create function totem_reclamer_remboursement(p_id bigint, p_terminal text)
returns remboursements language plpgsql security definer set search_path = public as $$
declare v remboursements;
begin
  update remboursements set etat = 'en_cours', terminal = p_terminal, reclamee_le = now()
   where id = p_id and (terminal = p_terminal or terminal is null) and etat = 'en_attente' returning * into v;
  if not found then raise exception 'commande déjà prise ou inconnue'; end if;
  return v;
end $$;

create function totem_resultat_remboursement(p_id bigint, p_terminal text, p_ok boolean, p_resultat text, p_reference_operateur text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v remboursements;
begin
  select * into v from remboursements where id = p_id and terminal = p_terminal for update;
  if not found then raise exception 'remboursement inconnu'; end if;
  -- un résultat ne vaut que pour un remboursement réclamé ; le reste est un doublon
  if v.etat <> 'en_cours' then return jsonb_build_object('remboursement', v.etat, 'deja', true); end if;
  update remboursements set etat = case when p_ok then 'fait' else 'echoue' end, resultat = p_resultat, reference_operateur = p_reference_operateur, traite_le = now() where id = p_id;
  if not p_ok then update entrees_retenues set etat = 'retenue' where id = v.retenue_id; end if;
  return jsonb_build_object('remboursement', case when p_ok then 'fait' else 'echoue' end);
end $$;

-- Un remboursement réclamé par un boîtier qui s'est tu : rendu à un autre tour,
-- comme une commande. Jamais un remboursement « fait » : l'argent est parti.
create function admin_liberer_remboursement(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v remboursements;
begin
  perform _exiger_droit('rembourser');
  select * into v from remboursements where id = p_id for update;
  if not found then raise exception 'remboursement inconnu'; end if;
  if v.etat <> 'en_cours' then raise exception 'seul un remboursement en cours se libère' using detail = v.etat; end if;
  if v.reclamee_le > now() - interval '5 minutes' then raise exception 'réclamé il y a moins de cinq minutes : le boîtier compose peut-être encore'; end if;
  update remboursements set etat = 'en_attente', reclamee_le = null where id = p_id;
  perform _journaliser('liberer_remboursement', p_id::text);
  return jsonb_build_object('ok', true);
end $$;

-- ──────────────────────────── les sorties ──────────────────────────────────
create function admin_sorties(p_etat text default null, p_n int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(_sortie_json(s) || jsonb_build_object(
           'compte', jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom),
           'transferts', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'terminal', k.terminal, 'etat', k.etat, 'montant_xafe', k.montant_xafe,
                                                     'montant_envoye', (k.parametres ->> 'montant')::numeric, 'reprises', k.reprises, 'resultat', k.resultat,
                                                     'reference_operateur', k.reference_operateur, 'reclamee_le', k.reclamee_le) order by k.id), '[]'::jsonb)
                            from commandes k where k.sortie_id = s.id)) order by s.cree_le desc), '[]'::jsonb)
    into r
    from (select * from sorties where (p_etat is null or etat = p_etat) order by cree_le desc limit p_n) s
    join comptes c on c.id = s.compte_id;
  return r;
end $$;

-- Un transfert réclamé par un boîtier qui s'est tu : on le libère, un autre
-- tour le reprendra. Jamais un transfert « fait » : l'argent est parti.
create function admin_liberer_commande(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v commandes;
begin
  perform _exiger_droit('sorties');
  select * into v from commandes where id = p_id for update;
  if not found then raise exception 'commande inconnue'; end if;
  if v.etat <> 'en_cours' then raise exception 'seule une commande en cours se libère' using detail = v.etat; end if;
  if v.reclamee_le > now() - interval '5 minutes' then raise exception 'réclamée il y a moins de cinq minutes : le boîtier compose peut-être encore'; end if;
  update commandes set etat = 'en_attente', reclamee_le = null where id = p_id;
  perform _journaliser('liberer_commande', p_id::text);
  return jsonb_build_object('ok', true);
end $$;

-- Un transfert attend un boîtier qui s'est tu : on le donne à un autre boîtier
-- qui porte une carte du même opérateur. Seulement « en attente » : réclamé,
-- il est peut-être en train d'être composé.
create function admin_reaffecter_commande(p_id bigint, p_terminal text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v commandes; v_float floats;
begin
  perform _exiger_droit('sorties');
  select * into v from commandes where id = p_id for update;
  if not found then raise exception 'commande inconnue'; end if;
  if v.etat <> 'en_attente' then raise exception 'seule une commande en attente se réaffecte' using detail = v.etat; end if;
  select f.* into v_float from floats f where f.terminal = p_terminal and f.actif and f.operateur = v.parametres ->> 'operateur' order by f.id limit 1;
  if not found then raise exception 'ce terminal ne porte aucune carte de cet opérateur'; end if;
  update commandes set terminal = p_terminal, float_id = v_float.id,
         parametres = parametres || jsonb_build_object('float_numero', v_float.numero)
   where id = p_id;
  perform _journaliser('reaffecter_commande', p_id::text, jsonb_build_object('de', v.terminal, 'vers', p_terminal));
  return jsonb_build_object('ok', true, 'terminal', p_terminal, 'float_numero', v_float.numero);
end $$;

-- Annuler ce qui n'est pas encore parti d'une sortie : ses transferts EN
-- ATTENTE sont clos, leurs XAFe reviennent au client. Un transfert réclamé
-- (peut-être en train d'être composé) ou fait n'est jamais touché : il faut
-- d'abord le libérer, après cinq minutes de silence du boîtier.
create function admin_annuler_sortie(p_reference text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties; v commandes; v_rendu numeric := 0; v_faites int; v_echouees int;
begin
  perform _exiger_droit('sorties');
  if length(trim(coalesce(p_note, ''))) < 3 then raise exception 'une note est exigée' using detail = 'pourquoi la sortie est annulée'; end if;
  select * into v_s from sorties where reference = p_reference for update;
  if not found then raise exception 'sortie inconnue'; end if;
  if exists (select 1 from commandes where sortie_id = v_s.id and etat = 'en_cours') then
    raise exception 'un transfert est en cours de composition' using detail = 'libérez-le d''abord s''il est bloqué';
  end if;
  for v in select * from commandes where sortie_id = v_s.id and etat = 'en_attente' order by id for update loop
    update commandes set etat = 'echouee', resultat = 'annulée par l''équipe : ' || p_note, traitee_le = now() where id = v.id;
    perform _mouvement(v_s.compte_id, 'XAFe', v.montant_xafe, -v.montant_xafe, 'sortie_annulee', 'commandes', v.id::text);
    v_rendu := v_rendu + v.montant_xafe;
  end loop;
  if v_rendu = 0 then raise exception 'rien à annuler' using detail = 'aucun transfert en attente'; end if;
  select count(*) filter (where etat = 'faite'), count(*) filter (where etat = 'echouee') into v_faites, v_echouees from commandes where sortie_id = v_s.id;
  update sorties set montant_rendu = montant_rendu + v_rendu,
         etat = case when v_faites = 0 then 'annulee' else 'partielle' end, terminee_le = now()
   where id = v_s.id returning * into v_s;
  perform _notifier(v_s.compte_id, 'Sortie annulée', format('%s XAFe sont revenus sur votre compte.', to_char(v_rendu, 'FM999G999G999G999')), '/historique/' || v_s.reference);
  perform _journaliser('annuler_sortie', p_reference, jsonb_build_object('rendu', v_rendu, 'note', p_note));
  return jsonb_build_object('ok', true, 'rendu', v_rendu, 'etat', v_s.etat);
end $$;

-- ───────────────────────── terminaux et floats ─────────────────────────────
create function admin_terminaux() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nom', t.nom, 'lieu', t.lieu, 'vu_le', t.vu_le, 'a_cle', t.cle is not null,
                            'muet', t.vu_le is null or t.vu_le < now() - interval '10 minutes',
                            'floats', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'operateur', f.operateur, 'numero', f.numero, 'code_agent', f.code_agent, 'actif', f.actif,
                                                                         -- retirer un float que des dossiers ouverts donnent à payer se confirme
                                                                         'dossiers_ouverts', (select count(*) from depots d where d.float_id = f.id and d.etat = 'en_attente'))
                                                      order by f.id), '[]'::jsonb) from floats f where f.terminal = t.id),
                            'commandes_en_attente', (select count(*) from commandes k where k.terminal = t.id and k.etat = 'en_attente')) order by t.id), '[]'::jsonb)
    into r from terminaux t;
  return r;
end $$;

-- Créer un boîtier : sa clé est rendue UNE fois, ici ; elle ne se relit pas.
create function admin_creer_terminal(p_id text, p_nom text, p_lieu text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cle text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  perform _exiger_droit('terminaux');
  if p_id !~ '^[a-z0-9-]{3,32}$' then raise exception 'identifiant invalide' using detail = 'minuscules, chiffres et tirets'; end if;
  insert into terminaux (id, nom, lieu, cle) values (p_id, p_nom, p_lieu, v_cle);
  perform _journaliser('creer_terminal', p_id);
  return jsonb_build_object('id', p_id, 'cle', v_cle);
end $$;

create function admin_renouveler_cle(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cle text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  perform _exiger_droit('terminaux');
  update terminaux set cle = v_cle where id = p_id;
  if not found then raise exception 'terminal inconnu'; end if;
  perform _journaliser('renouveler_cle', p_id);
  return jsonb_build_object('id', p_id, 'cle', v_cle);
end $$;

create function admin_creer_float(p_operateur text, p_numero text, p_terminal text, p_code_agent text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id int;
begin
  perform _exiger_droit('terminaux');
  if normaliser_numero(p_numero) !~ '^6[0-9]{8}$' or operateur_du_numero(p_numero) is distinct from p_operateur then
    raise exception 'numéro invalide' using detail = 'un numéro camerounais de cet opérateur';
  end if;
  perform 1 from terminaux where id = p_terminal;
  if not found then raise exception 'terminal inconnu'; end if;
  insert into floats (operateur, numero, terminal, code_agent) values (p_operateur, normaliser_numero(p_numero), p_terminal, p_code_agent) returning id into v_id;
  perform _journaliser('creer_float', v_id::text, jsonb_build_object('operateur', p_operateur, 'numero', normaliser_numero(p_numero), 'terminal', p_terminal));
  return jsonb_build_object('id', v_id);
end $$;

create function admin_activer_float(p_id int, p_actif boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('terminaux');
  update floats set actif = p_actif where id = p_id;
  if not found then raise exception 'float inconnu'; end if;
  perform _journaliser(case when p_actif then 'activer_float' else 'desactiver_float' end, p_id::text);
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────────── les clients ─────────────────────────────────
-- p_filtre = 'verifications' : les comptes dont les pièces attendent l'équipe, quel que soit leur âge. L'écran
-- filtrait les 200 comptes les plus récents : un dossier plus ancien n'était jamais examiné.
create function admin_clients(p_recherche text default null, p_n int default 100, p_filtre text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_q text := nullif(trim(coalesce(p_recherche, '')), '');
begin
  perform _exiger_droit('clients');
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'entreprise', c.entreprise, 'palier', c.palier,
                            'verification_en_cours', c.verification_en_cours, 'cree_le', c.cree_le, 'desactive_le', c.desactive_le,
                            'xafe', (select coalesce(disponible + bloque, 0) from soldes where compte_id = c.id and actif = 'XAFe'),
                            'usdt', (select coalesce(disponible + bloque, 0) from soldes where compte_id = c.id and actif = 'USDT')) order by c.cree_le desc), '[]'::jsonb)
    into r
    from (select * from comptes where not maison
             and (p_filtre is distinct from 'verifications' or verification_en_cours is not null)
             and (v_q is null
                  or (length(normaliser_numero(v_q)) >= 3 and telephone like '%' || normaliser_numero(v_q) || '%')
                  or nom ilike '%' || v_q || '%' or entreprise ilike '%' || v_q || '%')
           order by cree_le desc limit p_n) c;
  return r;
end $$;

create function admin_client(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('clients');
  select jsonb_build_object(
    'compte', _compte_json(c) || jsonb_build_object('cree_le', c.cree_le, 'desactive_le', c.desactive_le, 'verification_pieces', c.verification_pieces, 'code_verrou_jusqua', c.code_verrou_jusqua),
    'soldes', (select coalesce(jsonb_object_agg(actif, jsonb_build_object('disponible', disponible, 'bloque', bloque)), '{}'::jsonb) from soldes where compte_id = c.id),
    'numeros', (select coalesce(jsonb_agg(_numero_json(n) order by n.verifie_le), '[]'::jsonb) from numeros n where n.compte_id = c.id),
    'depots', (select coalesce(jsonb_agg(_depot_json(d) order by d.cree_le desc), '[]'::jsonb) from (select * from depots where compte_id = c.id order by cree_le desc limit 20) d),
    'sorties', (select coalesce(jsonb_agg(_sortie_json(s) order by s.cree_le desc), '[]'::jsonb) from (select * from sorties where compte_id = c.id order by cree_le desc limit 20) s),
    'ordres', (select coalesce(jsonb_agg(_ordre_json(o) order by o.cree_le desc), '[]'::jsonb) from (select * from ordres where compte_id = c.id order by cree_le desc limit 20) o),
    'ecritures', (select coalesce(jsonb_agg(jsonb_build_object('actif', e.actif, 'disponible', e.disponible_delta, 'bloque', e.bloque_delta, 'nature', e.nature, 'source', e.source_id, 'quand', e.cree_le) order by e.cree_le desc), '[]'::jsonb)
                    from (select * from ecritures where compte_id = c.id order by cree_le desc limit 50) e))
    into r from comptes c where c.id = p_id;
  return r;
end $$;

create function admin_changer_palier(p_id uuid, p_palier int, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('paliers');
  if p_palier not between 0 and 2 then raise exception 'palier invalide'; end if;
  -- une vérification en cours ne disparaît que si le palier posé la satisfait : sinon ses pièces attendent encore l'équipe
  update comptes set palier = p_palier,
         verification_en_cours = case when (verification_en_cours = 'identite' and p_palier >= 1)
                                        or (verification_en_cours = 'entreprise' and p_palier >= 2) then null
                                      else verification_en_cours end
   where id = p_id and not maison;
  if not found then raise exception 'compte inconnu'; end if;
  perform _journaliser('changer_palier', p_id::text, jsonb_build_object('palier', p_palier, 'note', p_note));
  perform _notifier(p_id, 'Palier ' || p_palier, case p_palier when 0 then 'Votre compte est au palier 0.' when 1 then 'Votre identité est vérifiée : palier 1.' else 'Votre entreprise est vérifiée : palier 2, sans plafond plateforme.' end, '/compte/paliers');
  return jsonb_build_object('ok', true);
end $$;

-- Valider ou refuser les pièces : valider monte au palier que la demande visait.
create function admin_valider_verification(p_id uuid, p_ok boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c comptes; v_palier int;
begin
  perform _exiger_droit('paliers');
  select * into v_c from comptes where id = p_id for no key update;
  if not found or v_c.verification_en_cours is null then raise exception 'aucune vérification en cours'; end if;
  if p_ok then
    v_palier := case v_c.verification_en_cours when 'identite' then greatest(v_c.palier, 1) else 2 end;
    update comptes set palier = v_palier, verification_en_cours = null where id = p_id;
    perform _notifier(p_id, 'Vérification acceptée', case v_palier when 1 then 'Votre identité est vérifiée : palier 1.' else 'Votre entreprise est vérifiée : palier 2.' end, '/compte/paliers');
  else
    update comptes set verification_en_cours = null where id = p_id;
    perform _notifier(p_id, 'Vérification refusée', coalesce(p_note, 'Les pièces ne permettent pas de vérifier votre dossier. Réessayez avec des photos nettes.'), '/compte/paliers');
  end if;
  perform _journaliser(case when p_ok then 'valider_verification' else 'refuser_verification' end, p_id::text, jsonb_build_object('type', v_c.verification_en_cours, 'note', p_note));
  return jsonb_build_object('ok', true, 'palier', (select palier from comptes where id = p_id));
end $$;

create function admin_desactiver_compte(p_id uuid, p_actif boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('clients');
  update comptes set desactive_le = case when p_actif then null else now() end where id = p_id and not maison;
  if not found then raise exception 'compte inconnu'; end if;
  perform _journaliser(case when p_actif then 'reactiver_compte' else 'desactiver_compte' end, p_id::text, jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────────── le marché ───────────────────────────────────
create function admin_marche() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select jsonb_build_object(
    'cotation', cotation(), 'carnet', carnet(20), 'transactions', transactions_recentes(30),
    'ordres_ouverts', (select count(*) from ordres where etat in ('ouvert', 'partiel')),
    'parametres', parametre('marche'), 'frais', parametre('frais'),
    'chandelles', chandelles(60, 48))
    into r;
  return r;
end $$;

-- ─────────────────────────── les paramètres ────────────────────────────────
create function admin_parametres() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_object_agg(cle, valeur), '{}'::jsonb) into r from parametres;
  return r || jsonb_build_object('operateurs', (select jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'plafond_par_transfert', plafond_par_transfert, 'plafond_jour', plafond_jour) order by id) from operateurs));
end $$;

-- Un paramètre est lu par le moteur à chaque geste : une valeur mal formée
-- (un nombre en texte, une clé oubliée, des frais à 50 %) arrêterait les
-- dépôts, les sorties ou le verrou du code secret — ou lèverait un plafond.
-- Elle est refusée ici, avec la raison, avant d'être écrite.
create function _nombre_entre(v jsonb, p_min numeric, p_max numeric, p_entier boolean default false) returns boolean
language sql immutable as $$
  -- une clé absente rend null, et « not null » n'est pas vrai : on dit faux, net
  select coalesce(jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between p_min and p_max
                  and (not p_entier or (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)), false)
$$;

create function _verifier_parametre(p_cle text, v jsonb) returns void
language plpgsql as $$
declare k text; p jsonb; ok boolean;
begin
  if jsonb_typeof(v) <> 'object' then raise exception 'paramètre invalide' using detail = 'un objet JSON est attendu'; end if;
  ok := case p_cle
    when 'frais' then _nombre_entre(v -> 'placeur', 0, 0.05) and _nombre_entre(v -> 'preneur', 0, 0.05) and _nombre_entre(v -> 'sortie', 0, 0.05)
    when 'marche' then v ->> 'paire' = 'USDT/XAFe' and _nombre_entre(v -> 'pas_prix', 0.01, 100) and _nombre_entre(v -> 'quantite_min', 0.01, 1000000)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
    when 'depot' then _nombre_entre(v -> 'validite_minutes', 5, 1440, true) and _nombre_entre(v -> 'grace_minutes', 0, 10080, true)
    when 'sortie' then _nombre_entre(v -> 'reprises_max', 1, 10, true)
    when 'rapide' then _nombre_entre(v -> 'marge', 0, 0.2) and _nombre_entre(v -> 'validite_secondes', 5, 120, true)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
    when 'code_secret' then _nombre_entre(v -> 'essais', 1, 10, true) and _nombre_entre(v -> 'verrou_minutes', 1, 1440, true)
                       and _nombre_entre(v -> 'longueur_min', 4, 6, true) and _nombre_entre(v -> 'longueur_max', 4, 8, true)
                       and (v ->> 'longueur_min')::int <= (v ->> 'longueur_max')::int
    when 'crypto' then _nombre_entre(v -> 'frais' -> 'USDT', 0, 1000) and _nombre_entre(v -> 'frais' -> 'XAFe', 0, 1000000)
                       and _nombre_entre(v -> 'confirmations' -> 'bep20', 1, 1000, true) and _nombre_entre(v -> 'confirmations' -> 'trc20', 1, 1000, true)
                       and jsonb_typeof(v -> 'retraits_ouverts') = 'boolean'
    when 'paliers' then (select bool_and(x) from (values (v ? '0'), (v ? '1'), (v ? '2')) t(x))
    else false end;
  if p_cle = 'paliers' and ok then
    foreach k in array array['0', '1', '2'] loop
      p := v -> k;
      if jsonb_typeof(p) = 'null' then continue; end if;
      if not (jsonb_typeof(p) = 'object' and _nombre_entre(p -> 'entree_jour', 0, 1e12, true) and _nombre_entre(p -> 'sortie_jour', 0, 1e12, true)) then
        ok := false;
      end if;
    end loop;
  end if;
  if not coalesce(ok, false) then
    raise exception 'paramètre invalide' using detail = format('« %s » : une clé manque, ou une valeur sort de ses bornes', p_cle);
  end if;
end $$;

create function admin_modifier_parametre(p_cle text, p_valeur jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('parametres');
  if p_cle not in ('frais', 'marche', 'depot', 'sortie', 'paliers', 'crypto', 'code_secret', 'rapide') then raise exception 'paramètre inconnu'; end if;
  perform _verifier_parametre(p_cle, p_valeur);
  update parametres set valeur = p_valeur where cle = p_cle;
  if not found then raise exception 'paramètre inconnu'; end if;
  perform _journaliser('modifier_parametre', p_cle, p_valeur);
  return jsonb_build_object('ok', true);
end $$;

create function admin_journal(p_n int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'admin', a.nom, 'action', j.action, 'cible', j.cible, 'detail', j.detail, 'quand', j.cree_le) order by j.id desc), '[]'::jsonb)
    into r from (select * from journal_admin order by id desc limit p_n) j left join administrateurs a on a.id = j.admin_id;
  return r;
end $$;

-- Les wallets, vus par l'équipe : ce que chaque veilleur a publié à son
-- dernier tour (« muet » au-delà de deux minutes), et en face ce que la
-- plateforme doit aux clients en USDT — ce que le chaud, le froid et les
-- adresses de dépôt doivent couvrir, tous réseaux ensemble.
create function admin_wallets() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select jsonb_build_object(
    'reseaux', coalesce((select jsonb_agg(jsonb_build_object(
        'reseau', n.reseau,
        'etat', e.etat, 'maj_le', e.maj_le,
        'muet', e.maj_le is null or e.maj_le < now() - interval '2 minutes',
        'adresses_attribuees', (select count(*) from adresses_crypto a where a.reseau = n.reseau),
        'adresses_libres', (select count(*) from adresses_libres l where l.reseau = n.reseau),
        'retraits_en_cours', (select count(*) from retraits_crypto x where x.reseau = n.reseau and x.etat in ('en_attente', 'en_cours')),
        'retraits_remplaces', (select count(*) from retraits_crypto x where x.reseau = n.reseau and cardinality(x.tx_remplacees) > 0),
        'curseur', (select bloc from chaine_curseurs c where c.reseau = n.reseau)) order by n.reseau)
      from (values ('bep20'), ('trc20')) as n(reseau) left join chaine_etats e on e.reseau = n.reseau), '[]'::jsonb),
    'orphelins', coalesce((select jsonb_agg(jsonb_build_object('reseau', o.reseau, 'actif', o.actif, 'adresse', o.adresse, 'montant', o.montant, 'preuve', o.preuve, 'raison', o.raison, 'vu_le', o.vu_le) order by o.vu_le desc)
                             from chaine_orphelins o), '[]'::jsonb),
    'du_usdt', (select coalesce(sum(disponible + bloque), 0) from soldes where actif = 'USDT' and compte_id <> compte_maison()),
    'maison_usdt', (select coalesce(sum(disponible + bloque), 0) from soldes where actif = 'USDT' and compte_id = compte_maison()))
    into r;
  return r;
end $$;

-- Les GRANT sont dans 0004_droits.sql.
$sql$;
    raise notice '0003_administration.sql : appliquée';
  end if;
end $consolide$;

-- ─── 0004_droits.sql (md5 0c9255100d2f2473704b20a2f8ae8756) ───
-- déjà en place si : les droits des clients déjà ouverts
do $consolide$
begin
  if has_function_privilege('authenticated', 'public.mon_compte()', 'execute') then
    raise notice '0004_droits.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  XAFe Exchange · 0004 · les droits, en un seul endroit                 ║
-- ║  Chez Supabase, anon et authenticated reçoivent d'office EXECUTE sur   ║
-- ║  toute fonction et ALL sur toute table de public. « revoke … from      ║
-- ║  public » ne leur retire rien : une fonction de service (totem_*,      ║
-- ║  chaine_*, crediter_crypto, _mouvement) était donc de l'argent gratuit ║
-- ║  pour n'importe quel client. Ici on ferme TOUT, puis on ouvre la       ║
-- ║  liste — et le harnais (scénario 8) vérifie qu'il n'y a rien d'autre.  ║
-- ╚════════════════════════════════════════════════════════════════════════╝

revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;

-- ─────────────────────────── ce que lit un client ──────────────────────────
-- Toujours à travers sa politique (RLS) : ses lignes, rien d'autre. Ces
-- lectures servent surtout au temps réel ; les écrans passent par les RPC.
-- Aucune table ne s'écrit en direct.
grant select on parametres, operateurs, comptes, numeros, soldes, ecritures, depots, depot_paiements, depot_declarations,
                notifications, sorties, adresses_crypto, transferts_crypto, ordres, executions, retraits_crypto
  to authenticated;
-- l'administrateur lit sa propre fiche (politique lire_sa_fiche)
grant select on administrateurs to authenticated;

-- ─────────────────────────── ce qu'appelle un client ───────────────────────
-- Chacune lit auth.uid() et n'agit que sur le compte de la session.
grant execute on function
  -- dépôts
  ouvrir_depot(text, text), mon_depot(text), mes_depots_en_attente(),
  declarer_transaction(text, text), retirer_declaration(text, text), terminer_depot(text), annuler_depot(text),
  -- le compte
  mon_compte(), completer_profil(text, text), verifier_code_secret(text), changer_code_secret(text, text),
  demander_verification(text, jsonb), mes_notifications(), marquer_notifications_lues(),
  -- les numéros
  mes_numeros(), ajouter_numero(text, text), confirmer_numero(uuid, text), renvoyer_code_numero(uuid), retirer_numero(uuid, text),
  -- les sorties : seulement la version AVEC le code secret
  demander_sortie(numeric, uuid, text, text), ma_sortie(text),
  -- le marché
  placer_ordre(text, text, numeric, numeric, text), annuler_ordre(uuid), mes_ordres(), mon_ordre(uuid), mes_soldes(),
  carnet(int), transactions_recentes(int), cotation(), chandelles(int, int), parametres_publics(),
  -- l'achat rapide
  devis_rapide(text, numeric, boolean), executer_devis(uuid),
  -- la crypto
  adresse_depot(text, text), demander_retrait_crypto(text, text, text, numeric, text, text), mon_retrait_crypto(text),
  -- l'historique
  mon_historique(int), mon_operation(text)
  to authenticated;

-- ─────────────────────────── ce qu'appelle l'équipe ────────────────────────
-- Toutes gardées DANS la fonction par _exiger_droit('<droit>') : un client qui
-- les appelle reçoit « accès non autorisé ».
grant execute on function
  mon_profil_admin(), admin_a_droit(text),
  admin_creer_administrateur(uuid, text, text, text), admin_desactiver_administrateur(uuid, boolean),
  admin_tableau(), admin_entrees(text, int), admin_retenues(text, int),
  admin_rapprocher_retenue(bigint, text), admin_rembourser_retenue(bigint, text), admin_liberer_remboursement(bigint),
  admin_sorties(text, int), admin_liberer_commande(bigint), admin_reaffecter_commande(bigint, text), admin_annuler_sortie(text, text),
  admin_terminaux(), admin_creer_terminal(text, text, text), admin_renouveler_cle(text),
  admin_creer_float(text, text, text, text), admin_activer_float(int, boolean),
  admin_clients(text, int, text), admin_client(uuid), admin_changer_palier(uuid, int, text),
  admin_valider_verification(uuid, boolean, text), admin_desactiver_compte(uuid, boolean, text),
  admin_marche(), admin_parametres(), admin_modifier_parametre(text, jsonb), admin_journal(int), admin_wallets()
  to authenticated;

-- ─────────────────────────── la clé de service ─────────────────────────────
-- Les portes de TOTEM (edge functions) et le veilleur de chaîne : totem_*,
-- chaine_resultat_retrait, crediter_crypto, expirer_depots.
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ─────────────────────── les pièces des vérifications ──────────────────────
-- Le stockage « verifications » : privé ; un client dépose et relit dans SON
-- dossier (« <id du compte>/… ») ; l'équipe qui valide les paliers lit tout.
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  -- Les colonnes « public », « file_size_limit », « allowed_mime_types » sont
  -- ajoutées par le service de stockage lui-même, pas par la base : sur une
  -- base neuve elles n'existent pas encore. On crée le stockage avec ce qui
  -- existe toujours, puis on pose les bornes si leurs colonnes sont là.
  insert into storage.buckets (id, name) values ('verifications', 'verifications') on conflict (id) do nothing;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public') then
    execute $p$update storage.buckets set public = false where id = 'verifications'$p$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $p$update storage.buckets set file_size_limit = 10485760,
                 allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] where id = 'verifications'$p$;
  end if;
  execute $p$drop policy if exists verifications_deposer on storage.objects$p$;
  execute $p$drop policy if exists verifications_relire on storage.objects$p$;
  execute $p$create policy verifications_deposer on storage.objects for insert to authenticated
            with check (bucket_id = 'verifications' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  execute $p$create policy verifications_relire on storage.objects for select to authenticated
            using (bucket_id = 'verifications'
                   and ((storage.foldername(name))[1] = auth.uid()::text or public.admin_a_droit('paliers')))$p$;
end $$;
$sql$;
    raise notice '0004_droits.sql : appliquée';
  end if;
end $consolide$;

-- ─── 0005_exploitation.sql (md5 b0292d3f8707096b36723ff8948dd663) ───
-- déjà en place si : rejouable telle quelle
do $consolide$
begin
  if false then
    raise notice '0005_exploitation.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  XAFe Exchange · 0005 · ce qui tourne tout seul                        ║
-- ║  Rien n'appelait expirer_depots() : les dossiers abandonnés restaient  ║
-- ║  « en attente » pour toujours, faussaient la répartition des floats    ║
-- ║  (ouvrir_depot choisit le moins chargé) et la liste de l'équipe.       ║
-- ╚════════════════════════════════════════════════════════════════════════╝
-- pg_cron est fourni par Supabase ; sur une base qui ne l'a pas (le harnais),
-- on le dit et on continue : expirer_depots() reste appelable par la clé de service.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron absent : expirer_depots() ne sera pas planifiée sur cette base';
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'xafe-expirer-depots';
  perform cron.schedule('xafe-expirer-depots', '*/5 * * * *', 'select public.expirer_depots()');
end $$;
$sql$;
    raise notice '0005_exploitation.sql : appliquée';
  end if;
end $consolide$;

-- ─── 0006_veilleur_en_ligne.sql (md5 7167ab2dcf4ed88c2289188aec7b0f83) ───
-- déjà en place si : la table des tours du veilleur
do $consolide$
begin
  if to_regclass('public.chaine_tours') is not null then
    raise notice '0006_veilleur_en_ligne.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  XAFe Exchange · 0006 · le veilleur de chaîne, dans Supabase           ║
-- ║  Le veilleur (chaine/) tourne aussi comme fonction Supabase : pg_cron  ║
-- ║  la réveille chaque minute, un réseau par appel. Rien à héberger.      ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- Un tour à la fois par réseau. Réveillé chaque minute, un tour peut durer
-- plus d'une minute (une transaction à attendre) : sans ce bail, deux tours
-- balaieraient la même adresse, ou enverraient deux fois au froid. Un bail,
-- pas un verrou de session : la fonction parle au moteur par des requêtes
-- HTTP séparées, et un tour qui meurt en route rend la main à l'échéance.
create table chaine_tours (
  reseau  text primary key,
  jusqua  timestamptz not null,
  pris_le timestamptz not null default now()
);
alter table chaine_tours enable row level security;

create function chaine_prendre_tour(p_reseau text, p_secondes int default 300) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_secondes is null or p_secondes < 10 or p_secondes > 3600 then raise exception 'durée de bail invalide'; end if;
  insert into chaine_tours (reseau, jusqua) values (p_reseau, now() + make_interval(secs => p_secondes))
  on conflict (reseau) do update set jusqua = excluded.jusqua, pris_le = now() where chaine_tours.jusqua <= now();
  return found;
end $$;

create function chaine_rendre_tour(p_reseau text) returns void
language sql security definer set search_path = public as $$
  update chaine_tours set jusqua = now() where reseau = p_reseau
$$;

-- Réveiller le veilleur d'un réseau. L'adresse de la fonction et son jeton
-- vivent dans le coffre de Supabase (vault : « veilleur_url », « veilleur_jeton ») :
-- ni dans ce fichier, ni dans la table des tâches. Sans eux, rien ne part.
create function reveiller_veilleur(p_reseau text) returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_jeton text;
begin
  if to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then return; end if;
  execute $q$select (select decrypted_secret from vault.decrypted_secrets where name = 'veilleur_url'),
                    (select decrypted_secret from vault.decrypted_secrets where name = 'veilleur_jeton')$q$ into v_url, v_jeton;
  if v_url is null or v_jeton is null then return; end if;
  execute $q$select net.http_post(url := $1, headers := $2, body := '{}'::jsonb, timeout_milliseconds := 5000)$q$
    using v_url || '?reseau=' || p_reseau, jsonb_build_object('content-type', 'application/json', 'x-veilleur-jeton', v_jeton);
end $$;

-- Ces trois-là : la clé de service et pg_cron seulement (rien pour anon ni authenticated).
revoke all on function chaine_prendre_tour(text, int), chaine_rendre_tour(text), reveiller_veilleur(text) from public, anon, authenticated;
grant execute on function chaine_prendre_tour(text, int), chaine_rendre_tour(text) to service_role;
grant all on table chaine_tours to service_role;

-- Chaque minute, un réveil par réseau. Sur une base sans pg_cron ni pg_net
-- (le harnais), on le dit et on continue.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron ou pg_net absent : le veilleur ne sera pas réveillé sur cette base';
    return;
  end if;
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  perform cron.unschedule(jobid) from cron.job where jobname in ('xafe-veilleur-bep20', 'xafe-veilleur-trc20');
  perform cron.schedule('xafe-veilleur-bep20', '* * * * *', 'select public.reveiller_veilleur(''bep20'')');
  perform cron.schedule('xafe-veilleur-trc20', '* * * * *', 'select public.reveiller_veilleur(''trc20'')');
end $$;
$sql$;
    raise notice '0006_veilleur_en_ligne.sql : appliquée';
  end if;
end $consolide$;

-- ─── 0007_configuration_du_veilleur.sql (md5 0f0d82210ea035bd64c5f16c1ae75937) ───
-- déjà en place si : la fonction chaine_configuration
do $consolide$
begin
  if to_regprocedure('public.chaine_configuration()') is not null then
    raise notice '0007_configuration_du_veilleur.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  XAFe Exchange · 0007 · la configuration du veilleur, dans la base     ║
-- ║  Les réglages qui ne sont pas des secrets (nœuds, contrats, froid,     ║
-- ║  confirmations) vivent dans les paramètres ; le jeton du réveil dans   ║
-- ║  le coffre. La GRAINE n'est lue dans le coffre que sur un réseau       ║
-- ║  d'ESSAI ; en production, c'est un secret de la fonction, que le       ║
-- ║  propriétaire saisit lui-même et que la base ne voit jamais.           ║
-- ╚════════════════════════════════════════════════════════════════════════╝

insert into parametres (cle, valeur) values
  ('chaine', '{"essai": true, "bep20": null, "trc20": null}')
on conflict (cle) do nothing;

-- Pour la fonction « veilleur » seulement (clé de service). Ce qu'elle rend :
--   reseaux  les réglages de chaque réseau, tels que posés dans « chaine » ;
--   jeton    le jeton du réveil (le même que lit pg_cron) ;
--   essai    vrai sur un réseau d'essai : alors seulement, la graine et la
--            clé admin d'essai sont lues dans le coffre.
create function chaine_configuration() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := parametre('chaine'); v_essai boolean; v_secrets jsonb := '{}'::jsonb;
begin
  v_essai := coalesce((v ->> 'essai')::boolean, false);
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb) from vault.decrypted_secrets
                where name in ('veilleur_jeton', 'essai_graine', 'essai_admin_cle')$q$ into v_secrets;
  end if;
  return jsonb_build_object(
    'essai', v_essai,
    'bep20', v -> 'bep20',
    'trc20', v -> 'trc20',
    'jeton', v_secrets ->> 'veilleur_jeton',
    -- jamais hors d'un réseau d'essai : en production la graine n'est pas dans la base
    'graine', case when v_essai then v_secrets ->> 'essai_graine' end,
    'admin_cle_essai', case when v_essai then v_secrets ->> 'essai_admin_cle' end);
end $$;

revoke all on function chaine_configuration() from public, anon, authenticated;
grant execute on function chaine_configuration() to service_role;
$sql$;
    raise notice '0007_configuration_du_veilleur.sql : appliquée';
  end if;
end $consolide$;

-- ─── 0008_glisil.sql (md5 5eab8af91e834735fbd8aafdbdb6a4ca) ───
-- déjà en place si : rejouable telle quelle
do $consolide$
begin
  if false then
    raise notice '0008_glisil.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0008 · le nom                                                ║
-- ║  « XAFe Exchange » devient Glisil : le marché s'appelle Glisil, XAFe   ║
-- ║  reste le nom du stablecoin. Deux choses le portent dans la base : le  ║
-- ║  compte de la maison, et le SMS du code de vérification.               ║
-- ╚════════════════════════════════════════════════════════════════════════╝

update comptes set nom = 'Glisil'
 where id = '00000000-0000-0000-0000-000000000001' and maison and nom = 'XAFe Exchange';

create or replace function _envoyer_code_numero(p_n numeros) returns void
language plpgsql as $$
declare
  v_code  text := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_float floats;
begin
  if exists (select 1 from numeros_codes where numero_id = p_n.id and envoye_le > now() - interval '1 minute') then
    raise exception 'un code vient de partir' using detail = 'attendez une minute avant d''en demander un autre';
  end if;
  if (select count(*) from messages_sortants where numero = p_n.numero and cree_le > now() - interval '1 hour') >= 5 then
    raise exception 'trop de codes demandés pour ce numéro' using detail = 'réessayez dans une heure';
  end if;
  insert into numeros_codes (numero_id, empreinte, expire_le)
  values (p_n.id, extensions.crypt(v_code, extensions.gen_salt('bf', 8)), now() + interval '10 minutes')
  on conflict (numero_id) do update set empreinte = excluded.empreinte, expire_le = excluded.expire_le, essais = 0, envoye_le = now();
  -- le SMS part d'un float de cet opérateur, par TOTEM
  select f.* into v_float from floats f join terminaux t on t.id = f.terminal
   where f.operateur = p_n.operateur and f.actif order by t.vu_le desc nulls last, f.id limit 1;
  insert into messages_sortants (terminal, operateur, numero, texte, cle, expire_le)
  values (v_float.terminal, p_n.operateur, p_n.numero,
          format('Glisil : votre code est %s. Il vaut 10 minutes. Ne le partagez avec personne.', v_code),
          'num-' || p_n.id::text || '-' || extract(epoch from clock_timestamp())::bigint::text, now() + interval '10 minutes');
end $$;
$sql$;
    raise notice '0008_glisil.sql : appliquée';
  end if;
end $consolide$;

-- ─── 0009_inscription_par_email.sql (md5 02aff708729dc5f8195edb2606586927) ───
-- déjà en place si : rejouable telle quelle
do $consolide$
begin
  if false then
    raise notice '0009_inscription_par_email.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0009 · l'inscription par e-mail, sans mot de passe           ║
-- ║  On entre avec son adresse e-mail et un code reçu par e-mail (Supabase ║
-- ║  Auth, OTP). Le compte client s'ouvre ensuite avec un profil complet : ║
-- ║  prénom, nom, date de naissance, téléphone, ville et pays — tous       ║
-- ║  vérifiés ICI, pas seulement à l'écran. L'administration entre de la   ║
-- ║  même façon : une adresse invitée devient administrateur à son premier ║
-- ║  code.                                                                 ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────── le profil ─────────────────────────────────
alter table comptes add column if not exists email          text;
alter table comptes add column if not exists prenom         text;
alter table comptes add column if not exists nom_de_famille text;
alter table comptes add column if not exists date_naissance date;
alter table comptes add column if not exists ville          text;
alter table comptes add column if not exists pays           text check (pays ~ '^[A-Z]{2}$');
create unique index if not exists comptes_email_unique on comptes (lower(email)) where email is not null;

-- Un nom propre : espaces resserrés, une capitale à chaque mot et après un
-- trait d'union ou une apostrophe (« jean-paul » → « Jean-Paul »,
-- « MBALLA » → « Mballa », « d'almeida » → « D'Almeida »). NULL si ce
-- n'est pas un nom : des lettres, et seulement des espaces, traits d'union,
-- apostrophes ou points pour les séparer, de 2 à 60 signes.
create or replace function _nom_propre(p text) returns text language plpgsql immutable as $$
declare v text := regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g');
begin
  v := replace(v, '’', '''');
  if length(v) < 2 or length(v) > 60 then return null; end if;
  if v !~ '^[[:alpha:]]+([ ''.-]+[[:alpha:]]+)*\.?$' then return null; end if;
  return initcap(lower(v));
end $$;

create or replace function _compte_json(c comptes) returns jsonb language sql stable as $$
  select jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'entreprise', c.entreprise, 'palier', c.palier,
                            'email', c.email, 'prenom', c.prenom, 'nom_de_famille', c.nom_de_famille,
                            'date_naissance', c.date_naissance, 'ville', c.ville, 'pays', c.pays,
                            'a_code', exists (select 1 from codes_secrets k where k.compte_id = c.id), 'verrou_jusqua', c.code_verrou_jusqua,
                            'verification_en_cours', c.verification_en_cours,
                            -- ce qui est déjà entré aujourd'hui : l'écran montre ce qui RESTE du plafond, pas le plafond
                            'entre_du_jour', (select coalesce(sum(montant), 0) from depot_declarations
                                               where compte_id = c.id and etat = 'credite' and credite_le >= debut_du_jour()))
$$;

-- L'adresse e-mail de l'utilisateur connecté, si son code l'a PROUVÉE. Une
-- adresse que personne n'a confirmée n'ouvre rien.
create or replace function _email_prouve() returns text
language plpgsql stable security definer set search_path = public as $$
declare v_email text; v_le timestamptz;
begin
  if auth.uid() is null then return null; end if;
  select lower(trim(email)), email_confirmed_at into v_email, v_le from auth.users where id = auth.uid();
  if v_le is null or coalesce(v_email, '') = '' then return null; end if;
  return v_email;
end $$;

-- ────────────────────────── ouvrir son compte ──────────────────────────────
-- Une fois, après le premier code. Tout est obligatoire et vérifié ici : un
-- appel direct à l'API ne contourne rien.
--   p_telephone  au format international (+237 6 77 12 34 56 → +237677123456) ;
--                au Cameroun, neuf chiffres commençant par 6 (mobile) ou 2 (fixe)
--   p_naissance  18 ans révolus (un service financier), au plus 120 ans
--   p_pays       code ISO à deux lettres (CM, GA, FR…)
create or replace function ouvrir_mon_compte(p_prenom text, p_nom text, p_naissance date, p_telephone text, p_ville text, p_pays text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email  text := _email_prouve();
  v_prenom text := _nom_propre(p_prenom);
  v_nom    text := _nom_propre(p_nom);
  v_ville  text := _nom_propre(p_ville);
  v_pays   text := upper(trim(coalesce(p_pays, '')));
  v_tel    text := regexp_replace(coalesce(p_telephone, ''), '[^0-9+]', '', 'g');
  v_age    int;
  v_c      comptes;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  if v_email is null then raise exception 'adresse e-mail non vérifiée' using detail = 'entrez le code reçu par e-mail'; end if;
  if exists (select 1 from comptes where id = auth.uid()) then raise exception 'compte déjà ouvert'; end if;

  if v_prenom is null then raise exception 'prénom invalide' using detail = 'des lettres, de 2 à 60'; end if;
  if v_nom is null then raise exception 'nom invalide' using detail = 'des lettres, de 2 à 60'; end if;

  if p_naissance is null then raise exception 'date de naissance manquante'; end if;
  v_age := extract(year from age((now() at time zone 'Africa/Douala')::date, p_naissance))::int;
  if p_naissance > (now() at time zone 'Africa/Douala')::date or v_age > 120 then raise exception 'date de naissance invalide'; end if;
  if v_age < 18 then raise exception 'il faut avoir 18 ans' using detail = 'Glisil est un service financier'; end if;

  if v_tel !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'numéro de téléphone invalide' using detail = 'au format international, avec l''indicatif'; end if;
  if v_tel like '+237%' and v_tel !~ '^\+237[62][0-9]{8}$' then
    raise exception 'numéro de téléphone invalide' using detail = 'au Cameroun : neuf chiffres, commençant par 6 ou 2';
  end if;
  if exists (select 1 from comptes where telephone = v_tel) then
    raise exception 'ce numéro est déjà utilisé' using detail = 'il appartient à un autre compte';
  end if;

  if v_ville is null then raise exception 'ville invalide' using detail = 'des lettres, de 2 à 60'; end if;
  if v_pays !~ '^[A-Z]{2}$' then raise exception 'pays invalide'; end if;

  insert into comptes (id, telephone, email, prenom, nom_de_famille, nom, date_naissance, ville, pays)
  values (auth.uid(), v_tel, v_email, v_prenom, v_nom, v_prenom || ' ' || v_nom, p_naissance, v_ville, v_pays)
  returning * into v_c;
  return _compte_json(v_c);
exception
  when unique_violation then raise exception 'ce numéro ou cette adresse est déjà utilisé';
end $$;

-- ───────────────────────── entrer dans l'administration ─────────────────────
-- Pas de mot de passe ici non plus. Le super administrateur INVITE une
-- adresse ; la personne entre son adresse, reçoit un code, et à son premier
-- passage l'invitation devient sa fiche d'administrateur. Le code a prouvé
-- l'adresse : c'est la seule chose qui lie la personne à l'invitation.
create table if not exists administrateurs_invites (
  email     text primary key check (email = lower(trim(email)) and email like '%_@_%._%'),
  nom       text not null,
  role      text not null check (role in ('super_admin', 'operateur', 'tresorier', 'support')),
  invite_le timestamptz not null default now(),
  invite_par uuid
);
alter table administrateurs_invites enable row level security;
revoke all on table administrateurs_invites from public, anon, authenticated;
grant all on table administrateurs_invites to service_role;

-- Rend la fiche de l'administrateur connecté (comme mon_profil_admin), après
-- avoir transformé son invitation s'il en a une. NULL : cette adresse
-- n'administre pas Glisil.
create or replace function entrer_administration() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_email text := _email_prouve(); v_inv administrateurs_invites;
begin
  if auth.uid() is null or v_email is null then return null; end if;
  if not exists (select 1 from administrateurs where id = auth.uid()) then
    delete from administrateurs_invites where email = v_email returning * into v_inv;
    if found then
      insert into administrateurs (id, email, nom, role) values (auth.uid(), v_email, v_inv.nom, v_inv.role)
      on conflict do nothing;
      insert into journal_admin (admin_id, action, cible, detail)
      values (auth.uid(), 'invitation_acceptee', v_email, jsonb_build_object('role', v_inv.role, 'invite_par', v_inv.invite_par));
    end if;
  end if;
  return mon_profil_admin();
end $$;

-- Inviter quelqu'un : le droit « administrateurs » seulement (le super admin).
create or replace function admin_inviter_administrateur(p_email text, p_nom text, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(coalesce(p_email, '')));
begin
  perform _exiger_droit('administrateurs');
  if v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'adresse e-mail invalide'; end if;
  if length(trim(coalesce(p_nom, ''))) < 2 then raise exception 'nom manquant'; end if;
  if p_role not in ('super_admin', 'operateur', 'tresorier', 'support') then raise exception 'rôle inconnu'; end if;
  if exists (select 1 from administrateurs where lower(email) = v_email) then raise exception 'cette adresse administre déjà'; end if;
  insert into administrateurs_invites (email, nom, role, invite_par) values (v_email, trim(p_nom), p_role, auth.uid())
  on conflict (email) do update set nom = excluded.nom, role = excluded.role, invite_le = now(), invite_par = excluded.invite_par;
  perform _journaliser('administrateur_invite', v_email, jsonb_build_object('role', p_role));
  return jsonb_build_object('email', v_email, 'nom', trim(p_nom), 'role', p_role);
end $$;

-- ──────────────────────────────── les droits ───────────────────────────────
-- Chez Supabase, une fonction nouvelle est ouverte à tous par défaut : on
-- referme d'abord, puis on ouvre aux comptes connectés ce qui leur revient.
revoke all on function _nom_propre(text), _email_prouve(), ouvrir_mon_compte(text, text, date, text, text, text),
                       entrer_administration(), admin_inviter_administrateur(text, text, text)
  from public, anon, authenticated;
grant execute on function ouvrir_mon_compte(text, text, date, text, text, text), entrer_administration(),
                          admin_inviter_administrateur(text, text, text)
  to authenticated;
grant execute on function _nom_propre(text), _email_prouve(), ouvrir_mon_compte(text, text, date, text, text, text),
                          entrer_administration(), admin_inviter_administrateur(text, text, text)
  to service_role;
$sql$;
    raise notice '0009_inscription_par_email.sql : appliquée';
  end if;
end $consolide$;

-- ─── 0010_vue_clients.sql (md5 e8666fd37bc5719815f11a413ebf79e0) ───
-- déjà en place si : rejouable telle quelle
do $consolide$
begin
  if false then
    raise notice '0010_vue_clients.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0010 · la vue d'ensemble des clients, pour l'équipe          ║
-- ║  Combien de clients, combien vivent vraiment, qui vient d'arriver ; la ║
-- ║  liste qui se filtre et se cherche par nom, e-mail ou numéro ; la      ║
-- ║  fiche complète d'un client, profil, connexions et tout son historique.║
-- ║  Tout passe par le droit « clients ».                                  ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- Un client ACTIF a bougé de l'argent dans les 30 derniers jours (une
-- écriture sur son compte) : se connecter sans rien faire ne compte pas.
create or replace function _derniere_operation(p_compte uuid) returns timestamptz language sql stable as $$
  select max(cree_le) from ecritures where compte_id = p_compte
$$;

create or replace function _derniere_connexion(p_compte uuid) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare v timestamptz;
begin
  if to_regclass('auth.users') is null then return null; end if;
  execute 'select last_sign_in_at from auth.users where id = $1' into v using p_compte;
  return v;
exception when undefined_column then return null;
end $$;

-- Les chiffres en tête de la page Clients.
create or replace function admin_statistiques_clients() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_inacheves int := 0;
begin
  perform _exiger_droit('clients');
  -- des personnes ont prouvé leur adresse e-mail, mais n'ont pas fini leur profil
  if to_regclass('auth.users') is not null then
    execute $q$select count(*) from auth.users u
                where u.email_confirmed_at is not null
                  and not exists (select 1 from comptes c where c.id = u.id)
                  and not exists (select 1 from administrateurs a where a.id = u.id)$q$ into v_inacheves;
  end if;
  select jsonb_build_object(
    'total',            count(*),
    'actifs_30j',       count(*) filter (where c.desactive_le is null and exists (select 1 from ecritures e where e.compte_id = c.id and e.cree_le > now() - interval '30 days')),
    'connectes_7j',     count(*) filter (where _derniere_connexion(c.id) > now() - interval '7 days'),
    'nouveaux_7j',      count(*) filter (where c.cree_le > now() - interval '7 days'),
    'nouveaux_30j',     count(*) filter (where c.cree_le > now() - interval '30 days'),
    'verifies',         count(*) filter (where c.palier >= 1),
    'en_verification',  count(*) filter (where c.verification_en_cours is not null),
    'desactives',       count(*) filter (where c.desactive_le is not null),
    'inscriptions_inachevees', v_inacheves,
    'par_pays',         (select coalesce(jsonb_object_agg(pays, n), '{}'::jsonb) from (select coalesce(pays, '?') pays, count(*) n from comptes where not maison group by 1) p),
    'inscriptions_30j', (select coalesce(jsonb_agg(jsonb_build_object('jour', j, 'n', n) order by j), '[]'::jsonb) from (
                           select d::date j, (select count(*) from comptes x where not x.maison and (x.cree_le at time zone 'Africa/Douala')::date = d::date) n
                             from generate_series((now() at time zone 'Africa/Douala')::date - 29, (now() at time zone 'Africa/Douala')::date, interval '1 day') d) s))
    into r from comptes c where not c.maison;
  return r;
end $$;

-- La liste : cherchée par nom, e-mail ou numéro ; filtrée par état.
--   p_filtre : null (tous) · actifs · inactifs · nouveaux · verifications · desactives
create or replace function admin_clients(p_recherche text default null, p_n int default 100, p_filtre text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_q text := nullif(trim(coalesce(p_recherche, '')), ''); v_chiffres text;
begin
  perform _exiger_droit('clients');
  v_chiffres := regexp_replace(coalesce(v_q, ''), '[^0-9]', '', 'g');
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'entreprise', c.entreprise, 'palier', c.palier,
                            'email', c.email, 'ville', c.ville, 'pays', c.pays,
                            'verification_en_cours', c.verification_en_cours, 'cree_le', c.cree_le, 'desactive_le', c.desactive_le,
                            'derniere_operation', c.derniere_operation, 'derniere_connexion', _derniere_connexion(c.id),
                            'xafe', (select coalesce(disponible + bloque, 0) from soldes where compte_id = c.id and actif = 'XAFe'),
                            'usdt', (select coalesce(disponible + bloque, 0) from soldes where compte_id = c.id and actif = 'USDT')) order by c.cree_le desc), '[]'::jsonb)
    into r
    from (select x.*, _derniere_operation(x.id) derniere_operation from comptes x where not x.maison
             and (p_filtre is null
                  or (p_filtre = 'verifications' and x.verification_en_cours is not null)
                  or (p_filtre = 'desactives' and x.desactive_le is not null)
                  or (p_filtre = 'nouveaux' and x.cree_le > now() - interval '7 days')
                  or (p_filtre = 'actifs' and x.desactive_le is null and exists (select 1 from ecritures e where e.compte_id = x.id and e.cree_le > now() - interval '30 days'))
                  or (p_filtre = 'inactifs' and x.desactive_le is null and not exists (select 1 from ecritures e where e.compte_id = x.id and e.cree_le > now() - interval '30 days')))
             and (v_q is null
                  or (length(v_chiffres) >= 3 and regexp_replace(coalesce(x.telephone, ''), '[^0-9]', '', 'g') like '%' || v_chiffres || '%')
                  or x.nom ilike '%' || v_q || '%' or x.entreprise ilike '%' || v_q || '%' or x.email ilike '%' || v_q || '%'
                  or x.ville ilike '%' || v_q || '%')
           order by x.cree_le desc limit least(greatest(coalesce(p_n, 100), 1), 500)) c;
  return r;
end $$;

-- La fiche : le profil complet, les connexions, et tout l'historique.
create or replace function admin_client(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('clients');
  select jsonb_build_object(
    'compte', _compte_json(c) || jsonb_build_object('cree_le', c.cree_le, 'desactive_le', c.desactive_le, 'verification_pieces', c.verification_pieces,
                                                    'code_verrou_jusqua', c.code_verrou_jusqua, 'derniere_connexion', _derniere_connexion(c.id),
                                                    'derniere_operation', _derniere_operation(c.id)),
    'soldes', (select coalesce(jsonb_object_agg(actif, jsonb_build_object('disponible', disponible, 'bloque', bloque)), '{}'::jsonb) from soldes where compte_id = c.id),
    'numeros', (select coalesce(jsonb_agg(_numero_json(n) order by n.verifie_le), '[]'::jsonb) from numeros n where n.compte_id = c.id),
    'totaux', jsonb_build_object(
       'entre_xaf',   (select coalesce(sum(montant), 0) from depot_declarations where compte_id = c.id and etat = 'credite'),
       'sorti_xaf',   (select coalesce(sum(montant_envoye), 0) from sorties where compte_id = c.id and etat in ('envoyee', 'partielle')),
       'ordres',      (select count(*) from ordres where compte_id = c.id),
       'retraits_crypto', (select count(*) from retraits_crypto where compte_id = c.id)),
    'depots', (select coalesce(jsonb_agg(_depot_json(d) order by d.cree_le desc), '[]'::jsonb) from (select * from depots where compte_id = c.id order by cree_le desc limit 50) d),
    'sorties', (select coalesce(jsonb_agg(_sortie_json(s) order by s.cree_le desc), '[]'::jsonb) from (select * from sorties where compte_id = c.id order by cree_le desc limit 50) s),
    'ordres', (select coalesce(jsonb_agg(_ordre_json(o) order by o.cree_le desc), '[]'::jsonb) from (select * from ordres where compte_id = c.id order by cree_le desc limit 50) o),
    'retraits_crypto', (select coalesce(jsonb_agg(_retrait_json(x) order by x.cree_le desc), '[]'::jsonb) from (select * from retraits_crypto where compte_id = c.id order by cree_le desc limit 50) x),
    'transferts_crypto', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'actif', t.actif, 'reseau', t.reseau, 'sens', t.sens, 'montant', t.montant,
                                                                        'adresse', t.adresse, 'tx_hash', t.tx_hash, 'cree_le', t.cree_le) order by t.cree_le desc), '[]'::jsonb)
                            from (select * from transferts_crypto where compte_id = c.id order by cree_le desc limit 50) t),
    'ecritures', (select coalesce(jsonb_agg(jsonb_build_object('actif', e.actif, 'disponible', e.disponible_delta, 'bloque', e.bloque_delta, 'nature', e.nature, 'source', e.source_id, 'quand', e.cree_le) order by e.cree_le desc), '[]'::jsonb)
                    from (select * from ecritures where compte_id = c.id order by cree_le desc limit 100) e))
    into r from comptes c where c.id = p_id;
  return r;
end $$;

revoke all on function _derniere_operation(uuid), _derniere_connexion(uuid), admin_statistiques_clients() from public, anon, authenticated;
grant execute on function admin_statistiques_clients() to authenticated;
grant execute on function _derniere_operation(uuid), _derniere_connexion(uuid), admin_statistiques_clients() to service_role;
$sql$;
    raise notice '0010_vue_clients.sql : appliquée';
  end if;
end $consolide$;

-- ─── 0011_equipe.sql (md5 d0e4ade586a3608363c5ec34cfeb5577) ───
-- déjà en place si : rejouable telle quelle
do $consolide$
begin
  if false then
    raise notice '0011_equipe.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0011 · l'équipe                                              ║
-- ║  Le super administrateur voit qui administre, qui est invité, quand    ║
-- ║  chacun est venu pour la dernière fois ; il invite, retire une         ║
-- ║  invitation, change un rôle, met en pause. Tout par le droit           ║
-- ║  « administrateurs », et jamais sur soi-même.                          ║
-- ╚════════════════════════════════════════════════════════════════════════╝

create or replace function admin_equipe() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('administrateurs');
  return jsonb_build_object(
    'administrateurs', (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', a.id, 'email', a.email, 'nom', a.nom, 'role', a.role, 'actif', a.actif, 'cree_le', a.cree_le,
                          'derniere_connexion', _derniere_connexion(a.id), 'moi', a.id = auth.uid())
                        order by a.actif desc, a.cree_le), '[]'::jsonb) from administrateurs a),
    'invitations', (select coalesce(jsonb_agg(jsonb_build_object('email', i.email, 'nom', i.nom, 'role', i.role, 'invite_le', i.invite_le)
                        order by i.invite_le desc), '[]'::jsonb) from administrateurs_invites i));
end $$;

create or replace function admin_retirer_invitation(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('administrateurs');
  delete from administrateurs_invites where email = lower(trim(coalesce(p_email, '')));
  if not found then raise exception 'invitation inconnue'; end if;
  perform _journaliser('invitation_retiree', lower(trim(p_email)));
  return jsonb_build_object('ok', true);
end $$;

-- Changer le rôle d'un autre : jamais le sien (on ne s'enlève pas ses propres droits
-- par mégarde, et le dernier super administrateur reste super administrateur).
create or replace function admin_changer_role(p_id uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_avant text;
begin
  perform _exiger_droit('administrateurs');
  if p_id = auth.uid() then raise exception 'on ne change pas son propre rôle'; end if;
  if p_role not in ('super_admin', 'operateur', 'tresorier', 'support') then raise exception 'rôle inconnu'; end if;
  select role into v_avant from administrateurs where id = p_id for update;
  if not found then raise exception 'administrateur inconnu'; end if;
  update administrateurs set role = p_role where id = p_id;
  perform _journaliser('changer_role', p_id::text, jsonb_build_object('avant', v_avant, 'apres', p_role));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function admin_equipe(), admin_retirer_invitation(text), admin_changer_role(uuid, text) from public, anon, authenticated;
grant execute on function admin_equipe(), admin_retirer_invitation(text), admin_changer_role(uuid, text) to authenticated, service_role;
$sql$;
    raise notice '0011_equipe.sql : appliquée';
  end if;
end $consolide$;

-- ─── 0012_garde_fous.sql (md5 1be4cb74e3f5645d1e580e74595e7b22) ───
-- déjà en place si : rejouable telle quelle
do $consolide$
begin
  if false then
    raise notice '0012_garde_fous.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0012 · les garde-fous d'avant les premiers clients           ║
-- ║  · chaque fonction de la base a son chemin de recherche FIGÉ ;         ║
-- ║  · les tables ne s'exposent plus par GraphQL (on ne s'en sert pas) ;   ║
-- ║  · les conditions d'utilisation : leur version est acceptée à          ║
-- ║    l'inscription et gardée avec la date ;                              ║
-- ║  · le client peut FERMER son compte lui-même, une fois tout son        ║
-- ║    argent sorti et rien en cours ;                                     ║
-- ║  · le contact du support est un paramètre que l'équipe règle.          ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────── le chemin figé ────────────────────────────────
-- Une fonction sans « set search_path » cherche ses tables et ses fonctions
-- dans le chemin de CELUI QUI L'APPELLE. Quiconque peut créer un objet dans
-- un schéma placé avant « public » pourrait lui faire appeler le sien. On
-- fige donc le chemin de toutes nos fonctions — celles des extensions restent
-- à leurs propriétaires. Un scénario du moteur (12.1) vérifie qu'il n'en
-- reste aucune, y compris celles qu'une migration future ajouterait.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as f
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
       and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', r.f);
  end loop;
end $$;

-- ───────────────────────────── GraphQL ─────────────────────────────────────
-- Les applications parlent à la base par les fonctions (RPC) et le temps
-- réel ; GraphQL ne sert à rien ici, et il montre la forme de toutes les
-- tables à n'importe quel compte connecté. Il se réactive en un clic
-- (Database → Extensions) si un jour on en a besoin.
do $$
begin
  drop extension if exists pg_graphql;
exception when insufficient_privilege or dependent_objects_still_exist then
  raise notice 'pg_graphql n''a pas pu être retiré (%) : le désactiver dans Database → Extensions', sqlerrm;
end $$;

-- ─────────────────────── le compte : nouvelles colonnes ─────────────────────
alter table comptes add column if not exists conditions_version      text;
alter table comptes add column if not exists conditions_acceptees_le timestamptz;
alter table comptes add column if not exists ferme_le                timestamptz;
alter table comptes add column if not exists fermeture_motif         text;

-- La version en vigueur des conditions d'utilisation et de la politique de
-- confidentialité. Le texte vit dans l'application (/conditions,
-- /confidentialite) ; quand il change, on change AUSSI cette version, et
-- chaque client la réaccepte à sa prochaine ouverture.
-- Le support : ce que l'écran d'aide propose (WhatsApp, e-mail).
insert into parametres (cle, valeur) values
  ('conditions', '{"version": "2026-10-16"}'),
  ('support', '{"email": "support@glisil.com", "whatsapp": null}')
on conflict (cle) do nothing;

create or replace function _compte_json(c comptes) returns jsonb language sql stable
set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'entreprise', c.entreprise, 'palier', c.palier,
                            'email', c.email, 'prenom', c.prenom, 'nom_de_famille', c.nom_de_famille,
                            'date_naissance', c.date_naissance, 'ville', c.ville, 'pays', c.pays,
                            'a_code', exists (select 1 from codes_secrets k where k.compte_id = c.id), 'verrou_jusqua', c.code_verrou_jusqua,
                            'verification_en_cours', c.verification_en_cours,
                            'conditions_version', c.conditions_version, 'conditions_acceptees_le', c.conditions_acceptees_le,
                            'conditions_a_jour', c.maison or c.conditions_version is not distinct from (parametre('conditions') ->> 'version'),
                            'ferme_le', c.ferme_le, 'desactive', c.desactive_le is not null,
                            -- ce qui est déjà entré aujourd'hui : l'écran montre ce qui RESTE du plafond, pas le plafond
                            'entre_du_jour', (select coalesce(sum(montant), 0) from depot_declarations
                                               where compte_id = c.id and etat = 'credite' and credite_le >= debut_du_jour()))
$$;

-- Un compte désactivé par l'équipe, ou fermé par son titulaire, ne fait plus
-- aucun geste. Le message le dit dans les deux cas.
create or replace function _exiger_compte_actif(p_compte uuid) returns void
language plpgsql set search_path = public, extensions, pg_temp as $$
declare v_c comptes;
begin
  if p_compte is null then raise exception 'non connecté'; end if;
  select * into v_c from comptes where id = p_compte;
  if v_c.ferme_le is not null then
    raise exception 'compte fermé' using detail = 'contactez le support Glisil pour le rouvrir';
  end if;
  if v_c.desactive_le is not null then
    raise exception 'compte désactivé' using detail = 'contactez le support Glisil';
  end if;
end $$;

-- ───────────────────── ouvrir son compte, conditions comprises ──────────────
-- Même fonction que 0009, avec un septième argument : la version des
-- conditions que la personne a lues et acceptées. Une autre version — ou
-- aucune — n'ouvre rien : l'acceptation est une preuve, datée par la base.
drop function if exists ouvrir_mon_compte(text, text, date, text, text, text);
create or replace function ouvrir_mon_compte(p_prenom text, p_nom text, p_naissance date, p_telephone text, p_ville text, p_pays text, p_conditions text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email  text := _email_prouve();
  v_prenom text := _nom_propre(p_prenom);
  v_nom    text := _nom_propre(p_nom);
  v_ville  text := _nom_propre(p_ville);
  v_pays   text := upper(trim(coalesce(p_pays, '')));
  v_tel    text := regexp_replace(coalesce(p_telephone, ''), '[^0-9+]', '', 'g');
  v_age    int;
  v_c      comptes;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  if v_email is null then raise exception 'adresse e-mail non vérifiée' using detail = 'entrez le code reçu par e-mail'; end if;
  if exists (select 1 from comptes where id = auth.uid()) then raise exception 'compte déjà ouvert'; end if;

  if v_prenom is null then raise exception 'prénom invalide' using detail = 'des lettres, de 2 à 60'; end if;
  if v_nom is null then raise exception 'nom invalide' using detail = 'des lettres, de 2 à 60'; end if;

  if p_naissance is null then raise exception 'date de naissance manquante'; end if;
  v_age := extract(year from age((now() at time zone 'Africa/Douala')::date, p_naissance))::int;
  if p_naissance > (now() at time zone 'Africa/Douala')::date or v_age > 120 then raise exception 'date de naissance invalide'; end if;
  if v_age < 18 then raise exception 'il faut avoir 18 ans' using detail = 'Glisil est un service financier'; end if;

  if v_tel !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'numéro de téléphone invalide' using detail = 'au format international, avec l''indicatif'; end if;
  if v_tel like '+237%' and v_tel !~ '^\+237[62][0-9]{8}$' then
    raise exception 'numéro de téléphone invalide' using detail = 'au Cameroun : neuf chiffres, commençant par 6 ou 2';
  end if;
  if exists (select 1 from comptes where telephone = v_tel) then
    raise exception 'ce numéro est déjà utilisé' using detail = 'il appartient à un autre compte';
  end if;

  if v_ville is null then raise exception 'ville invalide' using detail = 'des lettres, de 2 à 60'; end if;
  if v_pays !~ '^[A-Z]{2}$' then raise exception 'pays invalide'; end if;

  if p_conditions is distinct from (parametre('conditions') ->> 'version') then
    raise exception 'conditions non acceptées' using detail = 'lisez et acceptez les conditions en vigueur';
  end if;

  insert into comptes (id, telephone, email, prenom, nom_de_famille, nom, date_naissance, ville, pays, conditions_version, conditions_acceptees_le)
  values (auth.uid(), v_tel, v_email, v_prenom, v_nom, v_prenom || ' ' || v_nom, p_naissance, v_ville, v_pays, p_conditions, now())
  returning * into v_c;
  return _compte_json(v_c);
exception
  when unique_violation then raise exception 'ce numéro ou cette adresse est déjà utilisé';
end $$;

-- Quand les conditions changent : le client relit et accepte la nouvelle
-- version, une fois. Rien d'autre ne change sur son compte.
create or replace function accepter_conditions(p_version text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c comptes;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  if p_version is distinct from (parametre('conditions') ->> 'version') then
    raise exception 'conditions non acceptées' using detail = 'ce ne sont pas les conditions en vigueur';
  end if;
  update comptes set conditions_version = p_version, conditions_acceptees_le = now()
   where id = auth.uid() returning * into v_c;
  if not found then raise exception 'compte inconnu'; end if;
  return _compte_json(v_c);
end $$;

-- ───────────────────────────── fermer son compte ───────────────────────────
-- Le client ferme lui-même son compte (exigence du Play Store, et respect
-- élémentaire). Seulement quand plus rien ne lui appartient chez nous : tout
-- son argent sorti, aucune opération en cours, rien que l'équipe lui doive.
-- On ne fait pas disparaître l'argent d'un client parce qu'il a appuyé sur
-- un bouton.
--
-- Fermer n'efface pas : la loi impose de garder les traces des opérations
-- (lutte contre le blanchiment), et la politique de confidentialité le dit.
-- Le compte ne peut plus rien faire ; l'équipe peut le rouvrir à sa demande.
--
-- Le code secret est exigé, comme pour une sortie. Il est contrôlé APRÈS les
-- conditions : on ne fait pas taper un code pour s'entendre dire non.
create or replace function fermer_mon_compte(p_code text, p_motif text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c comptes; v jsonb; v_reste text;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  select * into v_c from comptes where id = auth.uid() and not maison for no key update;
  if not found then raise exception 'compte inconnu'; end if;
  if v_c.ferme_le is not null then raise exception 'compte déjà fermé'; end if;

  select string_agg(format('%s %s', to_char(disponible + bloque, 'FM999G999G999G990D00'), actif), ', ')
    into v_reste from soldes where compte_id = v_c.id and disponible + bloque > 0;
  if v_reste is not null then
    raise exception 'il reste de l''argent sur le compte' using detail = format('sortez d''abord : %s', v_reste);
  end if;
  if exists (select 1 from ordres where compte_id = v_c.id and etat in ('ouvert', 'partiel'))
     or exists (select 1 from depots where compte_id = v_c.id and etat = 'en_attente')
     or exists (select 1 from depot_declarations where compte_id = v_c.id and etat = 'attendu')
     or exists (select 1 from sorties where compte_id = v_c.id and etat in ('en_attente', 'en_cours'))
     or exists (select 1 from retraits_crypto where compte_id = v_c.id and etat in ('en_attente', 'en_cours')) then
    raise exception 'une opération est en cours' using detail = 'attendez qu''elle se termine, ou annulez-la';
  end if;
  -- un paiement reçu sur un de ses dossiers, retenu (palier, ID partagé) : il est à lui
  if exists (select 1 from entrees_retenues r join depots d on d.id = r.depot_id
              where d.compte_id = v_c.id and r.etat = 'retenue') then
    raise exception 'un remboursement vous est dû' using detail = 'l''équipe doit d''abord vous rembourser';
  end if;

  v := _controler_code(v_c.id, p_code);
  if not (v ->> 'ok')::boolean then return v; end if;

  update comptes set ferme_le = now(), desactive_le = coalesce(desactive_le, now()),
                     fermeture_motif = nullif(left(trim(coalesce(p_motif, '')), 500), '')
   where id = v_c.id returning * into v_c;
  return jsonb_build_object('ok', true, 'compte', _compte_json(v_c));
end $$;

-- L'équipe rouvre un compte fermé comme elle réactive un compte désactivé :
-- « réactiver » efface aussi la fermeture.
create or replace function admin_desactiver_compte(p_id uuid, p_actif boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('clients');
  update comptes set desactive_le = case when p_actif then null else now() end,
                     ferme_le = case when p_actif then null else ferme_le end
   where id = p_id and not maison;
  if not found then raise exception 'compte inconnu'; end if;
  perform _journaliser(case when p_actif then 'reactiver_compte' else 'desactiver_compte' end, p_id::text, jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true);
end $$;

-- ─────────────────────── ce que l'écran peut lire ──────────────────────────
create or replace function parametres_publics() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'frais', parametre('frais'),
    'marche', parametre('marche'),
    'paliers', parametre('paliers'),
    'rapide', jsonb_build_object('marge', parametre('rapide') -> 'marge', 'ouvert', coalesce((parametre('rapide') ->> 'ouvert')::boolean, false),
                                 'validite_secondes', parametre('rapide') -> 'validite_secondes'),
    'crypto', jsonb_build_object('frais', parametre('crypto') -> 'frais',
                                 'retraits_ouverts', coalesce((parametre('crypto') ->> 'retraits_ouverts')::boolean, false)),
    'operateurs', (select jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'plafond_par_transfert', plafond_par_transfert,
                                                       'plafond_jour', plafond_jour) order by id) from operateurs),
    'conditions', parametre('conditions'),
    'support', parametre('support'))
   where auth.uid() is not null
$$;

-- ─────────────────── l'équipe règle le support et les conditions ────────────
create or replace function _verifier_parametre(p_cle text, v jsonb) returns void
language plpgsql set search_path = public, extensions, pg_temp as $$
declare k text; p jsonb; ok boolean;
begin
  if jsonb_typeof(v) <> 'object' then raise exception 'paramètre invalide' using detail = 'un objet JSON est attendu'; end if;
  ok := case p_cle
    when 'frais' then _nombre_entre(v -> 'placeur', 0, 0.05) and _nombre_entre(v -> 'preneur', 0, 0.05) and _nombre_entre(v -> 'sortie', 0, 0.05)
    when 'marche' then v ->> 'paire' = 'USDT/XAFe' and _nombre_entre(v -> 'pas_prix', 0.01, 100) and _nombre_entre(v -> 'quantite_min', 0.01, 1000000)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
    when 'depot' then _nombre_entre(v -> 'validite_minutes', 5, 1440, true) and _nombre_entre(v -> 'grace_minutes', 0, 10080, true)
    when 'sortie' then _nombre_entre(v -> 'reprises_max', 1, 10, true)
    when 'rapide' then _nombre_entre(v -> 'marge', 0, 0.2) and _nombre_entre(v -> 'validite_secondes', 5, 120, true)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
    when 'code_secret' then _nombre_entre(v -> 'essais', 1, 10, true) and _nombre_entre(v -> 'verrou_minutes', 1, 1440, true)
                       and _nombre_entre(v -> 'longueur_min', 4, 6, true) and _nombre_entre(v -> 'longueur_max', 4, 8, true)
                       and (v ->> 'longueur_min')::int <= (v ->> 'longueur_max')::int
    when 'crypto' then _nombre_entre(v -> 'frais' -> 'USDT', 0, 1000) and _nombre_entre(v -> 'frais' -> 'XAFe', 0, 1000000)
                       and _nombre_entre(v -> 'confirmations' -> 'bep20', 1, 1000, true) and _nombre_entre(v -> 'confirmations' -> 'trc20', 1, 1000, true)
                       and jsonb_typeof(v -> 'retraits_ouverts') = 'boolean'
    when 'paliers' then (select bool_and(x) from (values (v ? '0'), (v ? '1'), (v ? '2')) t(x))
    -- une date AAAA-MM-JJ : la version se lit, et se compare
    when 'conditions' then coalesce(v ->> 'version', '') ~ '^\d{4}-\d{2}-\d{2}$'
    -- une adresse e-mail, et un numéro WhatsApp au format international ou null
    when 'support' then coalesce(v ->> 'email', '') ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'
                        and (jsonb_typeof(v -> 'whatsapp') = 'null' or coalesce(v ->> 'whatsapp', '') ~ '^\+[1-9][0-9]{7,14}$')
    else false end;
  if p_cle = 'paliers' and ok then
    foreach k in array array['0', '1', '2'] loop
      p := v -> k;
      if jsonb_typeof(p) = 'null' then continue; end if;
      if not (jsonb_typeof(p) = 'object' and _nombre_entre(p -> 'entree_jour', 0, 1e12, true) and _nombre_entre(p -> 'sortie_jour', 0, 1e12, true)) then
        ok := false;
      end if;
    end loop;
  end if;
  if not coalesce(ok, false) then
    raise exception 'paramètre invalide' using detail = format('« %s » : une clé manque, ou une valeur sort de ses bornes', p_cle);
  end if;
end $$;

create or replace function admin_modifier_parametre(p_cle text, p_valeur jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('parametres');
  if p_cle not in ('frais', 'marche', 'depot', 'sortie', 'paliers', 'crypto', 'code_secret', 'rapide', 'conditions', 'support') then
    raise exception 'paramètre inconnu';
  end if;
  perform _verifier_parametre(p_cle, p_valeur);
  update parametres set valeur = p_valeur where cle = p_cle;
  if not found then raise exception 'paramètre inconnu'; end if;
  perform _journaliser('modifier_parametre', p_cle, p_valeur);
  return jsonb_build_object('ok', true);
end $$;

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on function ouvrir_mon_compte(text, text, date, text, text, text, text), accepter_conditions(text),
                       fermer_mon_compte(text, text)
  from public, anon, authenticated;
grant execute on function ouvrir_mon_compte(text, text, date, text, text, text, text), accepter_conditions(text),
                          fermer_mon_compte(text, text)
  to authenticated, service_role;
-- les fonctions internes redéfinies ici gardent leurs droits ; on le redit
revoke all on function _compte_json(comptes), _exiger_compte_actif(uuid), _verifier_parametre(text, jsonb) from public, anon, authenticated;
$sql$;
    raise notice '0012_garde_fous.sql : appliquée';
  end if;
end $consolide$;

-- ─── 0013_depot_declare.sql (md5 5384df8fa99a8a1eab54be15d0323c91) ───
-- déjà en place si : rejouable telle quelle
do $consolide$
begin
  if false then
    raise notice '0013_depot_declare.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0013 · un dépôt se déclare en entier                          ║
-- ║  Le client donne, pour chaque paiement : le numéro qui a payé, le nom,  ║
-- ║  le transaction ID et le montant exact. Le crédit n'est automatique que ║
-- ║  si le SMS lu par TOTEM dit la MÊME chose — même ID, même numéro, même  ║
-- ║  montant. Sinon le paiement reste retenu : le client corrige (trois     ║
-- ║  fois au plus), ou l'équipe tranche. Personne n'est crédité au hasard.  ║
-- ║  Et un float porte le nom de son titulaire, que l'écran montre : « nom  ║
-- ║  différent ? ne confirmez pas ». Et deux interrupteurs de plus, pour    ║
-- ║  ouvrir Glisil par les dépôts d'abord : sorties, dépôts crypto.         ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────── les floats ────────────────────────────────
-- Le nom que le client voit sur SON téléphone avant de confirmer un
-- transfert (« NORTON GAUSS BONZINI SARL 1 », « WONDER PHONE ») : s'il lit
-- autre chose, il ne paie pas.
alter table floats add column if not exists titulaire text;

-- ─────────────────────────── ce que le client déclare ──────────────────────
alter table depot_declarations add column if not exists numero_declare  text;
alter table depot_declarations add column if not exists montant_declare numeric(20,2);
alter table depot_declarations add column if not exists nom_declare     text;
-- vrai : le refus vient d'un numéro ou d'un montant qui ne concorde pas, et le client peut corriger
alter table depot_declarations add column if not exists corrigible      boolean not null default false;
alter table depot_declarations add column if not exists essais          int not null default 1;

-- La règle stricte est la règle : numéro, montant et nom sont exigés à la
-- déclaration. Le paramètre existe pour le dire, pas pour l'éteindre.
update parametres set valeur = valeur || '{"declaration_complete": true}'
 where cle = 'depot' and not (valeur ? 'declaration_complete');

create or replace function _depot_json(d depots) returns jsonb
language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object(
    'reference', d.reference, 'etat', d.etat, 'operateur', d.operateur,
    'montant_recu', d.montant_recu,
    'float_numero', f.numero,
    'titulaire', f.titulaire,
    'code_agent', f.code_agent,
    'reception', case when not coalesce(f.actif, false) then 'fermee'
                      when t.vu_le is null or t.vu_le < now() - interval '10 minutes' then 'retardee'
                      else 'ouverte' end,
    'declarations', (select coalesce(jsonb_agg(_declaration_json(x) order by x.declare_le), '[]'::jsonb)
                       from depot_declarations x where x.depot_id = d.id),
    'cree_le', d.cree_le, 'expire_le', d.expire_le, 'credite_le', d.credite_le)
    from (select 1) _ left join floats f on f.id = d.float_id left join terminaux t on t.id = f.terminal
$$;

create or replace function _declaration_json(x depot_declarations) returns jsonb
language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', x.id, 'transaction_id', x.transaction_id, 'etat', x.etat, 'montant', x.montant,
                            'numero_payeur', x.numero_payeur, 'motif', x.motif, 'declare_le', x.declare_le, 'credite_le', x.credite_le,
                            'numero_declare', x.numero_declare, 'montant_declare', x.montant_declare, 'nom_declare', x.nom_declare,
                            'corrigible', x.corrigible and x.essais < 3,
                            'lu_le', (select p.cree_le from depot_paiements p where p.id = x.paiement_id))
$$;

-- ───────────────────────────── l'appariement ───────────────────────────────
-- Les règles de 0001 (le numéro vérifié sur un compte décide ; un ID tapé
-- avant le paiement ne vient pas de celui qui a payé ; plusieurs prétendants,
-- l'équipe tranche), plus deux : le numéro qui a payé et le montant reçu
-- doivent être ceux que le client a déclarés. Un écart se corrige (le client
-- s'est trompé d'un chiffre) mais ne crédite jamais : le motif ne dit PAS ce
-- que le SMS porte — il ne doit rien apprendre à qui tape des ID au hasard.
drop function if exists _apparier(text, text, text, timestamptz);
create or replace function _apparier(p_operateur text, p_tx text, p_payeur text, p_emis_le timestamptz, p_montant numeric default null)
returns jsonb language plpgsql set search_path = public, extensions, pg_temp as $$
declare
  v_proprio uuid := _proprietaire_du_numero(p_payeur);
  v_x       depot_declarations;
  v_elus    uuid[] := '{}';
  v_motif   text;
  v_corrigible boolean;
  v_vues    int := 0;
begin
  for v_x in select * from depot_declarations
              where operateur = p_operateur and transaction_id = p_tx and etat = 'attendu'
              order by declare_le, id for update loop
    v_vues := v_vues + 1;
    v_corrigible := false;
    if v_proprio is not null and v_x.compte_id <> v_proprio then
      v_motif := 'le numéro qui a payé est celui d''un autre compte : l''équipe vérifie';
    elsif p_emis_le is not null and v_x.declare_le < p_emis_le - interval '5 minutes' then
      v_motif := 'ce transaction ID a été tapé avant le paiement : l''équipe vérifie';
    elsif v_x.numero_declare is not null and p_payeur is not null and v_x.numero_declare <> p_payeur then
      v_motif := 'le numéro déclaré ne correspond pas au paiement reçu : vérifiez-le';
      v_corrigible := true;
    elsif v_x.montant_declare is not null and p_montant is not null and v_x.montant_declare <> p_montant then
      v_motif := 'le montant déclaré ne correspond pas au paiement reçu : vérifiez-le';
      v_corrigible := true;
    else
      v_elus := v_elus || v_x.id;
      continue;
    end if;
    if v_corrigible and v_x.essais >= 3 then
      v_motif := 'trois déclarations ne correspondent pas au paiement reçu : l''équipe vérifie';
      v_corrigible := false;
    end if;
    update depot_declarations set etat = 'refuse', motif = v_motif, corrigible = v_corrigible where id = v_x.id;
    perform _notifier(v_x.compte_id, case when v_corrigible then 'Dépôt à vérifier' else 'Transaction ID en vérification' end, v_motif || '.',
                      '/entrer/transaction/' || (select reference from depots where id = v_x.depot_id));
  end loop;

  if cardinality(v_elus) = 1 then return jsonb_build_object('id', v_elus[1]); end if;
  if cardinality(v_elus) > 1 then
    v_motif := 'plusieurs comptes ont tapé ce transaction ID : l''équipe vérifie';
    update depot_declarations set etat = 'refuse', motif = v_motif, corrigible = false where id = any (v_elus);
    perform _notifier(x.compte_id, 'Transaction ID en vérification', v_motif || '.', '/historique/' || d.reference)
       from depot_declarations x join depots d on d.id = x.depot_id where x.id = any (v_elus);
    return jsonb_build_object('motif', v_motif, 'bloquee', true);
  end if;
  -- un écart corrigible ne bloque pas le SMS : la déclaration corrigée le reprendra
  if v_vues > 0 then return jsonb_build_object('motif', v_motif, 'bloquee', false); end if;
  return '{}'::jsonb;
end $$;

-- ─────────────────────────── déclarer un paiement ──────────────────────────
-- p_numero    le numéro qui a payé (le sien, ou celui d'un proche), du même opérateur
-- p_montant   le montant EXACT envoyé, en francs entiers
-- p_nom       le nom du titulaire du compte qui a payé (pour l'équipe, quand elle vérifie)
-- Une déclaration refusée pour un écart se corrige en la redéclarant : même
-- ID, même dossier, de nouvelles valeurs — trois fois au plus.
drop function if exists declarer_transaction(text, text);
create or replace function declarer_transaction(p_reference text, p_transaction_id text, p_numero text default null,
                                                p_montant numeric default null, p_nom text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_compte  uuid := auth.uid();
  v_d       depots;
  v_x       depot_declarations;
  v_r       entrees_retenues;
  v_a       jsonb;
  v_id      text := normaliser_transaction_id(p_transaction_id);
  v_num     text := nullif(normaliser_numero(p_numero), '');
  v_nom     text := nullif(regexp_replace(trim(coalesce(p_nom, '')), '\s+', ' ', 'g'), '');
  v_complet boolean := coalesce((parametre('depot') ->> 'declaration_complete')::boolean, true);
begin
  perform _exiger_compte_actif(v_compte);
  select * into v_d from depots where reference = p_reference and compte_id = v_compte for update;
  if not found then raise exception 'dépôt inconnu'; end if;
  if v_d.etat in ('annule') then raise exception 'ce dépôt est annulé'; end if;
  if length(v_id) < 6 or length(v_id) > 40 then
    raise exception 'transaction ID invalide' using detail = 'au moins six caractères, tel qu''il est écrit dans le SMS';
  end if;
  if v_complet or p_numero is not null or p_montant is not null or p_nom is not null then
    if v_num is null or v_num !~ '^6[0-9]{8}$' or operateur_du_numero(v_num) is distinct from v_d.operateur then
      raise exception 'numéro du payeur invalide' using detail = 'le numéro qui a payé, neuf chiffres, du même opérateur';
    end if;
    if p_montant is null or p_montant <= 0 or p_montant <> trunc(p_montant) or p_montant > 1e9 then
      raise exception 'montant invalide' using detail = 'le montant exact envoyé, en francs';
    end if;
    if v_nom is null or length(v_nom) < 2 or length(v_nom) > 80 then
      raise exception 'nom du payeur invalide' using detail = 'le nom du titulaire du compte qui a payé';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('tx:' || v_d.operateur || ':' || v_id));

  select * into v_x from depot_declarations where compte_id = v_compte and operateur = v_d.operateur and transaction_id = v_id for update;
  if found then
    if v_x.depot_id <> v_d.id then
      raise exception 'transaction ID déjà déclaré' using detail = format('sur le dossier %s', (select reference from depots where id = v_x.depot_id));
    end if;
    -- la correction d'un écart : de nouvelles valeurs, un essai de plus, et on recherche le SMS
    if v_x.etat = 'refuse' and v_x.corrigible and v_x.essais < 3 and v_num is not null then
      update depot_declarations
         set numero_declare = v_num, montant_declare = p_montant, nom_declare = v_nom, etat = 'attendu', motif = null,
             corrigible = false, essais = essais + 1, declare_le = now()
       where id = v_x.id returning * into v_x;
    else
      return _declaration_json(v_x);
    end if;
  else
    if exists (select 1 from depot_declarations where operateur = v_d.operateur and transaction_id = v_id and etat = 'credite') then
      raise exception 'transaction ID déjà utilisé' using detail = 'ce paiement a déjà été crédité';
    end if;
    if (select count(*) from depot_declarations where compte_id = v_compte and etat = 'attendu') >= 5 then
      raise exception 'trop de transaction ID en attente' using detail = 'attendez que les premiers soient lus';
    end if;
    if (select count(*) from depot_declarations where compte_id = v_compte and declare_le > now() - interval '24 hours') >= 30 then
      raise exception 'trop de transaction ID aujourd''hui' using detail = 'l''équipe peut rapprocher les autres';
    end if;
    insert into depot_declarations (depot_id, compte_id, operateur, transaction_id, numero_declare, montant_declare, nom_declare)
    values (v_d.id, v_compte, v_d.operateur, v_id, v_num, p_montant, v_nom) returning * into v_x;
  end if;

  -- TOTEM a peut-être déjà lu le SMS : il est alors parmi les entrées retenues.
  select * into v_r from entrees_retenues
   where operateur = v_d.operateur and transaction_id = v_id and etat = 'retenue' and not bloquee
     and coalesce(montant, 0) > 0
   order by cree_le limit 1 for update;
  if found then
    v_a := _apparier(v_d.operateur, v_id, v_r.numero_payeur, v_r.emis_le, v_r.montant);
    if v_a ? 'id' then
      v_x := _crediter_declaration((v_a ->> 'id')::uuid, v_r.terminal, v_r.source_id, v_r.montant, v_r.numero_payeur,
                                   v_r.reference_operateur, v_r.texte, v_r.emis_le, v_r.id);
    else
      update entrees_retenues set motif = coalesce(v_a ->> 'motif', motif), bloquee = bloquee or coalesce((v_a ->> 'bloquee')::boolean, false)
       where id = v_r.id;
      select * into v_x from depot_declarations where id = v_x.id;
    end if;
  end if;
  return _declaration_json(v_x);
end $$;

-- ─────────────────────── le SMS lu par TOTEM (0001), montant compris ───────
create or replace function totem_sms_recu(p_terminal text, p_source_id bigint, p_operateur text, p_float_numero text,
                               p_numero_payeur text, p_montant numeric, p_reference text, p_texte text,
                               p_emis_le timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_float floats;
  v_d     depots;
  v_p     depot_paiements;
  v_r     entrees_retenues;
  v_x     depot_declarations;
  v_a     jsonb := '{}'::jsonb;
  v_num   text := nullif(normaliser_numero(p_numero_payeur), '');
  v_id    text := normaliser_transaction_id(p_reference);
  v_emp   text := _empreinte_sms(p_texte, p_reference, p_montant);
  v_reutilise boolean;
begin
  perform pg_advisory_xact_lock(hashtext('sms:' || p_terminal || ':' || p_source_id::text));
  select * into v_p from depot_paiements where terminal = p_terminal and source_id = p_source_id and empreinte = v_emp;
  if found then
    select * into v_d from depots where id = v_p.depot_id;
    return jsonb_build_object('resultat', 'credite', 'reference', v_d.reference, 'etat', v_d.etat, 'deja', true);
  end if;
  select * into v_r from entrees_retenues where terminal = p_terminal and source_id = p_source_id and empreinte = v_emp;
  if found then return jsonb_build_object('resultat', 'retenue', 'id', v_r.id, 'deja', true); end if;
  v_reutilise := exists (select 1 from depot_paiements where terminal = p_terminal and source_id = p_source_id)
              or exists (select 1 from entrees_retenues where terminal = p_terminal and source_id = p_source_id);

  update terminaux set vu_le = now() where id = p_terminal;
  select * into v_float from floats
   where operateur = p_operateur and numero = normaliser_numero(p_float_numero) and terminal = p_terminal;
  if not found then
    insert into entrees_retenues (terminal, source_id, operateur, float_numero, numero_payeur, montant,
                                  reference_operateur, transaction_id, texte, emis_le, motif, bloquee, empreinte)
    values (p_terminal, p_source_id, p_operateur, p_float_numero, v_num, p_montant, p_reference, v_id, p_texte, p_emis_le,
            'ce numéro n''est pas un float de ce terminal : l''équipe vérifie', true, v_emp)
    returning * into v_r;
    return jsonb_build_object('resultat', 'retenue', 'id', v_r.id, 'motif', v_r.motif);
  end if;

  if coalesce(p_montant, 0) > 0 and length(v_id) >= 6 then
    perform pg_advisory_xact_lock(hashtext('tx:' || p_operateur || ':' || v_id));
    v_a := _apparier(p_operateur, v_id, v_num, p_emis_le, p_montant);
    if v_a ? 'id' then
      v_x := _crediter_declaration((v_a ->> 'id')::uuid, p_terminal, p_source_id, p_montant, v_num, p_reference, p_texte, p_emis_le, null);
      select * into v_d from depots where id = v_x.depot_id;
      if v_x.etat = 'credite' then
        return jsonb_strip_nulls(jsonb_build_object('resultat', 'credite', 'reference', v_d.reference, 'etat', v_d.etat,
                                                    'montant_recu', v_d.montant_recu, 'source_id_reutilise', case when v_reutilise then true end));
      end if;
      v_a := jsonb_build_object('motif', v_x.motif, 'bloquee', true, 'depot_id', v_d.id);
    end if;
  end if;

  insert into entrees_retenues (terminal, source_id, float_id, operateur, float_numero, numero_payeur, montant,
                                reference_operateur, transaction_id, texte, emis_le, depot_id, motif, bloquee, empreinte)
  values (p_terminal, p_source_id, v_float.id, p_operateur, p_float_numero, v_num, p_montant, p_reference, v_id, p_texte, p_emis_le,
          (v_a ->> 'depot_id')::uuid, v_a ->> 'motif', coalesce((v_a ->> 'bloquee')::boolean, false), v_emp)
  returning * into v_r;
  return jsonb_strip_nulls(jsonb_build_object('resultat', 'retenue', 'id', v_r.id, 'motif', v_r.motif,
                                              'source_id_reutilise', case when v_reutilise then true end));
end $$;

-- ───────────────────────────── l'équipe et les floats ──────────────────────
drop function if exists admin_creer_float(text, text, text, text);
create or replace function admin_creer_float(p_operateur text, p_numero text, p_terminal text, p_code_agent text default null, p_titulaire text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id int; v_tit text := nullif(regexp_replace(trim(coalesce(p_titulaire, '')), '\s+', ' ', 'g'), '');
begin
  perform _exiger_droit('terminaux');
  if normaliser_numero(p_numero) !~ '^6[0-9]{8}$' or operateur_du_numero(p_numero) is distinct from p_operateur then
    raise exception 'numéro invalide' using detail = 'un numéro camerounais de cet opérateur';
  end if;
  if v_tit is not null and length(v_tit) > 80 then raise exception 'titulaire invalide' using detail = '80 caractères au plus'; end if;
  if nullif(trim(coalesce(p_code_agent, '')), '') is not null and trim(p_code_agent) !~ '^[0-9]{3,12}$' then
    raise exception 'code agent invalide' using detail = 'des chiffres';
  end if;
  perform 1 from terminaux where id = p_terminal;
  if not found then raise exception 'terminal inconnu'; end if;
  insert into floats (operateur, numero, terminal, code_agent, titulaire)
  values (p_operateur, normaliser_numero(p_numero), p_terminal, nullif(trim(coalesce(p_code_agent, '')), ''), v_tit) returning id into v_id;
  perform _journaliser('creer_float', v_id::text, jsonb_build_object('operateur', p_operateur, 'numero', normaliser_numero(p_numero), 'terminal', p_terminal, 'titulaire', v_tit));
  return jsonb_build_object('id', v_id);
end $$;

-- Le titulaire et le code agent changent (un nouveau compte marchand) sans recréer le float.
create or replace function admin_modifier_float(p_id int, p_titulaire text, p_code_agent text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tit text := nullif(regexp_replace(trim(coalesce(p_titulaire, '')), '\s+', ' ', 'g'), '');
        v_code text := nullif(trim(coalesce(p_code_agent, '')), '');
begin
  perform _exiger_droit('terminaux');
  if v_tit is not null and length(v_tit) > 80 then raise exception 'titulaire invalide' using detail = '80 caractères au plus'; end if;
  if v_code is not null and v_code !~ '^[0-9]{3,12}$' then raise exception 'code agent invalide' using detail = 'des chiffres'; end if;
  update floats set titulaire = v_tit, code_agent = v_code where id = p_id;
  if not found then raise exception 'float inconnu'; end if;
  perform _journaliser('modifier_float', p_id::text, jsonb_build_object('titulaire', v_tit, 'code_agent', v_code));
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_terminaux() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nom', t.nom, 'lieu', t.lieu, 'vu_le', t.vu_le, 'a_cle', t.cle is not null,
                            'muet', t.vu_le is null or t.vu_le < now() - interval '10 minutes',
                            'floats', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'operateur', f.operateur, 'numero', f.numero, 'code_agent', f.code_agent,
                                                                         'titulaire', f.titulaire, 'actif', f.actif,
                                                                         'dossiers_ouverts', (select count(*) from depots d where d.float_id = f.id and d.etat = 'en_attente'))
                                                      order by f.id), '[]'::jsonb) from floats f where f.terminal = t.id),
                            'commandes_en_attente', (select count(*) from commandes k where k.terminal = t.id and k.etat = 'en_attente')) order by t.id), '[]'::jsonb)
    into r from terminaux t;
  return r;
end $$;

-- ─────────────────── le paramètre « depot » accepte la règle stricte ────────
create or replace function _verifier_parametre(p_cle text, v jsonb) returns void
language plpgsql set search_path = public, extensions, pg_temp as $$
declare k text; p jsonb; ok boolean;
begin
  if jsonb_typeof(v) <> 'object' then raise exception 'paramètre invalide' using detail = 'un objet JSON est attendu'; end if;
  ok := case p_cle
    when 'frais' then _nombre_entre(v -> 'placeur', 0, 0.05) and _nombre_entre(v -> 'preneur', 0, 0.05) and _nombre_entre(v -> 'sortie', 0, 0.05)
    when 'marche' then v ->> 'paire' = 'USDT/XAFe' and _nombre_entre(v -> 'pas_prix', 0.01, 100) and _nombre_entre(v -> 'quantite_min', 0.01, 1000000)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
    when 'depot' then _nombre_entre(v -> 'validite_minutes', 5, 1440, true) and _nombre_entre(v -> 'grace_minutes', 0, 10080, true)
                      and (not (v ? 'declaration_complete') or jsonb_typeof(v -> 'declaration_complete') = 'boolean')
    when 'sortie' then _nombre_entre(v -> 'reprises_max', 1, 10, true)
                       and (not (v ? 'ouvertes') or jsonb_typeof(v -> 'ouvertes') = 'boolean')
    when 'rapide' then _nombre_entre(v -> 'marge', 0, 0.2) and _nombre_entre(v -> 'validite_secondes', 5, 120, true)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
    when 'code_secret' then _nombre_entre(v -> 'essais', 1, 10, true) and _nombre_entre(v -> 'verrou_minutes', 1, 1440, true)
                       and _nombre_entre(v -> 'longueur_min', 4, 6, true) and _nombre_entre(v -> 'longueur_max', 4, 8, true)
                       and (v ->> 'longueur_min')::int <= (v ->> 'longueur_max')::int
    when 'crypto' then _nombre_entre(v -> 'frais' -> 'USDT', 0, 1000) and _nombre_entre(v -> 'frais' -> 'XAFe', 0, 1000000)
                       and _nombre_entre(v -> 'confirmations' -> 'bep20', 1, 1000, true) and _nombre_entre(v -> 'confirmations' -> 'trc20', 1, 1000, true)
                       and jsonb_typeof(v -> 'retraits_ouverts') = 'boolean'
                       and (not (v ? 'depots_ouverts') or jsonb_typeof(v -> 'depots_ouverts') = 'boolean')
    when 'paliers' then (select bool_and(x) from (values (v ? '0'), (v ? '1'), (v ? '2')) t(x))
    -- une date AAAA-MM-JJ : la version se lit, et se compare
    when 'conditions' then coalesce(v ->> 'version', '') ~ '^\d{4}-\d{2}-\d{2}$'
    -- une adresse e-mail, et un numéro WhatsApp au format international ou null
    when 'support' then coalesce(v ->> 'email', '') ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'
                        and (jsonb_typeof(v -> 'whatsapp') = 'null' or coalesce(v ->> 'whatsapp', '') ~ '^\+[1-9][0-9]{7,14}$')
    else false end;
  if p_cle = 'paliers' and ok then
    foreach k in array array['0', '1', '2'] loop
      p := v -> k;
      if jsonb_typeof(p) = 'null' then continue; end if;
      if not (jsonb_typeof(p) = 'object' and _nombre_entre(p -> 'entree_jour', 0, 1e12, true) and _nombre_entre(p -> 'sortie_jour', 0, 1e12, true)) then
        ok := false;
      end if;
    end loop;
  end if;
  if not coalesce(ok, false) then
    raise exception 'paramètre invalide' using detail = format('« %s » : une clé manque, ou une valeur sort de ses bornes', p_cle);
  end if;
end $$;


-- ───────────────────── ouvrir un service, ou pas encore ─────────────────────
-- On ouvre Glisil par les DÉPÔTS d'abord. Le marché (« marche.ouvert »),
-- l'achat rapide (« rapide.ouvert ») et les retraits crypto
-- (« crypto.retraits_ouverts ») avaient déjà leur interrupteur. Il en manquait
-- deux : les sorties de XAF vers MoMo (« sortie.ouvertes ») et les adresses de
-- dépôt crypto (« crypto.depots_ouverts »). Absents, ils valent « ouvert » :
-- cette migration ne ferme rien ; c'est l'équipe qui ferme, dans Paramètres.
create or replace function demander_sortie(p_montant numeric, p_numero_id uuid, p_cle text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true) then
    raise exception 'sorties pas encore ouvertes' using detail = 'vos XAFe restent sur votre compte';
  end if;
  v := _controler_code(auth.uid(), p_code);
  if not (v ->> 'ok')::boolean then return v; end if;
  return demander_sortie(p_montant, p_numero_id, p_cle);
end $$;

create or replace function adresse_depot(p_actif text, p_reseau text) returns text
language plpgsql security definer set search_path = public as $$
declare v_compte uuid := auth.uid(); v_adresse text; v_libre adresses_libres;
begin
  perform _exiger_compte_actif(v_compte);
  -- fermé : aucune adresse ne se montre — pas même celle déjà attribuée, sur laquelle de vrais USDT n'arriveraient nulle part
  if not coalesce((parametre('crypto') ->> 'depots_ouverts')::boolean, true) then return null; end if;
  perform 1 from comptes where id = v_compte for no key update;
  select adresse into v_adresse from adresses_crypto where compte_id = v_compte and actif = p_actif and reseau = p_reseau;
  if found then return v_adresse; end if;
  select * into v_libre from adresses_libres where actif = p_actif and reseau = p_reseau order by id for update skip locked limit 1;
  if not found then return null; end if;
  delete from adresses_libres where id = v_libre.id;
  insert into adresses_crypto (compte_id, actif, reseau, adresse, indice) values (v_compte, p_actif, p_reseau, v_libre.adresse, v_libre.indice)
  on conflict (compte_id, actif, reseau) do update set adresse = adresses_crypto.adresse
  returning adresse into v_adresse;
  return v_adresse;
end $$;

create or replace function parametres_publics() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'frais', parametre('frais'),
    'marche', parametre('marche'),
    'paliers', parametre('paliers'),
    'rapide', jsonb_build_object('marge', parametre('rapide') -> 'marge', 'ouvert', coalesce((parametre('rapide') ->> 'ouvert')::boolean, false),
                                 'validite_secondes', parametre('rapide') -> 'validite_secondes'),
    'crypto', jsonb_build_object('frais', parametre('crypto') -> 'frais',
                                 'retraits_ouverts', coalesce((parametre('crypto') ->> 'retraits_ouverts')::boolean, false),
                                 'depots_ouverts', coalesce((parametre('crypto') ->> 'depots_ouverts')::boolean, true)),
    'sortie', jsonb_build_object('ouvertes', coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true)),
    'operateurs', (select jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'plafond_par_transfert', plafond_par_transfert,
                                                       'plafond_jour', plafond_jour) order by id) from operateurs),
    'conditions', parametre('conditions'),
    'support', parametre('support'))
   where auth.uid() is not null
$$;

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on function declarer_transaction(text, text, text, numeric, text), admin_creer_float(text, text, text, text, text),
                       admin_modifier_float(int, text, text), _apparier(text, text, text, timestamptz, numeric)
  from public, anon, authenticated;
grant execute on function declarer_transaction(text, text, text, numeric, text), admin_creer_float(text, text, text, text, text),
                          admin_modifier_float(int, text, text)
  to authenticated, service_role;
$sql$;
    raise notice '0013_depot_declare.sql : appliquée';
  end if;
end $consolide$;

-- ─── 0014_sorties_manuelles.sql (md5 2fc80fcd143f1f97f6f3a5b6fe86478e) ───
-- déjà en place si : rejouable telle quelle
do $consolide$
begin
  if false then
    raise notice '0014_sorties_manuelles.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0014 · le remboursement en XAF, fait à la main               ║
-- ║                                                                        ║
-- ║  Pour commencer, une sortie de XAFe vers Mobile Money n'est pas        ║
-- ║  composée par TOTEM : l'équipe paie elle-même, puis le dit. La règle   ║
-- ║  « sortie.mode » choisit : « totem » (les commandes au boîtier, comme  ║
-- ║  avant) ou « manuel ». Absente, elle vaut « totem » : cette migration  ║
-- ║  ne change rien tant que l'équipe ne la pose pas.                      ║
-- ║                                                                        ║
-- ║  Le trajet d'un remboursement manuel :                                 ║
-- ║    demandée (les XAFe sont MIS DE CÔTÉ tout de suite)                  ║
-- ║      → prise en charge par un membre de l'équipe                       ║
-- ║      → payée : transaction ID + capture ; au-delà d'un seuil, une      ║
-- ║        SECONDE personne confirme                                       ║
-- ║      → envoyée : les XAFe mis de côté sont DÉTRUITS (emissions)        ║
-- ║    ou → refusée avec un motif : les XAFe reviennent, tant que rien     ║
-- ║        n'a été payé. Un remboursement payé ne revient jamais en        ║
-- ║        arrière.                                                        ║
-- ║                                                                        ║
-- ║  La preuve : le SMS que l'opérateur envoie à la puce qui a payé. TOTEM ║
-- ║  le relève (sens « sortie ») et la base le rapproche du transaction ID ║
-- ║  tapé par l'équipe : même ID, même montant, même numéro. Une capture   ║
-- ║  d'écran se fabrique ; un SMS d'opérateur reçu par la puce, beaucoup   ║
-- ║  moins.                                                                ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────── les colonnes ──────────────────────────────
alter table sorties add column if not exists mode            text not null default 'totem';
alter table sorties add column if not exists nom_beneficiaire text;     -- le nom du compte MoMo, tel que le client l'écrit
alter table sorties add column if not exists pris_par        uuid;
alter table sorties add column if not exists pris_le         timestamptz;
alter table sorties add column if not exists transaction_id  text;      -- l'ID du paiement fait par l'équipe, normalisé
alter table sorties add column if not exists preuve          text;      -- le chemin de la capture, dans le stockage « preuves-sorties »
alter table sorties add column if not exists payee_par       uuid;
alter table sorties add column if not exists payee_le        timestamptz;
alter table sorties add column if not exists confirmee_par   uuid;
alter table sorties add column if not exists confirmee_le    timestamptz;
alter table sorties add column if not exists motif           text;      -- le refus, dit au client
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sorties_mode_check') then
    alter table sorties add constraint sorties_mode_check check (mode in ('totem', 'manuel'));
  end if;
end $$;
-- Un paiement de l'équipe ne prouve qu'UN remboursement : le même ID tapé
-- deux fois fermerait deux sorties avec un seul envoi.
create unique index if not exists sorties_un_paiement on sorties (operateur, transaction_id) where transaction_id is not null;
create index if not exists sorties_manuelles_a_traiter on sorties (cree_le) where mode = 'manuel' and etat in ('en_attente', 'en_cours');

-- ─────────────────────── ce que TOTEM voit sortir du float ─────────────────
-- Chaque SMS « vous avez envoyé … » relevé sur une puce de float. Rapproché
-- d'un remboursement par son transaction ID ; resté seul, c'est de l'argent
-- sorti du float que rien n'explique, et l'équipe le voit.
create table if not exists sorties_constatees (
  id                  bigint generated always as identity primary key,
  terminal            text not null references terminaux(id),
  source_id           bigint not null,
  empreinte           text not null,
  float_id            int references floats(id),
  operateur           text not null,
  float_numero        text,
  numero_beneficiaire text,
  montant             numeric(20,2),
  reference_operateur text,
  transaction_id      text,
  texte               text,
  emis_le             timestamptz,
  sortie_id           uuid references sorties(id),
  recu_le             timestamptz not null default now(),
  unique (terminal, source_id, empreinte)
);
create index if not exists sorties_constatees_tx on sorties_constatees (operateur, transaction_id);
alter table sorties_constatees enable row level security;

-- ─────────────────────────────── la règle ──────────────────────────────────
create or replace function _sortie_manuelle() returns boolean
language sql stable set search_path = public as $$
  select coalesce(parametre('sortie') ->> 'mode', 'totem') = 'manuel'
$$;

-- Le rapprochement d'une sortie payée avec le SMS que la puce a reçu.
--   « concorde » : même ID, même montant, même numéro ;
--   « ecart »    : même ID, mais le montant ou le numéro diffère ;
--   « absent »   : aucun SMS de ce paiement relevé (pas encore, ou payé d'ailleurs).
create or replace function _rapprochement(s sorties) returns jsonb
language sql stable set search_path = public as $$
  select case
    when s.transaction_id is null then null
    when c.id is null then jsonb_build_object('etat', 'absent')
    else jsonb_build_object(
      'etat', case when c.montant = s.montant_xaf and c.numero_beneficiaire = s.numero then 'concorde' else 'ecart' end,
      'montant', c.montant, 'numero', c.numero_beneficiaire, 'terminal', c.terminal, 'emis_le', c.emis_le, 'texte', c.texte)
  end
  from (select 1) un
  left join lateral (select * from sorties_constatees k
                      where k.operateur = s.operateur and k.transaction_id = s.transaction_id
                      order by k.id limit 1) c on true
$$;

-- Ce que voit le client : le mode, le nom, l'ID du paiement et sa date ; le
-- motif d'un refus. Pas qui l'a traité, ni la capture.
create or replace function _sortie_json(s sorties) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'reference', s.reference, 'etat', s.etat, 'operateur', s.operateur, 'numero', s.numero,
    'montant', s.montant, 'frais', s.frais, 'montant_xaf', s.montant_xaf,
    'montant_envoye', s.montant_envoye, 'montant_rendu', s.montant_rendu,
    'transferts', (select count(*) from commandes where sortie_id = s.id),
    'cree_le', s.cree_le, 'terminee_le', s.terminee_le,
    'mode', s.mode, 'nom_beneficiaire', s.nom_beneficiaire,
    'pris_le', s.pris_le, 'transaction_id', s.transaction_id,
    'payee_le', coalesce(s.confirmee_le, s.payee_le), 'motif', s.motif)
$$;

-- ─────────────────────────── la demande du client ──────────────────────────
-- Les mêmes gardes que la sortie par TOTEM (compte actif, numéro vérifié À
-- SON NOM et actif, plafond du palier, compte verrouillé avant de compter),
-- sans boîtier ni découpage : l'équipe paiera en une ou plusieurs fois, c'est
-- le montant en XAF qui compte.
create or replace function _demander_sortie_manuelle(p_montant numeric, p_numero_id uuid, p_cle text, p_nom text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_compte uuid := auth.uid();
  v_s      sorties;
  v_n      numeros;
  v_taux   numeric := coalesce((parametre('frais') ->> 'sortie')::numeric, 0);
  v_palier jsonb;
  v_frais  numeric;
  v_nom    text := nullif(regexp_replace(trim(coalesce(p_nom, '')), '\s+', ' ', 'g'), '');
  v_ref    text;
begin
  perform _exiger_compte_actif(v_compte);
  if p_cle is not null then
    select * into v_s from sorties where compte_id = v_compte and cle = p_cle;
    if found then return _sortie_json(v_s) || '{"deja": true}'; end if;
  end if;
  if p_montant is null or p_montant <= 0 or p_montant <> trunc(p_montant) then raise exception 'montant invalide'; end if;
  if v_nom is null or length(v_nom) < 2 or length(v_nom) > 80 then
    raise exception 'nom du bénéficiaire invalide' using detail = 'le nom exact du compte Mobile Money qui reçoit';
  end if;

  select * into v_n from numeros where id = p_numero_id and compte_id = v_compte and retire_le is null;
  if not found then raise exception 'numéro inconnu sur ce compte'; end if;
  if v_n.verifie_le is null then raise exception 'numéro pas encore vérifié'; end if;
  if v_n.actif_des > now() then
    raise exception 'numéro pas encore actif' using detail = format('actif à partir du %s', v_n.actif_des);
  end if;

  perform 1 from comptes where id = v_compte for no key update;
  v_palier := parametre('paliers') -> (select palier::text from comptes where id = v_compte);
  if v_palier is not null and v_palier <> 'null'::jsonb then
    if _sorties_du_jour(v_compte) + p_montant > (v_palier ->> 'sortie_jour')::numeric then
      raise exception 'plafond du palier atteint' using detail = format('%s XAF par jour', v_palier ->> 'sortie_jour');
    end if;
  end if;

  v_frais := ceil(p_montant * v_taux);
  if p_montant - v_frais <= 0 then raise exception 'montant trop petit' using detail = 'après les frais, rien ne partirait'; end if;

  v_ref := 'XAFe-WD-' || lpad(nextval('sorties_numero')::text, 6, '0');
  -- mis de côté AVANT que l'équipe ne voie la demande : dépensé ailleurs pendant qu'on paie, il serait payé deux fois
  perform _mouvement(v_compte, 'XAFe', -p_montant, p_montant, 'sortie_bloquee', 'sorties', v_ref);
  insert into sorties (reference, compte_id, numero_id, operateur, numero, montant, frais, montant_xaf, cle, mode, nom_beneficiaire)
  values (v_ref, v_compte, v_n.id, v_n.operateur, v_n.numero, p_montant, v_frais, p_montant - v_frais, p_cle, 'manuel', v_nom)
  returning * into v_s;
  return _sortie_json(v_s);
end $$;

-- La version avec le code secret, la seule ouverte au client. Elle prend
-- désormais le nom du bénéficiaire (exigé en mode manuel) ; l'ancienne, à
-- quatre arguments, s'efface : une application d'avant qui appelle par nom
-- tombe sur celle-ci, p_nom vaut null.
drop function if exists demander_sortie(numeric, uuid, text, text);
create or replace function demander_sortie(p_montant numeric, p_numero_id uuid, p_cle text, p_code text, p_nom text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true) then
    raise exception 'sorties pas encore ouvertes' using detail = 'vos XAFe restent sur votre compte';
  end if;
  v := _controler_code(auth.uid(), p_code);
  if not (v ->> 'ok')::boolean then return v; end if;
  if _sortie_manuelle() then return _demander_sortie_manuelle(p_montant, p_numero_id, p_cle, p_nom); end if;
  return demander_sortie(p_montant, p_numero_id, p_cle);
end $$;

-- ─────────────────────────── le traitement par l'équipe ────────────────────
create or replace function _sortie_a_traiter(p_reference text) returns sorties
language plpgsql set search_path = public as $$
declare v_s sorties;
begin
  select * into v_s from sorties where reference = p_reference for update;
  if not found then raise exception 'sortie inconnue'; end if;
  if v_s.mode <> 'manuel' then raise exception 'cette sortie est composée par TOTEM' using detail = 'elle se suit dans ses transferts'; end if;
  return v_s;
end $$;

-- « Je m'en occupe » : les autres membres de l'équipe le voient, et ne paient
-- pas une seconde fois.
create or replace function admin_prendre_sortie(p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties;
begin
  perform _exiger_droit('sorties');
  v_s := _sortie_a_traiter(p_reference);
  if v_s.etat <> 'en_attente' then raise exception 'cette sortie n''attend plus' using detail = v_s.etat; end if;
  update sorties set etat = 'en_cours', pris_par = auth.uid(), pris_le = now() where id = v_s.id returning * into v_s;
  perform _journaliser('prendre_sortie', p_reference);
  return _sortie_json(v_s);
end $$;

-- La sortie est payée : ses XAFe mis de côté sont détruits, les frais vont à
-- la maison, le client est prévenu avec l'ID du paiement.
create or replace function _clore_sortie_manuelle(p_id uuid) returns sorties
language plpgsql set search_path = public as $$
declare v_s sorties;
begin
  select * into v_s from sorties where id = p_id for update;
  perform _mouvement(v_s.compte_id, 'XAFe', 0, -v_s.montant, 'sortie_envoyee', 'sorties', v_s.reference);
  if v_s.frais > 0 then
    perform _mouvement(compte_maison(), 'XAFe', v_s.frais, 0, 'frais_sortie', 'sorties', v_s.reference);
  end if;
  insert into emissions (sens, montant, source_table, source_id) values ('destruction', v_s.montant_xaf, 'sorties', v_s.reference);
  update sorties set etat = 'envoyee', montant_envoye = montant_xaf, terminee_le = now() where id = p_id returning * into v_s;
  perform _notifier(v_s.compte_id, 'Sortie envoyée',
    format('%s XAF envoyés au %s. Transaction ID : %s.', to_char(v_s.montant_xaf, 'FM999G999G999G999'), v_s.numero, v_s.transaction_id),
    '/historique/' || v_s.reference);
  return v_s;
end $$;

-- L'équipe a payé : le transaction ID (exigé) et la capture (facultative).
-- Au-delà de « sortie.seuil_deux_personnes », la sortie attend qu'une AUTRE
-- personne confirme : l'argent est parti, mais les XAFe ne sont détruits et
-- le client prévenu qu'une fois la preuve vue par deux yeux.
create or replace function admin_payer_sortie(p_reference text, p_transaction_id text, p_preuve text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_s     sorties;
  v_id    text := normaliser_transaction_id(p_transaction_id);
  v_seuil numeric := nullif(parametre('sortie') ->> 'seuil_deux_personnes', '')::numeric;
begin
  perform _exiger_droit('sorties');
  v_s := _sortie_a_traiter(p_reference);
  if v_s.etat not in ('en_attente', 'en_cours') then raise exception 'cette sortie est déjà close' using detail = v_s.etat; end if;
  if v_s.payee_le is not null then raise exception 'paiement déjà enregistré' using detail = v_s.transaction_id; end if;
  if length(v_id) < 6 then raise exception 'transaction ID invalide' using detail = 'recopiez-le du SMS de l''opérateur'; end if;
  if p_preuve is not null and p_preuve !~ ('^' || v_s.reference || '/[A-Za-z0-9._-]{1,80}$') then
    raise exception 'capture invalide' using detail = 'elle se dépose dans le dossier de la sortie';
  end if;
  if exists (select 1 from sorties where operateur = v_s.operateur and transaction_id = v_id and id <> v_s.id) then
    raise exception 'ce transaction ID prouve déjà une autre sortie';
  end if;
  update sorties set transaction_id = v_id, preuve = p_preuve, payee_par = auth.uid(), payee_le = now(),
                     etat = 'en_cours', pris_par = coalesce(pris_par, auth.uid()), pris_le = coalesce(pris_le, now())
   where id = v_s.id returning * into v_s;
  -- le SMS de la puce arrive souvent AVANT que l'ID soit tapé : on le rattache maintenant
  update sorties_constatees set sortie_id = v_s.id where operateur = v_s.operateur and transaction_id = v_id and sortie_id is null;
  perform _journaliser('payer_sortie', p_reference, jsonb_build_object('transaction_id', v_id, 'preuve', p_preuve is not null));
  if v_seuil is not null and v_s.montant_xaf >= v_seuil then
    return _sortie_json(v_s) || jsonb_build_object('a_confirmer', true, 'rapprochement', _rapprochement(v_s));
  end if;
  v_s := _clore_sortie_manuelle(v_s.id);
  return _sortie_json(v_s) || jsonb_build_object('rapprochement', _rapprochement(v_s));
end $$;

create or replace function admin_confirmer_sortie(p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties;
begin
  perform _exiger_droit('sorties');
  v_s := _sortie_a_traiter(p_reference);
  if v_s.etat <> 'en_cours' or v_s.payee_le is null then raise exception 'aucun paiement à confirmer' using detail = v_s.etat; end if;
  if v_s.payee_par = auth.uid() then
    raise exception 'une autre personne confirme' using detail = 'celle qui a payé ne confirme pas son propre paiement';
  end if;
  update sorties set confirmee_par = auth.uid(), confirmee_le = now() where id = v_s.id;
  v_s := _clore_sortie_manuelle(v_s.id);
  perform _journaliser('confirmer_sortie', p_reference);
  return _sortie_json(v_s) || jsonb_build_object('rapprochement', _rapprochement(v_s));
end $$;

-- Refuser : les XAFe mis de côté reviennent au client, avec le motif. Jamais
-- après un paiement enregistré : l'argent est parti, le client garderait les
-- deux.
create or replace function admin_refuser_sortie(p_reference text, p_motif text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties; v_motif text := nullif(trim(coalesce(p_motif, '')), '');
begin
  perform _exiger_droit('sorties');
  if v_motif is null or length(v_motif) < 3 then raise exception 'un motif est exigé' using detail = 'il est montré au client'; end if;
  v_s := _sortie_a_traiter(p_reference);
  if v_s.etat not in ('en_attente', 'en_cours') then raise exception 'cette sortie est déjà close' using detail = v_s.etat; end if;
  if v_s.payee_le is not null then
    raise exception 'un paiement est enregistré' using detail = 'l''argent est parti : la sortie ne se refuse plus';
  end if;
  perform _mouvement(v_s.compte_id, 'XAFe', v_s.montant, -v_s.montant, 'sortie_annulee', 'sorties', v_s.reference);
  update sorties set etat = 'annulee', montant_rendu = montant, motif = v_motif, terminee_le = now()
   where id = v_s.id returning * into v_s;
  perform _notifier(v_s.compte_id, 'Sortie refusée',
    format('%s XAFe sont revenus sur votre compte. %s', to_char(v_s.montant, 'FM999G999G999G999'), v_motif), '/historique/' || v_s.reference);
  perform _journaliser('refuser_sortie', p_reference, jsonb_build_object('motif', v_motif));
  return _sortie_json(v_s);
end $$;

-- L'annulation d'avant (par transferts TOTEM) ne touche pas une sortie
-- manuelle : sans transfert en attente, elle répondait « rien à annuler ».
-- Elle le dit maintenant, et renvoie au refus.
create or replace function admin_annuler_sortie(p_reference text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties; v commandes; v_rendu numeric := 0; v_faites int; v_echouees int;
begin
  perform _exiger_droit('sorties');
  if length(trim(coalesce(p_note, ''))) < 3 then raise exception 'une note est exigée' using detail = 'pourquoi la sortie est annulée'; end if;
  select * into v_s from sorties where reference = p_reference for update;
  if not found then raise exception 'sortie inconnue'; end if;
  if v_s.mode = 'manuel' then raise exception 'une sortie manuelle se refuse' using detail = 'admin_refuser_sortie, avec un motif'; end if;
  if exists (select 1 from commandes where sortie_id = v_s.id and etat = 'en_cours') then
    raise exception 'un transfert est en cours de composition' using detail = 'libérez-le d''abord s''il est bloqué';
  end if;
  for v in select * from commandes where sortie_id = v_s.id and etat = 'en_attente' order by id for update loop
    update commandes set etat = 'echouee', resultat = 'annulée par l''équipe : ' || p_note, traitee_le = now() where id = v.id;
    perform _mouvement(v_s.compte_id, 'XAFe', v.montant_xafe, -v.montant_xafe, 'sortie_annulee', 'commandes', v.id::text);
    v_rendu := v_rendu + v.montant_xafe;
  end loop;
  if v_rendu = 0 then raise exception 'rien à annuler' using detail = 'aucun transfert en attente'; end if;
  select count(*) filter (where etat = 'faite'), count(*) filter (where etat = 'echouee') into v_faites, v_echouees from commandes where sortie_id = v_s.id;
  update sorties set montant_rendu = montant_rendu + v_rendu,
         etat = case when v_faites = 0 then 'annulee' else 'partielle' end, terminee_le = now()
   where id = v_s.id returning * into v_s;
  perform _notifier(v_s.compte_id, 'Sortie annulée', format('%s XAFe sont revenus sur votre compte.', to_char(v_rendu, 'FM999G999G999G999')), '/historique/' || v_s.reference);
  perform _journaliser('annuler_sortie', p_reference, jsonb_build_object('rendu', v_rendu, 'note', p_note));
  return jsonb_build_object('ok', true, 'rendu', v_rendu, 'etat', v_s.etat);
end $$;

-- La liste de l'équipe : tout ce que le client a donné, le nom du compte
-- Glisil (à comparer avec le nom que l'opérateur affiche en payant), qui a
-- pris, qui a payé, et le rapprochement avec le SMS de la puce.
create or replace function admin_sorties(p_etat text default null, p_n int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(_sortie_json(s) || jsonb_build_object(
           'compte', jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'palier', c.palier),
           'preuve', s.preuve,
           'pris_par', (select coalesce(a.nom, a.email) from administrateurs a where a.id = s.pris_par),
           'payee_par', (select coalesce(a.nom, a.email) from administrateurs a where a.id = s.payee_par),
           'payee_par_moi', s.payee_par = auth.uid(),
           'confirmee_par', (select coalesce(a.nom, a.email) from administrateurs a where a.id = s.confirmee_par),
           'a_confirmer', s.mode = 'manuel' and s.etat = 'en_cours' and s.payee_le is not null,
           'rapprochement', _rapprochement(s),
           'transferts', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'terminal', k.terminal, 'etat', k.etat, 'montant_xafe', k.montant_xafe,
                                                     'montant_envoye', (k.parametres ->> 'montant')::numeric, 'reprises', k.reprises, 'resultat', k.resultat,
                                                     'reference_operateur', k.reference_operateur, 'reclamee_le', k.reclamee_le) order by k.id), '[]'::jsonb)
                            from commandes k where k.sortie_id = s.id)) order by s.cree_le desc), '[]'::jsonb)
    into r
    from (select * from sorties where (p_etat is null or etat = p_etat) order by cree_le desc limit p_n) s
    join comptes c on c.id = s.compte_id;
  return r;
end $$;

-- Ce que les puces ont vu partir et que rien n'explique (aucune sortie ne
-- porte cet ID) : un paiement oublié dans Glisil, ou de l'argent sorti du
-- float pour autre chose. L'équipe le voit, il ne se corrige pas en silence.
create or replace function admin_sorties_non_expliquees(p_n int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'terminal', k.terminal, 'operateur', k.operateur, 'float_numero', k.float_numero,
                                               'numero', k.numero_beneficiaire, 'montant', k.montant, 'transaction_id', k.transaction_id,
                                               'texte', k.texte, 'emis_le', k.emis_le) order by k.id desc), '[]'::jsonb)
    into r
    from (select * from sorties_constatees k
           where not exists (select 1 from sorties s where s.operateur = k.operateur and s.transaction_id = k.transaction_id)
           order by k.id desc limit p_n) k;
  return r;
end $$;

-- ─────────────────────────── le SMS sortant, par TOTEM ─────────────────────
-- La porte « totem-sms » y envoie les lignes de sens « sortie ». Un SMS relu
-- après une coupure a la même empreinte : il n'est compté qu'une fois.
create or replace function totem_sms_sortant(p_terminal text, p_source_id bigint, p_operateur text, p_float_numero text,
                                             p_numero text, p_montant numeric, p_reference text, p_texte text,
                                             p_emis_le timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_k     sorties_constatees;
  v_float floats;
  v_s     sorties;
  v_id    text := nullif(normaliser_transaction_id(p_reference), '');
  v_emp   text := _empreinte_sms(p_texte, p_reference, p_montant);
begin
  select * into v_k from sorties_constatees where terminal = p_terminal and source_id = p_source_id and empreinte = v_emp;
  if found then return jsonb_build_object('resultat', 'constatee', 'id', v_k.id, 'deja', true); end if;
  update terminaux set vu_le = now() where id = p_terminal;
  select * into v_float from floats where operateur = p_operateur and numero = normaliser_numero(p_float_numero) and terminal = p_terminal;
  select * into v_s from sorties where operateur = p_operateur and transaction_id = v_id and v_id is not null;
  insert into sorties_constatees (terminal, source_id, empreinte, float_id, operateur, float_numero, numero_beneficiaire, montant,
                                  reference_operateur, transaction_id, texte, emis_le, sortie_id)
  values (p_terminal, p_source_id, v_emp, v_float.id, p_operateur, p_float_numero, nullif(normaliser_numero(p_numero), ''), p_montant,
          p_reference, v_id, p_texte, p_emis_le, v_s.id)
  on conflict (terminal, source_id, empreinte) do nothing
  returning * into v_k;
  return jsonb_strip_nulls(jsonb_build_object('resultat', 'constatee', 'id', v_k.id,
    'sortie', v_s.reference, 'rapprochement', case when v_s.id is not null then _rapprochement(v_s) ->> 'etat' end));
end $$;

-- ─────────────────────────── le tableau de bord ────────────────────────────
-- « À traiter » : ce qui attend l'équipe, en premier.
create or replace function admin_a_traiter() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('voir');
  return jsonb_build_object(
    'sorties_manuelles', (select count(*) from sorties where mode = 'manuel' and etat in ('en_attente', 'en_cours') and payee_le is null),
    'sorties_a_confirmer', (select count(*) from sorties where mode = 'manuel' and etat = 'en_cours' and payee_le is not null),
    'montant_a_payer', (select coalesce(sum(montant_xaf), 0) from sorties where mode = 'manuel' and etat in ('en_attente', 'en_cours') and payee_le is null),
    'sorties_non_expliquees', (select count(*) from sorties_constatees k
                                where not exists (select 1 from sorties s where s.operateur = k.operateur and s.transaction_id = k.transaction_id)));
end $$;

-- ─────────────────── les paramètres : le mode et le seuil ──────────────────
create or replace function _verifier_parametre(p_cle text, v jsonb) returns void
language plpgsql set search_path = public, extensions, pg_temp as $$
declare k text; p jsonb; ok boolean;
begin
  if jsonb_typeof(v) <> 'object' then raise exception 'paramètre invalide' using detail = 'un objet JSON est attendu'; end if;
  ok := case p_cle
    when 'frais' then _nombre_entre(v -> 'placeur', 0, 0.05) and _nombre_entre(v -> 'preneur', 0, 0.05) and _nombre_entre(v -> 'sortie', 0, 0.05)
    when 'marche' then v ->> 'paire' = 'USDT/XAFe' and _nombre_entre(v -> 'pas_prix', 0.01, 100) and _nombre_entre(v -> 'quantite_min', 0.01, 1000000)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
    when 'depot' then _nombre_entre(v -> 'validite_minutes', 5, 1440, true) and _nombre_entre(v -> 'grace_minutes', 0, 10080, true)
                      and (not (v ? 'declaration_complete') or jsonb_typeof(v -> 'declaration_complete') = 'boolean')
    when 'sortie' then _nombre_entre(v -> 'reprises_max', 1, 10, true)
                       and (not (v ? 'ouvertes') or jsonb_typeof(v -> 'ouvertes') = 'boolean')
                       and (not (v ? 'mode') or v ->> 'mode' in ('totem', 'manuel'))
                       and (not (v ? 'seuil_deux_personnes') or jsonb_typeof(v -> 'seuil_deux_personnes') = 'null'
                            or _nombre_entre(v -> 'seuil_deux_personnes', 1, 1e12))
    when 'rapide' then _nombre_entre(v -> 'marge', 0, 0.2) and _nombre_entre(v -> 'validite_secondes', 5, 120, true)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
    when 'code_secret' then _nombre_entre(v -> 'essais', 1, 10, true) and _nombre_entre(v -> 'verrou_minutes', 1, 1440, true)
                       and _nombre_entre(v -> 'longueur_min', 4, 6, true) and _nombre_entre(v -> 'longueur_max', 4, 8, true)
                       and (v ->> 'longueur_min')::int <= (v ->> 'longueur_max')::int
    when 'crypto' then _nombre_entre(v -> 'frais' -> 'USDT', 0, 1000) and _nombre_entre(v -> 'frais' -> 'XAFe', 0, 1000000)
                       and _nombre_entre(v -> 'confirmations' -> 'bep20', 1, 1000, true) and _nombre_entre(v -> 'confirmations' -> 'trc20', 1, 1000, true)
                       and jsonb_typeof(v -> 'retraits_ouverts') = 'boolean'
                       and (not (v ? 'depots_ouverts') or jsonb_typeof(v -> 'depots_ouverts') = 'boolean')
    when 'paliers' then (select bool_and(x) from (values (v ? '0'), (v ? '1'), (v ? '2')) t(x))
    when 'conditions' then coalesce(v ->> 'version', '') ~ '^\d{4}-\d{2}-\d{2}$'
    when 'support' then coalesce(v ->> 'email', '') ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'
                        and (jsonb_typeof(v -> 'whatsapp') = 'null' or coalesce(v ->> 'whatsapp', '') ~ '^\+[1-9][0-9]{7,14}$')
    else false end;
  if p_cle = 'paliers' and ok then
    foreach k in array array['0', '1', '2'] loop
      p := v -> k;
      if jsonb_typeof(p) = 'null' then continue; end if;
      if not (jsonb_typeof(p) = 'object' and _nombre_entre(p -> 'entree_jour', 0, 1e12, true) and _nombre_entre(p -> 'sortie_jour', 0, 1e12, true)) then
        ok := false;
      end if;
    end loop;
  end if;
  if not coalesce(ok, false) then
    raise exception 'paramètre invalide' using detail = format('« %s » : une clé manque, ou une valeur sort de ses bornes', p_cle);
  end if;
end $$;

-- L'écran du client lit le mode : en manuel, il demande le nom et dit
-- « l'équipe paie, en général sous … ».
create or replace function parametres_publics() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'frais', parametre('frais'),
    'marche', parametre('marche'),
    'paliers', parametre('paliers'),
    'rapide', jsonb_build_object('marge', parametre('rapide') -> 'marge', 'ouvert', coalesce((parametre('rapide') ->> 'ouvert')::boolean, false),
                                 'validite_secondes', parametre('rapide') -> 'validite_secondes'),
    'crypto', jsonb_build_object('frais', parametre('crypto') -> 'frais',
                                 'retraits_ouverts', coalesce((parametre('crypto') ->> 'retraits_ouverts')::boolean, false),
                                 'depots_ouverts', coalesce((parametre('crypto') ->> 'depots_ouverts')::boolean, true)),
    'sortie', jsonb_build_object('ouvertes', coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true),
                                 'mode', coalesce(parametre('sortie') ->> 'mode', 'totem')),
    'operateurs', (select jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'plafond_par_transfert', plafond_par_transfert,
                                                       'plafond_jour', plafond_jour) order by id) from operateurs),
    'conditions', parametre('conditions'),
    'support', parametre('support'))
   where auth.uid() is not null
$$;

-- ─────────────────────────── les captures ──────────────────────────────────
-- Le stockage « preuves-sorties » : privé, images et PDF de 10 Mo au plus,
-- rangés par référence de sortie. Seule l'équipe des sorties dépose et relit.
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name) values ('preuves-sorties', 'preuves-sorties') on conflict (id) do nothing;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public') then
    execute $p$update storage.buckets set public = false where id = 'preuves-sorties'$p$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $p$update storage.buckets set file_size_limit = 10485760,
                 allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] where id = 'preuves-sorties'$p$;
  end if;
  execute $p$drop policy if exists preuves_sorties_deposer on storage.objects$p$;
  execute $p$drop policy if exists preuves_sorties_relire on storage.objects$p$;
  execute $p$create policy preuves_sorties_deposer on storage.objects for insert to authenticated
            with check (bucket_id = 'preuves-sorties' and public.admin_a_droit('sorties'))$p$;
  execute $p$create policy preuves_sorties_relire on storage.objects for select to authenticated
            using (bucket_id = 'preuves-sorties' and public.admin_a_droit('voir'))$p$;
end $$;

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on function _sortie_manuelle(), _rapprochement(sorties), _demander_sortie_manuelle(numeric, uuid, text, text),
                       _sortie_a_traiter(text), _clore_sortie_manuelle(uuid), totem_sms_sortant(text, bigint, text, text, text, numeric, text, text, timestamptz),
                       demander_sortie(numeric, uuid, text, text, text),
                       admin_prendre_sortie(text), admin_payer_sortie(text, text, text), admin_confirmer_sortie(text),
                       admin_refuser_sortie(text, text), admin_sorties_non_expliquees(int), admin_a_traiter()
  from public, anon, authenticated;
revoke all on table sorties_constatees from public, anon, authenticated;
grant execute on function demander_sortie(numeric, uuid, text, text, text),
                          admin_prendre_sortie(text), admin_payer_sortie(text, text, text), admin_confirmer_sortie(text),
                          admin_refuser_sortie(text, text), admin_sorties_non_expliquees(int), admin_a_traiter()
  to authenticated;
grant all on table sorties_constatees to service_role;
grant execute on function totem_sms_sortant(text, bigint, text, text, text, numeric, text, text, timestamptz),
                          demander_sortie(numeric, uuid, text, text, text) to service_role;
$sql$;
    raise notice '0014_sorties_manuelles.sql : appliquée';
  end if;
end $consolide$;

-- ─── 0015_reserve_sur_la_chaine.sql (md5 0377b5474dd61c07b66c9297a2e7e93b) ───
-- déjà en place si : rejouable telle quelle
do $consolide$
begin
  if false then
    raise notice '0015_reserve_sur_la_chaine.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0015 · chaque XAFe, aussi sur la chaîne                      ║
-- ║                                                                        ║
-- ║  Jusqu'ici, un XAFe n'existait sur la chaîne que lorsqu'un client le   ║
-- ║  sortait vers son wallet. Un dépôt MoMo n'y laissait aucune trace.     ║
-- ║                                                                        ║
-- ║  Maintenant, la RÉSERVE de Glisil — le wallet chaud du réseau choisi   ║
-- ║  (BNB Smart Chain) — tient sur la chaîne exactement les XAFe des       ║
-- ║  comptes Glisil. Chaque ligne d'`emissions` devient une transaction :  ║
-- ║    emission       (un dépôt crédité)        → frapper dans la réserve ║
-- ║    depuis_chaine  (des XAFe revenus, détruits chez le client)          ║
-- ║                                             → frapper dans la réserve ║
-- ║    destruction    (des XAF payés en sortie) → détruire dans la réserve║
-- ║    vers_chaine    (des XAFe frappés vers le wallet d'un client)        ║
-- ║                                             → détruire dans la réserve║
-- ║  Ainsi l'offre totale du jeton, sur les deux chaînes, vaut toujours    ║
-- ║  ce que Glisil doit à ses clients, et chacun peut le vérifier.         ║
-- ║                                                                        ║
-- ║  La référence d'une frappe est celle du mouvement (XAFe-DP-000003) :   ║
-- ║  le contrat garde son empreinte keccak256, et une empreinte ne sert    ║
-- ║  qu'une fois. Un même dossier crédité en deux fois prend un suffixe    ║
-- ║  (XAFe-DP-000003#12) à partir du second.                               ║
-- ╚════════════════════════════════════════════════════════════════════════╝

create table if not exists reserve_chaine (
  id           bigint generated always as identity primary key,
  emission_id  bigint not null unique references emissions(id),
  reseau       text not null default 'bep20' check (reseau in ('bep20', 'trc20')),
  operation    text not null check (operation in ('frapper', 'detruire')),
  montant      numeric(20,2) not null check (montant > 0),
  reference    text not null unique,            -- ce que l'empreinte keccak256 scelle sur la chaîne
  source_table text,
  source_id    text,
  etat         text not null default 'a_faire' check (etat in ('a_faire', 'envoye', 'confirme', 'echoue')),
  tx_hash      text,
  tx_brut      text,
  bloc         bigint,
  resultat     text,
  cree_le      timestamptz not null default now(),
  traite_le    timestamptz
);
create index if not exists reserve_chaine_a_faire on reserve_chaine (reseau, id) where etat in ('a_faire', 'envoye');
create index if not exists reserve_chaine_source on reserve_chaine (source_table, source_id);
alter table reserve_chaine enable row level security;

-- Le réseau qui porte la réserve : un seul, sinon le même franc serait compté deux fois.
create or replace function _reseau_de_la_reserve() returns text
language sql stable set search_path = public as $$
  select coalesce(parametre('chaine') ->> 'reserve', 'bep20')
$$;

-- Chaque ligne d'emissions devient une ligne à jouer sur la chaîne, dans la même transaction.
create or replace function _vers_la_reserve() returns trigger
language plpgsql set search_path = public as $$
declare v_ref text := coalesce(new.source_id, new.sens || '-' || new.id);
begin
  if exists (select 1 from reserve_chaine where reference = v_ref) then v_ref := v_ref || '#' || new.id; end if;
  insert into reserve_chaine (emission_id, reseau, operation, montant, reference, source_table, source_id)
  values (new.id, _reseau_de_la_reserve(),
          case when new.sens in ('emission', 'depuis_chaine') then 'frapper' else 'detruire' end,
          new.montant, v_ref, new.source_table, new.source_id)
  on conflict (emission_id) do nothing;
  return new;
end $$;

drop trigger if exists emissions_vers_la_reserve on emissions;
create trigger emissions_vers_la_reserve after insert on emissions
  for each row execute function _vers_la_reserve();

-- Ce qui existait avant cette migration se joue aussi : la réserve part de zéro et rattrape tout, dans l'ordre.
do $$
declare e emissions;
begin
  for e in select * from emissions where id not in (select emission_id from reserve_chaine) order by id loop
    insert into reserve_chaine (emission_id, reseau, operation, montant, reference, source_table, source_id)
    values (e.id, _reseau_de_la_reserve(),
            case when e.sens in ('emission', 'depuis_chaine') then 'frapper' else 'detruire' end,
            e.montant,
            case when exists (select 1 from reserve_chaine r where r.reference = coalesce(e.source_id, e.sens || '-' || e.id))
                 then coalesce(e.source_id, e.sens || '-' || e.id) || '#' || e.id else coalesce(e.source_id, e.sens || '-' || e.id) end,
            e.source_table, e.source_id);
  end loop;
end $$;

-- ───────────────────────────── le veilleur ─────────────────────────────────
-- Les opérations à jouer, DANS L'ORDRE : une destruction ne passe jamais
-- avant la frappe qui l'a rendue possible. Une ligne envoyée et pas encore
-- confirmée arrête la file (le veilleur la suit, puis continue).
create or replace function chaine_reserve_a_jouer(p_reseau text, p_n int default 20)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'operation', operation, 'montant', montant, 'reference', reference,
                                               'etat', etat, 'tx_hash', tx_hash, 'tx_brut', tx_brut) order by id), '[]'::jsonb)
    from (select * from reserve_chaine where reseau = p_reseau and etat in ('a_faire', 'envoye') order by id limit greatest(1, least(p_n, 100))) r
$$;

-- Noté AVANT d'être diffusé : après une coupure, c'est cette transaction-là qui repart.
create or replace function chaine_reserve_marquer_envoi(p_id bigint, p_tx_hash text, p_brut text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update reserve_chaine set etat = 'envoye', tx_hash = p_tx_hash, tx_brut = p_brut
   where id = p_id and etat in ('a_faire', 'envoye');
  if not found then raise exception 'opération de réserve inconnue ou close'; end if;
end $$;

create or replace function chaine_reserve_resultat(p_id bigint, p_ok boolean, p_bloc bigint, p_resultat text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update reserve_chaine set etat = case when p_ok then 'confirme' else 'echoue' end, bloc = p_bloc,
                            resultat = p_resultat, traite_le = now()
   where id = p_id and etat = 'envoye';
  if not found then raise exception 'opération de réserve pas en cours'; end if;
end $$;

-- Une opération refusée par la chaîne (plafond du jour atteint, pause) se rejoue à la main, par l'équipe.
create or replace function admin_reserve_rejouer(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('sorties');
  update reserve_chaine set etat = 'a_faire', tx_hash = null, tx_brut = null, resultat = null where id = p_id and etat = 'echoue';
  if not found then raise exception 'seule une opération refusée se rejoue'; end if;
  perform _journaliser('rejouer_reserve', p_id::text);
  return jsonb_build_object('ok', true);
end $$;

-- L'état de la réserve pour l'équipe : ce que la base attend sur la chaîne, et ce qui reste à jouer.
create or replace function admin_reserve() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('voir');
  return jsonb_build_object(
    'reseau', _reseau_de_la_reserve(),
    'attendu', circulation(),
    'confirme', (select coalesce(sum(case operation when 'frapper' then montant else -montant end), 0) from reserve_chaine where etat = 'confirme'),
    'en_attente', (select count(*) from reserve_chaine where etat in ('a_faire', 'envoye')),
    'refusees', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'operation', operation, 'montant', montant, 'reference', reference, 'resultat', resultat) order by id), '[]'::jsonb)
                   from reserve_chaine where etat = 'echoue'));
end $$;

-- ───────────────────────────── ce que voit le client ───────────────────────
-- Un dépôt porte maintenant sa trace sur la chaîne : réseau, transaction, bloc, référence scellée.
create or replace function _trace_chaine(p_table text, p_source text) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('reseau', r.reseau, 'operation', r.operation, 'montant', r.montant,
                                               'reference', r.reference, 'etat', r.etat, 'tx_hash', r.tx_hash, 'bloc', r.bloc,
                                               'essai', coalesce((parametre('chaine') ->> 'essai')::boolean, false),
                                               'contrat', parametre('chaine') -> r.reseau ->> 'xafe',
                                               'reserve', (select etat ->> 'chaud' from chaine_etats e where e.reseau = r.reseau),
                                               'confirme_le', r.traite_le) order by r.id), '[]'::jsonb)
    from reserve_chaine r where r.source_table = p_table and r.source_id = p_source
$$;

create or replace function _depot_json(d depots) returns jsonb
language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object(
    'reference', d.reference, 'etat', d.etat, 'operateur', d.operateur,
    'montant_recu', d.montant_recu,
    'float_numero', f.numero,
    'titulaire', f.titulaire,
    'code_agent', f.code_agent,
    'reception', case when not coalesce(f.actif, false) then 'fermee'
                      when t.vu_le is null or t.vu_le < now() - interval '10 minutes' then 'retardee'
                      else 'ouverte' end,
    'declarations', (select coalesce(jsonb_agg(_declaration_json(x) order by x.declare_le), '[]'::jsonb)
                       from depot_declarations x where x.depot_id = d.id),
    'chaine', _trace_chaine('depots', d.reference),
    'cree_le', d.cree_le, 'expire_le', d.expire_le, 'credite_le', d.credite_le)
    from (select 1) _ left join floats f on f.id = d.float_id left join terminaux t on t.id = f.terminal
$$;

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on table reserve_chaine from public, anon, authenticated;
grant all on table reserve_chaine to service_role;
revoke all on function _reseau_de_la_reserve(), _vers_la_reserve(), _trace_chaine(text, text),
                       chaine_reserve_a_jouer(text, int), chaine_reserve_marquer_envoi(bigint, text, text),
                       chaine_reserve_resultat(bigint, boolean, bigint, text), admin_reserve_rejouer(bigint), admin_reserve()
  from public, anon, authenticated;
grant execute on function chaine_reserve_a_jouer(text, int), chaine_reserve_marquer_envoi(bigint, text, text),
                          chaine_reserve_resultat(bigint, boolean, bigint, text) to service_role;
grant execute on function admin_reserve_rejouer(bigint), admin_reserve() to authenticated;
$sql$;
    raise notice '0015_reserve_sur_la_chaine.sql : appliquée';
  end if;
end $consolide$;

-- ─── 0016_parite.sql (md5 601a880bf879f8613b572a6bfee7a50b) ───
-- déjà en place si : rejouable telle quelle
do $consolide$
begin
  if false then
    raise notice '0016_parite.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0016 · la parité, prouvée à trois colonnes                   ║
-- ║                                                                        ║
-- ║  1 XAFe = 1 XAF. Le dire ne prouve rien. Trois chiffres, venus de      ║
-- ║  trois sources qui ne se connaissent pas, doivent se tenir :           ║
-- ║                                                                        ║
-- ║    LES FLOATS   l'argent réellement posé chez MTN et Orange, tel que   ║
-- ║                 l'OPÉRATEUR l'annonce (le « nouveau solde » de chaque  ║
-- ║                 SMS relevé par TOTEM, un solde USSD, ou le relevé      ║
-- ║                 officiel saisi par l'équipe) — jamais un calcul à nous ║
-- ║    LE REGISTRE  ce que Glisil doit : chaque XAFe émis contre des XAF   ║
-- ║                 reçus, moins chaque XAFe détruit contre des XAF payés  ║
-- ║    LA CHAÎNE    l'offre du jeton sur la BNB Smart Chain et sur Tron,   ║
-- ║                 relue frappe par frappe sur la chaîne elle-même par    ║
-- ║                 le veilleur, sans se fier à ses propres notes          ║
-- ║                                                                        ║
-- ║  Les règles, contrôlées toutes les cinq minutes :                      ║
-- ║    · chaîne = registre, AU FRANC PRÈS, une fois les opérations en      ║
-- ║      route comptées ;                                                  ║
-- ║    · chaque frappe et chaque destruction lue sur la chaîne a sa ligne  ║
-- ║      dans le registre (même référence, même montant), et l'inverse ;   ║
-- ║    · l'offre lue au contrat = la somme des mouvements relus (la        ║
-- ║      lecture n'a rien manqué) ;                                        ║
-- ║    · floats ≥ registre : l'argent posé couvre ce qui est dû. PAS       ║
-- ║      l'égalité — les floats portent aussi les frais gagnés et         ║
-- ║      l'argent propre de l'entreprise ; l'excédent se montre.          ║
-- ║  Au premier franc d'écart, une alarme ; vue deux fois de suite (cinq   ║
-- ║  minutes d'écart, pour ne pas crier sur une opération à mi-chemin),    ║
-- ║  elle part aussi par SMS au numéro que l'équipe a posé.                ║
-- ║                                                                        ║
-- ║  Et tout cela se lit sans compte, sur une page publique : n'importe    ║
-- ║  qui peut refaire les calculs avec un explorateur de blocs.            ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ───────────────────────────── réglages ────────────────────────────────────
-- Le bloc du déploiement de chaque contrat : la lecture du jeton part de là,
-- pour qu'aucune frappe ne lui échappe. Posé pour les contrats d'essai connus ;
-- un autre déploiement le pose lui-même (chaine/README.md).
update parametres set valeur = jsonb_set(valeur, '{bep20,depart}', '137002002'::jsonb)
 where cle = 'chaine' and valeur #>> '{bep20,xafe}' = '0x750E774368240063BD5CF52b30b91183Efa4dAf3' and valeur #> '{bep20,depart}' is null;
update parametres set valeur = jsonb_set(valeur, '{trc20,depart}', '71854913'::jsonb)
 where cle = 'chaine' and valeur #>> '{trc20,xafe}' = 'TFtfFFmagGUjxGrG3cM4MX4kTv8YvBgLnk' and valeur #> '{trc20,depart}' is null;

-- L'alarme : à quel numéro l'envoyer par SMS (aucun d'office), au bout de
-- combien d'heures un solde de float ne vaut plus « connu », au bout de
-- combien de minutes une opération attendue et absente de la chaîne est une
-- anomalie, et si la page publique montre le solde des floats.
insert into parametres (cle, valeur) values
  ('parite', '{"alerte_numero": null, "alerte_operateur": "mtn", "fraicheur_heures": 24, "delai_minutes": 30, "publier_floats": true}')
on conflict (cle) do nothing;

-- ─────────────────── la colonne « floats » : ce que dit l'opérateur ──────────
create table if not exists soldes_floats (
  id         bigint generated always as identity primary key,
  float_id   int not null references floats(id),
  solde      numeric(20,2) not null check (solde >= 0),
  annonce_le timestamptz not null,                     -- l'heure à laquelle l'OPÉRATEUR l'a annoncé
  source     text not null check (source in ('sms', 'ussd', 'releve')),
  terminal   text,
  source_id  bigint,                                   -- la ligne du journal de TOTEM, pour un SMS
  preuve     text,                                     -- le relevé déposé par l'équipe (chemin dans le stockage)
  note       text,
  saisi_par  uuid,
  cree_le    timestamptz not null default now()
);
create unique index if not exists soldes_floats_un_sms on soldes_floats (terminal, source_id) where source = 'sms';
create index if not exists soldes_floats_dernier on soldes_floats (float_id, annonce_le desc, id desc);
alter table soldes_floats enable row level security;

-- Le dernier solde annoncé de chaque float. L'heure de l'annonce décide, pas
-- celle de l'arrivée : un SMS relevé en retard ne remplace pas un plus récent.
create or replace function _solde_float(p_float int) returns soldes_floats
language sql stable set search_path = public as $$
  select * from soldes_floats where float_id = p_float order by annonce_le desc, id desc limit 1
$$;

-- TOTEM (par la porte signée, clé de service) : le solde que l'opérateur
-- vient d'annoncer sur ce float. Un float qui n'est pas celui de ce terminal
-- est refusé ; un SMS rejoué ne compte qu'une fois.
create or replace function totem_solde_float(p_terminal text, p_operateur text, p_float_numero text, p_solde numeric,
                                             p_annonce_le timestamptz, p_source text, p_source_id bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_float floats; v_id bigint;
begin
  if p_source not in ('sms', 'ussd') then raise exception 'source inconnue'; end if;
  if p_solde is null or p_solde < 0 then return jsonb_build_object('resultat', 'refuse', 'motif', 'solde illisible'); end if;
  select * into v_float from floats
   where operateur = p_operateur and numero = normaliser_numero(p_float_numero) and terminal = p_terminal;
  if not found then return jsonb_build_object('resultat', 'refuse', 'motif', 'ce float n''est pas sur ce terminal'); end if;
  -- une heure dans le futur (horloge du modem déréglée) ne doit pas figer ce solde devant tous les suivants
  insert into soldes_floats (float_id, solde, annonce_le, source, terminal, source_id)
  values (v_float.id, p_solde, least(coalesce(p_annonce_le, now()), now()), p_source, p_terminal, p_source_id)
  on conflict (terminal, source_id) where source = 'sms' do nothing
  returning id into v_id;
  return jsonb_build_object('resultat', case when v_id is null then 'deja' else 'note' end, 'float', v_float.id);
end $$;

-- L'équipe : le solde du RELEVÉ officiel de l'opérateur (l'export MTN ou
-- Orange), avec sa preuve. C'est lui qui fait foi quand un SMS manque.
create or replace function admin_saisir_releve(p_float int, p_solde numeric, p_annonce_le timestamptz, p_preuve text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform _exiger_droit('rapprocher');
  if p_solde is null or p_solde < 0 or not (p_solde = round(p_solde, 2)) then raise exception 'solde invalide'; end if;
  if p_annonce_le is null or p_annonce_le > now() + interval '5 minutes' then raise exception 'la date du relevé est dans le futur'; end if;
  if coalesce(p_preuve, '') = '' then raise exception 'le relevé de l''opérateur est exigé : déposez le fichier'; end if;
  if not exists (select 1 from floats where id = p_float) then raise exception 'float inconnu'; end if;
  insert into soldes_floats (float_id, solde, annonce_le, source, preuve, note, saisi_par)
  values (p_float, p_solde, p_annonce_le, 'releve', p_preuve, left(p_note, 500), auth.uid())
  returning id into v_id;
  perform _journaliser('saisir_releve', p_float::text, jsonb_build_object('solde', p_solde, 'annonce_le', p_annonce_le));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ─────────────────── la colonne « chaîne » : ce que la chaîne dit ────────────
-- L'empreinte de chaque référence : keccak256 de son texte, ce que le contrat
-- scelle dans chaque frappe et chaque destruction. La base ne sait pas le
-- calculer ; le veilleur le fait, et n'importe qui peut le refaire.
create table if not exists chaine_empreintes (
  empreinte text primary key,
  reference text not null,
  note_le   timestamptz not null default now()
);
create index if not exists chaine_empreintes_reference on chaine_empreintes (reference);
alter table chaine_empreintes enable row level security;

-- Chaque frappe et chaque destruction de XAFe, relue sur la chaîne depuis le
-- déploiement du contrat. Rien ici ne vient de nos propres notes d'envoi.
create table if not exists chaine_mouvements_jeton (
  reseau    text not null check (reseau in ('bep20', 'trc20')),
  tx_hash   text not null,
  idx       int not null,
  bloc      bigint not null,
  genre     text not null check (genre in ('frappe', 'destruction')),
  adresse   text not null,
  montant   numeric(30,6) not null check (montant > 0),
  empreinte text,                                      -- null : aucune Frappe / aucun Detruit ne l'accompagnait
  vu_le     timestamptz not null default now(),
  primary key (reseau, tx_hash, idx)
);
create index if not exists chaine_mouvements_empreinte on chaine_mouvements_jeton (empreinte);
alter table chaine_mouvements_jeton enable row level security;

-- Les références dont le veilleur doit encore calculer l'empreinte.
create or replace function chaine_references_sans_empreinte(p_n int default 500) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(reference), '[]'::jsonb) from (
    select distinct x.reference from (
      select reference from reserve_chaine
      union all select reference from retraits_crypto where actif = 'XAFe' and tx_hash is not null
      union all select tx_hash from transferts_crypto where actif = 'XAFe' and sens = 'entree' and tx_hash is not null
    ) x where not exists (select 1 from chaine_empreintes e where e.reference = x.reference)
    limit greatest(1, least(p_n, 1000))) r
$$;

create or replace function chaine_noter_empreintes(p_empreintes jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- une empreinte qui désignerait deux références : impossible avec keccak256, donc un défaut à crier, pas à écraser
  if exists (select 1 from jsonb_to_recordset(p_empreintes) as x(empreinte text, reference text)
               join chaine_empreintes e on e.empreinte = lower(x.empreinte) and e.reference <> x.reference) then
    raise exception 'une empreinte déjà notée pour une autre référence';
  end if;
  insert into chaine_empreintes (empreinte, reference)
  select lower(x.empreinte), x.reference from jsonb_to_recordset(p_empreintes) as x(empreinte text, reference text)
   where x.empreinte ~ '^0x[0-9a-fA-F]{64}$' and coalesce(x.reference, '') <> ''
  on conflict (empreinte) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Les mouvements relus ET le curseur, dans la même transaction : un tour
-- coupé ne saute aucun bloc, et relire n'ajoute rien.
create or replace function chaine_noter_mouvements(p_reseau text, p_jusqua bigint, p_mouvements jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into chaine_mouvements_jeton (reseau, tx_hash, idx, bloc, genre, adresse, montant, empreinte)
  select p_reseau, x.tx, x.index, x.bloc, x.genre, x.adresse, x.montant, lower(x.empreinte)
    from jsonb_to_recordset(p_mouvements) as x(tx text, index int, bloc bigint, genre text, adresse text, montant numeric, empreinte text)
  on conflict (reseau, tx_hash, idx) do nothing;
  get diagnostics n = row_count;
  perform chaine_curseur(p_reseau || ':jeton', p_jusqua);
  return n;
end $$;

create or replace function _explorateur(p_reseau text) returns text
language sql stable set search_path = public as $$
  select case p_reseau
    when 'bep20' then case when coalesce((parametre('chaine') ->> 'essai')::boolean, false) then 'https://testnet.bscscan.com' else 'https://bscscan.com' end
    when 'trc20' then case when coalesce((parametre('chaine') ->> 'essai')::boolean, false) then 'https://nile.tronscan.org/#' else 'https://tronscan.org/#' end
  end
$$;

-- ─────────────────── le rapprochement, ligne par ligne ───────────────────────
-- D'un côté ce que le registre attend sur la chaîne :
--   reserve  chaque frappe / destruction de la réserve (0015) ;
--   retrait  chaque frappe vers le wallet d'un client (un retrait XAFe) ;
--   retour   chaque destruction de XAFe rendus par un client (sur son adresse de dépôt).
-- De l'autre ce que la chaîne montre. Le lien : la référence, par son empreinte.
-- Les verdicts :
--   concorde    vu des deux côtés, même sens, même montant ;
--   en_route    attendu, pas encore lu sur la chaîne, dans le délai ;
--   en_retard   attendu, pas encore lu, au-delà du délai — anomalie ;
--   refusee     la chaîne a refusé l'opération — anomalie, l'équipe la rejoue ;
--   ecart       vu des deux côtés, mais pas le même montant — anomalie ;
--   inconnue    lu sur la chaîne, et le registre ne l'explique pas — anomalie grave.
create or replace function _parite_lignes() returns table (
  reference text, nature text, reseau text, genre text, montant numeric, etat_registre text, tx_attendu text, depuis timestamptz,
  empreinte text, tx_vu text, bloc_vu bigint, montant_vu numeric, adresse_vue text, verdict text)
language sql stable set search_path = public as $$
  with attendu as (
    select r.reference, 'reserve'::text nature, r.reseau, case r.operation when 'frapper' then 'frappe' else 'destruction' end genre,
           r.montant::numeric montant, r.etat etat_registre, r.tx_hash tx_attendu, r.cree_le depuis
      from reserve_chaine r
    union all
    select x.reference, 'retrait', x.reseau, 'frappe', x.montant, case x.etat when 'envoye' then 'confirme' else 'envoye' end, x.tx_hash, x.cree_le
      from retraits_crypto x where x.actif = 'XAFe' and x.tx_hash is not null and x.etat in ('en_cours', 'envoye')
    union all
    select t.tx_hash, 'retour', t.reseau, 'destruction', t.montant, 'confirme', null, t.cree_le
      from transferts_crypto t where t.actif = 'XAFe' and t.sens = 'entree'
  ), vu as (
    select m.*, e.reference from chaine_mouvements_jeton m left join chaine_empreintes e on e.empreinte = m.empreinte
  ), delai as (select make_interval(mins => coalesce((parametre('parite') ->> 'delai_minutes')::int, 30)) d)
  select coalesce(a.reference, v.reference), coalesce(a.nature, 'inconnue'), coalesce(a.reseau, v.reseau), coalesce(a.genre, v.genre),
         a.montant, a.etat_registre, a.tx_attendu, coalesce(a.depuis, v.vu_le),
         v.empreinte, v.tx_hash, v.bloc, v.montant, v.adresse,
         case
           when a.reference is null then 'inconnue'
           when v.tx_hash is null and a.etat_registre = 'echoue' then 'refusee'
           when v.tx_hash is null and a.depuis > now() - (select d from delai) then 'en_route'
           when v.tx_hash is null then 'en_retard'
           -- un retour se crédite au centime près, arrondi vers le bas : le reste de la chaîne n'est dû à personne
           when a.nature = 'retour' and floor(v.montant * 100) / 100 = a.montant then 'concorde'
           when v.montant = a.montant then 'concorde'
           else 'ecart' end
    from attendu a
    full join vu v on v.reference = a.reference and v.reseau = a.reseau and v.genre = a.genre
$$;

-- ─────────────────── le relevé de parité, toutes les cinq minutes ────────────
create table if not exists parite_releves (
  id           bigint generated always as identity primary key,
  fait_le      timestamptz not null default now(),
  registre     numeric(20,2) not null,                 -- ce que Glisil doit : émis − détruits
  dans_comptes numeric(20,2) not null,                 -- dont dans les comptes Glisil
  sur_wallets  numeric(20,2) not null,                 -- dont sur les wallets des clients
  chaine       numeric(30,6),                          -- l'offre du jeton, relue mouvement par mouvement (null : lecture pas à jour)
  offre_lue    numeric(30,6),                          -- l'offre lue au contrat, au même bloc
  en_route     numeric(30,6) not null,                 -- ce qui est attendu et pas encore lu (frappes +, destructions −)
  ecart        numeric(30,6),                          -- chaîne + en route − registre : 0, toujours
  floats       numeric(20,2),                          -- la somme des derniers soldes annoncés (null : un float sans solde connu)
  couverture   numeric(20,2),                          -- floats − registre : jamais négatif
  anomalies    int not null,
  statut       text not null check (statut in ('juste', 'en_cours', 'ecart', 'incomplet')),
  detail       jsonb not null
);
create index if not exists parite_releves_dernier on parite_releves (fait_le desc);
alter table parite_releves enable row level security;

create table if not exists parite_alertes (
  id         bigint generated always as identity primary key,
  code       text not null,                            -- ecart_chaine, ligne:<référence>, lecture, couverture, float:<id>
  gravite    text not null check (gravite in ('grave', 'anomalie', 'attention')),
  message    text not null,
  detail     jsonb,
  ouverte_le timestamptz not null default now(),
  vue_le     timestamptz not null default now(),
  vues       int not null default 1,
  sms_le     timestamptz,
  close_le   timestamptz
);
create unique index if not exists parite_alertes_une_ouverte on parite_alertes (code) where close_le is null;
alter table parite_alertes enable row level security;

-- Ce que l'état de la chaîne publié par le veilleur dit du jeton, réseau par réseau.
create or replace function _jeton_publie() returns table (reseau text, offre numeric, reserve numeric, bloc bigint, a_jour boolean, lu_le timestamptz)
language sql stable set search_path = public as $$
  select e.reseau, (e.etat -> 'jeton' ->> 'offre')::numeric, (e.etat -> 'jeton' ->> 'reserve')::numeric,
         (e.etat -> 'jeton' ->> 'bloc')::bigint, coalesce((e.etat -> 'jeton' ->> 'a_jour')::boolean, false),
         (e.etat -> 'jeton' ->> 'lu_le')::timestamptz
    from chaine_etats e
   where (parametre('chaine') -> e.reseau) is not null and jsonb_typeof(parametre('chaine') -> e.reseau) = 'object'
$$;

-- Ouvrir (ou rafraîchir) une alerte ; l'envoyer par SMS quand elle a été vue
-- deux fois de suite et qu'un numéro est posé — une seule fois par alerte.
create or replace function _parite_alerter(p_code text, p_gravite text, p_message text, p_detail jsonb) returns void
language plpgsql set search_path = public as $$
declare v parite_alertes; v_num text := normaliser_numero(parametre('parite') ->> 'alerte_numero'); v_op text := coalesce(parametre('parite') ->> 'alerte_operateur', 'mtn');
        v_float floats;
begin
  insert into parite_alertes (code, gravite, message, detail) values (p_code, p_gravite, p_message, p_detail)
  on conflict (code) where close_le is null
  do update set vue_le = now(), vues = parite_alertes.vues + 1, message = excluded.message, detail = excluded.detail, gravite = excluded.gravite
  returning * into v;
  if v.vues >= 2 and v.sms_le is null and p_gravite in ('grave', 'anomalie') and coalesce(v_num, '') <> '' then
    select f.* into v_float from floats f join terminaux t on t.id = f.terminal
     where f.operateur = v_op and f.actif order by t.vu_le desc nulls last, f.id limit 1;
    if found then
      insert into messages_sortants (terminal, operateur, numero, texte, cle, expire_le)
      values (v_float.terminal, v_op, v_num, left('Glisil PARITE : ' || p_message, 300), 'parite-' || v.id, now() + interval '1 hour')
      on conflict (cle) do nothing;
      update parite_alertes set sms_le = now() where id = v.id;
    end if;
  end if;
end $$;

create or replace function rapprocher() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_registre numeric; v_comptes numeric := circulation(); v_wallets numeric := circulation_chaine();
  v_chaine numeric; v_offre numeric; v_en_route numeric; v_retraits_vus numeric; v_ecart numeric;
  v_floats numeric; v_couverture numeric; v_statut text; v_anomalies int := 0; v_codes text[] := '{}';
  v_fraicheur interval := make_interval(hours => coalesce((parametre('parite') ->> 'fraicheur_heures')::int, 24));
  v_reseaux int; v_a_jour int; v_floats_detail jsonb; v_lignes jsonb; v_id bigint; l record; f record;
begin
  -- un seul relevé à la fois : deux appels croisés ne se contredisent pas
  perform pg_advisory_xact_lock(hashtext('rapprocher'));
  select coalesce(sum(case sens when 'emission' then montant when 'destruction' then -montant else 0 end), 0) into v_registre from emissions;

  -- LA CHAÎNE : la somme des mouvements relus, réseau par réseau configuré ; l'offre lue au contrat au même bloc
  select count(*), count(*) filter (where a_jour) into v_reseaux, v_a_jour from _jeton_publie();
  select coalesce(sum(case genre when 'frappe' then montant else -montant end), 0) into v_chaine from chaine_mouvements_jeton
   where reseau in (select reseau from _jeton_publie());
  select sum(offre) into v_offre from _jeton_publie() where a_jour;
  if v_reseaux = 0 or v_a_jour < v_reseaux then v_offre := null; end if;

  -- CE QUI EST EN ROUTE : attendu par le registre, pas encore lu sur la chaîne (une opération refusée n'est PAS en route)
  select coalesce(sum(case genre when 'frappe' then coalesce(montant, 0) else -coalesce(montant, 0) end), 0) into v_en_route
    from _parite_lignes() where verdict in ('en_route', 'en_retard') and nature <> 'retrait';
  -- un retrait est déjà frappé vers le client mais pas encore confirmé dans le registre : la destruction de la réserve suivra
  select coalesce(sum(p.montant_vu), 0) into v_retraits_vus from _parite_lignes() p
   where p.nature = 'retrait' and p.etat_registre = 'envoye' and p.tx_vu is not null;
  -- un retrait confirmé dont la frappe n'est pas encore relue : elle compte comme en route
  v_en_route := v_en_route + (select coalesce(sum(montant), 0) from _parite_lignes() where nature = 'retrait' and etat_registre = 'confirme' and verdict in ('en_route', 'en_retard'));
  v_ecart := case when v_offre is null then null else v_chaine + v_en_route - v_retraits_vus - v_registre end;

  -- LES FLOATS : le dernier solde annoncé de chaque float actif ; un seul inconnu ou trop vieux, et le total ne se dit pas
  select jsonb_agg(jsonb_build_object('id', x.id, 'operateur', x.operateur, 'numero', x.numero, 'solde', (x.s).solde,
                                      'annonce_le', (x.s).annonce_le, 'source', (x.s).source,
                                      'connu', (x.s).id is not null and (x.s).annonce_le > now() - v_fraicheur) order by x.id),
         case when bool_and((x.s).id is not null and (x.s).annonce_le > now() - v_fraicheur) then sum((x.s).solde) end
    into v_floats_detail, v_floats
    from (select fl.id, fl.operateur, fl.numero, _solde_float(fl.id) s from floats fl where fl.actif) x;
  v_couverture := v_floats - v_registre;

  -- LES ANOMALIES, une alerte chacune
  for l in select * from _parite_lignes() where verdict in ('en_retard', 'refusee', 'ecart', 'inconnue') loop
    v_anomalies := v_anomalies + 1;
    v_codes := v_codes || ('ligne:' || coalesce(l.reseau, '?') || ':' || coalesce(l.reference, l.tx_vu));
    perform _parite_alerter('ligne:' || coalesce(l.reseau, '?') || ':' || coalesce(l.reference, l.tx_vu),
      case l.verdict when 'inconnue' then 'grave' else 'anomalie' end,
      case l.verdict
        when 'inconnue' then format('%s de %s XAFe sur %s que le registre n''explique pas (tx %s)', l.genre, l.montant_vu, upper(l.reseau), l.tx_vu)
        when 'ecart' then format('%s : %s XAFe attendus, %s lus sur la chaîne', l.reference, l.montant, l.montant_vu)
        when 'refusee' then format('%s : %s de %s XAFe refusée par la chaîne', l.reference, l.genre, l.montant)
        else format('%s : %s de %s XAFe attendue depuis %s, absente de la chaîne', l.reference, l.genre, l.montant, to_char(l.depuis, 'DD/MM HH24:MI')) end,
      to_jsonb(l));
  end loop;
  if v_ecart is not null and v_ecart <> 0 then
    v_anomalies := v_anomalies + 1; v_codes := v_codes || 'ecart_chaine'::text;
    perform _parite_alerter('ecart_chaine', 'grave',
      format('chaîne %s + en route %s ≠ registre %s : écart de %s XAFe', v_chaine, v_en_route - v_retraits_vus, v_registre, v_ecart),
      jsonb_build_object('chaine', v_chaine, 'en_route', v_en_route, 'retraits_vus', v_retraits_vus, 'registre', v_registre, 'ecart', v_ecart));
  end if;
  -- la lecture : l'offre lue au contrat doit valoir la somme des mouvements relus, réseau par réseau
  for l in select j.reseau, j.offre, (select coalesce(sum(case genre when 'frappe' then montant else -montant end), 0)
                                        from chaine_mouvements_jeton m where m.reseau = j.reseau and m.bloc <= j.bloc) relu
             from _jeton_publie() j where j.a_jour loop
    if l.offre <> l.relu then
      v_anomalies := v_anomalies + 1; v_codes := v_codes || ('lecture:' || l.reseau);
      perform _parite_alerter('lecture:' || l.reseau, 'grave',
        format('%s : le contrat dit %s XAFe en circulation, les mouvements relus en font %s — la lecture a manqué quelque chose', upper(l.reseau), l.offre, l.relu),
        jsonb_build_object('offre', l.offre, 'relu', l.relu));
    end if;
  end loop;
  if v_couverture is not null and v_couverture < 0 then
    v_anomalies := v_anomalies + 1; v_codes := v_codes || 'couverture'::text;
    perform _parite_alerter('couverture', 'grave',
      format('les floats (%s XAF) ne couvrent pas ce qui est dû (%s XAFe) : il manque %s XAF', v_floats, v_registre, -v_couverture),
      jsonb_build_object('floats', v_floats, 'registre', v_registre));
  end if;
  -- ce qui empêche de conclure se dit aussi, sans crier : un float sans solde récent, une chaîne pas encore relue
  for f in select * from jsonb_to_recordset(coalesce(v_floats_detail, '[]'::jsonb)) as x(id int, operateur text, numero text, connu boolean, annonce_le timestamptz) where not x.connu loop
    v_codes := v_codes || ('float:' || f.id);
    perform _parite_alerter('float:' || f.id, 'attention',
      format('float %s %s : aucun solde annoncé depuis %s heures — TOTEM, une consultation USSD ou le relevé de l''opérateur', upper(f.operateur), f.numero,
             coalesce((parametre('parite') ->> 'fraicheur_heures'), '24')), to_jsonb(f));
  end loop;
  if v_offre is null then
    v_codes := v_codes || 'chaine_pas_a_jour'::text;
    perform _parite_alerter('chaine_pas_a_jour', 'attention', 'la lecture de la chaîne n''est pas encore à jour : l''écart ne se calcule pas encore', null);
  end if;
  -- ce qui n'est plus vrai se ferme
  update parite_alertes set close_le = now() where close_le is null and not (code = any (v_codes));

  v_statut := case when v_anomalies > 0 then 'ecart'
                   when v_offre is null or v_floats is null then 'incomplet'
                   when v_en_route <> 0 or v_retraits_vus <> 0 then 'en_cours'
                   else 'juste' end;
  select coalesce(jsonb_agg(jsonb_build_object('reseau', j.reseau, 'offre', j.offre, 'reserve', j.reserve, 'bloc', j.bloc, 'a_jour', j.a_jour, 'lu_le', j.lu_le)), '[]'::jsonb)
    into v_lignes from _jeton_publie() j;
  insert into parite_releves (registre, dans_comptes, sur_wallets, chaine, offre_lue, en_route, ecart, floats, couverture, anomalies, statut, detail)
  values (v_registre, v_comptes, v_wallets, case when v_offre is null then null else v_chaine end, v_offre, v_en_route - v_retraits_vus, v_ecart,
          v_floats, v_couverture, v_anomalies, v_statut, jsonb_build_object('reseaux', v_lignes, 'floats', coalesce(v_floats_detail, '[]'::jsonb)))
  returning id into v_id;
  -- l'historique se garde trente jours : de quoi montrer que c'était juste hier aussi
  delete from parite_releves where fait_le < now() - interval '30 days';
  return (select to_jsonb(p) from parite_releves p where p.id = v_id);
end $$;

-- ─────────────────── ce que voient l'équipe et tout le monde ─────────────────
create or replace function _parite_json(p_detail boolean) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'releve', (select to_jsonb(p) - 'detail' || jsonb_build_object('reseaux', p.detail -> 'reseaux',
                 'floats_detail', case when p_detail then p.detail -> 'floats'
                                when coalesce((parametre('parite') ->> 'publier_floats')::boolean, true)
                                then (select coalesce(jsonb_agg(jsonb_build_object('operateur', o, 'solde', s, 'annonce_le', d, 'connu', c)), '[]'::jsonb)
                                        from (select x ->> 'operateur' o, sum((x ->> 'solde')::numeric) s, min((x ->> 'annonce_le')::timestamptz) d, bool_and((x ->> 'connu')::boolean) c
                                                from jsonb_array_elements(p.detail -> 'floats') x group by 1) g) end)
                 from parite_releves p order by p.fait_le desc limit 1),
    'historique', (select coalesce(jsonb_agg(jsonb_build_object('fait_le', fait_le, 'statut', statut, 'registre', registre, 'chaine', chaine, 'ecart', ecart, 'floats', floats) order by fait_le), '[]'::jsonb)
                     from (select * from parite_releves where fait_le > now() - interval '7 days' and (extract(minute from fait_le)::int % 60) < 5 order by fait_le) h),
    'contrats', (select coalesce(jsonb_agg(jsonb_build_object('reseau', r, 'contrat', parametre('chaine') -> r ->> 'xafe', 'explorateur', _explorateur(r),
                                                       'reserve', (select etat ->> 'chaud' from chaine_etats e where e.reseau = r))), '[]'::jsonb)
                   from unnest(array['bep20', 'trc20']) r where jsonb_typeof(parametre('chaine') -> r) = 'object'),
    'essai', coalesce((parametre('chaine') ->> 'essai')::boolean, false),
    'lignes', (select coalesce(jsonb_agg(to_jsonb(l) - case when p_detail then '{}'::text[] else array['etat_registre', 'tx_attendu', 'adresse_vue'] end order by l.depuis desc), '[]'::jsonb)
                 from (select * from _parite_lignes() order by depuis desc limit case when p_detail then 500 else 100 end) l),
    'alertes', case when p_detail then (select coalesce(jsonb_agg(to_jsonb(a) order by a.ouverte_le desc), '[]'::jsonb)
                                          from parite_alertes a where a.close_le is null or a.close_le > now() - interval '7 days')
                    else (select count(*) from parite_alertes where close_le is null and gravite <> 'attention')::text::jsonb end)
$$;

-- La page publique : sans compte. Des totaux, des transactions publiques sur
-- la chaîne, des références de dossier — aucun nom, aucun numéro de client.
create or replace function preuve_de_reserve() returns jsonb
language sql stable security definer set search_path = public as $$
  select _parite_json(false)
$$;

create or replace function admin_parite() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('voir');
  return _parite_json(true) || jsonb_build_object(
    'reglages', parametre('parite'),
    'floats', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'operateur', f.operateur, 'numero', f.numero, 'titulaire', f.titulaire, 'actif', f.actif,
                                                     'dernier', to_jsonb(_solde_float(f.id)) - 'saisi_par') order by f.id), '[]'::jsonb) from floats f));
end $$;

create or replace function admin_rapprocher_maintenant() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('rapprocher');
  return rapprocher();
end $$;

-- Le tableau de bord compte aussi les alertes de parité ouvertes.
create or replace function admin_a_traiter() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('voir');
  return jsonb_build_object(
    'sorties_manuelles', (select count(*) from sorties where mode = 'manuel' and etat in ('en_attente', 'en_cours') and payee_le is null),
    'sorties_a_confirmer', (select count(*) from sorties where mode = 'manuel' and etat = 'en_cours' and payee_le is not null),
    'montant_a_payer', (select coalesce(sum(montant_xaf), 0) from sorties where mode = 'manuel' and etat in ('en_attente', 'en_cours') and payee_le is null),
    'sorties_non_expliquees', (select count(*) from sorties_constatees k
                                where not exists (select 1 from sorties s where s.operateur = k.operateur and s.transaction_id = k.transaction_id)),
    'parite', (select jsonb_build_object('statut', p.statut, 'ecart', p.ecart, 'couverture', p.couverture, 'fait_le', p.fait_le,
                                         'alertes', (select count(*) from parite_alertes where close_le is null and gravite <> 'attention'))
                 from parite_releves p order by p.fait_le desc limit 1));
end $$;

-- Le dépôt d'un client porte aussi l'empreinte et le lien de sa transaction.
create or replace function _trace_chaine(p_table text, p_source text) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('reseau', r.reseau, 'operation', r.operation, 'montant', r.montant,
                                               'reference', r.reference, 'etat', r.etat, 'tx_hash', r.tx_hash, 'bloc', r.bloc,
                                               'essai', coalesce((parametre('chaine') ->> 'essai')::boolean, false),
                                               'contrat', parametre('chaine') -> r.reseau ->> 'xafe',
                                               'reserve', (select etat ->> 'chaud' from chaine_etats e where e.reseau = r.reseau),
                                               'explorateur', _explorateur(r.reseau),
                                               'empreinte', (select e.empreinte from chaine_empreintes e where e.reference = r.reference limit 1),
                                               'relue', exists (select 1 from chaine_mouvements_jeton m where m.reseau = r.reseau and m.tx_hash = r.tx_hash),
                                               'confirme_le', r.traite_le) order by r.id), '[]'::jsonb)
    from reserve_chaine r where r.source_table = p_table and r.source_id = p_source
$$;

-- ─────────────────── le paramètre « parite », modifiable par l'équipe ────────
create or replace function _verifier_parametre(p_cle text, v jsonb) returns void
language plpgsql set search_path = public, extensions, pg_temp as $$
declare k text; p jsonb; ok boolean;
begin
  if jsonb_typeof(v) <> 'object' then raise exception 'paramètre invalide' using detail = 'un objet JSON est attendu'; end if;
  ok := case p_cle
    when 'frais' then _nombre_entre(v -> 'placeur', 0, 0.05) and _nombre_entre(v -> 'preneur', 0, 0.05) and _nombre_entre(v -> 'sortie', 0, 0.05)
    when 'marche' then v ->> 'paire' = 'USDT/XAFe' and _nombre_entre(v -> 'pas_prix', 0.01, 100) and _nombre_entre(v -> 'quantite_min', 0.01, 1000000)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
    when 'depot' then _nombre_entre(v -> 'validite_minutes', 5, 1440, true) and _nombre_entre(v -> 'grace_minutes', 0, 10080, true)
                      and (not (v ? 'declaration_complete') or jsonb_typeof(v -> 'declaration_complete') = 'boolean')
    when 'sortie' then _nombre_entre(v -> 'reprises_max', 1, 10, true)
                       and (not (v ? 'ouvertes') or jsonb_typeof(v -> 'ouvertes') = 'boolean')
                       and (not (v ? 'mode') or v ->> 'mode' in ('totem', 'manuel'))
                       and (not (v ? 'seuil_deux_personnes') or jsonb_typeof(v -> 'seuil_deux_personnes') = 'null'
                            or _nombre_entre(v -> 'seuil_deux_personnes', 1, 1e12))
    when 'rapide' then _nombre_entre(v -> 'marge', 0, 0.2) and _nombre_entre(v -> 'validite_secondes', 5, 120, true)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
    when 'code_secret' then _nombre_entre(v -> 'essais', 1, 10, true) and _nombre_entre(v -> 'verrou_minutes', 1, 1440, true)
                       and _nombre_entre(v -> 'longueur_min', 4, 6, true) and _nombre_entre(v -> 'longueur_max', 4, 8, true)
                       and (v ->> 'longueur_min')::int <= (v ->> 'longueur_max')::int
    when 'crypto' then _nombre_entre(v -> 'frais' -> 'USDT', 0, 1000) and _nombre_entre(v -> 'frais' -> 'XAFe', 0, 1000000)
                       and _nombre_entre(v -> 'confirmations' -> 'bep20', 1, 1000, true) and _nombre_entre(v -> 'confirmations' -> 'trc20', 1, 1000, true)
                       and jsonb_typeof(v -> 'retraits_ouverts') = 'boolean'
                       and (not (v ? 'depots_ouverts') or jsonb_typeof(v -> 'depots_ouverts') = 'boolean')
    when 'paliers' then (select bool_and(x) from (values (v ? '0'), (v ? '1'), (v ? '2')) t(x))
    when 'conditions' then coalesce(v ->> 'version', '') ~ '^\d{4}-\d{2}-\d{2}$'
    when 'support' then coalesce(v ->> 'email', '') ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'
                        and (jsonb_typeof(v -> 'whatsapp') = 'null' or coalesce(v ->> 'whatsapp', '') ~ '^\+[1-9][0-9]{7,14}$')
    when 'parite' then (jsonb_typeof(v -> 'alerte_numero') = 'null' or coalesce(v ->> 'alerte_numero', '') ~ '^\+?[0-9 ]{9,16}$')
                       and coalesce(v ->> 'alerte_operateur', '') in ('mtn', 'om')
                       and _nombre_entre(v -> 'fraicheur_heures', 1, 720, true) and _nombre_entre(v -> 'delai_minutes', 5, 1440, true)
                       and jsonb_typeof(v -> 'publier_floats') = 'boolean'
    else false end;
  if p_cle = 'paliers' and ok then
    foreach k in array array['0', '1', '2'] loop
      p := v -> k;
      if jsonb_typeof(p) = 'null' then continue; end if;
      if not (jsonb_typeof(p) = 'object' and _nombre_entre(p -> 'entree_jour', 0, 1e12, true) and _nombre_entre(p -> 'sortie_jour', 0, 1e12, true)) then
        ok := false;
      end if;
    end loop;
  end if;
  if not coalesce(ok, false) then
    raise exception 'paramètre invalide' using detail = format('« %s » : une clé manque, ou une valeur sort de ses bornes', p_cle);
  end if;
end $$;

-- ─────────────────── les relevés des opérateurs, déposés ─────────────────────
-- Le stockage « releves-floats » : privé, images et PDF de 10 Mo au plus. Seule
-- l'équipe qui rapproche dépose ; toute l'équipe relit.
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name) values ('releves-floats', 'releves-floats') on conflict (id) do nothing;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public') then
    execute $p$update storage.buckets set public = false where id = 'releves-floats'$p$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $p$update storage.buckets set file_size_limit = 10485760,
                 allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] where id = 'releves-floats'$p$;
  end if;
  execute $p$drop policy if exists releves_floats_deposer on storage.objects$p$;
  execute $p$drop policy if exists releves_floats_relire on storage.objects$p$;
  execute $p$create policy releves_floats_deposer on storage.objects for insert to authenticated
            with check (bucket_id = 'releves-floats' and public.admin_a_droit('rapprocher'))$p$;
  execute $p$create policy releves_floats_relire on storage.objects for select to authenticated
            using (bucket_id = 'releves-floats' and public.admin_a_droit('voir'))$p$;
end $$;

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on table soldes_floats, chaine_empreintes, chaine_mouvements_jeton, parite_releves, parite_alertes from public, anon, authenticated;
grant all on table soldes_floats, chaine_empreintes, chaine_mouvements_jeton, parite_releves, parite_alertes to service_role;
revoke all on function _solde_float(int), totem_solde_float(text, text, text, numeric, timestamptz, text, bigint),
                       admin_saisir_releve(int, numeric, timestamptz, text, text),
                       chaine_references_sans_empreinte(int), chaine_noter_empreintes(jsonb), chaine_noter_mouvements(text, bigint, jsonb),
                       _explorateur(text), _parite_lignes(), _jeton_publie(), _parite_alerter(text, text, text, jsonb), rapprocher(),
                       _parite_json(boolean), preuve_de_reserve(), admin_parite(), admin_rapprocher_maintenant()
  from public, anon, authenticated;
grant execute on function totem_solde_float(text, text, text, numeric, timestamptz, text, bigint),
                          chaine_references_sans_empreinte(int), chaine_noter_empreintes(jsonb), chaine_noter_mouvements(text, bigint, jsonb),
                          rapprocher() to service_role;
grant execute on function admin_saisir_releve(int, numeric, timestamptz, text, text), admin_parite(), admin_rapprocher_maintenant() to authenticated;
-- la preuve est publique : n'importe qui, sans compte
grant execute on function preuve_de_reserve() to anon, authenticated;

-- ─────────────────── toutes les cinq minutes, tout seul ──────────────────────
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron absent : rapprocher() ne sera pas planifiée sur cette base';
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'glisil-rapprocher';
  perform cron.schedule('glisil-rapprocher', '*/5 * * * *', 'select public.rapprocher()');
end $$;
$sql$;
    raise notice '0016_parite.sql : appliquée';
  end if;
end $consolide$;

-- ─── 0017_regles_du_marche.sql (md5 ec04d3751f0e5f21aa922a7c93f5f895) ───
-- déjà en place si : rejouable telle quelle
do $consolide$
begin
  if false then
    raise notice '0017_regles_du_marche.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0017 · les règles du marché USDT/XAFe                         ║
-- ║                                                                        ║
-- ║  Le moteur apparie déjà au meilleur prix puis au premier arrivé, au    ║
-- ║  prix de l'ordre qui attendait, un ordre entrant à la fois, les fonds  ║
-- ║  bloqués à la pose. Il lui manquait les garde-fous qu'une bourse       ║
-- ║  publie (la fiche « Trading Parameters » de Binance) :                 ║
-- ║    · une TAILLE MAXIMALE par ordre, et un plafond pour un ordre au      ║
-- ║      marché ;                                                          ║
-- ║    · une BANDE DE PRIX : un ordre limite reste entre 80 % et 110 %     ║
-- ║      (achat) / 90 % et 120 % (vente) du prix de référence — un doigt   ║
-- ║      qui glisse ne vend pas à 10 XAFe ;                                ║
-- ║    · une BANDE D'EXÉCUTION : un ordre au marché ne s'exécute pas à     ║
-- ║      plus de 5 % de la référence ; le reste est annulé ;                ║
-- ║    · un NOMBRE D'ORDRES OUVERTS par compte (200) ;                     ║
-- ║    · un PRIX DE RÉFÉRENCE : la moyenne des échanges des 5 dernières    ║
-- ║      minutes, sinon le dernier échange, sinon celui que l'équipe pose   ║
-- ║      (le marché qui démarre, carnet vide). Sans aucun des trois, pas    ║
-- ║      de bande : le premier ordre fait le marché.                       ║
-- ║  Le règlement complet, en clair : docs/REGLES-DU-MARCHE.md.             ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- Les règles en vigueur : les valeurs de départ, et ce que l'équipe a posé
-- par-dessus. Les valeurs de départ vivent ICI et non dans la ligne du
-- paramètre : un paramètre réécrit en entier par l'équipe (sans ces clés)
-- ne fait jamais disparaître un garde-fou en silence.
create or replace function _marche() returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'quantite_max', 1000000, 'marche_quantite_max', 100000, 'ordres_ouverts_max', 200,
    'bande_achat', jsonb_build_array(0.8, 1.1), 'bande_vente', jsonb_build_array(0.9, 1.2),
    'bande_execution', 0.05, 'prix_reference', null) || coalesce(parametre('marche'), '{}'::jsonb)
$$;

-- LE PRIX DE RÉFÉRENCE. Une moyenne pondérée sur cinq minutes, pas le seul
-- dernier échange : un échange minuscule au bord de la bande ne déplace pas la
-- bande de 20 % d'un coup (on ne « marche » pas le prix à petits pas).
create or replace function _prix_reference() returns numeric
language sql stable set search_path = public as $$
  select coalesce(
    (select round(sum(montant_xafe) / nullif(sum(quantite), 0), 2) from executions
      where paire = parametre('marche') ->> 'paire' and cree_le > now() - interval '5 minutes'),
    (select prix from executions where paire = parametre('marche') ->> 'paire' order by cree_le desc, id desc limit 1),
    (_marche() ->> 'prix_reference')::numeric)
$$;

-- Un ordre au marché ne prend pas une offre au-delà de la bande d'exécution.
create or replace function _dans_la_bande_d_execution(p_cote text, p_prix numeric, p_ref numeric) returns boolean
language sql stable set search_path = public as $$
  select p_ref is null
      or case when p_cote = 'achat' then p_prix <= p_ref * (1 + (_marche() ->> 'bande_execution')::numeric)
              else p_prix >= p_ref * (1 - (_marche() ->> 'bande_execution')::numeric) end
$$;

-- ───────────────── l'appariement, avec ses garde-fous ──────────────────────
create or replace function _placer_ordre(p_compte uuid, p_cote text, p_type text, p_quantite numeric, p_prix numeric, p_cle text, p_t_preneur numeric)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_compte  uuid := p_compte;
  v_frais   jsonb := parametre('frais');
  v_marche  jsonb := _marche();
  v_paire   text := v_marche ->> 'paire';
  v_pas     numeric := (v_marche ->> 'pas_prix')::numeric;
  v_qmin    numeric := (v_marche ->> 'quantite_min')::numeric;
  v_t_pren  numeric := coalesce(p_t_preneur, (v_frais ->> 'preneur')::numeric);
  v_t_plac  numeric := (v_frais ->> 'placeur')::numeric;
  v_o       ordres;
  v_c       ordres;
  v_e       executions;
  v_q       numeric;
  v_px      numeric;
  v_xafe    numeric;
  v_fa      numeric;   -- frais de l'acheteur, en USDT
  v_fv      numeric;   -- frais du vendeur, en XAFe
  v_diff    numeric;
  v_cible   numeric;   -- ce que l'achat limite doit garder bloqué après la tranche
  v_frais_usdt numeric := 0;   -- les frais de toutes les tranches, encaissés par la maison À LA FIN
  v_frais_xafe numeric := 0;
  v_dispo   numeric;
  v_auto    boolean := false;
  v_execs   jsonb := '[]'::jsonb;
  v_achet   uuid;
  v_vend    uuid;
  v_id      text;
  v_ref     numeric;   -- le prix de référence au moment où l'ordre arrive (_prix_reference)
  v_bande   jsonb;
  v_lo      numeric;
  v_hi      numeric;
begin
  perform _exiger_compte_actif(v_compte);
  if not coalesce((v_marche ->> 'ouvert')::boolean, true) then raise exception 'marché fermé'; end if;
  if p_cle is not null then
    select * into v_o from ordres where compte_id = v_compte and cle = p_cle;
    if found then return jsonb_build_object('ordre', _ordre_json(v_o), 'executions', '[]'::jsonb, 'deja', true); end if;
  end if;
  if p_cote not in ('achat', 'vente') then raise exception 'côté invalide'; end if;
  if p_type not in ('limite', 'marche') then raise exception 'type invalide'; end if;
  if p_quantite is null or p_quantite < v_qmin or p_quantite <> round(p_quantite, 2) then
    raise exception 'quantité invalide' using detail = format('au moins %s USDT, deux décimales', v_qmin);
  end if;
  if p_type = 'limite' then
    if p_prix is null or p_prix <= 0 or mod(p_prix, v_pas) <> 0 then
      raise exception 'prix invalide' using detail = format('un multiple de %s', v_pas);
    end if;
  else
    p_prix := null;
  end if;

  -- LES RÈGLES DU MARCHÉ (0017), comme la fiche « Trading Parameters » d'une
  -- bourse : une taille maximale par ordre, un plafond pour un ordre au marché,
  -- une bande de prix autour du prix de référence (un doigt qui glisse ne vend
  -- pas à 10 XAFe), un nombre d'ordres ouverts par compte. Chaque refus dit la
  -- règle et la borne.
  if p_quantite > coalesce((v_marche ->> 'quantite_max')::numeric, 1e12) then
    raise exception 'quantité trop grande' using detail = format('au plus %s USDT par ordre', v_marche ->> 'quantite_max');
  end if;
  if p_type = 'marche' and p_quantite > coalesce((v_marche ->> 'marche_quantite_max')::numeric, 1e12) then
    raise exception 'ordre au marché trop grand' using detail = format('au plus %s USDT au marché : au-delà, posez un ordre limite', v_marche ->> 'marche_quantite_max');
  end if;
  v_ref := _prix_reference();
  if p_type = 'limite' and v_ref is not null then
    v_bande := coalesce(v_marche -> case when p_cote = 'achat' then 'bande_achat' else 'bande_vente' end, '[0, 1e9]'::jsonb);
    v_lo := ceil(v_ref * (v_bande ->> 0)::numeric / v_pas) * v_pas;
    v_hi := floor(v_ref * (v_bande ->> 1)::numeric / v_pas) * v_pas;
    if p_prix < v_lo or p_prix > v_hi then
      raise exception 'prix hors de la bande' using detail = format('%s : entre %s et %s XAFe (référence %s)',
        case when p_cote = 'achat' then 'un achat' else 'une vente' end, v_lo, v_hi, v_ref);
    end if;
  end if;
  if p_type = 'limite' and (select count(*) from ordres where compte_id = v_compte and etat in ('ouvert', 'partiel'))
                           >= coalesce((v_marche ->> 'ordres_ouverts_max')::int, 1000000) then
    raise exception 'trop d''ordres ouverts' using detail = format('au plus %s : annulez-en un', v_marche ->> 'ordres_ouverts_max');
  end if;

  -- Une paire s'apparie en file : un seul ordre entrant à la fois. Toute écriture
  -- au carnet (placer, annuler, l'achat rapide) prend ce même verrou ; la ligne en
  -- face se lit donc « for update » SANS « skip locked » : un chemin qui oublierait
  -- le verrou ferait ATTENDRE l'ordre, jamais sauter un meilleur prix.
  perform pg_advisory_xact_lock(hashtext(v_paire));
  -- relu sous le verrou : la référence est celle du carnet que l'ordre va parcourir
  v_ref := _prix_reference();

  insert into ordres (compte_id, paire, cote, type, prix, quantite, restant, cle)
  values (v_compte, v_paire, p_cote, p_type, p_prix, p_quantite, p_quantite, p_cle)
  returning * into v_o;
  v_id := v_o.numero::text;

  -- Tout ce qui est au carnet est déjà déposé : un ordre limite bloque avant d'être inscrit.
  if p_type = 'limite' then
    if p_cote = 'achat' then
      v_o.bloque := round(p_prix * p_quantite, 2);
      perform _mouvement(v_compte, 'XAFe', -v_o.bloque, v_o.bloque, 'ordre_bloque', 'ordres', v_id);
    else
      v_o.bloque := p_quantite;
      perform _mouvement(v_compte, 'USDT', -p_quantite, p_quantite, 'ordre_bloque', 'ordres', v_id);
    end if;
    update ordres set bloque = v_o.bloque where id = v_o.id;
  end if;

  -- Appariement prix-temps : le meilleur prix d'abord, puis le plus ancien.
  -- Le prix d'exécution est celui de l'ordre qui attendait.
  loop
    exit when v_o.restant <= 0;
    if p_cote = 'achat' then
      select * into v_c from ordres
       where paire = v_paire and cote = 'vente' and etat in ('ouvert', 'partiel') and (p_type = 'marche' or prix <= p_prix)
       order by prix asc, cree_le asc, numero asc for update limit 1;
    else
      select * into v_c from ordres
       where paire = v_paire and cote = 'achat' and etat in ('ouvert', 'partiel') and (p_type = 'marche' or prix >= p_prix)
       order by prix desc, cree_le asc, numero asc for update limit 1;
    end if;
    exit when not found;
    if v_c.compte_id = v_compte then v_auto := true; exit; end if;
    -- Un ordre au marché ne s'exécute pas au-delà de la bande d'exécution autour
    -- de la référence lue À SON ARRIVÉE : le reste est annulé, jamais servi à
    -- n'importe quel prix dans un carnet mince.
    exit when p_type = 'marche' and not _dans_la_bande_d_execution(p_cote, v_c.prix, v_ref);

    v_q := least(v_o.restant, v_c.restant);
    v_px := v_c.prix;
    -- Un acheteur au marché ne dépense que ce qu'il a.
    if p_type = 'marche' and p_cote = 'achat' then
      select disponible into v_dispo from soldes where compte_id = v_compte and actif = 'XAFe' for update;
      v_dispo := coalesce(v_dispo, 0);
      if v_dispo < round(v_q * v_px, 2) then v_q := trunc(v_dispo / v_px, 2); end if;
      exit when v_q <= 0;
    end if;

    -- Ce que paie l'acheteur. Un achat LIMITE a bloqué round(restant × limite) ;
    -- après cette tranche il doit garder exactement round(reste × limite), et
    -- tout le reste quand il n'en reste rien (v_cible). On ne soustrait jamais
    -- un arrondi de tranche d'un arrondi de total : la somme des arrondis n'est
    -- pas l'arrondi de la somme, et l'écart d'un centime finissait en bloqué
    -- négatif — « solde insuffisant » pour tout vendeur qui l'atteignait.
    --   · L'acheteur limite au repos est payé à SA limite : il donne ce que son
    --     bloqué dit (bloqué − cible), au centime près de round(q × prix).
    --   · L'acheteur limite qui prend paie round(q × prix du vendeur), jamais
    --     plus que ce que son bloqué peut donner, et récupère le reste.
    if p_cote = 'achat' and p_type = 'limite' then
      v_cible := case when v_o.restant - v_q = 0 then 0 else round((v_o.restant - v_q) * p_prix, 2) end;
      v_xafe := case when v_px = p_prix then v_o.bloque - v_cible
                     else least(round(v_q * v_px, 2), v_o.bloque - v_cible) end;
    elsif p_cote = 'vente' then
      v_cible := case when v_c.restant - v_q = 0 then 0 else round((v_c.restant - v_q) * v_c.prix, 2) end;
      v_xafe := v_c.bloque - v_cible;
    else
      v_xafe := round(v_q * v_px, 2);
    end if;

    if p_cote = 'achat' then
      v_achet := v_compte; v_vend := v_c.compte_id;
      v_fa := round(v_q * v_t_pren, 2);  v_fv := round(v_xafe * v_t_plac, 0);
    else
      v_achet := v_c.compte_id; v_vend := v_compte;
      v_fa := round(v_q * v_t_plac, 2);  v_fv := round(v_xafe * v_t_pren, 0);
    end if;

    -- L'acheteur paie v_xafe (de son bloqué s'il est limite, de son disponible au marché) et reçoit v_q moins ses frais.
    if (p_cote = 'achat' and p_type = 'limite') or p_cote = 'vente' then
      perform _mouvement(v_achet, 'XAFe', 0, -v_xafe, 'achat_regle', 'ordres', v_id);
    else
      perform _mouvement(v_achet, 'XAFe', -v_xafe, 0, 'achat_regle', 'ordres', v_id);
    end if;
    perform _mouvement(v_achet, 'USDT', v_q - v_fa, 0, 'achat_recu', 'ordres', v_id);
    -- Le vendeur donne v_q (de son bloqué s'il est limite) et reçoit v_xafe moins ses frais.
    if (p_cote = 'vente' and p_type = 'limite') or p_cote = 'achat' then
      perform _mouvement(v_vend, 'USDT', 0, -v_q, 'vente_reglee', 'ordres', v_id);
    else
      perform _mouvement(v_vend, 'USDT', -v_q, 0, 'vente_reglee', 'ordres', v_id);
    end if;
    perform _mouvement(v_vend, 'XAFe', v_xafe - v_fv, 0, 'vente_recue', 'ordres', v_id);
    v_frais_usdt := v_frais_usdt + v_fa;
    v_frais_xafe := v_frais_xafe + v_fv;

    -- L'acheteur limite qui prend : ce que son bloqué gardait au-delà de la cible et du prix payé lui revient.
    if p_cote = 'achat' and p_type = 'limite' then
      v_diff := v_o.bloque - v_cible - v_xafe;
      if v_diff > 0 then
        perform _mouvement(v_compte, 'XAFe', v_diff, -v_diff, 'ordre_libere', 'ordres', v_id);
      end if;
      v_o.bloque := v_cible;
    elsif p_type = 'limite' then
      v_o.bloque := v_o.bloque - v_q;
    end if;

    v_o.restant := v_o.restant - v_q;
    v_o.executee := v_o.executee + v_q;
    v_o.total_xafe := v_o.total_xafe + v_xafe;
    update ordres
       set restant = v_o.restant, executee = v_o.executee, total_xafe = v_o.total_xafe, bloque = v_o.bloque,
           etat = case when v_o.restant = 0 then 'execute' else 'partiel' end, maj_le = now()
     where id = v_o.id;
    update ordres
       set restant = restant - v_q, executee = executee + v_q, total_xafe = total_xafe + v_xafe,
           bloque = case when cote = 'achat' then v_cible else bloque - v_q end,
           etat = case when restant - v_q = 0 then 'execute' else 'partiel' end, maj_le = now()
     where id = v_c.id;
    if v_c.restant - v_q = 0 then
      perform _notifier(v_c.compte_id, 'Ordre exécuté',
        format('%s de %s USDT à %s.', case when v_c.cote = 'achat' then 'Achat' else 'Vente' end, v_c.quantite, v_px), '/marche/ordres/' || v_c.id);
    end if;

    insert into executions (paire, ordre_achat, ordre_vente, preneur, prix, quantite, montant_xafe, frais_acheteur, frais_vendeur)
    values (v_paire,
            case when p_cote = 'achat' then v_o.id else v_c.id end,
            case when p_cote = 'achat' then v_c.id else v_o.id end,
            p_cote, v_px, v_q, v_xafe, v_fa, v_fv)
    returning * into v_e;
    v_execs := v_execs || _execution_json(v_e);
  end loop;

  -- La maison en dernier : voir « l'ordre des verrous », au-dessus de _mouvement.
  if v_frais_usdt > 0 then perform _mouvement(compte_maison(), 'USDT', v_frais_usdt, 0, 'frais_achat', 'ordres', v_id); end if;
  if v_frais_xafe > 0 then perform _mouvement(compte_maison(), 'XAFe', v_frais_xafe, 0, 'frais_vente', 'ordres', v_id); end if;

  -- Ce qui reste d'un ordre marché, ou d'un ordre arrêté par l'auto-négociation, est annulé.
  if v_o.restant > 0 and (p_type = 'marche' or v_auto) then
    if p_type = 'limite' and v_o.bloque > 0 then
      if p_cote = 'achat' then
        perform _mouvement(v_compte, 'XAFe', v_o.bloque, -v_o.bloque, 'ordre_libere', 'ordres', v_id);
      else
        perform _mouvement(v_compte, 'USDT', v_o.bloque, -v_o.bloque, 'ordre_libere', 'ordres', v_id);
      end if;
    end if;
    update ordres
       set etat = case when v_o.executee > 0 then 'execute' else 'annule' end, restant = 0, bloque = 0, maj_le = now()
     where id = v_o.id;
  end if;

  select * into v_o from ordres where id = v_o.id;
  return jsonb_build_object('ordre', _ordre_json(v_o), 'executions', v_execs, 'auto_negociation', v_auto);
end $$;

-- Le parcours du carnet (le devis de l'achat rapide) suit la même bande : un
-- devis ne promet jamais ce que l'appariement refuserait.
create or replace function _parcourir_carnet(p_compte uuid, p_sens text, p_quantite numeric, p_budget numeric,
                                  out quantite numeric, out montant numeric)
language plpgsql stable set search_path = public as $$
declare
  v_paire text := parametre('marche') ->> 'paire';
  v_c ordres; v_q numeric; v_x numeric; v_cible numeric;
  v_ref numeric := _prix_reference();
begin
  quantite := 0; montant := 0;
  for v_c in
    select * from ordres
     where paire = v_paire and etat in ('ouvert', 'partiel')
       and cote = case when p_sens = 'achat' then 'vente' else 'achat' end
     order by case when p_sens = 'achat' then prix else -prix end, cree_le, numero
  loop
    exit when v_c.compte_id = p_compte;
    -- comme l'appariement d'un ordre au marché : pas au-delà de la bande d'exécution
    exit when not _dans_la_bande_d_execution(p_sens, v_c.prix, v_ref);
    if p_budget is not null then
      v_q := least(v_c.restant, trunc((p_budget - montant) / v_c.prix, 2));
    else
      v_q := least(v_c.restant, p_quantite - quantite);
    end if;
    exit when v_q <= 0;
    if p_sens = 'achat' then
      v_x := round(v_q * v_c.prix, 2);
    else
      v_cible := case when v_c.restant - v_q = 0 then 0 else round((v_c.restant - v_q) * v_c.prix, 2) end;
      v_x := v_c.bloque - v_cible;
    end if;
    quantite := quantite + v_q;
    montant := montant + v_x;
  end loop;
end $$;

-- ───────────────── ce que l'écran lit : les règles, et la référence ────────
create or replace function parametres_publics() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'frais', parametre('frais'),
    'marche', _marche() || jsonb_build_object('reference', _prix_reference()),
    'paliers', parametre('paliers'),
    'rapide', jsonb_build_object('marge', parametre('rapide') -> 'marge', 'ouvert', coalesce((parametre('rapide') ->> 'ouvert')::boolean, false),
                                 'validite_secondes', parametre('rapide') -> 'validite_secondes'),
    'crypto', jsonb_build_object('frais', parametre('crypto') -> 'frais',
                                 'retraits_ouverts', coalesce((parametre('crypto') ->> 'retraits_ouverts')::boolean, false),
                                 'depots_ouverts', coalesce((parametre('crypto') ->> 'depots_ouverts')::boolean, true)),
    'sortie', jsonb_build_object('ouvertes', coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true),
                                 'mode', coalesce(parametre('sortie') ->> 'mode', 'totem')),
    'operateurs', (select jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'plafond_par_transfert', plafond_par_transfert,
                                                       'plafond_jour', plafond_jour) order by id) from operateurs),
    'conditions', parametre('conditions'),
    'support', parametre('support'))
   where auth.uid() is not null
$$;

create or replace function cotation() returns jsonb
language sql stable security definer set search_path = public as $$
  with e as (select * from executions where cree_le > now() - interval '24 hours'),
       d as (select prix from executions order by cree_le desc, id desc limit 1),
       p as (select prix from executions where cree_le <= now() - interval '24 hours' order by cree_le desc, id desc limit 1)
  select jsonb_build_object(
    'paire', parametre('marche') ->> 'paire',
    'dernier', (select prix from d),
    'il_y_a_24h', (select prix from p),
    'haut', (select max(prix) from e), 'bas', (select min(prix) from e),
    'volume_usdt', (select coalesce(sum(quantite), 0) from e),
    'volume_xafe', (select coalesce(sum(montant_xafe), 0) from e),
    'meilleur_achat', (select max(prix) from ordres where etat in ('ouvert', 'partiel') and cote = 'achat'),
    'meilleure_vente', (select min(prix) from ordres where etat in ('ouvert', 'partiel') and cote = 'vente'),
    -- le prix autour duquel la bande se calcule : l'écran pré-remplit avec lui quand le carnet est vide
    'reference', _prix_reference())
$$;

create or replace function _verifier_parametre(p_cle text, v jsonb) returns void
language plpgsql set search_path = public, extensions, pg_temp as $$
declare k text; p jsonb; ok boolean;
begin
  if jsonb_typeof(v) <> 'object' then raise exception 'paramètre invalide' using detail = 'un objet JSON est attendu'; end if;
  ok := case p_cle
    when 'frais' then _nombre_entre(v -> 'placeur', 0, 0.05) and _nombre_entre(v -> 'preneur', 0, 0.05) and _nombre_entre(v -> 'sortie', 0, 0.05)
    when 'marche' then v ->> 'paire' = 'USDT/XAFe' and _nombre_entre(v -> 'pas_prix', 0.01, 100) and _nombre_entre(v -> 'quantite_min', 0.01, 1000000)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
                       -- les règles du marché (0017) : chacune facultative, chacune bornée
                       and (not (v ? 'quantite_max') or _nombre_entre(v -> 'quantite_max', (v ->> 'quantite_min')::numeric, 1e9))
                       and (not (v ? 'marche_quantite_max') or _nombre_entre(v -> 'marche_quantite_max', (v ->> 'quantite_min')::numeric, 1e9))
                       and (not (v ? 'ordres_ouverts_max') or _nombre_entre(v -> 'ordres_ouverts_max', 1, 10000, true))
                       and (not (v ? 'bande_execution') or _nombre_entre(v -> 'bande_execution', 0.001, 0.5))
                       and (not (v ? 'bande_achat') or (jsonb_typeof(v -> 'bande_achat') = 'array' and jsonb_array_length(v -> 'bande_achat') = 2
                            and _nombre_entre(v -> 'bande_achat' -> 0, 0.01, 1) and _nombre_entre(v -> 'bande_achat' -> 1, 1, 100)))
                       and (not (v ? 'bande_vente') or (jsonb_typeof(v -> 'bande_vente') = 'array' and jsonb_array_length(v -> 'bande_vente') = 2
                            and _nombre_entre(v -> 'bande_vente' -> 0, 0.01, 1) and _nombre_entre(v -> 'bande_vente' -> 1, 1, 100)))
                       and (not (v ? 'prix_reference') or jsonb_typeof(v -> 'prix_reference') = 'null' or _nombre_entre(v -> 'prix_reference', 0.01, 1e9))
    when 'depot' then _nombre_entre(v -> 'validite_minutes', 5, 1440, true) and _nombre_entre(v -> 'grace_minutes', 0, 10080, true)
                      and (not (v ? 'declaration_complete') or jsonb_typeof(v -> 'declaration_complete') = 'boolean')
    when 'sortie' then _nombre_entre(v -> 'reprises_max', 1, 10, true)
                       and (not (v ? 'ouvertes') or jsonb_typeof(v -> 'ouvertes') = 'boolean')
                       and (not (v ? 'mode') or v ->> 'mode' in ('totem', 'manuel'))
                       and (not (v ? 'seuil_deux_personnes') or jsonb_typeof(v -> 'seuil_deux_personnes') = 'null'
                            or _nombre_entre(v -> 'seuil_deux_personnes', 1, 1e12))
    when 'rapide' then _nombre_entre(v -> 'marge', 0, 0.2) and _nombre_entre(v -> 'validite_secondes', 5, 120, true)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
    when 'code_secret' then _nombre_entre(v -> 'essais', 1, 10, true) and _nombre_entre(v -> 'verrou_minutes', 1, 1440, true)
                       and _nombre_entre(v -> 'longueur_min', 4, 6, true) and _nombre_entre(v -> 'longueur_max', 4, 8, true)
                       and (v ->> 'longueur_min')::int <= (v ->> 'longueur_max')::int
    when 'crypto' then _nombre_entre(v -> 'frais' -> 'USDT', 0, 1000) and _nombre_entre(v -> 'frais' -> 'XAFe', 0, 1000000)
                       and _nombre_entre(v -> 'confirmations' -> 'bep20', 1, 1000, true) and _nombre_entre(v -> 'confirmations' -> 'trc20', 1, 1000, true)
                       and jsonb_typeof(v -> 'retraits_ouverts') = 'boolean'
                       and (not (v ? 'depots_ouverts') or jsonb_typeof(v -> 'depots_ouverts') = 'boolean')
    when 'paliers' then (select bool_and(x) from (values (v ? '0'), (v ? '1'), (v ? '2')) t(x))
    when 'conditions' then coalesce(v ->> 'version', '') ~ '^\d{4}-\d{2}-\d{2}$'
    when 'support' then coalesce(v ->> 'email', '') ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'
                        and (jsonb_typeof(v -> 'whatsapp') = 'null' or coalesce(v ->> 'whatsapp', '') ~ '^\+[1-9][0-9]{7,14}$')
    when 'parite' then (jsonb_typeof(v -> 'alerte_numero') = 'null' or coalesce(v ->> 'alerte_numero', '') ~ '^\+?[0-9 ]{9,16}$')
                       and coalesce(v ->> 'alerte_operateur', '') in ('mtn', 'om')
                       and _nombre_entre(v -> 'fraicheur_heures', 1, 720, true) and _nombre_entre(v -> 'delai_minutes', 5, 1440, true)
                       and jsonb_typeof(v -> 'publier_floats') = 'boolean'
    else false end;
  if p_cle = 'paliers' and ok then
    foreach k in array array['0', '1', '2'] loop
      p := v -> k;
      if jsonb_typeof(p) = 'null' then continue; end if;
      if not (jsonb_typeof(p) = 'object' and _nombre_entre(p -> 'entree_jour', 0, 1e12, true) and _nombre_entre(p -> 'sortie_jour', 0, 1e12, true)) then
        ok := false;
      end if;
    end loop;
  end if;
  if not coalesce(ok, false) then
    raise exception 'paramètre invalide' using detail = format('« %s » : une clé manque, ou une valeur sort de ses bornes', p_cle);
  end if;
end $$;

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on function _marche(), _prix_reference(), _dans_la_bande_d_execution(text, numeric, numeric) from public, anon, authenticated;
$sql$;
    raise notice '0017_regles_du_marche.sql : appliquée';
  end if;
end $consolide$;

-- ─── 0018_reseaux.sql (md5 d9e42057feb7f7d7f214114b67ffc43c) ───
-- déjà en place si : rejouable telle quelle
do $consolide$
begin
  if false then
    raise notice '0018_reseaux.sql : déjà en place, rien à faire';
  else
    execute $sql$
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0018 · le registre des réseaux                               ║
-- ║                                                                        ║
-- ║  Un client a UN solde de XAFe (et un d'USDT) ; le réseau ne se choisit ║
-- ║  qu'au moment de déposer ou de retirer — comme chez Binance. La        ║
-- ║  réserve vit sur un réseau MAISON (BSC) ; un retrait sur un autre      ║
-- ║  réseau y crée les XAFe et les détruit dans la réserve (0015), à la    ║
-- ║  façon du « burn and mint » de Circle (CCTP). La somme, tous réseaux   ║
-- ║  ensemble, est ce que la parité compare au registre (0016).            ║
-- ║                                                                        ║
-- ║  Ce qui manquait : la LISTE des réseaux. BEP20 et TRC20 étaient écrits ║
-- ║  en dur à douze endroits (contraintes, retrait, explorateur, parité,   ║
-- ║  tâches du veilleur). Ils vivent maintenant dans une table, avec ce    ║
-- ║  qu'il faut savoir de chacun : sa famille (EVM, Tron, Solana), son     ║
-- ║  explorateur, sa monnaie de frais, son compte de dérivation.           ║
-- ║                                                                        ║
-- ║  Ethereum, Base et Polygon y sont, FERMÉS : la famille EVM sait déjà   ║
-- ║  les lire ; il reste à y déployer le contrat XAFe, à poser leur nœud,  ║
-- ║  puis à les ouvrir. Solana y est aussi, fermé — et ne peut pas         ║
-- ║  s'ouvrir : aucun veilleur ne sait encore le lire.                     ║
-- ║  Le plan complet : docs/RESEAUX.md.                                     ║
-- ╚════════════════════════════════════════════════════════════════════════╝

create table if not exists reseaux (
  id                text primary key check (id ~ '^[a-z][a-z0-9]{1,11}$'),
  nom               text not null,                 -- « BNB Smart Chain »
  norme             text not null,                 -- ce que le client lit sur son wallet : « BEP20 »
  famille           text not null check (famille in ('evm', 'tron', 'solana')),
  chain_id          bigint,                        -- EVM : le numéro de la chaîne (56, 1, 8453…)
  -- Le compte de dérivation (m/44'/60'/<compte>'/0/i pour l'EVM) : deux réseaux
  -- d'une même famille n'ont JAMAIS les mêmes adresses de dépôt. Une adresse
  -- vit sur un réseau ; un envoi par erreur sur un autre réseau EVM arrive à
  -- une adresse que la graine contrôle encore, et se récupère à la main.
  compte_hd         int not null check (compte_hd between 0 and 1000),
  natif             text not null,                 -- la monnaie qui paie les frais : BNB, TRX, ETH…
  decimales_natif   int not null check (decimales_natif between 0 and 30),
  explorateur       text not null check (explorateur ~ '^https://'),
  explorateur_essai text check (explorateur_essai ~ '^https://'),
  -- ouvert aux clients : on y dépose, on y retire. Un réseau fermé garde son
  -- veilleur s'il est configuré : les retraits déjà demandés partent, et ce
  -- qui arrive encore sur une adresse attribuée est crédité.
  actif             boolean not null default false,
  ordre             int not null,
  note              text,
  unique (famille, compte_hd)
);
alter table reseaux enable row level security;

insert into reseaux (id, nom, norme, famille, chain_id, compte_hd, natif, decimales_natif, explorateur, explorateur_essai, actif, ordre, note) values
  ('bep20',   'BNB Smart Chain', 'BEP20',   'evm',    56,   0, 'BNB', 18, 'https://bscscan.com',     'https://testnet.bscscan.com', true,  1, 'le réseau maison : la réserve y vit'),
  ('trc20',   'Tron',            'TRC20',   'tron',   null, 0, 'TRX',  6, 'https://tronscan.org/#',  'https://nile.tronscan.org/#', true,  2, null),
  ('erc20',   'Ethereum',        'ERC20',   'evm',    1,    1, 'ETH', 18, 'https://etherscan.io',    'https://sepolia.etherscan.io', false, 3, 'frais de réseau élevés : à ouvrir pour les gros montants seulement'),
  ('base',    'Base',            'Base',    'evm',    8453, 2, 'ETH', 18, 'https://basescan.org',    'https://sepolia.basescan.org', false, 4, null),
  ('polygon', 'Polygon',         'Polygon', 'evm',    137,  3, 'POL', 18, 'https://polygonscan.com', 'https://amoy.polygonscan.com', false, 5, null),
  ('solana',  'Solana',          'SPL',     'solana', null, 0, 'SOL',  9, 'https://solscan.io',      null,                          false, 6, 'pas encore de veilleur : un adaptateur Solana est à écrire')
on conflict (id) do nothing;

-- ─────────────── les contraintes : la table, au lieu d'une liste ───────────
-- Une clé étrangère : un réseau inconnu du registre n'entre nulle part.
alter table adresses_crypto         drop constraint if exists adresses_crypto_reseau_check;
alter table adresses_libres         drop constraint if exists adresses_libres_reseau_check;
alter table retraits_crypto         drop constraint if exists retraits_crypto_reseau_check;
alter table reserve_chaine          drop constraint if exists reserve_chaine_reseau_check;
alter table chaine_mouvements_jeton drop constraint if exists chaine_mouvements_jeton_reseau_check;
do $$
declare t text;
begin
  foreach t in array array['adresses_crypto', 'adresses_libres', 'retraits_crypto', 'reserve_chaine', 'chaine_mouvements_jeton'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_reseau_fkey') then
      execute format('alter table %I add constraint %I foreign key (reseau) references reseaux (id)', t, t || '_reseau_fkey');
    end if;
  end loop;
end $$;

-- ───────────────────────────── ce qu'on en lit ─────────────────────────────
-- Configuré : le contrat XAFe et le nœud du réseau sont posés (paramètre
-- « chaine », par la mise en service). Lisible : un veilleur sait le lire.
create or replace function _reseau_configure(p_id text) returns boolean
language sql stable set search_path = public as $$
  select jsonb_typeof(parametre('chaine') -> p_id) = 'object'
     and coalesce(parametre('chaine') -> p_id ->> 'xafe', '') <> ''
$$;

create or replace function _reseau_lisible(p_famille text) returns boolean
language sql immutable set search_path = public as $$ select p_famille in ('evm', 'tron') $$;

-- Une adresse a la forme de sa FAMILLE : 0x + 40 hexadécimaux pour l'EVM, T +
-- 33 signes base58 pour Tron, 32 à 44 signes base58 pour Solana.
create or replace function _adresse_valide(p_famille text, p_adresse text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(case p_famille
    when 'evm'    then p_adresse ~ '^0x[0-9a-fA-F]{40}$'
    when 'tron'   then p_adresse ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'
    when 'solana' then p_adresse ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  end, false)
$$;

-- Le réseau d'un client : ouvert. (Ne s'ouvre que configuré et lisible :
-- admin_activer_reseau le vérifie.) Sinon : la phrase qu'il lira.
create or replace function _reseau_ouvert(p_id text) returns reseaux
language plpgsql stable set search_path = public as $$
declare r reseaux;
begin
  select * into r from reseaux where id = p_id;
  if not found then raise exception 'réseau inconnu'; end if;
  if not r.actif then
    raise exception 'réseau pas encore ouvert' using detail = format('%s (%s) n''est pas encore ouvert sur Glisil', r.nom, r.norme);
  end if;
  return r;
end $$;

create or replace function _explorateur(p_reseau text) returns text
language sql stable set search_path = public as $$
  select case when coalesce((parametre('chaine') ->> 'essai')::boolean, false) then coalesce(explorateur_essai, explorateur) else explorateur end
    from reseaux where id = p_reseau
$$;

-- ───────────────────────── l'adresse de dépôt ──────────────────────────────
create or replace function adresse_depot(p_actif text, p_reseau text) returns text
language plpgsql security definer set search_path = public as $$
declare v_compte uuid := auth.uid(); v_adresse text; v_libre adresses_libres;
begin
  perform _exiger_compte_actif(v_compte);
  -- fermé : aucune adresse ne se montre — pas même celle déjà attribuée, sur laquelle de vrais USDT n'arriveraient nulle part
  if not coalesce((parametre('crypto') ->> 'depots_ouverts')::boolean, true) then return null; end if;
  -- un réseau fermé ne montre pas d'adresse non plus : un envoi n'y serait pas attendu
  if not exists (select 1 from reseaux where id = p_reseau and actif) then return null; end if;
  perform 1 from comptes where id = v_compte for no key update;
  select adresse into v_adresse from adresses_crypto where compte_id = v_compte and actif = p_actif and reseau = p_reseau;
  if found then return v_adresse; end if;
  select * into v_libre from adresses_libres where actif = p_actif and reseau = p_reseau order by id for update skip locked limit 1;
  if not found then return null; end if;
  delete from adresses_libres where id = v_libre.id;
  insert into adresses_crypto (compte_id, actif, reseau, adresse, indice) values (v_compte, p_actif, p_reseau, v_libre.adresse, v_libre.indice)
  on conflict (compte_id, actif, reseau) do update set adresse = adresses_crypto.adresse
  returning adresse into v_adresse;
  return v_adresse;
end $$;

-- ───────────────────────────── le retrait ──────────────────────────────────
-- Le même retrait qu'en 0002 ; seul le contrôle du réseau change : le
-- registre au lieu d'une liste, la forme de l'adresse d'après sa famille.
create or replace function demander_retrait_crypto(p_actif text, p_reseau text, p_adresse text, p_montant numeric, p_cle text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_compte uuid := auth.uid();
  v        jsonb;
  v_r      retraits_crypto;
  v_res    reseaux;
  v_frais  numeric;
  v_palier jsonb;
  v_cours  numeric;
  v_xaf    numeric;
begin
  perform _exiger_compte_actif(v_compte);
  if p_cle is not null then
    select * into v_r from retraits_crypto where compte_id = v_compte and cle = p_cle;
    if found then return _retrait_json(v_r) || '{"deja": true}'; end if;
  end if;
  if not coalesce((parametre('crypto') ->> 'retraits_ouverts')::boolean, false) then
    raise exception 'retraits crypto pas encore ouverts' using detail = 'l''envoi sur la chaîne arrive bientôt ; vos fonds restent disponibles';
  end if;
  if p_actif not in ('XAFe', 'USDT') then raise exception 'actif inconnu'; end if;
  v_res := _reseau_ouvert(p_reseau);
  if not _adresse_valide(v_res.famille, p_adresse) then
    raise exception 'adresse invalide' using detail = format('ce n''est pas une adresse %s (%s)', v_res.norme, v_res.nom);
  end if;
  if p_montant is null or p_montant <= 0 or p_montant <> round(p_montant, case p_actif when 'USDT' then 2 else 0 end) then
    raise exception 'montant invalide';
  end if;
  v := _controler_code(v_compte, p_code);
  if not (v ->> 'ok')::boolean then return v; end if;
  v_frais := (parametre('crypto') -> 'frais' ->> p_actif)::numeric;

  perform 1 from comptes where id = v_compte for no key update;
  v_palier := parametre('paliers') -> (select palier::text from comptes where id = v_compte);
  if v_palier is not null and v_palier <> 'null'::jsonb then
    if p_actif = 'USDT' then
      v_cours := (select prix from executions order by cree_le desc, id desc limit 1);
      if v_cours is null then raise exception 'pas de cours de référence' using detail = 'le plafond du palier se compte en XAF'; end if;
      v_xaf := (p_montant + v_frais) * v_cours;
    else
      v_xaf := p_montant + v_frais;
    end if;
    if _sorties_du_jour(v_compte) + v_xaf > (v_palier ->> 'sortie_jour')::numeric then
      raise exception 'plafond du palier atteint' using detail = format('%s XAF par jour, retraits crypto compris', v_palier ->> 'sortie_jour');
    end if;
  end if;
  insert into retraits_crypto (reference, compte_id, actif, reseau, adresse, montant, frais, cle)
  values ('XAFe-CR-' || lpad(nextval('retraits_crypto_numero')::text, 6, '0'), v_compte, p_actif, p_reseau, p_adresse, p_montant, v_frais, p_cle)
  returning * into v_r;
  perform _mouvement(v_compte, p_actif, -(p_montant + v_frais), p_montant + v_frais, 'retrait_crypto_bloque', 'retraits_crypto', v_r.reference);
  return _retrait_json(v_r);
end $$;

-- ─────────────────── la liste que l'écran du client lit ────────────────────
create or replace function _reseaux_publics() returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'norme', norme, 'famille', famille, 'natif', natif,
                                               'explorateur', _explorateur(id), 'maison', id = _reseau_de_la_reserve(),
                                               'confirmations', coalesce((parametre('crypto') -> 'confirmations' ->> id)::int,
                                                                         (parametre('chaine') -> id ->> 'confirmations')::int))
                            order by ordre), '[]'::jsonb)
    from reseaux where actif
$$;

create or replace function parametres_publics() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'frais', parametre('frais'),
    'marche', _marche() || jsonb_build_object('reference', _prix_reference()),
    'paliers', parametre('paliers'),
    'rapide', jsonb_build_object('marge', parametre('rapide') -> 'marge', 'ouvert', coalesce((parametre('rapide') ->> 'ouvert')::boolean, false),
                                 'validite_secondes', parametre('rapide') -> 'validite_secondes'),
    'crypto', jsonb_build_object('frais', parametre('crypto') -> 'frais',
                                 'retraits_ouverts', coalesce((parametre('crypto') ->> 'retraits_ouverts')::boolean, false),
                                 'depots_ouverts', coalesce((parametre('crypto') ->> 'depots_ouverts')::boolean, true),
                                 -- les réseaux ouverts, dans l'ordre où l'écran les propose
                                 'reseaux', _reseaux_publics()),
    'sortie', jsonb_build_object('ouvertes', coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true),
                                 'mode', coalesce(parametre('sortie') ->> 'mode', 'totem')),
    'operateurs', (select jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'plafond_par_transfert', plafond_par_transfert,
                                                       'plafond_jour', plafond_jour) order by id) from operateurs),
    'conditions', parametre('conditions'),
    'support', parametre('support'))
   where auth.uid() is not null
$$;

-- ─────────────────────── ce que le veilleur reçoit ─────────────────────────
-- Les deux clés d'avant (bep20, trc20) restent, pour un veilleur pas encore
-- mis à jour ; « reseaux » porte chaque réseau configuré, avec sa famille et
-- son compte de dérivation.
create or replace function chaine_configuration() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := parametre('chaine'); v_essai boolean; v_secrets jsonb := '{}'::jsonb;
begin
  v_essai := coalesce((v ->> 'essai')::boolean, false);
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb) from vault.decrypted_secrets
                where name in ('veilleur_jeton', 'essai_graine', 'essai_admin_cle')$q$ into v_secrets;
  end if;
  return jsonb_build_object(
    'essai', v_essai,
    'bep20', v -> 'bep20',
    'trc20', v -> 'trc20',
    'reseaux', (select coalesce(jsonb_object_agg(r.id, (v -> r.id) || jsonb_build_object('famille', r.famille, 'compte_hd', r.compte_hd,
                                                                                          'natif', r.natif, 'decimales_natif', r.decimales_natif,
                                                                                          'chain_id', r.chain_id)), '{}'::jsonb)
                  from reseaux r where _reseau_configure(r.id) and _reseau_lisible(r.famille)),
    'jeton', v_secrets ->> 'veilleur_jeton',
    -- jamais hors d'un réseau d'essai : en production la graine n'est pas dans la base
    'graine', case when v_essai then v_secrets ->> 'essai_graine' end,
    'admin_cle_essai', case when v_essai then v_secrets ->> 'essai_admin_cle' end);
end $$;

-- ───────────── un réveil par réseau configuré, et rien de plus ─────────────
-- Les tâches de pg_cron suivent le registre : un réseau configuré qu'un
-- veilleur sait lire a sa tâche ; une tâche dont le réseau n'est plus là
-- s'en va. Rejouée quand le paramètre « chaine » change (le déclencheur plus
-- bas) : configurer Base suffit à le faire veiller.
create or replace function planifier_veilleurs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_voulus text[]; v_id text;
begin
  select coalesce(array_agg(id order by ordre), '{}') into v_voulus from reseaux where _reseau_configure(id) and _reseau_lisible(famille);
  if to_regnamespace('cron') is null then return jsonb_build_object('planifie', false, 'reseaux', to_jsonb(v_voulus)); end if;
  execute $q$select cron.unschedule(jobid) from cron.job where jobname like 'xafe-veilleur-%' and substr(jobname, 15) <> all($1)$q$ using v_voulus;
  foreach v_id in array v_voulus loop
    execute $q$select cron.schedule($1, '* * * * *', format('select public.reveiller_veilleur(%L)', $2))$q$ using 'xafe-veilleur-' || v_id, v_id;
  end loop;
  return jsonb_build_object('planifie', true, 'reseaux', to_jsonb(v_voulus));
end $$;

create or replace function _replanifier_veilleurs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform planifier_veilleurs();
  return null;
end $$;
drop trigger if exists parametres_chaine_replanifie on parametres;
create trigger parametres_chaine_replanifie after insert or update of valeur on parametres
  for each row when (new.cle = 'chaine') execute function _replanifier_veilleurs();

select planifier_veilleurs();

-- ──────────────────────── ce que l'équipe en voit ──────────────────────────
create or replace function admin_reseaux() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('voir');
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'nom', r.nom, 'norme', r.norme, 'famille', r.famille, 'chain_id', r.chain_id, 'natif', r.natif,
      'actif', r.actif, 'maison', r.id = _reseau_de_la_reserve(), 'configure', _reseau_configure(r.id),
      'lisible', _reseau_lisible(r.famille), 'explorateur', _explorateur(r.id), 'contrat', parametre('chaine') -> r.id ->> 'xafe',
      'note', r.note,
      'adresses_attribuees', (select count(*) from adresses_crypto a where a.reseau = r.id),
      'retraits_en_cours', (select count(*) from retraits_crypto x where x.reseau = r.id and x.etat in ('en_attente', 'en_cours'))) order by r.ordre), '[]'::jsonb)
    from reseaux r);
end $$;

-- Ouvrir ou fermer un réseau aux clients. Ouvrir exige qu'un veilleur sache
-- le lire ET que le contrat XAFe y soit posé : sinon le client verrait une
-- adresse sur laquelle rien n'arriverait. Fermer le réseau maison est refusé :
-- la réserve y vit.
create or replace function admin_activer_reseau(p_id text, p_actif boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r reseaux;
begin
  perform _exiger_droit('parametres');
  select * into r from reseaux where id = p_id for update;
  if not found then raise exception 'réseau inconnu'; end if;
  if p_actif is null then raise exception 'ouvrir ou fermer ?'; end if;
  if p_actif and not _reseau_lisible(r.famille) then
    raise exception 'réseau pas encore lisible' using detail = format('aucun veilleur ne sait encore lire %s : un adaptateur est à écrire (docs/RESEAUX.md)', r.nom);
  end if;
  if p_actif and not _reseau_configure(r.id) then
    raise exception 'réseau pas configuré' using detail = format('déployez d''abord le contrat XAFe sur %s et posez-le dans « chaine » (mise en service)', r.nom);
  end if;
  if not p_actif and r.id = _reseau_de_la_reserve() then
    raise exception 'le réseau maison ne se ferme pas' using detail = 'la réserve de XAFe y vit';
  end if;
  update reseaux set actif = p_actif where id = r.id;
  perform _journaliser(case when p_actif then 'ouvrir_reseau' else 'fermer_reseau' end, r.id);
  return jsonb_build_object('ok', true, 'id', r.id, 'actif', p_actif);
end $$;

-- ─────────────── la parité et les wallets : tous les réseaux ───────────────
create or replace function _parite_json(p_detail boolean) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'releve', (select to_jsonb(p) - 'detail' || jsonb_build_object('reseaux', p.detail -> 'reseaux',
                 'floats_detail', case when p_detail then p.detail -> 'floats'
                                when coalesce((parametre('parite') ->> 'publier_floats')::boolean, true)
                                then (select coalesce(jsonb_agg(jsonb_build_object('operateur', o, 'solde', s, 'annonce_le', d, 'connu', c)), '[]'::jsonb)
                                        from (select x ->> 'operateur' o, sum((x ->> 'solde')::numeric) s, min((x ->> 'annonce_le')::timestamptz) d, bool_and((x ->> 'connu')::boolean) c
                                                from jsonb_array_elements(p.detail -> 'floats') x group by 1) g) end)
                 from parite_releves p order by p.fait_le desc limit 1),
    'historique', (select coalesce(jsonb_agg(jsonb_build_object('fait_le', fait_le, 'statut', statut, 'registre', registre, 'chaine', chaine, 'ecart', ecart, 'floats', floats) order by fait_le), '[]'::jsonb)
                     from (select * from parite_releves where fait_le > now() - interval '7 days' and (extract(minute from fait_le)::int % 60) < 5 order by fait_le) h),
    -- chaque réseau où le contrat XAFe est posé : c'est leur SOMME qui se compare au registre
    'contrats', (select coalesce(jsonb_agg(jsonb_build_object('reseau', r.id, 'nom', r.nom, 'contrat', parametre('chaine') -> r.id ->> 'xafe', 'explorateur', _explorateur(r.id),
                                                       'maison', r.id = _reseau_de_la_reserve(),
                                                       'reserve', (select etat ->> 'chaud' from chaine_etats e where e.reseau = r.id)) order by r.ordre), '[]'::jsonb)
                   from reseaux r where _reseau_configure(r.id)),
    'essai', coalesce((parametre('chaine') ->> 'essai')::boolean, false),
    'lignes', (select coalesce(jsonb_agg(to_jsonb(l) - case when p_detail then '{}'::text[] else array['etat_registre', 'tx_attendu', 'adresse_vue'] end order by l.depuis desc), '[]'::jsonb)
                 from (select * from _parite_lignes() order by depuis desc limit case when p_detail then 500 else 100 end) l),
    'alertes', case when p_detail then (select coalesce(jsonb_agg(to_jsonb(a) order by a.ouverte_le desc), '[]'::jsonb)
                                          from parite_alertes a where a.close_le is null or a.close_le > now() - interval '7 days')
                    else (select count(*) from parite_alertes where close_le is null and gravite <> 'attention')::text::jsonb end)
$$;

create or replace function admin_wallets() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select jsonb_build_object(
    'reseaux', coalesce((select jsonb_agg(jsonb_build_object(
        'reseau', n.id, 'nom', n.nom, 'actif', n.actif,
        'etat', e.etat, 'maj_le', e.maj_le,
        'muet', e.maj_le is null or e.maj_le < now() - interval '2 minutes',
        'adresses_attribuees', (select count(*) from adresses_crypto a where a.reseau = n.id),
        'adresses_libres', (select count(*) from adresses_libres l where l.reseau = n.id),
        'retraits_en_cours', (select count(*) from retraits_crypto x where x.reseau = n.id and x.etat in ('en_attente', 'en_cours')),
        'retraits_remplaces', (select count(*) from retraits_crypto x where x.reseau = n.id and cardinality(x.tx_remplacees) > 0),
        'curseur', (select bloc from chaine_curseurs c where c.reseau = n.id)) order by n.ordre)
      -- les réseaux qui veillent ou que les clients voient ; les autres n'ont rien à montrer
      from reseaux n left join chaine_etats e on e.reseau = n.id
     where n.actif or _reseau_configure(n.id)), '[]'::jsonb),
    'orphelins', coalesce((select jsonb_agg(jsonb_build_object('reseau', o.reseau, 'actif', o.actif, 'adresse', o.adresse, 'montant', o.montant, 'preuve', o.preuve, 'raison', o.raison, 'vu_le', o.vu_le) order by o.vu_le desc)
                             from chaine_orphelins o), '[]'::jsonb),
    'du_usdt', (select coalesce(sum(disponible + bloque), 0) from soldes where actif = 'USDT' and compte_id <> compte_maison()),
    'maison_usdt', (select coalesce(sum(disponible + bloque), 0) from soldes where actif = 'USDT' and compte_id = compte_maison()))
    into r;
  return r;
end $$;

-- La réserve ne s'installe que sur un réseau du registre qu'un veilleur sait lire.
create or replace function _reseau_de_la_reserve() returns text
language sql stable set search_path = public as $$
  select coalesce((select id from reseaux where id = parametre('chaine') ->> 'reserve' and _reseau_lisible(famille)), 'bep20')
$$;

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on table reseaux from public, anon, authenticated;
grant all on table reseaux to service_role;
revoke all on function _reseau_configure(text), _reseau_lisible(text), _adresse_valide(text, text), _reseau_ouvert(text),
  _reseaux_publics(), planifier_veilleurs(), _replanifier_veilleurs(), admin_reseaux(), admin_activer_reseau(text, boolean)
  from public, anon, authenticated;
grant execute on function admin_reseaux(), admin_activer_reseau(text, boolean) to authenticated;
grant execute on function planifier_veilleurs() to service_role;
$sql$;
    raise notice '0018_reseaux.sql : appliquée';
  end if;
end $consolide$;
