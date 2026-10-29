-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0035 · la connexion : mot de passe, deux facteurs, secours   ║
-- ║                                                                        ║
-- ║  1. Une session « forte » : GoTrue l'a portée au niveau aal2 (code de  ║
-- ║     l'application d'authentification vérifié) ET elle a commencé par   ║
-- ║     le mot de passe ou Google. Un simple code e-mail suivi du TOTP     ║
-- ║     n'est jamais fort : signInWithOtp reste appelable avec la clé      ║
-- ║     publique, et sans cette règle il remplaçait le mot de passe.       ║
-- ║  2. Toute fonction ouverte aux clients commence par l'exiger           ║
-- ║     (_exiger_aal2, directement ou par _exiger_droit /                  ║
-- ║     _exiger_compte_actif) ; les tables lisibles par un client ont une  ║
-- ║     politique RESTRICTIVE ; le crochet de PostgREST la redemande à     ║
-- ║     chaque requête. Le scénario 11.54 appelle CHAQUE fonction ouverte  ║
-- ║     aux clients en session faible et exige le refus.                   ║
-- ║  3. Dix codes de secours par personne, gardés en empreintes : un code  ║
-- ║     rend l'accès quand le téléphone est perdu. La décision est ici, en ║
-- ║     SQL (code juste, cinq essais puis quinze minutes, journal) ; la    ║
-- ║     fonction deux-facteurs ne fait qu'exécuter (retirer le facteur).   ║
-- ║  4. Ouvrir son compte demande la session forte, un mot de passe posé   ║
-- ║     et des codes de secours notés. Le téléphone reste obligatoire,     ║
-- ║     unique parmi les comptes ouverts, non vérifié ; celui d'un compte  ║
-- ║     fermé se réutilise.                                                ║
-- ║  5. Le code secret à 4 chiffres perd ses droits (0036 le retire).      ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────── 1 · la garde ──────────────────────────────────
-- « Forte » : aal2 ET un premier facteur mot de passe ou Google. Sans jeton
-- du tout, c'est la base elle-même (pg_cron, migrations, le harnais en
-- postgres) ; une requête PostgREST (session_user = authenticator) porte
-- TOUJOURS des claims : sans elles, elle est refusée.
create or replace function session_forte() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := auth.jwt();
begin
  if v is null then return session_user <> 'authenticator'; end if;
  if v ->> 'role' = 'service_role' then return true; end if;
  if v ->> 'role' is distinct from 'authenticated' then return false; end if;
  return v ->> 'aal' = 'aal2'
     and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v -> 'amr') = 'array' then v -> 'amr' else '[]'::jsonb end) e
                  where jsonb_typeof(e) = 'object' and e ->> 'method' in ('password', 'oauth'));
end $$;

create or replace function _exiger_aal2() returns void language plpgsql stable set search_path = public as $$
begin
  if not session_forte() then
    raise exception 'double authentification requise' using detail = 'entrez le code de votre application d''authentification';
  end if;
end $$;

-- L'instant où un facteur a été prouvé dans CETTE session (amr de GoTrue :
-- [{method, timestamp}], en secondes), ou null. « totp » couvre aussi
-- « mfa/totp », le nom que certaines versions de GoTrue donnent au même
-- facteur. Sert à exiger un TOTP FRAIS (régénérer les codes de secours ; la
-- vérification avant sortie, 0036).
create or replace function _moment_du_facteur(p_methode text) returns timestamptz
language sql stable set search_path = public as $$
  select to_timestamp(max((e ->> 'timestamp')::numeric))
    from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) e
   where jsonb_typeof(e) = 'object' and (e ->> 'timestamp') ~ '^[0-9]+(\.[0-9]+)?$'
     and (e ->> 'method' = p_methode or (p_methode = 'totp' and e ->> 'method' = 'mfa/totp'))
$$;

-- Un mot de passe est posé (un compte Google ne l'a pas tant qu'il ne l'a pas choisi).
create or replace function _mot_de_passe_pose(p_utilisateur uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(encrypted_password, '') <> '' from auth.users where id = p_utilisateur), false)
$$;

-- ─────────────────────────── 2 · les portes ────────────────────────────────
-- Les deux portes par lesquelles passent toutes les fonctions de l'équipe et
-- onze fonctions des clients : la garde y entre en premier.
create or replace function _exiger_droit(p_droit text) returns void
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  perform _exiger_aal2();
  if not admin_a_droit(p_droit) then raise exception 'accès non autorisé' using detail = p_droit; end if;
end $$;

create or replace function _exiger_compte_actif(p_compte uuid) returns void
language plpgsql set search_path = public, extensions, pg_temp as $$
declare v_c comptes;
begin
  perform _exiger_aal2();
  if p_compte is null then raise exception 'non connecté'; end if;
  select * into v_c from comptes where id = p_compte;
  if v_c.ferme_le is not null then
    raise exception 'compte fermé' using detail = 'contactez le support Glisil pour le rouvrir';
  end if;
  if v_c.desactive_le is not null then
    raise exception 'compte désactivé' using detail = 'contactez le support Glisil';
  end if;
end $$;

