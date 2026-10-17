-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0017 · les règles du marché USDT/XAFe                         ║
-- ║                                                                        ║
-- ║  Le moteur apparie déjà au meilleur prix puis au premier arrivé, au    ║
-- ║  prix de l'ordre qui attendait, un ordre entrant à la fois, les fonds  ║
-- ║  bloqués à la pose. Il lui manquait les garde-fous qu'une bourse       ║
-- ║  publie (la fiche « Trading Parameters » de Binance) :                 ║
-- ║    · une TAILLE MAXIMALE par ordre, et un plafond pour un ordre au      ║
-- ║      marché ;                                                          ║
-- ║    · une BANDE DE PRIX : un ordre limite reste entre 80 % et 110 %     ║
-- ║      (achat) / 90 % et 120 % (vente) du prix de référence — un doigt   ║
-- ║      qui glisse ne vend pas à 10 XAFe ;                                ║
-- ║    · une BANDE D'EXÉCUTION : un ordre au marché ne s'exécute pas à     ║
-- ║      plus de 5 % de la référence ; le reste est annulé ;                ║
-- ║    · un NOMBRE D'ORDRES OUVERTS par compte (200) ;                     ║
-- ║    · un PRIX DE RÉFÉRENCE : la moyenne des échanges des 5 dernières    ║
-- ║      minutes, sinon le dernier échange, sinon celui que l'équipe pose   ║
-- ║      (le marché qui démarre, carnet vide). Sans aucun des trois, pas    ║
-- ║      de bande : le premier ordre fait le marché.                       ║
-- ║  Le règlement complet, en clair : docs/REGLES-DU-MARCHE.md.             ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- Les règles en vigueur : les valeurs de départ, et ce que l'équipe a posé
-- par-dessus. Les valeurs de départ vivent ICI et non dans la ligne du
-- paramètre : un paramètre réécrit en entier par l'équipe (sans ces clés)
-- ne fait jamais disparaître un garde-fou en silence.
create or replace function _marche() returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'quantite_max', 1000000, 'marche_quantite_max', 100000, 'ordres_ouverts_max', 200,
    'bande_achat', jsonb_build_array(0.8, 1.1), 'bande_vente', jsonb_build_array(0.9, 1.2),
    'bande_execution', 0.05, 'prix_reference', null) || coalesce(parametre('marche'), '{}'::jsonb)
$$;

-- LE PRIX DE RÉFÉRENCE. Une moyenne pondérée sur cinq minutes, pas le seul
-- dernier échange : un échange minuscule au bord de la bande ne déplace pas la
-- bande de 20 % d'un coup (on ne « marche » pas le prix à petits pas).
create or replace function _prix_reference() returns numeric
language sql stable set search_path = public as $$
  select coalesce(
    (select round(sum(montant_xafe) / nullif(sum(quantite), 0), 2) from executions
      where paire = parametre('marche') ->> 'paire' and cree_le > now() - interval '5 minutes'),
    (select prix from executions where paire = parametre('marche') ->> 'paire' order by cree_le desc, id desc limit 1),
    (_marche() ->> 'prix_reference')::numeric)
$$;

-- Un ordre au marché ne prend pas une offre au-delà de la bande d'exécution.
create or replace function _dans_la_bande_d_execution(p_cote text, p_prix numeric, p_ref numeric) returns boolean
language sql stable set search_path = public as $$
  select p_ref is null
      or case when p_cote = 'achat' then p_prix <= p_ref * (1 + (_marche() ->> 'bande_execution')::numeric)
              else p_prix >= p_ref * (1 - (_marche() ->> 'bande_execution')::numeric) end
$$;

