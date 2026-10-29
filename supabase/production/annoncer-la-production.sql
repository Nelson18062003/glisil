-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  ANNONCER LA PRODUCTION — une fois, sur un projet NEUF, en tête de la  ║
-- ║  commande d'installation (docs/PRODUCTION.md). Ce n'est pas une        ║
-- ║  migration : il pose glisil.profil = 'production' pour la session, et  ║
-- ║  0041, plus loin dans la même transaction, pose le profil.             ║
-- ║                                                                        ║
-- ║  psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction \      ║
-- ║    -f supabase/production/annoncer-la-production.sql \                 ║
-- ║    -f migrations/<AAAAMMJJ>_consolidated.sql \                         ║
-- ║    -f supabase/production/verifier-la-production.sql                   ║
-- ║                                                                        ║
-- ║  Les migrations suivantes, sur la production : la même commande SANS   ║
-- ║  ce fichier.                                                           ║
-- ╚════════════════════════════════════════════════════════════════════════╝
\set ON_ERROR_STOP on
select set_config('glisil.profil', 'production', false);
select set_config('statement_timeout', '0', true);
select set_config('lock_timeout', '30s', true);
do $$
begin
  if to_regclass('public.parametres') is not null then
    raise exception 'cette base a déjà un schéma : on n''annonce la production que sur un projet neuf'
      using hint = 'pour relire les migrations sur la production, lancer le consolidé SANS ce fichier';
  end if;
end $$;
