-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0038 · le remboursement manuel, PROUVÉ par la puce            ║
-- ║                                                                        ║
-- ║  Jusqu'ici (0014), taper un transaction ID suffisait : les XAFe du     ║
-- ║  client étaient détruits aussitôt, le SMS de la puce ne servait qu'à   ║
-- ║  informer. Une faute de frappe, un ID inventé, et Glisil détruisait    ║
-- ║  de l'argent pour un paiement qui n'avait pas eu lieu.                 ║
-- ║                                                                        ║
-- ║  Maintenant, l'ID tapé met la sortie « en preuve ». Ses XAFe ne sont   ║
-- ║  détruits que lorsque TOTEM a relevé, sur une puce de Glisil, le SMS   ║
-- ║  de l'opérateur qui montre CE paiement : même ID, même montant, même   ║
-- ║  numéro, relevé après la demande, d'un terminal du même monde (vrai    ║
-- ║  ou démo), et qui ne prouve pas déjà une autre sortie. La règle vit    ║
-- ║  DANS _clore_sortie_manuelle : aucun appelant ne la contourne.         ║
-- ║                                                                        ║
-- ║  1. l'état « en_preuve », les colonnes de la preuve ;                  ║
-- ║  2. sortie_paiements : un gros remboursement se paie en plusieurs      ║
-- ║     transferts (les opérateurs plafonnent un transfert), un ID chacun ;║
-- ║  3. le réglage : mode manuel, seuil null (le propriétaire seul),       ║
-- ║     forçage fermé ;                                                    ║
-- ║  4. la preuve, la clôture (une seule fois), la tentative de clôture ;  ║
-- ║  5. l'équipe : payer, corriger un ID mal tapé, revérifier, confirmer   ║
-- ║     (au-delà du seuil), forcer (dernier recours), refuser ;            ║
-- ║  6. le SMS sortant de TOTEM clôt la sortie qui l'attendait ; l'ID tapé ║
-- ║     et le SMS qui arrive prennent le MÊME verrou (course 12.4) ;       ║
-- ║  7. le client voit « en vérification », ses ID, et reçoit un e-mail.   ║
-- ║                                                                        ║
-- ║  Les sorties de démo (0032) gardent leur chemin : payées par TOTEM     ║
-- ║  démo, closes sans SMS. Rien ne change dans la porte de TOTEM.         ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ──────────────────────── 1 · l'état et les colonnes ───────────────────────
alter table sorties drop constraint if exists sorties_etat_check;
alter table sorties add constraint sorties_etat_check
  check (etat in ('en_attente', 'en_cours', 'en_preuve', 'envoyee', 'partielle', 'echouee', 'annulee'));
alter table sorties add column if not exists prouvee_le     timestamptz;  -- le SMS de la puce a prouvé le dernier paiement (null : forcée, ou démo)
alter table sorties add column if not exists cloture_erreur text;         -- la preuve était là, la clôture a échoué : dit à l'équipe, effacé au succès
alter table sorties add column if not exists forcee_par     uuid;
alter table sorties add column if not exists forcee_le      timestamptz;
alter table sorties add column if not exists forcee_note    text;
drop index if exists sorties_manuelles_a_traiter;
create index sorties_manuelles_a_traiter on sorties (cree_le) where mode = 'manuel' and etat in ('en_attente', 'en_cours', 'en_preuve');

-- ───────────────────── 2 · un paiement par transfert ───────────────────────
-- sorties.transaction_id garde le PREMIER ID actif : les sorties de démo, le
-- texte de la notification et l'index sorties_un_paiement le lisent toujours.
create table if not exists sortie_paiements (
  id             bigint generated always as identity primary key,
  sortie_id      uuid not null references sorties(id),
  operateur      text not null,
  transaction_id text not null,                                   -- normaliser_transaction_id()
  montant        numeric(20,2) not null check (montant > 0 and montant = trunc(montant)),
  constatee_id   bigint references sorties_constatees(id),        -- le SMS qui l'a prouvé, posé à la clôture
  saisi_par      uuid,                                            -- null : repris d'avant, ou TOTEM démo
  saisi_le       timestamptz not null default now(),
  retire_le      timestamptz, retire_par uuid, retire_note text   -- un ID ou un montant mal tapé, remplacé (admin_corriger_paiement)
);
create unique index if not exists sortie_paiements_un_id on sortie_paiements (operateur, transaction_id) where retire_le is null;
create index if not exists sortie_paiements_de_la_sortie on sortie_paiements (sortie_id) where retire_le is null;
alter table sortie_paiements enable row level security;
revoke all on table sortie_paiements from public, anon, authenticated;
grant all on table sortie_paiements to service_role;

-- reprise (bases de bêta seulement ; vide en production), une fois
insert into sortie_paiements (sortie_id, operateur, transaction_id, montant, saisi_par, saisi_le)
select s.id, s.operateur, s.transaction_id, s.montant_xaf, s.payee_par, s.payee_le from sorties s
 where s.mode = 'manuel' and s.transaction_id is not null and s.payee_le is not null
   and not exists (select 1 from sortie_paiements p where p.sortie_id = s.id);
