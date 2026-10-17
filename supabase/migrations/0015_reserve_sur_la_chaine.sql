-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0015 · chaque XAFe, aussi sur la chaîne                      ║
-- ║                                                                        ║
-- ║  Jusqu'ici, un XAFe n'existait sur la chaîne que lorsqu'un client le   ║
-- ║  sortait vers son wallet. Un dépôt MoMo n'y laissait aucune trace.     ║
-- ║                                                                        ║
-- ║  Maintenant, la RÉSERVE de Glisil — le wallet chaud du réseau choisi   ║
-- ║  (BNB Smart Chain) — tient sur la chaîne exactement les XAFe des       ║
-- ║  comptes Glisil. Chaque ligne d'`emissions` devient une transaction :  ║
-- ║    emission       (un dépôt crédité)        → frapper dans la réserve ║
-- ║    depuis_chaine  (des XAFe revenus, détruits chez le client)          ║
-- ║                                             → frapper dans la réserve ║
-- ║    destruction    (des XAF payés en sortie) → détruire dans la réserve║
-- ║    vers_chaine    (des XAFe frappés vers le wallet d'un client)        ║
-- ║                                             → détruire dans la réserve║
-- ║  Ainsi l'offre totale du jeton, sur les deux chaînes, vaut toujours    ║
-- ║  ce que Glisil doit à ses clients, et chacun peut le vérifier.         ║
-- ║                                                                        ║
-- ║  La référence d'une frappe est celle du mouvement (XAFe-DP-000003) :   ║
-- ║  le contrat garde son empreinte keccak256, et une empreinte ne sert    ║
-- ║  qu'une fois. Un même dossier crédité en deux fois prend un suffixe    ║
-- ║  (XAFe-DP-000003#12) à partir du second.                               ║
-- ╚════════════════════════════════════════════════════════════════════════╝

create table if not exists reserve_chaine (
  id           bigint generated always as identity primary key,
  emission_id  bigint not null unique references emissions(id),
  reseau       text not null default 'bep20' check (reseau in ('bep20', 'trc20')),
  operation    text not null check (operation in ('frapper', 'detruire')),
  montant      numeric(20,2) not null check (montant > 0),
  reference    text not null unique,            -- ce que l'empreinte keccak256 scelle sur la chaîne
  source_table text,
  source_id    text,
  etat         text not null default 'a_faire' check (etat in ('a_faire', 'envoye', 'confirme', 'echoue')),
  tx_hash      text,
  tx_brut      text,
  bloc         bigint,
  resultat     text,
  cree_le      timestamptz not null default now(),
  traite_le    timestamptz
);
create index if not exists reserve_chaine_a_faire on reserve_chaine (reseau, id) where etat in ('a_faire', 'envoye');
create index if not exists reserve_chaine_source on reserve_chaine (source_table, source_id);
alter table reserve_chaine enable row level security;

-- Le réseau qui porte la réserve : un seul, sinon le même franc serait compté deux fois.
create or replace function _reseau_de_la_reserve() returns text
language sql stable set search_path = public as $$
  select coalesce(parametre('chaine') ->> 'reserve', 'bep20')
$$;

-- Chaque ligne d'emissions devient une ligne à jouer sur la chaîne, dans la même transaction.
create or replace function _vers_la_reserve() returns trigger
language plpgsql set search_path = public as $$
declare v_ref text := coalesce(new.source_id, new.sens || '-' || new.id);
begin
  if exists (select 1 from reserve_chaine where reference = v_ref) then v_ref := v_ref || '#' || new.id; end if;
  insert into reserve_chaine (emission_id, reseau, operation, montant, reference, source_table, source_id)
  values (new.id, _reseau_de_la_reserve(),
          case when new.sens in ('emission', 'depuis_chaine') then 'frapper' else 'detruire' end,
          new.montant, v_ref, new.source_table, new.source_id)
  on conflict (emission_id) do nothing;
  return new;
end $$;

drop trigger if exists emissions_vers_la_reserve on emissions;
create trigger emissions_vers_la_reserve after insert on emissions
  for each row execute function _vers_la_reserve();

-- Ce qui existait avant cette migration se joue aussi : la réserve part de zéro et rattrape tout, dans l'ordre.
do $$
declare e emissions;
begin
  for e in select * from emissions where id not in (select emission_id from reserve_chaine) order by id loop
    insert into reserve_chaine (emission_id, reseau, operation, montant, reference, source_table, source_id)
    values (e.id, _reseau_de_la_reserve(),
            case when e.sens in ('emission', 'depuis_chaine') then 'frapper' else 'detruire' end,
            e.montant,
            case when exists (select 1 from reserve_chaine r where r.reference = coalesce(e.source_id, e.sens || '-' || e.id))
                 then coalesce(e.source_id, e.sens || '-' || e.id) || '#' || e.id else coalesce(e.source_id, e.sens || '-' || e.id) end,
            e.source_table, e.source_id);
  end loop;
end $$;

-- ───────────────────────────── le veilleur ─────────────────────────────────
-- Les opérations à jouer, DANS L'ORDRE : une destruction ne passe jamais
-- avant la frappe qui l'a rendue possible. Une ligne envoyée et pas encore
-- confirmée arrête la file (le veilleur la suit, puis continue).
create or replace function chaine_reserve_a_jouer(p_reseau text, p_n int default 20)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'operation', operation, 'montant', montant, 'reference', reference,
                                               'etat', etat, 'tx_hash', tx_hash, 'tx_brut', tx_brut) order by id), '[]'::jsonb)
    from (select * from reserve_chaine where reseau = p_reseau and etat in ('a_faire', 'envoye') order by id limit greatest(1, least(p_n, 100))) r
