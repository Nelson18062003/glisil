-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0020 · un numéro s'ajoute sans code SMS et sans délai        ║
-- ║                                                                        ║
-- ║  Décision du propriétaire (phase d'essai) : ajouter un numéro MoMo/OM  ║
-- ║  ne demande plus de code SMS, et le numéro reçoit une sortie tout de   ║
-- ║  suite. Le client met son numéro, son nom, son code secret : c'est    ║
-- ║  tout. Une vraie vérification d'identité (KYC) viendra plus tard.     ║
-- ║                                                                        ║
-- ║  Réglable (paramètre « numeros ») plutôt que supprimé :                ║
-- ║    verification_sms  false ici ; true remet le code d'avant            ║
-- ║    delai_heures      0 ici ; 24 remet le délai d'avant                 ║
-- ║  Ce qui reste : un numéro n'est qu'à un compte, il a la forme de son   ║
-- ║  opérateur, et toute sortie exige le code secret du client.           ║
-- ╚════════════════════════════════════════════════════════════════════════╝

insert into parametres (cle, valeur) values ('numeros', '{"verification_sms": false, "delai_heures": 0}')
on conflict (cle) do nothing;

create or replace function _delai_numero() returns interval
language sql stable set search_path = public as $$
  select make_interval(hours => coalesce((parametre('numeros') ->> 'delai_heures')::int, 24))
$$;

create or replace function ajouter_numero(p_operateur text, p_numero text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_compte uuid := auth.uid();
  v_num    text := normaliser_numero(p_numero);
  v_n      numeros;
  -- sans le paramètre, le code SMS reste exigé : on ne relâche une garde que si on l'a décidé
  v_sms    boolean := coalesce((parametre('numeros') ->> 'verification_sms')::boolean, true);
begin
  perform _exiger_compte_actif(v_compte);
  perform 1 from comptes where id = v_compte for no key update;
  perform 1 from operateurs where id = p_operateur;
  if not found then raise exception 'opérateur inconnu'; end if;
  if v_num !~ '^6[0-9]{8}$' then raise exception 'numéro invalide'; end if;
  if operateur_du_numero(v_num) is distinct from p_operateur then
    raise exception 'numéro invalide' using detail = format('ce numéro n''est pas un numéro %s', (select nom from operateurs where id = p_operateur));
  end if;
  select * into v_n from numeros where compte_id = v_compte and numero = v_num and retire_le is null for update;
  if found then
    if v_n.verifie_le is not null then
      -- sans code, le redemander n'est pas une faute : on rend celui qui est là
      if not v_sms then return _numero_json(v_n); end if;
      raise exception 'ce numéro est déjà sur votre compte';
    end if;
    if not v_sms then
      -- un numéro resté en attente de code (d'avant ce réglage) est retenu tel quel
      begin
        update numeros set verifie_le = now(), actif_des = now() + _delai_numero() where id = v_n.id returning * into v_n;
      exception when unique_violation then raise exception 'ce numéro est déjà sur un autre compte'; end;
      delete from numeros_codes where numero_id = v_n.id;
      return _numero_json(v_n);
    end if;
    perform _envoyer_code_numero(v_n);
    return _numero_json(v_n);
  end if;
  if _proprietaire_du_numero(v_num) is not null then
    raise exception 'ce numéro est déjà sur un autre compte';
  end if;
  if v_sms and (select count(*) from numeros where compte_id = v_compte and retire_le is null and verifie_le is null) >= 3 then
    raise exception 'trop de numéros en attente de code' using detail = 'confirmez ou retirez les premiers';
  end if;
  if not v_sms and (select count(*) from numeros where compte_id = v_compte and retire_le is null) >= 10 then
    raise exception 'trop de numéros sur ce compte' using detail = 'retirez-en un avant d''en ajouter un autre';
  end if;
  begin
    insert into numeros (compte_id, operateur, numero, verifie_le, actif_des)
    values (v_compte, p_operateur, v_num, case when v_sms then null else now() end, now() + _delai_numero())
    returning * into v_n;
  exception when unique_violation then
    raise exception 'ce numéro est déjà sur un autre compte';
  end;
  if v_sms then perform _envoyer_code_numero(v_n); end if;
  return _numero_json(v_n);
end $$;

-- Les numéros restés en attente d'un code qui n'arrivera plus : retenus, et actifs tout de suite
do $$
begin
  if not coalesce((parametre('numeros') ->> 'verification_sms')::boolean, true) then
    update numeros n set verifie_le = now(), actif_des = now()
     where n.verifie_le is null and n.retire_le is null
       and not exists (select 1 from numeros o where o.numero = n.numero and o.verifie_le is not null and o.retire_le is null);
    delete from numeros_codes c using numeros n where n.id = c.numero_id and n.verifie_le is not null;
  end if;
  if coalesce((parametre('numeros') ->> 'delai_heures')::int, 24) = 0 then
    update numeros set actif_des = now() where actif_des > now() and retire_le is null;
  end if;
end $$;

-- Ce que l'écran lit : faut-il un code, et quel délai ?
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
    'conditions', parametre('conditions'),
    'support', parametre('support'))
   where auth.uid() is not null
$$;

-- L'équipe règle « numeros » comme les autres paramètres
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
  if p_cle not in ('frais', 'marche', 'depot', 'sortie', 'paliers', 'crypto', 'code_secret', 'rapide', 'conditions', 'support', 'numeros') then
    raise exception 'paramètre inconnu';
  end if;
  perform _verifier_parametre(p_cle, p_valeur);
  update parametres set valeur = p_valeur where cle = p_cle;
  if not found then raise exception 'paramètre inconnu'; end if;
  perform _journaliser('modifier_parametre', p_cle, p_valeur);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function _delai_numero() from public, anon, authenticated;