-- Reste en SQL (les politiques du stockage l'appellent) : faux en session faible.
create or replace function admin_a_droit(p_droit text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.session_forte()
     and exists (select 1 from administrateurs a where a.id = auth.uid() and a.actif and p_droit = any (droits_du_role(a.role)))
$$;

create or replace function mon_profil_admin() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_aal2();
  return (select jsonb_build_object('id', a.id, 'email', a.email, 'nom', a.nom, 'role', a.role, 'actif', a.actif, 'droits', to_jsonb(droits_du_role(a.role)))
            from administrateurs a where a.id = auth.uid() and a.actif);
end $$;

-- ──────────────── 3 · la garde, en tête de chaque fonction client ─────────
-- Chacune est reprise de sa DERNIÈRE définition, même signature, mêmes
-- droits ; seule change sa première instruction. Les fonctions écrites en
-- SQL deviennent du plpgsql pour pouvoir lever avant de lire. Les trois
-- sorties au code secret (demander_sortie à cinq arguments, retirer_numero,
-- fermer_mon_compte) ont ici une garde de passage : 0036 les remplace.

create or replace function public.accepter_conditions(p_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_c comptes;
begin
  perform _exiger_aal2();
  if auth.uid() is null then raise exception 'non connecté'; end if;
  if p_version is distinct from (parametre('conditions') ->> 'version') then
    raise exception 'conditions non acceptées' using detail = 'ce ne sont pas les conditions en vigueur';
  end if;
  update comptes set conditions_version = p_version, conditions_acceptees_le = now()
   where id = auth.uid() returning * into v_c;
  if not found then raise exception 'compte inconnu'; end if;
  return _compte_json(v_c);
end $function$;

create or replace function public.annuler_depot(p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_d depots;
begin
  perform _exiger_aal2();
  select * into v_d from depots where reference = p_reference and compte_id = auth.uid() for update;
  if not found then raise exception 'dépôt inconnu'; end if;
  if v_d.etat <> 'en_attente' or exists (select 1 from depot_declarations where depot_id = v_d.id and etat = 'attendu') then
    raise exception 'ce dépôt ne peut plus être annulé' using detail = v_d.etat;
  end if;
  update depots set etat = 'annule' where id = v_d.id returning * into v_d;
  return _depot_json(v_d);
end $function$;

create or replace function public.bougies(p_intervalle text, p_avant timestamp with time zone DEFAULT NULL::timestamp with time zone, p_n integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_n       int := least(greatest(coalesce(p_n, 300), 1), 1000);
  v_avant   timestamptz := coalesce(p_avant, now() + interval '1 second');
  v_paire   text := parametre('marche') ->> 'paire';
  v_debut   timestamptz;      -- le premier échange de Glisil
  v_borne   timestamptz;      -- on ne lit pas plus loin que n bougies (et un peu de marge) en arrière
  v_res     jsonb;
  v_plus    boolean;
begin
  perform _exiger_aal2();
  if p_intervalle not in ('1m', '5m', '15m', '30m', '1h', '4h', '1j', '1s', '1M') then
    raise exception 'intervalle invalide' using detail = '1m, 5m, 15m, 30m, 1h, 4h, 1j, 1s ou 1M';
  end if;
  select min(cree_le) into v_debut from executions where paire = v_paire;
  v_borne := _debut_de_bougie(v_avant, p_intervalle) - _duree_de_bougie(p_intervalle) * (v_n * 2 + 2);

  with marche as (
    select _debut_de_bougie(e.cree_le, p_intervalle) t,
           (array_agg(e.prix order by e.cree_le, e.id))[1] o, max(e.prix) h, min(e.prix) l,
           (array_agg(e.prix order by e.cree_le desc, e.id desc))[1] c, sum(e.quantite) v
      from executions e
     where e.paire = v_paire and e.cree_le < v_avant and e.cree_le >= v_borne
     group by 1
  ),
  -- le cours de référence, jour par jour, AVANT le premier échange (les jours et au-delà seulement)
  jours as (
    select (h.jour::timestamp at time zone 'Africa/Douala') t,
           coalesce(lag(h.usd_xaf) over (order by h.jour), h.usd_xaf) o, h.usd_xaf c
      from cours_historiques h
     where p_intervalle in ('1j', '1s', '1M')
       and (v_debut is null or h.jour < (v_debut at time zone 'Africa/Douala')::date)
       and (h.jour::timestamp at time zone 'Africa/Douala') < v_avant
       and (h.jour::timestamp at time zone 'Africa/Douala') >= v_borne - interval '31 days'
  ),
  reference as (
    select _debut_de_bougie(j.t, p_intervalle) t,
           (array_agg(j.o order by j.t))[1] o,
           max(greatest(j.o, j.c)) h, min(least(j.o, j.c)) l,
           (array_agg(j.c order by j.t desc))[1] c
      from jours j group by 1
  ),
  tout as (
    select t, round(o, 2) o, round(h, 2) h, round(l, 2) l, round(c, 2) c, v, 'marche' source from marche
    union all
    select t, round(o, 2), round(h, 2), round(l, 2), round(c, 2), 0, 'reference' from reference
     where t < v_avant and not exists (select 1 from marche m where m.t = reference.t)
  ),
  page as (select * from tout order by t desc limit v_n)
  select coalesce(jsonb_agg(jsonb_build_object('t', t, 'o', o, 'h', h, 'l', l, 'c', c, 'v', v, 'source', source) order by t), '[]'::jsonb)
    into v_res from page;

  -- reste-t-il quelque chose plus loin dans le passé ?
  v_plus := exists (select 1 from executions where paire = v_paire and cree_le < least(v_avant, coalesce((v_res -> 0 ->> 't')::timestamptz, v_avant)))
         or (p_intervalle in ('1j', '1s', '1M') and exists (
               select 1 from cours_historiques
                where (jour::timestamp at time zone 'Africa/Douala') < least(v_avant, coalesce((v_res -> 0 ->> 't')::timestamptz, v_avant))));
  return jsonb_build_object('intervalle', p_intervalle, 'bougies', v_res, 'plus_ancien', v_plus,
                            'debut_marche', v_debut, 'premier_cours', (select min(jour) from cours_historiques));
end $function$;

create or replace function public.confirmer_numero(p_id uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n numeros; v_k numeros_codes;
begin
  perform _exiger_aal2();
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
end $function$;

create or replace function public.demander_verification(p_type text, p_pieces jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_c comptes;
begin
  perform _exiger_aal2();
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
end $function$;

create or replace function public.retirer_declaration(p_reference text, p_transaction_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_d depots; v_x depot_declarations; v_id text := normaliser_transaction_id(p_transaction_id);
begin
  perform _exiger_aal2();
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
end $function$;

create or replace function public.terminer_depot(p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_d depots;
begin
  perform _exiger_aal2();
  select * into v_d from depots where reference = p_reference and compte_id = auth.uid() for update;
  if not found then raise exception 'dépôt inconnu'; end if;
  if v_d.etat = 'en_attente' and not exists (select 1 from depot_declarations where depot_id = v_d.id) then
    update depots set etat = 'annule' where id = v_d.id returning * into v_d;
  end if;
  return _depot_json(v_d);
end $function$;

create or replace function public.demander_sortie(p_montant numeric, p_numero_id uuid, p_cle text, p_code text, p_nom text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb; v_demo boolean;
begin
  perform _exiger_aal2();
  select numero_de_demo(n.numero) into v_demo
    from numeros n where n.id = p_numero_id and n.compte_id = auth.uid() and n.retire_le is null;
  if coalesce(v_demo, false) and _depots_reels_ouverts(auth.uid()) then
    raise exception 'un numéro de démo ne reçoit que l''argent de test'
      using detail = 'vos XAFe sont de l''argent réel : retirez-les vers un vrai numéro';
  end if;
  -- l'autre sens, qui manquait : l'argent de test ne part pas vers un vrai numéro
  if not coalesce(v_demo, false) and not _depots_reels_ouverts(auth.uid()) then
    raise exception 'l''argent de test ne sort pas en vrai'
      using detail = 'vos XAFe de la bêta se retirent vers un numéro de démo (600…)';
  end if;
  if not coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true) and not coalesce(v_demo, false) then
    raise exception 'sorties pas encore ouvertes' using detail = 'vos XAFe restent sur votre compte';
  end if;
  v := _controler_code(auth.uid(), p_code);
  if not (v ->> 'ok')::boolean then return v; end if;
  if _sortie_manuelle() then return _demander_sortie_manuelle(p_montant, p_numero_id, p_cle, p_nom); end if;
  return demander_sortie(p_montant, p_numero_id, p_cle);
end $function$;

create or replace function public.retirer_numero(p_id uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb; v_n numeros;
begin
  perform _exiger_aal2();
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
end $function$;

create or replace function public.fermer_mon_compte(p_code text, p_motif text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_c comptes; v jsonb; v_reste text;
begin
  perform _exiger_aal2();
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
end $function$;

create or replace function public.annuler_ordre(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select _annuler_ordre(auth.uid(), p_id)
  );
end $function$;

create or replace function public.carnet(p_profondeur integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select jsonb_build_object(
    'achats', (select coalesce(jsonb_agg(jsonb_build_object('prix', prix, 'quantite', q, 'ordres', n) order by prix desc), '[]'::jsonb)
                 from (select prix, sum(restant) q, count(*) n from ordres
                        where etat in ('ouvert', 'partiel') and cote = 'achat' group by prix order by prix desc limit p_profondeur) a),
    'ventes', (select coalesce(jsonb_agg(jsonb_build_object('prix', prix, 'quantite', q, 'ordres', n) order by prix asc), '[]'::jsonb)
                 from (select prix, sum(restant) q, count(*) n from ordres
                        where etat in ('ouvert', 'partiel') and cote = 'vente' group by prix order by prix asc limit p_profondeur) v),
    'dernier', (select prix from executions order by cree_le desc, id desc limit 1))
  );
end $function$;

create or replace function public.chandelles(p_minutes integer DEFAULT 60, p_n integer DEFAULT 28)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
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
  );
end $function$;

create or replace function public.cotation()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
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
    'reference', _prix_reference(),
    -- le vrai dollar (0022) : ce que vaut 1 USD au cours de la BCE, et la prime posée par-dessus
    'cours_reel', _cours_reel())
  );
end $function$;

create or replace function public.ma_sortie(p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select _sortie_json(s) || jsonb_build_object('transferts',
           (select coalesce(jsonb_agg(jsonb_build_object('etat', c.etat, 'montant_xafe', c.montant_xafe,
                                                        'montant_envoye', (c.parametres ->> 'montant')::numeric,
                                                        'reference_operateur', c.reference_operateur) order by c.id), '[]'::jsonb)
              from commandes c where c.sortie_id = s.id))
    from sorties s where s.reference = p_reference and s.compte_id = auth.uid()
  );
end $function$;

create or replace function public.marquer_notifications_lues()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  update notifications set lue_le = now() where compte_id = auth.uid() and lue_le is null;
end $function$;

create or replace function public.mes_depots_en_attente()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select coalesce(jsonb_agg(_depot_json(d) order by d.cree_le desc), '[]'::jsonb)
    from depots d
   where d.compte_id = auth.uid()
     and ((d.etat = 'en_attente' and d.expire_le > now())
          or exists (select 1 from depot_declarations x where x.depot_id = d.id and x.etat = 'attendu'))
  );
end $function$;

create or replace function public.mes_notifications()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'titre', titre, 'texte', texte, 'cible', cible, 'cree_le', cree_le, 'lue_le', lue_le) order by cree_le desc), '[]'::jsonb)
    from (select * from notifications where compte_id = auth.uid() order by cree_le desc limit 100) n
  );
end $function$;

create or replace function public.mes_numeros()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select coalesce(jsonb_agg(_numero_json(n) order by n.verifie_le nulls last, n.id), '[]'::jsonb)
    from numeros n where n.compte_id = auth.uid() and n.retire_le is null
  );
end $function$;

create or replace function public.mes_ordres()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select coalesce(jsonb_agg(_ordre_json(o) order by o.cree_le desc, o.numero desc), '[]'::jsonb)
    from (select * from ordres where compte_id = auth.uid() order by cree_le desc limit 100) o
  );
end $function$;

create or replace function public.mes_soldes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select coalesce(jsonb_object_agg(actif, jsonb_build_object('disponible', disponible, 'bloque', bloque)), '{}'::jsonb)
    from soldes where compte_id = auth.uid()
  );
