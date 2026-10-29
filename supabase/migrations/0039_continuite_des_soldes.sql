-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0039 · la continuité des soldes : la garde des faux SMS       ║
-- ║                                                                        ║
-- ║  N'importe qui peut écrire à une puce. Un faux « Vous avez reçu        ║
-- ║  7 500 000 XAF … ID … », envoyé sous le nom de l'opérateur et suivi    ║
-- ║  de la même déclaration chez Glisil, était crédité comme un vrai       ║
-- ║  paiement. Le SMS de l'opérateur porte pourtant de quoi le démasquer : ║
-- ║  le NOUVEAU SOLDE du float. Un vrai encaissement le fait monter de son ║
-- ║  montant, au franc près ; un faussaire ne connaît pas le solde.        ║
-- ║                                                                        ║
-- ║  LA GARDE. Avant de créditer : dernier solde SÛR du float + montant   ║
-- ║  (+ commission, − frais, quand TOTEM les annonce) = nouveau solde      ║
-- ║  annoncé. Sinon — incohérent, absent, ou aucun solde sûr encore — le   ║
-- ║  SMS est RETENU, bloqué : ni crédité, ni rapproché, ni remboursé tant  ║
-- ║  que l'équipe ne l'a pas libéré (ou qu'un solde sûr ne l'explique).    ║
-- ║                                                                        ║
-- ║  UN SOLDE SÛR : une consultation USSD étiquetée par le boîtier, un     ║
-- ║  relevé déposé par l'équipe, ou un SMS déjà vérifié par la chaîne (ou  ║
-- ║  libéré par une personne qui a confirmé son solde). Un solde lu dans   ║
-- ║  un SMS seul ne sert JAMAIS d'appui : un premier faux SMS n'empoisonne ║
-- ║  pas la chaîne.                                                        ║
-- ║                                                                        ║
-- ║  Le désordre se répare seul : à chaque nouveau solde sûr, les lignes   ║
-- ║  qui suivent sont réexaminées dans l'ordre des heures. Les sorties     ║
-- ║  prolongent la chaîne, sans jamais rien bloquer. La démo est exemptée  ║
-- ║  par réglage (continuite.demo = eteinte).                              ║
-- ║                                                                        ║
-- ║  ORDRE DES VERROUS : 'sms:' (terminal, ligne) → 'float:' → 'tx:'       ║
-- ║  (opérateur, ID) → lignes. declarer_transaction ne prend jamais        ║
-- ║  'float:' : il ne touche que des retenues non bloquées, et une retenue ║
-- ║  pour son solde est bloquée.                                           ║
-- ║                                                                        ║
-- ║  La page publique arrondit les floats au million inférieur : la garde ║
-- ║  ne vaut que tant que le solde exact reste secret.                     ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────── 0 · le réglage ────────────────────────────
insert into parametres (cle, valeur) values ('continuite', '{"mode": "exiger", "demo": "eteinte"}') on conflict (cle) do nothing;
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
end $$;

-- ──────────────────────────────── 1 · les tables ───────────────────────────
alter table soldes_floats add column if not exists empreinte  text not null default '';   -- _empreinte_sms : un source_id réutilisé après réinstallation ne se confond pas
alter table soldes_floats add column if not exists fiable     boolean not null default false;  -- vrai : sert d'appui (SMS vérifié par la chaîne, ou libéré par une personne)
alter table soldes_floats add column if not exists mouvement  numeric(20,2);   -- + montant (entrée), − montant (sortie) ; null pour un solde seul
alter table soldes_floats add column if not exists frais      numeric(20,2);
alter table soldes_floats add column if not exists commission numeric(20,2);
alter table soldes_floats add column if not exists continuite text;
alter table soldes_floats add column if not exists retenue_id bigint references entrees_retenues(id);
alter table soldes_floats add column if not exists constatee_id bigint references sorties_constatees(id);
alter table soldes_floats drop constraint if exists soldes_floats_continuite_check;
alter table soldes_floats add constraint soldes_floats_continuite_check
  check (continuite in ('verifiee', 'incoherente', 'absente', 'sans_ancre', 'ignoree', 'liberee', 'rejetee'));
drop index if exists soldes_floats_un_sms;
create unique index soldes_floats_un_sms on soldes_floats (terminal, source_id, empreinte) where source = 'sms' and source_id is not null;
create index if not exists soldes_floats_a_reexaminer on soldes_floats (float_id, annonce_le, id) where source = 'sms' and not fiable and mouvement is not null;
create index if not exists soldes_floats_de_la_retenue on soldes_floats (retenue_id) where retenue_id is not null;

alter table entrees_retenues add column if not exists solde_apres   numeric(20,2);
alter table entrees_retenues add column if not exists solde_attendu numeric(20,2);
alter table entrees_retenues add column if not exists continuite    text;
alter table entrees_retenues add column if not exists ancre_id      bigint references soldes_floats(id);
alter table entrees_retenues add column if not exists liberee_par   uuid;
alter table entrees_retenues add column if not exists liberee_le    timestamptz;
alter table entrees_retenues add column if not exists note_equipe   text;
alter table entrees_retenues drop constraint if exists entrees_retenues_continuite_check;
alter table entrees_retenues add constraint entrees_retenues_continuite_check
  check (continuite in ('verifiee', 'incoherente', 'absente', 'sans_ancre', 'ignoree', 'liberee', 'rejetee'));
alter table entrees_retenues drop constraint if exists entrees_retenues_etat_check;
alter table entrees_retenues add constraint entrees_retenues_etat_check check (etat in ('retenue', 'rapprochee', 'remboursee', 'rejetee'));

alter table sorties_constatees add column if not exists solde_apres numeric(20,2);
alter table sorties_constatees add column if not exists continuite  text;

-- ───────────────────────────── 2 · la règle ────────────────────────────────
create or replace function _mode_continuite(p_terminal text) returns text
language sql stable set search_path = public as $$
  select case when coalesce((select demo from terminaux where id = p_terminal), false)
              then coalesce(parametre('continuite') ->> 'demo', 'eteinte')
              else coalesce(parametre('continuite') ->> 'mode', 'exiger') end
$$;

