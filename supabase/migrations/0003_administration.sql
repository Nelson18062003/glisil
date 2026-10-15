-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  XAFe Exchange · 0003 · l'administration                               ║
-- ║  Qui administre, avec quels droits ; les réserves ; les entrées       ║
-- ║  retenues à rapprocher ou rembourser ; les sorties ; les terminaux et ║
-- ║  les floats ; les clients et leurs paliers ; les paramètres.          ║
-- ║  Règle absolue : une RPC d'administration est gardée par              ║
-- ║  admin_a_droit('<droit>'), jamais par « est administrateur » seul.   ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ──────────────────────────── qui administre ───────────────────────────────
create table administrateurs (
  id          uuid primary key,                      -- = auth.users.id (connexion par e-mail)
  email       text not null unique,
  nom         text not null,
  role        text not null check (role in ('super_admin', 'operateur', 'tresorier', 'support')),
  actif       boolean not null default true,
  cree_le     timestamptz not null default now()
);
alter table administrateurs enable row level security;
create policy lire_sa_fiche on administrateurs for select to authenticated using (id = auth.uid());
grant select on administrateurs to authenticated;

-- La matrice des droits, en un seul endroit. L'application en a une copie
-- (admin/src/noyau/droits.ts) ; le test de parité les compare.
create function droits_du_role(p_role text) returns text[] language sql immutable as $$
  select case p_role
    when 'super_admin' then array['voir', 'rapprocher', 'rembourser', 'sorties', 'terminaux', 'clients', 'paliers', 'parametres', 'marche', 'administrateurs']
    when 'operateur'   then array['voir', 'rapprocher', 'sorties', 'terminaux', 'clients']
    when 'tresorier'   then array['voir', 'rembourser', 'parametres', 'marche', 'clients']
    when 'support'     then array['voir', 'clients']
    else array[]::text[]
  end
$$;

-- Le garde-fou : actif ET le droit demandé. Un administrateur désactivé est
-- refusé tout de suite, quel que soit son jeton.
create function admin_a_droit(p_droit text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from administrateurs a where a.id = auth.uid() and a.actif and p_droit = any (droits_du_role(a.role)))
$$;

create function _exiger_droit(p_droit text) returns void language plpgsql as $$
begin
  if not admin_a_droit(p_droit) then raise exception 'accès non autorisé' using detail = p_droit; end if;
end $$;

-- Le journal de ce que l'administration FAIT : qui, quoi, sur quoi, quand.
create table journal_admin (
  id        bigint generated always as identity primary key,
  admin_id  uuid not null,
  action    text not null,
  cible     text,
  detail    jsonb,
  cree_le   timestamptz not null default now()
);
alter table journal_admin enable row level security;

create function _journaliser(p_action text, p_cible text, p_detail jsonb default null) returns void language sql as $$
  insert into journal_admin (admin_id, action, cible, detail) values (auth.uid(), p_action, p_cible, p_detail)
$$;

create function mon_profil_admin() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', a.id, 'email', a.email, 'nom', a.nom, 'role', a.role, 'actif', a.actif, 'droits', to_jsonb(droits_du_role(a.role)))
    from administrateurs a where a.id = auth.uid() and a.actif
$$;

