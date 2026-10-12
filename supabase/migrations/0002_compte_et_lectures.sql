-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  XAFe Exchange · 0002 · le compte et ce que l'application lit         ║
-- ║  Profil et code secret, numéros vérifiés par SMS, retraits crypto,    ║
-- ║  chandelles, historique — tout ce que app/src/guichet/supabase.ts     ║
-- ║  appelle. Une règle d'argent vit ici, pas dans l'écran.               ║
-- ╚════════════════════════════════════════════════════════════════════════╝
create extension if not exists pgcrypto;

-- ───────────────────────────── le compte ───────────────────────────────────
alter table comptes
  add column entreprise            text,
  add column code_hash             text,                         -- le code secret des gestes d'argent, haché
  add column code_echecs           int not null default 0,
  add column code_verrou_jusqua    timestamptz,
  add column verification_en_cours text check (verification_en_cours in ('identite', 'entreprise')),
  add column verification_pieces   jsonb;

insert into parametres (cle, valeur) values
  ('code_secret', '{"essais": 3, "verrou_minutes": 15, "longueur_min": 4, "longueur_max": 6}'),
  ('crypto', '{"frais": {"USDT": 1, "XAFe": 500}, "confirmations": {"bep20": 15, "trc20": 20}}');

-- L'opérateur qu'un numéro camerounais laisse deviner, d'après son préfixe.
create function operateur_du_numero(p text) returns text language sql immutable as $$
  select case
    when left(normaliser_numero(p), 3)::int between 650 and 654 or left(normaliser_numero(p), 3)::int between 670 and 689 then 'mtn'
    when left(normaliser_numero(p), 3)::int between 655 and 659 or left(normaliser_numero(p), 3)::int between 690 and 699 then 'om'
  end
$$;

-- Un compte naît avec son utilisateur Supabase : le téléphone de connexion,
-- prouvé par l'OTP, est son premier numéro — actif tout de suite.
create function handle_nouvel_utilisateur() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_num text := normaliser_numero(new.phone);
begin
  insert into comptes (id, telephone) values (new.id, v_num) on conflict (id) do nothing;
  if length(v_num) = 9 and operateur_du_numero(v_num) is not null then
    insert into numeros (compte_id, operateur, numero, verifie_le, actif_des)
    values (new.id, operateur_du_numero(v_num), v_num, now(), now())
    on conflict do nothing;
  end if;
  return new;
end $$;

do $$
begin
  if to_regclass('auth.users') is not null then
    execute 'create trigger comptes_naissance after insert on auth.users for each row execute function public.handle_nouvel_utilisateur()';
  end if;
end $$;

create function _compte_json(c comptes) returns jsonb language sql stable as $$
  select jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'entreprise', c.entreprise, 'palier', c.palier,
                            'a_code', c.code_hash is not null, 'verrou_jusqua', c.code_verrou_jusqua,
                            'verification_en_cours', c.verification_en_cours)
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
  v_essais  int := (parametre('code_secret') ->> 'essais')::int;
  v_minutes int := (parametre('code_secret') ->> 'verrou_minutes')::int;
begin
  select * into v_c from comptes where id = p_compte for update;
  if not found then return jsonb_build_object('ok', false, 'erreur', 'non connecté'); end if;
  if v_c.code_verrou_jusqua is not null and v_c.code_verrou_jusqua > now() then
    return jsonb_build_object('ok', false, 'erreur', 'compte verrouillé', 'essais_restants', 0, 'verrou_jusqua', v_c.code_verrou_jusqua);
  end if;
  if v_c.code_hash is null or p_code is null or crypt(p_code, v_c.code_hash) <> v_c.code_hash then
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