create or replace function _motif_continuite(p_etat text) returns text
language sql immutable set search_path = public as $$
  select case p_etat when 'incoherente' then 'solde incohérent : à vérifier'
                     when 'absente' then 'solde non annoncé : à vérifier'
                     when 'sans_ancre' then 'premier solde du float inconnu : à vérifier' end
$$;

-- Retenue POUR SON SOLDE (et non pour une autre raison, sur laquelle la continuité
-- n'est qu'un renseignement, en « surveiller ») : bloquée, avec le motif de la garde.
create or replace function _retenue_pour_le_solde(r entrees_retenues) returns boolean
language sql immutable set search_path = public as $$
  select r.etat = 'retenue' and r.bloquee and r.continuite in ('incoherente', 'absente', 'sans_ancre')
     and r.motif is not distinct from _motif_continuite(r.continuite)
$$;

-- LE JUGEMENT d'un mouvement : le solde annoncé suit-il le dernier solde sûr ?
-- VOLATILE : pendant le réexamen, elle doit voir ce que la transaction vient d'écrire.
create or replace function _continuite(p_float floats, p_sens int, p_montant numeric, p_solde numeric, p_frais numeric,
                                       p_commission numeric, p_quand timestamptz, p_exclure bigint default null) returns jsonb
language plpgsql volatile set search_path = public as $$
declare
  v_mode text := _mode_continuite(p_float.terminal);
  a1 soldes_floats; a2 soldes_floats; a soldes_floats; d numeric; i int;
  v_ecarts numeric[];
begin
  if v_mode = 'eteinte' then return jsonb_build_object('etat', 'ignoree', 'mode', v_mode); end if;
  if p_solde is null or p_solde < 0 or p_montant is null or p_montant <= 0 then
    return jsonb_build_object('etat', 'absente', 'mode', v_mode);
  end if;
  -- deux appuis : strictement avant, et jusqu'à cette heure incluse (deux SMS à la même seconde)
  select * into a1 from soldes_floats
   where float_id = p_float.id and (source in ('ussd', 'releve') or fiable) and annonce_le < p_quand and id <> coalesce(p_exclure, 0)
   order by annonce_le desc, id desc limit 1;
  select * into a2 from soldes_floats
   where float_id = p_float.id and (source in ('ussd', 'releve') or fiable) and annonce_le <= p_quand and id <> coalesce(p_exclure, 0)
   order by annonce_le desc, id desc limit 1;
  if a1.id is null and a2.id is null then return jsonb_build_object('etat', 'sans_ancre', 'mode', v_mode); end if;
  -- les écarts qu'un VRAI mouvement explique ; pas de tolérance au centime (numeric(20,2) compare exactement)
  v_ecarts := array[p_sens * p_montant];
  if p_sens = 1 and coalesce(p_commission, 0) > 0 then v_ecarts := v_ecarts || (p_montant + p_commission); end if;
  if p_sens = -1 and coalesce(p_commission, 0) > 0 then v_ecarts := v_ecarts || (-p_montant + p_commission); end if;   -- un dépôt d'agent MTN : « Commission ajoutée »
  if coalesce(p_frais, 0) > 0 then v_ecarts := v_ecarts || (p_sens * p_montant - p_frais); end if;
  for i in 1 .. 2 loop
    if i = 1 then a := a2; else a := a1; end if;
    continue when a.id is null;
    foreach d in array v_ecarts loop
      if round(a.solde + d, 2) = round(p_solde, 2) then
        return jsonb_build_object('etat', 'verifiee', 'mode', v_mode, 'ancre_id', a.id, 'ancre_solde', a.solde, 'ancre_le', a.annonce_le,
                                  'attendu', a.solde + p_sens * p_montant);
      end if;
    end loop;
  end loop;
  if a1.id is not null then a := a1; else a := a2; end if;
  return jsonb_build_object('etat', 'incoherente', 'mode', v_mode, 'ancre_id', a.id, 'ancre_solde', a.solde, 'ancre_le', a.annonce_le,
                            'attendu', a.solde + p_sens * p_montant);
end $$;

-- Le crédit d'une retenue qui vient d'être vérifiée ou libérée, dans l'ordre de
-- declarer_transaction : le verrou de l'ID d'abord, la ligne ensuite.
create or replace function _reprendre_retenue(p_id bigint, p_continuite text) returns jsonb
language plpgsql set search_path = public as $$
declare v_r entrees_retenues; v_a jsonb; v_x depot_declarations; v_op text; v_tx text;
begin
  select operateur, transaction_id into v_op, v_tx from entrees_retenues where id = p_id;
  if length(coalesce(v_tx, '')) >= 6 then perform pg_advisory_xact_lock(hashtext('tx:' || v_op || ':' || v_tx)); end if;
  select * into v_r from entrees_retenues where id = p_id for update;
  if not found then return jsonb_build_object('etat', 'inconnue'); end if;
  if v_r.etat <> 'retenue' then return jsonb_build_object('etat', v_r.etat); end if;
  update entrees_retenues set continuite = p_continuite, bloquee = false, motif = null where id = p_id returning * into v_r;
  if coalesce(v_r.montant, 0) > 0 and length(coalesce(v_r.transaction_id, '')) >= 6
     and not exists (select 1 from depot_paiements where terminal = v_r.terminal and source_id = v_r.source_id and empreinte = v_r.empreinte) then
    v_a := _apparier(v_r.operateur, v_r.transaction_id, v_r.numero_payeur, v_r.emis_le, v_r.montant,
                     coalesce((select demo from terminaux where id = v_r.terminal), false));
    if v_a ? 'id' then
      v_x := _crediter_declaration((v_a ->> 'id')::uuid, v_r.terminal, v_r.source_id, v_r.montant, v_r.numero_payeur,
                                   v_r.reference_operateur, v_r.texte, v_r.emis_le, v_r.id);
      return jsonb_build_object('credite', v_x.etat = 'credite', 'reference', (select reference from depots where id = v_x.depot_id));
    end if;
    -- sans déclaration, la retenue n'est plus bloquée : la déclaration du client la reprendra
    update entrees_retenues set motif = v_a ->> 'motif', bloquee = coalesce((v_a ->> 'bloquee')::boolean, false),
                                depot_id = coalesce((v_a ->> 'depot_id')::uuid, depot_id)
     where id = p_id;
  end if;
  return jsonb_build_object('credite', false);
