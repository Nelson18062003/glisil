-- LE JETON DES SCÉNARIOS, SUR LA VRAIE PILE.
--
-- Sur le PostgreSQL nu du harnais du moteur, moteur/auth.sql fabrique le jeton
-- depuis xafe.compte, xafe.aal, xafe.amr et xafe.session : un jeton FORT
-- (aal2, mot de passe puis TOTP à l'instant) dès qu'un compte est posé, que
-- xafe.aal, xafe.amr et xafe.session font faiblir à la demande. La vraie pile,
-- elle, lit le jeton dans request.jwt.claims, comme PostgREST le pose :
-- eprouver.sh réécrit donc chaque geste des scénarios sur ces réglages
--   set local xafe.compte = '…';            → call essai.compte('…');
--   set_config('xafe.compte' | 'xafe.aal' | 'xafe.amr' | 'xafe.session', …)
--                                           → essai.jeton('sub' | 'aal' | 'amr' | 'session_id', …)
-- et essai.jeton refait les claims comme moteur/auth.sql les aurait faits.
-- Ce schéma n'existe que dans la base d'épreuve ; il n'est dans aucune migration.
create schema if not exists essai;
create or replace function essai.jeton(p_cle text, p_valeur text, p_local boolean) returns text
language plpgsql set search_path = pg_catalog as $$
declare v_sub text; v_aal text; v_amr text; v_session text;
begin
  -- ce que le scénario a posé, gardé à part comme moteur/auth.sql garde ses réglages
  if p_cle = 'sub' then perform set_config('request.jwt.claim.sub', coalesce(p_valeur, ''), p_local);
  else perform set_config('essai.' || p_cle, coalesce(p_valeur, ''), p_local); end if;
  v_sub := nullif(current_setting('request.jwt.claim.sub', true), '');
  if v_sub is null then perform set_config('request.jwt.claims', '', p_local); return p_valeur; end if;
  v_aal := coalesce(nullif(current_setting('essai.aal', true), ''), 'aal2');
  v_amr := nullif(current_setting('essai.amr', true), '');
  v_session := coalesce(nullif(current_setting('essai.session_id', true), ''), md5(v_sub)::uuid::text);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_sub, 'role', 'authenticated', 'aal', v_aal, 'session_id', v_session,
    'amr', coalesce(v_amr::jsonb, jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint),
                                                    jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint))))::text, p_local);
  return p_valeur;
end $$;
create or replace procedure essai.compte(p_compte text) language plpgsql set search_path = pg_catalog as $$
begin perform essai.jeton('sub', p_compte, true); end $$;
grant usage on schema essai to anon, authenticated;
grant execute on function essai.jeton(text, text, boolean) to anon, authenticated;
grant execute on procedure essai.compte(text) to anon, authenticated;
