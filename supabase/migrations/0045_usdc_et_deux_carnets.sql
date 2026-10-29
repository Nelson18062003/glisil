-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0045 · l'USDC, et un carnet par paire                         ║
-- ║                                                                        ║
-- ║  Livraison 2 (décidée le 29/10) : l'USDC à côté de l'USDT, sur BNB     ║
-- ║  Chain et Ethereum — PAS sur Tron, où Circle l'a abandonné en 2024 —,  ║
-- ║  et un second marché, USDC/XAFe, à côté d'USDT/XAFe.                   ║
-- ║                                                                        ║
-- ║  1. Les ACTIFS ont leur table. Cinq contraintes écrivaient la liste    ║
-- ║     « XAFe, USDT » chacune pour soi ; elles deviennent des clés        ║
-- ║     étrangères vers une seule liste, qui porte aussi les décimales     ║
-- ║     (un montant d'USDC se compte au centime, comme l'USDT).            ║
-- ║  2. Chaque RÉSEAU dit ce qu'il porte (reseaux.actifs). Une adresse,    ║
-- ║     un dépôt, un retrait d'un actif sur un réseau qui ne le porte pas  ║
-- ║     se refusent : de l'USDC envoyé sur Tron n'arriverait nulle part.   ║
-- ║  3. Le MARCHÉ se lit par paire. Le nom suit l'usage BASE/COTATION      ║
-- ║     (« USDC/XAFe ») ; une paire existe pour chaque actif autre que     ║
-- ║     XAFe. Les règles d'une paire sont celles de « marche », sauf ce    ║
-- ║     que « marche.paires.<paire> » change. Chaque paire a SON verrou :  ║
-- ║     deux carnets ne s'attendent pas, et un ordre ne voit que le sien.  ║
-- ║     Les fonctions ouvertes aux clients prennent la paire en DERNIER    ║
-- ║     argument, absente = la paire principale : l'écran d'hier marche.   ║
-- ║                                                                        ║
-- ║  Ce qui ne change pas : la garde du profil de production, les robots   ║
-- ║  (éteints en production, ils restent sur la paire principale), la      ║
-- ║  parité (le XAFe seul).                                                ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ── 1. les actifs ─────────────────────────────────────────────────────────
create table if not exists actifs (
  id        text primary key,
  nom       text not null,
  decimales int  not null check (decimales between 0 and 6),   -- la précision d'un montant DANS Glisil
  ordre     int  not null
);
alter table actifs enable row level security;
insert into actifs (id, nom, decimales, ordre) values
  ('XAFe', 'XAFe', 0, 1), ('USDT', 'Tether USD', 2, 2), ('USDC', 'USD Coin', 2, 3)
on conflict (id) do nothing;

do $$
declare t text;
begin
  foreach t in array array['soldes', 'adresses_crypto', 'transferts_crypto', 'adresses_libres', 'retraits_crypto'] loop
    execute format('alter table %I drop constraint if exists %I', t, t || '_actif_check');
    if not exists (select 1 from pg_constraint where conname = t || '_actif_fkey') then
      execute format('alter table %I add constraint %I foreign key (actif) references actifs(id)', t, t || '_actif_fkey');
    end if;
  end loop;
end $$;

-- ── 2. ce que chaque réseau porte ─────────────────────────────────────────
alter table reseaux add column if not exists actifs text[] not null default array['XAFe', 'USDT'];
update reseaux set actifs = array['XAFe', 'USDT', 'USDC'] where id in ('bep20', 'erc20') and not ('USDC' = any(actifs));
-- « les frais gardés » (29/10) : un retrait d'USDC coûte ce que coûte un retrait d'USDT, sauf si l'équipe en décide
-- autrement ; sans cela il partirait sans frais et la maison paierait le réseau. Ethereum attend ses confirmations.
update parametres set valeur = jsonb_set(valeur, '{frais,USDC}', coalesce(valeur -> 'frais' -> 'USDC', valeur -> 'frais' -> 'USDT', '1'::jsonb))
 where cle = 'crypto' and valeur ? 'frais' and not (valeur -> 'frais' ? 'USDC');
update parametres set valeur = jsonb_set(valeur, '{confirmations,erc20}', '12'::jsonb)
 where cle = 'crypto' and valeur ? 'confirmations' and not (valeur -> 'confirmations' ? 'erc20');

create or replace function _actif_sur_reseau(p_actif text, p_reseau text) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from reseaux r join actifs a on a.id = p_actif where r.id = p_reseau and p_actif = any(r.actifs))
$$;

-- le refus, dit une fois : quel actif, quel réseau, et où il passe
create or replace function _exiger_actif_sur_reseau(p_actif text, p_reseau text) returns void
language plpgsql stable set search_path = public as $$
begin
  if not exists (select 1 from actifs where id = p_actif) then raise exception 'actif inconnu'; end if;
  if not _actif_sur_reseau(p_actif, p_reseau) then
    raise exception 'actif absent de ce réseau' using detail = format('%s ne passe pas par %s : %s', p_actif,
      coalesce((select nom from reseaux where id = p_reseau), p_reseau),
      coalesce((select string_agg(nom, ', ' order by ordre) from reseaux where actif and p_actif = any(actifs)), 'aucun réseau ouvert'));
  end if;
end $$;

create or replace function _decimales(p_actif text) returns int
language sql stable set search_path = public as $$ select decimales from actifs where id = p_actif $$;

-- les frais d'un retrait : ceux du réseau s'il en a (Ethereum coûte plus cher), sinon ceux de l'actif
create or replace function _frais_retrait(p_actif text, p_reseau text) returns numeric
language sql stable set search_path = public as $$
  select coalesce((parametre('crypto') -> 'frais_reseaux' -> p_reseau ->> p_actif)::numeric,
                  (parametre('crypto') -> 'frais' ->> p_actif)::numeric, 0)
$$;

-- ── 3. les paires ─────────────────────────────────────────────────────────
create or replace function _paires() returns text[]
language sql stable set search_path = public as $$
  select array(select id || '/XAFe' from actifs where id <> 'XAFe' order by ordre)
$$;

-- la paire demandée, ou la principale ; une paire qui n'existe pas se refuse
create or replace function _paire(p_paire text) returns text
language plpgsql stable set search_path = public as $$
begin
  if p_paire is null then return parametre('marche') ->> 'paire'; end if;
  if not (p_paire = any(_paires())) then
    raise exception 'paire inconnue' using detail = array_to_string(_paires(), ', ');
  end if;
  return p_paire;
end $$;

-- l'actif qu'on échange contre des XAFe : « USDC » pour « USDC/XAFe »
create or replace function _base(p_paire text) returns text
language sql immutable set search_path = public as $$ select split_part(p_paire, '/', 1) $$;

drop function if exists _marche();
create or replace function _marche(p_paire text default null) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'quantite_max', null, 'marche_quantite_max', null, 'ordres_ouverts_max', 200, 'montant_min', 1500,
    'bande_achat', jsonb_build_array(0.8, 1.1), 'bande_vente', jsonb_build_array(0.9, 1.2),
    'bande_execution', 0.05, 'prix_reference', null, 'derive_max', 0.10)
    || (coalesce(parametre('marche'), '{}'::jsonb) - 'paires')
    || coalesce(parametre('marche') -> 'paires' -> coalesce(p_paire, parametre('marche') ->> 'paire'), '{}'::jsonb)
    || jsonb_build_object('paire', coalesce(p_paire, parametre('marche') ->> 'paire'),
                          'base', _base(coalesce(p_paire, parametre('marche') ->> 'paire')))
$$;

drop function if exists _prix_reference();
create or replace function _prix_reference(p_paire text default null) returns numeric
language sql stable set search_path = public as $$
  -- le prix des échanges DE LA PAIRE, mais jamais à plus de « derive_max » du cours externe (le dollar :
  -- l'USDT comme l'USDC en valent un) ; sans cours externe, comme avant
  with m as (select _marche(p_paire) v),
  e as (select (v ->> 'prix_reference')::numeric ext, v ->> 'paire' paire,
               least(greatest(coalesce((v ->> 'derive_max')::numeric, 0.10), 0.01), 0.5) d from m),
  t as (select coalesce(
    (select round(sum(x.montant_xafe) / nullif(sum(x.quantite), 0), 2) from executions x, e
      where x.paire = e.paire and x.cree_le > now() - interval '5 minutes'),
    (select x.prix from executions x, e where x.paire = e.paire order by x.cree_le desc, x.id desc limit 1)) p)
  select case when e.ext is null then coalesce(t.p, e.ext)
              when t.p is null then e.ext
              else round(least(greatest(t.p, e.ext * (1 - e.d)), e.ext * (1 + e.d)), 2) end
    from e, t
$$;

drop function if exists _dans_la_bande_d_execution(text, numeric, numeric);
create or replace function _dans_la_bande_d_execution(p_cote text, p_prix numeric, p_ref numeric, p_paire text default null) returns boolean
language sql stable set search_path = public as $$
  select p_ref is null
      or case when p_cote = 'achat' then p_prix <= p_ref * (1 + (_marche(p_paire) ->> 'bande_execution')::numeric)
              else p_prix >= p_ref * (1 - (_marche(p_paire) ->> 'bande_execution')::numeric) end
$$;

-- le dernier prix d'un actif en XAFe (les plafonds des paliers se comptent en XAF) ; à défaut, la paire principale
create or replace function _cours_de(p_actif text) returns numeric
language sql stable set search_path = public as $$
  select case when p_actif = 'XAFe' then 1 else coalesce(
    (select prix from executions where paire = p_actif || '/XAFe' order by cree_le desc, id desc limit 1),
    (select prix from executions where paire = parametre('marche') ->> 'paire' order by cree_le desc, id desc limit 1)) end
$$;

alter table devis_rapides add column if not exists paire text not null default 'USDT/XAFe';

create or replace function _execution_json(e executions) returns jsonb
language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', e.id, 'paire', e.paire, 'prix', e.prix, 'quantite', e.quantite, 'montant_xafe', e.montant_xafe,
                            'preneur', e.preneur, 'frais_acheteur', e.frais_acheteur, 'frais_vendeur', e.frais_vendeur,
                            'cree_le', e.cree_le)