end $$;

-- Le réexamen : un nouveau solde sûr peut expliquer les lignes qui suivent.
-- On ne s'arrête pas à la première qui ne passe pas : une plus tardive peut
-- s'appuyer sur un autre point d'appui. Une ligne rejetée ne revient jamais.
create or replace function _reexaminer_continuite(p_float int, p_depuis timestamptz) returns int
language plpgsql set search_path = public as $$
declare v_id bigint; v_s soldes_floats; v_f floats; v_c jsonb; n int := 0;
begin
  select * into v_f from floats where id = p_float;
  for v_id in select s.id from soldes_floats s
               where s.float_id = p_float and s.source = 'sms' and not s.fiable and s.mouvement is not null
                 and s.continuite in ('incoherente', 'sans_ancre') and s.annonce_le >= p_depuis
                 and (s.retenue_id is null or exists (select 1 from entrees_retenues r where r.id = s.retenue_id and r.etat = 'retenue'))
               order by s.annonce_le, s.id limit 500 loop
    select * into v_s from soldes_floats where id = v_id for update;
    continue when v_s.fiable;
    v_c := _continuite(v_f, sign(v_s.mouvement)::int, abs(v_s.mouvement), v_s.solde, v_s.frais, v_s.commission, v_s.annonce_le, v_s.id);
    continue when v_c ->> 'etat' <> 'verifiee';
    update soldes_floats set fiable = true, continuite = 'verifiee' where id = v_id;
    if v_s.retenue_id is not null then
      update entrees_retenues set continuite = 'verifiee', solde_attendu = (v_c ->> 'attendu')::numeric, ancre_id = (v_c ->> 'ancre_id')::bigint
       where id = v_s.retenue_id;
      perform _reprendre_retenue(v_s.retenue_id, 'verifiee');
    end if;
    if v_s.constatee_id is not null then update sorties_constatees set continuite = 'verifiee' where id = v_s.constatee_id; end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Le dernier solde SÛR du float : un faux SMS ne déplace plus la colonne « floats » de la parité.
create or replace function _solde_float(p_float int) returns soldes_floats
language sql stable set search_path = public as $$
  select * from soldes_floats where float_id = p_float and (source in ('ussd', 'releve') or fiable)
   order by annonce_le desc, id desc limit 1
$$;