create function admin_creer_administrateur(p_id uuid, p_email text, p_nom text, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('administrateurs');
  insert into administrateurs (id, email, nom, role) values (p_id, lower(p_email), p_nom, p_role);
  perform _journaliser('creer_administrateur', p_id::text, jsonb_build_object('role', p_role));
  return jsonb_build_object('ok', true);
end $$;

create function admin_desactiver_administrateur(p_id uuid, p_actif boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('administrateurs');
  if p_id = auth.uid() then raise exception 'on ne se désactive pas soi-même'; end if;
  update administrateurs set actif = p_actif where id = p_id;
  if not found then raise exception 'administrateur inconnu'; end if;
  perform _journaliser(case when p_actif then 'activer_administrateur' else 'desactiver_administrateur' end, p_id::text);
  return jsonb_build_object('ok', true);
end $$;

-- ──────────────────────────── le tableau ───────────────────────────────────
-- Les réserves : ce que la plateforme doit (les XAFe des clients) et ce
-- qu'elle a (la circulation, les floats). La première question du matin.
create function admin_tableau() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select jsonb_build_object(
    'circulation', circulation(),
    'circulation_chaine', circulation_chaine(),
    'soldes', (select coalesce(jsonb_object_agg(actif, jsonb_build_object('disponible', d, 'bloque', b)), '{}'::jsonb)
                 from (select actif, sum(disponible) d, sum(bloque) b from soldes where compte_id <> compte_maison() group by actif) s),
    'maison', (select coalesce(jsonb_object_agg(actif, disponible), '{}'::jsonb) from soldes where compte_id = compte_maison()),
    'comptes', (select count(*) from comptes where not maison),
    'jour', jsonb_build_object(
      'entrees', (select coalesce(sum(montant), 0) from depot_declarations where etat = 'credite' and credite_le >= debut_du_jour()),
      'sorties', (select coalesce(sum(montant_envoye), 0) from sorties where cree_le >= debut_du_jour()),
      'volume_usdt', (select coalesce(sum(quantite), 0) from executions where cree_le >= debut_du_jour()),
      'frais_xafe', (select coalesce(sum(disponible_delta), 0) from ecritures where compte_id = compte_maison() and actif = 'XAFe' and cree_le >= debut_du_jour())),
    'retenues', (select jsonb_build_object('nombre', count(*), 'montant', coalesce(sum(montant), 0)) from entrees_retenues where etat = 'retenue'),
    'sorties_en_cours', (select count(*) from sorties where etat in ('en_attente', 'en_cours')),
    'declarations_attendues', (select count(*) from depot_declarations where etat = 'attendu'),
    'verifications', (select count(*) from comptes where verification_en_cours is not null),
    'terminaux', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'lieu', lieu, 'vu_le', vu_le,
                                   'muet', vu_le is null or vu_le < now() - interval '10 minutes') order by id), '[]'::jsonb) from terminaux),
    'floats', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'operateur', f.operateur, 'numero', f.numero, 'terminal', f.terminal,
                                   'code_agent', f.code_agent, 'actif', f.actif,
                                   'dossiers_ouverts', (select count(*) from depots d where d.float_id = f.id and d.etat = 'en_attente')) order by f.id), '[]'::jsonb) from floats f),
    'cotation', cotation())
  into r;
  return r;
end $$;

-- ──────────────────────────── les entrées ──────────────────────────────────
create function admin_entrees(p_etat text default null, p_n int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(_depot_json(d) || jsonb_build_object('compte', jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'palier', c.palier)) order by d.cree_le desc), '[]'::jsonb)
    into r
    from (select * from depots where (p_etat is null or etat = p_etat) order by cree_le desc limit p_n) d
    join comptes c on c.id = d.compte_id;
  return r;
end $$;

create function admin_retenues(p_etat text default 'retenue', p_n int default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'terminal', e.terminal, 'operateur', e.operateur, 'float_numero', e.float_numero,
                            'numero_payeur', e.numero_payeur, 'montant', e.montant, 'reference_operateur', e.reference_operateur,
                            'transaction_id', e.transaction_id, 'texte', e.texte, 'emis_le', e.emis_le, 'etat', e.etat,
                            'motif', e.motif, 'bloquee', e.bloquee,
                            'depot_reference', (select reference from depots where id = e.depot_id), 'cree_le', e.cree_le,
                            'compte_suggere', (select jsonb_build_object('id', c.id, 'nom', c.nom, 'telephone', c.telephone)
                                                 from comptes c where c.id = _proprietaire_du_numero(e.numero_payeur))) order by e.cree_le desc), '[]'::jsonb)
    into r
    from (select * from entrees_retenues where etat = p_etat order by cree_le desc limit p_n) e;
  return r;
end $$;

