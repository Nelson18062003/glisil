-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0023 · le marché vivant de la bêta : quinze robots            ║
-- ║                                                                        ║
-- ║  Un carnet vide ne se teste pas : le premier testeur n'a personne en    ║
-- ║  face. Pendant la bêta, quinze comptes « robot » animent le marché      ║
-- ║  USDT/XAFe avec de l'argent de test (0021) :                            ║
-- ║    · UN TENEUR DE MARCHÉ cote en permanence, des deux côtés, sur        ║
-- ║      plusieurs niveaux, autour du VRAI DOLLAR (0022) — avec une petite  ║
-- ║      dérive qui revient d'elle-même vers lui, et de rares « nouvelles » ║
-- ║      qui la secouent. Quand il a trop d'USDT, il baisse ses prix pour   ║
-- ║      en vendre (et inversement) : comme un vrai teneur de marché ;      ║
-- ║    · QUATORZE TRADERS, chacun son humeur, achètent et vendent au        ║
-- ║      hasard, au marché ou en ordres limites qu'ils retirent au bout     ║
-- ║      d'un moment.                                                       ║
-- ║  Ils passent par _placer_ordre, comme tout le monde : mêmes règles,     ║
-- ║  même bande, même file. Ils n'ont aucun passe-droit, et un testeur      ║
-- ║  qui pose un bon prix est servi par eux.                                ║
-- ║                                                                        ║
-- ║  Ils ne vivent QUE pendant la bêta : bêta éteinte, ou paramètre         ║
-- ║  « robots » éteint, le tour suivant retire tous leurs ordres et ils     ║
-- ║  s'arrêtent. La production est un environnement neuf, sans eux          ║
-- ║  (docs/BETA.md). Un tour toutes les trente secondes (pg_cron).          ║
-- ╚════════════════════════════════════════════════════════════════════════╝

insert into parametres (cle, valeur) values ('robots', '{"actif": true,
  "teneur":  {"ecart": 0.004, "niveaux": 5, "pas": 0.0015, "taille_usdt": 120, "tolerance": 0.0006, "inventaire": 0.01},
  "traders": {"probabilite": 0.05, "taille_min": 15, "taille_max": 350, "part_preneur": 0.6, "duree_minutes": 20, "ordres_max": 4},
  "derive":  {"volatilite": 0.00013, "rappel": 0.002, "borne": 0.02, "choc_probabilite": 0.0007, "choc_max": 0.008}}')
on conflict (cle) do nothing;

-- Les robots se disent : le bandeau de la bêta l'annonce (s'il n'a pas été réécrit par l'équipe)
update parametres set valeur = jsonb_set(valeur, '{message}', to_jsonb((valeur ->> 'message') || ' Le marché est animé par des robots de test.'))
 where cle = 'beta' and valeur ->> 'message' = 'Glisil est en bêta : tout l''argent ici est de l''argent de test, sans valeur réelle. Les dépôts et les retraits réels sont fermés.';

create table if not exists robots (
  compte_id       uuid primary key references comptes(id),
  role            text not null check (role in ('teneur', 'trader')),
  biais           numeric not null default 0,          -- l'humeur d'un trader : > 0, il penche vers l'achat
  actions         bigint not null default 0,
  refus           bigint not null default 0,
  derniere_erreur text,
  maj_le          timestamptz not null default now()
);
alter table robots enable row level security;

create table if not exists robots_etat (
  id           int primary key default 1 check (id = 1),
  derive       numeric not null default 0,               -- l'écart du milieu au vrai dollar, en fraction
  tours        bigint not null default 0,
  dernier_tour timestamptz,
  dernier_choc timestamptz,
  bilan        jsonb                                      -- ce que le dernier tour a fait
);
alter table robots_etat enable row level security;
insert into robots_etat (id) values (1) on conflict (id) do nothing;

-- l'index qui permet de retrouver les écritures d'un ordre (le ménage, plus bas)
create index if not exists ecritures_source on ecritures (source_table, source_id);

-- ───────────────────────── les quinze comptes ──────────────────────────────
create or replace function _robot_teneur() returns uuid
language sql immutable set search_path = public as $$ select 'b0b00000-0000-4000-8000-000000000000'::uuid $$;

