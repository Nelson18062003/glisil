-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0026 · un marché profond, vivant, et du capital pour trader  ║
-- ║                                                                        ║
-- ║  Ce que les premiers testeurs ont vu, et qui n'allait pas :            ║
-- ║    · UN CARNET MINCE : le teneur de marché (0023) posait cinq niveaux  ║
-- ║      de 100 à 400 USDT. Il en pose maintenant VINGT de chaque côté,    ║
-- ║      serrés près du prix (écart 0,15 %, un niveau tous les 0,06 %), et ║
-- ║      qui grossissent en s'éloignant (250 USDT au premier, 3 100 au     ║
-- ║      vingtième) : ≈ 33 500 USDT de chaque côté ;                       ║
-- ║    · UN PRIX QUI NE BOUGE PAS : la dérive était trop sage. Elle est    ║
-- ║      trois fois plus vive, les nouvelles un peu plus fréquentes, et    ║
-- ║      les traders agissent plus souvent, un peu plus gros ;             ║
-- ║    · TROP PEU DE CAPITAL : 1 M XAFe et 2 000 USDT ne laissaient        ║
-- ║      acheter que 1 700 USDT. Chaque testeur reçoit maintenant 20 000   ║
-- ║      USDT (un complément de 18 000 pour ceux déjà inscrits).           ║
-- ║                                                                        ║
-- ║  Pourquoi l'USDT et pas des XAFe : chaque XAFe est frappé sur la       ║
-- ║  chaîne d'essai, et le contrat plafonne la frappe à 50 M par jour —    ║
-- ║  un garde-fou qu'on ne relève pas pour la bêta. L'USDT de test, lui,   ║
-- ║  ne vit que dans le registre : un testeur qui veut des XAFe les        ║
-- ║  achète au marché, comme un vrai client. Le teneur reçoit 10 M XAFe    ║
-- ║  de plus (sous le plafond du jour) et 50 000 USDT.                     ║
-- ║                                                                        ║
-- ║  Un réglage n'est réécrit que s'il est encore celui de 0021 / 0023 :   ║
-- ║  ce que l'équipe a changé n'est jamais écrasé.                         ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- les robots : carnet profond, prix plus vivant
update parametres set valeur = jsonb_build_object(
    'actif', valeur -> 'actif',
    'teneur',  '{"ecart": 0.0015, "niveaux": 20, "pas": 0.0006, "taille_usdt": 250, "tolerance": 0.0005, "inventaire": 0.01}'::jsonb,
    'traders', '{"probabilite": 0.12, "taille_min": 15, "taille_max": 600, "part_preneur": 0.6, "duree_minutes": 20, "ordres_max": 4}'::jsonb,
    'derive',  '{"volatilite": 0.0004, "rappel": 0.002, "borne": 0.03, "choc_probabilite": 0.002, "choc_max": 0.01}'::jsonb)
 where cle = 'robots'
   and valeur - 'actif' = '{"teneur":  {"ecart": 0.004, "niveaux": 5, "pas": 0.0015, "taille_usdt": 120, "tolerance": 0.0006, "inventaire": 0.01},
                            "traders": {"probabilite": 0.05, "taille_min": 15, "taille_max": 350, "part_preneur": 0.6, "duree_minutes": 20, "ordres_max": 4},
                            "derive":  {"volatilite": 0.00013, "rappel": 0.002, "borne": 0.02, "choc_probabilite": 0.0007, "choc_max": 0.008}}'::jsonb;

-- la dotation d'un nouvel inscrit : 1 M XAFe et 20 000 USDT
update parametres set valeur = jsonb_set(valeur, '{dotation}', '{"XAFe": 1000000, "USDT": 20000}')
 where cle = 'beta' and valeur -> 'dotation' = '{"XAFe": 1000000, "USDT": 2000}'::jsonb;

-- Un teneur neuf reçoit tout d'un coup (0023 donnait 12 M XAFe et 20 000 USDT)
create or replace function _doter_les_robots() returns int
language plpgsql set search_path = public as $$
declare b robots; n int := 0;
begin
  if not coalesce((parametre('beta') ->> 'actif')::boolean, false) then return 0; end if;
  for b in select * from robots where not exists (select 1 from dotations_beta d where d.compte_id = robots.compte_id) order by compte_id loop
    if b.role = 'teneur' then
      perform _doter(b.compte_id, 22000000, 70000, 'robot de la bêta : teneur de marché', null);
    else
      perform _doter(b.compte_id, 400000, 700, 'robot de la bêta : trader', null);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

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
  -- La tolérance grandit avec la distance (0026) : le vingtième niveau ne se
  -- recote pas à chaque frémissement du prix, le premier si.
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
       and abs(o.prix - v_prixs[i]) <= v_tol * (1 + (i - 1) / 2) and o.id <> all(v_pris)
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

-- Le teneur déjà en marche (0023 : 12 M XAFe, 20 000 USDT) reçoit le
-- complément, une fois. Les testeurs déjà inscrits reçoivent 18 000 USDT,
-- une fois. Rien hors de la bêta.
do $$
declare c record;
begin
  if not coalesce((parametre('beta') ->> 'actif')::boolean, false) then return; end if;
  if exists (select 1 from dotations_beta where compte_id = _robot_teneur() and xafe = 12000000)
     and not exists (select 1 from dotations_beta where compte_id = _robot_teneur() and motif = 'robot de la bêta : carnet profond') then
    perform _doter(_robot_teneur(), 10000000, 50000, 'robot de la bêta : carnet profond', null);
  end if;
  for c in select distinct d.compte_id from dotations_beta d join comptes k on k.id = d.compte_id
            where k.genre = 'client' and not k.maison and d.motif like 'bienvenue dans la bêta%' and d.usdt = 2000
              and not exists (select 1 from dotations_beta x where x.compte_id = d.compte_id and x.motif = 'complément bêta : du capital pour trader')
  loop
    perform _doter(c.compte_id, 0, 18000, 'complément bêta : du capital pour trader', null);
  end loop;
end $$;