create function completer_profil(p_nom text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c comptes; v_min int := (parametre('code_secret') ->> 'longueur_min')::int; v_max int := (parametre('code_secret') ->> 'longueur_max')::int;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  if length(trim(p_nom)) < 2 then raise exception 'nom manquant'; end if;
  if p_code !~ ('^[0-9]{' || v_min || ',' || v_max || '}$') then raise exception 'code secret invalide' using detail = format('%s à %s chiffres', v_min, v_max); end if;
  update comptes set nom = trim(p_nom), code_hash = crypt(p_code, gen_salt('bf', 10)), code_echecs = 0, code_verrou_jusqua = null
   where id = auth.uid() returning * into v_c;
  return _compte_json(v_c);
end $$;

create function changer_code_secret(p_ancien text, p_nouveau text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_min int := (parametre('code_secret') ->> 'longueur_min')::int; v_max int := (parametre('code_secret') ->> 'longueur_max')::int;
begin
  v := _controler_code(auth.uid(), p_ancien);
  if not (v ->> 'ok')::boolean then return v; end if;
  if p_nouveau !~ ('^[0-9]{' || v_min || ',' || v_max || '}$') then raise exception 'code secret invalide'; end if;
  update comptes set code_hash = crypt(p_nouveau, gen_salt('bf', 10)) where id = auth.uid();
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
alter table numeros
  add column code_hash      text,
  add column code_expire_le timestamptz,
  add column code_essais    int not null default 0;

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
  traite_le timestamptz
);
alter table messages_sortants enable row level security;

create function _numero_json(n numeros) returns jsonb language sql stable as $$
  select jsonb_build_object('id', n.id, 'operateur', n.operateur, 'numero', n.numero, 'verifie_le', n.verifie_le,
                            'actif_des', n.actif_des, 'retire_le', n.retire_le)
$$;

create function mes_numeros() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(_numero_json(n) order by n.verifie_le nulls last, n.id), '[]'::jsonb)
    from numeros n where n.compte_id = auth.uid() and n.retire_le is null
$$;