do $$
declare i int; v_id uuid;
begin
  insert into comptes (id, nom, palier, genre) values (_robot_teneur(), 'Robot · teneur de marché', 2, 'robot') on conflict (id) do nothing;
  insert into robots (compte_id, role) values (_robot_teneur(), 'teneur') on conflict (compte_id) do nothing;
  for i in 1..14 loop
    v_id := ('b0b00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    insert into comptes (id, nom, palier, genre) values (v_id, format('Robot · trader %s', lpad(i::text, 2, '0')), 2, 'robot') on conflict (id) do nothing;
    insert into robots (compte_id, role, biais) values (v_id, 'trader', round(((random() - 0.5) * 0.3)::numeric, 3)) on conflict (compte_id) do nothing;
  end loop;
end $$;

-- Leur argent de test : une fois, au premier tour qu'ils jouent pendant la bêta. 12 M XAFe et 20 000 USDT
-- pour le teneur, 400 000 XAFe et 700 USDT par trader : 17,6 M XAFe en tout,
-- frappés dans la réserve (le contrat d'essai plafonne à 50 M par jour).
create or replace function _doter_les_robots() returns int
language plpgsql set search_path = public as $$
declare b robots; n int := 0;
begin
  if not coalesce((parametre('beta') ->> 'actif')::boolean, false) then return 0; end if;
  for b in select * from robots where not exists (select 1 from dotations_beta d where d.compte_id = robots.compte_id) order by compte_id loop
    if b.role = 'teneur' then
      perform _doter(b.compte_id, 12000000, 20000, 'robot de la bêta : teneur de marché', null);
    else
      perform _doter(b.compte_id, 400000, 700, 'robot de la bêta : trader', null);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ──────────────────── annuler un ordre, pour un compte ─────────────────────
-- annuler_ordre (0001) lit auth.uid() ; un robot n'a pas de session. Le corps
-- devient _annuler_ordre(compte, ordre), et annuler_ordre l'appelle pour soi.
create or replace function _annuler_ordre(p_compte uuid, p_id uuid)
returns jsonb language plpgsql set search_path = public as $$
declare v_o ordres;
begin
  perform pg_advisory_xact_lock(hashtext((parametre('marche') ->> 'paire')));
  select * into v_o from ordres where id = p_id and compte_id = p_compte for update;
  if not found then raise exception 'ordre inconnu'; end if;
  if v_o.etat not in ('ouvert', 'partiel') then raise exception 'cet ordre ne peut plus être annulé' using detail = v_o.etat; end if;
  if v_o.bloque > 0 then
    if v_o.cote = 'achat' then
      perform _mouvement(v_o.compte_id, 'XAFe', v_o.bloque, -v_o.bloque, 'ordre_libere', 'ordres', v_o.numero::text);
    else
      perform _mouvement(v_o.compte_id, 'USDT', v_o.bloque, -v_o.bloque, 'ordre_libere', 'ordres', v_o.numero::text);
    end if;
  end if;
  update ordres set etat = 'annule', restant = 0, bloque = 0, maj_le = now() where id = v_o.id returning * into v_o;
  return _ordre_json(v_o);
end $$;

create or replace function annuler_ordre(p_id uuid)
returns jsonb language sql security definer set search_path = public as $$
  select _annuler_ordre(auth.uid(), p_id)
$$;

-- ─────────────────────────────── un tour ───────────────────────────────────
create or replace function _gauss() returns numeric
language sql volatile set search_path = public as $$
  select (sqrt(-2 * ln(greatest(random(), 1e-12))) * cos(2 * pi() * random()))::numeric
$$;

-- Ce qu'un compte a de disponible
create or replace function _dispo(p_compte uuid, p_actif text) returns numeric
language sql stable set search_path = public as $$
  select coalesce((select disponible from soldes where compte_id = p_compte and actif = p_actif), 0)
$$;

-- Un ordre de robot : refusé, il est compté et noté, le tour continue
create or replace function _ordre_de_robot(p_compte uuid, p_cote text, p_type text, p_quantite numeric, p_prix numeric) returns boolean
language plpgsql set search_path = public as $$
declare v_det text;
begin
  perform _placer_ordre(p_compte, p_cote, p_type, p_quantite, p_prix, null, null);
  update robots set actions = actions + 1, maj_le = now() where compte_id = p_compte;
  return true;
exception when others then
  get stacked diagnostics v_det = pg_exception_detail;
  update robots set refus = refus + 1, maj_le = now(),
         derniere_erreur = left(sqlerrm || coalesce(' — ' || nullif(v_det, ''), ''), 300)
   where compte_id = p_compte;
  return false;
end $$;

-- UN TOUR. Le teneur recote (sans tout retirer : un ordre qui reste assez près
-- de son niveau garde sa place dans la file), puis chaque trader, peut-être, agit.
create or replace function tourner_les_robots() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v        jsonb := coalesce(parametre('robots'), '{}'::jsonb);
  t        jsonb := coalesce(v -> 'teneur', '{}'::jsonb);
  tr       jsonb := coalesce(v -> 'traders', '{}'::jsonb);
  d        jsonb := coalesce(v -> 'derive', '{}'::jsonb);
  v_m      jsonb := _marche();
  v_pas    numeric := (v_m ->> 'pas_prix')::numeric;
  v_qmin   numeric := (v_m ->> 'quantite_min')::numeric;
  v_e      robots_etat;
  v_ancre  numeric;
  v_milieu numeric;
  v_x      numeric;
  v_choc   boolean := false;
  v_tn     uuid := _robot_teneur();
  v_ratio  numeric;
  v_n      int := least(greatest(coalesce((t ->> 'niveaux')::int, 5), 1), 20);
  v_tol    numeric;
  v_cote   text;
  v_px     numeric;
  v_q      numeric;
  v_pris   uuid[] := '{}';
  v_cotes  text[] := '{}';
  v_prixs  numeric[] := '{}';
  v_qtes   numeric[] := '{}';
  v_tenus  boolean[] := '{}';
  v_o      ordres;
  v_id     uuid;
  b        robots;
  v_achat  numeric;
  i        int;
  v_poses  int := 0;
  v_annules int := 0;
  v_refus  int := 0;
  v_actes  int := 0;
  v_avant  bigint := (select count(*) from executions);
  v_bilan  jsonb;
begin
  -- un seul tour à la fois
  if not pg_try_advisory_xact_lock(hashtext('glisil-robots')) then return jsonb_build_object('occupe', true); end if;

  -- éteints, hors bêta, marché fermé : ils retirent tout et s'arrêtent
  if not coalesce((v ->> 'actif')::boolean, false) or not coalesce((parametre('beta') ->> 'actif')::boolean, false)
     or not coalesce((v_m ->> 'ouvert')::boolean, true) then
    for v_o in select o.* from ordres o join robots r on r.compte_id = o.compte_id where o.etat in ('ouvert', 'partiel') loop
      perform _annuler_ordre(v_o.compte_id, v_o.id);
      v_annules := v_annules + 1;
    end loop;
    update robots_etat set bilan = jsonb_build_object('actif', false, 'annules', v_annules, 'le', now()) where id = 1;
    return jsonb_build_object('actif', false, 'annules', v_annules);
  end if;

  -- leur argent de test, au premier tour
  perform _doter_les_robots();

  -- l'ancre : le vrai dollar (0022) ; à défaut, la référence du carnet
  v_ancre := coalesce((v_m ->> 'prix_reference')::numeric, _prix_reference());
  if v_ancre is null then
    update robots_etat set bilan = jsonb_build_object('actif', true, 'attente', 'aucun prix : ni cours relevé, ni échange', 'le', now()) where id = 1;
    return jsonb_build_object('actif', true, 'attente', 'aucun prix');
  end if;

  -- la dérive : elle revient vers le vrai dollar (« rappel »), bouge un peu à
  -- chaque tour (« volatilité »), et une rare nouvelle la secoue
  select * into v_e from robots_etat where id = 1 for update;
  v_x := v_e.derive * (1 - coalesce((d ->> 'rappel')::numeric, 0.002)) + coalesce((d ->> 'volatilite')::numeric, 0.00013) * _gauss();
  if random() < coalesce((d ->> 'choc_probabilite')::numeric, 0) then
    v_x := v_x + (case when random() < 0.5 then -1 else 1 end) * coalesce((d ->> 'choc_max')::numeric, 0) * (0.4 + 0.6 * random()::numeric);
    v_choc := true;
  end if;
  v_x := greatest(least(v_x, coalesce((d ->> 'borne')::numeric, 0.02)), -coalesce((d ->> 'borne')::numeric, 0.02));

  -- le stock du teneur : trop d'USDT, il baisse son milieu pour en vendre ; trop de XAFe, il le monte
  select (u.tot * v_ancre) / nullif(u.tot * v_ancre + x.tot, 0) into v_ratio
    from (select coalesce(sum(disponible + bloque), 0) tot from soldes where compte_id = v_tn and actif = 'USDT') u,
         (select coalesce(sum(disponible + bloque), 0) tot from soldes where compte_id = v_tn and actif = 'XAFe') x;
  v_milieu := v_ancre * (1 + v_x - coalesce((t ->> 'inventaire')::numeric, 0.01) * (coalesce(v_ratio, 0.5) - 0.5) * 2);
  v_tol := v_milieu * coalesce((t ->> 'tolerance')::numeric, 0.0006);

  -- LE TENEUR. Pour chaque niveau voulu (achat et vente, du plus proche au
  -- plus loin), l'ordre déjà posé le plus proche — même côté, à moins de la
  -- tolérance — le tient ; le reste est retiré, puis les niveaux vides sont posés.
  for i in 0 .. v_n - 1 loop
    v_cotes := v_cotes || array['achat', 'vente'];
    v_prixs := v_prixs || array[
      floor(v_milieu * (1 - coalesce((t ->> 'ecart')::numeric, 0.004) / 2 - i * coalesce((t ->> 'pas')::numeric, 0.0015)) / v_pas) * v_pas,
      ceil(v_milieu * (1 + coalesce((t ->> 'ecart')::numeric, 0.004) / 2 + i * coalesce((t ->> 'pas')::numeric, 0.0015)) / v_pas) * v_pas];
    v_qtes := v_qtes || array[
      round(coalesce((t ->> 'taille_usdt')::numeric, 120) * (1 + 0.6 * i) * (0.85 + 0.3 * random()::numeric), 2),
      round(coalesce((t ->> 'taille_usdt')::numeric, 120) * (1 + 0.6 * i) * (0.85 + 0.3 * random()::numeric), 2)];
  end loop;
  for i in 1 .. array_length(v_cotes, 1) loop
    select o.id into v_id from ordres o
     where o.compte_id = v_tn and o.etat in ('ouvert', 'partiel') and o.cote = v_cotes[i] and o.type = 'limite'
       and abs(o.prix - v_prixs[i]) <= v_tol and o.id <> all(v_pris)
     order by abs(o.prix - v_prixs[i]), o.cree_le limit 1;
    v_tenus := v_tenus || found;
    if found then v_pris := v_pris || v_id; end if;
  end loop;
  for v_o in select * from ordres where compte_id = v_tn and etat in ('ouvert', 'partiel') and id <> all(v_pris) loop
    perform _annuler_ordre(v_tn, v_o.id);
    v_annules := v_annules + 1;
  end loop;
  for i in 1 .. array_length(v_cotes, 1) loop
    continue when v_tenus[i];
    v_q := least(v_qtes[i], case when v_cotes[i] = 'achat' then trunc(_dispo(v_tn, 'XAFe') / v_prixs[i], 2) else _dispo(v_tn, 'USDT') end);
    continue when v_q < v_qmin;
    if _ordre_de_robot(v_tn, v_cotes[i], 'limite', v_q, v_prixs[i]) then v_poses := v_poses + 1; else v_refus := v_refus + 1; end if;
  end loop;

  -- LES TRADERS. Chacun retire ses ordres trop vieux ; puis, une fois sur
  -- « probabilité », il agit : au marché (« part_preneur ») ou en ordre limite
  -- au bord du carnet. Son côté dépend de son humeur et de ce qu'il a en main.
  for b in select * from robots where role = 'trader' order by random() loop
    for v_o in select * from ordres where compte_id = b.compte_id and etat in ('ouvert', 'partiel')
                 and cree_le < now() - make_interval(mins => coalesce((tr ->> 'duree_minutes')::int, 20)) loop
      perform _annuler_ordre(b.compte_id, v_o.id);
      v_annules := v_annules + 1;
    end loop;
    continue when random() >= coalesce((tr ->> 'probabilite')::numeric, 0.05);

    b.biais := greatest(least(b.biais * 0.98 + 0.03 * _gauss(), 0.3), -0.3);
    update robots set biais = round(b.biais, 4) where compte_id = b.compte_id;
    v_ratio := (_dispo(b.compte_id, 'USDT') * v_milieu) / nullif(_dispo(b.compte_id, 'USDT') * v_milieu + _dispo(b.compte_id, 'XAFe'), 0);
    v_achat := greatest(least(0.5 + b.biais + 0.8 * (0.5 - coalesce(v_ratio, 0.5)), 0.95), 0.05);
    v_cote := case when random() < v_achat then 'achat' else 'vente' end;
    v_q := round(coalesce((tr ->> 'taille_min')::numeric, 15)
                 + (coalesce((tr ->> 'taille_max')::numeric, 350) - coalesce((tr ->> 'taille_min')::numeric, 15)) * power(random(), 2)::numeric, 2);
    v_actes := v_actes + 1;

    if random() < coalesce((tr ->> 'part_preneur')::numeric, 0.6) then
      v_q := least(v_q, case when v_cote = 'achat' then trunc(_dispo(b.compte_id, 'XAFe') / (v_milieu * 1.06), 2) else _dispo(b.compte_id, 'USDT') end);
      continue when v_q < v_qmin;
      if _ordre_de_robot(b.compte_id, v_cote, 'marche', v_q, null) then v_poses := v_poses + 1; else v_refus := v_refus + 1; end if;
    else
      continue when (select count(*) from ordres where compte_id = b.compte_id and etat in ('ouvert', 'partiel'))
                    >= coalesce((tr ->> 'ordres_max')::int, 4);
      v_px := case when v_cote = 'achat'
                   then floor(v_milieu * (1 - (0.0005 + 0.006 * random()::numeric)) / v_pas) * v_pas
                   else ceil(v_milieu * (1 + (0.0005 + 0.006 * random()::numeric)) / v_pas) * v_pas end;
      v_q := least(v_q, case when v_cote = 'achat' then trunc(_dispo(b.compte_id, 'XAFe') / v_px, 2) else _dispo(b.compte_id, 'USDT') end);
      continue when v_q < v_qmin;
      if _ordre_de_robot(b.compte_id, v_cote, 'limite', v_q, v_px) then v_poses := v_poses + 1; else v_refus := v_refus + 1; end if;
    end if;
  end loop;

  v_bilan := jsonb_build_object('actif', true, 'le', now(), 'ancre', v_ancre, 'milieu', round(v_milieu, 2), 'derive', round(v_x, 6),
                                'choc', v_choc, 'poses', v_poses, 'annules', v_annules, 'refus', v_refus, 'actes_traders', v_actes,
                                'echanges', (select count(*) from executions) - v_avant);
  update robots_etat set derive = v_x, tours = tours + 1, dernier_tour = now(),
                         dernier_choc = case when v_choc then now() else dernier_choc end, bilan = v_bilan
   where id = 1;
  return v_bilan;
end $$;

-- ─────────────────────────────── le ménage ─────────────────────────────────
-- Un robot pose et retire des milliers d'ordres par jour. Ceux qui n'ont
-- JAMAIS rien échangé ne disent rien de plus que leurs deux écritures (bloqué
-- puis libéré : zéro sur le solde) : après deux jours, ils s'effacent, avec
-- elles. Rien d'un testeur, rien qui ait échangé, ne s'efface.
create or replace function menage_des_robots() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ecr int; v_ord int; v_not int;
begin
  create temp table if not exists _vieux (id uuid, numero bigint, compte_id uuid) on commit drop;
  truncate _vieux;
  insert into _vieux
  select o.id, o.numero, o.compte_id from ordres o join robots r on r.compte_id = o.compte_id
   where o.etat = 'annule' and o.executee = 0 and o.maj_le < now() - interval '2 days'
     and not exists (select 1 from executions e where e.ordre_achat = o.id or e.ordre_vente = o.id)
     and not exists (select 1 from devis_rapides q where q.ordre_id = o.id);
  -- les écritures d'un tel ordre s'annulent deux à deux : on vérifie avant d'effacer
  delete from _vieux v where exists (
    select 1 from ecritures x where x.source_table = 'ordres' and x.source_id = v.numero::text and x.compte_id = v.compte_id
     group by x.actif having sum(x.disponible_delta) <> 0 or sum(x.bloque_delta) <> 0)
   or exists (select 1 from ecritures x where x.source_table = 'ordres' and x.source_id = v.numero::text and x.compte_id <> v.compte_id);
  delete from ecritures x using _vieux v where x.source_table = 'ordres' and x.source_id = v.numero::text and x.compte_id = v.compte_id;
  get diagnostics v_ecr = row_count;
  delete from ordres o using _vieux v where o.id = v.id;
  get diagnostics v_ord = row_count;
  delete from notifications n using robots r where n.compte_id = r.compte_id and n.cree_le < now() - interval '2 days';
  get diagnostics v_not = row_count;
  return jsonb_build_object('ordres', v_ord, 'ecritures', v_ecr, 'notifications', v_not);
end $$;

-- ───────────────────────────── ce que voit l'équipe ────────────────────────
create or replace function admin_robots() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('voir');
  return jsonb_build_object(
    'parametre', parametre('robots'),
    'etat', (select to_jsonb(e) from robots_etat e where id = 1),
    'cours', _cours_reel(),
    'reference', _prix_reference(),
    'robots', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.compte_id, 'nom', c.nom, 'role', r.role, 'biais', r.biais, 'actions', r.actions, 'refus', r.refus,
        'derniere_erreur', r.derniere_erreur, 'maj_le', r.maj_le,
        'xafe', (select coalesce(sum(disponible + bloque), 0) from soldes s where s.compte_id = r.compte_id and s.actif = 'XAFe'),
        'usdt', (select coalesce(sum(disponible + bloque), 0) from soldes s where s.compte_id = r.compte_id and s.actif = 'USDT'),
        'ordres_ouverts', (select count(*) from ordres o where o.compte_id = r.compte_id and o.etat in ('ouvert', 'partiel')))
        order by r.role desc, c.nom), '[]'::jsonb)
      from robots r join comptes c on c.id = r.compte_id),
    -- sur 24 heures : qui échange avec qui
    'echanges_24h', (select jsonb_build_object(
        'total', count(*),
        'robot_robot', count(*) filter (where ra.compte_id is not null and rv.compte_id is not null),
        'avec_un_testeur', count(*) filter (where ra.compte_id is null or rv.compte_id is null),
        'volume_usdt', coalesce(sum(e.quantite), 0))
      from executions e
      join ordres oa on oa.id = e.ordre_achat join ordres ov on ov.id = e.ordre_vente
      left join robots ra on ra.compte_id = oa.compte_id left join robots rv on rv.compte_id = ov.compte_id
     where e.cree_le > now() - interval '24 hours'));
