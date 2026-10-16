-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0013 · un dépôt se déclare en entier                          ║
-- ║  Le client donne, pour chaque paiement : le numéro qui a payé, le nom,  ║
-- ║  le transaction ID et le montant exact. Le crédit n'est automatique que ║
-- ║  si le SMS lu par TOTEM dit la MÊME chose — même ID, même numéro, même  ║
-- ║  montant. Sinon le paiement reste retenu : le client corrige (trois     ║
-- ║  fois au plus), ou l'équipe tranche. Personne n'est crédité au hasard.  ║
-- ║  Et un float porte le nom de son titulaire, que l'écran montre : « nom  ║
-- ║  différent ? ne confirmez pas ». Et deux interrupteurs de plus, pour    ║
-- ║  ouvrir Glisil par les dépôts d'abord : sorties, dépôts crypto.         ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────── les floats ────────────────────────────────
-- Le nom que le client voit sur SON téléphone avant de confirmer un
-- transfert (« NORTON GAUSS BONZINI SARL 1 », « WONDER PHONE ») : s'il lit
-- autre chose, il ne paie pas.
alter table floats add column if not exists titulaire text;

-- ─────────────────────────── ce que le client déclare ──────────────────────
alter table depot_declarations add column if not exists numero_declare  text;
alter table depot_declarations add column if not exists montant_declare numeric(20,2);
alter table depot_declarations add column if not exists nom_declare     text;
-- vrai : le refus vient d'un numéro ou d'un montant qui ne concorde pas, et le client peut corriger
alter table depot_declarations add column if not exists corrigible      boolean not null default false;
alter table depot_declarations add column if not exists essais          int not null default 1;

-- La règle stricte est la règle : numéro, montant et nom sont exigés à la
-- déclaration. Le paramètre existe pour le dire, pas pour l'éteindre.
update parametres set valeur = valeur || '{"declaration_complete": true}'
 where cle = 'depot' and not (valeur ? 'declaration_complete');

create or replace function _depot_json(d depots) returns jsonb
language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object(
    'reference', d.reference, 'etat', d.etat, 'operateur', d.operateur,
    'montant_recu', d.montant_recu,
    'float_numero', f.numero,
    'titulaire', f.titulaire,
    'code_agent', f.code_agent,
    'reception', case when not coalesce(f.actif, false) then 'fermee'
                      when t.vu_le is null or t.vu_le < now() - interval '10 minutes' then 'retardee'
                      else 'ouverte' end,
    'declarations', (select coalesce(jsonb_agg(_declaration_json(x) order by x.declare_le), '[]'::jsonb)
                       from depot_declarations x where x.depot_id = d.id),
    'cree_le', d.cree_le, 'expire_le', d.expire_le, 'credite_le', d.credite_le)
    from (select 1) _ left join floats f on f.id = d.float_id left join terminaux t on t.id = f.terminal
$$;

create or replace function _declaration_json(x depot_declarations) returns jsonb
language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', x.id, 'transaction_id', x.transaction_id, 'etat', x.etat, 'montant', x.montant,
                            'numero_payeur', x.numero_payeur, 'motif', x.motif, 'declare_le', x.declare_le, 'credite_le', x.credite_le,
                            'numero_declare', x.numero_declare, 'montant_declare', x.montant_declare, 'nom_declare', x.nom_declare,
                            'corrigible', x.corrigible and x.essais < 3,
                            'lu_le', (select p.cree_le from depot_paiements p where p.id = x.paiement_id))
$$;

