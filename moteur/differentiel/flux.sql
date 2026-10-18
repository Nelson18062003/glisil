-- LE FLUX D'ORDRES DU TEST DIFFÉRENTIEL.
--
-- Quatre comptes, des fonds de départ, puis :graine:-tirés au sort : des
-- ordres limite et au marché, d'achat et de vente, à des prix tantôt dans la
-- bande, tantôt hors d'elle, des tailles tantôt trop grandes, des annulations.
-- Chaque geste est joué par le VRAI moteur (placer_ordre, annuler_ordre), et
-- noté : ce qui a été demandé, et ce que le moteur a répondu (accepté, ou la
-- phrase du refus). Le moteur de référence (reference.py) rejoue le même flux
-- de son côté ; differentiel.py compare les deux, au centime.
--
--   psql -v graine=0.42 -v n=1500 -f flux.sql   puis   select _diff_json();

\set ON_ERROR_STOP on
\set QUIET on

set client_min_messages = warning;
drop table if exists _diff_flux;
create table _diff_flux (seq int primary key, compte int, action text, cote text, type text, prix numeric, quantite numeric,
                         cible int, ordre_id uuid, ok boolean, erreur text);

-- un marché aux règles serrées, pour que chaque garde-fou serve souvent
update parametres set valeur = '{"paire": "USDT/XAFe", "pas_prix": 0.05, "quantite_min": 10, "ouvert": true,
  "quantite_max": 2000, "marche_quantite_max": 800, "ordres_ouverts_max": 6, "prix_reference": 600, "montant_min": 7000,
  "bande_achat": [0.8, 1.1], "bande_vente": [0.9, 1.2], "bande_execution": 0.05}' where cle = 'marche';
update parametres set valeur = '{"placeur": 0.0005, "preneur": 0.0010, "sortie": 0.005}' where cle = 'frais';

do $$
declare i int;
begin
  -- une base neuve à chaque graine : on repart d'un carnet vide
  update ordres set etat = 'annule', restant = 0, bloque = 0 where etat in ('ouvert', 'partiel');
  delete from executions;
  for i in 1 .. 4 loop
    insert into comptes (id, telephone, nom, palier)
    values (('d1ff0000-0000-0000-0000-00000000000' || i)::uuid, '67990000' || i, 'Diff ' || i, 2) on conflict do nothing;
  end loop;
end $$;

create or replace function _diff_compte(i int) returns uuid language sql immutable as $$
  select ('d1ff0000-0000-0000-0000-00000000000' || i)::uuid
$$;

-- les fonds de départ : remis à la même valeur à chaque graine
do $$
declare i int; c uuid; x numeric; u numeric;
begin
  for i in 1 .. 4 loop
    c := _diff_compte(i);
    insert into soldes (compte_id, actif) values (c, 'XAFe'), (c, 'USDT') on conflict do nothing;
    select disponible + bloque into x from soldes where compte_id = c and actif = 'XAFe';
    select disponible + bloque into u from soldes where compte_id = c and actif = 'USDT';
    update soldes set disponible = (array[2000000, 900000, 350000, 5000000])[i], bloque = 0 where compte_id = c and actif = 'XAFe';
    update soldes set disponible = (array[3000, 1200, 8000, 400])[i], bloque = 0 where compte_id = c and actif = 'USDT';
  end loop;
  update soldes set disponible = 0, bloque = 0 where compte_id = compte_maison();
end $$;

-- les variables de psql n'entrent pas dans un bloc $$ : elles passent par la session
select set_config('diff.graine', :'graine', false), set_config('diff.n', :'n', false) \gset
do $$ begin perform setseed(current_setting('diff.graine')::float); end $$;

do $$
declare
  n int := current_setting('diff.n')::int;
  k int; c int; r double precision; v_cote text; v_type text; v_prix numeric; v_q numeric; v_res jsonb;
  v_cible int; v_ordre uuid;
