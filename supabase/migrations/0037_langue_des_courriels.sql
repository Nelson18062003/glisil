-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0037 · la langue des e-mails                                 ║
-- ║                                                                        ║
-- ║  Les e-mails partaient tous en français. Glisil parle ANGLAIS par      ║
-- ║  défaut ; un client français choisit le français. Le choix vit dans    ║
-- ║  le compte (comptes.langue) et il est recopié dans les métadonnées     ║
-- ║  d'Auth : les gabarits de Supabase (mot de passe oublié,               ║
-- ║  réauthentification) ne lisent QUE celles-là                           ║
-- ║  ({{ if eq .Data.langue "fr" }} … {{ else }} … {{ end }}).             ║
-- ║                                                                        ║
-- ║  1. comptes.langue : « en » ou « fr », « en » par défaut.              ║
-- ║  2. choisir_ma_langue : le client change d'avis, en session forte.     ║
-- ║  3. ouvrir_mon_compte : la langue choisie à l'inscription (passée par  ║
-- ║     signUp dans les métadonnées) devient celle du compte.              ║
-- ║  4. courriel_prendre dit à la fonction « courriel » dans quelle        ║
-- ║     langue écrire ; mon_compte la montre à l'écran.                    ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ───────────────────── 0 · ce qui doit exister chez Supabase ───────────────
-- GoTrue range dans raw_user_meta_data ce que signUp passe en options.data :
-- la colonne existe toujours chez Supabase. Le harnais imite auth.users sans
-- elle ; on l'y ajoute, et SEULEMENT là où elle manque (chez Supabase, aucun
-- ALTER ne part : la table appartient à GoTrue).
do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'auth' and table_name = 'users' and column_name = 'raw_user_meta_data') then
    alter table auth.users add column raw_user_meta_data jsonb;
  end if;
end $$;
-- Le choix se recopie dans les métadonnées : si la base ne peut pas y écrire,
-- on refuse de s'installer plutôt que d'envoyer en silence un e-mail de mot de
-- passe dans la mauvaise langue (même règle que 0036 pour le mot de passe).
do $$ begin
  -- deux appels : avec « select, update » en une fois, un seul des deux suffirait à répondre oui
  if not (has_column_privilege('auth.users', 'raw_user_meta_data', 'select')
          and has_column_privilege('auth.users', 'raw_user_meta_data', 'update')) then
    raise exception 'langue des e-mails : auth.users.raw_user_meta_data illisible ou non modifiable'
      using detail = 'les gabarits d''Auth ne pourraient pas suivre la langue du compte';
  end if;
end $$;

-- ─────────────────────────────── 1 · la colonne ────────────────────────────
alter table comptes add column if not exists langue text not null default 'en'
  constraint comptes_langue_connue check (langue in ('fr', 'en'));

-- Les comptes déjà ouverts : la langue donnée à l'inscription si elle est
-- connue, sinon l'anglais (le défaut de la colonne, déjà posé).
update comptes c set langue = u.raw_user_meta_data ->> 'langue'
  from auth.users u
 where u.id = c.id and u.raw_user_meta_data ->> 'langue' in ('fr', 'en')
   and c.langue is distinct from u.raw_user_meta_data ->> 'langue';

