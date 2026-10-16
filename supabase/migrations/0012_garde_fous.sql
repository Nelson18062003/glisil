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
