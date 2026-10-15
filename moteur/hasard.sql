-- LE MOTEUR AU HASARD.
--
-- Les scénarios jouent les cas qu'on a imaginés. Ici, des milliers de gestes
-- tirés au sort — dépôts, SMS rejoués, payés depuis le numéro d'un autre ou
-- depuis nulle part, transaction ID qui se croisent, ordres de toutes
-- tailles, annulations, sorties, transferts qui réussissent ou échouent,
-- remboursements, retraits crypto — et APRÈS CHAQUE GESTE, les règles qui ne
-- doivent jamais casser :
--
--   I1  la somme des soldes XAFe vaut circulation()
--   I2  l'USDT ne naît que de la chaîne et n'y repart que par un retrait envoyé
--   I3  le grand livre (écritures) refait chaque solde au centime
--   I4  aucun disponible ni bloqué négatif, ni sur un solde ni sur un ordre
--   I5  un achat limite ouvert bloque exactement round(restant × prix) ;
--       une vente limite ouverte, exactement son restant
--   I6  le bloqué de chaque compte est exactement la somme de ce qui le
--       justifie : ordres ouverts, transferts pas encore faits, retraits en cours
--   I7  un SMS est crédité OU retenu, jamais les deux ; un transaction ID ne
--       crédite qu'une fois, et du montant de SON SMS
--
-- Un geste refusé par une règle métier (« solde insuffisant », « plafond »…,
-- code P0001) est normal : on continue. Toute AUTRE erreur — une contrainte
-- violée, une clé en double que la fonction n'attendait pas — est un défaut.
-- Le tirage est rejouable (setseed) ; la graine et le geste fautif sont dits.

\set ON_ERROR_STOP on
\set QUIET on

do $$
declare i int;
begin
  update terminaux set vu_le = now();
  insert into terminaux (id, nom, vu_le) values ('akwa-1', 'Akwa 1', now()), ('hasard-2', 'Hasard 2', now()) on conflict (id) do update set vu_le = now();
  insert into floats (operateur, numero, terminal) values ('mtn', '677000000', 'akwa-1'), ('om', '699000000', 'akwa-1'),
                                                          ('mtn', '677000555', 'hasard-2'), ('om', '699000555', 'hasard-2') on conflict do nothing;
  update parametres set valeur = valeur || '{"ouvert": true}' where cle = 'marche';
  update parametres set valeur = valeur || '{"retraits_ouverts": true}' where cle = 'crypto';
  for i in 1 .. 6 loop
    insert into comptes (id, telephone, nom, palier)
    values (('f0000000-0000-0000-0000-00000000000' || i)::uuid, '67890000' || i, 'Hasard ' || i, (i - 1) % 3)
    on conflict do nothing;
    insert into numeros (compte_id, operateur, numero, verifie_le, actif_des)
    values (('f0000000-0000-0000-0000-00000000000' || i)::uuid, 'mtn', '67890000' || i, now() - interval '2 days', now() - interval '1 day')
    on conflict do nothing;
    insert into codes_secrets (compte_id, empreinte)
    values (('f0000000-0000-0000-0000-00000000000' || i)::uuid, extensions.crypt('1234', extensions.gen_salt('bf', 4)))
    on conflict do nothing;
  end loop;
  insert into administrateurs (id, email, nom, role)
  values ('f0000000-0000-0000-0000-0000000000ad', 'hasard@xafe.exchange', 'Hasard', 'super_admin') on conflict do nothing;
end $$;

create table _hasard_compte (geste text primary key, reussis int not null default 0, refuses int not null default 0);