-- ───────────────────────────── l'appariement ───────────────────────────────
-- Les règles de 0001 (le numéro vérifié sur un compte décide ; un ID tapé
-- avant le paiement ne vient pas de celui qui a payé ; plusieurs prétendants,
-- l'équipe tranche), plus deux : le numéro qui a payé et le montant reçu
-- doivent être ceux que le client a déclarés. Un écart se corrige (le client
-- s'est trompé d'un chiffre) mais ne crédite jamais : le motif ne dit PAS ce
-- que le SMS porte — il ne doit rien apprendre à qui tape des ID au hasard.
drop function if exists _apparier(text, text, text, timestamptz);
create or replace function _apparier(p_operateur text, p_tx text, p_payeur text, p_emis_le timestamptz, p_montant numeric default null)
returns jsonb language plpgsql set search_path = public, extensions, pg_temp as $$
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
end $$;

-- ─────────────────────────── déclarer un paiement ──────────────────────────
-- p_numero    le numéro qui a payé (le sien, ou celui d'un proche), du même opérateur
-- p_montant   le montant EXACT envoyé, en francs entiers
-- p_nom       le nom du titulaire du compte qui a payé (pour l'équipe, quand elle vérifie)
-- Une déclaration refusée pour un écart se corrige en la redéclarant : même
-- ID, même dossier, de nouvelles valeurs — trois fois au plus.
drop function if exists declarer_transaction(text, text);
create or replace function declarer_transaction(p_reference text, p_transaction_id text, p_numero text default null,
                                                p_montant numeric default null, p_nom text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
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
   order by cree_le limit 1 for update;
  if found then
    v_a := _apparier(v_d.operateur, v_id, v_r.numero_payeur, v_r.emis_le, v_r.montant);
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
end $$;

-- ─────────────────────── le SMS lu par TOTEM (0001), montant compris ───────
create or replace function totem_sms_recu(p_terminal text, p_source_id bigint, p_operateur text, p_float_numero text,
                               p_numero_payeur text, p_montant numeric, p_reference text, p_texte text,
                               p_emis_le timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
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
    v_a := _apparier(p_operateur, v_id, v_num, p_emis_le, p_montant);
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
end $$;

-- ───────────────────────────── l'équipe et les floats ──────────────────────
drop function if exists admin_creer_float(text, text, text, text);
create or replace function admin_creer_float(p_operateur text, p_numero text, p_terminal text, p_code_agent text default null, p_titulaire text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id int; v_tit text := nullif(regexp_replace(trim(coalesce(p_titulaire, '')), '\s+', ' ', 'g'), '');
begin
  perform _exiger_droit('terminaux');
  if normaliser_numero(p_numero) !~ '^6[0-9]{8}$' or operateur_du_numero(p_numero) is distinct from p_operateur then
    raise exception 'numéro invalide' using detail = 'un numéro camerounais de cet opérateur';
  end if;
  if v_tit is not null and length(v_tit) > 80 then raise exception 'titulaire invalide' using detail = '80 caractères au plus'; end if;
  if nullif(trim(coalesce(p_code_agent, '')), '') is not null and trim(p_code_agent) !~ '^[0-9]{3,12}$' then
    raise exception 'code agent invalide' using detail = 'des chiffres';
  end if;
  perform 1 from terminaux where id = p_terminal;
  if not found then raise exception 'terminal inconnu'; end if;
  insert into floats (operateur, numero, terminal, code_agent, titulaire)
  values (p_operateur, normaliser_numero(p_numero), p_terminal, nullif(trim(coalesce(p_code_agent, '')), ''), v_tit) returning id into v_id;
  perform _journaliser('creer_float', v_id::text, jsonb_build_object('operateur', p_operateur, 'numero', normaliser_numero(p_numero), 'terminal', p_terminal, 'titulaire', v_tit));
  return jsonb_build_object('id', v_id);
end $$;

-- Le titulaire et le code agent changent (un nouveau compte marchand) sans recréer le float.
create or replace function admin_modifier_float(p_id int, p_titulaire text, p_code_agent text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tit text := nullif(regexp_replace(trim(coalesce(p_titulaire, '')), '\s+', ' ', 'g'), '');
        v_code text := nullif(trim(coalesce(p_code_agent, '')), '');
begin
  perform _exiger_droit('terminaux');
  if v_tit is not null and length(v_tit) > 80 then raise exception 'titulaire invalide' using detail = '80 caractères au plus'; end if;
  if v_code is not null and v_code !~ '^[0-9]{3,12}$' then raise exception 'code agent invalide' using detail = 'des chiffres'; end if;
  update floats set titulaire = v_tit, code_agent = v_code where id = p_id;
  if not found then raise exception 'float inconnu'; end if;
  perform _journaliser('modifier_float', p_id::text, jsonb_build_object('titulaire', v_tit, 'code_agent', v_code));
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_terminaux() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nom', t.nom, 'lieu', t.lieu, 'vu_le', t.vu_le, 'a_cle', t.cle is not null,
                            'muet', t.vu_le is null or t.vu_le < now() - interval '10 minutes',
                            'floats', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'operateur', f.operateur, 'numero', f.numero, 'code_agent', f.code_agent,
                                                                         'titulaire', f.titulaire, 'actif', f.actif,
                                                                         'dossiers_ouverts', (select count(*) from depots d where d.float_id = f.id and d.etat = 'en_attente'))
                                                      order by f.id), '[]'::jsonb) from floats f where f.terminal = t.id),
                            'commandes_en_attente', (select count(*) from commandes k where k.terminal = t.id and k.etat = 'en_attente')) order by t.id), '[]'::jsonb)
    into r from terminaux t;
  return r;
end $$;