-- ───────────────── l'appariement, avec ses garde-fous ──────────────────────
create or replace function _placer_ordre(p_compte uuid, p_cote text, p_type text, p_quantite numeric, p_prix numeric, p_cle text, p_t_preneur numeric)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_compte  uuid := p_compte;
  v_frais   jsonb := parametre('frais');
  v_marche  jsonb := _marche();
  v_paire   text := v_marche ->> 'paire';
  v_pas     numeric := (v_marche ->> 'pas_prix')::numeric;
  v_qmin    numeric := (v_marche ->> 'quantite_min')::numeric;
  v_t_pren  numeric := coalesce(p_t_preneur, (v_frais ->> 'preneur')::numeric);
  v_t_plac  numeric := (v_frais ->> 'placeur')::numeric;
  v_o       ordres;
  v_c       ordres;
  v_e       executions;
  v_q       numeric;
  v_px      numeric;
  v_xafe    numeric;
  v_fa      numeric;   -- frais de l'acheteur, en USDT
  v_fv      numeric;   -- frais du vendeur, en XAFe
  v_diff    numeric;
  v_cible   numeric;   -- ce que l'achat limite doit garder bloqué après la tranche
  v_frais_usdt numeric := 0;   -- les frais de toutes les tranches, encaissés par la maison À LA FIN
  v_frais_xafe numeric := 0;
  v_dispo   numeric;
  v_auto    boolean := false;
  v_execs   jsonb := '[]'::jsonb;
  v_achet   uuid;
  v_vend    uuid;
  v_id      text;
  v_ref     numeric;   -- le prix de référence au moment où l'ordre arrive (_prix_reference)
  v_bande   jsonb;
  v_lo      numeric;
  v_hi      numeric;
