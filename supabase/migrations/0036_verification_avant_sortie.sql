-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0036 · la vérification avant chaque sortie d'argent          ║
-- ║                                                                        ║
-- ║  Le code secret à 4 chiffres s'en va. Chaque sortie (retrait MoMo,     ║
-- ║  retrait crypto, fermeture du compte, retrait d'un numéro) demande     ║
-- ║  une « vérification » : un défi à usage unique, lié À CETTE opération  ║
-- ║  (l'empreinte de son montant et de sa destination) et à CETTE session, ║
-- ║  valable dix minutes, cinq essais. Elle se règle par trois facteurs,   ║
-- ║  dans cet ordre :                                                      ║
-- ║   1. un code TOTP FRAIS (moins de cinq minutes, prouvé après la        ║
-- ║      demande) — d'abord, pour qu'une session volée sans téléphone ne   ║
-- ║      serve ni à deviner le mot de passe ni à bloquer le compte ;       ║
-- ║   2. le MOT DE PASSE, contrôlé ici contre l'empreinte de GoTrue ;      ║
-- ║   3. le CODE reçu par e-mail, qui dit en clair le montant et la        ║
-- ║      destination : un autre montant demande un autre code.             ║
-- ║  Un échec ne lève jamais : il est compté, et le compte reste écrit.    ║
-- ║  Dix échecs dans l'heure bloquent les sorties une heure.               ║
-- ║                                                                        ║
-- ║  L'e-mail est décidé ici et part par une boîte d'envoi (pg_net réveille║
-- ║  la fonction « courriel », pg_cron rattrape chaque minute) ; la même   ║
-- ║  boîte sert aux autres chantiers (sortie payée, 2FA retirée…).         ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ───────────────────── 0 · ce qui doit exister chez Supabase ───────────────
-- Le mot de passe se contrôle contre auth.users.encrypted_password : si la
-- base ne peut pas le lire, on refuse de s'installer plutôt que d'ouvrir des
-- sorties qu'on ne saurait pas vérifier.
do $$ begin
  perform encrypted_password from auth.users limit 0;
exception when insufficient_privilege or undefined_column then
  raise exception 'vérification avant sortie : auth.users.encrypted_password illisible' using detail = 'le mot de passe ne peut pas être contrôlé côté serveur';
end $$;

-- ─────────────────────────────── 1 · le réglage ────────────────────────────
-- Il ne se change que par migration (pas d'entrée dans _verifier_parametre).
-- Le verrou du compte dure « fenetre_minutes » : la fenêtre est glissante.
insert into parametres (cle, valeur) values ('verification',
  '{"validite_minutes": 10, "essais_par_verification": 5, "echecs_max": 10, "fenetre_minutes": 60, "totp_fraicheur_secondes": 300, "renvoi_secondes": 60, "par_quart_heure": 5, "par_jour": 30}')
on conflict (cle) do nothing;

-- ─────────────────────────────── 2 · les tables ────────────────────────────
-- Aucune politique, aucun droit pour anon ni authenticated : seul le moteur les lit.
create table if not exists verifications (
  id                   uuid primary key default gen_random_uuid(),
  compte_id            uuid not null references comptes(id),
  operation            text not null check (operation in ('sortie_momo', 'retrait_crypto', 'fermer_compte', 'retirer_numero')),
  parametres           jsonb not null,            -- ce qui est LIÉ (canonique, fait par _parametres_de)
  parametres_empreinte text not null,             -- sha256(operation | parametres)
  affichage            jsonb not null,            -- ce que l'e-mail montre (frais, montant reçu, noms) — pas lié
  code_empreinte       text not null,             -- bcrypt du code e-mail, jamais le code
  session_id           uuid,                      -- la session qui l'a demandée
  cree_le              timestamptz not null default now(),
  expire_le            timestamptz not null,
  essais               int not null default 0,
  consommee_le         timestamptz,
  remplacee_le         timestamptz,               -- un code plus récent a été demandé pour le même genre d'opération
  operation_ref        text,                      -- XAFe-WD-…, XAFe-CR-…, l'id du numéro, « fermeture »
  courriel_id          bigint
);
create index if not exists verifications_du_compte on verifications (compte_id, cree_le desc);
create table if not exists verification_echecs (
  id              bigint generated always as identity primary key,
  compte_id       uuid not null references comptes(id),
  verification_id uuid references verifications(id),
  facteur         text not null check (facteur in ('mot_de_passe', 'code_email')),
  cree_le         timestamptz not null default now()
);
create index if not exists verification_echecs_du_compte on verification_echecs (compte_id, cree_le desc);

-- LA BOÎTE D'ENVOI, commune à tous les e-mails de Glisil. Pas de contrainte
-- sur le gabarit : un autre chantier en ajoute sans retoucher la table.
create table if not exists courriels_a_envoyer (
  id             bigint generated always as identity primary key,
  compte_id      uuid references comptes(id),    -- le destinataire est l'adresse d'Auth de ce compte, lue AU MOMENT d'envoyer
  destinataire   text,                           -- seulement hors des clients (un administrateur, le propriétaire)
  gabarit        text not null,
  donnees        jsonb not null,                 -- pour « verification » : l'affichage + {code, expire_le, cree_le, operation}
  cle            text unique,                    -- l'idempotence métier (« sortie_payee:XAFe-WD-000123 »)
  etat           text not null default 'en_attente' check (etat in ('en_attente', 'en_cours', 'envoye', 'echoue', 'abandonne')),
  essais         int not null default 0,
  pris_le        timestamptz,
  envoye_le      timestamptz,
  fournisseur_id text,
  erreur         text,
  expire_le      timestamptz,                    -- passé ce moment, ne jamais envoyer (les codes)
  cree_le        timestamptz not null default now(),
  check (compte_id is not null or destinataire is not null)
);
create index if not exists courriels_a_faire on courriels_a_envoyer (cree_le) where etat in ('en_attente', 'en_cours');
alter table sorties add column if not exists verification_id uuid unique references verifications(id);
alter table retraits_crypto add column if not exists verification_id uuid unique references verifications(id);
alter table verifications enable row level security;
alter table verification_echecs enable row level security;
alter table courriels_a_envoyer enable row level security;
revoke all on verifications, verification_echecs, courriels_a_envoyer from public, anon, authenticated;
grant all on verifications, verification_echecs, courriels_a_envoyer to service_role;

-- le journal de sécurité (0035) apprend un événement : une empreinte que la base ne sait pas lire
alter table journal_securite drop constraint if exists journal_securite_evenement_check;
alter table journal_securite add constraint journal_securite_evenement_check check (evenement in (
  'codes_generes', 'codes_confirmes', 'code_de_secours_utilise', 'code_de_secours_refuse', 'deux_facteurs_retires',
  'reinitialisation_demandee', 'reinitialisation_echouee', 'verification_mdp_indisponible'));

-- ─────────────────────────────── 3 · les outils ────────────────────────────
create or replace function _aal() returns text language sql stable set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', '')
$$;

-- Un TOTP prouvé APRÈS la demande (5 s de jeu d'horloge) et il y a moins de
-- « totp_fraicheur_secondes ». Seul le TOTP compte : une session portée en
-- aal2 par un code de secours de GoTrue (« mfa/recovery_code ») ne sort pas
-- d'argent tant que l'application n'est pas réenrôlée.
create or replace function _totp_frais(p_depuis timestamptz) returns boolean language sql stable set search_path = public as $$
  select _aal() = 'aal2' and exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) e
     where jsonb_typeof(e) = 'object' and e ->> 'method' in ('totp', 'mfa/totp')
       and (e ->> 'timestamp') ~ '^[0-9]+(\.[0-9]+)?$'
       and (e ->> 'timestamp')::numeric >= extract(epoch from greatest(p_depuis - interval '5 seconds',
                                                  now() - make_interval(secs => (parametre('verification') ->> 'totp_fraicheur_secondes')::int)))
       and (e ->> 'timestamp')::numeric <= extract(epoch from now()) + 5)
$$;

-- Le mot de passe contre l'empreinte de GoTrue (bcrypt « $2a$ », coût 10).
-- « a_choisir » : un compte Google sans mot de passe ; « indisponible » : une
-- empreinte d'un autre format (import argon2…), jamais comptée.
create or replace function _mot_de_passe_juste(p_compte uuid, p_mdp text) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_hash text;
begin
  select encrypted_password into v_hash from auth.users where id = p_compte;
  if coalesce(v_hash, '') = '' then return 'a_choisir'; end if;
  if left(v_hash, 4) <> '$2a$' then
    perform _journal_securite(p_compte, 'verification_mdp_indisponible', null, jsonb_build_object('format', left(v_hash, 3)));
    return 'indisponible';
  end if;
  if coalesce(p_mdp, '') = '' or octet_length(p_mdp) > 72 or extensions.crypt(p_mdp, v_hash) <> v_hash then return 'faux'; end if;
  return 'juste';
end $$;

-- Verrouillé jusqu'à… (null : libre). La fenêtre glisse : le verrou tombe de
-- lui-même, et rien ne se compte pendant qu'il tient (rien n'est évalué).
create or replace function _verrou_verification(p_compte uuid) returns timestamptz language sql stable set search_path = public as $$
  select cree_le + make_interval(mins => (parametre('verification') ->> 'fenetre_minutes')::int)
    from verification_echecs
   where compte_id = p_compte and cree_le > now() - make_interval(mins => (parametre('verification') ->> 'fenetre_minutes')::int)
   order by cree_le desc
  offset ((parametre('verification') ->> 'echecs_max')::int - 1) limit 1
