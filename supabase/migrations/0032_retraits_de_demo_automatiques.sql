-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0032 · les retraits de démo se paient tout seuls             ║
-- ║                                                                        ║
-- ║  Pendant la bêta, un testeur retire ses XAFe vers son numéro de démo   ║
-- ║  (600 …). Jusqu'ici, quelqu'un devait payer à la main depuis TOTEM     ║
-- ║  puis taper l'ID dans l'administration. Le propriétaire : « ce n'est   ║
-- ║  pas à moi de venir payer ». TOTEM démo paie désormais lui-même, par   ║
-- ║  la porte signée du terminal de démo :                                 ║
-- ║    1. il relève les sorties de démo à payer (totem_sorties_demo) ;     ║
-- ║    2. il en prend une (en_attente → en_cours : jamais deux fois) ;     ║
-- ║    3. il paie depuis la carte float, avec un vrai SMS et un vrai ID ;  ║
-- ║    4. il rend l'ID : la sortie se clôt comme « J'ai payé » ;           ║
-- ║       ou il rend l'échec (rien n'est parti) : les XAFe reviennent.     ║
-- ║  Une sortie vers un VRAI numéro n'entre jamais dans ce guichet.        ║
-- ║                                                                        ║
-- ║  Pour que TOTEM n'attende pas un geste, Glisil le RÉVEILLE à chaque    ║
-- ║  sortie de démo : un appel signé avec la clé du terminal vers          ║
-- ║  l'adresse « demo_totem.reveil ». Le réveil ne porte rien : TOTEM      ║
-- ║  relève lui-même, par la porte signée.                                 ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- Une sortie de démo, vue depuis le terminal de démo, verrouillée.
create or replace function _sortie_de_demo(p_terminal text, p_reference text) returns sorties
language plpgsql set search_path = public as $$
declare v_s sorties;
begin
  if not coalesce((select demo from terminaux where id = p_terminal), false) then
    raise exception 'seul un terminal de démo paie les sorties de démo';
  end if;
  select * into v_s from sorties where reference = p_reference for update;
  if not found then raise exception 'sortie inconnue'; end if;
  if v_s.mode <> 'manuel' or not numero_de_demo(v_s.numero) then
    raise exception 'cette sortie n''est pas une sortie de démo';
  end if;
  return v_s;
end $$;

-- 1. Ce qui attend d'être payé, pour les opérateurs dont ce terminal porte un float actif.
create or replace function totem_sorties_demo(p_terminal text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce((select demo from terminaux where id = p_terminal), false) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('reference', s.reference, 'operateur', s.operateur, 'numero', s.numero,
                                        'montant', s.montant_xaf, 'nom', s.nom_beneficiaire) order by s.cree_le)
      from sorties s
     where s.mode = 'manuel' and s.etat = 'en_attente' and s.payee_le is null and numero_de_demo(s.numero)
       and exists (select 1 from floats f where f.terminal = p_terminal and f.actif and f.operateur = s.operateur)), '[]'::jsonb);
end $$;

