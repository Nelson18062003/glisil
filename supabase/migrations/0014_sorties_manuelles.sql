-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0014 · le remboursement en XAF, fait à la main               ║
-- ║                                                                        ║
-- ║  Pour commencer, une sortie de XAFe vers Mobile Money n'est pas        ║
-- ║  composée par TOTEM : l'équipe paie elle-même, puis le dit. La règle   ║
-- ║  « sortie.mode » choisit : « totem » (les commandes au boîtier, comme  ║
-- ║  avant) ou « manuel ». Absente, elle vaut « totem » : cette migration  ║
-- ║  ne change rien tant que l'équipe ne la pose pas.                      ║
-- ║                                                                        ║
-- ║  Le trajet d'un remboursement manuel :                                 ║
-- ║    demandée (les XAFe sont MIS DE CÔTÉ tout de suite)                  ║
-- ║      → prise en charge par un membre de l'équipe                       ║
-- ║      → payée : transaction ID + capture ; au-delà d'un seuil, une      ║
-- ║        SECONDE personne confirme                                       ║
-- ║      → envoyée : les XAFe mis de côté sont DÉTRUITS (emissions)        ║
-- ║    ou → refusée avec un motif : les XAFe reviennent, tant que rien     ║
-- ║        n'a été payé. Un remboursement payé ne revient jamais en        ║
-- ║        arrière.                                                        ║
-- ║                                                                        ║
-- ║  La preuve : le SMS que l'opérateur envoie à la puce qui a payé. TOTEM ║
-- ║  le relève (sens « sortie ») et la base le rapproche du transaction ID ║
-- ║  tapé par l'équipe : même ID, même montant, même numéro. Une capture   ║
-- ║  d'écran se fabrique ; un SMS d'opérateur reçu par la puce, beaucoup   ║
-- ║  moins.                                                                ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────── les colonnes ──────────────────────────────
alter table sorties add column if not exists mode            text not null default 'totem';
alter table sorties add column if not exists nom_beneficiaire text;     -- le nom du compte MoMo, tel que le client l'écrit
alter table sorties add column if not exists pris_par        uuid;
alter table sorties add column if not exists pris_le         timestamptz;
alter table sorties add column if not exists transaction_id  text;      -- l'ID du paiement fait par l'équipe, normalisé
alter table sorties add column if not exists preuve          text;      -- le chemin de la capture, dans le stockage « preuves-sorties »
alter table sorties add column if not exists payee_par       uuid;
alter table sorties add column if not exists payee_le        timestamptz;
alter table sorties add column if not exists confirmee_par   uuid;
alter table sorties add column if not exists confirmee_le    timestamptz;
alter table sorties add column if not exists motif           text;      -- le refus, dit au client
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sorties_mode_check') then
    alter table sorties add constraint sorties_mode_check check (mode in ('totem', 'manuel'));
  end if;
end $$;
-- Un paiement de l'équipe ne prouve qu'UN remboursement : le même ID tapé
-- deux fois fermerait deux sorties avec un seul envoi.
create unique index if not exists sorties_un_paiement on sorties (operateur, transaction_id) where transaction_id is not null;
create index if not exists sorties_manuelles_a_traiter on sorties (cree_le) where mode = 'manuel' and etat in ('en_attente', 'en_cours');

-- ─────────────────────── ce que TOTEM voit sortir du float ─────────────────
-- Chaque SMS « vous avez envoyé … » relevé sur une puce de float. Rapproché
-- d'un remboursement par son transaction ID ; resté seul, c'est de l'argent
-- sorti du float que rien n'explique, et l'équipe le voit.
create table if not exists sorties_constatees (
  id                  bigint generated always as identity primary key,
  terminal            text not null references terminaux(id),
  source_id           bigint not null,
  empreinte           text not null,
  float_id            int references floats(id),
  operateur           text not null,
  float_numero        text,
  numero_beneficiaire text,
  montant             numeric(20,2),
  reference_operateur text,
  transaction_id      text,
  texte               text,
  emis_le             timestamptz,
  sortie_id           uuid references sorties(id),
  recu_le             timestamptz not null default now(),
  unique (terminal, source_id, empreinte)
);
create index if not exists sorties_constatees_tx on sorties_constatees (operateur, transaction_id);
alter table sorties_constatees enable row level security;

-- ─────────────────────────────── la règle ──────────────────────────────────
create or replace function _sortie_manuelle() returns boolean
language sql stable set search_path = public as $$
  select coalesce(parametre('sortie') ->> 'mode', 'totem') = 'manuel'
