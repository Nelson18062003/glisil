-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0021 · la bêta : de l'argent de test, jamais d'argent réel   ║
-- ║                                                                        ║
-- ║  La plateforme actuelle tourne sur des réseaux d'ESSAI (BSC Testnet,   ║
-- ║  Tron Nile) : ses XAFe et ses USDT ne valent rien hors d'elle. Elle    ║
-- ║  devient « Glisil Bêta » :                                              ║
-- ║    · chaque testeur reçoit à l'inscription une DOTATION d'argent de    ║
-- ║      test (1 000 000 XAFe + 2 000 USDT par défaut, réglable) ; l'équipe ║
-- ║      peut en donner plus (admin_doter) ;                                ║
-- ║    · les DÉPÔTS RÉELS (MoMo/OM) sont fermés, sauf pour les comptes      ║
-- ║      autorisés (argent_reel) : personne ne paie de vrais XAF pour des   ║
-- ║      XAFe de test qu'il ne pourrait pas ressortir ;                     ║
-- ║    · les sorties et les retraits crypto se ferment par leurs            ║
-- ║      interrupteurs habituels (« sortie », « crypto ») ;                 ║
-- ║    · un compte a un GENRE : client, robot (le marché animé) ou test.    ║
-- ║      Les chiffres de l'équipe ne comptent que les clients ;             ║
-- ║    · la PARITÉ compte l'argent de test à part : registre et chaîne      ║
-- ║      restent égaux (les dotations sont frappées dans la réserve), mais  ║
-- ║      les floats ne couvrent que les XAFe qui ont des XAF derrière.      ║
-- ║  Le jour de la production, c'est un environnement NEUF : rien d'ici    ║
-- ║  ne le suit (docs/BETA.md).                                             ║
-- ╚════════════════════════════════════════════════════════════════════════╝

insert into parametres (cle, valeur) values ('beta', '{"actif": true,
  "message": "Glisil est en bêta : tout l''argent ici est de l''argent de test, sans valeur réelle. Les dépôts et les retraits réels sont fermés.",
  "dotation": {"XAFe": 1000000, "USDT": 2000}, "depots_reels": false}')
on conflict (cle) do nothing;

-- ─────────────────────────── le genre d'un compte ──────────────────────────
alter table comptes add column if not exists genre text not null default 'client';
alter table comptes add column if not exists argent_reel boolean not null default false;   -- autorisé à payer en vrai pendant la bêta
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'comptes_genre_check') then
    alter table comptes add constraint comptes_genre_check check (genre in ('client', 'robot', 'test'));
  end if;
end $$;

-- ───────────────────────── les dépôts réels, fermés ────────────────────────
create or replace function _depots_reels_ouverts(p_compte uuid) returns boolean
language sql stable set search_path = public as $$
  select not coalesce((parametre('beta') ->> 'actif')::boolean, false)
      or coalesce((parametre('beta') ->> 'depots_reels')::boolean, false)
      or coalesce((select argent_reel from comptes where id = p_compte), false)
$$;

-- Un dépôt réel ouvert pendant la bêta : refusé à la source, quel que soit le chemin
create or replace function _depot_pendant_la_beta() returns trigger
language plpgsql set search_path = public as $$
begin
  if not _depots_reels_ouverts(new.compte_id) then
    raise exception 'dépôts fermés pendant la bêta'
      using detail = 'l''argent de la bêta est de l''argent de test : aucun vrai paiement n''est accepté pour l''instant';
  end if;
  return new;
end $$;
drop trigger if exists depots_pendant_la_beta on depots;
create trigger depots_pendant_la_beta before insert on depots for each row execute function _depot_pendant_la_beta();

-- ─────────────────────────── l'argent de test ──────────────────────────────
create table if not exists dotations_beta (
  id        bigint generated always as identity primary key,
  compte_id uuid not null references comptes(id),
  xafe      numeric(20,2) not null default 0 check (xafe >= 0 and xafe = round(xafe)),
  usdt      numeric(20,2) not null default 0 check (usdt >= 0),
  motif     text not null,
  par       uuid,                                     -- l'administrateur ; null : la dotation d'inscription ou un robot
  cree_le   timestamptz not null default now(),
  check (xafe > 0 or usdt > 0)
);
alter table dotations_beta enable row level security;
create index if not exists dotations_beta_du_compte on dotations_beta (compte_id, cree_le desc);