-- 2. La prendre : une seule fois. Une seconde prise (deux réveils croisés) est refusée.
create or replace function totem_prendre_sortie_demo(p_terminal text, p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties;
begin
  v_s := _sortie_de_demo(p_terminal, p_reference);
  if v_s.etat <> 'en_attente' or v_s.payee_le is not null then raise exception 'sortie déjà prise' using detail = v_s.etat; end if;
  update sorties set etat = 'en_cours', pris_le = now() where id = v_s.id;
  return jsonb_build_object('reference', v_s.reference, 'pris', true);
end $$;

-- 3. Payée : l'ID du transfert de démo, comme « J'ai payé » — sans seuil à deux
-- personnes (de faux francs, payés par une machine qui ne se confirme pas elle-même).
create or replace function totem_sortie_demo_payee(p_terminal text, p_reference text, p_transaction_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties; v_id text := normaliser_transaction_id(p_transaction_id);
begin
  v_s := _sortie_de_demo(p_terminal, p_reference);
  if v_s.payee_le is not null then
    if v_s.transaction_id = v_id then return _sortie_json(v_s) || '{"deja": true}'; end if;
    raise exception 'paiement déjà enregistré' using detail = v_s.transaction_id;
  end if;
  if v_s.etat <> 'en_cours' then raise exception 'cette sortie n''a pas été prise' using detail = v_s.etat; end if;
  if length(v_id) < 6 then raise exception 'transaction ID invalide'; end if;
  if exists (select 1 from sorties where operateur = v_s.operateur and transaction_id = v_id and id <> v_s.id) then
    raise exception 'ce transaction ID prouve déjà une autre sortie';
  end if;
  update sorties set transaction_id = v_id, payee_le = now() where id = v_s.id;
  update sorties_constatees set sortie_id = v_s.id where operateur = v_s.operateur and transaction_id = v_id and sortie_id is null;
  v_s := _clore_sortie_manuelle(v_s.id);
  return _sortie_json(v_s) || jsonb_build_object('rapprochement', _rapprochement(v_s));
end $$;

-- 4. Échouée : TOTEM n'a rien pu envoyer (float à court, numéro inconnu). Les
-- XAFe mis de côté reviennent au testeur, avec le motif.
create or replace function totem_sortie_demo_echouee(p_terminal text, p_reference text, p_motif text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties; v_motif text := left(coalesce(nullif(trim(p_motif), ''), 'le paiement de démo n''a pas pu partir'), 200);
begin
  v_s := _sortie_de_demo(p_terminal, p_reference);
  if v_s.etat <> 'en_cours' or v_s.payee_le is not null then raise exception 'cette sortie ne s''échoue plus' using detail = v_s.etat; end if;
  perform _mouvement(v_s.compte_id, 'XAFe', v_s.montant, -v_s.montant, 'sortie_annulee', 'sorties', v_s.reference);
  update sorties set etat = 'annulee', montant_rendu = montant, motif = 'Démo : ' || v_motif, terminee_le = now()
   where id = v_s.id returning * into v_s;
  perform _notifier(v_s.compte_id, 'Sortie refusée',
    format('%s XAFe sont revenus sur votre compte. %s', to_char(v_s.montant, 'FM999G999G999G999'), v_s.motif), '/historique/' || v_s.reference);
  return _sortie_json(v_s);
end $$;

-- ─────────────────────────────── le réveil ─────────────────────────────────
-- L'adresse que Glisil appelle à chaque sortie de démo (réglée par l'équipe :
-- l'adresse du site TOTEM suivie de /api/demo/reveil). Vide : pas de réveil,
-- TOTEM paie au prochain geste de démo.
insert into parametres (cle, valeur) values ('demo_totem', '{"reveil": null}') on conflict (cle) do nothing;

create or replace function _reveiller_totem_demo() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare v_url text := parametre('demo_totem') ->> 'reveil'; v_cle text; v_ts text := extract(epoch from now())::bigint::text;
begin
  if v_url is null or v_url !~ '^https://' or not numero_de_demo(new.numero) then return new; end if;
  select t.cle into v_cle from terminaux t
   where t.demo and t.cle is not null and exists (select 1 from floats f where f.terminal = t.id and f.actif and f.operateur = new.operateur)
   order by t.id limit 1;
  if v_cle is null then return new; end if;
  -- la signature de la porte, à l'octet : hex(HMAC-SHA256(clé, horodatage + "." + "POST demo-reveil" + "." + corps vide))
  perform net.http_post(url := v_url, body := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-glisil-horodatage', v_ts,
                                  'x-glisil-signature', encode(extensions.hmac(v_ts || '.POST demo-reveil.', v_cle, 'sha256'), 'hex')),
    timeout_milliseconds := 5000);
  return new;
exception when others then
  return new;  -- un réveil manqué ne fait jamais tomber une sortie : TOTEM paiera au prochain geste
end $$;

drop trigger if exists sorties_reveiller_totem_demo on sorties;
create trigger sorties_reveiller_totem_demo after insert on sorties
  for each row when (new.mode = 'manuel') execute function _reveiller_totem_demo();

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on function _sortie_de_demo(text, text), totem_sorties_demo(text), totem_prendre_sortie_demo(text, text),
  totem_sortie_demo_payee(text, text, text), totem_sortie_demo_echouee(text, text, text), _reveiller_totem_demo()
  from public, anon, authenticated;
grant execute on function totem_sorties_demo(text), totem_prendre_sortie_demo(text, text),
  totem_sortie_demo_payee(text, text, text), totem_sortie_demo_echouee(text, text, text) to service_role;