$$;

-- Le rapprochement d'une sortie payée avec le SMS que la puce a reçu.
--   « concorde » : même ID, même montant, même numéro ;
--   « ecart »    : même ID, mais le montant ou le numéro diffère ;
--   « absent »   : aucun SMS de ce paiement relevé (pas encore, ou payé d'ailleurs).
create or replace function _rapprochement(s sorties) returns jsonb
language sql stable set search_path = public as $$
  select case
    when s.transaction_id is null then null
    when c.id is null then jsonb_build_object('etat', 'absent')
    else jsonb_build_object(
      'etat', case when c.montant = s.montant_xaf and c.numero_beneficiaire = s.numero then 'concorde' else 'ecart' end,
      'montant', c.montant, 'numero', c.numero_beneficiaire, 'terminal', c.terminal, 'emis_le', c.emis_le, 'texte', c.texte)
  end
  from (select 1) un
  left join lateral (select * from sorties_constatees k
                      where k.operateur = s.operateur and k.transaction_id = s.transaction_id
                      order by k.id limit 1) c on true
$$;

-- Ce que voit le client : le mode, le nom, l'ID du paiement et sa date ; le
-- motif d'un refus. Pas qui l'a traité, ni la capture.
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
    'payee_le', coalesce(s.confirmee_le, s.payee_le), 'motif', s.motif)
$$;