create or replace function _reference_dotation(p_id bigint) returns text
language sql immutable set search_path = public as $$ select 'XAFe-BT-' || lpad(p_id::text, 6, '0') $$;

-- Les XAFe de test émis : ce que les floats n'ont pas à couvrir
create or replace function _xafe_de_test() returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(montant), 0) from emissions where source_table = 'dotations_beta' and sens = 'emission'
$$;

-- Doter un compte. Les XAFe passent par le registre comme un dépôt (une
-- émission, donc une frappe dans la réserve, sur la chaîne d'essai) : registre
-- et chaîne restent égaux. Les USDT sont crédités au compte seulement.
create or replace function _doter(p_compte uuid, p_xafe numeric, p_usdt numeric, p_motif text, p_par uuid) returns dotations_beta
language plpgsql set search_path = public as $$
declare v_d dotations_beta; v_ref text;
begin
  if not coalesce((parametre('beta') ->> 'actif')::boolean, false) then
    raise exception 'la bêta n''est pas active' using detail = 'l''argent de test n''existe que pendant la bêta';
  end if;
  insert into dotations_beta (compte_id, xafe, usdt, motif, par) values (p_compte, coalesce(p_xafe, 0), coalesce(p_usdt, 0), p_motif, p_par)
  returning * into v_d;
  v_ref := _reference_dotation(v_d.id);
  if v_d.xafe > 0 then
    perform _mouvement(p_compte, 'XAFe', v_d.xafe, 0, 'dotation_beta', 'dotations_beta', v_ref);
    insert into emissions (sens, montant, source_table, source_id) values ('emission', v_d.xafe, 'dotations_beta', v_ref);
  end if;
  if v_d.usdt > 0 then
    perform _mouvement(p_compte, 'USDT', v_d.usdt, 0, 'dotation_beta', 'dotations_beta', v_ref);
  end if;
  return v_d;
end $$;

-- La dotation d'inscription : tout nouveau client, pendant la bêta
create or replace function _dotation_a_l_inscription() returns trigger
language plpgsql security definer set search_path = public as $$
declare v jsonb := parametre('beta'); v_x numeric; v_u numeric;
begin
  if new.maison or new.genre <> 'client' or not coalesce((v ->> 'actif')::boolean, false) then return null; end if;
  v_x := greatest(coalesce((v -> 'dotation' ->> 'XAFe')::numeric, 0), 0);
  v_u := greatest(coalesce((v -> 'dotation' ->> 'USDT')::numeric, 0), 0);
  if v_x > 0 or v_u > 0 then perform _doter(new.id, round(v_x), round(v_u, 2), 'bienvenue dans la bêta', null); end if;
  return null;
end $$;
drop trigger if exists comptes_dotation_beta on comptes;
create trigger comptes_dotation_beta after insert on comptes for each row execute function _dotation_a_l_inscription();

-- L'équipe donne de l'argent de test à un compte (droit « parametres »)
create or replace function admin_doter(p_compte uuid, p_xafe numeric, p_usdt numeric, p_motif text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_d dotations_beta;
begin
  perform _exiger_droit('parametres');
  if not exists (select 1 from comptes where id = p_compte and not maison) then raise exception 'compte inconnu'; end if;
  if coalesce(p_xafe, 0) < 0 or coalesce(p_usdt, 0) < 0 or (coalesce(p_xafe, 0) = 0 and coalesce(p_usdt, 0) = 0) then raise exception 'montant invalide'; end if;
  if coalesce(p_xafe, 0) <> round(coalesce(p_xafe, 0)) or coalesce(p_usdt, 0) <> round(coalesce(p_usdt, 0), 2) then raise exception 'montant invalide'; end if;
  if coalesce(p_xafe, 0) > 100000000 or coalesce(p_usdt, 0) > 1000000 then
    raise exception 'montant trop grand' using detail = 'au plus 100 000 000 XAFe et 1 000 000 USDT d''un coup';
  end if;
  perform 1 from comptes where id = p_compte for no key update;
  v_d := _doter(p_compte, p_xafe, p_usdt, coalesce(nullif(trim(p_motif), ''), 'dotation de l''équipe'), auth.uid());
  perform _journaliser('doter', p_compte::text, jsonb_build_object('reference', _reference_dotation(v_d.id), 'xafe', v_d.xafe, 'usdt', v_d.usdt, 'motif', v_d.motif));
  return jsonb_build_object('ok', true, 'reference', _reference_dotation(v_d.id), 'xafe', v_d.xafe, 'usdt', v_d.usdt);
end $$;

-- ─────────────────── ce qui change dans les lectures ───────────────────────
create or replace function _lignes_historique(p_compte uuid) returns table (quand timestamptz, cle text, ligne jsonb)
language sql stable set search_path = public as $$
    select coalesce(d.credite_le, d.cree_le), d.reference, jsonb_build_object('nature', 'depot', 'detail', _depot_json(d))
      from depots d where d.compte_id = p_compte and d.etat not in ('annule', 'expire')
    union all
    select s.cree_le, s.reference, jsonb_build_object('nature', 'sortie', 'detail', _sortie_json(s) || jsonb_build_object('transferts',
             (select coalesce(jsonb_agg(jsonb_build_object('etat', c.etat, 'montant_xafe', c.montant_xafe, 'montant_envoye', (c.parametres ->> 'montant')::numeric, 'reference_operateur', c.reference_operateur) order by c.id), '[]'::jsonb)
                from commandes c where c.sortie_id = s.id)))
      from sorties s where s.compte_id = p_compte
    union all
    select o.cree_le, o.id::text, jsonb_build_object('nature', 'ordre', 'detail', _ordre_json(o))
      from ordres o where o.compte_id = p_compte and (o.executee > 0 or o.etat <> 'annule')
    union all
    select r.cree_le, r.reference, jsonb_build_object('nature', 'retrait', 'detail', _retrait_json(r))
      from retraits_crypto r where r.compte_id = p_compte
    union all
    select t.cree_le, t.id::text, jsonb_build_object('nature', 'transfert', 'detail', jsonb_build_object('id', t.id, 'actif', t.actif, 'reseau', t.reseau, 'sens', t.sens, 'montant', t.montant, 'adresse', t.adresse, 'tx_hash', t.tx_hash, 'cree_le', t.cree_le))
      from transferts_crypto t where t.compte_id = p_compte and t.sens = 'entree'
    union all
    -- la bêta : l'argent de test reçu, dit comme tel
    select b.cree_le, _reference_dotation(b.id), jsonb_build_object('nature', 'dotation', 'detail', jsonb_build_object(
             'reference', _reference_dotation(b.id), 'xafe', b.xafe, 'usdt', b.usdt, 'motif', b.motif, 'cree_le', b.cree_le))
      from dotations_beta b where b.compte_id = p_compte
$$;

create or replace function parametres_publics() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'frais', parametre('frais'),
    'marche', _marche() || jsonb_build_object('reference', _prix_reference()),
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
                               'dotation', parametre('beta') -> 'dotation',
                               'depots_reels', _depots_reels_ouverts(auth.uid())),
    'conditions', parametre('conditions'),
    'support', parametre('support'))
   where auth.uid() is not null
