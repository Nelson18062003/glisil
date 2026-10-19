-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0025 · le graphique : des années d'historique, à la bougie   ║
-- ║                                                                        ║
-- ║  Le graphique ne montrait que quelques heures d'échanges, en grosses   ║
-- ║  bougies sans date. Il lit maintenant deux sources, à la suite :       ║
-- ║    · AVANT le premier échange de Glisil : le cours de RÉFÉRENCE du     ║
-- ║      dollar, 655,957 / (EUR/USD), jour par jour depuis 2016 (Banque    ║
-- ║      centrale européenne, comme 0022). C'est un vrai historique — le   ║
-- ║      dollar a valu 525 XAF en 2021 et 683 en 2022 —, et il est dit     ║
-- ║      comme tel : chaque bougie porte sa source, « reference » ;        ║
-- ║    · À PARTIR du premier échange : les échanges du carnet, « marche ». ║
-- ║                                                                        ║
-- ║  bougies(intervalle, avant, n) rend n bougies datées, de la plus       ║
-- ║  ancienne à la plus récente, toutes avant « avant » : l'écran remonte  ║
-- ║  le temps page par page quand on fait glisser le graphique vers la     ║
-- ║  gauche. Les jours, semaines et mois se coupent à l'heure de Douala.   ║
-- ╚════════════════════════════════════════════════════════════════════════╝

create table if not exists cours_historiques (
  jour     date primary key,
  eur_usd  numeric(12,6) not null check (eur_usd between 0.5 and 2.5),
  usd_xaf  numeric(12,4) not null,
  source   text not null default 'bce'
);
alter table cours_historiques enable row level security;

-- Un jour de cours : posé une fois, corrigé si la source le corrige
create or replace function _noter_cours_du_jour(p_jour date, p_eur_usd numeric, p_source text) returns void
language sql set search_path = public as $$
  insert into cours_historiques (jour, eur_usd, usd_xaf, source)
  values (p_jour, p_eur_usd, round(_xaf_par_euro() / p_eur_usd, 4), p_source)
  on conflict (jour) do update set eur_usd = excluded.eur_usd, usd_xaf = excluded.usd_xaf, source = excluded.source
$$;

-- Remplir l'historique, année par année (la BCE publie chaque jour ouvré).
-- Sans l'extension http (une base d'essai), rien : le graphique commence au
-- premier échange.
create or replace function remplir_l_historique(p_depuis int default 2016) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_annee int; v_statut int; v_corps text; v_j jsonb; v_jour text; n int := 0; v_err text;
begin
  if to_regprocedure('extensions.http_get(character varying)') is null then
    return jsonb_build_object('jours', 0, 'erreur', 'extension http absente');
  end if;
  for v_annee in p_depuis .. extract(year from now())::int loop
    begin
      execute $q$select status, content from extensions.http_get($1)$q$
        into v_statut, v_corps
        using format('https://api.frankfurter.dev/v1/%s-01-01..%s-12-31?from=EUR&to=USD', v_annee, v_annee);
      if v_statut <> 200 then v_err := coalesce(v_err || ' ; ', '') || format('%s : HTTP %s', v_annee, v_statut); continue; end if;
      v_j := v_corps::jsonb -> 'rates';
      for v_jour in select jsonb_object_keys(v_j) loop
        if (v_j -> v_jour ->> 'USD')::numeric between 0.5 and 2.5 then
          perform _noter_cours_du_jour(v_jour::date, (v_j -> v_jour ->> 'USD')::numeric, 'bce');
          n := n + 1;
        end if;
      end loop;
    exception when others then v_err := coalesce(v_err || ' ; ', '') || format('%s : %s', v_annee, left(sqlerrm, 120));
    end;
  end loop;
  return jsonb_build_object('jours', n, 'erreur', v_err);
end $$;

-- Chaque cours posé par le relevé de l'heure (0022) entre aussi dans l'historique
create or replace function _cours_dans_l_historique() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.pose and new.eur_usd is not null and new.source <> 'equipe' then
    perform _noter_cours_du_jour(coalesce(new.date_source, (new.releve_le at time zone 'Africa/Douala')::date), new.eur_usd, new.source);
  end if;
  return null;
end $$;
drop trigger if exists cours_externes_historique on cours_externes;
create trigger cours_externes_historique after insert on cours_externes for each row execute function _cours_dans_l_historique();

-- ──────────────────────────────── les bougies ──────────────────────────────
-- Le début d'une bougie, à l'heure de Douala pour les jours et au-delà.
create or replace function _debut_de_bougie(p_t timestamptz, p_intervalle text) returns timestamptz
language sql immutable set search_path = public as $$
  select case p_intervalle
    when '1m'  then date_bin(interval '1 minute',   p_t, timestamptz '2000-01-03 00:00+01')
    when '5m'  then date_bin(interval '5 minutes',  p_t, timestamptz '2000-01-03 00:00+01')
    when '15m' then date_bin(interval '15 minutes', p_t, timestamptz '2000-01-03 00:00+01')
    when '30m' then date_bin(interval '30 minutes', p_t, timestamptz '2000-01-03 00:00+01')
    when '1h'  then date_bin(interval '1 hour',     p_t, timestamptz '2000-01-03 00:00+01')
    when '4h'  then date_bin(interval '4 hours',    p_t, timestamptz '2000-01-03 00:00+01')
    when '1j'  then date_trunc('day',   p_t at time zone 'Africa/Douala') at time zone 'Africa/Douala'
    when '1s'  then date_trunc('week',  p_t at time zone 'Africa/Douala') at time zone 'Africa/Douala'
    when '1M'  then date_trunc('month', p_t at time zone 'Africa/Douala') at time zone 'Africa/Douala'
  end
