-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  XAFe Exchange · 0006 · le veilleur de chaîne, dans Supabase           ║
-- ║  Le veilleur (chaine/) tourne aussi comme fonction Supabase : pg_cron  ║
-- ║  la réveille chaque minute, un réseau par appel. Rien à héberger.      ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- Un tour à la fois par réseau. Réveillé chaque minute, un tour peut durer
-- plus d'une minute (une transaction à attendre) : sans ce bail, deux tours
-- balaieraient la même adresse, ou enverraient deux fois au froid. Un bail,
-- pas un verrou de session : la fonction parle au moteur par des requêtes
-- HTTP séparées, et un tour qui meurt en route rend la main à l'échéance.
create table chaine_tours (
  reseau  text primary key,
  jusqua  timestamptz not null,
  pris_le timestamptz not null default now()
);
alter table chaine_tours enable row level security;

create function chaine_prendre_tour(p_reseau text, p_secondes int default 300) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_secondes is null or p_secondes < 10 or p_secondes > 3600 then raise exception 'durée de bail invalide'; end if;
  insert into chaine_tours (reseau, jusqua) values (p_reseau, now() + make_interval(secs => p_secondes))
  on conflict (reseau) do update set jusqua = excluded.jusqua, pris_le = now() where chaine_tours.jusqua <= now();
  return found;
end $$;

create function chaine_rendre_tour(p_reseau text) returns void
language sql security definer set search_path = public as $$
  update chaine_tours set jusqua = now() where reseau = p_reseau
$$;

-- Réveiller le veilleur d'un réseau. L'adresse de la fonction et son jeton
-- vivent dans le coffre de Supabase (vault : « veilleur_url », « veilleur_jeton ») :
-- ni dans ce fichier, ni dans la table des tâches. Sans eux, rien ne part.
create function reveiller_veilleur(p_reseau text) returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_jeton text;
begin
  if to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then return; end if;
  execute $q$select (select decrypted_secret from vault.decrypted_secrets where name = 'veilleur_url'),
                    (select decrypted_secret from vault.decrypted_secrets where name = 'veilleur_jeton')$q$ into v_url, v_jeton;
  if v_url is null or v_jeton is null then return; end if;
  execute $q$select net.http_post(url := $1, headers := $2, body := '{}'::jsonb, timeout_milliseconds := 5000)$q$
    using v_url || '?reseau=' || p_reseau, jsonb_build_object('content-type', 'application/json', 'x-veilleur-jeton', v_jeton);
end $$;

-- Ces trois-là : la clé de service et pg_cron seulement (rien pour anon ni authenticated).
revoke all on function chaine_prendre_tour(text, int), chaine_rendre_tour(text), reveiller_veilleur(text) from public, anon, authenticated;
grant execute on function chaine_prendre_tour(text, int), chaine_rendre_tour(text) to service_role;
grant all on table chaine_tours to service_role;

-- Chaque minute, un réveil par réseau. Sur une base sans pg_cron ni pg_net
-- (le harnais), on le dit et on continue.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron ou pg_net absent : le veilleur ne sera pas réveillé sur cette base';
    return;
  end if;
  create extension if not exists pg_cron;
  create extension if not exists pg_net with schema extensions;
  perform cron.unschedule(jobid) from cron.job where jobname in ('xafe-veilleur-bep20', 'xafe-veilleur-trc20');
  perform cron.schedule('xafe-veilleur-bep20', '* * * * *', 'select public.reveiller_veilleur(''bep20'')');
  perform cron.schedule('xafe-veilleur-trc20', '* * * * *', 'select public.reveiller_veilleur(''trc20'')');
end $$;