$$;

create or replace function _parite_json(p_detail boolean) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'releve', (select to_jsonb(p) - 'detail' || jsonb_build_object('reseaux', p.detail -> 'reseaux',
                 'floats_detail', case when p_detail then p.detail -> 'floats'
                                when coalesce((parametre('parite') ->> 'publier_floats')::boolean, true)
                                then (select coalesce(jsonb_agg(jsonb_build_object('operateur', o, 'solde', s, 'annonce_le', d, 'connu', c)), '[]'::jsonb)
                                        from (select x ->> 'operateur' o, sum((x ->> 'solde')::numeric) s, min((x ->> 'annonce_le')::timestamptz) d, bool_and((x ->> 'connu')::boolean) c
                                                from jsonb_array_elements(p.detail -> 'floats') x group by 1) g) end)
                 from parite_releves p order by p.fait_le desc limit 1),
    'historique', (select coalesce(jsonb_agg(jsonb_build_object('fait_le', fait_le, 'statut', statut, 'registre', registre, 'chaine', chaine, 'ecart', ecart, 'floats', floats) order by fait_le), '[]'::jsonb)
                     from (select * from parite_releves where fait_le > now() - interval '7 days' and (extract(minute from fait_le)::int % 60) < 5 order by fait_le) h),
    -- chaque réseau où le contrat XAFe est posé : c'est leur SOMME qui se compare au registre
    'contrats', (select coalesce(jsonb_agg(jsonb_build_object('reseau', r.id, 'nom', r.nom, 'contrat', parametre('chaine') -> r.id ->> 'xafe', 'explorateur', _explorateur(r.id),
                                                       'maison', r.id = _reseau_de_la_reserve(),
                                                       'reserve', (select etat ->> 'chaud' from chaine_etats e where e.reseau = r.id)) order by r.ordre), '[]'::jsonb)
                   from reseaux r where _reseau_configure(r.id)),
    'essai', coalesce((parametre('chaine') ->> 'essai')::boolean, false),
    -- la bêta : la part du registre qui est de l'argent de test (sans XAF derrière)
    'xafe_de_test', _xafe_de_test(),
    'lignes', (select coalesce(jsonb_agg(to_jsonb(l) - case when p_detail then '{}'::text[] else array['etat_registre', 'tx_attendu', 'adresse_vue'] end order by l.depuis desc), '[]'::jsonb)
                 from (select * from _parite_lignes() order by depuis desc limit case when p_detail then 500 else 100 end) l),
    'alertes', case when p_detail then (select coalesce(jsonb_agg(to_jsonb(a) order by a.ouverte_le desc), '[]'::jsonb)
                                          from parite_alertes a where a.close_le is null or a.close_le > now() - interval '7 days')
                    else (select count(*) from parite_alertes where close_le is null and gravite <> 'attention')::text::jsonb end)
