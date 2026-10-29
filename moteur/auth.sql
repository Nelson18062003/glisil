-- Ce que Supabase pose AVANT nos migrations, imité au plus près (voir
-- verifier-le-moteur.sh). Partagé par les harnais qui montent une base neuve.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema extensions;
create extension pgcrypto with schema extensions;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('xafe.compte', true), '')::uuid
$$;
-- Le jeton (0035) : les claims de la requête si un scénario les pose (comme
-- PostgREST), sinon un jeton FORT fabriqué depuis xafe.compte — aal2, mot de
-- passe puis TOTP à l'instant — pour que les scénarios d'avant gardent leur
-- sens. xafe.aal, xafe.amr et xafe.session le font faiblir à la demande.
create function auth.jwt() returns jsonb language sql stable as $$ select case
  when nullif(current_setting('request.jwt.claims', true), '') is not null then current_setting('request.jwt.claims', true)::jsonb
  when nullif(current_setting('xafe.compte', true), '') is null then null
  else jsonb_build_object('sub', current_setting('xafe.compte', true), 'role', 'authenticated',
    'aal', coalesce(nullif(current_setting('xafe.aal', true), ''), 'aal2'),
    'session_id', coalesce(nullif(current_setting('xafe.session', true), ''), md5(current_setting('xafe.compte', true))::uuid::text),
    'amr', coalesce(nullif(current_setting('xafe.amr', true), '')::jsonb,
      jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint),
                        jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))) end $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
create table auth.users (id uuid primary key, phone text, email text, phone_confirmed_at timestamptz, email_confirmed_at timestamptz,
                         last_sign_in_at timestamptz, encrypted_password text, banned_until timestamptz);
-- les facteurs de GoTrue : lus seulement (la fiche « Sécurité » de l'équipe), jamais écrits par nos migrations
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, factor_type text, status text, created_at timestamptz default now());
