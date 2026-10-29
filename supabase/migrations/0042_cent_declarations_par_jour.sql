-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0042 · cent déclarations par jour                             ║
-- ║                                                                        ║
-- ║  Le propriétaire l'a décidé (29/10) : au plus cinq transaction ID en   ║
-- ║  attente, et CENT déclarations par compte sur 24 heures (trente        ║
-- ║  avant). Ce sont des compteurs contre le bourrage, pas des plafonds    ║
-- ║  d'argent. Le nombre se règle (parametre depot.declarations_jour) ;    ║
-- ║  absent, il vaut 100. Rien d'autre ne change dans declarer_transaction.║
-- ╚════════════════════════════════════════════════════════════════════════╝

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
    -- un compte, par 24 heures : cent déclarations (réglage depot.declarations_jour) — un compte d'agent en fait beaucoup
    if (select count(*) from depot_declarations where compte_id = v_compte and declare_le > now() - interval '24 hours')
       >= greatest(1, coalesce((parametre('depot') ->> 'declarations_jour')::int, 100)) then
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