end $$;

-- ─────────────────────────────── le rythme ─────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron absent : les robots ne tourneront pas d''eux-mêmes sur cette base';
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname in ('glisil-robots', 'glisil-menage-robots');
  perform cron.schedule('glisil-robots', '30 seconds', 'select public.tourner_les_robots()');
  perform cron.schedule('glisil-menage-robots', '23 4 * * *', 'select public.menage_des_robots()');
end $$;

-- L'équipe règle « robots » comme les autres paramètres
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
  if p_cle not in ('frais', 'marche', 'depot', 'sortie', 'paliers', 'crypto', 'code_secret', 'rapide', 'conditions', 'support', 'numeros', 'beta', 'cours', 'robots') then
    raise exception 'paramètre inconnu';
  end if;
  perform _verifier_parametre(p_cle, p_valeur);
  update parametres set valeur = p_valeur where cle = p_cle;
  if not found then raise exception 'paramètre inconnu'; end if;
  perform _journaliser('modifier_parametre', p_cle, p_valeur);
  return jsonb_build_object('ok', true);
end $$;

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on table robots, robots_etat from public, anon, authenticated;
grant all on table robots, robots_etat to service_role;
revoke all on function _robot_teneur(), _doter_les_robots(), _annuler_ordre(uuid, uuid), _gauss(), _dispo(uuid, text),
  _ordre_de_robot(uuid, text, text, numeric, numeric), tourner_les_robots(), menage_des_robots(), admin_robots() from public, anon, authenticated;
grant execute on function admin_robots() to authenticated;
grant execute on function annuler_ordre(uuid) to authenticated;
