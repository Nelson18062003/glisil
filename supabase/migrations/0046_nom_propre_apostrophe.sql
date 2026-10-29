-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0046 · « D'Almeida », sur la vraie base aussi                 ║
-- ║                                                                        ║
-- ║  _nom_propre (0009) promettait « d'almeida » → « D'Almeida ». Sur un   ║
-- ║  PostgreSQL à la collation C, initcap coupe le mot à l'apostrophe ;    ║
-- ║  sur celui de Supabase (collation ICU, en_US), l'apostrophe fait       ║
-- ║  partie du mot, et l'on obtenait « D'almeida », « O'neil ». Le         ║
-- ║  harnais du moteur ne pouvait pas le voir : c'est la vraie pile        ║
-- ║  (supabase/epreuve/eprouver.sh, scénario 11.26) qui l'a trouvé.        ║
-- ║  Chaque morceau entre deux apostrophes reçoit maintenant sa capitale,  ║
-- ║  quelle que soit la collation. Rien d'autre ne change.                 ║
-- ╚════════════════════════════════════════════════════════════════════════╝

create or replace function _nom_propre(p text) returns text language plpgsql immutable set search_path = public, extensions, pg_temp as $$
declare v text := regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g');
begin
  v := replace(v, '’', '''');
  if length(v) < 2 or length(v) > 60 then return null; end if;
  if v !~ '^[[:alpha:]]+([ ''.-]+[[:alpha:]]+)*\.?$' then return null; end if;
  return (select string_agg(initcap(lower(x)), '''' order by n) from unnest(string_to_array(v, '''')) with ordinality t(x, n));
end $$;
revoke all on function _nom_propre(text) from public, anon, authenticated;