end $function$;

create or replace function public.mon_compte()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select _compte_json(c) from comptes c where c.id = auth.uid()
  );
end $function$;

create or replace function public.mon_depot(p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select _depot_json(d) from depots d where d.reference = p_reference and d.compte_id = auth.uid()
  );
end $function$;

create or replace function public.mon_historique(p_n integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select coalesce(jsonb_agg(ligne order by quand desc), '[]'::jsonb)
    from (select ligne, quand from _lignes_historique(auth.uid()) order by quand desc limit least(greatest(coalesce(p_n, 200), 1), 500)) page
  );
end $function$;

create or replace function public.mon_operation(p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select ligne from _lignes_historique(auth.uid()) where cle = p_reference limit 1
  );
end $function$;

create or replace function public.mon_ordre(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select jsonb_build_object(
    'ordre', _ordre_json(o),
    'executions', (select coalesce(jsonb_agg(_execution_json(e) || jsonb_build_object('mon_role', case when e.preneur = o.cote then 'preneur' else 'placeur' end)
                                              order by e.cree_le, e.id), '[]'::jsonb)
                     from executions e where (o.cote = 'achat' and e.ordre_achat = o.id) or (o.cote = 'vente' and e.ordre_vente = o.id)))
    from ordres o where o.id = p_id and o.compte_id = auth.uid()
  );
