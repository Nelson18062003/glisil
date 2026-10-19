-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0031 · aucun plafond par transfert                           ║
-- ║                                                                        ║
-- ║  Le propriétaire : « une transaction = un ID ». Le client envoie ce    ║
-- ║  qu'il veut, en un transfert ou en plusieurs, et déclare chaque ID ;   ║
-- ║  ce n'est pas à Glisil de lui dicter « 5 transferts de 1 000 000 au    ║
-- ║  plus ». Le plafond par transfert et le plafond par jour des           ║
-- ║  opérateurs deviennent facultatifs, et sont retirés : vide = aucun.    ║
-- ║  Le plafond par jour n'était appliqué nulle part ; celui par transfert ║
-- ║  ne découpait plus que les sorties automatiques (mode « totem »).      ║
-- ║  Le minimum (1 500 XAFe à l'ordre) et les gardes techniques restent.   ║
-- ╚════════════════════════════════════════════════════════════════════════╝

alter table operateurs alter column plafond_par_transfert drop not null;
-- seulement s'ils sont encore ceux d'origine (0001) : un plafond posé plus tard
-- par l'équipe survit à une seconde passe
update operateurs set plafond_par_transfert = null, plafond_jour = null
 where (id, plafond_par_transfert, plafond_jour) in (('mtn', 1000000, 100000000), ('om', 500000, 1500000));

create or replace function demander_sortie(p_montant numeric, p_numero_id uuid, p_cle text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
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
end $$;