update sorties set etat = 'en_preuve' where mode = 'manuel' and etat = 'en_cours' and payee_le is not null;
-- sorties_constatees.sortie_id veut dire maintenant « la sortie que ce SMS a PROUVÉE » : seule la
-- clôture le pose (plus à l'insertion, plus à la saisie). Les liens d'avant sont gardés.

-- ─────────────────────────────── 3 · le réglage ────────────────────────────
-- La partie droite l'emporte : une clé que l'équipe a déjà posée est gardée.
-- « ouvertes » n'est pas touché : le profil de production en décide.
update parametres set valeur = jsonb_build_object('mode', 'manuel', 'seuil_deux_personnes', null, 'forcage', false) || valeur where cle = 'sortie';
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

-- ─────────────────────── 4 · la preuve et la clôture ───────────────────────
-- Au-delà du seuil (s'il y en a un), une seconde personne confirme.
create or replace function _seuil_atteint(s sorties) returns boolean
language sql stable set search_path = public as $$
  select nullif(parametre('sortie') ->> 'seuil_deux_personnes', '')::numeric is not null
     and s.montant_xaf >= nullif(parametre('sortie') ->> 'seuil_deux_personnes', '')::numeric
$$;

-- UN paiement jugé contre les SMS relevés qui portent son ID. Le premier motif
-- qui manque dit pourquoi, en mots ; un SMS qui concorde l'emporte sur les autres.
create or replace function _preuve_du_paiement(p_operateur text, p_transaction_id text, p_montant numeric, s sorties) returns jsonb
language sql stable set search_path = public as $$
  with c as (
    select k.id, k.montant, k.numero_beneficiaire, k.terminal, k.emis_le, k.texte,
      case
        when k.float_id is null then 'le SMS vient d''une puce qui n''est pas un float Glisil de ce terminal'
        when coalesce(t.demo, false) and not numero_de_demo(s.numero) then 'le SMS vient d''un terminal de démo'
        when not coalesce(t.demo, false) and numero_de_demo(s.numero) then 'le SMS vient d''un vrai terminal, la sortie est de démo'
        when k.sortie_id is not null and k.sortie_id <> s.id then 'ce SMS prouve déjà une autre sortie'
        when k.recu_le < s.cree_le then 'ce paiement a été relevé avant la demande du client'
        when k.montant is null then 'le SMS ne dit pas le montant'
        when k.montant <> p_montant then format('le SMS dit %s XAF, ce paiement %s XAF', to_char(k.montant, 'FM999G999G999G999'), to_char(p_montant, 'FM999G999G999G999'))
        when k.numero_beneficiaire is null then 'le SMS ne dit pas le numéro du bénéficiaire : TOTEM doit apprendre ce format'
        when k.numero_beneficiaire <> s.numero then format('le SMS dit le %s, la sortie le %s', k.numero_beneficiaire, s.numero)
      end motif
      from sorties_constatees k join terminaux t on t.id = k.terminal
     where k.operateur = p_operateur and k.transaction_id = p_transaction_id),
  m as (select * from c order by (motif is null) desc, id limit 1)
  select case when not exists (select 1 from c)
    then jsonb_build_object('transaction_id', p_transaction_id, 'montant_saisi', p_montant, 'etat', 'absent', 'motif', 'le SMS de la puce n''est pas encore arrivé')
    else (select jsonb_build_object('transaction_id', p_transaction_id, 'montant_saisi', p_montant,
                                    'etat', case when m.motif is null then 'concorde' else 'ecart' end, 'motif', m.motif,
                                    'constatee_id', m.id, 'montant', m.montant, 'numero', m.numero_beneficiaire,
                                    'terminal', m.terminal, 'emis_le', m.emis_le, 'texte', m.texte) from m)
  end
$$;

-- Toute la sortie : chaque paiement actif, et leur somme. Même signature que
-- 0014 : admin_sorties, totem_sortie_demo_payee, et les gestes de l'équipe la lisent.
create or replace function _rapprochement(s sorties) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  p record; x jsonb; v_paiements jsonb := '[]'::jsonb; v_paye numeric := 0;
  v_etat text; v_motif text;
begin
  for p in select operateur, transaction_id, montant from sortie_paiements where sortie_id = s.id and retire_le is null order by id loop
    x := _preuve_du_paiement(p.operateur, p.transaction_id, p.montant, s);
    v_paiements := v_paiements || jsonb_build_array(x); v_paye := v_paye + p.montant;
  end loop;
  -- une sortie de démo, ou d'avant 0038 : son seul ID
  if jsonb_array_length(v_paiements) = 0 and s.transaction_id is not null then
    x := _preuve_du_paiement(s.operateur, s.transaction_id, s.montant_xaf, s);
    v_paiements := jsonb_build_array(x); v_paye := s.montant_xaf;
  end if;
  if jsonb_array_length(v_paiements) = 0 then return null; end if;
  if exists (select 1 from jsonb_array_elements(v_paiements) e where e ->> 'etat' = 'ecart') then
    v_etat := 'ecart';
    v_motif := (select e ->> 'motif' from jsonb_array_elements(v_paiements) e where e ->> 'etat' = 'ecart' limit 1);
  elsif exists (select 1 from jsonb_array_elements(v_paiements) e where e ->> 'etat' = 'absent') then
    v_etat := 'absent';
    v_motif := (select e ->> 'motif' from jsonb_array_elements(v_paiements) e where e ->> 'etat' = 'absent' limit 1);
  elsif v_paye <> s.montant_xaf then
    v_etat := 'partiel';
    v_motif := format('%s XAF payés sur %s : il reste %s XAF à envoyer', to_char(v_paye, 'FM999G999G999G999'),
                      to_char(s.montant_xaf, 'FM999G999G999G999'), to_char(s.montant_xaf - v_paye, 'FM999G999G999G999'));
  else
    v_etat := 'concorde';
  end if;
  return jsonb_build_object('etat', v_etat, 'motif', v_motif, 'paye', v_paye, 'reste', s.montant_xaf - v_paye, 'paiements', v_paiements)
         -- un seul paiement : ses clés à plat, comme 0014 (l'écran de l'équipe les lit)
         || case when jsonb_array_length(v_paiements) = 1 then (v_paiements -> 0) - 'etat' - 'motif' - 'transaction_id' - 'montant_saisi' else '{}'::jsonb end;
end $$;

-- LA règle. Une sortie vers un vrai numéro n'est détruite que si chaque
-- paiement est prouvé par le SMS de la puce, que leur somme fait le montant,
-- et — au-delà du seuil — qu'une seconde personne a confirmé. Une seule fois :
-- appelée deux fois, elle refuse au lieu de détruire deux fois.
create or replace function _clore_sortie_manuelle(p_id uuid) returns sorties
language plpgsql set search_path = public as $$
declare v_s sorties; v_r jsonb; v_demo boolean; v_ids text;
begin
  select * into v_s from sorties where id = p_id for update;
  if not found then raise exception 'sortie inconnue'; end if;
  if v_s.mode <> 'manuel' or v_s.etat not in ('en_cours', 'en_preuve') or v_s.payee_le is null or v_s.transaction_id is null then
    raise exception 'cette sortie ne se clôt pas' using detail = v_s.etat;
  end if;
  v_demo := coalesce(numero_de_demo(v_s.numero), false);
  if not v_demo then
    if _seuil_atteint(v_s) and v_s.confirmee_par is null then
      raise exception 'une autre personne confirme' using detail = 'au-delà du seuil, deux personnes';
    end if;
    if v_s.forcee_le is null then
      v_r := _rapprochement(v_s);
      if v_r ->> 'etat' is distinct from 'concorde' then
        raise exception 'paiement pas encore prouvé' using detail = coalesce(v_r ->> 'motif', 'le SMS de la puce manque');
      end if;
      update sorties_constatees k set sortie_id = v_s.id from jsonb_array_elements(v_r -> 'paiements') e where k.id = (e ->> 'constatee_id')::bigint;
      update sortie_paiements p set constatee_id = (e ->> 'constatee_id')::bigint from jsonb_array_elements(v_r -> 'paiements') e
       where p.sortie_id = v_s.id and p.retire_le is null and p.transaction_id = e ->> 'transaction_id';
    end if;
  end if;
  -- la destruction, comme 0014
  perform _mouvement(v_s.compte_id, 'XAFe', 0, -v_s.montant, 'sortie_envoyee', 'sorties', v_s.reference);
  if v_s.frais > 0 then perform _mouvement(compte_maison(), 'XAFe', v_s.frais, 0, 'frais_sortie', 'sorties', v_s.reference); end if;
  insert into emissions (sens, montant, source_table, source_id) values ('destruction', v_s.montant_xaf, 'sorties', v_s.reference);
  update sorties set etat = 'envoyee', montant_envoye = montant_xaf, terminee_le = now(), cloture_erreur = null,
                     prouvee_le = case when not v_demo and forcee_le is null then now() end
   where id = p_id returning * into v_s;
  v_ids := coalesce((select string_agg(transaction_id, ', ' order by id) from sortie_paiements where sortie_id = v_s.id and retire_le is null), v_s.transaction_id);
  -- le texte d'avant, au caractère près : l'application le traduit (app/src/noyau/serveur.ts)
  perform _notifier(v_s.compte_id, 'Sortie envoyée',
    format('%s XAF envoyés au %s. Transaction ID : %s.', to_char(v_s.montant_xaf, 'FM999G999G999G999'), v_s.numero, v_ids),
    '/historique/' || v_s.reference);
  if not v_demo then
    perform _envoyer_courriel(v_s.compte_id, 'sortie_payee', jsonb_build_object(
      'reference', v_s.reference, 'montant', v_s.montant, 'frais', v_s.frais, 'montant_xaf', v_s.montant_xaf,
      'operateur', v_s.operateur, 'operateur_nom', (select nom from operateurs where id = v_s.operateur),
      'numero', v_s.numero, 'nom_beneficiaire', v_s.nom_beneficiaire, 'transaction_id', v_ids,
      'paiements', (select coalesce(jsonb_agg(jsonb_build_object('transaction_id', transaction_id, 'montant', montant) order by id), '[]'::jsonb)
                      from sortie_paiements where sortie_id = v_s.id and retire_le is null),
      'payee_le', v_s.payee_le, 'envoyee_le', v_s.terminee_le, 'lien', '/historique/' || v_s.reference),
      'sortie_payee:' || v_s.reference);
  end if;
  return v_s;
end $$;

-- Tenter la clôture : ne lève JAMAIS pour « pas encore prouvé » (la sortie
-- reste en preuve et dit pourquoi) ; seules les vraies erreurs remontent.
-- Les appelants prennent le verrou de l'ID AVANT la ligne de la sortie :
-- verrou de l'ID → sortie → soldes → maison.
create or replace function _tenter_cloture(p_id uuid) returns sorties
language plpgsql set search_path = public as $$
declare v_s sorties;
begin
  select * into v_s from sorties where id = p_id for update;
  if v_s.mode <> 'manuel' or v_s.etat <> 'en_preuve' then return v_s; end if;
  if v_s.forcee_le is null and not coalesce(numero_de_demo(v_s.numero), false)
     and _rapprochement(v_s) ->> 'etat' is distinct from 'concorde' then return v_s; end if;
  if _seuil_atteint(v_s) and v_s.confirmee_par is null and not coalesce(numero_de_demo(v_s.numero), false) then return v_s; end if;
  return _clore_sortie_manuelle(p_id);
end $$;

-- « C'est ce paiement » : les SMS relevés qui pourraient prouver ce qui reste à payer.
create or replace function _candidats_de_preuve(s sorties) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'transaction_id', k.transaction_id, 'montant', k.montant,
                                               'emis_le', k.emis_le, 'terminal', k.terminal) order by k.recu_le desc), '[]'::jsonb)
    from (select k.* from sorties_constatees k join terminaux t on t.id = k.terminal
           where k.operateur = s.operateur and k.numero_beneficiaire = s.numero and k.recu_le >= s.cree_le
             and k.sortie_id is null and k.float_id is not null and k.transaction_id is not null
             and coalesce(t.demo, false) = coalesce(numero_de_demo(s.numero), false)
             and k.montant <= s.montant_xaf - coalesce((select sum(montant) from sortie_paiements where sortie_id = s.id and retire_le is null), 0)
             and not exists (select 1 from sortie_paiements p where p.operateur = k.operateur and p.transaction_id = k.transaction_id and p.retire_le is null)
             and not exists (select 1 from sorties x where x.operateur = k.operateur and x.transaction_id = k.transaction_id)
           order by k.recu_le desc limit 5) k