end $function$;

create or replace function public.mon_retrait_crypto(p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select _retrait_json(r) from retraits_crypto r where r.reference = p_reference and r.compte_id = auth.uid()
  );
end $function$;

create or replace function public.parametres_publics()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select jsonb_build_object(
    'frais', parametre('frais'),
    'marche', _marche() || jsonb_build_object('reference', _prix_reference()),
    'paliers', parametre('paliers'),
    'rapide', jsonb_build_object('marge', parametre('rapide') -> 'marge', 'ouvert', coalesce((parametre('rapide') ->> 'ouvert')::boolean, false),
                                 'validite_secondes', parametre('rapide') -> 'validite_secondes'),
    'crypto', jsonb_build_object('frais', parametre('crypto') -> 'frais',
                                 'retraits_ouverts', coalesce((parametre('crypto') ->> 'retraits_ouverts')::boolean, false),
                                 'depots_ouverts', coalesce((parametre('crypto') ->> 'depots_ouverts')::boolean, true),
                                 'reseaux', _reseaux_publics()),
    'sortie', jsonb_build_object('ouvertes', coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true),
                                 'mode', coalesce(parametre('sortie') ->> 'mode', 'totem')),
    'numeros', jsonb_build_object('verification_sms', coalesce((parametre('numeros') ->> 'verification_sms')::boolean, true),
                                  'delai_heures', coalesce((parametre('numeros') ->> 'delai_heures')::int, 24)),
    'operateurs', (select jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'plafond_par_transfert', plafond_par_transfert,
                                                       'plafond_jour', plafond_jour) order by id) from operateurs),
    -- la bêta : ce que l'écran annonce, la dotation d'un nouveau testeur, et si CE compte peut payer en vrai
    'beta', jsonb_build_object('actif', coalesce((parametre('beta') ->> 'actif')::boolean, false),
                               'message', parametre('beta') ->> 'message',
                               'message_en', parametre('beta') ->> 'message_en',
                               'dotation', parametre('beta') -> 'dotation',
                               'depots_reels', _depots_reels_ouverts(auth.uid()),
                               -- un float de démo TOTEM est branché : dépôts et retraits s'ouvrent vers la démo (0028)
                               'demo_totem', exists (select 1 from floats f join terminaux t on t.id = f.terminal
                                                      where f.actif and t.demo)),
    'conditions', parametre('conditions'),
    'support', parametre('support'))
   where auth.uid() is not null
  );
end $function$;

create or replace function public.transactions_recentes(p_n integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select coalesce(jsonb_agg(jsonb_build_object('prix', prix, 'quantite', quantite, 'preneur', preneur, 'cree_le', cree_le)
                            order by cree_le desc, id desc), '[]'::jsonb)
    from (select * from executions order by cree_le desc, id desc limit p_n) e
  );
end $function$;

create or replace function public.placer_ordre(p_cote text, p_type text, p_quantite numeric, p_prix numeric DEFAULT NULL::numeric, p_cle text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select _placer_ordre(auth.uid(), p_cote, p_type, p_quantite, p_prix, p_cle, null)
  );
end $function$;

-- Le code secret à 4 chiffres ne s'ouvre plus aux clients. Ses fonctions
-- restent pour l'instant (les quatre sorties l'appellent encore) : 0036 les
-- retire avec lui, en remplaçant chaque sortie par la vérification.
revoke execute on function completer_profil(text, text), verifier_code_secret(text), changer_code_secret(text, text) from authenticated;

-- ─────────────────────── 4 · les tables lisibles ───────────────────────────
-- Une politique RESTRICTIVE s'ajoute (ET) aux politiques de chaque table
-- qu'un client lit : en session faible, aucune ligne. La liste est écrite ici
-- à la main : une table neuve lisible sans cette politique fait échouer 11.58.
-- « (select …) » : la garde est évaluée une fois par requête, pas par ligne.
-- Le temps réel (postgres_changes) applique les mêmes politiques.
do $$ declare t text; begin
  foreach t in array array['administrateurs', 'adresses_crypto', 'comptes', 'depot_declarations', 'depot_paiements', 'depots', 'ecritures',
                           'executions', 'notifications', 'numeros', 'operateurs', 'ordres', 'parametres', 'retraits_crypto', 'soldes',
                           'sorties', 'transferts_crypto'] loop
    execute format('drop policy if exists session_forte on %I', t);
    execute format('create policy session_forte on %I as restrictive for select to authenticated using ((select public.session_forte()))', t);
  end loop;
end $$;

-- ───────────────────────────── 5 · le stockage ─────────────────────────────
-- Les pièces de vérification (0004) : déposer et relire demandent aussi la
-- session forte. Les preuves de sortie (0014) et les relevés des floats
-- (0016) passent par admin_a_droit, qui l'exige déjà.
do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  execute $p$drop policy if exists verifications_deposer on storage.objects$p$;
  execute $p$drop policy if exists verifications_relire on storage.objects$p$;
  execute $p$create policy verifications_deposer on storage.objects for insert to authenticated
            with check (bucket_id = 'verifications' and (storage.foldername(name))[1] = auth.uid()::text and public.session_forte())$p$;
  execute $p$create policy verifications_relire on storage.objects for select to authenticated
            using (bucket_id = 'verifications' and public.session_forte()
                   and ((storage.foldername(name))[1] = auth.uid()::text or public.admin_a_droit('paliers')))$p$;
end $$;

