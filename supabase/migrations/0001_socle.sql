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

create function _declaration_json(x depot_declarations) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', x.id, 'transaction_id', x.transaction_id, 'etat', x.etat, 'montant', x.montant,
                            'numero_payeur', x.numero_payeur, 'motif', x.motif, 'declare_le', x.declare_le, 'credite_le', x.credite_le)
$$;

create function _depot_json(d depots) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'reference', d.reference, 'etat', d.etat, 'operateur', d.operateur,
    'montant_recu', d.montant_recu,
    'float_numero', (select numero from floats where id = d.float_id),
    'code_agent', (select code_agent from floats where id = d.float_id),
    'declarations', (select coalesce(jsonb_agg(_declaration_json(x) order by x.declare_le), '[]'::jsonb)
                       from depot_declarations x where x.depot_id = d.id),
    'cree_le', d.cree_le, 'expire_le', d.expire_le, 'credite_le', d.credite_le)
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
     where compte_id = v_d.compte_id and etat = 'credite' and credite_le >= date_trunc('day', now());
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
           where compte_id = p_compte and cree_le >= date_trunc('day', now()) and etat not in ('annulee', 'echouee'));
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
    insert into emissions (sens, montant, source_table, source_id) values ('destruction', v_envoi, 'commandes', p_id::text);
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

create function placer_ordre(p_cote text, p_type text, p_quantite numeric, p_prix numeric default null, p_cle text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_compte  uuid := auth.uid();
  v_frais   jsonb := parametre('frais');
  v_marche  jsonb := parametre('marche');
  v_paire   text := v_marche ->> 'paire';
  v_pas     numeric := (v_marche ->> 'pas_prix')::numeric;
  v_qmin    numeric := (v_marche ->> 'quantite_min')::numeric;
  v_t_pren  numeric := (v_frais ->> 'preneur')::numeric;
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

  -- Une paire s'apparie en file : un seul ordre entrant à la fois.
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
       order by prix asc, cree_le asc, numero asc for update skip locked limit 1;
    else
      select * into v_c from ordres
       where paire = v_paire and cote = 'achat' and etat in ('ouvert', 'partiel') and (p_type = 'marche' or prix >= p_prix)
       order by prix desc, cree_le asc, numero asc for update skip locked limit 1;
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
