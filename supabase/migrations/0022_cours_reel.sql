-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0022 · le prix de référence relié au vrai dollar              ║
-- ║                                                                        ║
-- ║  Le XAF est arrimé à l'euro : 1 EUR = 655,957 XAF, fixe (BEAC). Le      ║
-- ║  prix du dollar en XAF ne dépend donc que d'un chiffre, le cours        ║
-- ║  EUR/USD, que la Banque centrale européenne publie chaque jour ouvré :  ║
-- ║                                                                        ║
-- ║      1 USD = 655,957 / (EUR/USD) XAF                                    ║
-- ║                                                                        ║
-- ║  Toutes les heures, la base relève ce cours (Frankfurter, qui republie  ║
-- ║  la BCE ; open.er-api.com en secours), calcule le prix d'un USDT en     ║
-- ║  XAFe — avec une PRIME réglable, le marché local payant souvent le      ║
-- ║  dollar plus cher que le cours officiel — et le pose comme prix de      ║
-- ║  référence du marché (marche.prix_reference, 0017).                     ║
-- ║                                                                        ║
-- ║  Ce prix ne remplace pas le marché : la référence reste la moyenne des  ║
-- ║  échanges des cinq dernières minutes quand il y en a (0017). Il sert    ║
-- ║  d'ancre au marché qui démarre, et aux robots de la bêta (0023), qui    ║
-- ║  cotent autour de lui : le prix qu'on voit suit le vrai dollar.         ║
-- ║                                                                        ║
-- ║  Un relevé aberrant ne déplace rien : hors de [0,5 ; 2,5], ou plus de   ║
-- ║  « saut_max » d'écart avec le dernier cours posé, il est noté et        ║
-- ║  refusé. Chaque relevé, posé ou refusé, reste dans cours_externes.      ║
-- ╚════════════════════════════════════════════════════════════════════════╝

insert into parametres (cle, valeur) values ('cours', '{"actif": true, "prime": 0, "saut_max": 0.05}')
on conflict (cle) do nothing;

create table if not exists cours_externes (
  id          bigint generated always as identity primary key,
  source      text not null,                 -- 'frankfurter' (BCE), 'er-api', 'equipe'
  date_source date,                          -- le jour du cours chez la source (la BCE ne publie pas le week-end)
  eur_usd     numeric(12,6),
  usd_xaf     numeric(12,4),                 -- 655,957 / eur_usd
  prime       numeric(8,5),
  prix        numeric(20,2),                 -- ce qui a été (ou aurait été) posé : XAFe pour 1 USDT
  pose        boolean not null default false,
  erreur      text,
  releve_le   timestamptz not null default now()
);
alter table cours_externes enable row level security;
create index if not exists cours_externes_recents on cours_externes (releve_le desc);

-- L'arrimage du franc CFA : fixe depuis 1999.
create or replace function _xaf_par_euro() returns numeric
language sql immutable set search_path = public as $$ select 655.957::numeric $$;

-- Poser un cours relevé. Toute la règle est ici (testable sans réseau) ;
-- relever_le_cours() ne fait qu'aller le chercher.
create or replace function _poser_le_cours(p_source text, p_eur_usd numeric, p_date date) returns cours_externes
language plpgsql set search_path = public as $$
declare
  v       jsonb := coalesce(parametre('cours'), '{}'::jsonb);
  v_prime numeric := coalesce((v ->> 'prime')::numeric, 0);
  v_saut  numeric := coalesce((v ->> 'saut_max')::numeric, 0.05);
  v_pas   numeric := coalesce((parametre('marche') ->> 'pas_prix')::numeric, 0.01);
  v_avant numeric;
  v_c     cours_externes;