$$;

-- Ce que le client voit d'une sortie : ses paiements (jamais le texte du SMS, ni qui dans l'équipe).
create or replace function _sortie_json(s sorties) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'reference', s.reference, 'etat', s.etat, 'operateur', s.operateur, 'numero', s.numero,
    'montant', s.montant, 'frais', s.frais, 'montant_xaf', s.montant_xaf,
    'montant_envoye', s.montant_envoye, 'montant_rendu', s.montant_rendu,
    'transferts', (select count(*) from commandes where sortie_id = s.id),
    'cree_le', s.cree_le, 'terminee_le', s.terminee_le,
    'mode', s.mode, 'nom_beneficiaire', s.nom_beneficiaire,
    'pris_le', s.pris_le, 'transaction_id', s.transaction_id,
    'payee_le', coalesce(s.confirmee_le, s.payee_le), 'motif', s.motif,
    'prouvee_le', s.prouvee_le,
    'paiements', (select coalesce(jsonb_agg(jsonb_build_object('transaction_id', p.transaction_id, 'montant', p.montant) order by p.id), '[]'::jsonb)
                    from sortie_paiements p where p.sortie_id = s.id and p.retire_le is null))
$$;

-- ──────────────────────────── 5 · les gestes de l'équipe ───────────────────
-- « J'ai payé » : le paiement est noté, la sortie passe en preuve. Elle se clôt
-- tout de suite si le SMS de la puce est déjà là ; sinon, à son arrivée.
-- « J'ai payé » est un point de non-retour : payee_le reste posé, et la sortie
-- ne se refuse plus (règle de 0014 : payé, ça ne se refuse plus).
drop function if exists admin_payer_sortie(text, text, text);
create or replace function admin_payer_sortie(p_reference text, p_transaction_id text, p_preuve text default null, p_montant numeric default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties; v_id text := normaliser_transaction_id(p_transaction_id); v_op text; v_reste numeric; v_m numeric;
begin
  perform _exiger_droit('sorties');
  if length(v_id) < 6 then raise exception 'transaction ID invalide' using detail = 'recopiez-le du SMS de l''opérateur'; end if;
  -- l'opérateur ne change jamais : lu sans verrou, pour prendre le verrou de l'ID AVANT celui de la ligne
  select operateur into v_op from sorties where reference = p_reference;
  if not found then raise exception 'sortie inconnue'; end if;
  perform pg_advisory_xact_lock(hashtext('sortie_tx:' || v_op || ':' || v_id));
  v_s := _sortie_a_traiter(p_reference);
  if exists (select 1 from sortie_paiements where sortie_id = v_s.id and transaction_id = v_id and retire_le is null) then
    return _sortie_json(v_s) || jsonb_build_object('deja', true, 'rapprochement', _rapprochement(v_s));   -- double clic, réponse perdue
  end if;
  if v_s.etat not in ('en_attente', 'en_cours', 'en_preuve') then raise exception 'cette sortie est déjà close' using detail = v_s.etat; end if;
  if p_preuve is not null and p_preuve !~ ('^' || v_s.reference || '/[A-Za-z0-9._-]{1,80}$') then
    raise exception 'capture invalide' using detail = 'elle se dépose dans le dossier de la sortie';
  end if;
  if exists (select 1 from sortie_paiements where operateur = v_s.operateur and transaction_id = v_id and retire_le is null)
     or exists (select 1 from sorties where operateur = v_s.operateur and transaction_id = v_id and id <> v_s.id) then
    raise exception 'ce transaction ID prouve déjà une autre sortie';
  end if;
  v_reste := v_s.montant_xaf - coalesce((select sum(montant) from sortie_paiements where sortie_id = v_s.id and retire_le is null), 0);
  if v_reste <= 0 then raise exception 'cette sortie est déjà entièrement payée' using detail = 'corrigez l''ID mal tapé au lieu d''en ajouter un'; end if;
  v_m := coalesce(p_montant, v_reste);
  if v_m <= 0 or v_m <> trunc(v_m) or v_m > v_reste then
    raise exception 'montant du paiement invalide' using detail = format('entre 1 et %s XAF', to_char(v_reste, 'FM999G999G999G999'));
  end if;
  insert into sortie_paiements (sortie_id, operateur, transaction_id, montant, saisi_par) values (v_s.id, v_s.operateur, v_id, v_m, auth.uid());
  update sorties set transaction_id = coalesce(transaction_id, v_id), preuve = coalesce(p_preuve, preuve), payee_par = coalesce(payee_par, auth.uid()),
                     payee_le = coalesce(payee_le, now()), etat = 'en_preuve', pris_par = coalesce(pris_par, auth.uid()), pris_le = coalesce(pris_le, now())
   where id = v_s.id returning * into v_s;
  perform _journaliser('payer_sortie', p_reference, jsonb_build_object('transaction_id', v_id, 'montant', v_m, 'preuve', p_preuve is not null));
  v_s := _tenter_cloture(v_s.id);
  return _sortie_json(v_s) || jsonb_build_object('rapprochement', _rapprochement(v_s),
           'a_confirmer', v_s.etat = 'en_preuve' and _seuil_atteint(v_s) and v_s.confirmee_par is null);
end $$;

-- Un ID ou un montant mal tapé, remplacé — jamais un paiement déjà prouvé.
create or replace function admin_corriger_paiement(p_reference text, p_ancien text, p_nouveau text, p_note text, p_montant numeric default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_s sorties; v_p sortie_paiements; v_op text; v_note text := trim(coalesce(p_note, ''));
  v_ancien text := normaliser_transaction_id(p_ancien); v_nouveau text := normaliser_transaction_id(p_nouveau);
  v_autres numeric; v_m numeric;
begin
  perform _exiger_droit('sorties');
  if length(v_note) < 3 then raise exception 'une note est exigée' using detail = 'dites ce qui était mal tapé'; end if;
  if length(v_nouveau) < 6 then raise exception 'transaction ID invalide' using detail = 'recopiez-le du SMS de l''opérateur'; end if;
  select operateur into v_op from sorties where reference = p_reference;
  if not found then raise exception 'sortie inconnue'; end if;
  -- les deux verrous, toujours dans le même ordre : pas d'interblocage avec totem_sms_sortant
  perform pg_advisory_xact_lock(hashtext('sortie_tx:' || v_op || ':' || least(v_ancien, v_nouveau)));
  if v_ancien <> v_nouveau then perform pg_advisory_xact_lock(hashtext('sortie_tx:' || v_op || ':' || greatest(v_ancien, v_nouveau))); end if;
  v_s := _sortie_a_traiter(p_reference);
  if v_s.etat <> 'en_preuve' then raise exception 'cette sortie n''attend pas de preuve' using detail = v_s.etat; end if;
  select * into v_p from sortie_paiements where sortie_id = v_s.id and transaction_id = v_ancien and retire_le is null for update;
  if not found then raise exception 'paiement inconnu sur cette sortie'; end if;
  if _preuve_du_paiement(v_p.operateur, v_p.transaction_id, v_p.montant, v_s) ->> 'etat' = 'concorde' then
    raise exception 'ce paiement est prouvé' using detail = 'le SMS de la puce le montre : il ne se corrige pas';
  end if;
  v_autres := coalesce((select sum(montant) from sortie_paiements where sortie_id = v_s.id and retire_le is null and id <> v_p.id), 0);
  v_m := coalesce(p_montant, v_p.montant);
  if v_m <= 0 or v_m <> trunc(v_m) or v_m > v_s.montant_xaf - v_autres then
    raise exception 'montant du paiement invalide' using detail = format('entre 1 et %s XAF', to_char(v_s.montant_xaf - v_autres, 'FM999G999G999G999'));
  end if;
  if v_nouveau <> v_ancien and (exists (select 1 from sortie_paiements where operateur = v_s.operateur and transaction_id = v_nouveau and retire_le is null)
                                or exists (select 1 from sorties where operateur = v_s.operateur and transaction_id = v_nouveau and id <> v_s.id)) then
    raise exception 'ce transaction ID prouve déjà une autre sortie';
  end if;
  update sortie_paiements set retire_le = now(), retire_par = auth.uid(), retire_note = v_note where id = v_p.id;
  insert into sortie_paiements (sortie_id, operateur, transaction_id, montant, saisi_par) values (v_s.id, v_s.operateur, v_nouveau, v_m, auth.uid());
  update sorties set transaction_id = (select transaction_id from sortie_paiements where sortie_id = v_s.id and retire_le is null order by id limit 1)
   where id = v_s.id;
  perform _journaliser('corriger_paiement', p_reference, jsonb_build_object('ancien', v_ancien, 'nouveau', v_nouveau, 'montant_avant', v_p.montant, 'montant', v_m, 'note', v_note));
  v_s := _tenter_cloture(v_s.id);
  return _sortie_json(v_s) || jsonb_build_object('rapprochement', _rapprochement(v_s));
end $$;

-- « Revérifier » : relire la preuve, et clore si elle est là. La sortie de
-- secours après une clôture qui a échoué (cloture_erreur).
create or replace function admin_verifier_sortie(p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties;
begin
  perform _exiger_droit('sorties');
  v_s := _sortie_a_traiter(p_reference);
  if v_s.etat = 'en_preuve' then v_s := _tenter_cloture(v_s.id); end if;
  if v_s.etat = 'envoyee' then perform _journaliser('verifier_sortie', p_reference); end if;
  return _sortie_json(v_s) || jsonb_build_object('rapprochement', _rapprochement(v_s));
end $$;

-- Au-delà du seuil : une AUTRE personne confirme. Une confirmation ne remplace
-- pas le SMS : en écart, la sortie reste en preuve.
create or replace function admin_confirmer_sortie(p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties;
begin
  perform _exiger_droit('sorties');
  v_s := _sortie_a_traiter(p_reference);
  if v_s.etat <> 'en_preuve' then raise exception 'aucun paiement à confirmer' using detail = v_s.etat; end if;
  if not _seuil_atteint(v_s) then raise exception 'cette sortie ne demande pas de seconde personne'; end if;
  if v_s.payee_par = auth.uid() or exists (select 1 from sortie_paiements where sortie_id = v_s.id and saisi_par = auth.uid()) then
    raise exception 'une autre personne confirme' using detail = 'celle qui a payé ne confirme pas son propre paiement';
  end if;
  if v_s.confirmee_par is null then
    update sorties set confirmee_par = auth.uid(), confirmee_le = now() where id = v_s.id;
    perform _journaliser('confirmer_sortie', p_reference);
  end if;
  v_s := _tenter_cloture(v_s.id);
  return _sortie_json(v_s) || jsonb_build_object('rapprochement', _rapprochement(v_s));
end $$;

-- Le dernier recours : clore SANS le SMS de la puce (un paiement prouvé
-- autrement, par le relevé de l'opérateur). Fermé par défaut ; super admin
-- seulement ; trente minutes après le paiement ; journalisé, et une alerte.
create or replace function admin_forcer_sortie(p_reference text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties; v_r jsonb; v_note text := trim(coalesce(p_note, '')); v_reste numeric;
begin
  perform _exiger_droit('sorties');
  perform _exiger_droit('parametres');   -- les deux : le super admin seul
  if not coalesce((parametre('sortie') ->> 'forcage')::boolean, false) then
    raise exception 'le forçage est fermé' using detail = 'Paramètres → Sorties → forcage';
  end if;
  if length(v_note) < 10 then raise exception 'une note est exigée' using detail = 'dites comment le paiement est prouvé'; end if;
  v_s := _sortie_a_traiter(p_reference);
  if v_s.etat <> 'en_preuve' then raise exception 'cette sortie n''attend pas de preuve' using detail = v_s.etat; end if;
  if v_s.payee_le > now() - interval '30 minutes' then
    raise exception 'attendez le SMS de la puce' using detail = 'le forçage s''ouvre 30 minutes après le paiement';
  end if;
  v_reste := v_s.montant_xaf - coalesce((select sum(montant) from sortie_paiements where sortie_id = v_s.id and retire_le is null), 0);
  if v_reste <> 0 then raise exception 'le paiement n''est pas complet' using detail = format('il reste %s XAF', to_char(v_reste, 'FM999G999G999G999')); end if;
  v_r := _rapprochement(v_s);
  if v_r ->> 'etat' = 'concorde' then   -- rien à forcer : la preuve est là
    v_s := _tenter_cloture(v_s.id);
    return _sortie_json(v_s) || jsonb_build_object('rapprochement', _rapprochement(v_s));
  end if;
  update sorties set forcee_par = auth.uid(), forcee_le = now(), forcee_note = v_note where id = v_s.id;
  perform _journaliser('forcer_sortie', p_reference, jsonb_build_object('note', v_note, 'rapprochement', v_r));
  perform _parite_alerter('sortie_forcee:' || v_s.reference, 'anomalie',
    format('%s clôturée sans le SMS de la puce : %s XAF au %s (%s)', v_s.reference, to_char(v_s.montant_xaf, 'FM999G999G999G999'), v_s.numero, v_note),
    jsonb_build_object('reference', v_s.reference, 'rapprochement', v_r));
  v_s := _tenter_cloture(v_s.id);   -- le seuil vaut toujours : forcer ne remplace que le SMS
  return _sortie_json(v_s) || jsonb_build_object('rapprochement', _rapprochement(v_s));
end $$;

-- Refuser AVANT paiement seulement ; le client est prévenu, aussi par e-mail.
create or replace function admin_refuser_sortie(p_reference text, p_motif text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties; v_motif text := nullif(trim(coalesce(p_motif, '')), '');
begin
  perform _exiger_droit('sorties');
  if v_motif is null or length(v_motif) < 3 then raise exception 'un motif est exigé' using detail = 'il est montré au client'; end if;
  v_s := _sortie_a_traiter(p_reference);
  -- le paiement d'abord : une sortie en preuve répond « un paiement est enregistré », pas « déjà close »
  if v_s.payee_le is not null or exists (select 1 from sortie_paiements where sortie_id = v_s.id and retire_le is null) then
    raise exception 'un paiement est enregistré' using detail = 'l''argent est parti : la sortie ne se refuse plus';
  end if;
  if v_s.etat not in ('en_attente', 'en_cours') then raise exception 'cette sortie est déjà close' using detail = v_s.etat; end if;
  perform _mouvement(v_s.compte_id, 'XAFe', v_s.montant, -v_s.montant, 'sortie_annulee', 'sorties', v_s.reference);
  update sorties set etat = 'annulee', montant_rendu = montant, motif = v_motif, terminee_le = now()
   where id = v_s.id returning * into v_s;
  perform _notifier(v_s.compte_id, 'Sortie refusée',
    format('%s XAFe sont revenus sur votre compte. %s', to_char(v_s.montant, 'FM999G999G999G999'), v_motif), '/historique/' || v_s.reference);
  if not coalesce(numero_de_demo(v_s.numero), false) then
    perform _envoyer_courriel(v_s.compte_id, 'sortie_refusee',
      jsonb_build_object('reference', v_s.reference, 'montant', v_s.montant, 'motif', v_motif, 'lien', '/historique/' || v_s.reference),
      'sortie_refusee:' || v_s.reference);
  end if;
  perform _journaliser('refuser_sortie', p_reference, jsonb_build_object('motif', v_motif));
  return _sortie_json(v_s);
end $$;

-- La liste de l'équipe : les paiements (actifs et retirés), ce qui reste, la preuve, le forçage.
create or replace function admin_sorties(p_etat text default null, p_n int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(_sortie_json(s) || jsonb_build_object(
           'compte', jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'palier', c.palier),
           'preuve', s.preuve,
           'pris_par', (select coalesce(a.nom, a.email) from administrateurs a where a.id = s.pris_par),
           'payee_par', (select coalesce(a.nom, a.email) from administrateurs a where a.id = s.payee_par),
           'payee_par_moi', s.payee_par = auth.uid() or exists (select 1 from sortie_paiements p where p.sortie_id = s.id and p.saisi_par = auth.uid()),
           'confirmee_par', (select coalesce(a.nom, a.email) from administrateurs a where a.id = s.confirmee_par),
           'en_preuve', s.etat = 'en_preuve',
           'a_confirmer', s.mode = 'manuel' and s.etat = 'en_preuve' and _seuil_atteint(s) and s.confirmee_par is null,
           'reste', s.montant_xaf - coalesce((select sum(p.montant) from sortie_paiements p where p.sortie_id = s.id and p.retire_le is null), 0),
           'paiements_equipe', (select coalesce(jsonb_agg(jsonb_build_object('transaction_id', p.transaction_id, 'montant', p.montant,
                                       'saisi_par', (select coalesce(a.nom, a.email) from administrateurs a where a.id = p.saisi_par), 'saisi_le', p.saisi_le,
                                       'retire_le', p.retire_le, 'retire_note', p.retire_note, 'constatee_id', p.constatee_id) order by p.id), '[]'::jsonb)
                                  from sortie_paiements p where p.sortie_id = s.id),
           'cloture_erreur', s.cloture_erreur,
           'forcee_par', (select coalesce(a.nom, a.email) from administrateurs a where a.id = s.forcee_par), 'forcee_le', s.forcee_le, 'forcee_note', s.forcee_note,
           'forcage_possible', coalesce((parametre('sortie') ->> 'forcage')::boolean, false) and s.etat = 'en_preuve'
                               and s.payee_le <= now() - interval '30 minutes'
                               and _rapprochement(s) ->> 'etat' is distinct from 'concorde'
                               and s.montant_xaf = coalesce((select sum(p.montant) from sortie_paiements p where p.sortie_id = s.id and p.retire_le is null), 0),
           'candidats', case when s.mode = 'manuel' and s.etat in ('en_attente', 'en_cours', 'en_preuve') then _candidats_de_preuve(s) else '[]'::jsonb end,
           'rapprochement', _rapprochement(s),
           'transferts', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'terminal', k.terminal, 'etat', k.etat, 'montant_xafe', k.montant_xafe,
                                                     'montant_envoye', (k.parametres ->> 'montant')::numeric, 'reprises', k.reprises, 'resultat', k.resultat,
                                                     'reference_operateur', k.reference_operateur, 'reclamee_le', k.reclamee_le) order by k.id), '[]'::jsonb)
                            from commandes k where k.sortie_id = s.id)) order by s.cree_le desc), '[]'::jsonb)
    into r
    from (select * from sorties where (p_etat is null or etat = p_etat) order by cree_le desc limit p_n) s
    join comptes c on c.id = s.compte_id;
  return r;
end $$;

-- Un SMS sortant est « expliqué » s'il porte l'ID d'une sortie OU d'un de ses paiements actifs.
create or replace function _sms_sortant_explique(k sorties_constatees) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from sorties s where s.operateur = k.operateur and s.transaction_id = k.transaction_id)
      or exists (select 1 from sortie_paiements p where p.operateur = k.operateur and p.transaction_id = k.transaction_id and p.retire_le is null)
$$;

create or replace function admin_sorties_non_expliquees(p_n int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'terminal', k.terminal, 'operateur', k.operateur, 'float_numero', k.float_numero,
                                               'numero', k.numero_beneficiaire, 'montant', k.montant, 'transaction_id', k.transaction_id,
                                               'texte', k.texte, 'emis_le', k.emis_le) order by k.id desc), '[]'::jsonb)
    into r
    from (select * from sorties_constatees k where not _sms_sortant_explique(k) order by k.id desc limit p_n) k;
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
    'sorties_non_expliquees', (select count(*) from sorties_constatees k where not _sms_sortant_explique(k)),
    'parite', (select jsonb_build_object('statut', p.statut, 'ecart', p.ecart, 'couverture', p.couverture, 'fait_le', p.fait_le,
                                         'alertes', (select count(*) from parite_alertes where close_le is null and gravite <> 'attention'))
                 from parite_releves p order by p.fait_le desc limit 1));
