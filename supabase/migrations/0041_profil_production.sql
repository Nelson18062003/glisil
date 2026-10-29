-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0041 · le profil de production : l'argent de test n'y existe ║
-- ║  pas                                                                   ║
-- ║                                                                        ║
-- ║  Rejoué tel quel, le schéma est celui de la BÊTA : bêta allumée,       ║
-- ║  dotation à l'inscription, quinze robots et leur tâche de trente       ║
-- ║  secondes, réseau d'essai, démo de TOTEM. Rien de cela ne frappe un    ║
-- ║  franc tant que rien n'est validé — mais dès qu'une tâche tourne ou    ║
-- ║  qu'un compte s'inscrit, l'argent de test apparaît.                    ║
-- ║                                                                        ║
-- ║  Ce fichier est INERTE hors production (bêta, harnais). Il ne pose le  ║
-- ║  profil qu'une fois, sur une base NEUVE, quand la session l'annonce    ║
-- ║  (glisil.profil = 'production', supabase/production/annoncer-la-       ║
-- ║  production.sql), dans la MÊME transaction que tout le schéma          ║
-- ║  (docs/PRODUCTION.md) : rien n'est validé avant lui. Puis :            ║
-- ║    · le profil est une ligne qu'on ne change plus ;                    ║
-- ║    · chaque réglage de production est posé ;                           ║
-- ║    · robots, déclencheurs de bêta et de démo, tâches des robots s'en   ║
-- ║      vont ;                                                            ║
-- ║    · des gardes rendent l'argent de test IMPOSSIBLE pour toujours,     ║
-- ║      même pour un super admin, même en SQL : aucune dotation, la bêta, ║
-- ║      les robots, le réseau d'essai et la démo ne se rallument pas ;    ║
-- ║    · un constat final ANNULE toute l'installation s'il reste un        ║
-- ║      compte, un solde, une émission, un robot, un déclencheur de bêta, ║
-- ║      une tâche de robot ou un secret d'essai.                          ║
-- ║  Rejoué plus tard sur la production (sans l'annonce), il re-tient le   ║
-- ║  profil : 0021, 0023 et 0032 reposent leurs déclencheurs et tâches à   ║
-- ║  chaque passage.                                                       ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ───────────────────────────── 1. le profil, immuable ──────────────────────
create table if not exists profil_de_la_base (
  id       int primary key default 1 check (id = 1),
  nom      text not null check (nom = 'production'),
  pose_le  timestamptz not null default now(),
  pose_par text not null default current_user
);
alter table profil_de_la_base enable row level security;
revoke all on table profil_de_la_base from public, anon, authenticated;
grant select on table profil_de_la_base to service_role;

create or replace function _profil_immuable() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'le profil de la base ne se change pas'
    using detail = 'une base de production le reste ; une autre se monte sur un projet neuf';
end $$;
drop trigger if exists profil_immuable on profil_de_la_base;
create trigger profil_immuable before update or delete on profil_de_la_base
  for each row execute function _profil_immuable();
drop trigger if exists profil_immuable_vider on profil_de_la_base;
create trigger profil_immuable_vider before truncate on profil_de_la_base
  for each statement execute function _profil_immuable();

create or replace function _en_production() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profil_de_la_base where nom = 'production')
$$;

-- ───────────────────────────── 2. les gardes ───────────────────────────────
-- SECURITY DEFINER : elles lisent le profil quel que soit le rôle qui écrit.

-- Aucune dotation : _doter, admin_doter, _doter_les_robots et les compléments
-- de 0026 écrivent tous ici d'abord — la transaction entière tombe.
create or replace function _garde_dotation_production() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if _en_production() then
    raise exception 'argent de test refusé : cette base est la production'
      using detail = 'aucune dotation, aucun robot, aucune démo sur la production (0041)';
  end if;
  return new;
end $$;
drop trigger if exists dotations_beta_garde_production on dotations_beta;
create trigger dotations_beta_garde_production before insert on dotations_beta
  for each row execute function _garde_dotation_production();

-- Aucun robot, aucun compte de test. Une insertion est IGNORÉE (pas refusée) :
-- 0023 rejouée sur la production (« on conflict do nothing ») ne doit pas
-- casser le passage. Changer le genre d'un compte, lui, est refusé.
create or replace function _garde_robot_production() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not _en_production() then return new; end if;
  if tg_table_name = 'comptes' then
    if new.genre = 'client' then return new; end if;
    if tg_op = 'UPDATE' then
      raise exception 'argent de test refusé : cette base est la production'
        using detail = 'un compte de production reste un compte client';
    end if;
  end if;
  raise notice '0041 : % ignoré sur la production', tg_table_name;
  return null;