begin
  if p_eur_usd is null or p_eur_usd < 0.5 or p_eur_usd > 2.5 then
    insert into cours_externes (source, date_source, eur_usd, erreur)
    values (p_source, p_date, case when abs(coalesce(p_eur_usd, 0)) < 1e6 then p_eur_usd end, 'cours aberrant : ignoré')
    returning * into v_c;
    return v_c;
  end if;
  v_c.usd_xaf := round(_xaf_par_euro() / p_eur_usd, 4);
  v_c.prix := round(v_c.usd_xaf * (1 + v_prime) / v_pas) * v_pas;
  select usd_xaf into v_avant from cours_externes where pose order by releve_le desc, id desc limit 1;
  if v_avant is not null and abs(v_c.usd_xaf / v_avant - 1) > v_saut then
    insert into cours_externes (source, date_source, eur_usd, usd_xaf, prime, prix, erreur)
    values (p_source, p_date, p_eur_usd, v_c.usd_xaf, v_prime, v_c.prix,
            format('saut de %s %% depuis le dernier cours posé (%s) : refusé, à confirmer par l''équipe',
                   round(abs(v_c.usd_xaf / v_avant - 1) * 100, 2), v_avant))
    returning * into v_c;
    return v_c;
  end if;
  insert into cours_externes (source, date_source, eur_usd, usd_xaf, prime, prix, pose)
  values (p_source, p_date, p_eur_usd, v_c.usd_xaf, v_prime, v_c.prix, true)
  returning * into v_c;
  -- seule la clé du prix change : le reste des règles du marché ne bouge pas
  update parametres set valeur = valeur || jsonb_build_object('prix_reference', v_c.prix) where cle = 'marche';
  return v_c;
end $$;

-- Aller chercher le cours. Sans l'extension http (une base d'essai), rien ne
-- part et l'absence se note : la référence garde sa dernière valeur.
create or replace function relever_le_cours() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_statut int; v_corps text; v_j jsonb; v_c cours_externes; v_err text;
begin
  if not coalesce((parametre('cours') ->> 'actif')::boolean, false) then
    return jsonb_build_object('actif', false);
  end if;
  if to_regprocedure('extensions.http_get(character varying)') is null then
    insert into cours_externes (source, erreur) values ('frankfurter', 'extension http absente : aucun relevé') returning * into v_c;
    return jsonb_build_object('pose', false, 'erreur', v_c.erreur);
  end if;
  begin
    execute $q$select extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000')$q$;
  exception when others then null;
  end;
  -- la BCE, par Frankfurter
  begin
    execute $q$select status, content from extensions.http_get('https://api.frankfurter.dev/v1/latest?from=EUR&to=USD')$q$ into v_statut, v_corps;
    if v_statut = 200 then
      v_j := v_corps::jsonb;
      v_c := _poser_le_cours('frankfurter', (v_j -> 'rates' ->> 'USD')::numeric, (v_j ->> 'date')::date);
      return jsonb_build_object('pose', v_c.pose, 'source', v_c.source, 'eur_usd', v_c.eur_usd, 'usd_xaf', v_c.usd_xaf, 'prix', v_c.prix, 'erreur', v_c.erreur);
    end if;
    v_err := format('frankfurter : HTTP %s', v_statut);
  exception when others then v_err := 'frankfurter : ' || left(sqlerrm, 200);
  end;
  -- le secours
  begin
    execute $q$select status, content from extensions.http_get('https://open.er-api.com/v6/latest/EUR')$q$ into v_statut, v_corps;
    if v_statut = 200 then
      v_j := v_corps::jsonb;
      if v_j ->> 'result' = 'success' then
        v_c := _poser_le_cours('er-api', (v_j -> 'rates' ->> 'USD')::numeric, (to_timestamp((v_j ->> 'time_last_update_unix')::bigint) at time zone 'UTC')::date);
        return jsonb_build_object('pose', v_c.pose, 'source', v_c.source, 'eur_usd', v_c.eur_usd, 'usd_xaf', v_c.usd_xaf, 'prix', v_c.prix, 'erreur', v_c.erreur, 'secours', v_err);
      end if;
    end if;
    v_err := v_err || format(' ; er-api : HTTP %s', v_statut);
  exception when others then v_err := v_err || ' ; er-api : ' || left(sqlerrm, 200);
  end;
  insert into cours_externes (source, erreur) values ('aucune', v_err) returning * into v_c;
  return jsonb_build_object('pose', false, 'erreur', v_err);
end $$;

-- Le dernier cours posé, pour les écrans
create or replace function _cours_reel() returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('usd_xaf', c.usd_xaf, 'eur_usd', c.eur_usd, 'prime', c.prime, 'prix', c.prix,
                            'source', c.source, 'date_source', c.date_source, 'releve_le', c.releve_le)
    from cours_externes c where c.pose order by c.releve_le desc, c.id desc limit 1