end $$;

-- Une sortie en preuve tient encore l'argent du client : le compte ne se ferme pas.
create or replace function _exiger_fermeture_possible(p_compte uuid) returns void
language plpgsql set search_path = public as $$
declare v_reste text;
begin
  select string_agg(format('%s %s', to_char(disponible + bloque, 'FM999G999G999G990D00'), actif), ', ')
    into v_reste from soldes where compte_id = p_compte and disponible + bloque > 0;
  if v_reste is not null then
    raise exception 'il reste de l''argent sur le compte' using detail = format('sortez d''abord : %s', v_reste);
  end if;
  if exists (select 1 from ordres where compte_id = p_compte and etat in ('ouvert', 'partiel'))
     or exists (select 1 from depots where compte_id = p_compte and etat = 'en_attente')
     or exists (select 1 from depot_declarations where compte_id = p_compte and etat = 'attendu')
     or exists (select 1 from sorties where compte_id = p_compte and etat in ('en_attente', 'en_cours', 'en_preuve'))
     or exists (select 1 from retraits_crypto where compte_id = p_compte and etat in ('en_attente', 'en_cours')) then
    raise exception 'une opération est en cours' using detail = 'attendez qu''elle se termine, ou annulez-la';
  end if;
  if exists (select 1 from entrees_retenues r join depots d on d.id = r.depot_id
              where d.compte_id = p_compte and r.etat = 'retenue') then
    raise exception 'un remboursement vous est dû' using detail = 'l''équipe doit d''abord vous rembourser';
  end if;
