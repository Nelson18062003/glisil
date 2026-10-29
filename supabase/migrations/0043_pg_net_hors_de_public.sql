-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0043 · pg_net hors du schéma public                          ║
-- ║                                                                        ║
-- ║  0006 créait pg_net sans schéma : l'extension s'inscrivait dans        ║
-- ║  « public », ce que le conseiller de sécurité de Supabase signale. Ses ║
-- ║  fonctions vivent dans le schéma « net » quoi qu'il arrive (aucun code ║
-- ║  de Glisil n'appelle autre chose que net.http_post) : on la recrée     ║
-- ║  dans « extensions ». Les requêtes en file depuis moins d'une minute   ║
-- ║  (un réveil du veilleur, un e-mail) se perdent ; le tour suivant les   ║
-- ║  refait — l'e-mail reste dans sa boîte d'envoi jusqu'à l'accusé.      ║
-- ╚════════════════════════════════════════════════════════════════════════╝
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_net' and extnamespace = 'public'::regnamespace) then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
end $$;