$$;

-- L'équipe : l'historique des relevés, et un relevé tout de suite
create or replace function admin_cours(p_limite int default 48) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('voir');
  return jsonb_build_object(
    'parametre', parametre('cours'),
    'reference', _prix_reference(),
    'prix_reference', parametre('marche') -> 'prix_reference',
    'dernier', _cours_reel(),
    'releves', (select coalesce(jsonb_agg(to_jsonb(c) order by c.releve_le desc, c.id desc), '[]'::jsonb)
                  from (select * from cours_externes order by releve_le desc, id desc limit least(greatest(coalesce(p_limite, 48), 1), 500)) c));
end $$;

create or replace function admin_relever_le_cours() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('parametres');
  r := relever_le_cours();
  perform _journaliser('relever_le_cours', 'cours', r);
  return r;
end $$;

-- Un saut refusé se confirme à la main : l'équipe pose le cours qu'elle a vérifié.
create or replace function admin_poser_le_cours(p_eur_usd numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c cours_externes;
begin
  perform _exiger_droit('parametres');
  if p_eur_usd is null or p_eur_usd < 0.5 or p_eur_usd > 2.5 then raise exception 'cours invalide' using detail = 'EUR/USD entre 0,5 et 2,5'; end if;
  -- la main de l'équipe passe le garde-fou du saut : c'est elle qui confirme
  insert into cours_externes (source, date_source, eur_usd, usd_xaf, prime, prix, pose)
  values ('equipe', current_date, p_eur_usd, round(_xaf_par_euro() / p_eur_usd, 4), coalesce((parametre('cours') ->> 'prime')::numeric, 0),
          round(round(_xaf_par_euro() / p_eur_usd, 4) * (1 + coalesce((parametre('cours') ->> 'prime')::numeric, 0))
                / coalesce((parametre('marche') ->> 'pas_prix')::numeric, 0.01)) * coalesce((parametre('marche') ->> 'pas_prix')::numeric, 0.01), true)
  returning * into v_c;
  update parametres set valeur = valeur || jsonb_build_object('prix_reference', v_c.prix) where cle = 'marche';
  perform _journaliser('poser_le_cours', 'cours', to_jsonb(v_c));
  return jsonb_build_object('ok', true, 'usd_xaf', v_c.usd_xaf, 'prix', v_c.prix);
end $$;

-- ──────────────────────── toutes les heures ─────────────────────────────────
-- Et une fois par jour, le ménage du journal de pg_cron : à une tâche par
-- minute et par réseau (plus les robots, 0023), il grossit sans fin.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron absent : le cours ne sera pas relevé sur cette base';
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname in ('glisil-cours', 'glisil-menage-cron');
  perform cron.schedule('glisil-cours', '17 * * * *', 'select public.relever_le_cours()');
  perform cron.schedule('glisil-menage-cron', '41 3 * * *', $q$delete from cron.job_run_details where end_time < now() - interval '3 days'$q$);
end $$;

-- un premier relevé tout de suite, là où le réseau existe
do $$
begin
  if to_regprocedure('extensions.http_get(character varying)') is not null then perform relever_le_cours(); end if;
exception when others then raise notice 'premier relevé du cours : %', sqlerrm;
end $$;

-- ─────────────────── ce qui change dans les lectures ───────────────────────
create or replace function cotation() returns jsonb
language sql stable security definer set search_path = public as $$
  with e as (select * from executions where cree_le > now() - interval '24 hours'),
       d as (select prix from executions order by cree_le desc, id desc limit 1),
       p as (select prix from executions where cree_le <= now() - interval '24 hours' order by cree_le desc, id desc limit 1)
  select jsonb_build_object(
    'paire', parametre('marche') ->> 'paire',
    'dernier', (select prix from d),
    'il_y_a_24h', (select prix from p),
    'haut', (select max(prix) from e), 'bas', (select min(prix) from e),
    'volume_usdt', (select coalesce(sum(quantite), 0) from e),
    'volume_xafe', (select coalesce(sum(montant_xafe), 0) from e),
    'meilleur_achat', (select max(prix) from ordres where etat in ('ouvert', 'partiel') and cote = 'achat'),
    'meilleure_vente', (select min(prix) from ordres where etat in ('ouvert', 'partiel') and cote = 'vente'),
    -- le prix autour duquel la bande se calcule : l'écran pré-remplit avec lui quand le carnet est vide
    'reference', _prix_reference(),
    -- le vrai dollar (0022) : ce que vaut 1 USD au cours de la BCE, et la prime posée par-dessus
    'cours_reel', _cours_reel())
$$;

-- L'équipe règle « cours » comme les autres paramètres
create or replace function _verifier_parametre(p_cle text, v jsonb) returns void
language plpgsql set search_path = public, extensions, pg_temp as $$
declare k text; p jsonb; ok boolean;
begin
  if jsonb_typeof(v) <> 'object' then raise exception 'paramètre invalide' using detail = 'un objet JSON est attendu'; end if;
  ok := case p_cle
    when 'frais' then _nombre_entre(v -> 'placeur', 0, 0.05) and _nombre_entre(v -> 'preneur', 0, 0.05) and _nombre_entre(v -> 'sortie', 0, 0.05)
    when 'marche' then v ->> 'paire' = 'USDT/XAFe' and _nombre_entre(v -> 'pas_prix', 0.01, 100) and _nombre_entre(v -> 'quantite_min', 0.01, 1000000)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
                       -- les règles du marché (0017) : chacune facultative, chacune bornée
                       and (not (v ? 'quantite_max') or _nombre_entre(v -> 'quantite_max', (v ->> 'quantite_min')::numeric, 1e9))
                       and (not (v ? 'marche_quantite_max') or _nombre_entre(v -> 'marche_quantite_max', (v ->> 'quantite_min')::numeric, 1e9))
                       and (not (v ? 'ordres_ouverts_max') or _nombre_entre(v -> 'ordres_ouverts_max', 1, 10000, true))
                       and (not (v ? 'bande_execution') or _nombre_entre(v -> 'bande_execution', 0.001, 0.5))
                       and (not (v ? 'bande_achat') or (jsonb_typeof(v -> 'bande_achat') = 'array' and jsonb_array_length(v -> 'bande_achat') = 2
                            and _nombre_entre(v -> 'bande_achat' -> 0, 0.01, 1) and _nombre_entre(v -> 'bande_achat' -> 1, 1, 100)))
                       and (not (v ? 'bande_vente') or (jsonb_typeof(v -> 'bande_vente') = 'array' and jsonb_array_length(v -> 'bande_vente') = 2
                            and _nombre_entre(v -> 'bande_vente' -> 0, 0.01, 1) and _nombre_entre(v -> 'bande_vente' -> 1, 1, 100)))
                       and (not (v ? 'prix_reference') or jsonb_typeof(v -> 'prix_reference') = 'null' or _nombre_entre(v -> 'prix_reference', 0.01, 1e9))
    when 'depot' then _nombre_entre(v -> 'validite_minutes', 5, 1440, true) and _nombre_entre(v -> 'grace_minutes', 0, 10080, true)
                      and (not (v ? 'declaration_complete') or jsonb_typeof(v -> 'declaration_complete') = 'boolean')
    when 'sortie' then _nombre_entre(v -> 'reprises_max', 1, 10, true)
                       and (not (v ? 'ouvertes') or jsonb_typeof(v -> 'ouvertes') = 'boolean')
                       and (not (v ? 'mode') or v ->> 'mode' in ('totem', 'manuel'))
                       and (not (v ? 'seuil_deux_personnes') or jsonb_typeof(v -> 'seuil_deux_personnes') = 'null'
                            or _nombre_entre(v -> 'seuil_deux_personnes', 1, 1e12))
    when 'rapide' then _nombre_entre(v -> 'marge', 0, 0.2) and _nombre_entre(v -> 'validite_secondes', 5, 120, true)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
    when 'code_secret' then _nombre_entre(v -> 'essais', 1, 10, true) and _nombre_entre(v -> 'verrou_minutes', 1, 1440, true)
                       and _nombre_entre(v -> 'longueur_min', 4, 6, true) and _nombre_entre(v -> 'longueur_max', 4, 8, true)
                       and (v ->> 'longueur_min')::int <= (v ->> 'longueur_max')::int
    when 'crypto' then _nombre_entre(v -> 'frais' -> 'USDT', 0, 1000) and _nombre_entre(v -> 'frais' -> 'XAFe', 0, 1000000)
                       and _nombre_entre(v -> 'confirmations' -> 'bep20', 1, 1000, true) and _nombre_entre(v -> 'confirmations' -> 'trc20', 1, 1000, true)
                       and jsonb_typeof(v -> 'retraits_ouverts') = 'boolean'
                       and (not (v ? 'depots_ouverts') or jsonb_typeof(v -> 'depots_ouverts') = 'boolean')
    when 'paliers' then (select bool_and(x) from (values (v ? '0'), (v ? '1'), (v ? '2')) t(x))
    when 'conditions' then coalesce(v ->> 'version', '') ~ '^\d{4}-\d{2}-\d{2}$'
    when 'support' then coalesce(v ->> 'email', '') ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'
                        and (jsonb_typeof(v -> 'whatsapp') = 'null' or coalesce(v ->> 'whatsapp', '') ~ '^\+[1-9][0-9]{7,14}$')
    when 'cours' then jsonb_typeof(v -> 'actif') = 'boolean' and _nombre_entre(v -> 'prime', -0.2, 0.2) and _nombre_entre(v -> 'saut_max', 0.005, 0.5)
    when 'beta' then jsonb_typeof(v -> 'actif') = 'boolean' and jsonb_typeof(v -> 'depots_reels') = 'boolean'
                     and (jsonb_typeof(v -> 'message') = 'null' or length(coalesce(v ->> 'message', '')) between 1 and 300)
                     and jsonb_typeof(v -> 'dotation') = 'object'
                     and _nombre_entre(v -> 'dotation' -> 'XAFe', 0, 100000000, true) and _nombre_entre(v -> 'dotation' -> 'USDT', 0, 1000000)
    when 'numeros' then jsonb_typeof(v -> 'verification_sms') = 'boolean' and _nombre_entre(v -> 'delai_heures', 0, 168, true)
    when 'parite' then (jsonb_typeof(v -> 'alerte_numero') = 'null' or coalesce(v ->> 'alerte_numero', '') ~ '^\+?[0-9 ]{9,16}$')
                       and coalesce(v ->> 'alerte_operateur', '') in ('mtn', 'om')
                       and _nombre_entre(v -> 'fraicheur_heures', 1, 720, true) and _nombre_entre(v -> 'delai_minutes', 5, 1440, true)
                       and jsonb_typeof(v -> 'publier_floats') = 'boolean'
    else false end;
  if p_cle = 'paliers' and ok then
    foreach k in array array['0', '1', '2'] loop
      p := v -> k;
      if jsonb_typeof(p) = 'null' then continue; end if;
      if not (jsonb_typeof(p) = 'object' and _nombre_entre(p -> 'entree_jour', 0, 1e12, true) and _nombre_entre(p -> 'sortie_jour', 0, 1e12, true)) then
        ok := false;
      end if;
    end loop;
  end if;
  if not coalesce(ok, false) then
    raise exception 'paramètre invalide' using detail = format('« %s » : une clé manque, ou une valeur sort de ses bornes', p_cle);
  end if;
end $$;

create or replace function admin_modifier_parametre(p_cle text, p_valeur jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('parametres');
  if p_cle not in ('frais', 'marche', 'depot', 'sortie', 'paliers', 'crypto', 'code_secret', 'rapide', 'conditions', 'support', 'numeros', 'beta', 'cours') then
    raise exception 'paramètre inconnu';
  end if;
  perform _verifier_parametre(p_cle, p_valeur);
  update parametres set valeur = p_valeur where cle = p_cle;
  if not found then raise exception 'paramètre inconnu'; end if;
  perform _journaliser('modifier_parametre', p_cle, p_valeur);
  return jsonb_build_object('ok', true);
end $$;

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on table cours_externes from public, anon, authenticated;
grant all on table cours_externes to service_role;
revoke all on function _xaf_par_euro(), _poser_le_cours(text, numeric, date), relever_le_cours(), _cours_reel(),
  admin_cours(int), admin_relever_le_cours(), admin_poser_le_cours(numeric) from public, anon, authenticated;
grant execute on function admin_cours(int), admin_relever_le_cours(), admin_poser_le_cours(numeric) to authenticated;