begin
  perform _exiger_compte_actif(v_compte);
  if not coalesce((v_marche ->> 'ouvert')::boolean, true) then raise exception 'marché fermé'; end if;
  if p_cle is not null then
    select * into v_o from ordres where compte_id = v_compte and cle = p_cle;
    if found then return jsonb_build_object('ordre', _ordre_json(v_o), 'executions', '[]'::jsonb, 'deja', true); end if;
  end if;
  if p_cote not in ('achat', 'vente') then raise exception 'côté invalide'; end if;
  if p_type not in ('limite', 'marche') then raise exception 'type invalide'; end if;
  if p_quantite is null or p_quantite < v_qmin or p_quantite <> round(p_quantite, 2) then
    raise exception 'quantité invalide' using detail = format('au moins %s USDT, deux décimales', v_qmin);
  end if;
  if p_type = 'limite' then
    if p_prix is null or p_prix <= 0 or mod(p_prix, v_pas) <> 0 then
      raise exception 'prix invalide' using detail = format('un multiple de %s', v_pas);
    end if;
  else
    p_prix := null;
  end if;

  -- LES RÈGLES DU MARCHÉ (0017), comme la fiche « Trading Parameters » d'une
  -- bourse : une taille maximale par ordre, un plafond pour un ordre au marché,
  -- une bande de prix autour du prix de référence (un doigt qui glisse ne vend
  -- pas à 10 XAFe), un nombre d'ordres ouverts par compte. Chaque refus dit la
  -- règle et la borne.
  if p_quantite > coalesce((v_marche ->> 'quantite_max')::numeric, 1e12) then
    raise exception 'quantité trop grande' using detail = format('au plus %s USDT par ordre', v_marche ->> 'quantite_max');
  end if;
  if p_type = 'marche' and p_quantite > coalesce((v_marche ->> 'marche_quantite_max')::numeric, 1e12) then
    raise exception 'ordre au marché trop grand' using detail = format('au plus %s USDT au marché : au-delà, posez un ordre limite', v_marche ->> 'marche_quantite_max');
  end if;
  v_ref := _prix_reference();
  if p_type = 'limite' and v_ref is not null then
    v_bande := coalesce(v_marche -> case when p_cote = 'achat' then 'bande_achat' else 'bande_vente' end, '[0, 1e9]'::jsonb);
    v_lo := ceil(v_ref * (v_bande ->> 0)::numeric / v_pas) * v_pas;
    v_hi := floor(v_ref * (v_bande ->> 1)::numeric / v_pas) * v_pas;
    if p_prix < v_lo or p_prix > v_hi then
      raise exception 'prix hors de la bande' using detail = format('%s : entre %s et %s XAFe (référence %s)',
        case when p_cote = 'achat' then 'un achat' else 'une vente' end, v_lo, v_hi, v_ref);
    end if;
  end if;
  if p_type = 'limite' and (select count(*) from ordres where compte_id = v_compte and etat in ('ouvert', 'partiel'))
                           >= coalesce((v_marche ->> 'ordres_ouverts_max')::int, 1000000) then
    raise exception 'trop d''ordres ouverts' using detail = format('au plus %s : annulez-en un', v_marche ->> 'ordres_ouverts_max');
  end if;

  -- Une paire s'apparie en file : un seul ordre entrant à la fois. Toute écriture
  -- au carnet (placer, annuler, l'achat rapide) prend ce même verrou ; la ligne en
  -- face se lit donc « for update » SANS « skip locked » : un chemin qui oublierait
  -- le verrou ferait ATTENDRE l'ordre, jamais sauter un meilleur prix.
  perform pg_advisory_xact_lock(hashtext(v_paire));
  -- relu sous le verrou : la référence est celle du carnet que l'ordre va parcourir
  v_ref := _prix_reference();

  insert into ordres (compte_id, paire, cote, type, prix, quantite, restant, cle)
  values (v_compte, v_paire, p_cote, p_type, p_prix, p_quantite, p_quantite, p_cle)
  returning * into v_o;
  v_id := v_o.numero::text;

  -- Tout ce qui est au carnet est déjà déposé : un ordre limite bloque avant d'être inscrit.
  if p_type = 'limite' then
    if p_cote = 'achat' then
      v_o.bloque := round(p_prix * p_quantite, 2);
      perform _mouvement(v_compte, 'XAFe', -v_o.bloque, v_o.bloque, 'ordre_bloque', 'ordres', v_id);
    else
      v_o.bloque := p_quantite;
      perform _mouvement(v_compte, 'USDT', -p_quantite, p_quantite, 'ordre_bloque', 'ordres', v_id);
    end if;
    update ordres set bloque = v_o.bloque where id = v_o.id;
  end if;

  -- Appariement prix-temps : le meilleur prix d'abord, puis le plus ancien.
  -- Le prix d'exécution est celui de l'ordre qui attendait.
  loop
    exit when v_o.restant <= 0;
    if p_cote = 'achat' then
      select * into v_c from ordres
       where paire = v_paire and cote = 'vente' and etat in ('ouvert', 'partiel') and (p_type = 'marche' or prix <= p_prix)
       order by prix asc, cree_le asc, numero asc for update limit 1;
    else
      select * into v_c from ordres
       where paire = v_paire and cote = 'achat' and etat in ('ouvert', 'partiel') and (p_type = 'marche' or prix >= p_prix)
       order by prix desc, cree_le asc, numero asc for update limit 1;
    end if;
    exit when not found;
    if v_c.compte_id = v_compte then v_auto := true; exit; end if;
    -- Un ordre au marché ne s'exécute pas au-delà de la bande d'exécution autour
    -- de la référence lue À SON ARRIVÉE : le reste est annulé, jamais servi à
    -- n'importe quel prix dans un carnet mince.
    exit when p_type = 'marche' and not _dans_la_bande_d_execution(p_cote, v_c.prix, v_ref);

    v_q := least(v_o.restant, v_c.restant);
    v_px := v_c.prix;
    -- Un acheteur au marché ne dépense que ce qu'il a.
    if p_type = 'marche' and p_cote = 'achat' then
      select disponible into v_dispo from soldes where compte_id = v_compte and actif = 'XAFe' for update;
      v_dispo := coalesce(v_dispo, 0);
      if v_dispo < round(v_q * v_px, 2) then v_q := trunc(v_dispo / v_px, 2); end if;
      exit when v_q <= 0;
    end if;

    -- Ce que paie l'acheteur. Un achat LIMITE a bloqué round(restant × limite) ;
    -- après cette tranche il doit garder exactement round(reste × limite), et
    -- tout le reste quand il n'en reste rien (v_cible). On ne soustrait jamais
    -- un arrondi de tranche d'un arrondi de total : la somme des arrondis n'est
    -- pas l'arrondi de la somme, et l'écart d'un centime finissait en bloqué
    -- négatif — « solde insuffisant » pour tout vendeur qui l'atteignait.
    --   · L'acheteur limite au repos est payé à SA limite : il donne ce que son
    --     bloqué dit (bloqué − cible), au centime près de round(q × prix).
    --   · L'acheteur limite qui prend paie round(q × prix du vendeur), jamais
    --     plus que ce que son bloqué peut donner, et récupère le reste.
    if p_cote = 'achat' and p_type = 'limite' then
      v_cible := case when v_o.restant - v_q = 0 then 0 else round((v_o.restant - v_q) * p_prix, 2) end;
      v_xafe := case when v_px = p_prix then v_o.bloque - v_cible
                     else least(round(v_q * v_px, 2), v_o.bloque - v_cible) end;
    elsif p_cote = 'vente' then
      v_cible := case when v_c.restant - v_q = 0 then 0 else round((v_c.restant - v_q) * v_c.prix, 2) end;
      v_xafe := v_c.bloque - v_cible;
    else
      v_xafe := round(v_q * v_px, 2);
    end if;

    if p_cote = 'achat' then
      v_achet := v_compte; v_vend := v_c.compte_id;
      v_fa := round(v_q * v_t_pren, 2);  v_fv := round(v_xafe * v_t_plac, 0);
    else
      v_achet := v_c.compte_id; v_vend := v_compte;
      v_fa := round(v_q * v_t_plac, 2);  v_fv := round(v_xafe * v_t_pren, 0);
    end if;

    -- L'acheteur paie v_xafe (de son bloqué s'il est limite, de son disponible au marché) et reçoit v_q moins ses frais.
    if (p_cote = 'achat' and p_type = 'limite') or p_cote = 'vente' then
      perform _mouvement(v_achet, 'XAFe', 0, -v_xafe, 'achat_regle', 'ordres', v_id);
    else
      perform _mouvement(v_achet, 'XAFe', -v_xafe, 0, 'achat_regle', 'ordres', v_id);
    end if;
    perform _mouvement(v_achet, 'USDT', v_q - v_fa, 0, 'achat_recu', 'ordres', v_id);
    -- Le vendeur donne v_q (de son bloqué s'il est limite) et reçoit v_xafe moins ses frais.
    if (p_cote = 'vente' and p_type = 'limite') or p_cote = 'achat' then
      perform _mouvement(v_vend, 'USDT', 0, -v_q, 'vente_reglee', 'ordres', v_id);
    else
      perform _mouvement(v_vend, 'USDT', -v_q, 0, 'vente_reglee', 'ordres', v_id);
    end if;
    perform _mouvement(v_vend, 'XAFe', v_xafe - v_fv, 0, 'vente_recue', 'ordres', v_id);
    v_frais_usdt := v_frais_usdt + v_fa;
    v_frais_xafe := v_frais_xafe + v_fv;

    -- L'acheteur limite qui prend : ce que son bloqué gardait au-delà de la cible et du prix payé lui revient.
    if p_cote = 'achat' and p_type = 'limite' then
      v_diff := v_o.bloque - v_cible - v_xafe;
      if v_diff > 0 then
        perform _mouvement(v_compte, 'XAFe', v_diff, -v_diff, 'ordre_libere', 'ordres', v_id);
      end if;
      v_o.bloque := v_cible;
    elsif p_type = 'limite' then
      v_o.bloque := v_o.bloque - v_q;
    end if;

    v_o.restant := v_o.restant - v_q;
    v_o.executee := v_o.executee + v_q;
    v_o.total_xafe := v_o.total_xafe + v_xafe;
    update ordres
       set restant = v_o.restant, executee = v_o.executee, total_xafe = v_o.total_xafe, bloque = v_o.bloque,
           etat = case when v_o.restant = 0 then 'execute' else 'partiel' end, maj_le = now()
     where id = v_o.id;
    update ordres
       set restant = restant - v_q, executee = executee + v_q, total_xafe = total_xafe + v_xafe,
           bloque = case when cote = 'achat' then v_cible else bloque - v_q end,
           etat = case when restant - v_q = 0 then 'execute' else 'partiel' end, maj_le = now()
     where id = v_c.id;
    if v_c.restant - v_q = 0 then
      perform _notifier(v_c.compte_id, 'Ordre exécuté',
        format('%s de %s USDT à %s.', case when v_c.cote = 'achat' then 'Achat' else 'Vente' end, v_c.quantite, v_px), '/marche/ordres/' || v_c.id);
    end if;

    insert into executions (paire, ordre_achat, ordre_vente, preneur, prix, quantite, montant_xafe, frais_acheteur, frais_vendeur)
    values (v_paire,
            case when p_cote = 'achat' then v_o.id else v_c.id end,
            case when p_cote = 'achat' then v_c.id else v_o.id end,
            p_cote, v_px, v_q, v_xafe, v_fa, v_fv)
    returning * into v_e;
    v_execs := v_execs || _execution_json(v_e);
  end loop;

  -- La maison en dernier : voir « l'ordre des verrous », au-dessus de _mouvement.
  if v_frais_usdt > 0 then perform _mouvement(compte_maison(), 'USDT', v_frais_usdt, 0, 'frais_achat', 'ordres', v_id); end if;
  if v_frais_xafe > 0 then perform _mouvement(compte_maison(), 'XAFe', v_frais_xafe, 0, 'frais_vente', 'ordres', v_id); end if;

  -- Ce qui reste d'un ordre marché, ou d'un ordre arrêté par l'auto-négociation, est annulé.
  if v_o.restant > 0 and (p_type = 'marche' or v_auto) then
    if p_type = 'limite' and v_o.bloque > 0 then
      if p_cote = 'achat' then
        perform _mouvement(v_compte, 'XAFe', v_o.bloque, -v_o.bloque, 'ordre_libere', 'ordres', v_id);
      else
        perform _mouvement(v_compte, 'USDT', v_o.bloque, -v_o.bloque, 'ordre_libere', 'ordres', v_id);
      end if;
    end if;
    update ordres
       set etat = case when v_o.executee > 0 then 'execute' else 'annule' end, restant = 0, bloque = 0, maj_le = now()
     where id = v_o.id;
  end if;

  select * into v_o from ordres where id = v_o.id;
  return jsonb_build_object('ordre', _ordre_json(v_o), 'executions', v_execs, 'auto_negociation', v_auto);
end $$;

-- Le parcours du carnet (le devis de l'achat rapide) suit la même bande : un
-- devis ne promet jamais ce que l'appariement refuserait.
create or replace function _parcourir_carnet(p_compte uuid, p_sens text, p_quantite numeric, p_budget numeric,
                                  out quantite numeric, out montant numeric)
language plpgsql stable set search_path = public as $$
declare
  v_paire text := parametre('marche') ->> 'paire';
  v_c ordres; v_q numeric; v_x numeric; v_cible numeric;
  v_ref numeric := _prix_reference();
begin
  quantite := 0; montant := 0;
  for v_c in
    select * from ordres
     where paire = v_paire and etat in ('ouvert', 'partiel')
       and cote = case when p_sens = 'achat' then 'vente' else 'achat' end
     order by case when p_sens = 'achat' then prix else -prix end, cree_le, numero
  loop
    exit when v_c.compte_id = p_compte;
    -- comme l'appariement d'un ordre au marché : pas au-delà de la bande d'exécution
    exit when not _dans_la_bande_d_execution(p_sens, v_c.prix, v_ref);
    if p_budget is not null then
      v_q := least(v_c.restant, trunc((p_budget - montant) / v_c.prix, 2));
    else
      v_q := least(v_c.restant, p_quantite - quantite);
    end if;
    exit when v_q <= 0;
    if p_sens = 'achat' then
      v_x := round(v_q * v_c.prix, 2);
    else
      v_cible := case when v_c.restant - v_q = 0 then 0 else round((v_c.restant - v_q) * v_c.prix, 2) end;
      v_x := v_c.bloque - v_cible;
    end if;
    quantite := quantite + v_q;
    montant := montant + v_x;
  end loop;
end $$;

-- ───────────────── ce que l'écran lit : les règles, et la référence ────────
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
                                 'depots_ouverts', coalesce((parametre('crypto') ->> 'depots_ouverts')::boolean, true)),
    'sortie', jsonb_build_object('ouvertes', coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true),
                                 'mode', coalesce(parametre('sortie') ->> 'mode', 'totem')),
    'operateurs', (select jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'plafond_par_transfert', plafond_par_transfert,
                                                       'plafond_jour', plafond_jour) order by id) from operateurs),
    'conditions', parametre('conditions'),
    'support', parametre('support'))
   where auth.uid() is not null