$$;

create or replace function rapprocher() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_registre numeric; v_comptes numeric := circulation(); v_wallets numeric := circulation_chaine();
  v_chaine numeric; v_offre numeric; v_en_route numeric; v_retraits_vus numeric; v_ecart numeric;
  v_floats numeric; v_couverture numeric; v_statut text; v_anomalies int := 0; v_codes text[] := '{}';
  v_fraicheur interval := make_interval(hours => coalesce((parametre('parite') ->> 'fraicheur_heures')::int, 24));
  v_reseaux int; v_a_jour int; v_floats_detail jsonb; v_lignes jsonb; v_id bigint; l record; f record;
begin
  -- un seul relevé à la fois : deux appels croisés ne se contredisent pas
  perform pg_advisory_xact_lock(hashtext('rapprocher'));
  select coalesce(sum(case sens when 'emission' then montant when 'destruction' then -montant else 0 end), 0) into v_registre from emissions;

  -- LA CHAÎNE : la somme des mouvements relus, réseau par réseau configuré ; l'offre lue au contrat au même bloc
  select count(*), count(*) filter (where a_jour) into v_reseaux, v_a_jour from _jeton_publie();
  select coalesce(sum(case genre when 'frappe' then montant else -montant end), 0) into v_chaine from chaine_mouvements_jeton
   where reseau in (select reseau from _jeton_publie());
  select sum(offre) into v_offre from _jeton_publie() where a_jour;
  if v_reseaux = 0 or v_a_jour < v_reseaux then v_offre := null; end if;

  -- CE QUI EST EN ROUTE : attendu par le registre, pas encore lu sur la chaîne (une opération refusée n'est PAS en route)
  select coalesce(sum(case genre when 'frappe' then coalesce(montant, 0) else -coalesce(montant, 0) end), 0) into v_en_route
    from _parite_lignes() where verdict in ('en_route', 'en_retard') and nature <> 'retrait';
  -- un retrait est déjà frappé vers le client mais pas encore confirmé dans le registre : la destruction de la réserve suivra
  select coalesce(sum(p.montant_vu), 0) into v_retraits_vus from _parite_lignes() p
   where p.nature = 'retrait' and p.etat_registre = 'envoye' and p.tx_vu is not null;
  -- un retrait confirmé dont la frappe n'est pas encore relue : elle compte comme en route
  v_en_route := v_en_route + (select coalesce(sum(montant), 0) from _parite_lignes() where nature = 'retrait' and etat_registre = 'confirme' and verdict in ('en_route', 'en_retard'));
  v_ecart := case when v_offre is null then null else v_chaine + v_en_route - v_retraits_vus - v_registre end;

  -- LES FLOATS : le dernier solde annoncé de chaque float actif ; un seul inconnu ou trop vieux, et le total ne se dit pas
  select jsonb_agg(jsonb_build_object('id', x.id, 'operateur', x.operateur, 'numero', x.numero, 'solde', (x.s).solde,
                                      'annonce_le', (x.s).annonce_le, 'source', (x.s).source,
                                      'connu', (x.s).id is not null and (x.s).annonce_le > now() - v_fraicheur) order by x.id),
         case when bool_and((x.s).id is not null and (x.s).annonce_le > now() - v_fraicheur) then sum((x.s).solde) end
    into v_floats_detail, v_floats
    from (select fl.id, fl.operateur, fl.numero, _solde_float(fl.id) s from floats fl where fl.actif) x;
  -- la bêta : l'argent de test (dotations) n'a pas de XAF derrière ; les floats ne couvrent que le reste
  v_couverture := v_floats - (v_registre - _xafe_de_test());

  -- LES ANOMALIES, une alerte chacune
  for l in select * from _parite_lignes() where verdict in ('en_retard', 'refusee', 'ecart', 'inconnue') loop
    v_anomalies := v_anomalies + 1;
    v_codes := v_codes || ('ligne:' || coalesce(l.reseau, '?') || ':' || coalesce(l.reference, l.tx_vu));
    perform _parite_alerter('ligne:' || coalesce(l.reseau, '?') || ':' || coalesce(l.reference, l.tx_vu),
      case l.verdict when 'inconnue' then 'grave' else 'anomalie' end,
      case l.verdict
        when 'inconnue' then format('%s de %s XAFe sur %s que le registre n''explique pas (tx %s)', l.genre, l.montant_vu, upper(l.reseau), l.tx_vu)
        when 'ecart' then format('%s : %s XAFe attendus, %s lus sur la chaîne', l.reference, l.montant, l.montant_vu)
        when 'refusee' then format('%s : %s de %s XAFe refusée par la chaîne', l.reference, l.genre, l.montant)
        else format('%s : %s de %s XAFe attendue depuis %s, absente de la chaîne', l.reference, l.genre, l.montant, to_char(l.depuis, 'DD/MM HH24:MI')) end,
      to_jsonb(l));
  end loop;
  if v_ecart is not null and v_ecart <> 0 then
    v_anomalies := v_anomalies + 1; v_codes := v_codes || 'ecart_chaine'::text;
    perform _parite_alerter('ecart_chaine', 'grave',
      format('chaîne %s + en route %s ≠ registre %s : écart de %s XAFe', v_chaine, v_en_route - v_retraits_vus, v_registre, v_ecart),
      jsonb_build_object('chaine', v_chaine, 'en_route', v_en_route, 'retraits_vus', v_retraits_vus, 'registre', v_registre, 'ecart', v_ecart));
  end if;
  -- la lecture : l'offre lue au contrat doit valoir la somme des mouvements relus, réseau par réseau
  for l in select j.reseau, j.offre, (select coalesce(sum(case genre when 'frappe' then montant else -montant end), 0)
                                        from chaine_mouvements_jeton m where m.reseau = j.reseau and m.bloc <= j.bloc) relu
             from _jeton_publie() j where j.a_jour loop
    if l.offre <> l.relu then
      v_anomalies := v_anomalies + 1; v_codes := v_codes || ('lecture:' || l.reseau);
      perform _parite_alerter('lecture:' || l.reseau, 'grave',
        format('%s : le contrat dit %s XAFe en circulation, les mouvements relus en font %s — la lecture a manqué quelque chose', upper(l.reseau), l.offre, l.relu),
        jsonb_build_object('offre', l.offre, 'relu', l.relu));
    end if;
  end loop;
  if v_couverture is not null and v_couverture < 0 then
    v_anomalies := v_anomalies + 1; v_codes := v_codes || 'couverture'::text;
    perform _parite_alerter('couverture', 'grave',
      format('les floats (%s XAF) ne couvrent pas ce qui est dû (%s XAFe, argent de test exclu) : il manque %s XAF', v_floats, v_registre - _xafe_de_test(), -v_couverture),
      jsonb_build_object('floats', v_floats, 'registre', v_registre, 'xafe_de_test', _xafe_de_test()));
  end if;
  -- ce qui empêche de conclure se dit aussi, sans crier : un float sans solde récent, une chaîne pas encore relue
  for f in select * from jsonb_to_recordset(coalesce(v_floats_detail, '[]'::jsonb)) as x(id int, operateur text, numero text, connu boolean, annonce_le timestamptz) where not x.connu loop
    v_codes := v_codes || ('float:' || f.id);
    perform _parite_alerter('float:' || f.id, 'attention',
      format('float %s %s : aucun solde annoncé depuis %s heures — TOTEM, une consultation USSD ou le relevé de l''opérateur', upper(f.operateur), f.numero,
             coalesce((parametre('parite') ->> 'fraicheur_heures'), '24')), to_jsonb(f));
  end loop;
  if v_offre is null then
    v_codes := v_codes || 'chaine_pas_a_jour'::text;
    perform _parite_alerter('chaine_pas_a_jour', 'attention', 'la lecture de la chaîne n''est pas encore à jour : l''écart ne se calcule pas encore', null);
  end if;
  -- ce qui n'est plus vrai se ferme
  update parite_alertes set close_le = now() where close_le is null and not (code = any (v_codes));

  v_statut := case when v_anomalies > 0 then 'ecart'
                   when v_offre is null or v_floats is null then 'incomplet'
                   when v_en_route <> 0 or v_retraits_vus <> 0 then 'en_cours'
                   else 'juste' end;
  select coalesce(jsonb_agg(jsonb_build_object('reseau', j.reseau, 'offre', j.offre, 'reserve', j.reserve, 'bloc', j.bloc, 'a_jour', j.a_jour, 'lu_le', j.lu_le)), '[]'::jsonb)
    into v_lignes from _jeton_publie() j;
  insert into parite_releves (registre, dans_comptes, sur_wallets, chaine, offre_lue, en_route, ecart, floats, couverture, anomalies, statut, detail)
  values (v_registre, v_comptes, v_wallets, case when v_offre is null then null else v_chaine end, v_offre, v_en_route - v_retraits_vus, v_ecart,
          v_floats, v_couverture, v_anomalies, v_statut, jsonb_build_object('reseaux', v_lignes, 'floats', coalesce(v_floats_detail, '[]'::jsonb)))
  returning id into v_id;
  -- l'historique se garde trente jours : de quoi montrer que c'était juste hier aussi
  delete from parite_releves where fait_le < now() - interval '30 days';
  return (select to_jsonb(p) from parite_releves p where p.id = v_id);
end $$;

create or replace function admin_statistiques_clients() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_inacheves int := 0;
begin
  perform _exiger_droit('clients');
  -- des personnes ont prouvé leur adresse e-mail, mais n'ont pas fini leur profil
  if to_regclass('auth.users') is not null then
    execute $q$select count(*) from auth.users u
                where u.email_confirmed_at is not null
                  and not exists (select 1 from comptes c where c.id = u.id)
                  and not exists (select 1 from administrateurs a where a.id = u.id)$q$ into v_inacheves;
  end if;
  select jsonb_build_object(
    'total',            count(*),
    'actifs_30j',       count(*) filter (where c.desactive_le is null and exists (select 1 from ecritures e where e.compte_id = c.id and e.cree_le > now() - interval '30 days')),
    'connectes_7j',     count(*) filter (where _derniere_connexion(c.id) > now() - interval '7 days'),
    'nouveaux_7j',      count(*) filter (where c.cree_le > now() - interval '7 days'),
    'nouveaux_30j',     count(*) filter (where c.cree_le > now() - interval '30 days'),
    'verifies',         count(*) filter (where c.palier >= 1),
    'en_verification',  count(*) filter (where c.verification_en_cours is not null),
    'desactives',       count(*) filter (where c.desactive_le is not null),
    'inscriptions_inachevees', v_inacheves,
    'par_pays',         (select coalesce(jsonb_object_agg(pays, n), '{}'::jsonb) from (select coalesce(pays, '?') pays, count(*) n from comptes where not maison and genre = 'client' group by 1) p),
    'inscriptions_30j', (select coalesce(jsonb_agg(jsonb_build_object('jour', j, 'n', n) order by j), '[]'::jsonb) from (
                           select d::date j, (select count(*) from comptes x where not x.maison and x.genre = 'client' and (x.cree_le at time zone 'Africa/Douala')::date = d::date) n
                             from generate_series((now() at time zone 'Africa/Douala')::date - 29, (now() at time zone 'Africa/Douala')::date, interval '1 day') d) s))
    into r from comptes c where not c.maison and c.genre = 'client';
  return r;
end $$;

create or replace function admin_clients(p_recherche text default null, p_n int default 100, p_filtre text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_q text := nullif(trim(coalesce(p_recherche, '')), ''); v_chiffres text;
begin
  perform _exiger_droit('clients');
  v_chiffres := regexp_replace(coalesce(v_q, ''), '[^0-9]', '', 'g');
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'entreprise', c.entreprise, 'palier', c.palier,
                            'email', c.email, 'ville', c.ville, 'pays', c.pays, 'genre', c.genre,
                            'verification_en_cours', c.verification_en_cours, 'cree_le', c.cree_le, 'desactive_le', c.desactive_le,
                            'derniere_operation', c.derniere_operation, 'derniere_connexion', _derniere_connexion(c.id),
                            'xafe', (select coalesce(disponible + bloque, 0) from soldes where compte_id = c.id and actif = 'XAFe'),
                            'usdt', (select coalesce(disponible + bloque, 0) from soldes where compte_id = c.id and actif = 'USDT')) order by c.cree_le desc), '[]'::jsonb)
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
end $$;

