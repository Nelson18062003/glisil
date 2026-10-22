-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0034 · ce que la revue d'attaque du 22/10 a trouvé           ║
-- ║                                                                        ║
-- ║  1. L'argent de test ne sort pas en vrai. Un compte de la bêta (sans   ║
-- ║     argent réel) pouvait demander une sortie vers un VRAI numéro : seul║
-- ║     l'interrupteur « sortie.ouvertes » l'arrêtait, et il est ouvert    ║
-- ║     par défaut. Le jour où un vrai float s'allume, chaque testeur      ║
-- ║     aurait retiré son million de bienvenue en vrais francs. La règle   ║
-- ║     de 0030 (démo ⇔ argent de test) se tient maintenant dans les DEUX  ║
-- ║     sens, et le float qui paie est du même monde que le numéro.        ║
-- ║  2. Un paiement ne se rapproche que d'un dépôt de SON monde : un faux  ║
-- ║     SMS de la démo (dont le testeur voit l'ID) ne crédite pas un vrai  ║
-- ║     dépôt, et l'inverse.                                               ║
-- ║  3. Le prix de référence ne se promène plus : deux comptes qui         ║
-- ║     s'échangeaient dix USDT entre eux le poussaient de 10 % à chaque   ║
-- ║     fois (600 → 781 en huit échanges), et la bande suivait. Il reste   ║
-- ║     maintenant à moins de « derive_max » (10 %) du cours externe.      ║
-- ║  4. Un compte gelé n'a plus d'ordres au carnet : ils s'exécutaient     ║
-- ║     encore après le gel.                                               ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- 1. Sorties : l'argent de test ne sort pas vers un vrai numéro.
create or replace function demander_sortie(p_montant numeric, p_numero_id uuid, p_cle text, p_code text, p_nom text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb; v_demo boolean;
begin
  select numero_de_demo(n.numero) into v_demo
    from numeros n where n.id = p_numero_id and n.compte_id = auth.uid() and n.retire_le is null;
  if coalesce(v_demo, false) and _depots_reels_ouverts(auth.uid()) then
    raise exception 'un numéro de démo ne reçoit que l''argent de test'
      using detail = 'vos XAFe sont de l''argent réel : retirez-les vers un vrai numéro';
  end if;
  -- l'autre sens, qui manquait : l'argent de test ne part pas vers un vrai numéro
  if not coalesce(v_demo, false) and not _depots_reels_ouverts(auth.uid()) then
    raise exception 'l''argent de test ne sort pas en vrai'
      using detail = 'vos XAFe de la bêta se retirent vers un numéro de démo (600…)';
  end if;
  if not coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true) and not coalesce(v_demo, false) then
    raise exception 'sorties pas encore ouvertes' using detail = 'vos XAFe restent sur votre compte';
  end if;
  v := _controler_code(auth.uid(), p_code);
  if not (v ->> 'ok')::boolean then return v; end if;
  if _sortie_manuelle() then return _demander_sortie_manuelle(p_montant, p_numero_id, p_cle, p_nom); end if;
  return demander_sortie(p_montant, p_numero_id, p_cle);
end $function$;

-- Le float qui paie est du même monde que le numéro.
create or replace function demander_sortie(p_montant numeric, p_numero_id uuid, p_cle text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_compte uuid := auth.uid();
  v_s      sorties;
  v_n      numeros;
  v_op     operateurs;
  v_float  floats;
  v_taux   numeric := (parametre('frais') ->> 'sortie')::numeric;
  v_palier jsonb;
  v_jour   numeric;
  v_n_tr   int;
  v_part   numeric;
  v_reste  numeric;
  v_chunk  numeric;
  v_frais  numeric;
  v_frais_total numeric := 0;
  v_envoi_total numeric := 0;
  v_ref    text;
  i        int;
begin
  perform _exiger_compte_actif(v_compte);
  if p_cle is not null then
    select * into v_s from sorties where compte_id = v_compte and cle = p_cle;
    if found then return _sortie_json(v_s) || '{"deja": true}'; end if;
  end if;
  if p_montant is null or p_montant <= 0 or p_montant <> trunc(p_montant) then raise exception 'montant invalide'; end if;

  select * into v_n from numeros where id = p_numero_id and compte_id = v_compte and retire_le is null;
  if not found then raise exception 'numéro inconnu sur ce compte'; end if;
  if v_n.verifie_le is null then raise exception 'numéro pas encore vérifié'; end if;
  if v_n.actif_des > now() then
    raise exception 'numéro pas encore actif' using detail = format('actif à partir du %s', v_n.actif_des);
  end if;
  select * into v_op from operateurs where id = v_n.operateur;

  -- Le compte est verrouillé AVANT de compter : deux demandes lancées ensemble
  -- liraient sinon le même total, et passeraient toutes deux le plafond.
  perform 1 from comptes where id = v_compte for no key update;
  v_palier := parametre('paliers') -> (select palier::text from comptes where id = v_compte);
  if v_palier is not null and v_palier <> 'null'::jsonb then
    v_jour := _sorties_du_jour(v_compte);
    if v_jour + p_montant > (v_palier ->> 'sortie_jour')::numeric then
      raise exception 'plafond du palier atteint' using detail = format('%s XAF par jour', v_palier ->> 'sortie_jour');
    end if;
  end if;

  -- Le float qui envoie : sur cet opérateur, porté par un terminal qui a donné
  -- signe de vie depuis dix minutes, le plus récent d'abord. Clouer une sortie
  -- à un boîtier muet bloquerait les XAFe du client sans que rien ne parte.
  select f.* into v_float from floats f join terminaux t on t.id = f.terminal
   where f.operateur = v_n.operateur and f.actif and t.vu_le > now() - interval '10 minutes'
     -- un numéro de démo est payé par le terminal de démo, un vrai numéro par un vrai boîtier
     and coalesce(t.demo, false) = coalesce(numero_de_demo(v_n.numero), false)
   order by t.vu_le desc, f.id limit 1;
  if not found then
    raise exception 'aucun boîtier en ligne pour cet opérateur' using detail = 'réessayez dans quelques minutes : rien n''a été débité';
  end if;

  -- Découpage : seulement si l'équipe a posé un plafond par transfert pour cet
  -- opérateur. Sans plafond (le cas par défaut), la sortie part en UN transfert.
  v_n_tr := case when v_op.plafond_par_transfert is null then 1
                 else greatest(1, ceil(p_montant / v_op.plafond_par_transfert))::int end;
  v_part := trunc(p_montant / v_n_tr);
  v_reste := p_montant - v_part * v_n_tr;
  for i in 1 .. v_n_tr loop
    v_chunk := v_part + (case when i = v_n_tr then v_reste else 0 end);
    v_frais := ceil(v_chunk * v_taux);
    -- un transfert à 0 XAF ne part jamais, et sa commande ne se clôt pas : on refuse avant
    if v_chunk - v_frais <= 0 then
      raise exception 'montant trop petit' using detail = 'après les frais, rien ne partirait';
    end if;
    v_frais_total := v_frais_total + v_frais;
    v_envoi_total := v_envoi_total + (v_chunk - v_frais);
  end loop;

  v_ref := 'XAFe-WD-' || lpad(nextval('sorties_numero')::text, 6, '0');
  perform _mouvement(v_compte, 'XAFe', -p_montant, p_montant, 'sortie_bloquee', 'sorties', v_ref);
  insert into sorties (reference, compte_id, numero_id, operateur, numero, montant, frais, montant_xaf, cle)
  values (v_ref, v_compte, v_n.id, v_n.operateur, v_n.numero, p_montant, v_frais_total, v_envoi_total, p_cle)
  returning * into v_s;

  for i in 1 .. v_n_tr loop
    v_chunk := v_part + (case when i = v_n_tr then v_reste else 0 end);
    v_frais := ceil(v_chunk * v_taux);
    insert into commandes (terminal, sortie_id, float_id, parametres, montant_xafe, frais, cle)
    values (v_float.terminal, v_s.id, v_float.id,
            jsonb_build_object('operateur', v_n.operateur, 'float_numero', v_float.numero,
                               'numero', v_n.numero, 'montant', v_chunk - v_frais),
            v_chunk, v_frais, v_ref || '-' || i);
  end loop;
  return _sortie_json(v_s);
end $function$;

-- 2. Un paiement ne se rapproche que d'un dépôt de son monde.
drop function if exists _apparier(text, text, text, timestamptz, numeric);
create or replace function _apparier(p_operateur text, p_tx text, p_payeur text, p_emis_le timestamp with time zone, p_montant numeric DEFAULT NULL::numeric, p_demo boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_proprio uuid := _proprietaire_du_numero(p_payeur);
  v_x       depot_declarations;
  v_elus    uuid[] := '{}';
  v_motif   text;
  v_corrigible boolean;
  v_vues    int := 0;
begin
  for v_x in select * from depot_declarations
              where operateur = p_operateur and transaction_id = p_tx and etat = 'attendu'
                -- seulement les dépôts du monde du SMS (démo ou réel) : un faux franc ne paie pas un vrai dépôt
                and (p_demo is null or exists (
                      select 1 from depots d join floats f on f.id = d.float_id join terminaux t on t.id = f.terminal
                       where d.id = depot_declarations.depot_id and coalesce(t.demo, false) = p_demo))
              order by declare_le, id for update loop
    v_vues := v_vues + 1;
    v_corrigible := false;
    if v_proprio is not null and v_x.compte_id <> v_proprio then
      v_motif := 'le numéro qui a payé est celui d''un autre compte : l''équipe vérifie';
    elsif p_emis_le is not null and v_x.declare_le < p_emis_le - interval '5 minutes' then
      v_motif := 'ce transaction ID a été tapé avant le paiement : l''équipe vérifie';
    elsif v_x.numero_declare is not null and p_payeur is not null and v_x.numero_declare <> p_payeur then
      v_motif := 'le numéro déclaré ne correspond pas au paiement reçu : vérifiez-le';
      v_corrigible := true;
    elsif v_x.montant_declare is not null and p_montant is not null and v_x.montant_declare <> p_montant then
      v_motif := 'le montant déclaré ne correspond pas au paiement reçu : vérifiez-le';
      v_corrigible := true;
    else
      v_elus := v_elus || v_x.id;
      continue;
    end if;
    if v_corrigible and v_x.essais >= 3 then
      v_motif := 'trois déclarations ne correspondent pas au paiement reçu : l''équipe vérifie';
      v_corrigible := false;
    end if;
    update depot_declarations set etat = 'refuse', motif = v_motif, corrigible = v_corrigible where id = v_x.id;
    perform _notifier(v_x.compte_id, case when v_corrigible then 'Dépôt à vérifier' else 'Transaction ID en vérification' end, v_motif || '.',
                      '/entrer/transaction/' || (select reference from depots where id = v_x.depot_id));
  end loop;

  if cardinality(v_elus) = 1 then return jsonb_build_object('id', v_elus[1]); end if;
  if cardinality(v_elus) > 1 then
    v_motif := 'plusieurs comptes ont tapé ce transaction ID : l''équipe vérifie';
    update depot_declarations set etat = 'refuse', motif = v_motif, corrigible = false where id = any (v_elus);
    perform _notifier(x.compte_id, 'Transaction ID en vérification', v_motif || '.', '/historique/' || d.reference)
       from depot_declarations x join depots d on d.id = x.depot_id where x.id = any (v_elus);
    return jsonb_build_object('motif', v_motif, 'bloquee', true);
  end if;
  -- un écart corrigible ne bloque pas le SMS : la déclaration corrigée le reprendra
  if v_vues > 0 then return jsonb_build_object('motif', v_motif, 'bloquee', false); end if;
  return '{}'::jsonb;
end $function$;

create or replace function totem_sms_recu(p_terminal text, p_source_id bigint, p_operateur text, p_float_numero text, p_numero_payeur text, p_montant numeric, p_reference text, p_texte text, p_emis_le timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_float floats;
  v_d     depots;
  v_p     depot_paiements;
  v_r     entrees_retenues;
  v_x     depot_declarations;
  v_a     jsonb := '{}'::jsonb;
  v_num   text := nullif(normaliser_numero(p_numero_payeur), '');
  v_id    text := normaliser_transaction_id(p_reference);
  v_emp   text := _empreinte_sms(p_texte, p_reference, p_montant);
  v_reutilise boolean;
begin
  perform pg_advisory_xact_lock(hashtext('sms:' || p_terminal || ':' || p_source_id::text));
  select * into v_p from depot_paiements where terminal = p_terminal and source_id = p_source_id and empreinte = v_emp;
  if found then
    select * into v_d from depots where id = v_p.depot_id;
    return jsonb_build_object('resultat', 'credite', 'reference', v_d.reference, 'etat', v_d.etat, 'deja', true);
  end if;
  select * into v_r from entrees_retenues where terminal = p_terminal and source_id = p_source_id and empreinte = v_emp;
  if found then return jsonb_build_object('resultat', 'retenue', 'id', v_r.id, 'deja', true); end if;
  v_reutilise := exists (select 1 from depot_paiements where terminal = p_terminal and source_id = p_source_id)
              or exists (select 1 from entrees_retenues where terminal = p_terminal and source_id = p_source_id);

  update terminaux set vu_le = now() where id = p_terminal;
  select * into v_float from floats
   where operateur = p_operateur and numero = normaliser_numero(p_float_numero) and terminal = p_terminal;
  if not found then
    insert into entrees_retenues (terminal, source_id, operateur, float_numero, numero_payeur, montant,
                                  reference_operateur, transaction_id, texte, emis_le, motif, bloquee, empreinte)
    values (p_terminal, p_source_id, p_operateur, p_float_numero, v_num, p_montant, p_reference, v_id, p_texte, p_emis_le,
            'ce numéro n''est pas un float de ce terminal : l''équipe vérifie', true, v_emp)
    returning * into v_r;
    return jsonb_build_object('resultat', 'retenue', 'id', v_r.id, 'motif', v_r.motif);
  end if;

  if coalesce(p_montant, 0) > 0 and length(v_id) >= 6 then
    perform pg_advisory_xact_lock(hashtext('tx:' || p_operateur || ':' || v_id));
    v_a := _apparier(p_operateur, v_id, v_num, p_emis_le, p_montant,
                     coalesce((select demo from terminaux where id = p_terminal), false));
    if v_a ? 'id' then
      v_x := _crediter_declaration((v_a ->> 'id')::uuid, p_terminal, p_source_id, p_montant, v_num, p_reference, p_texte, p_emis_le, null);
      select * into v_d from depots where id = v_x.depot_id;
      if v_x.etat = 'credite' then
        return jsonb_strip_nulls(jsonb_build_object('resultat', 'credite', 'reference', v_d.reference, 'etat', v_d.etat,
                                                    'montant_recu', v_d.montant_recu, 'source_id_reutilise', case when v_reutilise then true end));
      end if;
      v_a := jsonb_build_object('motif', v_x.motif, 'bloquee', true, 'depot_id', v_d.id);
    end if;
  end if;

  insert into entrees_retenues (terminal, source_id, float_id, operateur, float_numero, numero_payeur, montant,
                                reference_operateur, transaction_id, texte, emis_le, depot_id, motif, bloquee, empreinte)
  values (p_terminal, p_source_id, v_float.id, p_operateur, p_float_numero, v_num, p_montant, p_reference, v_id, p_texte, p_emis_le,
          (v_a ->> 'depot_id')::uuid, v_a ->> 'motif', coalesce((v_a ->> 'bloquee')::boolean, false), v_emp)
  returning * into v_r;
  return jsonb_strip_nulls(jsonb_build_object('resultat', 'retenue', 'id', v_r.id, 'motif', v_r.motif,
                                              'source_id_reutilise', case when v_reutilise then true end));
end $function$;

create or replace function declarer_transaction(p_reference text, p_transaction_id text, p_numero text DEFAULT NULL::text, p_montant numeric DEFAULT NULL::numeric, p_nom text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_compte  uuid := auth.uid();
  v_d       depots;
  v_x       depot_declarations;
  v_r       entrees_retenues;
  v_a       jsonb;
  v_id      text := normaliser_transaction_id(p_transaction_id);
  v_num     text := nullif(normaliser_numero(p_numero), '');
  v_nom     text := nullif(regexp_replace(trim(coalesce(p_nom, '')), '\s+', ' ', 'g'), '');
  v_complet boolean := coalesce((parametre('depot') ->> 'declaration_complete')::boolean, true);
begin
  perform _exiger_compte_actif(v_compte);
  select * into v_d from depots where reference = p_reference and compte_id = v_compte for update;
  if not found then raise exception 'dépôt inconnu'; end if;
  if v_d.etat in ('annule') then raise exception 'ce dépôt est annulé'; end if;
  if length(v_id) < 6 or length(v_id) > 40 then
    raise exception 'transaction ID invalide' using detail = 'au moins six caractères, tel qu''il est écrit dans le SMS';
  end if;
  if v_complet or p_numero is not null or p_montant is not null or p_nom is not null then
    if v_num is null or v_num !~ '^6[0-9]{8}$' or operateur_du_numero(v_num) is distinct from v_d.operateur then
      raise exception 'numéro du payeur invalide' using detail = 'le numéro qui a payé, neuf chiffres, du même opérateur';
    end if;
    if p_montant is null or p_montant <= 0 or p_montant <> trunc(p_montant) or p_montant > 1e9 then
      raise exception 'montant invalide' using detail = 'le montant exact envoyé, en francs';
    end if;
    if v_nom is null or length(v_nom) < 2 or length(v_nom) > 80 then
      raise exception 'nom du payeur invalide' using detail = 'le nom du titulaire du compte qui a payé';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('tx:' || v_d.operateur || ':' || v_id));

  select * into v_x from depot_declarations where compte_id = v_compte and operateur = v_d.operateur and transaction_id = v_id for update;
  if found then
    if v_x.depot_id <> v_d.id then
      raise exception 'transaction ID déjà déclaré' using detail = format('sur le dossier %s', (select reference from depots where id = v_x.depot_id));
    end if;
    -- la correction d'un écart : de nouvelles valeurs, un essai de plus, et on recherche le SMS
    if v_x.etat = 'refuse' and v_x.corrigible and v_x.essais < 3 and v_num is not null then
      update depot_declarations
         set numero_declare = v_num, montant_declare = p_montant, nom_declare = v_nom, etat = 'attendu', motif = null,
             corrigible = false, essais = essais + 1, declare_le = now()
       where id = v_x.id returning * into v_x;
    else
      return _declaration_json(v_x);
    end if;
  else
    if exists (select 1 from depot_declarations where operateur = v_d.operateur and transaction_id = v_id and etat = 'credite') then
      raise exception 'transaction ID déjà utilisé' using detail = 'ce paiement a déjà été crédité';
    end if;
    if (select count(*) from depot_declarations where compte_id = v_compte and etat = 'attendu') >= 5 then
      raise exception 'trop de transaction ID en attente' using detail = 'attendez que les premiers soient lus';
    end if;
    if (select count(*) from depot_declarations where compte_id = v_compte and declare_le > now() - interval '24 hours') >= 30 then
      raise exception 'trop de transaction ID aujourd''hui' using detail = 'l''équipe peut rapprocher les autres';
    end if;
    insert into depot_declarations (depot_id, compte_id, operateur, transaction_id, numero_declare, montant_declare, nom_declare)
    values (v_d.id, v_compte, v_d.operateur, v_id, v_num, p_montant, v_nom) returning * into v_x;
  end if;

  -- TOTEM a peut-être déjà lu le SMS : il est alors parmi les entrées retenues.
  select * into v_r from entrees_retenues
   where operateur = v_d.operateur and transaction_id = v_id and etat = 'retenue' and not bloquee
     and coalesce(montant, 0) > 0
     -- un SMS lu par un terminal de l'autre monde ne paie pas ce dépôt
     and coalesce((select demo from terminaux where id = entrees_retenues.terminal), false)
       = coalesce((select t.demo from floats f join terminaux t on t.id = f.terminal where f.id = v_d.float_id), false)
   order by cree_le limit 1 for update;
  if found then
    v_a := _apparier(v_d.operateur, v_id, v_r.numero_payeur, v_r.emis_le, v_r.montant,
                     coalesce((select demo from terminaux where id = v_r.terminal), false));
    if v_a ? 'id' then
      v_x := _crediter_declaration((v_a ->> 'id')::uuid, v_r.terminal, v_r.source_id, v_r.montant, v_r.numero_payeur,
                                   v_r.reference_operateur, v_r.texte, v_r.emis_le, v_r.id);
    else
      update entrees_retenues set motif = coalesce(v_a ->> 'motif', motif), bloquee = bloquee or coalesce((v_a ->> 'bloquee')::boolean, false)
       where id = v_r.id;
      select * into v_x from depot_declarations where id = v_x.id;
    end if;
  end if;
  return _declaration_json(v_x);
end $function$;

-- 3. Le prix de référence reste près du cours externe.
create or replace function _marche()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'quantite_max', null, 'marche_quantite_max', null, 'ordres_ouverts_max', 200, 'montant_min', 1500,
    'bande_achat', jsonb_build_array(0.8, 1.1), 'bande_vente', jsonb_build_array(0.9, 1.2),
    'bande_execution', 0.05, 'prix_reference', null, 'derive_max', 0.10) || coalesce(parametre('marche'), '{}'::jsonb)
$function$;

create or replace function _prix_reference()
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- le prix des échanges, mais jamais à plus de « derive_max » du cours externe (EUR/USD, relevé par la
  -- plateforme) : sinon deux comptes qui s'échangent quelques USDT au bord de la bande la font glisser
  -- de 10 % à chaque échange, et le marché entier les suit. Sans cours externe, comme avant.
  with m as (select _marche() v),
  e as (select (v ->> 'prix_reference')::numeric ext,
               least(greatest(coalesce((v ->> 'derive_max')::numeric, 0.10), 0.01), 0.5) d from m),
  t as (select coalesce(
    (select round(sum(montant_xafe) / nullif(sum(quantite), 0), 2) from executions
      where paire = parametre('marche') ->> 'paire' and cree_le > now() - interval '5 minutes'),
    (select prix from executions where paire = parametre('marche') ->> 'paire' order by cree_le desc, id desc limit 1)) p)
  select case when e.ext is null then coalesce(t.p, e.ext)
              when t.p is null then e.ext
              else round(least(greatest(t.p, e.ext * (1 - e.d)), e.ext * (1 + e.d)), 2) end
    from e, t
$function$;

-- 4. Un compte gelé n'a plus d'ordres au carnet.
create or replace function admin_desactiver_compte(p_id uuid, p_actif boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _exiger_droit('clients');
  update comptes set desactive_le = case when p_actif then null else now() end,
                     ferme_le = case when p_actif then null else ferme_le end
   where id = p_id and not maison;
  if not found then raise exception 'compte inconnu'; end if;
  -- un compte gelé (volé, fraude) ne garde pas d'ordres au carnet : ils s'exécutaient encore
  if not p_actif then
    perform _annuler_ordre(o.compte_id, o.id) from ordres o where o.compte_id = p_id and o.etat in ('ouvert', 'partiel');
  end if;
  perform _journaliser(case when p_actif then 'reactiver_compte' else 'desactiver_compte' end, p_id::text, jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true);
end $function$;