-- ─────────────────────────── la demande du client ──────────────────────────
-- Les mêmes gardes que la sortie par TOTEM (compte actif, numéro vérifié À
-- SON NOM et actif, plafond du palier, compte verrouillé avant de compter),
-- sans boîtier ni découpage : l'équipe paiera en une ou plusieurs fois, c'est
-- le montant en XAF qui compte.
create or replace function _demander_sortie_manuelle(p_montant numeric, p_numero_id uuid, p_cle text, p_nom text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_compte uuid := auth.uid();
  v_s      sorties;
  v_n      numeros;
  v_taux   numeric := coalesce((parametre('frais') ->> 'sortie')::numeric, 0);
  v_palier jsonb;
  v_frais  numeric;
  v_nom    text := nullif(regexp_replace(trim(coalesce(p_nom, '')), '\s+', ' ', 'g'), '');
  v_ref    text;
begin
  perform _exiger_compte_actif(v_compte);
  if p_cle is not null then
    select * into v_s from sorties where compte_id = v_compte and cle = p_cle;
    if found then return _sortie_json(v_s) || '{"deja": true}'; end if;
  end if;
  if p_montant is null or p_montant <= 0 or p_montant <> trunc(p_montant) then raise exception 'montant invalide'; end if;
  if v_nom is null or length(v_nom) < 2 or length(v_nom) > 80 then
    raise exception 'nom du bénéficiaire invalide' using detail = 'le nom exact du compte Mobile Money qui reçoit';
  end if;

  select * into v_n from numeros where id = p_numero_id and compte_id = v_compte and retire_le is null;
  if not found then raise exception 'numéro inconnu sur ce compte'; end if;
  if v_n.verifie_le is null then raise exception 'numéro pas encore vérifié'; end if;
  if v_n.actif_des > now() then
    raise exception 'numéro pas encore actif' using detail = format('actif à partir du %s', v_n.actif_des);
  end if;

  perform 1 from comptes where id = v_compte for no key update;
  v_palier := parametre('paliers') -> (select palier::text from comptes where id = v_compte);
  if v_palier is not null and v_palier <> 'null'::jsonb then
    if _sorties_du_jour(v_compte) + p_montant > (v_palier ->> 'sortie_jour')::numeric then
      raise exception 'plafond du palier atteint' using detail = format('%s XAF par jour', v_palier ->> 'sortie_jour');
    end if;
  end if;

  v_frais := ceil(p_montant * v_taux);
  if p_montant - v_frais <= 0 then raise exception 'montant trop petit' using detail = 'après les frais, rien ne partirait'; end if;

  v_ref := 'XAFe-WD-' || lpad(nextval('sorties_numero')::text, 6, '0');
  -- mis de côté AVANT que l'équipe ne voie la demande : dépensé ailleurs pendant qu'on paie, il serait payé deux fois
  perform _mouvement(v_compte, 'XAFe', -p_montant, p_montant, 'sortie_bloquee', 'sorties', v_ref);
  insert into sorties (reference, compte_id, numero_id, operateur, numero, montant, frais, montant_xaf, cle, mode, nom_beneficiaire)
  values (v_ref, v_compte, v_n.id, v_n.operateur, v_n.numero, p_montant, v_frais, p_montant - v_frais, p_cle, 'manuel', v_nom)
  returning * into v_s;
  return _sortie_json(v_s);
end $$;

-- La version avec le code secret, la seule ouverte au client. Elle prend
-- désormais le nom du bénéficiaire (exigé en mode manuel) ; l'ancienne, à
-- quatre arguments, s'efface : une application d'avant qui appelle par nom
-- tombe sur celle-ci, p_nom vaut null.
drop function if exists demander_sortie(numeric, uuid, text, text);
create or replace function demander_sortie(p_montant numeric, p_numero_id uuid, p_cle text, p_code text, p_nom text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true) then
    raise exception 'sorties pas encore ouvertes' using detail = 'vos XAFe restent sur votre compte';
  end if;
  v := _controler_code(auth.uid(), p_code);
  if not (v ->> 'ok')::boolean then return v; end if;
  if _sortie_manuelle() then return _demander_sortie_manuelle(p_montant, p_numero_id, p_cle, p_nom); end if;
  return demander_sortie(p_montant, p_numero_id, p_cle);
end $$;

-- ─────────────────────────── le traitement par l'équipe ────────────────────
create or replace function _sortie_a_traiter(p_reference text) returns sorties
language plpgsql set search_path = public as $$
declare v_s sorties;
begin
  select * into v_s from sorties where reference = p_reference for update;
  if not found then raise exception 'sortie inconnue'; end if;
  if v_s.mode <> 'manuel' then raise exception 'cette sortie est composée par TOTEM' using detail = 'elle se suit dans ses transferts'; end if;
  return v_s;
end $$;

-- « Je m'en occupe » : les autres membres de l'équipe le voient, et ne paient
-- pas une seconde fois.
create or replace function admin_prendre_sortie(p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties;
begin
  perform _exiger_droit('sorties');
  v_s := _sortie_a_traiter(p_reference);
  if v_s.etat <> 'en_attente' then raise exception 'cette sortie n''attend plus' using detail = v_s.etat; end if;
  update sorties set etat = 'en_cours', pris_par = auth.uid(), pris_le = now() where id = v_s.id returning * into v_s;
  perform _journaliser('prendre_sortie', p_reference);
  return _sortie_json(v_s);
end $$;

-- La sortie est payée : ses XAFe mis de côté sont détruits, les frais vont à
-- la maison, le client est prévenu avec l'ID du paiement.
create or replace function _clore_sortie_manuelle(p_id uuid) returns sorties
language plpgsql set search_path = public as $$
declare v_s sorties;
begin
  select * into v_s from sorties where id = p_id for update;
  perform _mouvement(v_s.compte_id, 'XAFe', 0, -v_s.montant, 'sortie_envoyee', 'sorties', v_s.reference);
  if v_s.frais > 0 then
    perform _mouvement(compte_maison(), 'XAFe', v_s.frais, 0, 'frais_sortie', 'sorties', v_s.reference);
  end if;
  insert into emissions (sens, montant, source_table, source_id) values ('destruction', v_s.montant_xaf, 'sorties', v_s.reference);
  update sorties set etat = 'envoyee', montant_envoye = montant_xaf, terminee_le = now() where id = p_id returning * into v_s;
  perform _notifier(v_s.compte_id, 'Sortie envoyée',
    format('%s XAF envoyés au %s. Transaction ID : %s.', to_char(v_s.montant_xaf, 'FM999G999G999G999'), v_s.numero, v_s.transaction_id),
    '/historique/' || v_s.reference);
  return v_s;
end $$;

-- L'équipe a payé : le transaction ID (exigé) et la capture (facultative).
-- Au-delà de « sortie.seuil_deux_personnes », la sortie attend qu'une AUTRE
-- personne confirme : l'argent est parti, mais les XAFe ne sont détruits et
-- le client prévenu qu'une fois la preuve vue par deux yeux.
create or replace function admin_payer_sortie(p_reference text, p_transaction_id text, p_preuve text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_s     sorties;
  v_id    text := normaliser_transaction_id(p_transaction_id);
  v_seuil numeric := nullif(parametre('sortie') ->> 'seuil_deux_personnes', '')::numeric;
begin
  perform _exiger_droit('sorties');
  v_s := _sortie_a_traiter(p_reference);
  if v_s.etat not in ('en_attente', 'en_cours') then raise exception 'cette sortie est déjà close' using detail = v_s.etat; end if;
  if v_s.payee_le is not null then raise exception 'paiement déjà enregistré' using detail = v_s.transaction_id; end if;
  if length(v_id) < 6 then raise exception 'transaction ID invalide' using detail = 'recopiez-le du SMS de l''opérateur'; end if;
  if p_preuve is not null and p_preuve !~ ('^' || v_s.reference || '/[A-Za-z0-9._-]{1,80}$') then
    raise exception 'capture invalide' using detail = 'elle se dépose dans le dossier de la sortie';
  end if;
  if exists (select 1 from sorties where operateur = v_s.operateur and transaction_id = v_id and id <> v_s.id) then
    raise exception 'ce transaction ID prouve déjà une autre sortie';
  end if;
  update sorties set transaction_id = v_id, preuve = p_preuve, payee_par = auth.uid(), payee_le = now(),
                     etat = 'en_cours', pris_par = coalesce(pris_par, auth.uid()), pris_le = coalesce(pris_le, now())
   where id = v_s.id returning * into v_s;
  -- le SMS de la puce arrive souvent AVANT que l'ID soit tapé : on le rattache maintenant
  update sorties_constatees set sortie_id = v_s.id where operateur = v_s.operateur and transaction_id = v_id and sortie_id is null;
  perform _journaliser('payer_sortie', p_reference, jsonb_build_object('transaction_id', v_id, 'preuve', p_preuve is not null));
  if v_seuil is not null and v_s.montant_xaf >= v_seuil then
    return _sortie_json(v_s) || jsonb_build_object('a_confirmer', true, 'rapprochement', _rapprochement(v_s));
  end if;
  v_s := _clore_sortie_manuelle(v_s.id);
  return _sortie_json(v_s) || jsonb_build_object('rapprochement', _rapprochement(v_s));
end $$;

create or replace function admin_confirmer_sortie(p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties;
begin
  perform _exiger_droit('sorties');
  v_s := _sortie_a_traiter(p_reference);
  if v_s.etat <> 'en_cours' or v_s.payee_le is null then raise exception 'aucun paiement à confirmer' using detail = v_s.etat; end if;
  if v_s.payee_par = auth.uid() then
    raise exception 'une autre personne confirme' using detail = 'celle qui a payé ne confirme pas son propre paiement';
  end if;
  update sorties set confirmee_par = auth.uid(), confirmee_le = now() where id = v_s.id;
  v_s := _clore_sortie_manuelle(v_s.id);
  perform _journaliser('confirmer_sortie', p_reference);
  return _sortie_json(v_s) || jsonb_build_object('rapprochement', _rapprochement(v_s));
end $$;

-- Refuser : les XAFe mis de côté reviennent au client, avec le motif. Jamais
-- après un paiement enregistré : l'argent est parti, le client garderait les
-- deux.
create or replace function admin_refuser_sortie(p_reference text, p_motif text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties; v_motif text := nullif(trim(coalesce(p_motif, '')), '');
begin
  perform _exiger_droit('sorties');
  if v_motif is null or length(v_motif) < 3 then raise exception 'un motif est exigé' using detail = 'il est montré au client'; end if;
  v_s := _sortie_a_traiter(p_reference);
  if v_s.etat not in ('en_attente', 'en_cours') then raise exception 'cette sortie est déjà close' using detail = v_s.etat; end if;
  if v_s.payee_le is not null then
    raise exception 'un paiement est enregistré' using detail = 'l''argent est parti : la sortie ne se refuse plus';
  end if;
  perform _mouvement(v_s.compte_id, 'XAFe', v_s.montant, -v_s.montant, 'sortie_annulee', 'sorties', v_s.reference);
  update sorties set etat = 'annulee', montant_rendu = montant, motif = v_motif, terminee_le = now()
   where id = v_s.id returning * into v_s;
  perform _notifier(v_s.compte_id, 'Sortie refusée',
    format('%s XAFe sont revenus sur votre compte. %s', to_char(v_s.montant, 'FM999G999G999G999'), v_motif), '/historique/' || v_s.reference);
  perform _journaliser('refuser_sortie', p_reference, jsonb_build_object('motif', v_motif));
  return _sortie_json(v_s);
end $$;

-- L'annulation d'avant (par transferts TOTEM) ne touche pas une sortie
-- manuelle : sans transfert en attente, elle répondait « rien à annuler ».
-- Elle le dit maintenant, et renvoie au refus.
create or replace function admin_annuler_sortie(p_reference text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties; v commandes; v_rendu numeric := 0; v_faites int; v_echouees int;
begin
  perform _exiger_droit('sorties');
  if length(trim(coalesce(p_note, ''))) < 3 then raise exception 'une note est exigée' using detail = 'pourquoi la sortie est annulée'; end if;
  select * into v_s from sorties where reference = p_reference for update;
  if not found then raise exception 'sortie inconnue'; end if;
  if v_s.mode = 'manuel' then raise exception 'une sortie manuelle se refuse' using detail = 'admin_refuser_sortie, avec un motif'; end if;
  if exists (select 1 from commandes where sortie_id = v_s.id and etat = 'en_cours') then
    raise exception 'un transfert est en cours de composition' using detail = 'libérez-le d''abord s''il est bloqué';
  end if;
  for v in select * from commandes where sortie_id = v_s.id and etat = 'en_attente' order by id for update loop
    update commandes set etat = 'echouee', resultat = 'annulée par l''équipe : ' || p_note, traitee_le = now() where id = v.id;
    perform _mouvement(v_s.compte_id, 'XAFe', v.montant_xafe, -v.montant_xafe, 'sortie_annulee', 'commandes', v.id::text);
    v_rendu := v_rendu + v.montant_xafe;
  end loop;
  if v_rendu = 0 then raise exception 'rien à annuler' using detail = 'aucun transfert en attente'; end if;
  select count(*) filter (where etat = 'faite'), count(*) filter (where etat = 'echouee') into v_faites, v_echouees from commandes where sortie_id = v_s.id;
  update sorties set montant_rendu = montant_rendu + v_rendu,
         etat = case when v_faites = 0 then 'annulee' else 'partielle' end, terminee_le = now()
   where id = v_s.id returning * into v_s;
  perform _notifier(v_s.compte_id, 'Sortie annulée', format('%s XAFe sont revenus sur votre compte.', to_char(v_rendu, 'FM999G999G999G999')), '/historique/' || v_s.reference);
  perform _journaliser('annuler_sortie', p_reference, jsonb_build_object('rendu', v_rendu, 'note', p_note));
  return jsonb_build_object('ok', true, 'rendu', v_rendu, 'etat', v_s.etat);
end $$;

-- La liste de l'équipe : tout ce que le client a donné, le nom du compte
-- Glisil (à comparer avec le nom que l'opérateur affiche en payant), qui a
-- pris, qui a payé, et le rapprochement avec le SMS de la puce.
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
           'payee_par_moi', s.payee_par = auth.uid(),
           'confirmee_par', (select coalesce(a.nom, a.email) from administrateurs a where a.id = s.confirmee_par),
           'a_confirmer', s.mode = 'manuel' and s.etat = 'en_cours' and s.payee_le is not null,
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

-- Ce que les puces ont vu partir et que rien n'explique (aucune sortie ne
-- porte cet ID) : un paiement oublié dans Glisil, ou de l'argent sorti du
-- float pour autre chose. L'équipe le voit, il ne se corrige pas en silence.
create or replace function admin_sorties_non_expliquees(p_n int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'terminal', k.terminal, 'operateur', k.operateur, 'float_numero', k.float_numero,
                                               'numero', k.numero_beneficiaire, 'montant', k.montant, 'transaction_id', k.transaction_id,
                                               'texte', k.texte, 'emis_le', k.emis_le) order by k.id desc), '[]'::jsonb)
    into r
    from (select * from sorties_constatees k
           where not exists (select 1 from sorties s where s.operateur = k.operateur and s.transaction_id = k.transaction_id)
           order by k.id desc limit p_n) k;
  return r;
end $$;

-- ─────────────────────────── le SMS sortant, par TOTEM ─────────────────────
-- La porte « totem-sms » y envoie les lignes de sens « sortie ». Un SMS relu
-- après une coupure a la même empreinte : il n'est compté qu'une fois.
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
begin
  select * into v_k from sorties_constatees where terminal = p_terminal and source_id = p_source_id and empreinte = v_emp;
  if found then return jsonb_build_object('resultat', 'constatee', 'id', v_k.id, 'deja', true); end if;
  update terminaux set vu_le = now() where id = p_terminal;
  select * into v_float from floats where operateur = p_operateur and numero = normaliser_numero(p_float_numero) and terminal = p_terminal;
  select * into v_s from sorties where operateur = p_operateur and transaction_id = v_id and v_id is not null;
  insert into sorties_constatees (terminal, source_id, empreinte, float_id, operateur, float_numero, numero_beneficiaire, montant,
                                  reference_operateur, transaction_id, texte, emis_le, sortie_id)
  values (p_terminal, p_source_id, v_emp, v_float.id, p_operateur, p_float_numero, nullif(normaliser_numero(p_numero), ''), p_montant,
          p_reference, v_id, p_texte, p_emis_le, v_s.id)
  on conflict (terminal, source_id, empreinte) do nothing
  returning * into v_k;
  return jsonb_strip_nulls(jsonb_build_object('resultat', 'constatee', 'id', v_k.id,
    'sortie', v_s.reference, 'rapprochement', case when v_s.id is not null then _rapprochement(v_s) ->> 'etat' end));
end $$;

-- ─────────────────────────── le tableau de bord ────────────────────────────
-- « À traiter » : ce qui attend l'équipe, en premier.
create or replace function admin_a_traiter() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('voir');
  return jsonb_build_object(
    'sorties_manuelles', (select count(*) from sorties where mode = 'manuel' and etat in ('en_attente', 'en_cours') and payee_le is null),
    'sorties_a_confirmer', (select count(*) from sorties where mode = 'manuel' and etat = 'en_cours' and payee_le is not null),
    'montant_a_payer', (select coalesce(sum(montant_xaf), 0) from sorties where mode = 'manuel' and etat in ('en_attente', 'en_cours') and payee_le is null),
    'sorties_non_expliquees', (select count(*) from sorties_constatees k
                                where not exists (select 1 from sorties s where s.operateur = k.operateur and s.transaction_id = k.transaction_id)));
end $$;

-- ─────────────────── les paramètres : le mode et le seuil ──────────────────
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

-- L'écran du client lit le mode : en manuel, il demande le nom et dit
-- « l'équipe paie, en général sous … ».
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
    'sortie', jsonb_build_object('ouvertes', coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true),
                                 'mode', coalesce(parametre('sortie') ->> 'mode', 'totem')),
    'operateurs', (select jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'plafond_par_transfert', plafond_par_transfert,
                                                       'plafond_jour', plafond_jour) order by id) from operateurs),
    'conditions', parametre('conditions'),
    'support', parametre('support'))
   where auth.uid() is not null
