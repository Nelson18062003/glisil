-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  XAFe Exchange · 0007 · la configuration du veilleur, dans la base     ║
-- ║  Les réglages qui ne sont pas des secrets (nœuds, contrats, froid,     ║
-- ║  confirmations) vivent dans les paramètres ; le jeton du réveil dans   ║
-- ║  le coffre. La GRAINE n'est lue dans le coffre que sur un réseau       ║
-- ║  d'ESSAI ; en production, c'est un secret de la fonction, que le       ║
-- ║  propriétaire saisit lui-même et que la base ne voit jamais.           ║
-- ╚════════════════════════════════════════════════════════════════════════╝

insert into parametres (cle, valeur) values
  ('chaine', '{"essai": true, "bep20": null, "trc20": null}')
on conflict (cle) do nothing;

-- Pour la fonction « veilleur » seulement (clé de service). Ce qu'elle rend :
--   reseaux  les réglages de chaque réseau, tels que posés dans « chaine » ;
--   jeton    le jeton du réveil (le même que lit pg_cron) ;
--   essai    vrai sur un réseau d'essai : alors seulement, la graine et la
--            clé admin d'essai sont lues dans le coffre.
create function chaine_configuration() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := parametre('chaine'); v_essai boolean; v_secrets jsonb := '{}'::jsonb;
begin
  v_essai := coalesce((v ->> 'essai')::boolean, false);
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb) from vault.decrypted_secrets
                where name in ('veilleur_jeton', 'essai_graine', 'essai_admin_cle')$q$ into v_secrets;
  end if;
  return jsonb_build_object(
    'essai', v_essai,
    'bep20', v -> 'bep20',
    'trc20', v -> 'trc20',
    'jeton', v_secrets ->> 'veilleur_jeton',
    -- jamais hors d'un réseau d'essai : en production la graine n'est pas dans la base
    'graine', case when v_essai then v_secrets ->> 'essai_graine' end,
    'admin_cle_essai', case when v_essai then v_secrets ->> 'essai_admin_cle' end);
end $$;

revoke all on function chaine_configuration() from public, anon, authenticated;
grant execute on function chaine_configuration() to service_role;