-- La langue d'une personne d'Auth, telle que signUp l'a rangée — ou null si
-- elle n'en a pas donné, ou une qu'on ne sait pas écrire.
create or replace function _langue_d_auth(p_utilisateur uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when u.raw_user_meta_data ->> 'langue' in ('fr', 'en') then u.raw_user_meta_data ->> 'langue' end
    from auth.users u where u.id = p_utilisateur
$$;

-- ──────────────────────────── 2 · choisir sa langue ────────────────────────
-- La session forte, comme tout ce qui touche au compte. Le compte n'est pas
-- exigé : la personne qui n'a pas encore fini son inscription reçoit, elle
-- aussi, des e-mails d'Auth. Les deux écritures vont ensemble : le compte
-- (lu par la boîte d'envoi) et les métadonnées (lues par les gabarits d'Auth).
create or replace function choisir_ma_langue(p_langue text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_langue text := p_langue;
begin
  perform _exiger_aal2();
  if v_uid is null then raise exception 'non connecté'; end if;
  -- à la lettre : « FR » ou « fr  » sont refusés plutôt que devinés
  if v_langue is null or v_langue not in ('fr', 'en') then raise exception 'langue inconnue' using detail = 'fr ou en'; end if;
  update comptes set langue = v_langue where id = v_uid;
  update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('langue', v_langue)
   where id = v_uid;
  return jsonb_build_object('ok', true, 'langue', v_langue);
end $$;

-- ─────────────────────── 3 · le compte montre sa langue ────────────────────
-- Même forme que 0036, une clé de plus : « langue ».
create or replace function _compte_json(c comptes) returns jsonb
language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'entreprise', c.entreprise, 'palier', c.palier,
                            'email', c.email, 'prenom', c.prenom, 'nom_de_famille', c.nom_de_famille,
                            'date_naissance', c.date_naissance, 'ville', c.ville, 'pays', c.pays,
                            'langue', c.langue,
                            'verification_en_cours', c.verification_en_cours,
                            'conditions_version', c.conditions_version, 'conditions_acceptees_le', c.conditions_acceptees_le,
                            'conditions_a_jour', c.maison or c.conditions_version is not distinct from (parametre('conditions') ->> 'version'),
                            'ferme_le', c.ferme_le, 'desactive', c.desactive_le is not null,
                            -- ce qui est déjà entré aujourd'hui : l'écran montre ce qui RESTE du plafond, pas le plafond
                            'entre_du_jour', (select coalesce(sum(montant), 0) from depot_declarations
                                               where compte_id = c.id and etat = 'credite' and credite_le >= debut_du_jour()))
$$;

-- ─────────────────── 4 · ouvrir son compte, dans sa langue ─────────────────
-- 0035 à l'identique, sauf la langue : celle que l'écran d'inscription a
-- passée à signUp, sinon l'anglais.
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

  insert into comptes (id, telephone, email, prenom, nom_de_famille, nom, date_naissance, ville, pays, conditions_version, conditions_acceptees_le, langue)
  values (auth.uid(), v_tel, v_email, v_prenom, v_nom, v_prenom || ' ' || v_nom, p_naissance, v_ville, v_pays, p_conditions, now(),
          coalesce(_langue_d_auth(auth.uid()), 'en'))
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

-- ───────────────── 5 · la boîte d'envoi dit dans quelle langue ─────────────
-- 0036 à l'identique, une clé de plus : « langue ». Celle du compte, lue AU
-- MOMENT d'envoyer (un client qui vient de changer d'avis est entendu même
-- pour un e-mail déjà en file) ; pour une adresse hors des clients (l'équipe),
-- celle que le moteur a posée dans les données, sinon l'anglais.
create or replace function courriel_prendre(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c courriels_a_envoyer; v_email text; v_v verifications; v_langue text;
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
  if c.compte_id is not null then
    v_langue := coalesce((select langue from comptes where id = c.compte_id), _langue_d_auth(c.compte_id), 'en');
  else
    v_langue := case when c.donnees ->> 'langue' in ('fr', 'en') then c.donnees ->> 'langue' else 'en' end;
  end if;
  update courriels_a_envoyer set etat = 'en_cours', pris_le = now(), essais = essais + 1 where id = c.id;
  return jsonb_build_object('id', c.id, 'gabarit', c.gabarit, 'donnees', c.donnees, 'email', v_email, 'langue', v_langue,
                            'idempotence', 'glisil-courriel-' || c.id);
end $$;

-- ─────────────────────────────── 6 · les droits ────────────────────────────
-- create or replace garde les droits de _compte_json, ouvrir_mon_compte et
-- courriel_prendre (0035, 0036) ; seules les deux fonctions neuves sont posées.
revoke all on function _langue_d_auth(uuid), choisir_ma_langue(text) from public, anon, authenticated;
grant execute on function _langue_d_auth(uuid), choisir_ma_langue(text) to service_role;
grant execute on function choisir_ma_langue(text) to authenticated;