end $$;

-- ──────────────────────── 6 · le SMS sortant de TOTEM ──────────────────────
-- Même signature : la porte et TOTEM ne changent pas. Le SMS prend le MÊME
-- verrou que l'ID tapé (ils ne se ratent pas : course 12.4) ; il clôt la sortie
-- qui l'attendait. Un lecteur corrigé qui relit l'historique peut COMPLÉTER un
-- numéro manquant, jamais en changer un. Jamais _journaliser ici : pas d'admin.
create or replace function totem_sms_sortant(p_terminal text, p_source_id bigint, p_operateur text, p_float_numero text,
                                             p_numero text, p_montant numeric, p_reference text, p_texte text,
                                             p_emis_le timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_k     sorties_constatees;
  v_float floats;
  v_s     sorties;
  v_id    text := nullif(normaliser_transaction_id(p_reference), '');
  v_emp   text := _empreinte_sms(p_texte, p_reference, p_montant);
  v_num   text := nullif(normaliser_numero(p_numero), '');
  v_deja  boolean := false;
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
    insert into sorties_constatees (terminal, source_id, empreinte, float_id, operateur, float_numero, numero_beneficiaire, montant,
                                    reference_operateur, transaction_id, texte, emis_le, sortie_id)
    values (p_terminal, p_source_id, v_emp, v_float.id, p_operateur, p_float_numero, v_num, p_montant,
            p_reference, v_id, p_texte, p_emis_le, null)
    on conflict (terminal, source_id, empreinte) do nothing
    returning * into v_k;
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
    'cloture', case when v_s.etat = 'envoyee' then true end));