-- Rapprocher à la main : le client a mal recopié son ID, ou n'a rien
-- déclaré, ou l'appariement a refusé (payeur d'un autre compte, ID tapé par
-- plusieurs) ; l'opérateur rattache le SMS retenu au dossier qu'il a vérifié.
-- C'est la seule voie qui passe outre la règle du numéro payeur : un humain a
-- regardé. Le crédit suit la voie automatique (_crediter_declaration), palier
-- compris. Le verrou du transaction ID est pris AVANT celui de la ligne,
-- dans le même ordre que declarer_transaction : jamais d'étreinte mortelle.
create function admin_rapprocher_retenue(p_id bigint, p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_r entrees_retenues; v_d depots; v_x depot_declarations; v_tx text;
begin
  perform _exiger_droit('rapprocher');
  select * into v_r from entrees_retenues where id = p_id;
  if not found then raise exception 'entrée inconnue'; end if;
  if v_r.operateur is null or coalesce(v_r.montant, 0) <= 0 then
    raise exception 'opérateur ou montant inconnu' using detail = 'ce SMS ne se crédite pas : remboursement manuel';
  end if;
  -- un SMS dont la référence n'a pas été lue reçoit un identifiant à lui, pour qu'un second ne lui soit pas confondu
  v_tx := case when length(coalesce(v_r.transaction_id, '')) >= 6 then v_r.transaction_id
               else 'SMSRETENU' || v_r.id::text end;
  perform pg_advisory_xact_lock(hashtext('tx:' || v_r.operateur || ':' || v_tx));
  select * into v_r from entrees_retenues where id = p_id for update;
  if v_r.etat <> 'retenue' then raise exception 'cette entrée n''est plus retenue' using detail = v_r.etat; end if;
  if exists (select 1 from depot_paiements where terminal = v_r.terminal and source_id = v_r.source_id and empreinte = v_r.empreinte) then
    raise exception 'ce SMS a déjà crédité un dépôt';
  end if;
  select * into v_d from depots where reference = p_reference for update;
  if not found then raise exception 'dépôt inconnu'; end if;
  if v_d.etat = 'annule' then raise exception 'ce dépôt est annulé'; end if;
  if v_d.operateur <> v_r.operateur then raise exception 'l''opérateur du SMS n''est pas celui du dossier'; end if;
  if exists (select 1 from depot_declarations where operateur = v_r.operateur and transaction_id = v_tx and etat = 'credite') then
    raise exception 'transaction ID déjà utilisé';
  end if;
  -- la déclaration de CE compte pour cet ID est reprise sur ce dossier ; sinon on l'écrit
  select * into v_x from depot_declarations where compte_id = v_d.compte_id and operateur = v_r.operateur and transaction_id = v_tx for update;
  if found then
    update depot_declarations set depot_id = v_d.id, etat = 'attendu', motif = 'rapproché par l''administration'
     where id = v_x.id returning * into v_x;
  else
    insert into depot_declarations (depot_id, compte_id, operateur, transaction_id, motif)
    values (v_d.id, v_d.compte_id, v_r.operateur, v_tx, 'rapproché par l''administration')
    returning * into v_x;
  end if;
  v_x := _crediter_declaration(v_x.id, v_r.terminal, v_r.source_id, v_r.montant, v_r.numero_payeur, v_r.reference_operateur, v_r.texte, v_r.emis_le, v_r.id);
  if v_x.etat = 'credite' then
    -- les autres comptes qui attendaient ce même ID savent qu'il est pris
    update depot_declarations set etat = 'refuse', motif = 'rattaché à un autre dossier par l''équipe'
     where operateur = v_r.operateur and transaction_id = v_tx and etat = 'attendu';
  end if;
  perform _journaliser('rapprocher_retenue', p_id::text, jsonb_build_object('reference', p_reference, 'resultat', v_x.etat));
  return _declaration_json(v_x);
end $$;

-- Rembourser : l'argent repart au payeur par TOTEM, depuis le float qui l'a
-- reçu, et l'entrée est close (elle revient « retenue » si le transfert
-- échoue). Jamais un SMS qui a déjà crédité quelqu'un : ce serait payer deux
-- fois. Un remboursement échoué se relance : chaque essai a sa clé.
create function admin_rembourser_retenue(p_id bigint, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_r entrees_retenues; v_float floats; v_n int;
begin
  perform _exiger_droit('rembourser');
  select * into v_r from entrees_retenues where id = p_id for update;
  if not found then raise exception 'entrée inconnue'; end if;
  if v_r.etat <> 'retenue' then raise exception 'cette entrée n''est plus retenue' using detail = v_r.etat; end if;
  if v_r.numero_payeur is null or coalesce(v_r.montant, 0) <= 0 then raise exception 'payeur ou montant inconnu : remboursement manuel'; end if;
  if exists (select 1 from depot_paiements where terminal = v_r.terminal and source_id = v_r.source_id and empreinte = v_r.empreinte)
     or (length(coalesce(v_r.transaction_id, '')) >= 6
         and exists (select 1 from depot_declarations where operateur = v_r.operateur and transaction_id = v_r.transaction_id and etat = 'credite')) then
    raise exception 'ce paiement a déjà été crédité' using detail = 'le rembourser le paierait deux fois';
  end if;
  select * into v_float from floats where id = v_r.float_id;
  if not found or v_float.terminal is null then
    raise exception 'float inconnu : remboursement manuel' using detail = 'aucun boîtier ne porte la carte qui a reçu cet argent';
  end if;
  if exists (select 1 from remboursements where retenue_id = p_id and etat in ('en_attente', 'en_cours')) then
    raise exception 'un remboursement est déjà en route';
  end if;
  select count(*) + 1 into v_n from remboursements where retenue_id = p_id;
  insert into remboursements (retenue_id, terminal, float_id, operateur, numero, montant, note, cle)
  values (p_id, v_float.terminal, v_float.id, v_r.operateur, v_r.numero_payeur, v_r.montant, p_note, 'rbt-' || p_id::text || '-' || v_n::text);
  update entrees_retenues set etat = 'remboursee' where id = p_id;
  -- le journal se garde longtemps et se lit à plusieurs : la référence de l'entrée, jamais le numéro du payeur
  perform _journaliser('rembourser_retenue', p_id::text, jsonb_build_object('montant', v_r.montant, 'note', p_note, 'essai', v_n));
  return jsonb_build_object('ok', true, 'montant', v_r.montant, 'numero', v_r.numero_payeur);
end $$;

-- Les remboursements, que TOTEM compose comme des transferts (même guichet, type 'remboursements').
create table remboursements (
  id         bigint generated always as identity primary key,
  retenue_id bigint not null references entrees_retenues(id),
  terminal   text references terminaux(id),
  float_id   int references floats(id),
  operateur  text not null,
  numero     text not null,
  montant    numeric(20,2) not null check (montant > 0),
  note       text,
  etat       text not null default 'en_attente' check (etat in ('en_attente', 'en_cours', 'fait', 'echoue')),
  resultat   text,
  reference_operateur text,
  cle        text not null unique,
  cree_le    timestamptz not null default now(),
  reclamee_le timestamptz,
  traite_le  timestamptz
);
alter table remboursements enable row level security;
create index remboursements_de_la_retenue on remboursements (retenue_id);

create function totem_remboursements_en_attente(p_terminal text)
returns setof remboursements language plpgsql security definer set search_path = public as $$
begin
  update terminaux set vu_le = now() where id = p_terminal;
  return query select * from remboursements where (terminal = p_terminal or terminal is null) and etat = 'en_attente' order by id;
end $$;

create function totem_reclamer_remboursement(p_id bigint, p_terminal text)
returns remboursements language plpgsql security definer set search_path = public as $$
declare v remboursements;
begin
  update remboursements set etat = 'en_cours', terminal = p_terminal, reclamee_le = now()
   where id = p_id and (terminal = p_terminal or terminal is null) and etat = 'en_attente' returning * into v;
  if not found then raise exception 'commande déjà prise ou inconnue'; end if;
  return v;
end $$;

create function totem_resultat_remboursement(p_id bigint, p_terminal text, p_ok boolean, p_resultat text, p_reference_operateur text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v remboursements;
begin
  select * into v from remboursements where id = p_id and terminal = p_terminal for update;
  if not found then raise exception 'remboursement inconnu'; end if;
  -- un résultat ne vaut que pour un remboursement réclamé ; le reste est un doublon
  if v.etat <> 'en_cours' then return jsonb_build_object('remboursement', v.etat, 'deja', true); end if;
  update remboursements set etat = case when p_ok then 'fait' else 'echoue' end, resultat = p_resultat, reference_operateur = p_reference_operateur, traite_le = now() where id = p_id;
  if not p_ok then update entrees_retenues set etat = 'retenue' where id = v.retenue_id; end if;
  return jsonb_build_object('remboursement', case when p_ok then 'fait' else 'echoue' end);
end $$;

-- Un remboursement réclamé par un boîtier qui s'est tu : rendu à un autre tour,
-- comme une commande. Jamais un remboursement « fait » : l'argent est parti.
create function admin_liberer_remboursement(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v remboursements;
begin
  perform _exiger_droit('rembourser');
  select * into v from remboursements where id = p_id for update;
  if not found then raise exception 'remboursement inconnu'; end if;
  if v.etat <> 'en_cours' then raise exception 'seul un remboursement en cours se libère' using detail = v.etat; end if;
  if v.reclamee_le > now() - interval '5 minutes' then raise exception 'réclamé il y a moins de cinq minutes : le boîtier compose peut-être encore'; end if;
  update remboursements set etat = 'en_attente', reclamee_le = null where id = p_id;
  perform _journaliser('liberer_remboursement', p_id::text);
  return jsonb_build_object('ok', true);
end $$;

-- ──────────────────────────── les sorties ──────────────────────────────────
create function admin_sorties(p_etat text default null, p_n int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(_sortie_json(s) || jsonb_build_object(
           'compte', jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom),
           'transferts', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'terminal', k.terminal, 'etat', k.etat, 'montant_xafe', k.montant_xafe,
                                                     'montant_envoye', (k.parametres ->> 'montant')::numeric, 'reprises', k.reprises, 'resultat', k.resultat,
                                                     'reference_operateur', k.reference_operateur, 'reclamee_le', k.reclamee_le) order by k.id), '[]'::jsonb)
                            from commandes k where k.sortie_id = s.id)) order by s.cree_le desc), '[]'::jsonb)
    into r
    from (select * from sorties where (p_etat is null or etat = p_etat) order by cree_le desc limit p_n) s
    join comptes c on c.id = s.compte_id;
  return r;