-- ─────────────────────── 3 · le SMS d'argent reçu ──────────────────────────
-- Le solde décide maintenant de l'argent : il ne se note plus APRÈS lui.
drop function if exists totem_sms_recu(text, bigint, text, text, text, numeric, text, text, timestamptz);
create or replace function totem_sms_recu(p_terminal text, p_source_id bigint, p_operateur text, p_float_numero text, p_numero_payeur text,
                               p_montant numeric, p_reference text, p_texte text, p_emis_le timestamptz,
                               p_solde_apres numeric default null, p_frais numeric default null, p_commission numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_float floats;
  v_d     depots;
  v_p     depot_paiements;
  v_r     entrees_retenues;
  v_x     depot_declarations;
  v_a     jsonb := '{}'::jsonb;
  v_c     jsonb;
  v_etat  text;
  v_num   text := nullif(normaliser_numero(p_numero_payeur), '');
  v_id    text := normaliser_transaction_id(p_reference);
  v_emp   text := _empreinte_sms(p_texte, p_reference, p_montant);
  v_reutilise boolean;
  v_quand timestamptz := least(coalesce(p_emis_le, now()), now());
  v_solde numeric := case when p_solde_apres >= 0 and p_solde_apres < 1e13 then round(p_solde_apres, 2) end;
  v_sid   bigint;
  v_rep   jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('sms:' || p_terminal || ':' || p_source_id::text));
  select * into v_p from depot_paiements where terminal = p_terminal and source_id = p_source_id and empreinte = v_emp;
  if found then
    select * into v_d from depots where id = v_p.depot_id;
    return jsonb_build_object('resultat', 'credite', 'reference', v_d.reference, 'etat', v_d.etat, 'deja', true);
  end if;
  select * into v_r from entrees_retenues where terminal = p_terminal and source_id = p_source_id and empreinte = v_emp;
  if found then return jsonb_strip_nulls(jsonb_build_object('resultat', 'retenue', 'id', v_r.id, 'deja', true, 'continuite', v_r.continuite)); end if;
  v_reutilise := exists (select 1 from depot_paiements where terminal = p_terminal and source_id = p_source_id)
              or exists (select 1 from entrees_retenues where terminal = p_terminal and source_id = p_source_id);

  update terminaux set vu_le = now() where id = p_terminal;
  select * into v_float from floats
   where operateur = p_operateur and numero = normaliser_numero(p_float_numero) and terminal = p_terminal;
  if not found then
    insert into entrees_retenues (terminal, source_id, operateur, float_numero, numero_payeur, montant,
                                  reference_operateur, transaction_id, texte, emis_le, motif, bloquee, empreinte, solde_apres)
    values (p_terminal, p_source_id, p_operateur, p_float_numero, v_num, p_montant, p_reference, v_id, p_texte, p_emis_le,
            'ce numéro n''est pas un float de ce terminal : l''équipe vérifie', true, v_emp, v_solde)
    returning * into v_r;
    return jsonb_build_object('resultat', 'retenue', 'id', v_r.id, 'motif', v_r.motif);
  end if;

  -- LA GARDE : le solde annoncé suit-il le dernier solde sûr ?
  perform pg_advisory_xact_lock(hashtext('float:' || v_float.id));
  v_c := _continuite(v_float, 1, p_montant, v_solde, nullif(p_frais, 0), nullif(p_commission, 0), v_quand);
  v_etat := v_c ->> 'etat';
  if v_solde is not null then
    insert into soldes_floats (float_id, solde, annonce_le, source, terminal, source_id, empreinte, fiable, mouvement, frais, commission, continuite)
    values (v_float.id, v_solde, v_quand, 'sms', p_terminal, p_source_id, v_emp, v_etat in ('verifiee', 'ignoree'),
            p_montant, p_frais, p_commission, v_etat)
    on conflict (terminal, source_id, empreinte) where source = 'sms' and source_id is not null do nothing
    returning id into v_sid;
  end if;

  if v_c ->> 'mode' = 'exiger' and v_etat in ('incoherente', 'absente', 'sans_ancre') then
    -- retenu, BLOQUÉ : l'appariement ne tourne pas, aucune déclaration n'est touchée ni refusée
    insert into entrees_retenues (terminal, source_id, float_id, operateur, float_numero, numero_payeur, montant,
                                  reference_operateur, transaction_id, texte, emis_le, motif, bloquee, empreinte,
                                  solde_apres, solde_attendu, continuite, ancre_id)
    values (p_terminal, p_source_id, v_float.id, p_operateur, p_float_numero, v_num, p_montant, p_reference, v_id, p_texte, p_emis_le,
            _motif_continuite(v_etat), true, v_emp, v_solde, (v_c ->> 'attendu')::numeric, v_etat, (v_c ->> 'ancre_id')::bigint)
    returning * into v_r;
    if v_sid is not null then update soldes_floats set retenue_id = v_r.id where id = v_sid; end if;
    -- le client qui attend ce paiement sait qu'il est arrivé, et qu'il est vérifié
    if length(v_id) >= 6 and coalesce(p_montant, 0) > 0 then
      perform _notifier(x.compte_id, 'Paiement en vérification',
                        format('Votre paiement de %s XAF est arrivé : l''équipe le vérifie avant de créditer vos XAFe.', to_char(p_montant, 'FM999G999G999G999')),
                        '/historique/' || d.reference)
         from depot_declarations x join depots d on d.id = x.depot_id join floats f on f.id = d.float_id join terminaux t on t.id = f.terminal
        where x.operateur = p_operateur and x.transaction_id = v_id and x.etat = 'attendu'
          and coalesce(t.demo, false) = coalesce((select demo from terminaux where id = p_terminal), false);
    end if;
    return jsonb_strip_nulls(jsonb_build_object('resultat', 'retenue', 'id', v_r.id, 'motif', v_r.motif, 'continuite', v_etat,
                                                'source_id_reutilise', case when v_reutilise then true end));
  end if;

  -- vérifié, ignoré (démo), ou surveillé : l'argent suit son chemin d'avant
  if coalesce(p_montant, 0) > 0 and length(v_id) >= 6 then
    perform pg_advisory_xact_lock(hashtext('tx:' || p_operateur || ':' || v_id));
    v_a := _apparier(p_operateur, v_id, v_num, p_emis_le, p_montant,
                     coalesce((select demo from terminaux where id = p_terminal), false));
    if v_a ? 'id' then
      v_x := _crediter_declaration((v_a ->> 'id')::uuid, p_terminal, p_source_id, p_montant, v_num, p_reference, p_texte, p_emis_le, null);
      select * into v_d from depots where id = v_x.depot_id;
      if v_x.etat = 'credite' then
        v_rep := jsonb_strip_nulls(jsonb_build_object('resultat', 'credite', 'reference', v_d.reference, 'etat', v_d.etat,
                                                      'montant_recu', v_d.montant_recu, 'continuite', v_etat,
                                                      'source_id_reutilise', case when v_reutilise then true end));
      else
        v_a := jsonb_build_object('motif', v_x.motif, 'bloquee', true, 'depot_id', v_d.id);
      end if;
    end if;
  end if;

  if v_rep is null then
    insert into entrees_retenues (terminal, source_id, float_id, operateur, float_numero, numero_payeur, montant,
                                  reference_operateur, transaction_id, texte, emis_le, depot_id, motif, bloquee, empreinte,
                                  solde_apres, solde_attendu, continuite, ancre_id)
    values (p_terminal, p_source_id, v_float.id, p_operateur, p_float_numero, v_num, p_montant, p_reference, v_id, p_texte, p_emis_le,
            (v_a ->> 'depot_id')::uuid, v_a ->> 'motif', coalesce((v_a ->> 'bloquee')::boolean, false), v_emp,
            v_solde, (v_c ->> 'attendu')::numeric, v_etat, (v_c ->> 'ancre_id')::bigint)
    returning * into v_r;
    if v_sid is not null then update soldes_floats set retenue_id = v_r.id where id = v_sid; end if;
    v_rep := jsonb_strip_nulls(jsonb_build_object('resultat', 'retenue', 'id', v_r.id, 'motif', v_r.motif, 'continuite', v_etat,
                                                  'source_id_reutilise', case when v_reutilise then true end));
  end if;

  if v_etat = 'verifiee' and v_sid is not null then
    -- le message complet ferme sa moitié tronquée (même ligne du journal de TOTEM, retenue sans solde)
    if v_reutilise then
      update entrees_retenues set etat = 'rejetee', continuite = 'rejetee', motif = 'remplacé par le message complet'
       where terminal = p_terminal and source_id = p_source_id and etat = 'retenue' and continuite = 'absente'
         and empreinte <> v_emp and length(coalesce(texte, '')) >= 20 and position(texte in coalesce(p_texte, '')) > 0;
    end if;
    perform _reexaminer_continuite(v_float.id, v_quand);
  end if;
  return v_rep;
end $$;

