-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0030 · la démo et l'argent réel ne se croisent jamais        ║
-- ║                                                                        ║
-- ║  0028 ouvrait les floats de démo AUX comptes de la bêta, sans les      ║
-- ║  fermer aux autres : un compte « argent réel » pouvait se voir         ║
-- ║  proposer 600 00 00 01 pour un vrai dépôt (un numéro qui n'existe sur  ║
-- ║  aucun réseau : ses vrais francs ne partaient pas, mais l'écran les    ║
-- ║  lui demandait), et retirer ses vrais XAFe vers un numéro de démo,     ║
-- ║  payé en faux francs. La règle est maintenant symétrique : un float    ║
-- ║  de démo ⇔ un compte sans argent réel, au dépôt comme au retrait.      ║
-- ║                                                                        ║
-- ║  L'administration disait « muet · jamais » d'un terminal de démo :     ║
-- ║  il ne parle que lorsqu'un SMS de démo part, et le moteur le tient     ║
-- ║  pour toujours entendu (_terminal_entendu). Elle dit « démo ».         ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ───────────── le dépôt : vrai float pour l'argent réel, démo sinon ────────
create or replace function ouvrir_depot(p_operateur text, p_cle text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_compte uuid := auth.uid();
  v_d      depots;
  v_float  floats;
  v_reels  boolean;
begin
  perform _exiger_compte_actif(v_compte);
  if p_cle is not null then
    select * into v_d from depots where compte_id = v_compte and cle = p_cle;
    if found then return _depot_json(v_d) || '{"deja": true}'; end if;
  end if;
  perform 1 from operateurs where id = p_operateur;
  if not found then raise exception 'opérateur inconnu'; end if;
  v_reels := _depots_reels_ouverts(v_compte);

  select f.* into v_float
    from floats f join terminaux t on t.id = f.terminal
   where f.operateur = p_operateur and f.actif and t.demo = not v_reels
   order by _terminal_entendu(t.id) desc,
            (select count(*) from depots d where d.float_id = f.id and d.etat = 'en_attente') asc,
            f.id
   limit 1;
  if not found then
    if not v_reels then
      raise exception 'dépôts fermés pendant la bêta'
        using detail = 'aucun float de démo TOTEM pour cet opérateur : l''argent de la bêta est de l''argent de test';
    end if;
    raise exception 'aucun float disponible pour cet opérateur';
  end if;

  insert into depots (reference, compte_id, operateur, float_id, cle, expire_le)
  values ('XAFe-DP-' || lpad(nextval('depots_numero')::text, 6, '0'), v_compte, p_operateur, v_float.id,
          p_cle, now() + make_interval(mins => (parametre('depot') ->> 'validite_minutes')::int))
  returning * into v_d;
  return _depot_json(v_d);
end $$;

-- La garde à la source, des deux côtés : un vrai float refuse le compte de
-- la bêta, un float de démo refuse le compte d'argent réel.
create or replace function _depot_pendant_la_beta() returns trigger
language plpgsql set search_path = public as $$
declare v_demo boolean;
begin
  select t.demo into v_demo from floats f join terminaux t on t.id = f.terminal where f.id = new.float_id;
  if coalesce(v_demo, false) and _depots_reels_ouverts(new.compte_id) then
    raise exception 'un float de démo ne reçoit que l''argent de test'
      using detail = 'ce compte dépose de vrais francs : il passe par un vrai float';
  end if;
  if not coalesce(v_demo, false) and not _depots_reels_ouverts(new.compte_id) then
    raise exception 'dépôts fermés pendant la bêta'
      using detail = 'l''argent de la bêta est de l''argent de test : aucun vrai paiement n''est accepté pour l''instant';
  end if;
  return new;
end $$;

-- ───────────── le retrait : un numéro de démo ne reçoit que l'argent de test ─
create or replace function demander_sortie(p_montant numeric, p_numero_id uuid, p_cle text, p_code text, p_nom text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_demo boolean;
begin
  select numero_de_demo(n.numero) into v_demo
    from numeros n where n.id = p_numero_id and n.compte_id = auth.uid() and n.retire_le is null;
  if coalesce(v_demo, false) and _depots_reels_ouverts(auth.uid()) then
    raise exception 'un numéro de démo ne reçoit que l''argent de test'
      using detail = 'vos XAFe sont de l''argent réel : retirez-les vers un vrai numéro';
  end if;
  if not coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true) and not coalesce(v_demo, false) then
    raise exception 'sorties pas encore ouvertes' using detail = 'vos XAFe restent sur votre compte';
  end if;
  v := _controler_code(auth.uid(), p_code);
  if not (v ->> 'ok')::boolean then return v; end if;
  if _sortie_manuelle() then return _demander_sortie_manuelle(p_montant, p_numero_id, p_cle, p_nom); end if;
  return demander_sortie(p_montant, p_numero_id, p_cle);
end $$;

-- ───────────── l'administration : un terminal de démo n'est pas « muet » ───
create or replace function admin_terminaux() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nom', t.nom, 'lieu', t.lieu, 'vu_le', t.vu_le, 'a_cle', t.cle is not null,
                            'demo', t.demo,
                            'muet', not _terminal_entendu(t.id),
                            'floats', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'operateur', f.operateur, 'numero', f.numero, 'code_agent', f.code_agent,
                                                                         'titulaire', f.titulaire, 'actif', f.actif,
                                                                         'dossiers_ouverts', (select count(*) from depots d where d.float_id = f.id and d.etat = 'en_attente'))
                                                      order by f.id), '[]'::jsonb) from floats f where f.terminal = t.id),
                            'commandes_en_attente', (select count(*) from commandes k where k.terminal = t.id and k.etat = 'en_attente')) order by t.id), '[]'::jsonb)
    into r from terminaux t;
  return r;
end $$;
