-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0016 · la parité, prouvée à trois colonnes                   ║
-- ║                                                                        ║
-- ║  1 XAFe = 1 XAF. Le dire ne prouve rien. Trois chiffres, venus de      ║
-- ║  trois sources qui ne se connaissent pas, doivent se tenir :           ║
-- ║                                                                        ║
-- ║    LES FLOATS   l'argent réellement posé chez MTN et Orange, tel que   ║
-- ║                 l'OPÉRATEUR l'annonce (le « nouveau solde » de chaque  ║
-- ║                 SMS relevé par TOTEM, un solde USSD, ou le relevé      ║
-- ║                 officiel saisi par l'équipe) — jamais un calcul à nous ║
-- ║    LE REGISTRE  ce que Glisil doit : chaque XAFe émis contre des XAF   ║
-- ║                 reçus, moins chaque XAFe détruit contre des XAF payés  ║
-- ║    LA CHAÎNE    l'offre du jeton sur la BNB Smart Chain et sur Tron,   ║
-- ║                 relue frappe par frappe sur la chaîne elle-même par    ║
-- ║                 le veilleur, sans se fier à ses propres notes          ║
-- ║                                                                        ║
-- ║  Les règles, contrôlées toutes les cinq minutes :                      ║
-- ║    · chaîne = registre, AU FRANC PRÈS, une fois les opérations en      ║
-- ║      route comptées ;                                                  ║
-- ║    · chaque frappe et chaque destruction lue sur la chaîne a sa ligne  ║
-- ║      dans le registre (même référence, même montant), et l'inverse ;   ║
-- ║    · l'offre lue au contrat = la somme des mouvements relus (la        ║
-- ║      lecture n'a rien manqué) ;                                        ║
-- ║    · floats ≥ registre : l'argent posé couvre ce qui est dû. PAS       ║
-- ║      l'égalité — les floats portent aussi les frais gagnés et         ║
-- ║      l'argent propre de l'entreprise ; l'excédent se montre.          ║
-- ║  Au premier franc d'écart, une alarme ; vue deux fois de suite (cinq   ║
-- ║  minutes d'écart, pour ne pas crier sur une opération à mi-chemin),    ║
-- ║  elle part aussi par SMS au numéro que l'équipe a posé.                ║
-- ║                                                                        ║
-- ║  Et tout cela se lit sans compte, sur une page publique : n'importe    ║
-- ║  qui peut refaire les calculs avec un explorateur de blocs.            ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ───────────────────────────── réglages ────────────────────────────────────
-- Le bloc du déploiement de chaque contrat : la lecture du jeton part de là,
-- pour qu'aucune frappe ne lui échappe. Posé pour les contrats d'essai connus ;
-- un autre déploiement le pose lui-même (chaine/README.md).
update parametres set valeur = jsonb_set(valeur, '{bep20,depart}', '137002002'::jsonb)
 where cle = 'chaine' and valeur #>> '{bep20,xafe}' = '0x750E774368240063BD5CF52b30b91183Efa4dAf3' and valeur #> '{bep20,depart}' is null;
update parametres set valeur = jsonb_set(valeur, '{trc20,depart}', '71854913'::jsonb)
 where cle = 'chaine' and valeur #>> '{trc20,xafe}' = 'TFtfFFmagGUjxGrG3cM4MX4kTv8YvBgLnk' and valeur #> '{trc20,depart}' is null;

-- L'alarme : à quel numéro l'envoyer par SMS (aucun d'office), au bout de
-- combien d'heures un solde de float ne vaut plus « connu », au bout de
-- combien de minutes une opération attendue et absente de la chaîne est une
-- anomalie, et si la page publique montre le solde des floats.
insert into parametres (cle, valeur) values
  ('parite', '{"alerte_numero": null, "alerte_operateur": "mtn", "fraicheur_heures": 24, "delai_minutes": 30, "publier_floats": true}')
on conflict (cle) do nothing;

-- ─────────────────── la colonne « floats » : ce que dit l'opérateur ──────────
create table if not exists soldes_floats (
  id         bigint generated always as identity primary key,
  float_id   int not null references floats(id),
  solde      numeric(20,2) not null check (solde >= 0),
  annonce_le timestamptz not null,                     -- l'heure à laquelle l'OPÉRATEUR l'a annoncé
  source     text not null check (source in ('sms', 'ussd', 'releve')),
  terminal   text,
  source_id  bigint,                                   -- la ligne du journal de TOTEM, pour un SMS
  preuve     text,                                     -- le relevé déposé par l'équipe (chemin dans le stockage)
  note       text,
  saisi_par  uuid,
  cree_le    timestamptz not null default now()
);
create unique index if not exists soldes_floats_un_sms on soldes_floats (terminal, source_id) where source = 'sms';
create index if not exists soldes_floats_dernier on soldes_floats (float_id, annonce_le desc, id desc);
alter table soldes_floats enable row level security;

-- Le dernier solde annoncé de chaque float. L'heure de l'annonce décide, pas
-- celle de l'arrivée : un SMS relevé en retard ne remplace pas un plus récent.
create or replace function _solde_float(p_float int) returns soldes_floats
language sql stable set search_path = public as $$
  select * from soldes_floats where float_id = p_float order by annonce_le desc, id desc limit 1
$$;

-- TOTEM (par la porte signée, clé de service) : le solde que l'opérateur
-- vient d'annoncer sur ce float. Un float qui n'est pas celui de ce terminal
-- est refusé ; un SMS rejoué ne compte qu'une fois.
create or replace function totem_solde_float(p_terminal text, p_operateur text, p_float_numero text, p_solde numeric,
                                             p_annonce_le timestamptz, p_source text, p_source_id bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_float floats; v_id bigint;
begin
  if p_source not in ('sms', 'ussd') then raise exception 'source inconnue'; end if;
  if p_solde is null or p_solde < 0 then return jsonb_build_object('resultat', 'refuse', 'motif', 'solde illisible'); end if;
  select * into v_float from floats
   where operateur = p_operateur and numero = normaliser_numero(p_float_numero) and terminal = p_terminal;
  if not found then return jsonb_build_object('resultat', 'refuse', 'motif', 'ce float n''est pas sur ce terminal'); end if;
  -- une heure dans le futur (horloge du modem déréglée) ne doit pas figer ce solde devant tous les suivants
  insert into soldes_floats (float_id, solde, annonce_le, source, terminal, source_id)
  values (v_float.id, p_solde, least(coalesce(p_annonce_le, now()), now()), p_source, p_terminal, p_source_id)
  on conflict (terminal, source_id) where source = 'sms' do nothing
  returning id into v_id;
  return jsonb_build_object('resultat', case when v_id is null then 'deja' else 'note' end, 'float', v_float.id);
end $$;

-- L'équipe : le solde du RELEVÉ officiel de l'opérateur (l'export MTN ou
-- Orange), avec sa preuve. C'est lui qui fait foi quand un SMS manque.
create or replace function admin_saisir_releve(p_float int, p_solde numeric, p_annonce_le timestamptz, p_preuve text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform _exiger_droit('rapprocher');
  if p_solde is null or p_solde < 0 or not (p_solde = round(p_solde, 2)) then raise exception 'solde invalide'; end if;
  if p_annonce_le is null or p_annonce_le > now() + interval '5 minutes' then raise exception 'la date du relevé est dans le futur'; end if;
  if coalesce(p_preuve, '') = '' then raise exception 'le relevé de l''opérateur est exigé : déposez le fichier'; end if;
  if not exists (select 1 from floats where id = p_float) then raise exception 'float inconnu'; end if;
  insert into soldes_floats (float_id, solde, annonce_le, source, preuve, note, saisi_par)
  values (p_float, p_solde, p_annonce_le, 'releve', p_preuve, left(p_note, 500), auth.uid())
  returning id into v_id;
  perform _journaliser('saisir_releve', p_float::text, jsonb_build_object('solde', p_solde, 'annonce_le', p_annonce_le));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ─────────────────── la colonne « chaîne » : ce que la chaîne dit ────────────
-- L'empreinte de chaque référence : keccak256 de son texte, ce que le contrat
-- scelle dans chaque frappe et chaque destruction. La base ne sait pas le
-- calculer ; le veilleur le fait, et n'importe qui peut le refaire.
create table if not exists chaine_empreintes (
  empreinte text primary key,
  reference text not null,
  note_le   timestamptz not null default now()
);
create index if not exists chaine_empreintes_reference on chaine_empreintes (reference);
alter table chaine_empreintes enable row level security;

-- Chaque frappe et chaque destruction de XAFe, relue sur la chaîne depuis le
-- déploiement du contrat. Rien ici ne vient de nos propres notes d'envoi.
create table if not exists chaine_mouvements_jeton (
  reseau    text not null check (reseau in ('bep20', 'trc20')),
  tx_hash   text not null,
  idx       int not null,
  bloc      bigint not null,
  genre     text not null check (genre in ('frappe', 'destruction')),
  adresse   text not null,
  montant   numeric(30,6) not null check (montant > 0),
  empreinte text,                                      -- null : aucune Frappe / aucun Detruit ne l'accompagnait
  vu_le     timestamptz not null default now(),
  primary key (reseau, tx_hash, idx)
);
create index if not exists chaine_mouvements_empreinte on chaine_mouvements_jeton (empreinte);
alter table chaine_mouvements_jeton enable row level security;

-- Les références dont le veilleur doit encore calculer l'empreinte.
create or replace function chaine_references_sans_empreinte(p_n int default 500) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(reference), '[]'::jsonb) from (
    select distinct x.reference from (
      select reference from reserve_chaine
      union all select reference from retraits_crypto where actif = 'XAFe' and tx_hash is not null
      union all select tx_hash from transferts_crypto where actif = 'XAFe' and sens = 'entree' and tx_hash is not null
    ) x where not exists (select 1 from chaine_empreintes e where e.reference = x.reference)
    limit greatest(1, least(p_n, 1000))) r
$$;

create or replace function chaine_noter_empreintes(p_empreintes jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- une empreinte qui désignerait deux références : impossible avec keccak256, donc un défaut à crier, pas à écraser
  if exists (select 1 from jsonb_to_recordset(p_empreintes) as x(empreinte text, reference text)
               join chaine_empreintes e on e.empreinte = lower(x.empreinte) and e.reference <> x.reference) then
    raise exception 'une empreinte déjà notée pour une autre référence';
  end if;
  insert into chaine_empreintes (empreinte, reference)
  select lower(x.empreinte), x.reference from jsonb_to_recordset(p_empreintes) as x(empreinte text, reference text)
   where x.empreinte ~ '^0x[0-9a-fA-F]{64}$' and coalesce(x.reference, '') <> ''
  on conflict (empreinte) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Les mouvements relus ET le curseur, dans la même transaction : un tour
-- coupé ne saute aucun bloc, et relire n'ajoute rien.
create or replace function chaine_noter_mouvements(p_reseau text, p_jusqua bigint, p_mouvements jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into chaine_mouvements_jeton (reseau, tx_hash, idx, bloc, genre, adresse, montant, empreinte)
  select p_reseau, x.tx, x.index, x.bloc, x.genre, x.adresse, x.montant, lower(x.empreinte)
    from jsonb_to_recordset(p_mouvements) as x(tx text, index int, bloc bigint, genre text, adresse text, montant numeric, empreinte text)
  on conflict (reseau, tx_hash, idx) do nothing;
  get diagnostics n = row_count;
  perform chaine_curseur(p_reseau || ':jeton', p_jusqua);
  return n;
end $$;

create or replace function _explorateur(p_reseau text) returns text
language sql stable set search_path = public as $$
  select case p_reseau
    when 'bep20' then case when coalesce((parametre('chaine') ->> 'essai')::boolean, false) then 'https://testnet.bscscan.com' else 'https://bscscan.com' end
    when 'trc20' then case when coalesce((parametre('chaine') ->> 'essai')::boolean, false) then 'https://nile.tronscan.org/#' else 'https://tronscan.org/#' end
  end
$$;

-- ─────────────────── le rapprochement, ligne par ligne ───────────────────────
-- D'un côté ce que le registre attend sur la chaîne :
--   reserve  chaque frappe / destruction de la réserve (0015) ;
--   retrait  chaque frappe vers le wallet d'un client (un retrait XAFe) ;
--   retour   chaque destruction de XAFe rendus par un client (sur son adresse de dépôt).
-- De l'autre ce que la chaîne montre. Le lien : la référence, par son empreinte.
-- Les verdicts :
--   concorde    vu des deux côtés, même sens, même montant ;
--   en_route    attendu, pas encore lu sur la chaîne, dans le délai ;
--   en_retard   attendu, pas encore lu, au-delà du délai — anomalie ;
--   refusee     la chaîne a refusé l'opération — anomalie, l'équipe la rejoue ;
--   ecart       vu des deux côtés, mais pas le même montant — anomalie ;
--   inconnue    lu sur la chaîne, et le registre ne l'explique pas — anomalie grave.
create or replace function _parite_lignes() returns table (
  reference text, nature text, reseau text, genre text, montant numeric, etat_registre text, tx_attendu text, depuis timestamptz,
  empreinte text, tx_vu text, bloc_vu bigint, montant_vu numeric, adresse_vue text, verdict text)
language sql stable set search_path = public as $$
  with attendu as (
    select r.reference, 'reserve'::text nature, r.reseau, case r.operation when 'frapper' then 'frappe' else 'destruction' end genre,
           r.montant::numeric montant, r.etat etat_registre, r.tx_hash tx_attendu, r.cree_le depuis
      from reserve_chaine r
    union all
    select x.reference, 'retrait', x.reseau, 'frappe', x.montant, case x.etat when 'envoye' then 'confirme' else 'envoye' end, x.tx_hash, x.cree_le
      from retraits_crypto x where x.actif = 'XAFe' and x.tx_hash is not null and x.etat in ('en_cours', 'envoye')
    union all
    select t.tx_hash, 'retour', t.reseau, 'destruction', t.montant, 'confirme', null, t.cree_le
      from transferts_crypto t where t.actif = 'XAFe' and t.sens = 'entree'
  ), vu as (
    select m.*, e.reference from chaine_mouvements_jeton m left join chaine_empreintes e on e.empreinte = m.empreinte
  ), delai as (select make_interval(mins => coalesce((parametre('parite') ->> 'delai_minutes')::int, 30)) d)
  select coalesce(a.reference, v.reference), coalesce(a.nature, 'inconnue'), coalesce(a.reseau, v.reseau), coalesce(a.genre, v.genre),
         a.montant, a.etat_registre, a.tx_attendu, coalesce(a.depuis, v.vu_le),
         v.empreinte, v.tx_hash, v.bloc, v.montant, v.adresse,
         case
           when a.reference is null then 'inconnue'
           when v.tx_hash is null and a.etat_registre = 'echoue' then 'refusee'
           when v.tx_hash is null and a.depuis > now() - (select d from delai) then 'en_route'
           when v.tx_hash is null then 'en_retard'
           -- un retour se crédite au centime près, arrondi vers le bas : le reste de la chaîne n'est dû à personne
           when a.nature = 'retour' and floor(v.montant * 100) / 100 = a.montant then 'concorde'
           when v.montant = a.montant then 'concorde'
           else 'ecart' end
    from attendu a
    full join vu v on v.reference = a.reference and v.reseau = a.reseau and v.genre = a.genre
$$;

-- ─────────────────── le relevé de parité, toutes les cinq minutes ────────────
create table if not exists parite_releves (
  id           bigint generated always as identity primary key,
  fait_le      timestamptz not null default now(),
  registre     numeric(20,2) not null,                 -- ce que Glisil doit : émis − détruits
  dans_comptes numeric(20,2) not null,                 -- dont dans les comptes Glisil
  sur_wallets  numeric(20,2) not null,                 -- dont sur les wallets des clients
  chaine       numeric(30,6),                          -- l'offre du jeton, relue mouvement par mouvement (null : lecture pas à jour)
  offre_lue    numeric(30,6),                          -- l'offre lue au contrat, au même bloc
  en_route     numeric(30,6) not null,                 -- ce qui est attendu et pas encore lu (frappes +, destructions −)
  ecart        numeric(30,6),                          -- chaîne + en route − registre : 0, toujours
  floats       numeric(20,2),                          -- la somme des derniers soldes annoncés (null : un float sans solde connu)
  couverture   numeric(20,2),                          -- floats − registre : jamais négatif
  anomalies    int not null,
  statut       text not null check (statut in ('juste', 'en_cours', 'ecart', 'incomplet')),
  detail       jsonb not null
);
create index if not exists parite_releves_dernier on parite_releves (fait_le desc);
alter table parite_releves enable row level security;

create table if not exists parite_alertes (
  id         bigint generated always as identity primary key,
  code       text not null,                            -- ecart_chaine, ligne:<référence>, lecture, couverture, float:<id>
  gravite    text not null check (gravite in ('grave', 'anomalie', 'attention')),
  message    text not null,
  detail     jsonb,
  ouverte_le timestamptz not null default now(),
  vue_le     timestamptz not null default now(),
  vues       int not null default 1,
  sms_le     timestamptz,
  close_le   timestamptz
);
create unique index if not exists parite_alertes_une_ouverte on parite_alertes (code) where close_le is null;
alter table parite_alertes enable row level security;

-- Ce que l'état de la chaîne publié par le veilleur dit du jeton, réseau par réseau.
create or replace function _jeton_publie() returns table (reseau text, offre numeric, reserve numeric, bloc bigint, a_jour boolean, lu_le timestamptz)
language sql stable set search_path = public as $$
  select e.reseau, (e.etat -> 'jeton' ->> 'offre')::numeric, (e.etat -> 'jeton' ->> 'reserve')::numeric,
         (e.etat -> 'jeton' ->> 'bloc')::bigint, coalesce((e.etat -> 'jeton' ->> 'a_jour')::boolean, false),
         (e.etat -> 'jeton' ->> 'lu_le')::timestamptz
    from chaine_etats e
   where (parametre('chaine') -> e.reseau) is not null and jsonb_typeof(parametre('chaine') -> e.reseau) = 'object'
$$;

-- Ouvrir (ou rafraîchir) une alerte ; l'envoyer par SMS quand elle a été vue
-- deux fois de suite et qu'un numéro est posé — une seule fois par alerte.
create or replace function _parite_alerter(p_code text, p_gravite text, p_message text, p_detail jsonb) returns void
language plpgsql set search_path = public as $$
declare v parite_alertes; v_num text := normaliser_numero(parametre('parite') ->> 'alerte_numero'); v_op text := coalesce(parametre('parite') ->> 'alerte_operateur', 'mtn');
        v_float floats;
begin
  insert into parite_alertes (code, gravite, message, detail) values (p_code, p_gravite, p_message, p_detail)
  on conflict (code) where close_le is null
  do update set vue_le = now(), vues = parite_alertes.vues + 1, message = excluded.message, detail = excluded.detail, gravite = excluded.gravite
  returning * into v;
  if v.vues >= 2 and v.sms_le is null and p_gravite in ('grave', 'anomalie') and coalesce(v_num, '') <> '' then
    select f.* into v_float from floats f join terminaux t on t.id = f.terminal
     where f.operateur = v_op and f.actif order by t.vu_le desc nulls last, f.id limit 1;
    if found then
      insert into messages_sortants (terminal, operateur, numero, texte, cle, expire_le)
      values (v_float.terminal, v_op, v_num, left('Glisil PARITE : ' || p_message, 300), 'parite-' || v.id, now() + interval '1 hour')
      on conflict (cle) do nothing;
      update parite_alertes set sms_le = now() where id = v.id;
    end if;
  end if;
end $$;

create or replace function rapprocher() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_registre numeric; v_comptes numeric := circulation(); v_wallets numeric := circulation_chaine();
  v_chaine numeric; v_offre numeric; v_en_route numeric; v_retraits_vus numeric; v_ecart numeric;
  v_floats numeric; v_couverture numeric; v_statut text; v_anomalies int := 0; v_codes text[] := '{}';
  v_fraicheur interval := make_interval(hours => coalesce((parametre('parite') ->> 'fraicheur_heures')::int, 24));
  v_reseaux int; v_a_jour int; v_floats_detail jsonb; v_lignes jsonb; v_id bigint; l record; f record;
begin
  -- un seul relevé à la fois : deux appels croisés ne se contredisent pas
  perform pg_advisory_xact_lock(hashtext('rapprocher'));
  select coalesce(sum(case sens when 'emission' then montant when 'destruction' then -montant else 0 end), 0) into v_registre from emissions;

  -- LA CHAÎNE : la somme des mouvements relus, réseau par réseau configuré ; l'offre lue au contrat au même bloc
  select count(*), count(*) filter (where a_jour) into v_reseaux, v_a_jour from _jeton_publie();
  select coalesce(sum(case genre when 'frappe' then montant else -montant end), 0) into v_chaine from chaine_mouvements_jeton
   where reseau in (select reseau from _jeton_publie());
  select sum(offre) into v_offre from _jeton_publie() where a_jour;
  if v_reseaux = 0 or v_a_jour < v_reseaux then v_offre := null; end if;

  -- CE QUI EST EN ROUTE : attendu par le registre, pas encore lu sur la chaîne (une opération refusée n'est PAS en route)
  select coalesce(sum(case genre when 'frappe' then coalesce(montant, 0) else -coalesce(montant, 0) end), 0) into v_en_route
    from _parite_lignes() where verdict in ('en_route', 'en_retard') and nature <> 'retrait';
  -- un retrait est déjà frappé vers le client mais pas encore confirmé dans le registre : la destruction de la réserve suivra
  select coalesce(sum(p.montant_vu), 0) into v_retraits_vus from _parite_lignes() p
   where p.nature = 'retrait' and p.etat_registre = 'envoye' and p.tx_vu is not null;
  -- un retrait confirmé dont la frappe n'est pas encore relue : elle compte comme en route
  v_en_route := v_en_route + (select coalesce(sum(montant), 0) from _parite_lignes() where nature = 'retrait' and etat_registre = 'confirme' and verdict in ('en_route', 'en_retard'));
  v_ecart := case when v_offre is null then null else v_chaine + v_en_route - v_retraits_vus - v_registre end;

  -- LES FLOATS : le dernier solde annoncé de chaque float actif ; un seul inconnu ou trop vieux, et le total ne se dit pas
  select jsonb_agg(jsonb_build_object('id', x.id, 'operateur', x.operateur, 'numero', x.numero, 'solde', (x.s).solde,
                                      'annonce_le', (x.s).annonce_le, 'source', (x.s).source,
                                      'connu', (x.s).id is not null and (x.s).annonce_le > now() - v_fraicheur) order by x.id),
         case when bool_and((x.s).id is not null and (x.s).annonce_le > now() - v_fraicheur) then sum((x.s).solde) end
    into v_floats_detail, v_floats
    from (select fl.id, fl.operateur, fl.numero, _solde_float(fl.id) s from floats fl where fl.actif) x;
  v_couverture := v_floats - v_registre;

  -- LES ANOMALIES, une alerte chacune
  for l in select * from _parite_lignes() where verdict in ('en_retard', 'refusee', 'ecart', 'inconnue') loop
    v_anomalies := v_anomalies + 1;
    v_codes := v_codes || ('ligne:' || coalesce(l.reseau, '?') || ':' || coalesce(l.reference, l.tx_vu));
    perform _parite_alerter('ligne:' || coalesce(l.reseau, '?') || ':' || coalesce(l.reference, l.tx_vu),
      case l.verdict when 'inconnue' then 'grave' else 'anomalie' end,
      case l.verdict
        when 'inconnue' then format('%s de %s XAFe sur %s que le registre n''explique pas (tx %s)', l.genre, l.montant_vu, upper(l.reseau), l.tx_vu)
        when 'ecart' then format('%s : %s XAFe attendus, %s lus sur la chaîne', l.reference, l.montant, l.montant_vu)
        when 'refusee' then format('%s : %s de %s XAFe refusée par la chaîne', l.reference, l.genre, l.montant)
        else format('%s : %s de %s XAFe attendue depuis %s, absente de la chaîne', l.reference, l.genre, l.montant, to_char(l.depuis, 'DD/MM HH24:MI')) end,
      to_jsonb(l));
  end loop;
  if v_ecart is not null and v_ecart <> 0 then
    v_anomalies := v_anomalies + 1; v_codes := v_codes || 'ecart_chaine'::text;
    perform _parite_alerter('ecart_chaine', 'grave',
      format('chaîne %s + en route %s ≠ registre %s : écart de %s XAFe', v_chaine, v_en_route - v_retraits_vus, v_registre, v_ecart),
      jsonb_build_object('chaine', v_chaine, 'en_route', v_en_route, 'retraits_vus', v_retraits_vus, 'registre', v_registre, 'ecart', v_ecart));
  end if;
  -- la lecture : l'offre lue au contrat doit valoir la somme des mouvements relus, réseau par réseau
  for l in select j.reseau, j.offre, (select coalesce(sum(case genre when 'frappe' then montant else -montant end), 0)
                                        from chaine_mouvements_jeton m where m.reseau = j.reseau and m.bloc <= j.bloc) relu
             from _jeton_publie() j where j.a_jour loop
    if l.offre <> l.relu then
      v_anomalies := v_anomalies + 1; v_codes := v_codes || ('lecture:' || l.reseau);
      perform _parite_alerter('lecture:' || l.reseau, 'grave',
        format('%s : le contrat dit %s XAFe en circulation, les mouvements relus en font %s — la lecture a manqué quelque chose', upper(l.reseau), l.offre, l.relu),
        jsonb_build_object('offre', l.offre, 'relu', l.relu));
    end if;
  end loop;
  if v_couverture is not null and v_couverture < 0 then
    v_anomalies := v_anomalies + 1; v_codes := v_codes || 'couverture'::text;
    perform _parite_alerter('couverture', 'grave',
      format('les floats (%s XAF) ne couvrent pas ce qui est dû (%s XAFe) : il manque %s XAF', v_floats, v_registre, -v_couverture),
      jsonb_build_object('floats', v_floats, 'registre', v_registre));
  end if;
  -- ce qui empêche de conclure se dit aussi, sans crier : un float sans solde récent, une chaîne pas encore relue
  for f in select * from jsonb_to_recordset(coalesce(v_floats_detail, '[]'::jsonb)) as x(id int, operateur text, numero text, connu boolean, annonce_le timestamptz) where not x.connu loop
    v_codes := v_codes || ('float:' || f.id);
    perform _parite_alerter('float:' || f.id, 'attention',
      format('float %s %s : aucun solde annoncé depuis %s heures — TOTEM, une consultation USSD ou le relevé de l''opérateur', upper(f.operateur), f.numero,
             coalesce((parametre('parite') ->> 'fraicheur_heures'), '24')), to_jsonb(f));
  end loop;
  if v_offre is null then
    v_codes := v_codes || 'chaine_pas_a_jour'::text;
    perform _parite_alerter('chaine_pas_a_jour', 'attention', 'la lecture de la chaîne n''est pas encore à jour : l''écart ne se calcule pas encore', null);
  end if;
  -- ce qui n'est plus vrai se ferme
  update parite_alertes set close_le = now() where close_le is null and not (code = any (v_codes));

  v_statut := case when v_anomalies > 0 then 'ecart'
                   when v_offre is null or v_floats is null then 'incomplet'
                   when v_en_route <> 0 or v_retraits_vus <> 0 then 'en_cours'
                   else 'juste' end;
  select coalesce(jsonb_agg(jsonb_build_object('reseau', j.reseau, 'offre', j.offre, 'reserve', j.reserve, 'bloc', j.bloc, 'a_jour', j.a_jour, 'lu_le', j.lu_le)), '[]'::jsonb)
    into v_lignes from _jeton_publie() j;
  insert into parite_releves (registre, dans_comptes, sur_wallets, chaine, offre_lue, en_route, ecart, floats, couverture, anomalies, statut, detail)
  values (v_registre, v_comptes, v_wallets, case when v_offre is null then null else v_chaine end, v_offre, v_en_route - v_retraits_vus, v_ecart,
          v_floats, v_couverture, v_anomalies, v_statut, jsonb_build_object('reseaux', v_lignes, 'floats', coalesce(v_floats_detail, '[]'::jsonb)))
  returning id into v_id;
  -- l'historique se garde trente jours : de quoi montrer que c'était juste hier aussi
  delete from parite_releves where fait_le < now() - interval '30 days';
  return (select to_jsonb(p) from parite_releves p where p.id = v_id);
end $$;

-- ─────────────────── ce que voient l'équipe et tout le monde ─────────────────
create or replace function _parite_json(p_detail boolean) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'releve', (select to_jsonb(p) - 'detail' || jsonb_build_object('reseaux', p.detail -> 'reseaux',
                 'floats_detail', case when p_detail then p.detail -> 'floats'
                                when coalesce((parametre('parite') ->> 'publier_floats')::boolean, true)
                                then (select coalesce(jsonb_agg(jsonb_build_object('operateur', o, 'solde', s, 'annonce_le', d, 'connu', c)), '[]'::jsonb)
                                        from (select x ->> 'operateur' o, sum((x ->> 'solde')::numeric) s, min((x ->> 'annonce_le')::timestamptz) d, bool_and((x ->> 'connu')::boolean) c
                                                from jsonb_array_elements(p.detail -> 'floats') x group by 1) g) end)
                 from parite_releves p order by p.fait_le desc limit 1),
    'historique', (select coalesce(jsonb_agg(jsonb_build_object('fait_le', fait_le, 'statut', statut, 'registre', registre, 'chaine', chaine, 'ecart', ecart, 'floats', floats) order by fait_le), '[]'::jsonb)
                     from (select * from parite_releves where fait_le > now() - interval '7 days' and (extract(minute from fait_le)::int % 60) < 5 order by fait_le) h),
    'contrats', (select coalesce(jsonb_agg(jsonb_build_object('reseau', r, 'contrat', parametre('chaine') -> r ->> 'xafe', 'explorateur', _explorateur(r),
                                                       'reserve', (select etat ->> 'chaud' from chaine_etats e where e.reseau = r))), '[]'::jsonb)
                   from unnest(array['bep20', 'trc20']) r where jsonb_typeof(parametre('chaine') -> r) = 'object'),
    'essai', coalesce((parametre('chaine') ->> 'essai')::boolean, false),
    'lignes', (select coalesce(jsonb_agg(to_jsonb(l) - case when p_detail then '{}'::text[] else array['etat_registre', 'tx_attendu', 'adresse_vue'] end order by l.depuis desc), '[]'::jsonb)
                 from (select * from _parite_lignes() order by depuis desc limit case when p_detail then 500 else 100 end) l),
    'alertes', case when p_detail then (select coalesce(jsonb_agg(to_jsonb(a) order by a.ouverte_le desc), '[]'::jsonb)
                                          from parite_alertes a where a.close_le is null or a.close_le > now() - interval '7 days')
                    else (select count(*) from parite_alertes where close_le is null and gravite <> 'attention')::text::jsonb end)
$$;

-- La page publique : sans compte. Des totaux, des transactions publiques sur
-- la chaîne, des références de dossier — aucun nom, aucun numéro de client.
create or replace function preuve_de_reserve() returns jsonb
language sql stable security definer set search_path = public as $$
  select _parite_json(false)
$$;

create or replace function admin_parite() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('voir');
  return _parite_json(true) || jsonb_build_object(
    'reglages', parametre('parite'),
    'floats', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'operateur', f.operateur, 'numero', f.numero, 'titulaire', f.titulaire, 'actif', f.actif,
                                                     'dernier', to_jsonb(_solde_float(f.id)) - 'saisi_par') order by f.id), '[]'::jsonb) from floats f));
end $$;

create or replace function admin_rapprocher_maintenant() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('rapprocher');
  return rapprocher();
end $$;

-- Le tableau de bord compte aussi les alertes de parité ouvertes.
create or replace function admin_a_traiter() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('voir');
  return jsonb_build_object(
    'sorties_manuelles', (select count(*) from sorties where mode = 'manuel' and etat in ('en_attente', 'en_cours') and payee_le is null),
    'sorties_a_confirmer', (select count(*) from sorties where mode = 'manuel' and etat = 'en_cours' and payee_le is not null),
    'montant_a_payer', (select coalesce(sum(montant_xaf), 0) from sorties where mode = 'manuel' and etat in ('en_attente', 'en_cours') and payee_le is null),
    'sorties_non_expliquees', (select count(*) from sorties_constatees k
                                where not exists (select 1 from sorties s where s.operateur = k.operateur and s.transaction_id = k.transaction_id)),
    'parite', (select jsonb_build_object('statut', p.statut, 'ecart', p.ecart, 'couverture', p.couverture, 'fait_le', p.fait_le,
                                         'alertes', (select count(*) from parite_alertes where close_le is null and gravite <> 'attention'))
                 from parite_releves p order by p.fait_le desc limit 1));
end $$;

-- Le dépôt d'un client porte aussi l'empreinte et le lien de sa transaction.
create or replace function _trace_chaine(p_table text, p_source text) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('reseau', r.reseau, 'operation', r.operation, 'montant', r.montant,
                                               'reference', r.reference, 'etat', r.etat, 'tx_hash', r.tx_hash, 'bloc', r.bloc,
                                               'essai', coalesce((parametre('chaine') ->> 'essai')::boolean, false),
                                               'contrat', parametre('chaine') -> r.reseau ->> 'xafe',
                                               'reserve', (select etat ->> 'chaud' from chaine_etats e where e.reseau = r.reseau),
                                               'explorateur', _explorateur(r.reseau),
                                               'empreinte', (select e.empreinte from chaine_empreintes e where e.reference = r.reference limit 1),
                                               'relue', exists (select 1 from chaine_mouvements_jeton m where m.reseau = r.reseau and m.tx_hash = r.tx_hash),
                                               'confirme_le', r.traite_le) order by r.id), '[]'::jsonb)
    from reserve_chaine r where r.source_table = p_table and r.source_id = p_source