$$;

-- ─────────────────────────── les captures ──────────────────────────────────
-- Le stockage « preuves-sorties » : privé, images et PDF de 10 Mo au plus,
-- rangés par référence de sortie. Seule l'équipe des sorties dépose et relit.
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name) values ('preuves-sorties', 'preuves-sorties') on conflict (id) do nothing;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public') then
    execute $p$update storage.buckets set public = false where id = 'preuves-sorties'$p$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $p$update storage.buckets set file_size_limit = 10485760,
                 allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] where id = 'preuves-sorties'$p$;
  end if;
  execute $p$drop policy if exists preuves_sorties_deposer on storage.objects$p$;
  execute $p$drop policy if exists preuves_sorties_relire on storage.objects$p$;
  execute $p$create policy preuves_sorties_deposer on storage.objects for insert to authenticated
            with check (bucket_id = 'preuves-sorties' and public.admin_a_droit('sorties'))$p$;
  execute $p$create policy preuves_sorties_relire on storage.objects for select to authenticated
            using (bucket_id = 'preuves-sorties' and public.admin_a_droit('voir'))$p$;
end $$;

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on function _sortie_manuelle(), _rapprochement(sorties), _demander_sortie_manuelle(numeric, uuid, text, text),
                       _sortie_a_traiter(text), _clore_sortie_manuelle(uuid), totem_sms_sortant(text, bigint, text, text, text, numeric, text, text, timestamptz),
                       demander_sortie(numeric, uuid, text, text, text),
                       admin_prendre_sortie(text), admin_payer_sortie(text, text, text), admin_confirmer_sortie(text),
                       admin_refuser_sortie(text, text), admin_sorties_non_expliquees(int), admin_a_traiter()
  from public, anon, authenticated;
revoke all on table sorties_constatees from public, anon, authenticated;
grant execute on function demander_sortie(numeric, uuid, text, text, text),
                          admin_prendre_sortie(text), admin_payer_sortie(text, text, text), admin_confirmer_sortie(text),
                          admin_refuser_sortie(text, text), admin_sorties_non_expliquees(int), admin_a_traiter()
  to authenticated;
grant all on table sorties_constatees to service_role;
grant execute on function totem_sms_sortant(text, bigint, text, text, text, numeric, text, text, timestamptz),
                          demander_sortie(numeric, uuid, text, text, text) to service_role;