create function ajouter_numero(p_operateur text, p_numero text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_compte uuid := auth.uid();
  v_num    text := normaliser_numero(p_numero);
  v_n      numeros;
  v_code   text := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_float  floats;
begin
  if v_compte is null then raise exception 'non connecté'; end if;
  perform 1 from operateurs where id = p_operateur;
  if not found then raise exception 'opérateur inconnu'; end if;
  if v_num !~ '^6[0-9]{8}$' then raise exception 'numéro invalide'; end if;
  if exists (select 1 from numeros where operateur = p_operateur and numero = v_num and retire_le is null and compte_id = v_compte) then
    raise exception 'ce numéro est déjà sur votre compte';
  end if;
  if exists (select 1 from numeros where operateur = p_operateur and numero = v_num and retire_le is null) then
    raise exception 'ce numéro est déjà sur un autre compte';
  end if;
  insert into numeros (compte_id, operateur, numero, verifie_le, actif_des, code_hash, code_expire_le)
  values (v_compte, p_operateur, v_num, null, now() + interval '24 hours', crypt(v_code, gen_salt('bf', 6)), now() + interval '10 minutes')
  returning * into v_n;
  -- le SMS part du float de cet opérateur, par TOTEM
  select f.* into v_float from floats f left join terminaux t on t.id = f.terminal
   where f.operateur = p_operateur and f.actif order by t.vu_le desc nulls last, f.id limit 1;
  insert into messages_sortants (terminal, operateur, numero, texte, cle)
  values (v_float.terminal, p_operateur, v_num,
          format('XAFe Exchange : votre code est %s. Il vaut 10 minutes. Ne le partagez avec personne.', v_code),
          'num-' || v_n.id::text || '-' || extract(epoch from now())::bigint::text);
  return _numero_json(v_n);
end $$;

create function confirmer_numero(p_id uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n numeros;
begin
  select * into v_n from numeros where id = p_id and compte_id = auth.uid() and retire_le is null for update;
  if not found then raise exception 'numéro inconnu sur ce compte'; end if;
  if v_n.verifie_le is not null then return _numero_json(v_n); end if;
  if v_n.code_expire_le < now() or v_n.code_essais >= 5 then raise exception 'code SMS expiré' using detail = 'demandez un nouveau code'; end if;
  if v_n.code_hash is null or crypt(p_code, v_n.code_hash) <> v_n.code_hash then
    update numeros set code_essais = code_essais + 1 where id = p_id;
    raise exception 'code SMS incorrect';
  end if;
  update numeros set verifie_le = now(), actif_des = now() + interval '24 hours', code_hash = null, code_expire_le = null
   where id = p_id returning * into v_n;
  return _numero_json(v_n);
end $$;

create function retirer_numero(p_id uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_n numeros;
begin
  v := _controler_code(auth.uid(), p_code);
  if not (v ->> 'ok')::boolean then return v; end if;
  select * into v_n from numeros where id = p_id and compte_id = auth.uid() and retire_le is null for update;
  if not found then raise exception 'numéro inconnu sur ce compte'; end if;
  if (select count(*) from numeros where compte_id = auth.uid() and retire_le is null) <= 1 then
    raise exception 'le dernier numéro ne se retire pas';
  end if;
  update numeros set retire_le = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

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
revoke execute on function demander_sortie(numeric, uuid, text) from authenticated;

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
  cree_le timestamptz not null default now()
);
alter table adresses_libres enable row level security;

create function adresse_depot(p_actif text, p_reseau text) returns text
language plpgsql security definer set search_path = public as $$
declare v_compte uuid := auth.uid(); v_adresse text; v_libre adresses_libres;
begin
  if v_compte is null then raise exception 'non connecté'; end if;
  select adresse into v_adresse from adresses_crypto where compte_id = v_compte and actif = p_actif and reseau = p_reseau;
  if found then return v_adresse; end if;
  select * into v_libre from adresses_libres where actif = p_actif and reseau = p_reseau order by id for update skip locked limit 1;
  if not found then return null; end if;
  delete from adresses_libres where id = v_libre.id;
  insert into adresses_crypto (compte_id, actif, reseau, adresse) values (v_compte, p_actif, p_reseau, v_libre.adresse)
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
begin
  if v_compte is null then raise exception 'non connecté'; end if;
  if p_cle is not null then
    select * into v_r from retraits_crypto where compte_id = v_compte and cle = p_cle;
    if found then return _retrait_json(v_r) || '{"deja": true}'; end if;
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

-- ───────────────────────────── historique ──────────────────────────────────
create function mon_historique(p_n int default 200) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(ligne order by quand desc), '[]'::jsonb) from (
    select * from (
      select coalesce(d.credite_le, d.cree_le) quand, jsonb_build_object('nature', 'depot', 'detail', _depot_json(d)) ligne
        from depots d where d.compte_id = auth.uid() and d.etat not in ('annule', 'expire')
      union all
      select s.cree_le, jsonb_build_object('nature', 'sortie', 'detail', _sortie_json(s) || jsonb_build_object('transferts',
               (select coalesce(jsonb_agg(jsonb_build_object('etat', c.etat, 'montant_xafe', c.montant_xafe, 'montant_envoye', (c.parametres ->> 'montant')::numeric, 'reference_operateur', c.reference_operateur) order by c.id), '[]'::jsonb)
                  from commandes c where c.sortie_id = s.id)))
        from sorties s where s.compte_id = auth.uid()
      union all
      select o.cree_le, jsonb_build_object('nature', 'ordre', 'detail', _ordre_json(o))
        from ordres o where o.compte_id = auth.uid() and (o.executee > 0 or o.etat <> 'annule')
      union all
      select r.cree_le, jsonb_build_object('nature', 'retrait', 'detail', _retrait_json(r))
        from retraits_crypto r where r.compte_id = auth.uid()
      union all
      select t.cree_le, jsonb_build_object('nature', 'transfert', 'detail', jsonb_build_object('id', t.id, 'actif', t.actif, 'reseau', t.reseau, 'sens', t.sens, 'montant', t.montant, 'adresse', t.adresse, 'tx_hash', t.tx_hash, 'cree_le', t.cree_le))
        from transferts_crypto t where t.compte_id = auth.uid() and t.sens = 'entree'
    ) tout order by quand desc limit p_n
  ) page
$$;

-- ─────────────────────────── temps réel ────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table soldes, depots, depot_declarations, sorties, ordres, notifications, numeros, retraits_crypto, transferts_crypto, comptes';
  end if;
end $$;

-- ─────────────────────────────── droits ────────────────────────────────────
grant select on retraits_crypto, notifications to authenticated;
grant execute on function
  mon_compte(), completer_profil(text, text), verifier_code_secret(text), changer_code_secret(text, text), demander_verification(text, jsonb),
  mes_notifications(), marquer_notifications_lues(),
  mes_numeros(), ajouter_numero(text, text), confirmer_numero(uuid, text), retirer_numero(uuid, text),
  demander_sortie(numeric, uuid, text, text), ma_sortie(text),
  chandelles(int, int), mes_ordres(), mon_ordre(uuid),
  adresse_depot(text, text), demander_retrait_crypto(text, text, text, numeric, text, text), mon_retrait_crypto(text),
  mon_historique(int)
  to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
