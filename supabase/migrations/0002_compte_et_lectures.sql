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
  cree_le timestamptz not null default now()
);
alter table adresses_libres enable row level security;

create function adresse_depot(p_actif text, p_reseau text) returns text
language plpgsql security definer set search_path = public as $$
declare v_compte uuid := auth.uid(); v_adresse text; v_libre adresses_libres;
begin
  perform _exiger_compte_actif(v_compte);
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
           where compte_id = p_compte and cree_le >= date_trunc('day', now()) and etat not in ('annulee', 'echouee'))
       + (select coalesce(sum(case actif when 'XAFe' then montant + frais else (montant + frais) * coalesce(v_cours, 0) end), 0)
            from retraits_crypto
           where compte_id = p_compte and cree_le >= date_trunc('day', now()) and etat not in ('echoue', 'annule'));
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
    ) tout order by quand desc limit least(greatest(coalesce(p_n, 200), 1), 500)
  ) page
$$;

-- ─────────────────────────── temps réel ────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table soldes, depots, depot_declarations, sorties, ordres, notifications, numeros, retraits_crypto, transferts_crypto, comptes';
  end if;
end $$;

-- Les GRANT sont dans 0004_droits.sql.