$$;

create or replace function _devis_json(d devis_rapides) returns jsonb
language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', d.id, 'paire', d.paire, 'sens', d.sens, 'quantite', d.quantite, 'total', d.total,
                            'prix', round(d.total / d.quantite, 2), 'frais', abs(d.total - d.cout), 'marge', d.marge,
                            'etat', d.etat, 'expire_le', d.expire_le, 'execute_le', d.execute_le,
                            'ordre', (select numero from ordres where id = d.ordre_id))
$$;

-- ── l'appariement, par paire ──────────────────────────────────────────────
drop function if exists _placer_ordre(uuid, text, text, numeric, numeric, text, numeric);
create or replace function _placer_ordre(p_compte uuid, p_cote text, p_type text, p_quantite numeric, p_prix numeric, p_cle text, p_t_preneur numeric,
                              p_paire text default null)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_compte  uuid := p_compte;
  v_frais   jsonb := parametre('frais');
  v_marche  jsonb;
  v_paire   text;
  v_base    text;      -- l'actif échangé contre des XAFe : USDT ou USDC
  v_pas     numeric;
  v_qmin    numeric;
  v_t_pren  numeric := coalesce(p_t_preneur, (v_frais ->> 'preneur')::numeric);
  v_t_plac  numeric := (v_frais ->> 'placeur')::numeric;
  v_o       ordres;
  v_c       ordres;
  v_e       executions;
  v_q       numeric;
  v_px      numeric;
  v_xafe    numeric;
  v_fa      numeric;   -- frais de l'acheteur, dans l'actif de base
  v_fv      numeric;   -- frais du vendeur, en XAFe
  v_diff    numeric;
  v_cible   numeric;   -- ce que l'achat limite doit garder bloqué après la tranche
  v_frais_base numeric := 0;   -- les frais de toutes les tranches, encaissés par la maison À LA FIN
  v_frais_xafe numeric := 0;
  v_dispo   numeric;
  v_auto    boolean := false;
  v_execs   jsonb := '[]'::jsonb;
  v_achet   uuid;
  v_vend    uuid;
  v_id      text;
  v_ref     numeric;   -- le prix de référence au moment où l'ordre arrive (_prix_reference)
  v_bande   jsonb;
  v_lo      numeric;
  v_hi      numeric;
begin
  perform _exiger_compte_actif(v_compte);
  v_paire := _paire(p_paire);
  v_base := _base(v_paire);
  v_marche := _marche(v_paire);
  v_pas := (v_marche ->> 'pas_prix')::numeric;
  v_qmin := (v_marche ->> 'quantite_min')::numeric;
  if not coalesce((v_marche ->> 'ouvert')::boolean, true) then raise exception 'marché fermé' using detail = v_paire; end if;
  if p_cle is not null then
    select * into v_o from ordres where compte_id = v_compte and cle = p_cle;
    if found then return jsonb_build_object('ordre', _ordre_json(v_o), 'executions', '[]'::jsonb, 'deja', true); end if;
  end if;
  if p_cote not in ('achat', 'vente') then raise exception 'côté invalide'; end if;
  if p_type not in ('limite', 'marche') then raise exception 'type invalide'; end if;
  if p_quantite is null or p_quantite < v_qmin or p_quantite <> round(p_quantite, 2) then
    raise exception 'quantité invalide' using detail = format('au moins %s %s, deux décimales', v_qmin, v_base);
  end if;
  if p_type = 'limite' then
    if p_prix is null or p_prix <= 0 or mod(p_prix, v_pas) <> 0 then
      raise exception 'prix invalide' using detail = format('un multiple de %s', v_pas);
    end if;
  else
    p_prix := null;
  end if;

  -- LES RÈGLES DU MARCHÉ (0017), celles de LA PAIRE (0045)
  if p_quantite > coalesce((v_marche ->> 'quantite_max')::numeric, 1e12) then
    raise exception 'quantité trop grande' using detail = format('au plus %s %s par ordre', v_marche ->> 'quantite_max', v_base);
  end if;
  if p_type = 'marche' and p_quantite > coalesce((v_marche ->> 'marche_quantite_max')::numeric, 1e12) then
    raise exception 'ordre au marché trop grand' using detail = format('au plus %s %s au marché : au-delà, posez un ordre limite', v_marche ->> 'marche_quantite_max', v_base);
  end if;
  v_ref := _prix_reference(v_paire);
  if p_type = 'limite' and v_ref is not null then
    v_bande := coalesce(v_marche -> case when p_cote = 'achat' then 'bande_achat' else 'bande_vente' end, '[0, 1e9]'::jsonb);
    v_lo := ceil(v_ref * (v_bande ->> 0)::numeric / v_pas) * v_pas;
    v_hi := floor(v_ref * (v_bande ->> 1)::numeric / v_pas) * v_pas;
    if p_prix < v_lo or p_prix > v_hi then
      raise exception 'prix hors de la bande' using detail = format('%s : entre %s et %s XAFe (référence %s)',
        case when p_cote = 'achat' then 'un achat' else 'une vente' end, v_lo, v_hi, v_ref);
    end if;
  end if;
  if p_type = 'limite' and (select count(*) from ordres where compte_id = v_compte and paire = v_paire and etat in ('ouvert', 'partiel'))
                           >= coalesce((v_marche ->> 'ordres_ouverts_max')::int, 1000000) then
    raise exception 'trop d''ordres ouverts' using detail = format('au plus %s : annulez-en un', v_marche ->> 'ordres_ouverts_max');
  end if;

  -- Une paire s'apparie en file : un seul ordre entrant à la fois, PAR PAIRE.
  perform pg_advisory_xact_lock(hashtext(v_paire));
  v_ref := _prix_reference(v_paire);
  if round(p_quantite * coalesce(p_prix, v_ref, 0), 2) < coalesce((v_marche ->> 'montant_min')::numeric, 0)
     and (p_prix is not null or v_ref is not null) then
    raise exception 'ordre trop petit' using detail = format('au moins %s XAFe par ordre', v_marche ->> 'montant_min');
  end if;

  insert into ordres (compte_id, paire, cote, type, prix, quantite, restant, cle)
  values (v_compte, v_paire, p_cote, p_type, p_prix, p_quantite, p_quantite, p_cle)
  returning * into v_o;
  v_id := v_o.numero::text;

  if p_type = 'limite' then
    if p_cote = 'achat' then
      v_o.bloque := round(p_prix * p_quantite, 2);
      perform _mouvement(v_compte, 'XAFe', -v_o.bloque, v_o.bloque, 'ordre_bloque', 'ordres', v_id);
    else
      v_o.bloque := p_quantite;
      perform _mouvement(v_compte, v_base, -p_quantite, p_quantite, 'ordre_bloque', 'ordres', v_id);
    end if;
    update ordres set bloque = v_o.bloque where id = v_o.id;
  end if;

  -- Appariement prix-temps (voir 0001 et 0017 pour le détail des arrondis)
  loop
    exit when v_o.restant <= 0;
    if p_cote = 'achat' then
      select * into v_c from ordres
       where paire = v_paire and cote = 'vente' and etat in ('ouvert', 'partiel') and (p_type = 'marche' or prix <= p_prix)
       order by prix asc, cree_le asc, numero asc for update limit 1;
    else
      select * into v_c from ordres
       where paire = v_paire and cote = 'achat' and etat in ('ouvert', 'partiel') and (p_type = 'marche' or prix >= p_prix)
       order by prix desc, cree_le asc, numero asc for update limit 1;
    end if;
    exit when not found;
    if v_c.compte_id = v_compte then v_auto := true; exit; end if;
    exit when p_type = 'marche' and not _dans_la_bande_d_execution(p_cote, v_c.prix, v_ref, v_paire);

    v_q := least(v_o.restant, v_c.restant);
    v_px := v_c.prix;
    if p_type = 'marche' and p_cote = 'achat' then
      select disponible into v_dispo from soldes where compte_id = v_compte and actif = 'XAFe' for update;
      v_dispo := coalesce(v_dispo, 0);
      if v_dispo < round(v_q * v_px, 2) then v_q := trunc(v_dispo / v_px, 2); end if;
      exit when v_q <= 0;
    end if;

    if p_cote = 'achat' and p_type = 'limite' then
      v_cible := case when v_o.restant - v_q = 0 then 0 else round((v_o.restant - v_q) * p_prix, 2) end;
      v_xafe := case when v_px = p_prix then v_o.bloque - v_cible
                     else least(round(v_q * v_px, 2), v_o.bloque - v_cible) end;
    elsif p_cote = 'vente' then
      v_cible := case when v_c.restant - v_q = 0 then 0 else round((v_c.restant - v_q) * v_c.prix, 2) end;
      v_xafe := v_c.bloque - v_cible;
    else
      v_xafe := round(v_q * v_px, 2);
    end if;

    if p_cote = 'achat' then
      v_achet := v_compte; v_vend := v_c.compte_id;
      v_fa := round(v_q * v_t_pren, 2);  v_fv := round(v_xafe * v_t_plac, 0);
    else
      v_achet := v_c.compte_id; v_vend := v_compte;
      v_fa := round(v_q * v_t_plac, 2);  v_fv := round(v_xafe * v_t_pren, 0);
    end if;

    if (p_cote = 'achat' and p_type = 'limite') or p_cote = 'vente' then
      perform _mouvement(v_achet, 'XAFe', 0, -v_xafe, 'achat_regle', 'ordres', v_id);
    else
      perform _mouvement(v_achet, 'XAFe', -v_xafe, 0, 'achat_regle', 'ordres', v_id);
    end if;
    perform _mouvement(v_achet, v_base, v_q - v_fa, 0, 'achat_recu', 'ordres', v_id);
    if (p_cote = 'vente' and p_type = 'limite') or p_cote = 'achat' then
      perform _mouvement(v_vend, v_base, 0, -v_q, 'vente_reglee', 'ordres', v_id);
    else
      perform _mouvement(v_vend, v_base, -v_q, 0, 'vente_reglee', 'ordres', v_id);
    end if;
    perform _mouvement(v_vend, 'XAFe', v_xafe - v_fv, 0, 'vente_recue', 'ordres', v_id);
    v_frais_base := v_frais_base + v_fa;
    v_frais_xafe := v_frais_xafe + v_fv;

    if p_cote = 'achat' and p_type = 'limite' then
      v_diff := v_o.bloque - v_cible - v_xafe;
      if v_diff > 0 then
        perform _mouvement(v_compte, 'XAFe', v_diff, -v_diff, 'ordre_libere', 'ordres', v_id);
      end if;
      v_o.bloque := v_cible;
    elsif p_type = 'limite' then
      v_o.bloque := v_o.bloque - v_q;
    end if;

    v_o.restant := v_o.restant - v_q;
    v_o.executee := v_o.executee + v_q;
    v_o.total_xafe := v_o.total_xafe + v_xafe;
    update ordres
       set restant = v_o.restant, executee = v_o.executee, total_xafe = v_o.total_xafe, bloque = v_o.bloque,
           etat = case when v_o.restant = 0 then 'execute' else 'partiel' end, maj_le = now()
     where id = v_o.id;
    update ordres
       set restant = restant - v_q, executee = executee + v_q, total_xafe = total_xafe + v_xafe,
           bloque = case when cote = 'achat' then v_cible else bloque - v_q end,
           etat = case when restant - v_q = 0 then 'execute' else 'partiel' end, maj_le = now()
     where id = v_c.id;
    if v_c.restant - v_q = 0 then
      perform _notifier(v_c.compte_id, 'Ordre exécuté',
        format('%s de %s %s à %s.', case when v_c.cote = 'achat' then 'Achat' else 'Vente' end, v_c.quantite, v_base, v_px), '/marche/ordres/' || v_c.id);
    end if;

    insert into executions (paire, ordre_achat, ordre_vente, preneur, prix, quantite, montant_xafe, frais_acheteur, frais_vendeur)
    values (v_paire,
            case when p_cote = 'achat' then v_o.id else v_c.id end,
            case when p_cote = 'achat' then v_c.id else v_o.id end,
            p_cote, v_px, v_q, v_xafe, v_fa, v_fv)
    returning * into v_e;
    v_execs := v_execs || _execution_json(v_e);
  end loop;

  -- La maison en dernier : voir « l'ordre des verrous », au-dessus de _mouvement.
  if v_frais_base > 0 then perform _mouvement(compte_maison(), v_base, v_frais_base, 0, 'frais_achat', 'ordres', v_id); end if;
  if v_frais_xafe > 0 then perform _mouvement(compte_maison(), 'XAFe', v_frais_xafe, 0, 'frais_vente', 'ordres', v_id); end if;

  if v_o.restant > 0 and (p_type = 'marche' or v_auto) then
    if p_type = 'limite' and v_o.bloque > 0 then
      if p_cote = 'achat' then
        perform _mouvement(v_compte, 'XAFe', v_o.bloque, -v_o.bloque, 'ordre_libere', 'ordres', v_id);
      else
        perform _mouvement(v_compte, v_base, v_o.bloque, -v_o.bloque, 'ordre_libere', 'ordres', v_id);
      end if;
    end if;
    update ordres
       set etat = case when v_o.executee > 0 then 'execute' else 'annule' end, restant = 0, bloque = 0, maj_le = now()
     where id = v_o.id;
  end if;

  select * into v_o from ordres where id = v_o.id;
  return jsonb_build_object('ordre', _ordre_json(v_o), 'executions', v_execs, 'auto_negociation', v_auto);