create function _hasard_invariants() returns void language plpgsql as $$
declare v text;
begin
  -- I1
  if (select coalesce(sum(disponible + bloque), 0) from soldes where actif = 'XAFe') <> circulation() then
    raise exception 'I1 soldes XAFe % ≠ circulation %', (select sum(disponible + bloque) from soldes where actif = 'XAFe'), circulation();
  end if;
  -- I2
  if (select coalesce(sum(disponible + bloque), 0) from soldes where actif = 'USDT')
     <> (select coalesce(sum(case sens when 'entree' then montant else -montant end), 0) from transferts_crypto where actif = 'USDT') then
    raise exception 'I2 USDT en soldes ≠ USDT entrés moins sortis';
  end if;
  -- I3
  select string_agg(format('%s/%s', s.compte_id, s.actif), ', ') into v
    from soldes s
    left join (select compte_id, actif, sum(disponible_delta) d, sum(bloque_delta) b from ecritures group by 1, 2) e using (compte_id, actif)
   where s.disponible <> coalesce(e.d, 0) or s.bloque <> coalesce(e.b, 0);
  if v is not null then raise exception 'I3 le grand livre ne refait pas : %', v; end if;
  -- I4
  if exists (select 1 from soldes where disponible < 0 or bloque < 0) or exists (select 1 from ordres where bloque < 0) then
    raise exception 'I4 un négatif';
  end if;
  -- I5
  select string_agg(format('ORD-%s (%s/%s %s : bloqué %s)', numero, cote, type, restant, bloque), ', ') into v
    from ordres where etat in ('ouvert', 'partiel') and type = 'limite'
     and bloque <> case cote when 'achat' then round(restant * prix, 2) else restant end;
  if v is not null then raise exception 'I5 bloqué d''ordre faux : %', v; end if;
  -- I6
  select string_agg(format('%s/%s : %s bloqué, %s justifié', s.compte_id, s.actif, s.bloque, coalesce(j.total, 0)), ', ') into v
    from soldes s
    left join (
      select compte_id, actif, sum(m) total from (
        select compte_id, case cote when 'achat' then 'XAFe' else 'USDT' end actif, bloque m from ordres where etat in ('ouvert', 'partiel')
        union all
        select s2.compte_id, 'XAFe', k.montant_xafe from commandes k join sorties s2 on s2.id = k.sortie_id where k.etat in ('en_attente', 'en_cours')
        union all
        select compte_id, actif, montant + frais from retraits_crypto where etat in ('en_attente', 'en_cours')
      ) x group by 1, 2) j using (compte_id, actif)
   where s.bloque <> coalesce(j.total, 0);
  if v is not null then raise exception 'I6 bloqué injustifié : %', v; end if;
  -- I7
  if exists (select 1 from depot_paiements p join entrees_retenues r using (terminal, source_id, empreinte) where r.etat = 'retenue') then
    raise exception 'I7 un SMS crédité ET retenu';
  end if;
  if exists (select 1 from depot_declarations x left join depot_paiements p on p.id = x.paiement_id
              where x.etat = 'credite' and (p.id is null or p.montant <> x.montant)) then
    raise exception 'I7 une déclaration créditée sans SON paiement';
  end if;
end $$;

create function _hasard(p_graine float8, p_gestes int) returns void language plpgsql as $$
declare
  comptes uuid[] := array(select ('f0000000-0000-0000-0000-00000000000' || i)::uuid from generate_series(1, 6) i);
  admin   uuid := 'f0000000-0000-0000-0000-0000000000ad';
  c uuid; g text; r jsonb; n int; ref text; tx text; x bigint; k commandes; rb remboursements;
  -- les remboursements ne réussissent que sur une retenue remboursable : on les tire plus souvent
  gestes text[] := array['depot', 'declarer', 'sms', 'sms', 'ordre', 'ordre', 'ordre', 'annuler', 'sortie', 'totem', 'totem',
                         'usdt', 'retrait', 'chaine', 'rapprocher', 'rembourser', 'rembourser', 'rembourser', 'remboursement', 'remboursement', 'remboursement',
                         'retirer', 'reaffecter', 'annuler_sortie'];
  payeurs text[] := array['678900001', '678900002', '678900003', '678900004', '678900005', '678900006', '670111222', '670333444', null];