-- ─────────────────────────── 6 · les codes de secours ──────────────────────
-- Dix codes de dix caractères (alphabet de Crockford : ni I, ni L, ni O, ni
-- U), 50 bits chacun, tirés ici et gardés en empreintes sha256 salées par
-- l'identifiant : des codes de cette entropie n'ont pas besoin de bcrypt. Le
-- texte en clair n'existe qu'une fois, dans la réponse de
-- generer_codes_de_secours, et n'est jamais journalisé.
insert into parametres (cle, valeur) values
  ('codes_de_secours', '{"nombre": 10, "essais": 5, "verrou_minutes": 15, "fraicheur_totp_secondes": 300}')
on conflict (cle) do nothing;

-- un lot par utilisateur Auth (client OU administrateur) : clé = auth.users.id, sans clé étrangère (comme comptes)
create table if not exists lots_de_secours (
  utilisateur_id uuid primary key,
  cree_le        timestamptz not null default now(),
  confirme_le    timestamptz,
  essais_rates   int not null default 0,
  verrou_jusqua  timestamptz
);
create table if not exists codes_de_secours (
  id             bigint generated always as identity primary key,
  utilisateur_id uuid not null,
  empreinte      text not null check (empreinte ~ '^[0-9a-f]{64}$'),
  cree_le        timestamptz not null default now(),
  utilise_le     timestamptz
);
create index if not exists codes_de_secours_libres on codes_de_secours (utilisateur_id) where utilise_le is null;
alter table lots_de_secours enable row level security;
alter table codes_de_secours enable row level security;

-- Le journal de sécurité : ce qui touche aux facteurs d'une personne. Jamais un code.
create table if not exists journal_securite (
  id             bigint generated always as identity primary key,
  utilisateur_id uuid not null,
  evenement      text not null check (evenement in ('codes_generes', 'codes_confirmes', 'code_de_secours_utilise', 'code_de_secours_refuse',
                                                    'deux_facteurs_retires', 'reinitialisation_demandee', 'reinitialisation_echouee')),
  par_admin      uuid,
  detail         jsonb,
  cree_le        timestamptz not null default now()
);
create index if not exists journal_securite_de on journal_securite (utilisateur_id, cree_le desc);
create table if not exists reinitialisations_2fa (
  id             uuid primary key default gen_random_uuid(),
  utilisateur_id uuid not null,
  admin_id       uuid not null,
  motif          text not null check (length(motif) >= 10),
  demandee_le    timestamptz not null default now(),
  faite_le       timestamptz,
  facteurs       int,
  echec          text
);
create index if not exists reinitialisations_2fa_de on reinitialisations_2fa (utilisateur_id, demandee_le desc);
alter table journal_securite enable row level security;
alter table reinitialisations_2fa enable row level security;
revoke all on lots_de_secours, codes_de_secours, journal_securite, reinitialisations_2fa from public, anon, authenticated;
grant all on lots_de_secours, codes_de_secours, journal_securite, reinitialisations_2fa to service_role;

create or replace function _journal_securite(p_utilisateur uuid, p_evenement text, p_admin uuid, p_detail jsonb) returns void
language sql set search_path = public as $$
  insert into journal_securite (utilisateur_id, evenement, par_admin, detail) values (p_utilisateur, p_evenement, p_admin, p_detail)
$$;

-- 256 % 32 = 0 : un octet modulo 32 ne favorise aucune lettre.
create or replace function _code_de_secours_neuf() returns text
language sql volatile set search_path = public, extensions, pg_temp as $$
  select string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', get_byte(x.b, i) % 32 + 1, 1), '' order by i)
    from (select extensions.gen_random_bytes(10) b) x, generate_series(0, 9) i
$$;

-- Ce que la personne recopie : minuscules, espaces et tirets acceptés ; O se
-- lit 0, I et L se lisent 1 (Crockford). Autre chose que dix signes : null.
create or replace function _code_de_secours_normalise(p text) returns text
language sql immutable set search_path = public as $$
  select case when v ~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$' then v end
    from (select translate(regexp_replace(upper(coalesce(p, '')), '[^0-9A-Z]', '', 'g'), 'OIL', '011') v) x
$$;

create or replace function _empreinte_de_secours(p_utilisateur uuid, p_code text) returns text
language sql immutable set search_path = public, extensions, pg_temp as $$
  select encode(extensions.digest(p_utilisateur::text || ':' || p_code, 'sha256'), 'hex')
$$;

-- Un lot neuf. Le premier se tire librement (à l'inscription, avant d'être
-- noté) ; une fois confirmé, le remplacer demande un code TOTP FRAIS : une
-- session volée ne remplace pas les codes de secours de la victime.
create or replace function generer_codes_de_secours() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid       uuid := auth.uid();
  v_p         jsonb := parametre('codes_de_secours');
  v_n         int := coalesce((v_p ->> 'nombre')::int, 10);
  v_fraicheur int := coalesce((v_p ->> 'fraicheur_totp_secondes')::int, 300);
  v_lot       lots_de_secours;
  v_codes     text[] := '{}';
  v_code      text;
begin
  perform _exiger_aal2();
  if v_uid is null then raise exception 'non connecté'; end if;
  insert into lots_de_secours (utilisateur_id) values (v_uid) on conflict do nothing;
  select * into v_lot from lots_de_secours where utilisateur_id = v_uid for update;
  if v_lot.confirme_le is not null
     and coalesce(_moment_du_facteur('totp'), '-infinity'::timestamptz) < now() - make_interval(secs => v_fraicheur) then
    raise exception 'confirmez avec votre application d''authentification' using detail = 'entrez un code tout neuf, puis recommencez';
  end if;
  delete from codes_de_secours where utilisateur_id = v_uid;
  while coalesce(array_length(v_codes, 1), 0) < v_n loop
    v_code := _code_de_secours_neuf();
    continue when v_code = any (v_codes);       -- deux fois le même dans un lot : une chance sur 2^47, on retire
    v_codes := v_codes || v_code;
    insert into codes_de_secours (utilisateur_id, empreinte) values (v_uid, _empreinte_de_secours(v_uid, v_code));
  end loop;
  update lots_de_secours set cree_le = now(), confirme_le = null, essais_rates = 0, verrou_jusqua = null where utilisateur_id = v_uid;
  perform _journal_securite(v_uid, 'codes_generes', null, jsonb_build_object('nombre', v_n));
  return jsonb_build_object('codes', (select jsonb_agg(left(c, 5) || '-' || right(c, 5) order by o) from unnest(v_codes) with ordinality u(c, o)),
                            'cree_le', now());