end $$;

-- Un transfert réclamé par un boîtier qui s'est tu : on le libère, un autre
-- tour le reprendra. Jamais un transfert « fait » : l'argent est parti.
create function admin_liberer_commande(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v commandes;
begin
  perform _exiger_droit('sorties');
  select * into v from commandes where id = p_id for update;
  if not found then raise exception 'commande inconnue'; end if;
  if v.etat <> 'en_cours' then raise exception 'seule une commande en cours se libère' using detail = v.etat; end if;
  if v.reclamee_le > now() - interval '5 minutes' then raise exception 'réclamée il y a moins de cinq minutes : le boîtier compose peut-être encore'; end if;
  update commandes set etat = 'en_attente', reclamee_le = null where id = p_id;
  perform _journaliser('liberer_commande', p_id::text);
  return jsonb_build_object('ok', true);
end $$;

-- Un transfert attend un boîtier qui s'est tu : on le donne à un autre boîtier
-- qui porte une carte du même opérateur. Seulement « en attente » : réclamé,
-- il est peut-être en train d'être composé.
create function admin_reaffecter_commande(p_id bigint, p_terminal text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v commandes; v_float floats;
begin
  perform _exiger_droit('sorties');
  select * into v from commandes where id = p_id for update;
  if not found then raise exception 'commande inconnue'; end if;
  if v.etat <> 'en_attente' then raise exception 'seule une commande en attente se réaffecte' using detail = v.etat; end if;
  select f.* into v_float from floats f where f.terminal = p_terminal and f.actif and f.operateur = v.parametres ->> 'operateur' order by f.id limit 1;
  if not found then raise exception 'ce terminal ne porte aucune carte de cet opérateur'; end if;
  update commandes set terminal = p_terminal, float_id = v_float.id,
         parametres = parametres || jsonb_build_object('float_numero', v_float.numero)
   where id = p_id;
  perform _journaliser('reaffecter_commande', p_id::text, jsonb_build_object('de', v.terminal, 'vers', p_terminal));
  return jsonb_build_object('ok', true, 'terminal', p_terminal, 'float_numero', v_float.numero);
end $$;

-- Annuler ce qui n'est pas encore parti d'une sortie : ses transferts EN
-- ATTENTE sont clos, leurs XAFe reviennent au client. Un transfert réclamé
-- (peut-être en train d'être composé) ou fait n'est jamais touché : il faut
-- d'abord le libérer, après cinq minutes de silence du boîtier.
create function admin_annuler_sortie(p_reference text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s sorties; v commandes; v_rendu numeric := 0; v_faites int; v_echouees int;
begin
  perform _exiger_droit('sorties');
  if length(trim(coalesce(p_note, ''))) < 3 then raise exception 'une note est exigée' using detail = 'pourquoi la sortie est annulée'; end if;
  select * into v_s from sorties where reference = p_reference for update;
  if not found then raise exception 'sortie inconnue'; end if;
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

-- ───────────────────────── terminaux et floats ─────────────────────────────
create function admin_terminaux() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nom', t.nom, 'lieu', t.lieu, 'vu_le', t.vu_le, 'a_cle', t.cle is not null,
                            'muet', t.vu_le is null or t.vu_le < now() - interval '10 minutes',
                            'floats', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'operateur', f.operateur, 'numero', f.numero, 'code_agent', f.code_agent, 'actif', f.actif,
                                                                         -- retirer un float que des dossiers ouverts donnent à payer se confirme
                                                                         'dossiers_ouverts', (select count(*) from depots d where d.float_id = f.id and d.etat = 'en_attente'))
                                                      order by f.id), '[]'::jsonb) from floats f where f.terminal = t.id),
                            'commandes_en_attente', (select count(*) from commandes k where k.terminal = t.id and k.etat = 'en_attente')) order by t.id), '[]'::jsonb)
    into r from terminaux t;
  return r;