begin
  for k in 1 .. n loop
    c := 1 + floor(random() * 4)::int;
    perform set_config('xafe.compte', _diff_compte(c)::text, true);
    r := random();
    if r < 0.12 then
      -- annuler un de SES ordres ouverts, au hasard (ou rien à annuler)
      select f.seq, o.id into v_cible, v_ordre from _diff_flux f join ordres o on o.id = f.ordre_id
       where f.compte = c and o.etat in ('ouvert', 'partiel') order by random() limit 1;
      if v_ordre is null then continue; end if;
      begin
        perform annuler_ordre(v_ordre);
        insert into _diff_flux values (k, c, 'annuler', null, null, null, null, v_cible, v_ordre, true, null);
      exception when others then
        insert into _diff_flux values (k, c, 'annuler', null, null, null, null, v_cible, v_ordre, false, sqlerrm);
      end;
      v_ordre := null;
      continue;
    end if;
    v_cote := case when random() < 0.5 then 'achat' else 'vente' end;
    v_type := case when random() < 0.2 then 'marche' else 'limite' end;
    -- le prix : souvent près de 600, parfois loin (hors de la bande), toujours au pas de 0,05
    v_prix := case when v_type = 'marche' then null
                   when random() < 0.85 then round((600 + (random() - 0.5) * 72) / 0.5) * 0.5   -- au demi-franc : des ordres au MÊME prix, pour éprouver la priorité au premier arrivé
                   else round((600 + (random() - 0.5) * 300) / 0.05) * 0.05 end;
    -- la quantité : parfois sous le minimum, parfois au-delà des plafonds
    v_q := case when random() < 0.04 then round((random() * 9)::numeric, 2)
                when random() < 0.06 then round((2000 + random() * 500)::numeric, 2)
                when random() < 0.08 then round((800 + random() * 700)::numeric, 2)   -- au-delà du plafond d'un ordre au marché
                else round((10 + random() * 600)::numeric, 2) end;
    begin
      v_res := placer_ordre(v_cote, v_type, v_q, v_prix, 'diff-' || current_setting('diff.graine') || '-' || k);
      insert into _diff_flux values (k, c, 'placer', v_cote, v_type, v_prix, v_q, null, (v_res -> 'ordre' ->> 'id')::uuid, true, null);
    exception when others then
      insert into _diff_flux values (k, c, 'placer', v_cote, v_type, v_prix, v_q, null, null, false, sqlerrm);
    end;
  end loop;
end $$;

-- Ce que le vrai moteur a fait, en JSON : le flux et ses réponses, chaque
-- échange (par numéro de geste), l'état final des ordres et des soldes.
create or replace function _diff_json() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'depart', jsonb_build_object(
      'xafe', jsonb_build_array(2000000, 900000, 350000, 5000000), 'usdt', jsonb_build_array(3000, 1200, 8000, 400)),
    'regles', parametre('marche'), 'frais', parametre('frais'),
    'flux', (select coalesce(jsonb_agg(jsonb_build_object('seq', seq, 'compte', compte, 'action', action, 'cote', cote, 'type', type,
                                                           'prix', prix, 'quantite', quantite, 'cible', cible, 'ok', ok, 'erreur', erreur) order by seq), '[]')
               from _diff_flux),
    'executions', (select coalesce(jsonb_agg(jsonb_build_object(
                     'achat', (select seq from _diff_flux where ordre_id = e.ordre_achat and action = 'placer'),
                     'vente', (select seq from _diff_flux where ordre_id = e.ordre_vente and action = 'placer'),
                     'preneur', e.preneur, 'prix', e.prix, 'quantite', e.quantite, 'xafe', e.montant_xafe,
                     'frais_acheteur', e.frais_acheteur, 'frais_vendeur', e.frais_vendeur) order by e.id), '[]')
                   from executions e),
    'ordres', (select coalesce(jsonb_agg(jsonb_build_object('seq', f.seq, 'etat', o.etat, 'restant', o.restant, 'executee', o.executee,
                                                             'bloque', o.bloque, 'total_xafe', o.total_xafe) order by f.seq), '[]')
                 from _diff_flux f join ordres o on o.id = f.ordre_id where f.action = 'placer'),
    'soldes', (select jsonb_agg(jsonb_build_object('compte', i,
                     'xafe', (select jsonb_build_array(disponible, bloque) from soldes where compte_id = _diff_compte(i) and actif = 'XAFe'),
                     'usdt', (select jsonb_build_array(disponible, bloque) from soldes where compte_id = _diff_compte(i) and actif = 'USDT')) order by i)
                 from generate_series(1, 4) i),
    'maison', jsonb_build_object('xafe', (select disponible from soldes where compte_id = compte_maison() and actif = 'XAFe'),
                                 'usdt', (select disponible from soldes where compte_id = compte_maison() and actif = 'USDT')))
$$;