end $$;

-- « Je les ai notés » : sans cette case, ni compte ni administration ne s'ouvrent.
create or replace function confirmer_codes_de_secours() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_n int;
begin
  perform _exiger_aal2();
  if v_uid is null then raise exception 'non connecté'; end if;
  perform 1 from lots_de_secours where utilisateur_id = v_uid for update;
  if found then
    select count(*) into v_n from codes_de_secours where utilisateur_id = v_uid and utilise_le is null;
  end if;
  if coalesce(v_n, 0) = 0 then raise exception 'aucun code de secours' using detail = 'générez d''abord vos codes'; end if;
  update lots_de_secours set confirme_le = now() where utilisateur_id = v_uid;
  perform _journal_securite(v_uid, 'codes_confirmes', null, jsonb_build_object('restants', v_n));
  return jsonb_build_object('restants', v_n);
end $$;

create or replace function mes_codes_de_secours() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_lot lots_de_secours;
begin
  perform _exiger_aal2();
  if v_uid is null then raise exception 'non connecté'; end if;
  select * into v_lot from lots_de_secours where utilisateur_id = v_uid;
  return jsonb_build_object('confirmes', v_lot.confirme_le is not null,
                            'restants', (select count(*) from codes_de_secours where utilisateur_id = v_uid and utilise_le is null),
                            'cree_le', v_lot.cree_le);
end $$;

-- Pour la fonction deux-facteurs SEULEMENT (clé de service). Elle ne lève
-- jamais : un échec reste compté (le compteur est écrit, puis on répond).
create or replace function _consommer_code_de_secours(p_utilisateur uuid, p_code text) returns jsonb
language plpgsql set search_path = public, extensions, pg_temp as $$
declare
  v_p       jsonb := parametre('codes_de_secours');
  v_essais  int := coalesce((v_p ->> 'essais')::int, 5);
  v_minutes int := coalesce((v_p ->> 'verrou_minutes')::int, 15);
  v_lot     lots_de_secours;
  v_code    text := _code_de_secours_normalise(p_code);
  v_ligne   codes_de_secours;
  v_restants int;
begin
  select * into v_lot from lots_de_secours where utilisateur_id = p_utilisateur for update;
  if not found then return jsonb_build_object('ok', false, 'erreur', 'aucun code de secours'); end if;
  if v_lot.verrou_jusqua is not null and v_lot.verrou_jusqua > now() then
    return jsonb_build_object('ok', false, 'erreur', 'trop d''essais', 'essais_restants', 0, 'verrou_jusqua', v_lot.verrou_jusqua);
  end if;
  if v_code is not null then
    select * into v_ligne from codes_de_secours
     where utilisateur_id = p_utilisateur and utilise_le is null and empreinte = _empreinte_de_secours(p_utilisateur, v_code)
     limit 1 for update;
  end if;
  if v_ligne.id is null then
    if v_lot.essais_rates + 1 >= v_essais then
      update lots_de_secours set essais_rates = 0, verrou_jusqua = now() + make_interval(mins => v_minutes) where utilisateur_id = p_utilisateur;
      perform _journal_securite(p_utilisateur, 'code_de_secours_refuse', null, jsonb_build_object('verrou', true));
      return jsonb_build_object('ok', false, 'erreur', 'trop d''essais', 'essais_restants', 0,
                                'verrou_jusqua', now() + make_interval(mins => v_minutes));
    end if;
    update lots_de_secours set essais_rates = essais_rates + 1 where utilisateur_id = p_utilisateur;
    perform _journal_securite(p_utilisateur, 'code_de_secours_refuse', null, jsonb_build_object('essais_restants', v_essais - v_lot.essais_rates - 1));
    return jsonb_build_object('ok', false, 'erreur', 'code de secours incorrect', 'essais_restants', v_essais - v_lot.essais_rates - 1);
  end if;
  update codes_de_secours set utilise_le = now() where id = v_ligne.id;
  update lots_de_secours set essais_rates = 0 where utilisateur_id = p_utilisateur;
  select count(*) into v_restants from codes_de_secours where utilisateur_id = p_utilisateur and utilise_le is null;
  perform _journal_securite(p_utilisateur, 'code_de_secours_utilise', null, jsonb_build_object('restants', v_restants));
  return jsonb_build_object('ok', true, 'code_id', v_ligne.id, 'restants', v_restants);
end $$;

-- Le retrait du facteur a échoué chez GoTrue : le code brûlé est rendu, sinon
-- la personne resterait sans facteur ET sans ce code.
create or replace function _code_de_secours_rendu(p_code_id bigint) returns void
language sql set search_path = public as $$
  update codes_de_secours set utilise_le = null where id = p_code_id
$$;