$$;

-- La durée d'une bougie, pour borner ce qu'on lit (une page ne relit pas tout le carnet)
create or replace function _duree_de_bougie(p_intervalle text) returns interval
language sql immutable set search_path = public as $$
  select case p_intervalle
    when '1m' then interval '1 minute' when '5m' then interval '5 minutes' when '15m' then interval '15 minutes'
    when '30m' then interval '30 minutes' when '1h' then interval '1 hour' when '4h' then interval '4 hours'
    when '1j' then interval '1 day' when '1s' then interval '7 days' when '1M' then interval '31 days'
  end
$$;

create or replace function bougies(p_intervalle text, p_avant timestamptz default null, p_n int default 300) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_n       int := least(greatest(coalesce(p_n, 300), 1), 1000);
  v_avant   timestamptz := coalesce(p_avant, now() + interval '1 second');
  v_paire   text := parametre('marche') ->> 'paire';
  v_debut   timestamptz;      -- le premier échange de Glisil
  v_borne   timestamptz;      -- on ne lit pas plus loin que n bougies (et un peu de marge) en arrière
  v_res     jsonb;
  v_plus    boolean;
begin
  if p_intervalle not in ('1m', '5m', '15m', '30m', '1h', '4h', '1j', '1s', '1M') then
    raise exception 'intervalle invalide' using detail = '1m, 5m, 15m, 30m, 1h, 4h, 1j, 1s ou 1M';
  end if;
  select min(cree_le) into v_debut from executions where paire = v_paire;
  v_borne := _debut_de_bougie(v_avant, p_intervalle) - _duree_de_bougie(p_intervalle) * (v_n * 2 + 2);

  with marche as (
    select _debut_de_bougie(e.cree_le, p_intervalle) t,
           (array_agg(e.prix order by e.cree_le, e.id))[1] o, max(e.prix) h, min(e.prix) l,
           (array_agg(e.prix order by e.cree_le desc, e.id desc))[1] c, sum(e.quantite) v
      from executions e
     where e.paire = v_paire and e.cree_le < v_avant and e.cree_le >= v_borne
     group by 1
  ),
  -- le cours de référence, jour par jour, AVANT le premier échange (les jours et au-delà seulement)
  jours as (
    select (h.jour::timestamp at time zone 'Africa/Douala') t,
           coalesce(lag(h.usd_xaf) over (order by h.jour), h.usd_xaf) o, h.usd_xaf c
      from cours_historiques h
     where p_intervalle in ('1j', '1s', '1M')
       and (v_debut is null or h.jour < (v_debut at time zone 'Africa/Douala')::date)
       and (h.jour::timestamp at time zone 'Africa/Douala') < v_avant
       and (h.jour::timestamp at time zone 'Africa/Douala') >= v_borne - interval '31 days'
  ),
  reference as (
    select _debut_de_bougie(j.t, p_intervalle) t,
           (array_agg(j.o order by j.t))[1] o,
           max(greatest(j.o, j.c)) h, min(least(j.o, j.c)) l,
           (array_agg(j.c order by j.t desc))[1] c
      from jours j group by 1
  ),
  tout as (
    select t, round(o, 2) o, round(h, 2) h, round(l, 2) l, round(c, 2) c, v, 'marche' source from marche
    union all
    select t, round(o, 2), round(h, 2), round(l, 2), round(c, 2), 0, 'reference' from reference
     where t < v_avant and not exists (select 1 from marche m where m.t = reference.t)
  ),
  page as (select * from tout order by t desc limit v_n)
  select coalesce(jsonb_agg(jsonb_build_object('t', t, 'o', o, 'h', h, 'l', l, 'c', c, 'v', v, 'source', source) order by t), '[]'::jsonb)
    into v_res from page;

  -- reste-t-il quelque chose plus loin dans le passé ?
  v_plus := exists (select 1 from executions where paire = v_paire and cree_le < least(v_avant, coalesce((v_res -> 0 ->> 't')::timestamptz, v_avant)))
         or (p_intervalle in ('1j', '1s', '1M') and exists (
               select 1 from cours_historiques
                where (jour::timestamp at time zone 'Africa/Douala') < least(v_avant, coalesce((v_res -> 0 ->> 't')::timestamptz, v_avant))));
  return jsonb_build_object('intervalle', p_intervalle, 'bougies', v_res, 'plus_ancien', v_plus,
                            'debut_marche', v_debut, 'premier_cours', (select min(jour) from cours_historiques));
end $$;

-- l'historique, tout de suite, là où le réseau existe
do $$
begin
  if to_regprocedure('extensions.http_get(character varying)') is not null and not exists (select 1 from cours_historiques where jour < '2017-01-01') then
    raise notice 'historique du cours : %', remplir_l_historique(2016);
  end if;
exception when others then raise notice 'historique du cours : %', sqlerrm;
end $$;

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on table cours_historiques from public, anon, authenticated;
grant all on table cours_historiques to service_role;
revoke all on function _noter_cours_du_jour(date, numeric, text), remplir_l_historique(int), _cours_dans_l_historique(),
  _debut_de_bougie(timestamptz, text), _duree_de_bougie(text), bougies(text, timestamptz, int) from public, anon, authenticated;
-- le graphique se lit avec un compte, comme les chandelles et la cotation (11.1 : anon n'exécute rien)
grant execute on function bougies(text, timestamptz, int) to authenticated;