end $function$;

drop function if exists placer_ordre(text, text, numeric, numeric, text);
create or replace function placer_ordre(p_cote text, p_type text, p_quantite numeric, p_prix numeric default null, p_cle text default null,
                             p_paire text default null)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (select _placer_ordre(auth.uid(), p_cote, p_type, p_quantite, p_prix, p_cle, null, p_paire));
end $function$;
revoke execute on function placer_ordre(text, text, numeric, numeric, text, text) from public, anon;
grant execute on function placer_ordre(text, text, numeric, numeric, text, text) to authenticated;

-- l'annulation prend le verrou de LA paire de l'ordre (une paire ne se change pas : la lire avant le verrou est sûr)
create or replace function _annuler_ordre(p_compte uuid, p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
declare v_o ordres; v_paire text;
begin
  select paire into v_paire from ordres where id = p_id and compte_id = p_compte;
  if not found then raise exception 'ordre inconnu'; end if;
  perform pg_advisory_xact_lock(hashtext(v_paire));
  select * into v_o from ordres where id = p_id and compte_id = p_compte for update;
  if v_o.etat not in ('ouvert', 'partiel') then raise exception 'cet ordre ne peut plus être annulé' using detail = v_o.etat; end if;
  if v_o.bloque > 0 then
    if v_o.cote = 'achat' then
      perform _mouvement(v_o.compte_id, 'XAFe', v_o.bloque, -v_o.bloque, 'ordre_libere', 'ordres', v_o.numero::text);
    else
      perform _mouvement(v_o.compte_id, _base(v_o.paire), v_o.bloque, -v_o.bloque, 'ordre_libere', 'ordres', v_o.numero::text);
    end if;
  end if;
  update ordres set etat = 'annule', restant = 0, bloque = 0, maj_le = now() where id = v_o.id returning * into v_o;
  return _ordre_json(v_o);
end $function$;

drop function if exists _parcourir_carnet(uuid, text, numeric, numeric);
create or replace function _parcourir_carnet(p_compte uuid, p_sens text, p_quantite numeric, p_budget numeric, p_paire text default null,
                                  OUT quantite numeric, OUT montant numeric)
 RETURNS record LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
declare
  v_paire text := coalesce(p_paire, parametre('marche') ->> 'paire');
  v_c ordres; v_q numeric; v_x numeric; v_cible numeric;
  v_ref numeric := _prix_reference(coalesce(p_paire, parametre('marche') ->> 'paire'));
begin
  quantite := 0; montant := 0;
  for v_c in
    select * from ordres
     where paire = v_paire and etat in ('ouvert', 'partiel')
       and cote = case when p_sens = 'achat' then 'vente' else 'achat' end
     order by case when p_sens = 'achat' then prix else -prix end, cree_le, numero
  loop
    exit when v_c.compte_id = p_compte;
    exit when not _dans_la_bande_d_execution(p_sens, v_c.prix, v_ref, v_paire);
    if p_budget is not null then
      v_q := least(v_c.restant, trunc((p_budget - montant) / v_c.prix, 2));
    else
      v_q := least(v_c.restant, p_quantite - quantite);
    end if;
    exit when v_q <= 0;
    if p_sens = 'achat' then
      v_x := round(v_q * v_c.prix, 2);
    else
      v_cible := case when v_c.restant - v_q = 0 then 0 else round((v_c.restant - v_q) * v_c.prix, 2) end;
      v_x := v_c.bloque - v_cible;
    end if;
    quantite := quantite + v_q;
    montant := montant + v_x;
  end loop;
end $function$;

-- ── ce que les clients lisent, par paire ──────────────────────────────────
drop function if exists carnet(integer);
create or replace function carnet(p_profondeur integer default 20, p_paire text default null)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_paire text;
begin
  perform _exiger_aal2();
  v_paire := _paire(p_paire);
  return (
  select jsonb_build_object(
    'paire', v_paire,
    'achats', (select coalesce(jsonb_agg(jsonb_build_object('prix', prix, 'quantite', q, 'ordres', n) order by prix desc), '[]'::jsonb)
                 from (select prix, sum(restant) q, count(*) n from ordres
                        where paire = v_paire and etat in ('ouvert', 'partiel') and cote = 'achat' group by prix order by prix desc limit p_profondeur) a),
    'ventes', (select coalesce(jsonb_agg(jsonb_build_object('prix', prix, 'quantite', q, 'ordres', n) order by prix asc), '[]'::jsonb)
                 from (select prix, sum(restant) q, count(*) n from ordres
                        where paire = v_paire and etat in ('ouvert', 'partiel') and cote = 'vente' group by prix order by prix asc limit p_profondeur) v),
    'dernier', (select prix from executions where paire = v_paire order by cree_le desc, id desc limit 1))
  );
end $function$;
revoke execute on function carnet(integer, text) from public, anon;
grant execute on function carnet(integer, text) to authenticated;

drop function if exists cotation();
create or replace function cotation(p_paire text default null)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_paire text;
begin
  perform _exiger_aal2();
  v_paire := _paire(p_paire);
  return (
  with e as (select * from executions where paire = v_paire and cree_le > now() - interval '24 hours'),
       d as (select prix from executions where paire = v_paire order by cree_le desc, id desc limit 1),
       p as (select prix from executions where paire = v_paire and cree_le <= now() - interval '24 hours' order by cree_le desc, id desc limit 1)
  select jsonb_build_object(
    'paire', v_paire,
    'base', _base(v_paire),
    'dernier', (select prix from d),
    'il_y_a_24h', (select prix from p),
    'haut', (select max(prix) from e), 'bas', (select min(prix) from e),
    'volume_base', (select coalesce(sum(quantite), 0) from e),
    -- le nom d'hier : une application déjà installée le lit encore (c'est le volume de l'actif de base)
    'volume_usdt', (select coalesce(sum(quantite), 0) from e),
    'volume_xafe', (select coalesce(sum(montant_xafe), 0) from e),
    'meilleur_achat', (select max(prix) from ordres where paire = v_paire and etat in ('ouvert', 'partiel') and cote = 'achat'),
    'meilleure_vente', (select min(prix) from ordres where paire = v_paire and etat in ('ouvert', 'partiel') and cote = 'vente'),
    'reference', _prix_reference(v_paire),
    'cours_reel', _cours_reel())
  );
end $function$;
revoke execute on function cotation(text) from public, anon;
grant execute on function cotation(text) to authenticated;

drop function if exists transactions_recentes(integer);
create or replace function transactions_recentes(p_n integer default 50, p_paire text default null)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_paire text;
begin
  perform _exiger_aal2();
  v_paire := _paire(p_paire);
  return (
  select coalesce(jsonb_agg(jsonb_build_object('prix', prix, 'quantite', quantite, 'preneur', preneur, 'cree_le', cree_le)
                            order by cree_le desc, id desc), '[]'::jsonb)
    from (select * from executions where paire = v_paire order by cree_le desc, id desc limit p_n) e
  );
end $function$;
revoke execute on function transactions_recentes(integer, text) from public, anon;
grant execute on function transactions_recentes(integer, text) to authenticated;

drop function if exists chandelles(integer, integer);
create or replace function chandelles(p_minutes integer default 60, p_n integer default 28, p_paire text default null)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_paire text;
begin
  perform _exiger_aal2();
  v_paire := _paire(p_paire);
  return (
  with e as (
    select date_bin(make_interval(mins => p_minutes), cree_le, timestamptz '2000-01-01') t, prix, quantite, cree_le, id
      from executions
     where paire = v_paire and cree_le > now() - make_interval(mins => p_minutes * (p_n + 1))
  ),
  c as (
    select t,
           (array_agg(prix order by cree_le, id))[1] o,
           max(prix) h, min(prix) l,
           (array_agg(prix order by cree_le desc, id desc))[1] c,
           sum(quantite) v
      from e group by t order by t desc limit p_n
  )
  select coalesce(jsonb_agg(jsonb_build_object('t', t, 'o', o, 'h', h, 'l', l, 'c', c, 'v', v) order by t), '[]'::jsonb) from c
  );
end $function$;
revoke execute on function chandelles(integer, integer, text) from public, anon;
grant execute on function chandelles(integer, integer, text) to authenticated;

drop function if exists bougies(text, timestamptz, integer);
create or replace function bougies(p_intervalle text, p_avant timestamptz default null, p_n integer default 300, p_paire text default null)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_n       int := least(greatest(coalesce(p_n, 300), 1), 1000);
  v_avant   timestamptz := coalesce(p_avant, now() + interval '1 second');
  v_paire   text;
  v_debut   timestamptz;      -- le premier échange de LA PAIRE
  v_borne   timestamptz;
  v_res     jsonb;
  v_plus    boolean;
begin
  perform _exiger_aal2();
  v_paire := _paire(p_paire);
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
  -- le cours de référence (le dollar, BCE), jour par jour, AVANT le premier échange : l'USDC en vaut un aussi
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

  v_plus := exists (select 1 from executions where paire = v_paire and cree_le < least(v_avant, coalesce((v_res -> 0 ->> 't')::timestamptz, v_avant)))
         or (p_intervalle in ('1j', '1s', '1M') and exists (
               select 1 from cours_historiques
                where (jour::timestamp at time zone 'Africa/Douala') < least(v_avant, coalesce((v_res -> 0 ->> 't')::timestamptz, v_avant))));
  return jsonb_build_object('paire', v_paire, 'intervalle', p_intervalle, 'bougies', v_res, 'plus_ancien', v_plus,
                            'debut_marche', v_debut, 'premier_cours', (select min(jour) from cours_historiques));
end $function$;
revoke execute on function bougies(text, timestamptz, integer, text) from public, anon;
grant execute on function bougies(text, timestamptz, integer, text) to authenticated;

-- ── l'achat rapide, par paire ─────────────────────────────────────────────
drop function if exists devis_rapide(text, numeric, boolean);
create or replace function devis_rapide(p_sens text, p_montant numeric, p_ferme boolean default true, p_paire text default null)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_compte uuid := auth.uid();
  v_r      jsonb := parametre('rapide');
  v_m      numeric := (v_r ->> 'marge')::numeric;
  v_paire  text;
  v_base   text;
  v_marche jsonb;
  v_qmin   numeric;
  v_q      numeric; v_cout numeric; v_total numeric;
  v_d      devis_rapides;
begin
  perform _exiger_compte_actif(v_compte);
  v_paire := _paire(p_paire);
  v_base := _base(v_paire);
  v_marche := _marche(v_paire);
  v_qmin := (v_marche ->> 'quantite_min')::numeric;
  if not coalesce((v_marche ->> 'ouvert')::boolean, true) then raise exception 'marché fermé' using detail = v_paire; end if;
  if not coalesce((v_r ->> 'ouvert')::boolean, false) then raise exception 'achat rapide fermé'; end if;
  if p_sens not in ('achat', 'vente') then raise exception 'côté invalide'; end if;
  if p_montant is null or p_montant <= 0 or p_montant <> round(p_montant, 2) then raise exception 'montant invalide'; end if;

  if p_sens = 'achat' then
    select quantite, montant into v_q, v_cout
      from _parcourir_carnet(v_compte, 'achat', null, trunc(p_montant / (1 + v_m), 2), v_paire);
    if v_q < v_qmin then
      raise exception 'pas assez de vendeurs au carnet' using detail = format('au moins %s %s, et des offres pour les servir', v_qmin, v_base);
    end if;
    v_total := ceil(v_cout * (1 + v_m) * 100) / 100;
  else
    if p_montant < v_qmin then raise exception 'quantité invalide' using detail = format('au moins %s %s', v_qmin, v_base); end if;
    select quantite, montant into v_q, v_cout from _parcourir_carnet(v_compte, 'vente', p_montant, null, v_paire);
    if v_q < p_montant then
      raise exception 'pas assez d''acheteurs au carnet' using detail = format('le carnet n''en prend que %s %s', v_q, v_base);
    end if;
    v_total := floor(v_cout * (1 - v_m) * 100) / 100;
  end if;

  if not p_ferme then
    return jsonb_build_object('paire', v_paire, 'sens', p_sens, 'quantite', v_q, 'total', v_total, 'prix', round(v_total / v_q, 2),
                              'frais', abs(v_total - v_cout), 'marge', v_m);
  end if;
  insert into devis_rapides (compte_id, paire, sens, quantite, cout, total, marge, expire_le)
  values (v_compte, v_paire, p_sens, v_q, v_cout, v_total, v_m,
          now() + make_interval(secs => coalesce((v_r ->> 'validite_secondes')::int, 20)))
  returning * into v_d;
  return _devis_json(v_d);
end $function$;
revoke execute on function devis_rapide(text, numeric, boolean, text) from public, anon;
grant execute on function devis_rapide(text, numeric, boolean, text) to authenticated;

-- le devis porte sa paire : on le rejoue sur SON carnet, sous SON verrou
create or replace function executer_devis(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_compte uuid := auth.uid();
  v_d      devis_rapides;
  v_paire  text;
  v_base   text;
  v_q      numeric; v_cout numeric; v_dispo numeric; v_frais numeric;
  v_r      jsonb; v_o jsonb;
begin
  perform _exiger_compte_actif(v_compte);
  select paire into v_paire from devis_rapides where id = p_id and compte_id = v_compte;
  if not found then raise exception 'devis inconnu'; end if;
  v_base := _base(v_paire);
  perform pg_advisory_xact_lock(hashtext(v_paire));
  select * into v_d from devis_rapides where id = p_id and compte_id = v_compte for update;
  if v_d.etat = 'execute' then return _devis_json(v_d) || '{"deja": true}'; end if;
  if v_d.expire_le < now() then raise exception 'devis expiré' using detail = 'demandez un nouveau prix'; end if;

  select quantite, montant into v_q, v_cout from _parcourir_carnet(v_compte, v_d.sens, v_d.quantite, null, v_paire);
  if v_q < v_d.quantite
     or (v_d.sens = 'achat' and v_cout > v_d.cout)
     or (v_d.sens = 'vente' and v_cout < v_d.cout) then
    raise exception 'le prix a changé' using detail = 'le carnet a bougé : demandez un nouveau prix';
  end if;

  if v_d.sens = 'achat' then
    select disponible into v_dispo from soldes where compte_id = v_compte and actif = 'XAFe';
    if coalesce(v_dispo, 0) < v_d.total then raise exception 'solde insuffisant' using detail = format('%s XAFe disponibles', coalesce(v_dispo, 0)); end if;
  else
    select disponible into v_dispo from soldes where compte_id = v_compte and actif = v_base;
    if coalesce(v_dispo, 0) < v_d.quantite then raise exception 'solde insuffisant' using detail = format('%s %s disponibles', coalesce(v_dispo, 0), v_base); end if;
  end if;

  v_r := _placer_ordre(v_compte, v_d.sens, 'marche', v_d.quantite, null, 'rapide-' || v_d.id::text, 0, v_paire);
  v_o := v_r -> 'ordre';
  if (v_o ->> 'executee')::numeric <> v_d.quantite then
    raise exception 'le prix a changé' using detail = 'le carnet n''a pas tout servi : rien n''a bougé';
  end if;
  v_frais := case when v_d.sens = 'achat' then v_d.total - (v_o ->> 'total_xafe')::numeric
                  else (v_o ->> 'total_xafe')::numeric - v_d.total end;
  if v_frais > 0 then
    perform _mouvement(v_compte, 'XAFe', -v_frais, 0, 'frais_rapide', 'devis_rapides', v_d.id::text);
    perform _mouvement(compte_maison(), 'XAFe', v_frais, 0, 'frais_rapide', 'devis_rapides', v_d.id::text);
  end if;
  update devis_rapides set etat = 'execute', ordre_id = (v_o ->> 'id')::uuid, execute_le = now()
   where id = v_d.id returning * into v_d;
  return _devis_json(v_d);
end $function$;

-- ── 4. les dépôts, les retraits, les paramètres, l'administration ────────
create or replace function _demander_retrait_crypto(p_actif text, p_reseau text, p_adresse text, p_montant numeric, p_cle text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_compte uuid := auth.uid();
  v_r      retraits_crypto;
  v_res    reseaux;
  v_frais  numeric;
  v_palier jsonb;
  v_cours  numeric;
  v_xaf    numeric;
begin
  perform _exiger_compte_actif(v_compte);
  if p_cle is not null then
    select * into v_r from retraits_crypto where compte_id = v_compte and cle = p_cle;
    if found then return _retrait_json(v_r) || '{"deja": true}'; end if;
  end if;
  if not coalesce((parametre('crypto') ->> 'retraits_ouverts')::boolean, false) then
    raise exception 'retraits crypto pas encore ouverts' using detail = 'l''envoi sur la chaîne arrive bientôt ; vos fonds restent disponibles';
  end if;
  if not exists (select 1 from actifs where id = p_actif) then raise exception 'actif inconnu'; end if;
  v_res := _reseau_ouvert(p_reseau);
  -- l'USDC ne passe pas par Tron : refusé ici, avant de bloquer quoi que ce soit
  perform _exiger_actif_sur_reseau(p_actif, v_res.id);
  if not _adresse_valide(v_res.famille, p_adresse) then
    raise exception 'adresse invalide' using detail = format('ce n''est pas une adresse %s (%s)', v_res.norme, v_res.nom);
  end if;
  if p_montant is null or p_montant <= 0 or p_montant <> round(p_montant, _decimales(p_actif)) then
    raise exception 'montant invalide';
  end if;
  v_frais := _frais_retrait(p_actif, v_res.id);

  perform 1 from comptes where id = v_compte for no key update;
  v_palier := parametre('paliers') -> (select palier::text from comptes where id = v_compte);
  if v_palier is not null and v_palier <> 'null'::jsonb then
    if p_actif <> 'XAFe' then
      v_cours := _cours_de(p_actif);
      if v_cours is null then raise exception 'pas de cours de référence' using detail = 'le plafond du palier se compte en XAF'; end if;
      v_xaf := (p_montant + v_frais) * v_cours;
    else
      v_xaf := p_montant + v_frais;
    end if;
    if _sorties_du_jour(v_compte) + v_xaf > (v_palier ->> 'sortie_jour')::numeric then
      raise exception 'plafond du palier atteint' using detail = format('%s XAF par jour, retraits crypto compris', v_palier ->> 'sortie_jour');
    end if;
  end if;
  insert into retraits_crypto (reference, compte_id, actif, reseau, adresse, montant, frais, cle)
  values ('XAFe-CR-' || lpad(nextval('retraits_crypto_numero')::text, 6, '0'), v_compte, p_actif, p_reseau, p_adresse, p_montant, v_frais, p_cle)
  returning * into v_r;
  perform _mouvement(v_compte, p_actif, -(p_montant + v_frais), p_montant + v_frais, 'retrait_crypto_bloque', 'retraits_crypto', v_r.reference);
  return _retrait_json(v_r);
end $function$;

create or replace function _sorties_du_jour(p_compte uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  return (select coalesce(sum(montant), 0) from sorties
           where compte_id = p_compte and cree_le >= debut_du_jour() and etat not in ('annulee', 'echouee'))
       + (select coalesce(sum(case actif when 'XAFe' then montant + frais else (montant + frais) * coalesce(_cours_de(actif), 0) end), 0)
            from retraits_crypto
           where compte_id = p_compte and cree_le >= debut_du_jour() and etat not in ('echoue', 'annule'));
end $function$;

create or replace function _parametres_de(p_compte uuid, p_operation text, p_p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_n       numeros;
  v_op      operateurs;
  v_demo    boolean;
  v_montant numeric;
  v_nom     text;
  v_taux    numeric;
  v_frais   numeric := 0;
  v_n_tr    int; v_part numeric; v_reste numeric; v_chunk numeric; v_f numeric; i int;
  v_palier  jsonb;
  v_res     reseaux;
  v_actif   text;
  v_adresse text;
  v_dispo   numeric;
begin
  if p_operation = 'sortie_momo' then
    v_montant := (p_p ->> 'montant')::numeric;
    select * into v_n from numeros where id = (p_p ->> 'numero_id')::uuid and compte_id = p_compte and retire_le is null;
    -- les gardes de la sortie (0030, 0034), dans le même ordre
    v_demo := numero_de_demo(v_n.numero);
    if coalesce(v_demo, false) and _depots_reels_ouverts(p_compte) then
      raise exception 'un numéro de démo ne reçoit que l''argent de test'
        using detail = 'vos XAFe sont de l''argent réel : retirez-les vers un vrai numéro';
    end if;
    if not coalesce(v_demo, false) and not _depots_reels_ouverts(p_compte) then
      raise exception 'l''argent de test ne sort pas en vrai'
        using detail = 'vos XAFe de la bêta se retirent vers un numéro de démo (600…)';
    end if;
    if not coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true) and not coalesce(v_demo, false) then
      raise exception 'sorties pas encore ouvertes' using detail = 'vos XAFe restent sur votre compte';
    end if;
    if v_montant is null or v_montant <= 0 or v_montant <> trunc(v_montant) then raise exception 'montant invalide'; end if;
    if _sortie_manuelle() then
      v_nom := nullif(regexp_replace(trim(coalesce(p_p ->> 'nom', '')), '\s+', ' ', 'g'), '');
      if v_nom is null or length(v_nom) < 2 or length(v_nom) > 80 then
        raise exception 'nom du bénéficiaire invalide' using detail = 'le nom exact du compte Mobile Money qui reçoit';
      end if;
    end if;
    if v_n.id is null then raise exception 'numéro inconnu sur ce compte'; end if;
    if v_n.verifie_le is null then raise exception 'numéro pas encore vérifié'; end if;
    if v_n.actif_des > now() then
      raise exception 'numéro pas encore actif' using detail = format('actif à partir du %s', v_n.actif_des);
    end if;
    select * into v_op from operateurs where id = v_n.operateur;
    v_palier := parametre('paliers') -> (select palier::text from comptes where id = p_compte);
    if v_palier is not null and v_palier <> 'null'::jsonb and _sorties_du_jour(p_compte) + v_montant > (v_palier ->> 'sortie_jour')::numeric then
      raise exception 'plafond du palier atteint' using detail = format('%s XAF par jour', v_palier ->> 'sortie_jour');
    end if;
    -- les frais, comptés comme l'opération les comptera (découpage par transfert compris, en mode TOTEM)
    v_taux := coalesce((parametre('frais') ->> 'sortie')::numeric, 0);
    v_n_tr := case when _sortie_manuelle() or v_op.plafond_par_transfert is null then 1
                   else greatest(1, ceil(v_montant / v_op.plafond_par_transfert))::int end;
    v_part := trunc(v_montant / v_n_tr); v_reste := v_montant - v_part * v_n_tr;
    for i in 1 .. v_n_tr loop
      v_chunk := v_part + (case when i = v_n_tr then v_reste else 0 end);
      v_f := ceil(v_chunk * v_taux);
      if v_chunk - v_f <= 0 then raise exception 'montant trop petit' using detail = 'après les frais, rien ne partirait'; end if;
      v_frais := v_frais + v_f;
    end loop;
    select disponible into v_dispo from soldes where compte_id = p_compte and actif = 'XAFe';
    if coalesce(v_dispo, 0) < v_montant then
      raise exception 'solde insuffisant' using detail = format('XAFe : %s disponible', coalesce(v_dispo, 0));
    end if;
    return jsonb_build_object(
      'parametres', jsonb_build_object('montant', trim_scale(v_montant), 'numero_id', v_n.id, 'operateur', v_n.operateur, 'numero', v_n.numero, 'nom', v_nom),
      'affichage', jsonb_build_object('montant', trim_scale(v_montant), 'frais', trim_scale(v_frais), 'recu', trim_scale(v_montant - v_frais),
                                      'operateur', v_n.operateur, 'operateur_nom', coalesce(v_op.nom, v_n.operateur), 'numero', v_n.numero, 'nom', v_nom));

  elsif p_operation = 'retrait_crypto' then
    v_actif := p_p ->> 'actif';
    v_adresse := trim(coalesce(p_p ->> 'adresse', ''));
    v_montant := (p_p ->> 'montant')::numeric;
    if not coalesce((parametre('crypto') ->> 'retraits_ouverts')::boolean, false) then
      raise exception 'retraits crypto pas encore ouverts' using detail = 'l''envoi sur la chaîne arrive bientôt ; vos fonds restent disponibles';
    end if;
    if v_actif is null or not exists (select 1 from actifs where id = v_actif) then raise exception 'actif inconnu'; end if;
    v_res := _reseau_ouvert(p_p ->> 'reseau');
    perform _exiger_actif_sur_reseau(v_actif, v_res.id);
    if not _adresse_valide(v_res.famille, v_adresse) then
      raise exception 'adresse invalide' using detail = format('ce n''est pas une adresse %s (%s)', v_res.norme, v_res.nom);
    end if;
    if v_montant is null or v_montant <= 0 or v_montant <> round(v_montant, _decimales(v_actif)) then
      raise exception 'montant invalide';
    end if;
    v_frais := _frais_retrait(v_actif, v_res.id);
    select disponible into v_dispo from soldes where compte_id = p_compte and actif = v_actif;
    if coalesce(v_dispo, 0) < v_montant + v_frais then
      raise exception 'solde insuffisant' using detail = format('%s : %s disponible', v_actif, coalesce(v_dispo, 0));
    end if;
    return jsonb_build_object(
      'parametres', jsonb_build_object('actif', v_actif, 'reseau', v_res.id, 'adresse', v_adresse, 'montant', trim_scale(v_montant)),
      -- les frais ne sont PAS liés : l'opération prend ceux en vigueur quand elle s'exécute (comme avant)
      'affichage', jsonb_build_object('actif', v_actif, 'montant', trim_scale(v_montant), 'frais', trim_scale(v_frais), 'reseau', v_res.id,
                                      'reseau_nom', v_res.nom, 'norme', v_res.norme, 'adresse', v_adresse, 'explorateur', v_res.explorateur));

  elsif p_operation = 'fermer_compte' then
    perform _exiger_fermeture_possible(p_compte);
    return jsonb_build_object('parametres', '{}'::jsonb, 'affichage', '{}'::jsonb);

  elsif p_operation = 'retirer_numero' then
    select * into v_n from numeros where id = (p_p ->> 'numero_id')::uuid and compte_id = p_compte and retire_le is null;
    if v_n.id is null then raise exception 'numéro inconnu sur ce compte'; end if;
    if v_n.verifie_le is not null
       and (select count(*) from numeros where compte_id = p_compte and retire_le is null and verifie_le is not null) <= 1 then
      raise exception 'le dernier numéro ne se retire pas';
    end if;
    select * into v_op from operateurs where id = v_n.operateur;
    return jsonb_build_object(
      'parametres', jsonb_build_object('numero_id', v_n.id, 'operateur', v_n.operateur, 'numero', v_n.numero),
      'affichage', jsonb_build_object('operateur', v_n.operateur, 'operateur_nom', coalesce(v_op.nom, v_n.operateur), 'numero', v_n.numero));
  end if;
  raise exception 'opération inconnue';
end $function$;

create or replace function adresse_depot(p_actif text, p_reseau text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_compte uuid := auth.uid(); v_adresse text; v_libre adresses_libres;
begin
  perform _exiger_compte_actif(v_compte);
  -- fermé : aucune adresse ne se montre — pas même celle déjà attribuée, sur laquelle de vrais USDT n'arriveraient nulle part
  if not coalesce((parametre('crypto') ->> 'depots_ouverts')::boolean, true) then return null; end if;
  -- un réseau fermé ne montre pas d'adresse non plus : un envoi n'y serait pas attendu
  if not exists (select 1 from reseaux where id = p_reseau and actif) then return null; end if;
  -- un actif que le réseau ne porte pas n'a pas d'adresse : de l'USDC envoyé sur Tron n'arriverait nulle part
  if not _actif_sur_reseau(p_actif, p_reseau) then return null; end if;
  perform 1 from comptes where id = v_compte for no key update;
  select adresse into v_adresse from adresses_crypto where compte_id = v_compte and actif = p_actif and reseau = p_reseau;
  if found then return v_adresse; end if;
  select * into v_libre from adresses_libres where actif = p_actif and reseau = p_reseau order by id for update skip locked limit 1;
  if not found then return null; end if;
  delete from adresses_libres where id = v_libre.id;
  insert into adresses_crypto (compte_id, actif, reseau, adresse, indice) values (v_compte, p_actif, p_reseau, v_libre.adresse, v_libre.indice)
  on conflict (compte_id, actif, reseau) do update set adresse = adresses_crypto.adresse
  returning adresse into v_adresse;
  return v_adresse;
end $function$;

create or replace function chaine_adresses(p_reseau text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'attribuees', coalesce((select jsonb_agg(jsonb_build_object('adresse', a.adresse, 'actif', a.actif, 'indice', a.indice, 'compte_id', a.compte_id))
                              from adresses_crypto a where a.reseau = p_reseau), '[]'::jsonb),
    -- une réserve d'adresses par actif que le réseau porte (l'USDC sur BNB Chain et Ethereum)
    'libres', (select coalesce(jsonb_object_agg(a, (select count(*) from adresses_libres l where l.reseau = p_reseau and l.actif = a)), '{}'::jsonb)
                 from unnest(coalesce((select actifs from reseaux where id = p_reseau), array['XAFe', 'USDT'])) a),
    -- la réserve aussi se surveille : un dépôt sur une adresse jamais montrée ne crédite personne, mais il se voit
    'reserve', coalesce((select jsonb_agg(jsonb_build_object('adresse', l.adresse, 'actif', l.actif, 'indice', l.indice))
                           from adresses_libres l where l.reseau = p_reseau), '[]'::jsonb),
    'indice_max', greatest((select max(indice) from adresses_libres where reseau = p_reseau),
                           (select max(indice) from adresses_crypto where reseau = p_reseau), 0))
$function$;

create or replace function chaine_ajouter_adresses(p_actif text, p_reseau text, p_adresses jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare n int;
begin
  perform _exiger_actif_sur_reseau(p_actif, p_reseau);
  insert into adresses_libres (actif, reseau, adresse, indice)
  select p_actif, p_reseau, x.adresse, x.indice from jsonb_to_recordset(p_adresses) as x(adresse text, indice int)
  on conflict (adresse) do nothing;
  get diagnostics n = row_count;
  return n;
end $function$;

-- un dépôt d'un actif que le réseau ne porte pas ne crédite personne : le veilleur ne doit jamais l'envoyer, et s'il le fait, ça se voit
create or replace function crediter_crypto(p_compte uuid, p_actif text, p_reseau text, p_montant numeric, p_tx_hash text, p_adresse text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_t transferts_crypto;
begin
  perform _exiger_actif_sur_reseau(p_actif, p_reseau);
  insert into transferts_crypto (compte_id, actif, reseau, sens, montant, adresse, tx_hash)
  values (p_compte, p_actif, p_reseau, 'entree', p_montant, p_adresse, p_tx_hash)
  on conflict (reseau, tx_hash, sens) do nothing
  returning * into v_t;
  if not found then return jsonb_build_object('deja', true); end if;
  perform _mouvement(p_compte, p_actif, p_montant, 0, 'crypto_entree', 'transferts_crypto', v_t.id::text);
  if p_actif = 'XAFe' then
    insert into emissions (sens, montant, source_table, source_id) values ('depuis_chaine', p_montant, 'transferts_crypto', v_t.id::text);
  end if;
  return jsonb_build_object('id', v_t.id, 'montant', v_t.montant);
end $function$;

create or replace function _reseaux_publics()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'norme', norme, 'famille', famille, 'natif', natif,
                                               'explorateur', _explorateur(id), 'maison', id = _reseau_de_la_reserve(),
                                               'confirmations', coalesce((parametre('crypto') -> 'confirmations' ->> id)::int,
                                                                         (parametre('chaine') -> id ->> 'confirmations')::int),
                                               -- le contrat XAFe du réseau : de quoi l'ajouter à son wallet
                                               'contrat_xafe', nullif(parametre('chaine') -> id ->> 'xafe', ''),
                                               -- 0045 : ce que le réseau porte, dans l'ordre des actifs, avec le contrat et les frais de retrait de chacun
                                               'actifs', (select coalesce(jsonb_agg(a.id order by a.ordre), '[]'::jsonb) from actifs a where a.id = any(reseaux.actifs)),
                                               'contrats', (select coalesce(jsonb_object_agg(a.id, nullif(parametre('chaine') -> reseaux.id ->> lower(a.id), '')), '{}'::jsonb)
                                                              from actifs a where a.id = any(reseaux.actifs)),
                                               'frais', (select coalesce(jsonb_object_agg(a.id, _frais_retrait(a.id, reseaux.id)), '{}'::jsonb)
                                                           from actifs a where a.id = any(reseaux.actifs)))
                            order by ordre), '[]'::jsonb)
    from reseaux where actif
$function$;

-- les règles propres à une paire : chacune facultative, chacune bornée comme dans « marche » ; une clé inconnue se refuse
create or replace function _regles_de_paire_valides(p jsonb, p_qmin numeric) returns boolean
language plpgsql stable set search_path = public as $$
declare k text; v jsonb; q numeric;
begin
  if jsonb_typeof(p) <> 'object' then return false; end if;
  for k, v in select * from jsonb_each(p) loop
    if not (k = any(_paires())) or jsonb_typeof(v) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(v) x where x not in ('ouvert', 'pas_prix', 'quantite_min', 'quantite_max', 'marche_quantite_max',
               'montant_min', 'ordres_ouverts_max', 'bande_execution', 'bande_achat', 'bande_vente', 'prix_reference', 'derive_max')) then
      return false;
    end if;
    q := coalesce((v ->> 'quantite_min')::numeric, p_qmin);
    if not ((not (v ? 'ouvert') or jsonb_typeof(v -> 'ouvert') = 'boolean')
        and (not (v ? 'pas_prix') or _nombre_entre(v -> 'pas_prix', 0.01, 100))
        and (not (v ? 'quantite_min') or _nombre_entre(v -> 'quantite_min', 0.01, 1000000))
        and (not (v ? 'quantite_max') or jsonb_typeof(v -> 'quantite_max') = 'null' or _nombre_entre(v -> 'quantite_max', q, 1e12))
        and (not (v ? 'marche_quantite_max') or jsonb_typeof(v -> 'marche_quantite_max') = 'null' or _nombre_entre(v -> 'marche_quantite_max', q, 1e12))
        and (not (v ? 'montant_min') or _nombre_entre(v -> 'montant_min', 0, 1e9))
        and (not (v ? 'ordres_ouverts_max') or _nombre_entre(v -> 'ordres_ouverts_max', 1, 10000, true))
        and (not (v ? 'bande_execution') or _nombre_entre(v -> 'bande_execution', 0.001, 0.5))
        and (not (v ? 'bande_achat') or (jsonb_typeof(v -> 'bande_achat') = 'array' and jsonb_array_length(v -> 'bande_achat') = 2
             and _nombre_entre(v -> 'bande_achat' -> 0, 0.01, 1) and _nombre_entre(v -> 'bande_achat' -> 1, 1, 100)))
        and (not (v ? 'bande_vente') or (jsonb_typeof(v -> 'bande_vente') = 'array' and jsonb_array_length(v -> 'bande_vente') = 2
             and _nombre_entre(v -> 'bande_vente' -> 0, 0.01, 1) and _nombre_entre(v -> 'bande_vente' -> 1, 1, 100)))
        and (not (v ? 'prix_reference') or jsonb_typeof(v -> 'prix_reference') = 'null' or _nombre_entre(v -> 'prix_reference', 0.01, 1e9))
        and (not (v ? 'derive_max') or _nombre_entre(v -> 'derive_max', 0.01, 0.5))) then
      return false;
    end if;
  end loop;
  return true;
end $$;

-- les frais de retrait d'un réseau : un actif qu'il porte, une somme bornée (en XAFe jusqu'à un million, en dollars jusqu'à mille)
create or replace function _frais_reseaux_valides(p jsonb) returns boolean
language plpgsql stable set search_path = public as $$
declare r text; v jsonb; a text; x jsonb;
begin
  if jsonb_typeof(p) <> 'object' then return false; end if;
  for r, v in select * from jsonb_each(p) loop
    if not exists (select 1 from reseaux where id = r) or jsonb_typeof(v) <> 'object' then return false; end if;
    for a, x in select * from jsonb_each(v) loop
      if not _actif_sur_reseau(a, r) or not _nombre_entre(x, 0, case a when 'XAFe' then 1000000 else 1000 end) then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

create or replace function _verifier_parametre(p_cle text, v jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare k text; p jsonb; ok boolean;
begin
  if jsonb_typeof(v) <> 'object' then raise exception 'paramètre invalide' using detail = 'un objet JSON est attendu'; end if;
  ok := case p_cle
    when 'frais' then _nombre_entre(v -> 'placeur', 0, 0.05) and _nombre_entre(v -> 'preneur', 0, 0.05) and _nombre_entre(v -> 'sortie', 0, 0.05)
    when 'marche' then v ->> 'paire' = 'USDT/XAFe' and _nombre_entre(v -> 'pas_prix', 0.01, 100) and _nombre_entre(v -> 'quantite_min', 0.01, 1000000)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
                       -- les règles du marché (0017) : chacune facultative, chacune bornée
                       -- vide : sans plafond (0027)
                       and (not (v ? 'quantite_max') or jsonb_typeof(v -> 'quantite_max') = 'null' or _nombre_entre(v -> 'quantite_max', (v ->> 'quantite_min')::numeric, 1e12))
                       and (not (v ? 'marche_quantite_max') or jsonb_typeof(v -> 'marche_quantite_max') = 'null' or _nombre_entre(v -> 'marche_quantite_max', (v ->> 'quantite_min')::numeric, 1e12))
                       and (not (v ? 'montant_min') or _nombre_entre(v -> 'montant_min', 0, 1e9))
                       and (not (v ? 'ordres_ouverts_max') or _nombre_entre(v -> 'ordres_ouverts_max', 1, 10000, true))
                       and (not (v ? 'bande_execution') or _nombre_entre(v -> 'bande_execution', 0.001, 0.5))
                       and (not (v ? 'bande_achat') or (jsonb_typeof(v -> 'bande_achat') = 'array' and jsonb_array_length(v -> 'bande_achat') = 2
                            and _nombre_entre(v -> 'bande_achat' -> 0, 0.01, 1) and _nombre_entre(v -> 'bande_achat' -> 1, 1, 100)))
                       and (not (v ? 'bande_vente') or (jsonb_typeof(v -> 'bande_vente') = 'array' and jsonb_array_length(v -> 'bande_vente') = 2
                            and _nombre_entre(v -> 'bande_vente' -> 0, 0.01, 1) and _nombre_entre(v -> 'bande_vente' -> 1, 1, 100)))
                       and (not (v ? 'prix_reference') or jsonb_typeof(v -> 'prix_reference') = 'null' or _nombre_entre(v -> 'prix_reference', 0.01, 1e9))
                       -- 0045 : les règles propres à une paire (« USDC/XAFe »), le reste vient d'au-dessus
                       and (not (v ? 'paires') or _regles_de_paire_valides(v -> 'paires', (v ->> 'quantite_min')::numeric))
    when 'depot' then _nombre_entre(v -> 'validite_minutes', 5, 1440, true) and _nombre_entre(v -> 'grace_minutes', 0, 10080, true)
                      and (not (v ? 'declaration_complete') or jsonb_typeof(v -> 'declaration_complete') = 'boolean')
    when 'sortie' then _nombre_entre(v -> 'reprises_max', 1, 10, true)
                       and (not (v ? 'ouvertes') or jsonb_typeof(v -> 'ouvertes') = 'boolean')
                       and (not (v ? 'mode') or v ->> 'mode' in ('totem', 'manuel'))
                       and (not (v ? 'seuil_deux_personnes') or jsonb_typeof(v -> 'seuil_deux_personnes') = 'null'
                            or _nombre_entre(v -> 'seuil_deux_personnes', 1, 1e12))
                       -- 0038 : le forçage (clore sans le SMS de la puce), fermé par défaut
                       and (not (v ? 'forcage') or jsonb_typeof(v -> 'forcage') = 'boolean')
    when 'rapide' then _nombre_entre(v -> 'marge', 0, 0.2) and _nombre_entre(v -> 'validite_secondes', 5, 120, true)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
    when 'code_secret' then _nombre_entre(v -> 'essais', 1, 10, true) and _nombre_entre(v -> 'verrou_minutes', 1, 1440, true)
                       and _nombre_entre(v -> 'longueur_min', 4, 6, true) and _nombre_entre(v -> 'longueur_max', 4, 8, true)
                       and (v ->> 'longueur_min')::int <= (v ->> 'longueur_max')::int
    when 'crypto' then _nombre_entre(v -> 'frais' -> 'USDT', 0, 1000) and _nombre_entre(v -> 'frais' -> 'XAFe', 0, 1000000)
                       and (not (v -> 'frais' ? 'USDC') or _nombre_entre(v -> 'frais' -> 'USDC', 0, 1000))
                       and (not (v -> 'confirmations' ? 'erc20') or _nombre_entre(v -> 'confirmations' -> 'erc20', 1, 1000, true))
                       and (not (v ? 'frais_reseaux') or _frais_reseaux_valides(v -> 'frais_reseaux'))
                       and _nombre_entre(v -> 'confirmations' -> 'bep20', 1, 1000, true) and _nombre_entre(v -> 'confirmations' -> 'trc20', 1, 1000, true)
                       and jsonb_typeof(v -> 'retraits_ouverts') = 'boolean'
                       and (not (v ? 'depots_ouverts') or jsonb_typeof(v -> 'depots_ouverts') = 'boolean')
    when 'paliers' then (select bool_and(x) from (values (v ? '0'), (v ? '1'), (v ? '2')) t(x))
    when 'conditions' then coalesce(v ->> 'version', '') ~ '^\d{4}-\d{2}-\d{2}$'
    when 'support' then coalesce(v ->> 'email', '') ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'
                        and (jsonb_typeof(v -> 'whatsapp') = 'null' or coalesce(v ->> 'whatsapp', '') ~ '^\+[1-9][0-9]{7,14}$')
    when 'robots' then jsonb_typeof(v -> 'actif') = 'boolean'
                       and jsonb_typeof(v -> 'teneur') = 'object' and jsonb_typeof(v -> 'traders') = 'object' and jsonb_typeof(v -> 'derive') = 'object'
                       and _nombre_entre(v -> 'teneur' -> 'ecart', 0.0005, 0.05) and _nombre_entre(v -> 'teneur' -> 'niveaux', 1, 20, true)
                       and _nombre_entre(v -> 'teneur' -> 'pas', 0, 0.02) and _nombre_entre(v -> 'teneur' -> 'taille_usdt', 10, 100000)
                       and _nombre_entre(v -> 'teneur' -> 'tolerance', 0, 0.01) and _nombre_entre(v -> 'teneur' -> 'inventaire', 0, 0.05)
                       and _nombre_entre(v -> 'traders' -> 'probabilite', 0, 1) and _nombre_entre(v -> 'traders' -> 'taille_min', 10, 100000)
                       and _nombre_entre(v -> 'traders' -> 'taille_max', 10, 100000)
                       and (v -> 'traders' ->> 'taille_min')::numeric <= (v -> 'traders' ->> 'taille_max')::numeric
                       and _nombre_entre(v -> 'traders' -> 'part_preneur', 0, 1) and _nombre_entre(v -> 'traders' -> 'duree_minutes', 1, 1440, true)
                       and _nombre_entre(v -> 'traders' -> 'ordres_max', 0, 50, true)
                       and _nombre_entre(v -> 'derive' -> 'volatilite', 0, 0.01) and _nombre_entre(v -> 'derive' -> 'rappel', 0, 1)
                       and _nombre_entre(v -> 'derive' -> 'borne', 0, 0.1) and _nombre_entre(v -> 'derive' -> 'choc_probabilite', 0, 0.1)
                       and _nombre_entre(v -> 'derive' -> 'choc_max', 0, 0.05)
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
    -- 0039 : la garde des faux SMS, par la continuité des soldes
    when 'continuite' then coalesce(v ->> 'mode', '') in ('exiger', 'surveiller', 'eteinte') and coalesce(v ->> 'demo', '') in ('exiger', 'surveiller', 'eteinte')
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
end $function$;

create or replace function parametres_publics()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_aal2();
  return (
  select jsonb_build_object(
    'frais', parametre('frais'),
    'marche', _marche() || jsonb_build_object('reference', _prix_reference()),
    -- 0045 : chaque paire, ses règles et sa référence ; et les actifs, avec leurs décimales
    'paires', to_jsonb(_paires()),
    'marches', (select coalesce(jsonb_object_agg(p, _marche(p) || jsonb_build_object('reference', _prix_reference(p))), '{}'::jsonb) from unnest(_paires()) p),
    'actifs', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'decimales', decimales) order by ordre), '[]'::jsonb) from actifs),
    'paliers', parametre('paliers'),
    'rapide', jsonb_build_object('marge', parametre('rapide') -> 'marge', 'ouvert', coalesce((parametre('rapide') ->> 'ouvert')::boolean, false),
                                 'validite_secondes', parametre('rapide') -> 'validite_secondes'),
    'crypto', jsonb_build_object('frais', parametre('crypto') -> 'frais',
                                 'retraits_ouverts', coalesce((parametre('crypto') ->> 'retraits_ouverts')::boolean, false),
                                 'depots_ouverts', coalesce((parametre('crypto') ->> 'depots_ouverts')::boolean, true),
                                 'reseaux', _reseaux_publics()),
    'sortie', jsonb_build_object('ouvertes', coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true),
                                 'mode', coalesce(parametre('sortie') ->> 'mode', 'totem')),
    'numeros', jsonb_build_object('verification_sms', coalesce((parametre('numeros') ->> 'verification_sms')::boolean, true),
                                  'delai_heures', coalesce((parametre('numeros') ->> 'delai_heures')::int, 24)),
    'operateurs', (select jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'plafond_par_transfert', plafond_par_transfert,
                                                       'plafond_jour', plafond_jour) order by id) from operateurs),
    -- la bêta : ce que l'écran annonce, la dotation d'un nouveau testeur, et si CE compte peut payer en vrai
    'beta', jsonb_build_object('actif', coalesce((parametre('beta') ->> 'actif')::boolean, false),
                               'message', parametre('beta') ->> 'message',
                               'message_en', parametre('beta') ->> 'message_en',
                               'dotation', parametre('beta') -> 'dotation',
                               'depots_reels', _depots_reels_ouverts(auth.uid()),
                               -- un float de démo TOTEM est branché : dépôts et retraits s'ouvrent vers la démo (0028)
                               'demo_totem', exists (select 1 from floats f join terminaux t on t.id = f.terminal
                                                      where f.actif and t.demo)),
    'conditions', parametre('conditions'),
    'support', parametre('support'))
   where auth.uid() is not null
  );