$$;

-- ─────────────────── le paramètre « parite », modifiable par l'équipe ────────
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

-- ─────────────────── les relevés des opérateurs, déposés ─────────────────────
-- Le stockage « releves-floats » : privé, images et PDF de 10 Mo au plus. Seule
-- l'équipe qui rapproche dépose ; toute l'équipe relit.
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name) values ('releves-floats', 'releves-floats') on conflict (id) do nothing;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public') then
    execute $p$update storage.buckets set public = false where id = 'releves-floats'$p$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $p$update storage.buckets set file_size_limit = 10485760,
                 allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] where id = 'releves-floats'$p$;
  end if;
  execute $p$drop policy if exists releves_floats_deposer on storage.objects$p$;
  execute $p$drop policy if exists releves_floats_relire on storage.objects$p$;
  execute $p$create policy releves_floats_deposer on storage.objects for insert to authenticated
            with check (bucket_id = 'releves-floats' and public.admin_a_droit('rapprocher'))$p$;
  execute $p$create policy releves_floats_relire on storage.objects for select to authenticated
            using (bucket_id = 'releves-floats' and public.admin_a_droit('voir'))$p$;
end $$;

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on table soldes_floats, chaine_empreintes, chaine_mouvements_jeton, parite_releves, parite_alertes from public, anon, authenticated;
grant all on table soldes_floats, chaine_empreintes, chaine_mouvements_jeton, parite_releves, parite_alertes to service_role;
revoke all on function _solde_float(int), totem_solde_float(text, text, text, numeric, timestamptz, text, bigint),
                       admin_saisir_releve(int, numeric, timestamptz, text, text),
                       chaine_references_sans_empreinte(int), chaine_noter_empreintes(jsonb), chaine_noter_mouvements(text, bigint, jsonb),
                       _explorateur(text), _parite_lignes(), _jeton_publie(), _parite_alerter(text, text, text, jsonb), rapprocher(),
                       _parite_json(boolean), preuve_de_reserve(), admin_parite(), admin_rapprocher_maintenant()
  from public, anon, authenticated;
grant execute on function totem_solde_float(text, text, text, numeric, timestamptz, text, bigint),
                          chaine_references_sans_empreinte(int), chaine_noter_empreintes(jsonb), chaine_noter_mouvements(text, bigint, jsonb),
                          rapprocher() to service_role;
grant execute on function admin_saisir_releve(int, numeric, timestamptz, text, text), admin_parite(), admin_rapprocher_maintenant() to authenticated;
-- la preuve est publique : n'importe qui, sans compte
grant execute on function preuve_de_reserve() to anon, authenticated;

-- ─────────────────── toutes les cinq minutes, tout seul ──────────────────────
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron absent : rapprocher() ne sera pas planifiée sur cette base';
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'glisil-rapprocher';
  perform cron.schedule('glisil-rapprocher', '*/5 * * * *', 'select public.rapprocher()');
end $$;