$$;

create or replace function cotation() returns jsonb
language sql stable security definer set search_path = public as $$
  with e as (select * from executions where cree_le > now() - interval '24 hours'),
       d as (select prix from executions order by cree_le desc, id desc limit 1),
       p as (select prix from executions where cree_le <= now() - interval '24 hours' order by cree_le desc, id desc limit 1)
  select jsonb_build_object(
    'paire', parametre('marche') ->> 'paire',
    'dernier', (select prix from d),
    'il_y_a_24h', (select prix from p),
    'haut', (select max(prix) from e), 'bas', (select min(prix) from e),
    'volume_usdt', (select coalesce(sum(quantite), 0) from e),
    'volume_xafe', (select coalesce(sum(montant_xafe), 0) from e),
    'meilleur_achat', (select max(prix) from ordres where etat in ('ouvert', 'partiel') and cote = 'achat'),
    'meilleure_vente', (select min(prix) from ordres where etat in ('ouvert', 'partiel') and cote = 'vente'),
    -- le prix autour duquel la bande se calcule : l'écran pré-remplit avec lui quand le carnet est vide
    'reference', _prix_reference())
$$;

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

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on function _marche(), _prix_reference(), _dans_la_bande_d_execution(text, numeric, numeric) from public, anon, authenticated;