-- ─────────────────── le paramètre « depot » accepte la règle stricte ────────
create or replace function _verifier_parametre(p_cle text, v jsonb) returns void
language plpgsql set search_path = public, extensions, pg_temp as $$
declare k text; p jsonb; ok boolean;
begin
  if jsonb_typeof(v) <> 'object' then raise exception 'paramètre invalide' using detail = 'un objet JSON est attendu'; end if;
  ok := case p_cle
    when 'frais' then _nombre_entre(v -> 'placeur', 0, 0.05) and _nombre_entre(v -> 'preneur', 0, 0.05) and _nombre_entre(v -> 'sortie', 0, 0.05)
    when 'marche' then v ->> 'paire' = 'USDT/XAFe' and _nombre_entre(v -> 'pas_prix', 0.01, 100) and _nombre_entre(v -> 'quantite_min', 0.01, 1000000)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
    when 'depot' then _nombre_entre(v -> 'validite_minutes', 5, 1440, true) and _nombre_entre(v -> 'grace_minutes', 0, 10080, true)
                      and (not (v ? 'declaration_complete') or jsonb_typeof(v -> 'declaration_complete') = 'boolean')
    when 'sortie' then _nombre_entre(v -> 'reprises_max', 1, 10, true)
                       and (not (v ? 'ouvertes') or jsonb_typeof(v -> 'ouvertes') = 'boolean')
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
    -- une date AAAA-MM-JJ : la version se lit, et se compare
    when 'conditions' then coalesce(v ->> 'version', '') ~ '^\d{4}-\d{2}-\d{2}$'
    -- une adresse e-mail, et un numéro WhatsApp au format international ou null
    when 'support' then coalesce(v ->> 'email', '') ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'
                        and (jsonb_typeof(v -> 'whatsapp') = 'null' or coalesce(v ->> 'whatsapp', '') ~ '^\+[1-9][0-9]{7,14}$')
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


-- ───────────────────── ouvrir un service, ou pas encore ─────────────────────
-- On ouvre Glisil par les DÉPÔTS d'abord. Le marché (« marche.ouvert »),
-- l'achat rapide (« rapide.ouvert ») et les retraits crypto
-- (« crypto.retraits_ouverts ») avaient déjà leur interrupteur. Il en manquait
-- deux : les sorties de XAF vers MoMo (« sortie.ouvertes ») et les adresses de
-- dépôt crypto (« crypto.depots_ouverts »). Absents, ils valent « ouvert » :
-- cette migration ne ferme rien ; c'est l'équipe qui ferme, dans Paramètres.
create or replace function demander_sortie(p_montant numeric, p_numero_id uuid, p_cle text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true) then
    raise exception 'sorties pas encore ouvertes' using detail = 'vos XAFe restent sur votre compte';
  end if;
  v := _controler_code(auth.uid(), p_code);
  if not (v ->> 'ok')::boolean then return v; end if;
  return demander_sortie(p_montant, p_numero_id, p_cle);
end $$;

create or replace function adresse_depot(p_actif text, p_reseau text) returns text
language plpgsql security definer set search_path = public as $$
declare v_compte uuid := auth.uid(); v_adresse text; v_libre adresses_libres;
begin
  perform _exiger_compte_actif(v_compte);
  -- fermé : aucune adresse ne se montre — pas même celle déjà attribuée, sur laquelle de vrais USDT n'arriveraient nulle part
  if not coalesce((parametre('crypto') ->> 'depots_ouverts')::boolean, true) then return null; end if;
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
end $$;

create or replace function parametres_publics() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'frais', parametre('frais'),
    'marche', parametre('marche'),
    'paliers', parametre('paliers'),
    'rapide', jsonb_build_object('marge', parametre('rapide') -> 'marge', 'ouvert', coalesce((parametre('rapide') ->> 'ouvert')::boolean, false),
                                 'validite_secondes', parametre('rapide') -> 'validite_secondes'),
    'crypto', jsonb_build_object('frais', parametre('crypto') -> 'frais',
                                 'retraits_ouverts', coalesce((parametre('crypto') ->> 'retraits_ouverts')::boolean, false),
                                 'depots_ouverts', coalesce((parametre('crypto') ->> 'depots_ouverts')::boolean, true)),
    'sortie', jsonb_build_object('ouvertes', coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true)),
    'operateurs', (select jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'plafond_par_transfert', plafond_par_transfert,
                                                       'plafond_jour', plafond_jour) order by id) from operateurs),
    'conditions', parametre('conditions'),
    'support', parametre('support'))
   where auth.uid() is not null
$$;

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on function declarer_transaction(text, text, text, numeric, text), admin_creer_float(text, text, text, text, text),
                       admin_modifier_float(int, text, text), _apparier(text, text, text, timestamptz, numeric)
  from public, anon, authenticated;
grant execute on function declarer_transaction(text, text, text, numeric, text), admin_creer_float(text, text, text, text, text),
                          admin_modifier_float(int, text, text)
  to authenticated, service_role;