-- ─────────────────────── 4 · le SMS sortant ────────────────────────────────
-- Il prolonge la chaîne, il ne bloque jamais rien.
drop function if exists totem_sms_sortant(text, bigint, text, text, text, numeric, text, text, timestamptz);
create or replace function totem_sms_sortant(p_terminal text, p_source_id bigint, p_operateur text, p_float_numero text,
                                  p_numero text, p_montant numeric, p_reference text, p_texte text,
                                  p_emis_le timestamptz, p_solde_apres numeric default null, p_frais numeric default null,
                                  p_commission numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_k     sorties_constatees;
  v_float floats;
  v_s     sorties;
  v_id    text := nullif(normaliser_transaction_id(p_reference), '');
  v_emp   text := _empreinte_sms(p_texte, p_reference, p_montant);
  v_num   text := nullif(normaliser_numero(p_numero), '');
  v_deja  boolean := false;
  v_quand timestamptz := least(coalesce(p_emis_le, now()), now());
  v_solde numeric := case when p_solde_apres >= 0 and p_solde_apres < 1e13 then round(p_solde_apres, 2) end;
  v_c     jsonb;
  v_sid   bigint;
begin
  if v_id is not null then perform pg_advisory_xact_lock(hashtext('sortie_tx:' || p_operateur || ':' || v_id)); end if;
  select * into v_k from sorties_constatees where terminal = p_terminal and source_id = p_source_id and empreinte = v_emp;
  if found then
    v_deja := true;
    if v_k.numero_beneficiaire is null and v_num is not null then
      update sorties_constatees set numero_beneficiaire = v_num where id = v_k.id returning * into v_k;
    end if;
  else
    update terminaux set vu_le = now() where id = p_terminal;
    select * into v_float from floats where operateur = p_operateur and numero = normaliser_numero(p_float_numero) and terminal = p_terminal;
    -- 0039 : la sortie prolonge la chaîne des soldes (elle ne bloque jamais rien)
    if v_float.id is not null then
      perform pg_advisory_xact_lock(hashtext('float:' || v_float.id));
      v_c := _continuite(v_float, -1, p_montant, v_solde, nullif(p_frais, 0), nullif(p_commission, 0), v_quand);
    end if;
    insert into sorties_constatees (terminal, source_id, empreinte, float_id, operateur, float_numero, numero_beneficiaire, montant,
                                    reference_operateur, transaction_id, texte, emis_le, sortie_id, solde_apres, continuite)
    values (p_terminal, p_source_id, v_emp, v_float.id, p_operateur, p_float_numero, v_num, p_montant,
            p_reference, v_id, p_texte, p_emis_le, null, v_solde, v_c ->> 'etat')
    on conflict (terminal, source_id, empreinte) do nothing
    returning * into v_k;
    if v_float.id is not null and v_solde is not null and v_k.id is not null then
      insert into soldes_floats (float_id, solde, annonce_le, source, terminal, source_id, empreinte, fiable, mouvement, frais, commission, continuite, constatee_id)
      values (v_float.id, v_solde, v_quand, 'sms', p_terminal, p_source_id, v_emp, (v_c ->> 'etat') in ('verifiee', 'ignoree'),
              -p_montant, p_frais, p_commission, v_c ->> 'etat', v_k.id)
      on conflict (terminal, source_id, empreinte) where source = 'sms' and source_id is not null do nothing
      returning id into v_sid;
      if v_c ->> 'etat' = 'verifiee' and v_sid is not null then perform _reexaminer_continuite(v_float.id, v_quand); end if;
    end if;
  end if;
  select s.* into v_s from sorties s
   where v_id is not null and s.operateur = p_operateur
     and (exists (select 1 from sortie_paiements p where p.sortie_id = s.id and p.operateur = p_operateur and p.transaction_id = v_id and p.retire_le is null)
          or s.transaction_id = v_id)
   limit 1;
  if v_s.id is not null and v_s.mode = 'manuel' and v_s.etat = 'en_preuve' then
    begin
      v_s := _tenter_cloture(v_s.id);
    exception when others then   -- le SMS reste noté ; la sortie reste en preuve, et dit pourquoi
      update sorties set cloture_erreur = left(sqlerrm, 300) where id = v_s.id;
      perform _parite_alerter('cloture:' || v_s.reference, 'anomalie',
        format('%s : le SMS de la puce est arrivé mais la clôture a échoué (%s)', v_s.reference, sqlerrm), jsonb_build_object('reference', v_s.reference));
    end;
    select * into v_s from sorties where id = v_s.id;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('resultat', 'constatee', 'id', v_k.id, 'deja', case when v_deja then true end,
    'sortie', v_s.reference, 'rapprochement', case when v_s.id is not null then _rapprochement(v_s) ->> 'etat' end,
    'cloture', case when v_s.etat = 'envoyee' then true end, 'continuite', v_k.continuite));
end $$;