create or replace function admin_tableau() returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
      'volume_usdt', (select coalesce(sum(quantite), 0) from executions where cree_le >= debut_du_jour()),
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
end $$;

-- L'équipe règle « beta » comme les autres paramètres
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
  if p_cle not in ('frais', 'marche', 'depot', 'sortie', 'paliers', 'crypto', 'code_secret', 'rapide', 'conditions', 'support', 'numeros', 'beta') then
    raise exception 'paramètre inconnu';
  end if;
  perform _verifier_parametre(p_cle, p_valeur);
  update parametres set valeur = p_valeur where cle = p_cle;
  if not found then raise exception 'paramètre inconnu'; end if;
  perform _journaliser('modifier_parametre', p_cle, p_valeur);
  return jsonb_build_object('ok', true);
end $$;

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on table dotations_beta from public, anon, authenticated;
grant all on table dotations_beta to service_role;
revoke all on function _depots_reels_ouverts(uuid), _depot_pendant_la_beta(), _reference_dotation(bigint), _xafe_de_test(),
  _doter(uuid, numeric, numeric, text, uuid), _dotation_a_l_inscription(), admin_doter(uuid, numeric, numeric, text) from public, anon, authenticated;
grant execute on function admin_doter(uuid, numeric, numeric, text) to authenticated;