$$;

create or replace function _email_masque(p text) returns text language sql immutable set search_path = public as $$
  select case when position('@' in coalesce(p, '')) > 1 then left(p, 1) || '•••@' || split_part(p, '@', 2) end
$$;

create or replace function _code_a_six_chiffres() returns text language sql volatile set search_path = public, extensions, pg_temp as $$
  select lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0')
$$;

-- LA seule entrée dans la boîte d'envoi (les autres chantiers aussi). Une clé
-- déjà connue rend la ligne existante : rejouer un geste n'envoie pas deux fois.
create or replace function _envoyer_courriel(p_compte uuid, p_gabarit text, p_donnees jsonb, p_cle text default null,
                                             p_expire_le timestamptz default null, p_destinataire text default null) returns bigint
language plpgsql set search_path = public as $$
declare v_id bigint;
begin
  insert into courriels_a_envoyer (compte_id, destinataire, gabarit, donnees, cle, expire_le)
  values (p_compte, p_destinataire, p_gabarit, coalesce(p_donnees, '{}'::jsonb), p_cle, p_expire_le)
  on conflict (cle) do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from courriels_a_envoyer where cle = p_cle; end if;
  return v_id;
end $$;

-- ───────────── 4 · ce qui est lié, et les mêmes refus que l'opération ──────
-- UN constructeur par opération, appelé par la demande ET par la
-- consommation : ils ne peuvent pas diverger. Il lève les refus de
-- l'opération elle-même — aucun code n'est envoyé pour une sortie qui serait
-- refusée.
create or replace function _exiger_fermeture_possible(p_compte uuid) returns void
language plpgsql set search_path = public as $$
declare v_reste text;
begin
  select string_agg(format('%s %s', to_char(disponible + bloque, 'FM999G999G999G990D00'), actif), ', ')
    into v_reste from soldes where compte_id = p_compte and disponible + bloque > 0;
  if v_reste is not null then
    raise exception 'il reste de l''argent sur le compte' using detail = format('sortez d''abord : %s', v_reste);
  end if;
  if exists (select 1 from ordres where compte_id = p_compte and etat in ('ouvert', 'partiel'))
     or exists (select 1 from depots where compte_id = p_compte and etat = 'en_attente')
     or exists (select 1 from depot_declarations where compte_id = p_compte and etat = 'attendu')
     or exists (select 1 from sorties where compte_id = p_compte and etat in ('en_attente', 'en_cours'))
     or exists (select 1 from retraits_crypto where compte_id = p_compte and etat in ('en_attente', 'en_cours')) then
    raise exception 'une opération est en cours' using detail = 'attendez qu''elle se termine, ou annulez-la';
  end if;
  -- un paiement reçu sur un de ses dossiers, retenu (palier, ID partagé) : il est à lui
  if exists (select 1 from entrees_retenues r join depots d on d.id = r.depot_id
              where d.compte_id = p_compte and r.etat = 'retenue') then
    raise exception 'un remboursement vous est dû' using detail = 'l''équipe doit d''abord vous rembourser';
  end if;