end $function$;

drop function if exists admin_marche();
create or replace function admin_marche(p_paire text default null)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare r jsonb; v_paire text;
begin
  perform _exiger_droit('voir');
  v_paire := _paire(p_paire);
  select jsonb_build_object(
    'paire', v_paire, 'paires', to_jsonb(_paires()),
    'cotation', cotation(v_paire), 'carnet', carnet(20, v_paire), 'transactions', transactions_recentes(30, v_paire),
    'ordres_ouverts', (select count(*) from ordres where paire = v_paire and etat in ('ouvert', 'partiel')),
    'parametres', parametre('marche'), 'regles', _marche(v_paire), 'frais', parametre('frais'),
    'chandelles', chandelles(60, 48, v_paire))
    into r;
  return r;
end $function$;
revoke execute on function admin_marche(text) from public, anon;
grant execute on function admin_marche(text) to authenticated;

create or replace function admin_tableau()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select jsonb_build_object(
    'circulation', circulation(),
    'circulation_chaine', circulation_chaine(),
    'soldes', (select coalesce(jsonb_object_agg(actif, jsonb_build_object('disponible', d, 'bloque', b)), '{}'::jsonb)
                 from (select actif, sum(disponible) d, sum(bloque) b from soldes where compte_id <> compte_maison() group by actif) s),
    'maison', (select coalesce(jsonb_object_agg(actif, disponible), '{}'::jsonb) from soldes where compte_id = compte_maison()),
    'comptes', (select count(*) from comptes where not maison and genre = 'client'),
    'jour', jsonb_build_object(
      'entrees', (select coalesce(sum(montant), 0) from depot_declarations where etat = 'credite' and credite_le >= debut_du_jour()),
      'sorties', (select coalesce(sum(montant_envoye), 0) from sorties where cree_le >= debut_du_jour()),
      'volume_usdt', (select coalesce(sum(quantite), 0) from executions where paire = 'USDT/XAFe' and cree_le >= debut_du_jour()),
      'volumes', (select coalesce(jsonb_object_agg(p, (select coalesce(sum(quantite), 0) from executions where paire = p and cree_le >= debut_du_jour())), '{}'::jsonb)
                    from unnest(_paires()) p),
      'frais_xafe', (select coalesce(sum(disponible_delta), 0) from ecritures where compte_id = compte_maison() and actif = 'XAFe' and cree_le >= debut_du_jour())),
    'retenues', (select jsonb_build_object('nombre', count(*), 'montant', coalesce(sum(montant), 0)) from entrees_retenues where etat = 'retenue'),
    'sorties_en_cours', (select count(*) from sorties where etat in ('en_attente', 'en_cours')),
    'declarations_attendues', (select count(*) from depot_declarations where etat = 'attendu'),
    'verifications', (select count(*) from comptes where verification_en_cours is not null),
    'terminaux', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'lieu', lieu, 'vu_le', vu_le,
                                   'muet', vu_le is null or vu_le < now() - interval '10 minutes') order by id), '[]'::jsonb) from terminaux),
    'floats', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'operateur', f.operateur, 'numero', f.numero, 'terminal', f.terminal,
                                   'code_agent', f.code_agent, 'actif', f.actif,
                                   'dossiers_ouverts', (select count(*) from depots d where d.float_id = f.id and d.etat = 'en_attente')) order by f.id), '[]'::jsonb) from floats f),
    'cotation', cotation())
  into r;
  return r;