end $$;

-- ─────────────────────────────── 7 · les droits ────────────────────────────
revoke all on function _seuil_atteint(sorties), _preuve_du_paiement(text, text, numeric, sorties), _rapprochement(sorties),
  _clore_sortie_manuelle(uuid), _tenter_cloture(uuid), _candidats_de_preuve(sorties), _sortie_json(sorties), _sms_sortant_explique(sorties_constatees),
  _exiger_fermeture_possible(uuid), _verifier_parametre(text, jsonb),
  admin_payer_sortie(text, text, text, numeric), admin_corriger_paiement(text, text, text, text, numeric), admin_verifier_sortie(text),
  admin_forcer_sortie(text, text), admin_confirmer_sortie(text), admin_refuser_sortie(text, text), admin_sorties(text, int),
  admin_a_traiter(), admin_sorties_non_expliquees(int),
  totem_sms_sortant(text, bigint, text, text, text, numeric, text, text, timestamptz) from public, anon, authenticated;
grant execute on function admin_payer_sortie(text, text, text, numeric), admin_corriger_paiement(text, text, text, text, numeric),
  admin_verifier_sortie(text), admin_forcer_sortie(text, text), admin_confirmer_sortie(text), admin_refuser_sortie(text, text),
  admin_sorties(text, int), admin_a_traiter(), admin_sorties_non_expliquees(int) to authenticated;   -- les gardes sont dedans (_exiger_droit)
grant execute on function totem_sms_sortant(text, bigint, text, text, text, numeric, text, text, timestamptz) to service_role;