end $$;

create or replace function _parametres_de(p_compte uuid, p_operation text, p_p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_n       numeros;
  v_op      operateurs;
  v_demo    boolean;
  v_montant numeric;
  v_nom     text;
  v_taux    numeric;
  v_frais   numeric := 0;
  v_n_tr    int; v_part numeric; v_reste numeric; v_chunk numeric; v_f numeric; i int;
  v_palier  jsonb;
  v_res     reseaux;
  v_actif   text;
  v_adresse text;
  v_dispo   numeric;
begin
  if p_operation = 'sortie_momo' then
    v_montant := (p_p ->> 'montant')::numeric;
    select * into v_n from numeros where id = (p_p ->> 'numero_id')::uuid and compte_id = p_compte and retire_le is null;
    -- les gardes de la sortie (0030, 0034), dans le même ordre
    v_demo := numero_de_demo(v_n.numero);
    if coalesce(v_demo, false) and _depots_reels_ouverts(p_compte) then
      raise exception 'un numéro de démo ne reçoit que l''argent de test'
        using detail = 'vos XAFe sont de l''argent réel : retirez-les vers un vrai numéro';
    end if;
    if not coalesce(v_demo, false) and not _depots_reels_ouverts(p_compte) then
      raise exception 'l''argent de test ne sort pas en vrai'
        using detail = 'vos XAFe de la bêta se retirent vers un numéro de démo (600…)';
    end if;
    if not coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true) and not coalesce(v_demo, false) then
      raise exception 'sorties pas encore ouvertes' using detail = 'vos XAFe restent sur votre compte';
    end if;
    if v_montant is null or v_montant <= 0 or v_montant <> trunc(v_montant) then raise exception 'montant invalide'; end if;
    if _sortie_manuelle() then
      v_nom := nullif(regexp_replace(trim(coalesce(p_p ->> 'nom', '')), '\s+', ' ', 'g'), '');
      if v_nom is null or length(v_nom) < 2 or length(v_nom) > 80 then
        raise exception 'nom du bénéficiaire invalide' using detail = 'le nom exact du compte Mobile Money qui reçoit';
      end if;
    end if;
    if v_n.id is null then raise exception 'numéro inconnu sur ce compte'; end if;
    if v_n.verifie_le is null then raise exception 'numéro pas encore vérifié'; end if;
    if v_n.actif_des > now() then
      raise exception 'numéro pas encore actif' using detail = format('actif à partir du %s', v_n.actif_des);
    end if;
    select * into v_op from operateurs where id = v_n.operateur;
    v_palier := parametre('paliers') -> (select palier::text from comptes where id = p_compte);
    if v_palier is not null and v_palier <> 'null'::jsonb and _sorties_du_jour(p_compte) + v_montant > (v_palier ->> 'sortie_jour')::numeric then
      raise exception 'plafond du palier atteint' using detail = format('%s XAF par jour', v_palier ->> 'sortie_jour');
    end if;
    -- les frais, comptés comme l'opération les comptera (découpage par transfert compris, en mode TOTEM)
    v_taux := coalesce((parametre('frais') ->> 'sortie')::numeric, 0);
    v_n_tr := case when _sortie_manuelle() or v_op.plafond_par_transfert is null then 1
                   else greatest(1, ceil(v_montant / v_op.plafond_par_transfert))::int end;
    v_part := trunc(v_montant / v_n_tr); v_reste := v_montant - v_part * v_n_tr;
    for i in 1 .. v_n_tr loop
      v_chunk := v_part + (case when i = v_n_tr then v_reste else 0 end);
      v_f := ceil(v_chunk * v_taux);
      if v_chunk - v_f <= 0 then raise exception 'montant trop petit' using detail = 'après les frais, rien ne partirait'; end if;
      v_frais := v_frais + v_f;
    end loop;
    select disponible into v_dispo from soldes where compte_id = p_compte and actif = 'XAFe';
    if coalesce(v_dispo, 0) < v_montant then
      raise exception 'solde insuffisant' using detail = format('XAFe : %s disponible', coalesce(v_dispo, 0));
    end if;
    return jsonb_build_object(
      'parametres', jsonb_build_object('montant', trim_scale(v_montant), 'numero_id', v_n.id, 'operateur', v_n.operateur, 'numero', v_n.numero, 'nom', v_nom),
      'affichage', jsonb_build_object('montant', trim_scale(v_montant), 'frais', trim_scale(v_frais), 'recu', trim_scale(v_montant - v_frais),
                                      'operateur', v_n.operateur, 'operateur_nom', coalesce(v_op.nom, v_n.operateur), 'numero', v_n.numero, 'nom', v_nom));

  elsif p_operation = 'retrait_crypto' then
    v_actif := p_p ->> 'actif';
    v_adresse := trim(coalesce(p_p ->> 'adresse', ''));
    v_montant := (p_p ->> 'montant')::numeric;
    if not coalesce((parametre('crypto') ->> 'retraits_ouverts')::boolean, false) then
      raise exception 'retraits crypto pas encore ouverts' using detail = 'l''envoi sur la chaîne arrive bientôt ; vos fonds restent disponibles';
    end if;
    if v_actif is null or v_actif not in ('XAFe', 'USDT') then raise exception 'actif inconnu'; end if;
    v_res := _reseau_ouvert(p_p ->> 'reseau');
    if not _adresse_valide(v_res.famille, v_adresse) then
      raise exception 'adresse invalide' using detail = format('ce n''est pas une adresse %s (%s)', v_res.norme, v_res.nom);
    end if;
    if v_montant is null or v_montant <= 0 or v_montant <> round(v_montant, case v_actif when 'USDT' then 2 else 0 end) then
      raise exception 'montant invalide';
    end if;
    v_frais := coalesce((parametre('crypto') -> 'frais' ->> v_actif)::numeric, 0);
    select disponible into v_dispo from soldes where compte_id = p_compte and actif = v_actif;
    if coalesce(v_dispo, 0) < v_montant + v_frais then
      raise exception 'solde insuffisant' using detail = format('%s : %s disponible', v_actif, coalesce(v_dispo, 0));
    end if;
    return jsonb_build_object(
      'parametres', jsonb_build_object('actif', v_actif, 'reseau', v_res.id, 'adresse', v_adresse, 'montant', trim_scale(v_montant)),
      -- les frais ne sont PAS liés : l'opération prend ceux en vigueur quand elle s'exécute (comme avant)
      'affichage', jsonb_build_object('actif', v_actif, 'montant', trim_scale(v_montant), 'frais', trim_scale(v_frais), 'reseau', v_res.id,
                                      'reseau_nom', v_res.nom, 'norme', v_res.norme, 'adresse', v_adresse, 'explorateur', v_res.explorateur));

  elsif p_operation = 'fermer_compte' then
    perform _exiger_fermeture_possible(p_compte);
    return jsonb_build_object('parametres', '{}'::jsonb, 'affichage', '{}'::jsonb);

  elsif p_operation = 'retirer_numero' then
    select * into v_n from numeros where id = (p_p ->> 'numero_id')::uuid and compte_id = p_compte and retire_le is null;
    if v_n.id is null then raise exception 'numéro inconnu sur ce compte'; end if;
    if v_n.verifie_le is not null
       and (select count(*) from numeros where compte_id = p_compte and retire_le is null and verifie_le is not null) <= 1 then
      raise exception 'le dernier numéro ne se retire pas';
    end if;
    select * into v_op from operateurs where id = v_n.operateur;
    return jsonb_build_object(
      'parametres', jsonb_build_object('numero_id', v_n.id, 'operateur', v_n.operateur, 'numero', v_n.numero),
      'affichage', jsonb_build_object('operateur', v_n.operateur, 'operateur_nom', coalesce(v_op.nom, v_n.operateur), 'numero', v_n.numero));
  end if;
  raise exception 'opération inconnue';