end $$;
drop trigger if exists robots_garde_production on robots;
create trigger robots_garde_production before insert on robots
  for each row execute function _garde_robot_production();
drop trigger if exists comptes_garde_production on comptes;
create trigger comptes_garde_production before insert or update of genre on comptes
  for each row execute function _garde_robot_production();

-- Aucun terminal de démo. Le nom de ce déclencheur se range APRÈS
-- terminal_demo_par_son_nom : un terminal « totem-demo » est déjà démo ici.
create or replace function _garde_terminal_production() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.demo and _en_production() then
    raise exception 'terminal de démo refusé : cette base est la production'
      using detail = 'la démo de TOTEM vit sur la bêta ; un boîtier de production a son propre nom';
  end if;
  return new;
end $$;
drop trigger if exists terminaux_garde_production on terminaux;
create trigger terminaux_garde_production before insert or update of demo on terminaux
  for each row execute function _garde_terminal_production();

-- La bêta, les robots, le réseau d'essai et la démo ne se rallument pas.
create or replace function _garde_parametre_production() returns trigger
language plpgsql security definer set search_path = public as $$
declare v jsonb := new.valeur; v_refus text;
begin
  if not _en_production() then return new; end if;
  -- une migration rejouée (« on conflict do nothing ») ne change rien : on la laisse passer
  if tg_op = 'INSERT' and exists (select 1 from parametres where cle = new.cle) then return new; end if;
  v_refus := case new.cle
    when 'beta' then case
      when coalesce((v ->> 'actif')::boolean, false) then 'la bêta ne s''allume pas'
      when coalesce((v #>> '{dotation,XAFe}')::numeric, 0) <> 0 or coalesce((v #>> '{dotation,USDT}')::numeric, 0) <> 0 then 'aucune dotation'
    end
    when 'robots' then case when coalesce((v ->> 'actif')::boolean, false) then 'pas de robots' end
    -- absent, « essai » est refusé : la production le dit
    when 'chaine' then case when coalesce((v ->> 'essai')::boolean, true) then 'chaine.essai doit valoir false' end
    when 'demo_totem' then case when v ->> 'reveil' is not null then 'pas de démo TOTEM' end
  end;
  if v_refus is not null then
    raise exception 'argent de test refusé : cette base est la production'
      using detail = format('« %s » : %s', new.cle, v_refus);
  end if;
  return new;
end $$;
drop trigger if exists parametres_garde_production on parametres;
create trigger parametres_garde_production before insert or update of valeur on parametres
  for each row execute function _garde_parametre_production();

-- ───────────────────────────── 3. ce que la base a vécu ────────────────────
-- Une base qui a déjà servi ne devient jamais la production. Ne regarde ni
-- cours_externes ni parite_releves : une base neuve peut y écrire (0022).
create or replace function _ce_que_la_base_a_vecu() returns text[]
language plpgsql stable security definer set search_path = public as $$
declare v text[] := '{}'; t text; v_oui boolean;
begin
  if to_regclass('auth.users') is not null then
    execute 'select exists (select 1 from auth.users)' into v_oui;
    if v_oui then v := array_append(v, 'auth.users'); end if;
  end if;
  if exists (select 1 from comptes where not maison and genre = 'client') then v := array_append(v, 'comptes (clients)'); end if;
  foreach t in array array['administrateurs', 'administrateurs_invites', 'ecritures', 'soldes', 'emissions', 'reserve_chaine',
    'dotations_beta', 'depots', 'depot_declarations', 'depot_paiements', 'entrees_retenues', 'remboursements', 'sorties',
    'sorties_constatees', 'commandes', 'messages_sortants', 'ordres', 'executions', 'devis_rapides', 'retraits_crypto',
    'transferts_crypto', 'adresses_crypto', 'adresses_libres', 'chaine_mouvements_jeton', 'terminaux', 'floats',
    'soldes_floats', 'numeros', 'notifications', 'journal_admin', 'signalements'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select exists (select 1 from public.%I)', t) into v_oui;
      if v_oui then v := array_append(v, t); end if;
    end if;
  end loop;
  if jsonb_typeof(parametre('chaine') -> 'bep20') = 'object' or jsonb_typeof(parametre('chaine') -> 'trc20') = 'object' then
    v := array_append(v, 'parametres.chaine (un contrat déjà posé)');
  end if;
  if to_regclass('vault.secrets') is not null then
    execute $q$select exists (select 1 from vault.secrets where name in ('essai_graine', 'essai_admin_cle', 'veilleur_jeton'))$q$ into v_oui;
    if v_oui then v := array_append(v, 'vault.secrets'); end if;
  end if;
  return v;
end $$;

-- ───────────────────────────── 4. les constats ─────────────────────────────
create or replace function _constats_du_profil(p_neuve boolean) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_refus text[] := '{}'; v_avert text[] := '{}'; v_jobs text[] := '{}'; v_oui boolean; t text; x text;
  v_beta jsonb := coalesce(parametre('beta'), '{}'); v_chaine jsonb := coalesce(parametre('chaine'), '{}');
begin
  if not _en_production() then v_refus := v_refus || 'la base n''est pas en production (profil_de_la_base vide)'::text; end if;
  if coalesce((v_beta ->> 'actif')::boolean, true) then v_refus := v_refus || 'beta.actif n''est pas false'::text; end if;
  if coalesce((v_beta #>> '{dotation,XAFe}')::numeric, 0) <> 0 or coalesce((v_beta #>> '{dotation,USDT}')::numeric, 0) <> 0 then
    v_refus := v_refus || 'une dotation de bêta est encore réglée'::text;
  end if;
  if coalesce((parametre('robots') ->> 'actif')::boolean, false) then v_refus := v_refus || 'robots.actif est vrai'::text; end if;
  if coalesce((v_chaine ->> 'essai')::boolean, true) then v_refus := v_refus || 'chaine.essai n''est pas false'::text; end if;
  if parametre('demo_totem') ->> 'reveil' is not null then v_refus := v_refus || 'demo_totem.reveil est posé'::text; end if;
  if exists (select 1 from terminaux where demo) then v_refus := v_refus || 'un terminal de démo existe'::text; end if;
  if exists (select 1 from dotations_beta) or exists (select 1 from emissions where source_table = 'dotations_beta') then
    v_refus := v_refus || 'de l''argent de test a été doté'::text;
  end if;
  if exists (select 1 from robots r2 where exists (select 1 from ecritures e where e.compte_id = r2.compte_id)) then
    v_refus := v_refus || 'un robot a de l''activité : il ne s''efface pas, la base ne devient pas la production'::text;
  elsif exists (select 1 from robots) or exists (select 1 from comptes where genre <> 'client') then
    v_refus := v_refus || 'un robot ou un compte de test existe'::text;
  end if;
  foreach t in array array['comptes_dotation_beta', 'depots_pendant_la_beta', 'sorties_reveiller_totem_demo'] loop
    if exists (select 1 from pg_trigger where tgname = t and not tgisinternal) then
      v_refus := v_refus || format('le déclencheur de bêta ou de démo %s est encore là', t);
    end if;
  end loop;
  foreach t in array array['dotations_beta_garde_production', 'robots_garde_production', 'comptes_garde_production',
                           'terminaux_garde_production', 'parametres_garde_production', 'profil_immuable'] loop
    if not exists (select 1 from pg_trigger where tgname = t and not tgisinternal) then
      v_refus := v_refus || format('la garde %s manque', t);
    end if;
  end loop;
  if to_regnamespace('cron') is not null and to_regclass('cron.job') is not null then
    execute 'select coalesce(array_agg(jobname order by jobname), ''{}'') from cron.job' into v_jobs;
    execute $q$select exists (select 1 from cron.job where jobname in ('glisil-robots', 'glisil-menage-robots')
                                or command ~ '(tourner_les_robots|menage_des_robots|_doter)')$q$ into v_oui;
    if v_oui then v_refus := v_refus || 'une tâche pg_cron des robots est encore planifiée'::text; end if;
    foreach t in array array['xafe-expirer-depots', 'glisil-rapprocher', 'glisil-cours'] loop
      if not (t = any (v_jobs)) then v_avert := v_avert || format('la tâche pg_cron %s manque', t); end if;
    end loop;
  else
    v_avert := v_avert || 'pg_cron absent : rien ne tourne de soi-même (dépôts expirés, parité, cours)'::text;
  end if;
  if to_regclass('vault.secrets') is not null then
    execute $q$select exists (select 1 from vault.secrets where name in ('essai_graine', 'essai_admin_cle'))$q$ into v_oui;
    if v_oui then v_refus := v_refus || 'un secret d''essai est au coffre (essai_graine ou essai_admin_cle)'::text; end if;
    execute $q$select count(*) = 2 from vault.secrets where name in ('veilleur_url', 'veilleur_jeton')$q$ into v_oui;
    if not v_oui then v_avert := v_avert || 'coffre : veilleur_url ou veilleur_jeton manque'::text; end if;
  else
    v_avert := v_avert || 'coffre (Vault) absent'::text;
  end if;
  if p_neuve then
    foreach x in array _ce_que_la_base_a_vecu() loop v_refus := v_refus || ('la base a déjà vécu : ' || x); end loop;
  end if;

  if to_regnamespace('net') is null then v_avert := v_avert || 'pg_net absent : le veilleur et les courriels ne se réveillent pas'::text; end if;
  if to_regprocedure('extensions.http_get(character varying)') is null then
    v_avert := v_avert || 'l''extension http manque : pas de cours de référence (Database → Extensions → http)'::text;
  end if;
  if exists (select 1 from jsonb_each(coalesce(parametre('paliers'), '{}')) p where jsonb_typeof(p.value) <> 'null') then
    v_avert := v_avert || 'un palier a un plafond'::text;
  end if;
  if exists (select 1 from operateurs where plafond_par_transfert is not null or plafond_jour is not null) then
    v_avert := v_avert || 'un opérateur a un plafond'::text;
  end if;
  if coalesce((parametre('numeros') ->> 'verification_sms')::boolean, false) then v_avert := v_avert || 'numeros.verification_sms est vrai'::text; end if;
  if coalesce(parametre('sortie') ->> 'mode', 'totem') <> 'manuel' then v_avert := v_avert || 'sortie.mode n''est pas « manuel »'::text; end if;
  if not coalesce((parametre('depot') ->> 'declaration_complete')::boolean, false) then
    v_avert := v_avert || 'depot.declaration_complete est faux'::text;
  end if;
  if coalesce(parametre('continuite') ->> 'mode', 'exiger') <> 'exiger' then
    v_avert := v_avert || 'la garde des soldes (continuite.mode) n''exige pas'::text;
  end if;
  if parametre('parite') ->> 'alerte_numero' is not null then
    v_avert := v_avert || 'parite.alerte_numero est lisible par tout client connecté'::text;
  end if;
  for x in select k from jsonb_object_keys(v_chaine) k
            where jsonb_typeof(v_chaine -> k) = 'object' and jsonb_typeof(v_chaine -> k -> 'noeud') = 'string' loop
    v_avert := v_avert || format('chaine.%s.noeud est dans les paramètres (lisibles par tout client) : il va dans les secrets des fonctions', x);
  end loop;

  return jsonb_build_object(
    'profil', case when _en_production() then 'production' end,
    'refus', to_jsonb(v_refus), 'avertissements', to_jsonb(v_avert),
    'etat', jsonb_build_object(
      'crypto', jsonb_build_object('depots_ouverts', coalesce((parametre('crypto') ->> 'depots_ouverts')::boolean, true),
                                   'retraits_ouverts', coalesce((parametre('crypto') ->> 'retraits_ouverts')::boolean, false)),
      'sortie', jsonb_build_object('mode', coalesce(parametre('sortie') ->> 'mode', 'totem'),
                                   'ouvertes', coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true)),
      'reseaux_actifs', coalesce((select jsonb_agg(id order by ordre) from reseaux where actif), '[]'),
      'reseaux_configures', coalesce((select jsonb_agg(id order by ordre) from reseaux where _reseau_configure(id)), '[]'),
      'taches', to_jsonb(v_jobs)));
end $$;

create or replace function verifier_le_profil_production(p_neuve boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb := _constats_du_profil(p_neuve);
begin
  if jsonb_array_length(c -> 'refus') > 0 then
    raise exception 'le profil de production ne tient pas'
      using detail = (select string_agg(x, ' · ') from jsonb_array_elements_text(c -> 'refus') x);
  end if;
  return c || '{"ok": true}'::jsonb;
end $$;

-- ───────────────────────────── 5. tenir et poser ───────────────────────────
-- Re-tient le profil : ce que 0021, 0023 et 0032 reposent à chaque passage s'en va.
-- Un robot qui a de l'activité ne s'efface jamais : le constat tombe alors, bruyamment.
create or replace function _tenir_le_profil_production() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not _en_production() then raise exception 'la base n''est pas en production'; end if;
  drop trigger if exists comptes_dotation_beta on comptes;
  drop trigger if exists depots_pendant_la_beta on depots;
  drop trigger if exists sorties_reveiller_totem_demo on sorties;
  if to_regnamespace('cron') is not null and to_regclass('cron.job') is not null then
    execute $q$select cron.unschedule(jobid) from cron.job
                where jobname in ('glisil-robots', 'glisil-menage-robots') or command ~ '(tourner_les_robots|menage_des_robots|_doter)'$q$;
  end if;
  delete from robots r where not exists (select 1 from ecritures e where e.compte_id = r.compte_id);
  delete from comptes c where c.genre <> 'client' and not c.maison
     and not exists (select 1 from robots r where r.compte_id = c.id)
     and not exists (select 1 from ecritures e where e.compte_id = c.id)
     and not exists (select 1 from soldes s where s.compte_id = c.id)
     and not exists (select 1 from ordres o where o.compte_id = c.id);
  update robots_etat set derive = 0, tours = 0, dernier_tour = null, dernier_choc = null, bilan = null where id = 1;
end $$;

create or replace function _installer_le_profil_production() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_vecu text[];
begin
  if _en_production() then
    perform _tenir_le_profil_production();
    return verifier_le_profil_production(false);
  end if;
  v_vecu := _ce_que_la_base_a_vecu();
  if cardinality(v_vecu) > 0 then
    raise exception 'cette base a déjà vécu : elle ne devient pas la production'
      using detail = array_to_string(v_vecu, ', '), hint = 'la production se monte sur un projet neuf (docs/PRODUCTION.md)';
  end if;
  -- le profil d'abord : la garde des paramètres juge ce qui suit
  insert into profil_de_la_base (nom) values ('production');
  update parametres set valeur = '{"actif": false, "depots_reels": true, "message": null, "message_en": null, "dotation": {"XAFe": 0, "USDT": 0}}'
   where cle = 'beta';
  update parametres set valeur = valeur || '{"actif": false}' where cle = 'robots';
  update parametres set valeur = '{"essai": false, "bep20": null, "trc20": null}' where cle = 'chaine';
  update parametres set valeur = '{"reveil": null}' where cle = 'demo_totem';
  -- les sorties : manuelles, prouvées par le SMS de la puce ; le propriétaire paie seul ; pas de forçage
  update parametres set valeur = valeur || '{"ouvertes": true, "mode": "manuel", "seuil_deux_personnes": null, "forcage": false}' where cle = 'sortie';
  -- la crypto s'ouvre après l'essai de bout en bout (docs/PRODUCTION.md) ; frais et confirmations gardés
  update parametres set valeur = valeur || '{"retraits_ouverts": false, "depots_ouverts": false}' where cle = 'crypto';
  update parametres set valeur = '{"0": null, "1": null, "2": null}' where cle = 'paliers';
  update parametres set valeur = '{"verification_sms": false, "delai_heures": 0}' where cle = 'numeros';
  update parametres set valeur = valeur || '{"declaration_complete": true}' where cle = 'depot';
  update parametres set valeur = valeur || '{"alerte_numero": null}' where cle = 'parite';
  update parametres set valeur = valeur || '{"mode": "exiger"}' where cle = 'continuite';
  update operateurs set plafond_par_transfert = null, plafond_jour = null;
  -- Tron s'ouvre plus tard (admin_activer_reseau) ; le réseau maison ne se ferme pas
  update reseaux set actif = false where id <> _reseau_de_la_reserve();
  perform _tenir_le_profil_production();
  return verifier_le_profil_production(true);
end $$;

-- L'écran de l'équipe : le constat, en lecture.
create or replace function admin_profil() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('voir');
  return _constats_du_profil(false);
end $$;

-- ───────────────────────────── 6. les droits ───────────────────────────────
revoke all on function _profil_immuable(), _en_production(), _garde_dotation_production(), _garde_robot_production(),
  _garde_terminal_production(), _garde_parametre_production(), _ce_que_la_base_a_vecu(), _constats_du_profil(boolean),
  verifier_le_profil_production(boolean), _tenir_le_profil_production(), _installer_le_profil_production(), admin_profil()
  from public, anon, authenticated;
grant execute on function verifier_le_profil_production(boolean) to service_role;
grant execute on function admin_profil() to authenticated;

-- ───────────────────────────── 7. la décision ──────────────────────────────
do $$
declare v_annonce text := nullif(current_setting('glisil.profil', true), '');
begin
  -- une faute de frappe ne devient jamais un passage silencieux
  if v_annonce is not null and v_annonce <> 'production' then
    raise exception 'profil annoncé inconnu : %', v_annonce using detail = 'seul « production » existe';
  end if;
  if _en_production() then
    perform _tenir_le_profil_production();
    perform verifier_le_profil_production(false);
    raise notice '0041 : profil de production tenu';
  elsif v_annonce = 'production' then
    perform _installer_le_profil_production();
    raise notice '0041 : profil de production posé';
  else
    raise notice '0041 : base hors production (bêta, harnais) : rien ne change';
  end if;
end $$;
