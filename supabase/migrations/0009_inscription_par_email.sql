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