end $$;

-- Le texte d'un jsonb est canonique (clés triées), et trim_scale fait 100 = 100.00.
create or replace function _empreinte(p_operation text, p_parametres jsonb) returns text
language sql immutable set search_path = public, extensions, pg_temp as $$
  select encode(extensions.digest(p_operation || '|' || p_parametres::text, 'sha256'), 'hex')
$$;

-- ───────────────────── 5 · demander une vérification ───────────────────────
-- Le code part par e-mail ; il n'est JAMAIS rendu ici.
create or replace function preparer_verification(p_operation text, p_parametres jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_compte  uuid := auth.uid();
  v_p       jsonb := parametre('verification');
  v_verrou  timestamptz;
  v         jsonb;
  v_code    text;
  v_v       verifications;
  v_courriel bigint;
begin
  perform _exiger_compte_actif(auth.uid());
  -- une demande à la fois par compte : les limites ci-dessous ne se courent pas
  perform 1 from comptes where id = v_compte for no key update;
  v_verrou := _verrou_verification(v_compte);
  if v_verrou is not null then
    raise exception 'vérifications verrouillées' using detail = v_verrou::text;
  end if;
  v := _parametres_de(v_compte, p_operation, coalesce(p_parametres, '{}'::jsonb));
  -- le même écran rouvert (retour arrière, rechargement) dans la minute : le code
  -- déjà parti vaut encore — on le rend, sans nouvel e-mail
  select * into v_v from verifications
   where compte_id = v_compte and operation = p_operation and parametres_empreinte = _empreinte(p_operation, v -> 'parametres')
     and session_id is not distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid
     and consommee_le is null and remplacee_le is null and expire_le > now()
     and cree_le > now() - make_interval(secs => (v_p ->> 'renvoi_secondes')::int)
     and not exists (select 1 from courriels_a_envoyer c where c.id = verifications.courriel_id and c.etat in ('echoue', 'abandonne'))
   order by cree_le desc limit 1;
  if found then
    return jsonb_build_object('id', v_v.id, 'operation', p_operation, 'expire_le', v_v.expire_le,
                              'renvoi_des', v_v.cree_le + make_interval(secs => (v_p ->> 'renvoi_secondes')::int),
                              'email_masque', _email_masque((select email from auth.users where id = v_compte)),
                              'affichage', v_v.affichage, 'meme_code', true);
  end if;
  -- une minute entre deux envois ; ne retient pas un autre code : celui qui a
  -- servi (il a fallu les trois preuves), celui qui est clos, ni celui dont
  -- l'e-mail n'a pas pu partir. Le plafond du quart d'heure, lui, compte tout.
  if exists (select 1 from verifications where compte_id = v_compte and consommee_le is null and remplacee_le is null
              and cree_le > now() - make_interval(secs => (v_p ->> 'renvoi_secondes')::int)
              and not exists (select 1 from courriels_a_envoyer c where c.id = verifications.courriel_id and c.etat in ('echoue', 'abandonne'))) then
    raise exception 'trop de codes demandés : attendez une minute';
  end if;
  if (select count(*) from verifications where compte_id = v_compte and cree_le > now() - interval '15 minutes') >= (v_p ->> 'par_quart_heure')::int
     or (select count(*) from verifications where compte_id = v_compte and cree_le > now() - interval '24 hours') >= (v_p ->> 'par_jour')::int then
    raise exception 'trop de vérifications demandées' using detail = format('%s par quart d''heure, %s par jour', v_p ->> 'par_quart_heure', v_p ->> 'par_jour');
  end if;
  -- le code d'avant, pour le même genre d'opération, ne vaut plus rien
  update verifications set remplacee_le = now()
   where compte_id = v_compte and operation = p_operation and consommee_le is null and remplacee_le is null and expire_le > now();
  v_code := _code_a_six_chiffres();
  insert into verifications (compte_id, operation, parametres, parametres_empreinte, affichage, code_empreinte, session_id, expire_le)
  values (v_compte, p_operation, v -> 'parametres', _empreinte(p_operation, v -> 'parametres'), v -> 'affichage',
          extensions.crypt(v_code, extensions.gen_salt('bf', 8)), nullif(auth.jwt() ->> 'session_id', '')::uuid,
          now() + make_interval(mins => (v_p ->> 'validite_minutes')::int))
  returning * into v_v;
  v_courriel := _envoyer_courriel(v_compte, 'verification',
    v_v.affichage || jsonb_build_object('operation', p_operation, 'code', v_code, 'cree_le', v_v.cree_le, 'expire_le', v_v.expire_le,
                                        'verification_id', v_v.id),
    'verification:' || v_v.id, v_v.expire_le);
  update verifications set courriel_id = v_courriel where id = v_v.id;
  return jsonb_build_object('id', v_v.id, 'operation', p_operation, 'expire_le', v_v.expire_le,
                            'renvoi_des', now() + make_interval(secs => (v_p ->> 'renvoi_secondes')::int),
                            'email_masque', _email_masque((select email from auth.users where id = v_compte)),
                            'affichage', v_v.affichage);
end $$;

-- L'écran demande où en est sa vérification : « e-mail parti », « n'a pas pu partir ».
create or replace function ma_verification(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_aal2();
  return (select jsonb_build_object('expire_le', v.expire_le,
                                    'essais_restants', greatest(0, (parametre('verification') ->> 'essais_par_verification')::int - v.essais),
                                    'consommee', v.consommee_le is not null, 'remplacee', v.remplacee_le is not null,
                                    'courriel', (select etat from courriels_a_envoyer where id = v.courriel_id))
            from verifications v where v.id = p_id and v.compte_id = auth.uid());
end $$;

-- ─────────────────────── 6 · consommer la vérification ─────────────────────
-- Ne lève JAMAIS sur un facteur faux : l'appelant rend le jsonb tel quel, et
-- l'échec reste écrit. Une réussite est annulée avec l'opération si celle-ci
-- lève ensuite : la vérification reste alors utilisable.
create or replace function _echec_verification(p_v verifications, p_facteur text) returns int
language plpgsql set search_path = public as $$
declare v_avant timestamptz := _verrou_verification(p_v.compte_id); v_apres timestamptz;
begin
  update verifications set essais = essais + 1 where id = p_v.id;
  insert into verification_echecs (compte_id, verification_id, facteur) values (p_v.compte_id, p_v.id, p_facteur);
  v_apres := _verrou_verification(p_v.compte_id);
  if v_avant is null and v_apres is not null then
    perform _envoyer_courriel(p_v.compte_id, 'verification_verrouillee', jsonb_build_object('verrou_jusqua', v_apres),
                              'verrou:' || p_v.compte_id || ':' || date_trunc('hour', now()));
  end if;
  return greatest(0, (parametre('verification') ->> 'essais_par_verification')::int - p_v.essais - 1);
end $$;

create or replace function _consommer_verification(p_compte uuid, p_operation text, p_parametres jsonb, p_verification uuid,
                                                   p_mot_de_passe text, p_code_email text) returns jsonb
language plpgsql set search_path = public, extensions, pg_temp as $$
declare v verifications; v_verrou timestamptz; m text; n int;
begin
  select * into v from verifications where id = p_verification for update;
  if v.id is null or v.compte_id <> p_compte
     or (v.session_id is not null and v.session_id is distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid) then
    return jsonb_build_object('ok', false, 'erreur', 'vérification inconnue');
  end if;
  v_verrou := _verrou_verification(p_compte);
  if v_verrou is not null then return jsonb_build_object('ok', false, 'erreur', 'vérifications verrouillées', 'verrou_jusqua', v_verrou); end if;
  if v.consommee_le is not null then return jsonb_build_object('ok', false, 'erreur', 'vérification déjà utilisée'); end if;
  if v.remplacee_le is not null then return jsonb_build_object('ok', false, 'erreur', 'vérification remplacée par un code plus récent'); end if;
  if v.expire_le <= now() then return jsonb_build_object('ok', false, 'erreur', 'vérification expirée'); end if;
  if v.essais >= (parametre('verification') ->> 'essais_par_verification')::int then
    return jsonb_build_object('ok', false, 'erreur', 'vérification épuisée');
  end if;
  -- un autre montant, une autre destination : jamais ce code (et ce n'est pas un essai)
  if v.operation <> p_operation or v.parametres_empreinte <> _empreinte(p_operation, p_parametres) then
    return jsonb_build_object('ok', false, 'erreur', 'la vérification ne correspond pas à cette opération');
  end if;
  -- le TOTP d'abord, non compté : sans le téléphone, ni oracle du mot de passe ni verrou à poser
  if not _totp_frais(v.cree_le) then
    return jsonb_build_object('ok', false, 'erreur', 'code de l''application d''authentification à saisir', 'facteur', 'totp');
  end if;
  m := _mot_de_passe_juste(p_compte, p_mot_de_passe);
  if m = 'a_choisir' then return jsonb_build_object('ok', false, 'erreur', 'mot de passe à choisir', 'facteur', 'mot_de_passe'); end if;
  if m = 'indisponible' then return jsonb_build_object('ok', false, 'erreur', 'vérification du mot de passe indisponible'); end if;
  if m = 'faux' then
    n := _echec_verification(v, 'mot_de_passe');
    return jsonb_build_object('ok', false, 'erreur', 'mot de passe incorrect', 'facteur', 'mot_de_passe', 'essais_restants', n);
  end if;
  if coalesce(p_code_email, '') !~ '^[0-9]{6}$' or extensions.crypt(p_code_email, v.code_empreinte) <> v.code_empreinte then
    n := _echec_verification(v, 'code_email');
    return jsonb_build_object('ok', false, 'erreur', 'code e-mail incorrect', 'facteur', 'code_email', 'essais_restants', n);
  end if;
  update verifications set consommee_le = now() where id = v.id;
  update courriels_a_envoyer set donnees = donnees - 'code' where id = v.courriel_id;
  return jsonb_build_object('ok', true, 'verification_id', v.id);
end $$;

-- ───────────────────────────── 7 · les quatre sorties ──────────────────────
-- Les anciennes signatures (au code secret) partent ; leurs corps, sans le
-- code, deviennent des fonctions internes (non ouvertes aux clients) que les
-- sorties vérifiées appellent — et que le harnais appelle directement.
drop function if exists demander_sortie(numeric, uuid, text, text, text);
drop function if exists demander_retrait_crypto(text, text, text, numeric, text, text);
drop function if exists fermer_mon_compte(text, text);
drop function if exists retirer_numero(uuid, text);

create or replace function _demander_sortie(p_montant numeric, p_numero_id uuid, p_cle text, p_nom text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_demo boolean;
begin
  perform _exiger_aal2();
  select numero_de_demo(n.numero) into v_demo
    from numeros n where n.id = p_numero_id and n.compte_id = auth.uid() and n.retire_le is null;
  if coalesce(v_demo, false) and _depots_reels_ouverts(auth.uid()) then
    raise exception 'un numéro de démo ne reçoit que l''argent de test'
      using detail = 'vos XAFe sont de l''argent réel : retirez-les vers un vrai numéro';
  end if;
  if not coalesce(v_demo, false) and not _depots_reels_ouverts(auth.uid()) then
    raise exception 'l''argent de test ne sort pas en vrai'
      using detail = 'vos XAFe de la bêta se retirent vers un numéro de démo (600…)';
  end if;
  if not coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true) and not coalesce(v_demo, false) then
    raise exception 'sorties pas encore ouvertes' using detail = 'vos XAFe restent sur votre compte';
  end if;
  if _sortie_manuelle() then return _demander_sortie_manuelle(p_montant, p_numero_id, p_cle, p_nom); end if;
  return demander_sortie(p_montant, p_numero_id, p_cle);
end $$;

-- Une réponse perdue, puis la même demande refaite : la sortie déjà faite est
-- rendue (la clé, avant la vérification). Le code demandé pour ce second essai
-- n'a rien prouvé et ne servira plus : il se clôt, sinon il retiendrait la
-- prochaine demande une minute (« attendez une minute »).
create or replace function _clore_verification_rejouee(p_compte uuid, p_operation text, p_id uuid) returns void
language sql security definer set search_path = public as $$
  update verifications set remplacee_le = now()
   where id = p_id and compte_id = p_compte and operation = p_operation and consommee_le is null and remplacee_le is null;
$$;

create or replace function demander_sortie(p_montant numeric, p_numero_id uuid, p_cle text, p_verification uuid,
                                           p_mot_de_passe text, p_code_email text, p_nom text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_compte uuid := auth.uid(); v_s sorties; v jsonb; c jsonb; r jsonb;
begin
  perform _exiger_compte_actif(auth.uid());
  -- AVANT la vérification : une réponse perdue puis rejouée rend la sortie faite, pas « vérification déjà utilisée »
  if p_cle is not null then
    select * into v_s from sorties where compte_id = v_compte and cle = p_cle;
    if found then perform _clore_verification_rejouee(v_compte, 'sortie_momo', p_verification); return _sortie_json(v_s) || '{"deja": true}'; end if;
  end if;
  v := _parametres_de(v_compte, 'sortie_momo', jsonb_build_object('montant', p_montant, 'numero_id', p_numero_id, 'nom', p_nom));
  c := _consommer_verification(v_compte, 'sortie_momo', v -> 'parametres', p_verification, p_mot_de_passe, p_code_email);
  if not (c ->> 'ok')::boolean then return c; end if;
  r := _demander_sortie(p_montant, p_numero_id, p_cle, p_nom);
  update sorties set verification_id = p_verification where reference = r ->> 'reference' and compte_id = v_compte;
  update verifications set operation_ref = r ->> 'reference' where id = p_verification;
  return r;
end $$;

create or replace function _demander_retrait_crypto(p_actif text, p_reseau text, p_adresse text, p_montant numeric, p_cle text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_compte uuid := auth.uid();
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

create or replace function demander_retrait_crypto(p_actif text, p_reseau text, p_adresse text, p_montant numeric, p_cle text,
                                                   p_verification uuid, p_mot_de_passe text, p_code_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_compte uuid := auth.uid(); v_r retraits_crypto; v jsonb; c jsonb; r jsonb;
begin
  perform _exiger_compte_actif(auth.uid());
  if p_cle is not null then
    select * into v_r from retraits_crypto where compte_id = v_compte and cle = p_cle;
    if found then perform _clore_verification_rejouee(v_compte, 'retrait_crypto', p_verification); return _retrait_json(v_r) || '{"deja": true}'; end if;
  end if;
  v := _parametres_de(v_compte, 'retrait_crypto', jsonb_build_object('actif', p_actif, 'reseau', p_reseau, 'adresse', p_adresse, 'montant', p_montant));
  c := _consommer_verification(v_compte, 'retrait_crypto', v -> 'parametres', p_verification, p_mot_de_passe, p_code_email);
  if not (c ->> 'ok')::boolean then return c; end if;
  -- l'adresse ENREGISTRÉE est celle qui a été liée (sans espaces autour)
  r := _demander_retrait_crypto(p_actif, p_reseau, v -> 'parametres' ->> 'adresse', p_montant, p_cle);
  update retraits_crypto set verification_id = p_verification where reference = r ->> 'reference' and compte_id = v_compte;
  update verifications set operation_ref = r ->> 'reference' where id = p_verification;
  return r;
end $$;

create or replace function _fermer_compte(p_compte uuid, p_motif text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c comptes;
begin
  if p_compte is null then raise exception 'non connecté'; end if;
  select * into v_c from comptes where id = p_compte and not maison for no key update;
  if not found then raise exception 'compte inconnu'; end if;
  if v_c.ferme_le is not null then raise exception 'compte déjà fermé'; end if;
  perform _exiger_fermeture_possible(v_c.id);
  update comptes set ferme_le = now(), desactive_le = coalesce(desactive_le, now()),
                     fermeture_motif = nullif(left(trim(coalesce(p_motif, '')), 500), '')
   where id = v_c.id returning * into v_c;
  return jsonb_build_object('ok', true, 'compte', _compte_json(v_c));
end $$;

create or replace function fermer_mon_compte(p_verification uuid, p_mot_de_passe text, p_code_email text, p_motif text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_compte uuid := auth.uid(); v_c comptes; c jsonb; r jsonb;
begin
  perform _exiger_aal2();
  if v_compte is null then raise exception 'non connecté'; end if;
  select * into v_c from comptes where id = v_compte and not maison for no key update;
  if not found then raise exception 'compte inconnu'; end if;
  if v_c.ferme_le is not null then raise exception 'compte déjà fermé'; end if;
  perform _exiger_fermeture_possible(v_compte);
  c := _consommer_verification(v_compte, 'fermer_compte', (_parametres_de(v_compte, 'fermer_compte', '{}'::jsonb)) -> 'parametres',
                               p_verification, p_mot_de_passe, p_code_email);
  if not (c ->> 'ok')::boolean then return c; end if;
  r := _fermer_compte(v_compte, p_motif);
  update verifications set operation_ref = 'fermeture' where id = p_verification;
  return r;
end $$;

create or replace function _retirer_numero(p_compte uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n numeros;
begin
  select * into v_n from numeros where id = p_id and compte_id = p_compte and retire_le is null for update;
  if not found then raise exception 'numéro inconnu sur ce compte'; end if;
  if v_n.verifie_le is not null
     and (select count(*) from numeros where compte_id = p_compte and retire_le is null and verifie_le is not null) <= 1 then
    raise exception 'le dernier numéro ne se retire pas';
  end if;
  update numeros set retire_le = now() where id = p_id;
  delete from numeros_codes where numero_id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function retirer_numero(p_id uuid, p_verification uuid, p_mot_de_passe text, p_code_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_compte uuid := auth.uid(); v jsonb; c jsonb; r jsonb;
begin
  perform _exiger_aal2();
  if v_compte is null then raise exception 'non connecté'; end if;
  -- le numéro verrouillé AVANT de lier : deux retraits ensemble ne retirent pas le dernier numéro
  perform 1 from numeros where compte_id = v_compte and retire_le is null for update;
  v := _parametres_de(v_compte, 'retirer_numero', jsonb_build_object('numero_id', p_id));
  c := _consommer_verification(v_compte, 'retirer_numero', v -> 'parametres', p_verification, p_mot_de_passe, p_code_email);
  if not (c ->> 'ok')::boolean then return c; end if;
  r := _retirer_numero(v_compte, p_id);
  update verifications set operation_ref = p_id::text where id = p_verification;
  return r;
end $$;

-- ───────────────────── le code secret à 4 chiffres s'en va ─────────────────
drop function if exists verifier_code_secret(text);
drop function if exists changer_code_secret(text, text);
drop function if exists completer_profil(text, text);
drop function if exists _controler_code(uuid, text);

create or replace function _compte_json(c comptes) returns jsonb
language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'entreprise', c.entreprise, 'palier', c.palier,
                            'email', c.email, 'prenom', c.prenom, 'nom_de_famille', c.nom_de_famille,
                            'date_naissance', c.date_naissance, 'ville', c.ville, 'pays', c.pays,
                            'verification_en_cours', c.verification_en_cours,
                            'conditions_version', c.conditions_version, 'conditions_acceptees_le', c.conditions_acceptees_le,
                            'conditions_a_jour', c.maison or c.conditions_version is not distinct from (parametre('conditions') ->> 'version'),
                            'ferme_le', c.ferme_le, 'desactive', c.desactive_le is not null,
                            -- ce qui est déjà entré aujourd'hui : l'écran montre ce qui RESTE du plafond, pas le plafond
                            'entre_du_jour', (select coalesce(sum(montant), 0) from depot_declarations
                                               where compte_id = c.id and etat = 'credite' and credite_le >= debut_du_jour()))
$$;
drop table if exists codes_secrets;
delete from parametres where cle = 'code_secret';

-- ───────────────────── 8 · le facteur des e-mails (clé de service) ─────────
-- La fonction « courriel » ne lit la boîte que par ces trois fonctions.
create or replace function courriels_a_traiter(p_n int default 20) returns setof bigint
language sql stable set search_path = public as $$
  select id from courriels_a_envoyer
   where (etat = 'en_attente' or (etat = 'en_cours' and pris_le < now() - interval '2 minutes'))
     and essais < 5 and (expire_le is null or expire_le > now())
   order by id limit least(greatest(coalesce(p_n, 20), 1), 50)
$$;

-- Prendre une ligne : l'adresse vient d'Auth AU MOMENT d'envoyer, jamais d'une requête.
create or replace function courriel_prendre(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c courriels_a_envoyer; v_email text; v_v verifications;
begin
  select * into c from courriels_a_envoyer where id = p_id for update skip locked;
  if c.id is null then return null; end if;
  if c.etat not in ('en_attente', 'en_cours') or c.essais >= 5 or (c.etat = 'en_cours' and c.pris_le >= now() - interval '2 minutes') then
    return null;
  end if;
  if c.expire_le is not null and c.expire_le <= now() then
    update courriels_a_envoyer set etat = 'abandonne', donnees = donnees - 'code' where id = c.id;
    return null;
  end if;
  if c.gabarit = 'verification' then
    select * into v_v from verifications where id = (c.donnees ->> 'verification_id')::uuid;
    if v_v.id is null or v_v.consommee_le is not null or v_v.remplacee_le is not null or v_v.expire_le <= now() then
      update courriels_a_envoyer set etat = 'abandonne', donnees = donnees - 'code' where id = c.id;
      return null;
    end if;
  end if;
  v_email := coalesce(c.destinataire, (select email from auth.users where id = c.compte_id), (select email from comptes where id = c.compte_id));
  if coalesce(v_email, '') = '' then
    update courriels_a_envoyer set etat = 'echoue', erreur = 'pas d''adresse', donnees = donnees - 'code' where id = c.id;
    return null;
  end if;
  update courriels_a_envoyer set etat = 'en_cours', pris_le = now(), essais = essais + 1 where id = c.id;
  return jsonb_build_object('id', c.id, 'gabarit', c.gabarit, 'donnees', c.donnees, 'email', v_email,
                            'idempotence', 'glisil-courriel-' || c.id);
end $$;

create or replace function courriel_resultat(p_id bigint, p_ok boolean, p_fournisseur_id text default null,
                                             p_erreur text default null, p_definitif boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_ok then
    update courriels_a_envoyer set etat = 'envoye', envoye_le = now(), fournisseur_id = left(p_fournisseur_id, 200), erreur = null,
                                   donnees = donnees - 'code'
     where id = p_id and etat = 'en_cours';
  else
    update courriels_a_envoyer
       set etat = case when p_definitif or essais >= 5 then 'echoue' else 'en_attente' end,
           erreur = left(coalesce(p_erreur, 'échec'), 300),
           donnees = case when p_definitif or essais >= 5 then donnees - 'code' else donnees end
     where id = p_id and etat = 'en_cours';
  end if;
end $$;

-- Réveiller la fonction (copie de reveiller_veilleur, 0006) : rien si le coffre, pg_net ou un secret manque.
create or replace function _reveiller_courriel(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_jeton text;
begin
  if to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then return; end if;
  execute $q$select (select decrypted_secret from vault.decrypted_secrets where name = 'courriel_url'),
                    (select decrypted_secret from vault.decrypted_secrets where name = 'courriel_jeton')$q$ into v_url, v_jeton;
  if v_url is null or v_jeton is null then return; end if;
  execute $q$select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 5000)$q$
    using v_url, jsonb_build_object('content-type', 'application/json', 'x-courriel-jeton', v_jeton),
          case when p_id is null then '{}'::jsonb else jsonb_build_object('id', p_id) end;
end $$;

-- pg_net met la requête en file au COMMIT : une transaction annulée n'envoie rien.
create or replace function _courriel_insere() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _reveiller_courriel(new.id);
  return new;
end $$;
drop trigger if exists courriels_reveil on courriels_a_envoyer;
create trigger courriels_reveil after insert on courriels_a_envoyer for each row execute function _courriel_insere();

-- Chaque minute : les codes expirés s'effacent, et ce qui attend est réveillé.
create or replace function _vider_courriels() returns void
language plpgsql security definer set search_path = public as $$
begin
  update courriels_a_envoyer
     set donnees = donnees - 'code', etat = case when etat in ('en_attente', 'en_cours') then 'abandonne' else etat end
   where donnees ? 'code' and expire_le < now();
  if exists (select 1 from courriels_a_traiter(1)) then perform _reveiller_courriel(null); end if;
end $$;

do $$
begin
  if to_regnamespace('cron') is null or to_regnamespace('net') is null then
    raise notice 'pg_cron ou pg_net absent : les e-mails ne partiront qu''au réveil par la fonction (activez les deux extensions)';
    return;
  end if;
  execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'glisil-courriels'$q$;
  execute $q$select cron.schedule('glisil-courriels', '* * * * *', 'select public._vider_courriels()')$q$;
end $$;

-- ─────────────────────────────── 9 · le support ────────────────────────────
create or replace function admin_verifications(p_compte uuid, p_n int default 20) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('clients');
  return jsonb_build_object(
    'verrou_jusqua', _verrou_verification(p_compte),
    'verifications', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'operation', v.operation, 'affichage', v.affichage, 'cree_le', v.cree_le,
                                                                   'essais', v.essais, 'consommee_le', v.consommee_le, 'remplacee_le', v.remplacee_le,
                                                                   'expiree', v.consommee_le is null and v.expire_le <= now(),
                                                                   'operation_ref', v.operation_ref,
                                                                   'courriel', (select etat from courriels_a_envoyer where id = v.courriel_id))
                                                order by v.cree_le desc), '[]'::jsonb)
                        from (select * from verifications where compte_id = p_compte order by cree_le desc
                               limit least(greatest(coalesce(p_n, 20), 1), 100)) v));
end $$;

create or replace function admin_lever_verrou_verification(p_compte uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform _exiger_droit('clients');
  if length(trim(coalesce(p_note, ''))) < 5 then raise exception 'note trop courte' using detail = 'dites pourquoi le blocage est levé'; end if;
  perform 1 from comptes where id = p_compte for no key update;
  if not found then raise exception 'compte inconnu'; end if;
  delete from verification_echecs
   where compte_id = p_compte and cree_le > now() - make_interval(mins => (parametre('verification') ->> 'fenetre_minutes')::int);
  get diagnostics n = row_count;
  perform _journaliser('lever_verrou_verification', p_compte::text, jsonb_build_object('note', trim(p_note), 'echecs', n));
  return jsonb_build_object('ok', true, 'echecs_effaces', n);
end $$;

-- ─────────────────────────────── 10 · les droits ───────────────────────────
revoke all on function _clore_verification_rejouee(uuid, text, uuid), _aal(), _totp_frais(timestamptz), _mot_de_passe_juste(uuid, text), _verrou_verification(uuid), _email_masque(text),
  _code_a_six_chiffres(), _envoyer_courriel(uuid, text, jsonb, text, timestamptz, text), _exiger_fermeture_possible(uuid),
  _parametres_de(uuid, text, jsonb), _empreinte(text, jsonb), preparer_verification(text, jsonb), ma_verification(uuid),
  _echec_verification(verifications, text), _consommer_verification(uuid, text, jsonb, uuid, text, text),
  _demander_sortie(numeric, uuid, text, text), demander_sortie(numeric, uuid, text, uuid, text, text, text),
  _demander_retrait_crypto(text, text, text, numeric, text), demander_retrait_crypto(text, text, text, numeric, text, uuid, text, text),
  _fermer_compte(uuid, text), fermer_mon_compte(uuid, text, text, text), _retirer_numero(uuid, uuid), retirer_numero(uuid, uuid, text, text),
  _compte_json(comptes), courriels_a_traiter(int), courriel_prendre(bigint), courriel_resultat(bigint, boolean, text, text, boolean),
  _reveiller_courriel(bigint), _courriel_insere(), _vider_courriels(), admin_verifications(uuid, int), admin_lever_verrou_verification(uuid, text)
  from public, anon, authenticated;
grant execute on function preparer_verification(text, jsonb), ma_verification(uuid),
  demander_sortie(numeric, uuid, text, uuid, text, text, text), demander_retrait_crypto(text, text, text, numeric, text, uuid, text, text),
  fermer_mon_compte(uuid, text, text, text), retirer_numero(uuid, uuid, text, text),
  admin_verifications(uuid, int), admin_lever_verrou_verification(uuid, text) to authenticated;
grant execute on function courriels_a_traiter(int), courriel_prendre(bigint), courriel_resultat(bigint, boolean, text, text, boolean),
  _envoyer_courriel(uuid, text, jsonb, text, timestamptz, text), _vider_courriels() to service_role;