$$;

-- Noté AVANT d'être diffusé : après une coupure, c'est cette transaction-là qui repart.
create or replace function chaine_reserve_marquer_envoi(p_id bigint, p_tx_hash text, p_brut text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update reserve_chaine set etat = 'envoye', tx_hash = p_tx_hash, tx_brut = p_brut
   where id = p_id and etat in ('a_faire', 'envoye');
  if not found then raise exception 'opération de réserve inconnue ou close'; end if;
end $$;

create or replace function chaine_reserve_resultat(p_id bigint, p_ok boolean, p_bloc bigint, p_resultat text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update reserve_chaine set etat = case when p_ok then 'confirme' else 'echoue' end, bloc = p_bloc,
                            resultat = p_resultat, traite_le = now()
   where id = p_id and etat = 'envoye';
  if not found then raise exception 'opération de réserve pas en cours'; end if;
end $$;

-- Une opération refusée par la chaîne (plafond du jour atteint, pause) se rejoue à la main, par l'équipe.
create or replace function admin_reserve_rejouer(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('sorties');
  update reserve_chaine set etat = 'a_faire', tx_hash = null, tx_brut = null, resultat = null where id = p_id and etat = 'echoue';
  if not found then raise exception 'seule une opération refusée se rejoue'; end if;
  perform _journaliser('rejouer_reserve', p_id::text);
  return jsonb_build_object('ok', true);
end $$;

-- L'état de la réserve pour l'équipe : ce que la base attend sur la chaîne, et ce qui reste à jouer.
create or replace function admin_reserve() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('voir');
  return jsonb_build_object(
    'reseau', _reseau_de_la_reserve(),
    'attendu', circulation(),
    'confirme', (select coalesce(sum(case operation when 'frapper' then montant else -montant end), 0) from reserve_chaine where etat = 'confirme'),
    'en_attente', (select count(*) from reserve_chaine where etat in ('a_faire', 'envoye')),
    'refusees', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'operation', operation, 'montant', montant, 'reference', reference, 'resultat', resultat) order by id), '[]'::jsonb)
                   from reserve_chaine where etat = 'echoue'));
end $$;

-- ───────────────────────────── ce que voit le client ───────────────────────
-- Un dépôt porte maintenant sa trace sur la chaîne : réseau, transaction, bloc, référence scellée.
create or replace function _trace_chaine(p_table text, p_source text) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('reseau', r.reseau, 'operation', r.operation, 'montant', r.montant,
                                               'reference', r.reference, 'etat', r.etat, 'tx_hash', r.tx_hash, 'bloc', r.bloc,
                                               'essai', coalesce((parametre('chaine') ->> 'essai')::boolean, false),
                                               'contrat', parametre('chaine') -> r.reseau ->> 'xafe',
                                               'reserve', (select etat ->> 'chaud' from chaine_etats e where e.reseau = r.reseau),
                                               'confirme_le', r.traite_le) order by r.id), '[]'::jsonb)
    from reserve_chaine r where r.source_table = p_table and r.source_id = p_source
$$;

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
    'chaine', _trace_chaine('depots', d.reference),
    'cree_le', d.cree_le, 'expire_le', d.expire_le, 'credite_le', d.credite_le)
    from (select 1) _ left join floats f on f.id = d.float_id left join terminaux t on t.id = f.terminal
$$;

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on table reserve_chaine from public, anon, authenticated;
grant all on table reserve_chaine to service_role;
revoke all on function _reseau_de_la_reserve(), _vers_la_reserve(), _trace_chaine(text, text),
                       chaine_reserve_a_jouer(text, int), chaine_reserve_marquer_envoi(bigint, text, text),
                       chaine_reserve_resultat(bigint, boolean, bigint, text), admin_reserve_rejouer(bigint), admin_reserve()
  from public, anon, authenticated;
grant execute on function chaine_reserve_a_jouer(text, int), chaine_reserve_marquer_envoi(bigint, text, text),
                          chaine_reserve_resultat(bigint, boolean, bigint, text) to service_role;
grant execute on function admin_reserve_rejouer(bigint), admin_reserve() to authenticated;