begin
  perform setseed(p_graine);
  for n in 1 .. p_gestes loop
    c := comptes[1 + floor(random() * 6)::int];
    perform set_config('xafe.compte', c::text, true);
    tx := '2039' || lpad((floor(random() * 40))::int::text, 7, '0');     -- 40 ID : ils se croisent
    g := gestes[1 + floor(random() * cardinality(gestes))::int];
    begin
      case g
      when 'depot' then
        perform ouvrir_depot((array['mtn', 'om'])[1 + floor(random() * 2)::int], case when random() < 0.3 then 'k-h-' || floor(random() * 5) end);
      when 'declarer' then
        select reference into ref from depots where compte_id = c and etat <> 'annule' order by random() limit 1;
        if ref is null then raise exception 'rien à faire' using errcode = 'P0001'; end if;
        perform declarer_transaction(ref, tx);
      when 'sms' then
        -- le plus souvent la carte de ce boîtier ; parfois celle d'un autre, ou une inconnue
        ref := (array['akwa-1', 'hasard-2'])[1 + floor(random() * 2)::int];
        x := floor(random() * 2)::int;
        perform totem_sms_recu(ref,
                               800000 + floor(random() * 600)::bigint,               -- des source_id qui reviennent : SMS relus
                               (array['mtn', 'om'])[1 + x],
                               case when random() < 0.75 then (select numero from floats where terminal = ref and operateur = (array['mtn', 'om'])[1 + x] limit 1)
                                    else (array['677000000', '699000000', '677000555', '699000555', '670000000'])[1 + floor(random() * 5)::int] end,
                               payeurs[1 + floor(random() * 9)::int],
                               (array[null, 0, 1500, 25000, 100000, 480000, 750000])[1 + floor(random() * 7)::int],
                               tx, '…', now() - make_interval(mins => floor(random() * 20)::int));
      when 'ordre' then
        perform placer_ordre((array['achat', 'vente'])[1 + floor(random() * 2)::int],
                             (array['limite', 'limite', 'marche'])[1 + floor(random() * 3)::int],
                             round((10 + random() * 90)::numeric, 2),
                             round((595 + floor(random() * 200) * 0.05)::numeric, 2),
                             case when random() < 0.1 then 'k-o-' || floor(random() * 5) end);
      when 'annuler' then
        perform annuler_ordre((select id from ordres where compte_id = c and etat in ('ouvert', 'partiel') order by random() limit 1));
      when 'sortie' then
        perform demander_sortie((array[1000, 50000, 300000, 1200000])[1 + floor(random() * 4)::int],
                                (select id from numeros where compte_id = c and verifie_le is not null and retire_le is null limit 1),
                                case when random() < 0.2 then 'k-s-' || floor(random() * 5) end);
      when 'totem' then
        select * into k from commandes where etat in ('en_attente', 'en_cours') order by random() limit 1;
        if k.id is null then raise exception 'rien à faire' using errcode = 'P0001'; end if;
        if k.etat = 'en_attente' then k := totem_reclamer_commande(k.id, k.terminal); end if;
        perform totem_resultat_commande(k.id, k.terminal, random() < 0.6, 'hasard', null,
                                        case when random() < 0.2 then k.reprises - 1 else k.reprises end);  -- parfois un résultat d'une autre tentative
      when 'usdt' then
        perform crediter_crypto(c, 'USDT', 'bep20', round((50 + random() * 2000)::numeric, 2), '0xh' || floor(random() * 1e9)::text, 'x');
      when 'retrait' then
        perform demander_retrait_crypto((array['USDT', 'XAFe'])[1 + floor(random() * 2)::int], 'bep20',
                                        '0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21', (array[10, 100, 5000])[1 + floor(random() * 3)::int], null, '1234');
      when 'chaine' then
        select reference into ref from retraits_crypto where etat = 'en_attente' order by random() limit 1;
        if ref is null then raise exception 'rien à faire' using errcode = 'P0001'; end if;
        perform chaine_resultat_retrait(ref, random() < 0.7, '0xt' || floor(random() * 1e9)::text);
      when 'rapprocher' then
        perform set_config('xafe.compte', admin::text, true);
        select id into x from entrees_retenues where etat = 'retenue' order by random() limit 1;
        select reference into ref from depots where etat <> 'annule' order by random() limit 1;
        perform admin_rapprocher_retenue(x, ref);
      when 'rembourser' then
        perform set_config('xafe.compte', admin::text, true);
        perform admin_rembourser_retenue((select id from entrees_retenues where etat = 'retenue' order by random() limit 1), 'hasard');
      when 'retirer' then
        select x.transaction_id, d.reference into tx, ref from depot_declarations x join depots d on d.id = x.depot_id
         where x.compte_id = c and x.etat = 'attendu' order by random() limit 1;
        if ref is null then raise exception 'rien à faire' using errcode = 'P0001'; end if;
        perform retirer_declaration(ref, tx);
      when 'reaffecter' then
        perform set_config('xafe.compte', admin::text, true);
        perform admin_reaffecter_commande((select id from commandes where etat = 'en_attente' order by random() limit 1),
                                          (array['akwa-1', 'hasard-2'])[1 + floor(random() * 2)::int]);
      when 'annuler_sortie' then
        perform set_config('xafe.compte', admin::text, true);
        perform admin_annuler_sortie((select reference from sorties where etat in ('en_attente', 'en_cours') order by random() limit 1), 'hasard');
      when 'remboursement' then
        select * into rb from remboursements where etat in ('en_attente', 'en_cours') order by random() limit 1;
        if rb.id is null then raise exception 'rien à faire' using errcode = 'P0001'; end if;
        if rb.etat = 'en_attente' then rb := totem_reclamer_remboursement(rb.id, rb.terminal); end if;
        perform totem_resultat_remboursement(rb.id, rb.terminal, random() < 0.7, 'hasard');
      end case;
      insert into _hasard_compte values (g, 1, 0) on conflict (geste) do update set reussis = _hasard_compte.reussis + 1;
    exception when sqlstate 'P0001' then
      insert into _hasard_compte values (g, 0, 1) on conflict (geste) do update set refuses = _hasard_compte.refuses + 1;
    when others then
      raise exception 'graine %, geste n° % (%) : erreur inattendue % — %', p_graine, n, g, sqlstate, sqlerrm;
    end;
    begin
      perform _hasard_invariants();
    exception when others then
      raise exception 'graine %, après le geste n° % (%) : %', p_graine, n, g, sqlerrm;
    end;
  end loop;
end $$;

do $$
declare graine float8; v text;
begin
  foreach graine in array array[0.11, 0.42, 0.73] loop
    perform _hasard(graine, 1500);
  end loop;
  -- Un tirage qui ne fait rien ne prouve rien : chaque geste doit avoir RÉUSSI assez souvent.
  select string_agg(format('%s (%s réussis)', geste, reussis), ', ') into v from _hasard_compte where reussis < 20;
  assert v is null, 'des gestes presque jamais réussis : le tirage ne les a pas éprouvés — ' || v;
  select string_agg(format('%s %s/%s', geste, reussis, reussis + refuses), ' · ' order by geste) into v from _hasard_compte;
  raise notice '✓ 13.1 4 500 gestes au hasard (3 graines) : aucune des sept règles n''a cassé — %', v;
  raise notice '   % ordres exécutés en % exécutions, % SMS crédités, % retenus, % transferts faits, % remboursements faits',
    (select count(*) from ordres where executee > 0), (select count(*) from executions), (select count(*) from depot_paiements),
    (select count(*) from entrees_retenues), (select count(*) from commandes where etat = 'faite'), (select count(*) from remboursements where etat = 'fait');
end $$;