end $function$;

create or replace function admin_wallets()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select jsonb_build_object(
    'reseaux', coalesce((select jsonb_agg(jsonb_build_object(
        'reseau', n.id, 'nom', n.nom, 'actif', n.actif,
        'etat', e.etat, 'maj_le', e.maj_le,
        'muet', e.maj_le is null or e.maj_le < now() - interval '2 minutes',
        'adresses_attribuees', (select count(*) from adresses_crypto a where a.reseau = n.id),
        'adresses_libres', (select count(*) from adresses_libres l where l.reseau = n.id),
        'actifs', to_jsonb(n.actifs),
        'libres', (select coalesce(jsonb_object_agg(a, (select count(*) from adresses_libres l where l.reseau = n.id and l.actif = a)), '{}'::jsonb) from unnest(n.actifs) a),
        'retraits_en_cours', (select count(*) from retraits_crypto x where x.reseau = n.id and x.etat in ('en_attente', 'en_cours')),
        'retraits_remplaces', (select count(*) from retraits_crypto x where x.reseau = n.id and cardinality(x.tx_remplacees) > 0),
        'curseur', (select bloc from chaine_curseurs c where c.reseau = n.id)) order by n.ordre)
      -- les réseaux qui veillent ou que les clients voient ; les autres n'ont rien à montrer
      from reseaux n left join chaine_etats e on e.reseau = n.id
     where n.actif or _reseau_configure(n.id)), '[]'::jsonb),
    'orphelins', coalesce((select jsonb_agg(jsonb_build_object('reseau', o.reseau, 'actif', o.actif, 'adresse', o.adresse, 'montant', o.montant, 'preuve', o.preuve, 'raison', o.raison, 'vu_le', o.vu_le) order by o.vu_le desc)
                             from chaine_orphelins o), '[]'::jsonb),
    'du_usdt', (select coalesce(sum(disponible + bloque), 0) from soldes where actif = 'USDT' and compte_id <> compte_maison()),
    'maison_usdt', (select coalesce(sum(disponible + bloque), 0) from soldes where actif = 'USDT' and compte_id = compte_maison()),
    'du_usdc', (select coalesce(sum(disponible + bloque), 0) from soldes where actif = 'USDC' and compte_id <> compte_maison()),
    'maison_usdc', (select coalesce(sum(disponible + bloque), 0) from soldes where actif = 'USDC' and compte_id = compte_maison()))
    into r;
  return r;