-- ───────────────── 7 · la double authentification retirée ──────────────────
-- Par un code de secours (la personne), ou par l'administration (un super
-- admin, un motif, trois fois au plus par jour et par personne). Le facteur
-- se retire chez GoTrue (la fonction deux-facteurs) ; ici, la décision et la
-- trace.
create or replace function admin_autoriser_reinitialisation_2fa(p_utilisateur uuid, p_motif text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_motif text := trim(coalesce(p_motif, '')); v_email text; v_id uuid;
begin
  perform _exiger_droit('administrateurs');
  if p_utilisateur = auth.uid() then
    raise exception 'vous ne réinitialisez pas votre propre double authentification' using detail = 'servez-vous d''un de vos codes de secours';
  end if;
  select email into v_email from auth.users where id = p_utilisateur;
  if not found then raise exception 'utilisateur inconnu'; end if;
  if length(v_motif) < 10 then raise exception 'motif trop court' using detail = 'dites comment vous avez vérifié l''identité'; end if;
  -- deux super admins en même temps ne passent pas tous deux la limite
  perform pg_advisory_xact_lock(hashtextextended('reinitialisation_2fa:' || p_utilisateur::text, 0));
  if (select count(*) from reinitialisations_2fa where utilisateur_id = p_utilisateur and demandee_le > now() - interval '24 hours') >= 3 then
    raise exception 'trop de réinitialisations' using detail = 'trois par personne et par jour au plus';
  end if;
  insert into reinitialisations_2fa (utilisateur_id, admin_id, motif) values (p_utilisateur, auth.uid(), v_motif) returning id into v_id;
  perform _journal_securite(p_utilisateur, 'reinitialisation_demandee', auth.uid(), jsonb_build_object('reinitialisation', v_id));
  perform _journaliser('deux_facteurs_reinitialisation', p_utilisateur::text, jsonb_build_object('motif', v_motif, 'reinitialisation', v_id));
  return jsonb_build_object('id', v_id, 'utilisateur_id', p_utilisateur, 'email', v_email);
end $$;

-- Après le retrait chez GoTrue (clé de service) : les codes de secours partent
-- avec le facteur — la prochaine connexion repasse par l'enrôlement puis par
-- des codes neufs. La personne est prévenue dans l'application et par e-mail.
create or replace function _deux_facteurs_retires(p_utilisateur uuid, p_cause text, p_reinitialisation uuid, p_facteurs int) returns jsonb
language plpgsql set search_path = public as $$
declare v_compte uuid; v_email text; v_courriel bigint;
begin
  if p_cause is null or p_cause not in ('code_de_secours', 'administration') then raise exception 'cause inconnue'; end if;
  delete from codes_de_secours where utilisateur_id = p_utilisateur;
  delete from lots_de_secours where utilisateur_id = p_utilisateur;
  if p_reinitialisation is not null then
    update reinitialisations_2fa set faite_le = now(), facteurs = p_facteurs
     where id = p_reinitialisation and utilisateur_id = p_utilisateur;
  end if;
  perform _journal_securite(p_utilisateur, 'deux_facteurs_retires',
                            (select admin_id from reinitialisations_2fa where id = p_reinitialisation),
                            jsonb_build_object('cause', p_cause, 'facteurs', p_facteurs));
  select id into v_compte from comptes where id = p_utilisateur;
  if v_compte is not null then
    perform _notifier(v_compte, 'Double authentification retirée',
                      'Votre application d''authentification a été retirée de votre compte. Si ce n''est pas vous, contactez l''équipe tout de suite.',
                      '/compte/securite');
  end if;
  -- l'e-mail passe par la boîte d'envoi de 0036 ; un administrateur n'a pas de ligne « comptes » : son adresse va en destinataire
  if to_regprocedure('public._envoyer_courriel(uuid,text,jsonb,text,timestamptz,text)') is not null then
    if v_compte is null then select email into v_email from auth.users where id = p_utilisateur; end if;
    if v_compte is not null or v_email is not null then
      execute 'select public._envoyer_courriel($1, $2, $3, $4, null, $5)' into v_courriel
        using v_compte, 'deux_facteurs_retires', jsonb_build_object('cause', p_cause, 'quand', now()),
              'deux_facteurs_retires:' || p_utilisateur::text || ':' || (now() at time zone 'Africa/Douala')::date::text, v_email;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'courriel', v_courriel);
end $$;

create or replace function _reinitialisation_2fa_echouee(p_id uuid, p_erreur text) returns void
language plpgsql set search_path = public as $$
declare v_u uuid;
begin
  update reinitialisations_2fa set echec = left(coalesce(p_erreur, 'échec'), 300) where id = p_id returning utilisateur_id into v_u;
  if v_u is not null then
    perform _journal_securite(v_u, 'reinitialisation_echouee', null, jsonb_build_object('reinitialisation', p_id));
  end if;
end $$;

-- La fiche « Sécurité » d'une personne, pour l'équipe. Jamais une empreinte ;
-- le motif d'une réinitialisation, pour le super admin seulement.
create or replace function admin_securite_utilisateur(p_utilisateur uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_super boolean;
begin
  perform _exiger_droit('clients');
  v_super := admin_a_droit('administrateurs');
  return jsonb_build_object(
    'deux_facteurs', exists (select 1 from auth.mfa_factors where user_id = p_utilisateur and factor_type = 'totp' and status = 'verified'),
    'codes_restants', (select count(*) from codes_de_secours where utilisateur_id = p_utilisateur and utilise_le is null),
    'codes_confirmes_le', (select confirme_le from lots_de_secours where utilisateur_id = p_utilisateur),
    'evenements', (select coalesce(jsonb_agg(jsonb_build_object('evenement', evenement, 'par_admin', par_admin, 'detail', detail, 'cree_le', cree_le)
                                             order by cree_le desc, id desc), '[]'::jsonb)
                     from (select * from journal_securite where utilisateur_id = p_utilisateur order by cree_le desc, id desc limit 20) j),
    'reinitialisations', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'admin_id', admin_id, 'demandee_le', demandee_le, 'faite_le', faite_le,
                                                                       'facteurs', facteurs, 'echec', echec)
                                                    || case when v_super then jsonb_build_object('motif', motif) else '{}'::jsonb end
                                                    order by demandee_le desc), '[]'::jsonb)
                            from reinitialisations_2fa where utilisateur_id = p_utilisateur));
end $$;

-- ───────────────────────── 8 · ouvrir son compte ───────────────────────────
-- Le téléphone : obligatoire, non vérifié, unique parmi les comptes OUVERTS —
-- le numéro d'un compte fermé se réutilise (décision du propriétaire).
alter table comptes drop constraint if exists comptes_telephone_key;
create unique index if not exists comptes_telephone_ouvert on comptes (telephone) where ferme_le is null;