end $$;

-- Créer un boîtier : sa clé est rendue UNE fois, ici ; elle ne se relit pas.
create function admin_creer_terminal(p_id text, p_nom text, p_lieu text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cle text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  perform _exiger_droit('terminaux');
  if p_id !~ '^[a-z0-9-]{3,32}$' then raise exception 'identifiant invalide' using detail = 'minuscules, chiffres et tirets'; end if;
  insert into terminaux (id, nom, lieu, cle) values (p_id, p_nom, p_lieu, v_cle);
  perform _journaliser('creer_terminal', p_id);
  return jsonb_build_object('id', p_id, 'cle', v_cle);
end $$;

create function admin_renouveler_cle(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cle text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  perform _exiger_droit('terminaux');
  update terminaux set cle = v_cle where id = p_id;
  if not found then raise exception 'terminal inconnu'; end if;
  perform _journaliser('renouveler_cle', p_id);
  return jsonb_build_object('id', p_id, 'cle', v_cle);
end $$;

create function admin_creer_float(p_operateur text, p_numero text, p_terminal text, p_code_agent text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id int;
begin
  perform _exiger_droit('terminaux');
  if normaliser_numero(p_numero) !~ '^6[0-9]{8}$' or operateur_du_numero(p_numero) is distinct from p_operateur then
    raise exception 'numéro invalide' using detail = 'un numéro camerounais de cet opérateur';
  end if;
  perform 1 from terminaux where id = p_terminal;
  if not found then raise exception 'terminal inconnu'; end if;
  insert into floats (operateur, numero, terminal, code_agent) values (p_operateur, normaliser_numero(p_numero), p_terminal, p_code_agent) returning id into v_id;
  perform _journaliser('creer_float', v_id::text, jsonb_build_object('operateur', p_operateur, 'numero', normaliser_numero(p_numero), 'terminal', p_terminal));
  return jsonb_build_object('id', v_id);
end $$;

create function admin_activer_float(p_id int, p_actif boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('terminaux');
  update floats set actif = p_actif where id = p_id;
  if not found then raise exception 'float inconnu'; end if;
  perform _journaliser(case when p_actif then 'activer_float' else 'desactiver_float' end, p_id::text);
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────────── les clients ─────────────────────────────────
-- p_filtre = 'verifications' : les comptes dont les pièces attendent l'équipe, quel que soit leur âge. L'écran
-- filtrait les 200 comptes les plus récents : un dossier plus ancien n'était jamais examiné.
create function admin_clients(p_recherche text default null, p_n int default 100, p_filtre text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_q text := nullif(trim(coalesce(p_recherche, '')), '');
begin
  perform _exiger_droit('clients');
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'entreprise', c.entreprise, 'palier', c.palier,
                            'verification_en_cours', c.verification_en_cours, 'cree_le', c.cree_le, 'desactive_le', c.desactive_le,
                            'xafe', (select coalesce(disponible + bloque, 0) from soldes where compte_id = c.id and actif = 'XAFe'),
                            'usdt', (select coalesce(disponible + bloque, 0) from soldes where compte_id = c.id and actif = 'USDT')) order by c.cree_le desc), '[]'::jsonb)
    into r
    from (select * from comptes where not maison
             and (p_filtre is distinct from 'verifications' or verification_en_cours is not null)
             and (v_q is null
                  or (length(normaliser_numero(v_q)) >= 3 and telephone like '%' || normaliser_numero(v_q) || '%')
                  or nom ilike '%' || v_q || '%' or entreprise ilike '%' || v_q || '%')
           order by cree_le desc limit p_n) c;
  return r;
end $$;

create function admin_client(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('clients');
  select jsonb_build_object(
    'compte', _compte_json(c) || jsonb_build_object('cree_le', c.cree_le, 'desactive_le', c.desactive_le, 'verification_pieces', c.verification_pieces, 'code_verrou_jusqua', c.code_verrou_jusqua),
    'soldes', (select coalesce(jsonb_object_agg(actif, jsonb_build_object('disponible', disponible, 'bloque', bloque)), '{}'::jsonb) from soldes where compte_id = c.id),
    'numeros', (select coalesce(jsonb_agg(_numero_json(n) order by n.verifie_le), '[]'::jsonb) from numeros n where n.compte_id = c.id),
    'depots', (select coalesce(jsonb_agg(_depot_json(d) order by d.cree_le desc), '[]'::jsonb) from (select * from depots where compte_id = c.id order by cree_le desc limit 20) d),
    'sorties', (select coalesce(jsonb_agg(_sortie_json(s) order by s.cree_le desc), '[]'::jsonb) from (select * from sorties where compte_id = c.id order by cree_le desc limit 20) s),
    'ordres', (select coalesce(jsonb_agg(_ordre_json(o) order by o.cree_le desc), '[]'::jsonb) from (select * from ordres where compte_id = c.id order by cree_le desc limit 20) o),
    'ecritures', (select coalesce(jsonb_agg(jsonb_build_object('actif', e.actif, 'disponible', e.disponible_delta, 'bloque', e.bloque_delta, 'nature', e.nature, 'source', e.source_id, 'quand', e.cree_le) order by e.cree_le desc), '[]'::jsonb)
                    from (select * from ecritures where compte_id = c.id order by cree_le desc limit 50) e))
    into r from comptes c where c.id = p_id;
  return r;
end $$;

create function admin_changer_palier(p_id uuid, p_palier int, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('paliers');
  if p_palier not between 0 and 2 then raise exception 'palier invalide'; end if;
  -- une vérification en cours ne disparaît que si le palier posé la satisfait : sinon ses pièces attendent encore l'équipe
  update comptes set palier = p_palier,
         verification_en_cours = case when (verification_en_cours = 'identite' and p_palier >= 1)
                                        or (verification_en_cours = 'entreprise' and p_palier >= 2) then null
                                      else verification_en_cours end
   where id = p_id and not maison;
  if not found then raise exception 'compte inconnu'; end if;
  perform _journaliser('changer_palier', p_id::text, jsonb_build_object('palier', p_palier, 'note', p_note));
  perform _notifier(p_id, 'Palier ' || p_palier, case p_palier when 0 then 'Votre compte est au palier 0.' when 1 then 'Votre identité est vérifiée : palier 1.' else 'Votre entreprise est vérifiée : palier 2, sans plafond plateforme.' end, '/compte/paliers');
  return jsonb_build_object('ok', true);
end $$;

-- Valider ou refuser les pièces : valider monte au palier que la demande visait.
create function admin_valider_verification(p_id uuid, p_ok boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c comptes; v_palier int;
begin
  perform _exiger_droit('paliers');
  select * into v_c from comptes where id = p_id for no key update;
  if not found or v_c.verification_en_cours is null then raise exception 'aucune vérification en cours'; end if;
  if p_ok then
    v_palier := case v_c.verification_en_cours when 'identite' then greatest(v_c.palier, 1) else 2 end;
    update comptes set palier = v_palier, verification_en_cours = null where id = p_id;
    perform _notifier(p_id, 'Vérification acceptée', case v_palier when 1 then 'Votre identité est vérifiée : palier 1.' else 'Votre entreprise est vérifiée : palier 2.' end, '/compte/paliers');
  else
    update comptes set verification_en_cours = null where id = p_id;
    perform _notifier(p_id, 'Vérification refusée', coalesce(p_note, 'Les pièces ne permettent pas de vérifier votre dossier. Réessayez avec des photos nettes.'), '/compte/paliers');
  end if;
  perform _journaliser(case when p_ok then 'valider_verification' else 'refuser_verification' end, p_id::text, jsonb_build_object('type', v_c.verification_en_cours, 'note', p_note));
  return jsonb_build_object('ok', true, 'palier', (select palier from comptes where id = p_id));
end $$;

create function admin_desactiver_compte(p_id uuid, p_actif boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('clients');
  update comptes set desactive_le = case when p_actif then null else now() end where id = p_id and not maison;
  if not found then raise exception 'compte inconnu'; end if;
  perform _journaliser(case when p_actif then 'reactiver_compte' else 'desactiver_compte' end, p_id::text, jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────────── le marché ───────────────────────────────────
create function admin_marche() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select jsonb_build_object(
    'cotation', cotation(), 'carnet', carnet(20), 'transactions', transactions_recentes(30),
    'ordres_ouverts', (select count(*) from ordres where etat in ('ouvert', 'partiel')),
    'parametres', parametre('marche'), 'frais', parametre('frais'),
    'chandelles', chandelles(60, 48))
    into r;
  return r;
end $$;

-- ─────────────────────────── les paramètres ────────────────────────────────
create function admin_parametres() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_object_agg(cle, valeur), '{}'::jsonb) into r from parametres;
  return r || jsonb_build_object('operateurs', (select jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'plafond_par_transfert', plafond_par_transfert, 'plafond_jour', plafond_jour) order by id) from operateurs));
end $$;

-- Un paramètre est lu par le moteur à chaque geste : une valeur mal formée
-- (un nombre en texte, une clé oubliée, des frais à 50 %) arrêterait les
-- dépôts, les sorties ou le verrou du code secret — ou lèverait un plafond.
-- Elle est refusée ici, avec la raison, avant d'être écrite.
create function _nombre_entre(v jsonb, p_min numeric, p_max numeric, p_entier boolean default false) returns boolean
language sql immutable as $$
  -- une clé absente rend null, et « not null » n'est pas vrai : on dit faux, net
  select coalesce(jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between p_min and p_max
                  and (not p_entier or (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)), false)
$$;

create function _verifier_parametre(p_cle text, v jsonb) returns void
language plpgsql as $$
declare k text; p jsonb; ok boolean;
begin
  if jsonb_typeof(v) <> 'object' then raise exception 'paramètre invalide' using detail = 'un objet JSON est attendu'; end if;
  ok := case p_cle
    when 'frais' then _nombre_entre(v -> 'placeur', 0, 0.05) and _nombre_entre(v -> 'preneur', 0, 0.05) and _nombre_entre(v -> 'sortie', 0, 0.05)
    when 'marche' then v ->> 'paire' = 'USDT/XAFe' and _nombre_entre(v -> 'pas_prix', 0.01, 100) and _nombre_entre(v -> 'quantite_min', 0.01, 1000000)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
    when 'depot' then _nombre_entre(v -> 'validite_minutes', 5, 1440, true) and _nombre_entre(v -> 'grace_minutes', 0, 10080, true)
    when 'sortie' then _nombre_entre(v -> 'reprises_max', 1, 10, true)
    when 'rapide' then _nombre_entre(v -> 'marge', 0, 0.2) and _nombre_entre(v -> 'validite_secondes', 5, 120, true)
                       and jsonb_typeof(v -> 'ouvert') = 'boolean'
    when 'code_secret' then _nombre_entre(v -> 'essais', 1, 10, true) and _nombre_entre(v -> 'verrou_minutes', 1, 1440, true)
                       and _nombre_entre(v -> 'longueur_min', 4, 6, true) and _nombre_entre(v -> 'longueur_max', 4, 8, true)
                       and (v ->> 'longueur_min')::int <= (v ->> 'longueur_max')::int
    when 'crypto' then _nombre_entre(v -> 'frais' -> 'USDT', 0, 1000) and _nombre_entre(v -> 'frais' -> 'XAFe', 0, 1000000)
                       and _nombre_entre(v -> 'confirmations' -> 'bep20', 1, 1000, true) and _nombre_entre(v -> 'confirmations' -> 'trc20', 1, 1000, true)
                       and jsonb_typeof(v -> 'retraits_ouverts') = 'boolean'
    when 'paliers' then (select bool_and(x) from (values (v ? '0'), (v ? '1'), (v ? '2')) t(x))
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

create function admin_modifier_parametre(p_cle text, p_valeur jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('parametres');
  if p_cle not in ('frais', 'marche', 'depot', 'sortie', 'paliers', 'crypto', 'code_secret', 'rapide') then raise exception 'paramètre inconnu'; end if;
  perform _verifier_parametre(p_cle, p_valeur);
  update parametres set valeur = p_valeur where cle = p_cle;
  if not found then raise exception 'paramètre inconnu'; end if;
  perform _journaliser('modifier_parametre', p_cle, p_valeur);
  return jsonb_build_object('ok', true);
end $$;

create function admin_journal(p_n int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'admin', a.nom, 'action', j.action, 'cible', j.cible, 'detail', j.detail, 'quand', j.cree_le) order by j.id desc), '[]'::jsonb)
    into r from (select * from journal_admin order by id desc limit p_n) j left join administrateurs a on a.id = j.admin_id;
  return r;
end $$;

-- Les GRANT sont dans 0004_droits.sql.