end $function$;

create or replace function admin_clients(p_recherche text DEFAULT NULL::text, p_n integer DEFAULT 100, p_filtre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb; v_q text := nullif(trim(coalesce(p_recherche, '')), ''); v_chiffres text;
begin
  perform _exiger_droit('clients');
  v_chiffres := regexp_replace(coalesce(v_q, ''), '[^0-9]', '', 'g');
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'entreprise', c.entreprise, 'palier', c.palier,
                            'email', c.email, 'ville', c.ville, 'pays', c.pays, 'genre', c.genre,
                            'verification_en_cours', c.verification_en_cours, 'cree_le', c.cree_le, 'desactive_le', c.desactive_le,
                            'derniere_operation', c.derniere_operation, 'derniere_connexion', _derniere_connexion(c.id),
                            'xafe', (select coalesce(disponible + bloque, 0) from soldes where compte_id = c.id and actif = 'XAFe'),
                            'usdt', (select coalesce(disponible + bloque, 0) from soldes where compte_id = c.id and actif = 'USDT'),
                            'usdc', (select coalesce(disponible + bloque, 0) from soldes where compte_id = c.id and actif = 'USDC')) order by c.cree_le desc), '[]'::jsonb)
    into r
    from (select x.*, _derniere_operation(x.id) derniere_operation from comptes x where not x.maison
             -- les robots du marché et les comptes de test ont leur propre filtre ; ailleurs, seuls les vrais clients
             and x.genre = case p_filtre when 'robots' then 'robot' when 'tests' then 'test' else 'client' end
             and (p_filtre is null or p_filtre in ('robots', 'tests')
                  or (p_filtre = 'verifications' and x.verification_en_cours is not null)
                  or (p_filtre = 'desactives' and x.desactive_le is not null)
                  or (p_filtre = 'nouveaux' and x.cree_le > now() - interval '7 days')
                  or (p_filtre = 'actifs' and x.desactive_le is null and exists (select 1 from ecritures e where e.compte_id = x.id and e.cree_le > now() - interval '30 days'))
                  or (p_filtre = 'inactifs' and x.desactive_le is null and not exists (select 1 from ecritures e where e.compte_id = x.id and e.cree_le > now() - interval '30 days')))
             and (v_q is null
                  or (length(v_chiffres) >= 3 and regexp_replace(coalesce(x.telephone, ''), '[^0-9]', '', 'g') like '%' || v_chiffres || '%')
                  or x.nom ilike '%' || v_q || '%' or x.entreprise ilike '%' || v_q || '%' or x.email ilike '%' || v_q || '%'
                  or x.ville ilike '%' || v_q || '%')
           order by x.cree_le desc limit least(greatest(coalesce(p_n, 100), 1), 500)) c;
  return r;
end $function$;

create or replace function admin_reseaux()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  perform _exiger_droit('voir');
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'nom', r.nom, 'norme', r.norme, 'famille', r.famille, 'chain_id', r.chain_id, 'natif', r.natif,
      'actif', r.actif, 'maison', r.id = _reseau_de_la_reserve(), 'configure', _reseau_configure(r.id),
      'lisible', _reseau_lisible(r.famille), 'explorateur', _explorateur(r.id), 'contrat', parametre('chaine') -> r.id ->> 'xafe',
      'note', r.note, 'actifs', to_jsonb(r.actifs),
      'adresses_attribuees', (select count(*) from adresses_crypto a where a.reseau = r.id),
      'retraits_en_cours', (select count(*) from retraits_crypto x where x.reseau = r.id and x.etat in ('en_attente', 'en_cours'))) order by r.ordre), '[]'::jsonb)
    from reseaux r);
end $function$;