-- ───────────────── 5 · les soldes seuls, et le relevé de l'équipe ──────────
create or replace function totem_solde_float(p_terminal text, p_operateur text, p_float_numero text, p_solde numeric,
                                             p_annonce_le timestamptz, p_source text, p_source_id bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_float floats; v_id bigint; v_n int;
begin
  if p_source not in ('sms', 'ussd') then raise exception 'source inconnue'; end if;
  if p_solde is null or p_solde < 0 then return jsonb_build_object('resultat', 'refuse', 'motif', 'solde illisible'); end if;
  select * into v_float from floats
   where operateur = p_operateur and numero = normaliser_numero(p_float_numero) and terminal = p_terminal;
  if not found then return jsonb_build_object('resultat', 'refuse', 'motif', 'ce float n''est pas sur ce terminal'); end if;
  perform pg_advisory_xact_lock(hashtext('float:' || v_float.id));
  -- une heure dans le futur (horloge du modem déréglée) ne doit pas figer ce solde devant tous les suivants.
  -- fiable reste faux : une consultation USSD est sûre par sa SOURCE ; un solde lu dans un SMS seul ne l'est jamais.
  insert into soldes_floats (float_id, solde, annonce_le, source, terminal, source_id)
  values (v_float.id, round(p_solde, 2), least(coalesce(p_annonce_le, now()), now()), p_source, p_terminal, p_source_id)
  on conflict (terminal, source_id, empreinte) where source = 'sms' and source_id is not null do nothing
  returning id into v_id;
  if p_source = 'ussd' and v_id is not null then
    v_n := _reexaminer_continuite(v_float.id, least(coalesce(p_annonce_le, now()), now()));
  end if;
  return jsonb_strip_nulls(jsonb_build_object('resultat', case when v_id is null then 'deja' else 'note' end, 'float', v_float.id, 'reexaminees', v_n));
end $$;

create or replace function admin_saisir_releve(p_float int, p_solde numeric, p_annonce_le timestamptz, p_preuve text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_n int;
begin
  perform _exiger_droit('rapprocher');
  if p_solde is null or p_solde < 0 or not (p_solde = round(p_solde, 2)) then raise exception 'solde invalide'; end if;
  if p_annonce_le is null or p_annonce_le > now() + interval '5 minutes' then raise exception 'la date du relevé est dans le futur'; end if;
  if coalesce(p_preuve, '') = '' then raise exception 'le relevé de l''opérateur est exigé : déposez le fichier'; end if;
  if not exists (select 1 from floats where id = p_float) then raise exception 'float inconnu'; end if;
  perform pg_advisory_xact_lock(hashtext('float:' || p_float));
  insert into soldes_floats (float_id, solde, annonce_le, source, preuve, note, saisi_par)
  values (p_float, p_solde, p_annonce_le, 'releve', p_preuve, left(p_note, 500), auth.uid())
  returning id into v_id;
  v_n := _reexaminer_continuite(p_float, p_annonce_le);
  perform _journaliser('saisir_releve', p_float::text, jsonb_build_object('solde', p_solde, 'annonce_le', p_annonce_le, 'reexaminees', v_n));
  return jsonb_build_object('ok', true, 'id', v_id, 'reexaminees', v_n);
end $$;

-- ────────────────────────── 6 · les gestes de l'équipe ─────────────────────
-- Libérer un SMS au solde à vérifier : l'équipe l'a vu dans l'historique de
-- l'opérateur. « Ancrer » : son solde est bien celui de l'opérateur, il devient
-- un appui, et les SMS suivants se vérifient d'eux-mêmes.
create or replace function admin_liberer_retenue(p_id bigint, p_ancrer boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_r entrees_retenues; v_f int; v_op text; v_tx text; v jsonb; v_n int; v_note text := trim(coalesce(p_note, ''));
begin
  perform _exiger_droit('rapprocher');
  select float_id, operateur, transaction_id into v_f, v_op, v_tx from entrees_retenues where id = p_id;
  if not found then raise exception 'entrée inconnue'; end if;
  if v_f is not null then perform pg_advisory_xact_lock(hashtext('float:' || v_f)); end if;
  if length(coalesce(v_tx, '')) >= 6 then perform pg_advisory_xact_lock(hashtext('tx:' || v_op || ':' || v_tx)); end if;
  select * into v_r from entrees_retenues where id = p_id for update;
  if not coalesce(_retenue_pour_le_solde(v_r), false) then
    raise exception 'ce SMS n''attend pas de vérification de solde';
  end if;
  if length(v_note) < 10 then
    raise exception 'dites comment le paiement a été vérifié' using detail = 'par exemple : vu dans l''historique MoMo *126#';
  end if;
  if exists (select 1 from depot_paiements where terminal = v_r.terminal and source_id = v_r.source_id) then
    raise exception 'le message complet de ce SMS a déjà crédité un dépôt';
  end if;
  if length(coalesce(v_r.transaction_id, '')) >= 6
     and exists (select 1 from depot_declarations where operateur = v_r.operateur and transaction_id = v_r.transaction_id and etat = 'credite') then
    raise exception 'transaction ID déjà utilisé';
  end if;
  if coalesce(p_ancrer, false) then
    if v_r.solde_apres is null then raise exception 'ce SMS n''annonce pas de solde'; end if;
    update soldes_floats set fiable = true, continuite = 'liberee' where retenue_id = p_id;
  end if;
  update entrees_retenues set liberee_par = auth.uid(), liberee_le = now(), note_equipe = left(v_note, 500) where id = p_id;
  v := _reprendre_retenue(p_id, 'liberee');
  if coalesce(p_ancrer, false) and v_f is not null then
    v_n := _reexaminer_continuite(v_f, least(coalesce(v_r.emis_le, now()), now()));
  end if;
  -- le journal se garde longtemps et se lit à plusieurs : jamais le numéro du payeur
  perform _journaliser('liberer_retenue', p_id::text, jsonb_build_object('montant', v_r.montant, 'ancre', coalesce(p_ancrer, false), 'note', left(v_note, 500)));
  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'credite', coalesce((v ->> 'credite')::boolean, false), 'reference', v ->> 'reference',
                                              'reexaminees', v_n));
end $$;

-- Rejeter : un faux SMS. Rien n'est crédité, rien n'est remboursé, et le
-- réexamen ne le reprend jamais.
create or replace function admin_rejeter_retenue(p_id bigint, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_r entrees_retenues; v_note text := trim(coalesce(p_note, ''));
begin
  perform _exiger_droit('rapprocher');
  select * into v_r from entrees_retenues where id = p_id for update;
  if not found then raise exception 'entrée inconnue'; end if;
  if v_r.etat <> 'retenue' then raise exception 'cette entrée n''est plus retenue' using detail = v_r.etat; end if;
  if length(v_note) < 3 then raise exception 'une note est exigée' using detail = 'pourquoi ce SMS est faux'; end if;
  update entrees_retenues set etat = 'rejetee', continuite = 'rejetee', note_equipe = left(v_note, 500), liberee_par = auth.uid(), liberee_le = now()
   where id = p_id;
  update soldes_floats set continuite = 'rejetee' where retenue_id = p_id;
  perform _journaliser('rejeter_retenue', p_id::text, jsonb_build_object('montant', v_r.montant, 'note', left(v_note, 500)));
  return jsonb_build_object('ok', true);
end $$;

-- Rapprocher et rembourser : jamais un SMS dont le solde est à vérifier. Le
-- rembourser est l'essentiel — sans ce garde, un faux SMS retenu se faisait
-- REMBOURSER, et l'argent réel partait chez le faussaire.
create or replace function admin_rapprocher_retenue(p_id bigint, p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_r entrees_retenues; v_d depots; v_x depot_declarations; v_tx text;
begin
  perform _exiger_droit('rapprocher');
  select * into v_r from entrees_retenues where id = p_id;
  if not found then raise exception 'entrée inconnue'; end if;
  if v_r.operateur is null or coalesce(v_r.montant, 0) <= 0 then
    raise exception 'opérateur ou montant inconnu' using detail = 'ce SMS ne se crédite pas : remboursement manuel';
  end if;
  -- un SMS dont la référence n'a pas été lue reçoit un identifiant à lui, pour qu'un second ne lui soit pas confondu
  v_tx := case when length(coalesce(v_r.transaction_id, '')) >= 6 then v_r.transaction_id
               else 'SMSRETENU' || v_r.id::text end;
  perform pg_advisory_xact_lock(hashtext('tx:' || v_r.operateur || ':' || v_tx));
  select * into v_r from entrees_retenues where id = p_id for update;
  if coalesce(_retenue_pour_le_solde(v_r), false) then
    raise exception 'solde à vérifier : libérez ou rejetez d''abord ce SMS';
  end if;
  if v_r.etat <> 'retenue' then raise exception 'cette entrée n''est plus retenue' using detail = v_r.etat; end if;
  if exists (select 1 from depot_paiements where terminal = v_r.terminal and source_id = v_r.source_id and empreinte = v_r.empreinte) then
    raise exception 'ce SMS a déjà crédité un dépôt';
  end if;
  select * into v_d from depots where reference = p_reference for update;
  if not found then raise exception 'dépôt inconnu'; end if;
  if v_d.etat = 'annule' then raise exception 'ce dépôt est annulé'; end if;
  if v_d.operateur <> v_r.operateur then raise exception 'l''opérateur du SMS n''est pas celui du dossier'; end if;
  if exists (select 1 from depot_declarations where operateur = v_r.operateur and transaction_id = v_tx and etat = 'credite') then
    raise exception 'transaction ID déjà utilisé';
  end if;
  -- la déclaration de CE compte pour cet ID est reprise sur ce dossier ; sinon on l'écrit
  select * into v_x from depot_declarations where compte_id = v_d.compte_id and operateur = v_r.operateur and transaction_id = v_tx for update;
  if found then
    update depot_declarations set depot_id = v_d.id, etat = 'attendu', motif = 'rapproché par l''administration'
     where id = v_x.id returning * into v_x;
  else
    insert into depot_declarations (depot_id, compte_id, operateur, transaction_id, motif)
    values (v_d.id, v_d.compte_id, v_r.operateur, v_tx, 'rapproché par l''administration')
    returning * into v_x;
  end if;
  v_x := _crediter_declaration(v_x.id, v_r.terminal, v_r.source_id, v_r.montant, v_r.numero_payeur, v_r.reference_operateur, v_r.texte, v_r.emis_le, v_r.id);
  if v_x.etat = 'credite' then
    -- les autres comptes qui attendaient ce même ID savent qu'il est pris
    update depot_declarations set etat = 'refuse', motif = 'rattaché à un autre dossier par l''équipe'
     where operateur = v_r.operateur and transaction_id = v_tx and etat = 'attendu';
  end if;
  perform _journaliser('rapprocher_retenue', p_id::text, jsonb_build_object('reference', p_reference, 'resultat', v_x.etat));
  return _declaration_json(v_x);
end $$;

create or replace function admin_rembourser_retenue(p_id bigint, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_r entrees_retenues; v_float floats; v_n int;
begin
  perform _exiger_droit('rembourser');
  select * into v_r from entrees_retenues where id = p_id for update;
  if not found then raise exception 'entrée inconnue'; end if;
  if coalesce(_retenue_pour_le_solde(v_r), false) then
    raise exception 'solde à vérifier : libérez ou rejetez d''abord ce SMS';
  end if;
  if v_r.etat <> 'retenue' then raise exception 'cette entrée n''est plus retenue' using detail = v_r.etat; end if;
  if v_r.numero_payeur is null or coalesce(v_r.montant, 0) <= 0 then raise exception 'payeur ou montant inconnu : remboursement manuel'; end if;
  if exists (select 1 from depot_paiements where terminal = v_r.terminal and source_id = v_r.source_id and empreinte = v_r.empreinte)
     or (length(coalesce(v_r.transaction_id, '')) >= 6
         and exists (select 1 from depot_declarations where operateur = v_r.operateur and transaction_id = v_r.transaction_id and etat = 'credite')) then
    raise exception 'ce paiement a déjà été crédité' using detail = 'le rembourser le paierait deux fois';
  end if;
  select * into v_float from floats where id = v_r.float_id;
  if not found or v_float.terminal is null then
    raise exception 'float inconnu : remboursement manuel' using detail = 'aucun boîtier ne porte la carte qui a reçu cet argent';
  end if;
  if exists (select 1 from remboursements where retenue_id = p_id and etat in ('en_attente', 'en_cours')) then
    raise exception 'un remboursement est déjà en route';
  end if;
  select count(*) + 1 into v_n from remboursements where retenue_id = p_id;
  insert into remboursements (retenue_id, terminal, float_id, operateur, numero, montant, note, cle)
  values (p_id, v_float.terminal, v_float.id, v_r.operateur, v_r.numero_payeur, v_r.montant, p_note, 'rbt-' || p_id::text || '-' || v_n::text);
  update entrees_retenues set etat = 'remboursee' where id = p_id;
  -- le journal se garde longtemps et se lit à plusieurs : la référence de l'entrée, jamais le numéro du payeur
  perform _journaliser('rembourser_retenue', p_id::text, jsonb_build_object('montant', v_r.montant, 'note', p_note, 'essai', v_n));
  return jsonb_build_object('ok', true, 'montant', v_r.montant, 'numero', v_r.numero_payeur);
end $$;

create or replace function admin_retenues(p_etat text default 'retenue', p_n int default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'terminal', e.terminal, 'operateur', e.operateur, 'float_numero', e.float_numero,
                            'numero_payeur', e.numero_payeur, 'montant', e.montant, 'reference_operateur', e.reference_operateur,
                            'transaction_id', e.transaction_id, 'texte', e.texte, 'emis_le', e.emis_le, 'etat', e.etat,
                            'motif', e.motif, 'bloquee', e.bloquee,
                            'depot_reference', (select reference from depots where id = e.depot_id), 'cree_le', e.cree_le,
                            'compte_suggere', (select jsonb_build_object('id', c.id, 'nom', c.nom, 'telephone', c.telephone)
                                                 from comptes c where c.id = _proprietaire_du_numero(e.numero_payeur)),
                            -- 0039 : la continuité du solde
                            'solde_apres', e.solde_apres, 'solde_attendu', e.solde_attendu, 'continuite', e.continuite,
                            'solde_a_verifier', e.etat = 'retenue' and e.bloquee and coalesce(e.continuite in ('incoherente', 'absente', 'sans_ancre'), false)
                                                and e.motif is not distinct from _motif_continuite(e.continuite),
                            'ancre', (select jsonb_build_object('solde', s.solde, 'annonce_le', s.annonce_le, 'source', s.source) from soldes_floats s where s.id = e.ancre_id),
                            'liberee_le', e.liberee_le, 'note_equipe', e.note_equipe,
                            'liberee_par', (select coalesce(a.nom, a.email) from administrateurs a where a.id = e.liberee_par)) order by e.cree_le desc), '[]'::jsonb)
    into r
    from (select * from entrees_retenues where etat = p_etat order by cree_le desc limit p_n) e;
  return r;
end $$;

create or replace function admin_a_traiter() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('voir');
  return jsonb_build_object(
    'sorties_manuelles', (select count(*) from sorties where mode = 'manuel' and etat in ('en_attente', 'en_cours')),
    'sorties_en_preuve', (select count(*) from sorties where mode = 'manuel' and etat = 'en_preuve'),
    'sorties_a_confirmer', (select count(*) from sorties s where s.mode = 'manuel' and s.etat = 'en_preuve' and _seuil_atteint(s) and s.confirmee_par is null),
    'sorties_en_ecart', (select count(*) from sorties s where s.mode = 'manuel' and s.etat = 'en_preuve' and _rapprochement(s) ->> 'etat' = 'ecart'),
    'montant_a_payer', (select coalesce(sum(s.montant_xaf - coalesce((select sum(p.montant) from sortie_paiements p where p.sortie_id = s.id and p.retire_le is null), 0)), 0)
                          from sorties s where s.mode = 'manuel' and s.etat in ('en_attente', 'en_cours', 'en_preuve')),
    -- 0039 : les SMS dont le solde ne suit pas, retenus pour l'équipe
    'retenues_solde', (select count(*) from entrees_retenues r where r.etat = 'retenue' and r.bloquee and coalesce(_retenue_pour_le_solde(r), false)),
    'sorties_non_expliquees', (select count(*) from sorties_constatees k where not _sms_sortant_explique(k)),
    'parite', (select jsonb_build_object('statut', p.statut, 'ecart', p.ecart, 'couverture', p.couverture, 'fait_le', p.fait_le,
                                         'alertes', (select count(*) from parite_alertes where close_le is null and gravite <> 'attention'))
                 from parite_releves p order by p.fait_le desc limit 1));
end $$;

-- ─────────────────────── 7 · la page publique, arrondie ────────────────────
-- Le solde exact d'un float est précisément ce qu'un faussaire doit connaître :
-- la page publique l'arrondit au million inférieur (la couverture aussi, sinon
-- registre + couverture le redonnerait). L'équipe garde l'exact.
create or replace function _arrondi_public(x numeric) returns numeric
language sql immutable set search_path = public as $$
  select case when x is null then null when x >= 0 then floor(x / 1e6) * 1e6 else -ceil(-x / 1e6) * 1e6 end
$$;

create or replace function _parite_json(p_detail boolean) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'releve', (select case when p_detail then to_jsonb(p) - 'detail'
                           else to_jsonb(p) - 'detail' - 'floats' - 'couverture'
                                || jsonb_build_object('floats', _arrondi_public(p.floats), 'couverture', _arrondi_public(p.couverture), 'floats_arrondi', 1000000) end
                 || jsonb_build_object('reseaux', p.detail -> 'reseaux',
                 'floats_detail', case when p_detail then p.detail -> 'floats'
                                when coalesce((parametre('parite') ->> 'publier_floats')::boolean, true)
                                then (select coalesce(jsonb_agg(jsonb_build_object('operateur', o, 'solde', _arrondi_public(s), 'annonce_le', d, 'connu', c)), '[]'::jsonb)
                                        from (select x ->> 'operateur' o, sum((x ->> 'solde')::numeric) s, min((x ->> 'annonce_le')::timestamptz) d, bool_and((x ->> 'connu')::boolean) c
                                                from jsonb_array_elements(p.detail -> 'floats') x group by 1) g) end)
                 from parite_releves p order by p.fait_le desc limit 1),
    'historique', (select coalesce(jsonb_agg(jsonb_build_object('fait_le', fait_le, 'statut', statut, 'registre', registre, 'chaine', chaine, 'ecart', ecart,
                                                                'floats', case when p_detail then floats else _arrondi_public(floats) end) order by fait_le), '[]'::jsonb)
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

-- ─────────────────────────────── 8 · les droits ────────────────────────────
revoke all on function _mode_continuite(text), _motif_continuite(text),
  _continuite(floats, int, numeric, numeric, numeric, numeric, timestamptz, bigint), _reprendre_retenue(bigint, text),
  _reexaminer_continuite(int, timestamptz), _retenue_pour_le_solde(entrees_retenues), _solde_float(int), _arrondi_public(numeric), _verifier_parametre(text, jsonb),
  totem_sms_recu(text, bigint, text, text, text, numeric, text, text, timestamptz, numeric, numeric, numeric),
  totem_sms_sortant(text, bigint, text, text, text, numeric, text, text, timestamptz, numeric, numeric, numeric),
  totem_solde_float(text, text, text, numeric, timestamptz, text, bigint),
  admin_saisir_releve(int, numeric, timestamptz, text, text), admin_liberer_retenue(bigint, boolean, text), admin_rejeter_retenue(bigint, text),
  admin_rapprocher_retenue(bigint, text), admin_rembourser_retenue(bigint, text), admin_retenues(text, int), admin_a_traiter()
  from public, anon, authenticated;
grant execute on function totem_sms_recu(text, bigint, text, text, text, numeric, text, text, timestamptz, numeric, numeric, numeric),
  totem_sms_sortant(text, bigint, text, text, text, numeric, text, text, timestamptz, numeric, numeric, numeric),
  totem_solde_float(text, text, text, numeric, timestamptz, text, bigint) to service_role;
grant execute on function admin_saisir_releve(int, numeric, timestamptz, text, text), admin_liberer_retenue(bigint, boolean, text),
  admin_rejeter_retenue(bigint, text), admin_rapprocher_retenue(bigint, text), admin_rembourser_retenue(bigint, text),
  admin_retenues(text, int), admin_a_traiter() to authenticated;   -- les gardes sont dedans (_exiger_droit)