create or replace function ouvrir_mon_compte(p_prenom text, p_nom text, p_naissance date, p_telephone text, p_ville text, p_pays text, p_conditions text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email  text := _email_prouve();
  v_prenom text := _nom_propre(p_prenom);
  v_nom    text := _nom_propre(p_nom);
  v_ville  text := _nom_propre(p_ville);
  v_pays   text := upper(trim(coalesce(p_pays, '')));
  v_tel    text := regexp_replace(coalesce(p_telephone, ''), '[^0-9+]', '', 'g');
  v_age    int;
  v_c      comptes;
  v_contrainte text;
begin
  perform _exiger_aal2();
  if auth.uid() is null then raise exception 'non connecté'; end if;
  if v_email is null then raise exception 'adresse e-mail non vérifiée' using detail = 'entrez le code reçu par e-mail'; end if;
  if not _mot_de_passe_pose(auth.uid()) then raise exception 'mot de passe à choisir' using detail = 'il protège chaque sortie d''argent'; end if;
  if not exists (select 1 from lots_de_secours where utilisateur_id = auth.uid() and confirme_le is not null) then
    raise exception 'codes de secours à noter' using detail = 'ils vous rendent l''accès si vous perdez votre téléphone';
  end if;
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
  if exists (select 1 from comptes where telephone = v_tel and ferme_le is null) then
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
exception when unique_violation then
  -- deux inscriptions au même instant : la vérification plus haut ne voit pas l'autre, l'index, si
  get stacked diagnostics v_contrainte = constraint_name;
  if v_contrainte = 'comptes_telephone_ouvert' then raise exception 'ce numéro est déjà utilisé' using detail = 'il appartient à un autre compte';
  elsif v_contrainte = 'comptes_email_unique' then raise exception 'cette adresse est déjà utilisée';
  elsif v_contrainte = 'comptes_pkey' then raise exception 'compte déjà ouvert';
  else raise; end if;
end $function$;

-- L'administration : la session forte, un mot de passe posé, des codes notés.
create or replace function entrer_administration()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_email text := _email_prouve(); v_inv administrateurs_invites;
begin
  perform _exiger_aal2();
  if auth.uid() is null or v_email is null then return null; end if;
  if not _mot_de_passe_pose(auth.uid()) then raise exception 'mot de passe à choisir' using detail = 'il protège l''administration'; end if;
  if not exists (select 1 from lots_de_secours where utilisateur_id = auth.uid() and confirme_le is not null) then
    raise exception 'codes de secours à noter' using detail = 'ils vous rendent l''accès si vous perdez votre téléphone';
  end if;
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
end $function$;

-- ─────────────── 9 · la seule lecture permise en session faible ────────────
-- L'écran d'entrée en a besoin AVANT le TOTP : où en est la personne. Elle
-- lit auth.uid() et rien d'autre de ce qui est à elle ; à dessein, pas de garde.
create or replace function mon_etat_d_entree() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_conf timestamptz;
begin
  if v_uid is null then raise exception 'non connecté'; end if;
  select email_confirmed_at into v_conf from auth.users where id = v_uid;
  return jsonb_build_object('email_confirme', v_conf is not null, 'mot_de_passe', _mot_de_passe_pose(v_uid),
    'session_forte', session_forte(),
    'codes_de_secours', exists (select 1 from lots_de_secours where utilisateur_id = v_uid and confirme_le is not null),
    'compte', exists (select 1 from comptes where id = v_uid));
end $$;

-- ───────────── 10 · un compte ne naît plus d'un téléphone prouvé ───────────
-- Plus de connexion par SMS : un compte naît dans ouvrir_mon_compte, et nulle part ailleurs.
do $$
begin
  if to_regclass('auth.users') is not null then
    execute 'drop trigger if exists comptes_naissance on auth.users';
  end if;
end $$;
drop function if exists handle_nouvel_utilisateur();

-- ─────────────── 11 · la troisième couche : le crochet de PostgREST ────────
-- Avant CHAQUE requête d'un client connecté, la session forte est
-- redemandée : une fonction qu'une migration future oublierait de garder est
-- refusée quand même. Deux chemins seulement passent en session faible.
create or replace function avant_chaque_requete() returns void
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if coalesce(v ->> 'role', 'anon') <> 'authenticated' then return; end if;   -- anon : les droits suffisent ; service_role : confiance
  if current_setting('request.path', true) in ('/rpc/mon_etat_d_entree', '/rpc/preuve_de_reserve') then return; end if;
  perform _exiger_aal2();
end $$;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request = ''public.avant_chaque_requete''';
    perform pg_notify('pgrst', 'reload config');
  end if;
end $$;

-- ──────────────────────────── 12 · les conditions ──────────────────────────
-- Les textes parlent maintenant du mot de passe et de la double
-- authentification, plus du code secret : chaque compte les réaccepte.
update parametres set valeur = jsonb_build_object('version', '2026-10-29') where cle = 'conditions';

-- ──────────────────────────────── 13 · les droits ──────────────────────────
revoke all on function session_forte(), _exiger_aal2(), _moment_du_facteur(text), _mot_de_passe_pose(uuid),
  _journal_securite(uuid, text, uuid, jsonb), _code_de_secours_neuf(), _code_de_secours_normalise(text), _empreinte_de_secours(uuid, text),
  generer_codes_de_secours(), confirmer_codes_de_secours(), mes_codes_de_secours(), _consommer_code_de_secours(uuid, text),
  _code_de_secours_rendu(bigint), admin_autoriser_reinitialisation_2fa(uuid, text), _deux_facteurs_retires(uuid, text, uuid, int),
  _reinitialisation_2fa_echouee(uuid, text), admin_securite_utilisateur(uuid), mon_etat_d_entree(), avant_chaque_requete()
  from public, anon, authenticated;
grant execute on function session_forte(), _exiger_aal2(), _moment_du_facteur(text), _mot_de_passe_pose(uuid),
  _journal_securite(uuid, text, uuid, jsonb), _code_de_secours_neuf(), _code_de_secours_normalise(text), _empreinte_de_secours(uuid, text),
  generer_codes_de_secours(), confirmer_codes_de_secours(), mes_codes_de_secours(), _consommer_code_de_secours(uuid, text),
  _code_de_secours_rendu(bigint), admin_autoriser_reinitialisation_2fa(uuid, text), _deux_facteurs_retires(uuid, text, uuid, int),
  _reinitialisation_2fa_echouee(uuid, text), admin_securite_utilisateur(uuid), mon_etat_d_entree(), avant_chaque_requete()
  to service_role;
-- les politiques (tables, stockage) s'évaluent avec les droits de l'appelant : il lui faut la garde
grant execute on function session_forte() to authenticated;
grant execute on function mon_etat_d_entree(), generer_codes_de_secours(), confirmer_codes_de_secours(), mes_codes_de_secours(),
  admin_autoriser_reinitialisation_2fa(uuid, text), admin_securite_utilisateur(uuid) to authenticated;
grant execute on function avant_chaque_requete() to anon, authenticated;

