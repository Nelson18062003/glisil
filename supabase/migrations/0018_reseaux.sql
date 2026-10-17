-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0018 · le registre des réseaux                               ║
-- ║                                                                        ║
-- ║  Un client a UN solde de XAFe (et un d'USDT) ; le réseau ne se choisit ║
-- ║  qu'au moment de déposer ou de retirer — comme chez Binance. La        ║
-- ║  réserve vit sur un réseau MAISON (BSC) ; un retrait sur un autre      ║
-- ║  réseau y crée les XAFe et les détruit dans la réserve (0015), à la    ║
-- ║  façon du « burn and mint » de Circle (CCTP). La somme, tous réseaux   ║
-- ║  ensemble, est ce que la parité compare au registre (0016).            ║
-- ║                                                                        ║
-- ║  Ce qui manquait : la LISTE des réseaux. BEP20 et TRC20 étaient écrits ║
-- ║  en dur à douze endroits (contraintes, retrait, explorateur, parité,   ║
-- ║  tâches du veilleur). Ils vivent maintenant dans une table, avec ce    ║
-- ║  qu'il faut savoir de chacun : sa famille (EVM, Tron, Solana), son     ║
-- ║  explorateur, sa monnaie de frais, son compte de dérivation.           ║
-- ║                                                                        ║
-- ║  Ethereum, Base et Polygon y sont, FERMÉS : la famille EVM sait déjà   ║
-- ║  les lire ; il reste à y déployer le contrat XAFe, à poser leur nœud,  ║
-- ║  puis à les ouvrir. Solana y est aussi, fermé — et ne peut pas         ║
-- ║  s'ouvrir : aucun veilleur ne sait encore le lire.                     ║
-- ║  Le plan complet : docs/RESEAUX.md.                                     ║
-- ╚════════════════════════════════════════════════════════════════════════╝

create table if not exists reseaux (
  id                text primary key check (id ~ '^[a-z][a-z0-9]{1,11}$'),
  nom               text not null,                 -- « BNB Smart Chain »
  norme             text not null,                 -- ce que le client lit sur son wallet : « BEP20 »
  famille           text not null check (famille in ('evm', 'tron', 'solana')),
  chain_id          bigint,                        -- EVM : le numéro de la chaîne (56, 1, 8453…)
  -- Le compte de dérivation (m/44'/60'/<compte>'/0/i pour l'EVM) : deux réseaux
  -- d'une même famille n'ont JAMAIS les mêmes adresses de dépôt. Une adresse
  -- vit sur un réseau ; un envoi par erreur sur un autre réseau EVM arrive à
  -- une adresse que la graine contrôle encore, et se récupère à la main.
  compte_hd         int not null check (compte_hd between 0 and 1000),
  natif             text not null,                 -- la monnaie qui paie les frais : BNB, TRX, ETH…
  decimales_natif   int not null check (decimales_natif between 0 and 30),
  explorateur       text not null check (explorateur ~ '^https://'),
  explorateur_essai text check (explorateur_essai ~ '^https://'),
  -- ouvert aux clients : on y dépose, on y retire. Un réseau fermé garde son
  -- veilleur s'il est configuré : les retraits déjà demandés partent, et ce
  -- qui arrive encore sur une adresse attribuée est crédité.
  actif             boolean not null default false,
  ordre             int not null,
  note              text,
  unique (famille, compte_hd)
);
alter table reseaux enable row level security;

insert into reseaux (id, nom, norme, famille, chain_id, compte_hd, natif, decimales_natif, explorateur, explorateur_essai, actif, ordre, note) values
  ('bep20',   'BNB Smart Chain', 'BEP20',   'evm',    56,   0, 'BNB', 18, 'https://bscscan.com',     'https://testnet.bscscan.com', true,  1, 'le réseau maison : la réserve y vit'),
  ('trc20',   'Tron',            'TRC20',   'tron',   null, 0, 'TRX',  6, 'https://tronscan.org/#',  'https://nile.tronscan.org/#', true,  2, null),
  ('erc20',   'Ethereum',        'ERC20',   'evm',    1,    1, 'ETH', 18, 'https://etherscan.io',    'https://sepolia.etherscan.io', false, 3, 'frais de réseau élevés : à ouvrir pour les gros montants seulement'),
  ('base',    'Base',            'Base',    'evm',    8453, 2, 'ETH', 18, 'https://basescan.org',    'https://sepolia.basescan.org', false, 4, null),
  ('polygon', 'Polygon',         'Polygon', 'evm',    137,  3, 'POL', 18, 'https://polygonscan.com', 'https://amoy.polygonscan.com', false, 5, null),
  ('solana',  'Solana',          'SPL',     'solana', null, 0, 'SOL',  9, 'https://solscan.io',      null,                          false, 6, 'pas encore de veilleur : un adaptateur Solana est à écrire')
on conflict (id) do nothing;

-- ─────────────── les contraintes : la table, au lieu d'une liste ───────────
-- Une clé étrangère : un réseau inconnu du registre n'entre nulle part.
alter table adresses_crypto         drop constraint if exists adresses_crypto_reseau_check;
alter table adresses_libres         drop constraint if exists adresses_libres_reseau_check;
alter table retraits_crypto         drop constraint if exists retraits_crypto_reseau_check;
alter table reserve_chaine          drop constraint if exists reserve_chaine_reseau_check;
alter table chaine_mouvements_jeton drop constraint if exists chaine_mouvements_jeton_reseau_check;
do $$
declare t text;
begin
  foreach t in array array['adresses_crypto', 'adresses_libres', 'retraits_crypto', 'reserve_chaine', 'chaine_mouvements_jeton'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_reseau_fkey') then
      execute format('alter table %I add constraint %I foreign key (reseau) references reseaux (id)', t, t || '_reseau_fkey');
    end if;
  end loop;
end $$;

-- ───────────────────────────── ce qu'on en lit ─────────────────────────────
-- Configuré : le contrat XAFe et le nœud du réseau sont posés (paramètre
-- « chaine », par la mise en service). Lisible : un veilleur sait le lire.
create or replace function _reseau_configure(p_id text) returns boolean
language sql stable set search_path = public as $$
  select jsonb_typeof(parametre('chaine') -> p_id) = 'object'
     and coalesce(parametre('chaine') -> p_id ->> 'xafe', '') <> ''
$$;

create or replace function _reseau_lisible(p_famille text) returns boolean
language sql immutable set search_path = public as $$ select p_famille in ('evm', 'tron') $$;

-- Une adresse a la forme de sa FAMILLE : 0x + 40 hexadécimaux pour l'EVM, T +
-- 33 signes base58 pour Tron, 32 à 44 signes base58 pour Solana.
create or replace function _adresse_valide(p_famille text, p_adresse text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(case p_famille
    when 'evm'    then p_adresse ~ '^0x[0-9a-fA-F]{40}$'
    when 'tron'   then p_adresse ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'
    when 'solana' then p_adresse ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  end, false)
$$;

-- Le réseau d'un client : ouvert. (Ne s'ouvre que configuré et lisible :
-- admin_activer_reseau le vérifie.) Sinon : la phrase qu'il lira.
create or replace function _reseau_ouvert(p_id text) returns reseaux
language plpgsql stable set search_path = public as $$
declare r reseaux;
begin
  select * into r from reseaux where id = p_id;
  if not found then raise exception 'réseau inconnu'; end if;
  if not r.actif then
    raise exception 'réseau pas encore ouvert' using detail = format('%s (%s) n''est pas encore ouvert sur Glisil', r.nom, r.norme);
  end if;
  return r;
end $$;

create or replace function _explorateur(p_reseau text) returns text
language sql stable set search_path = public as $$
  select case when coalesce((parametre('chaine') ->> 'essai')::boolean, false) then coalesce(explorateur_essai, explorateur) else explorateur end
    from reseaux where id = p_reseau
$$;

-- ───────────────────────── l'adresse de dépôt ──────────────────────────────
create or replace function adresse_depot(p_actif text, p_reseau text) returns text
language plpgsql security definer set search_path = public as $$
declare v_compte uuid := auth.uid(); v_adresse text; v_libre adresses_libres;
begin
  perform _exiger_compte_actif(v_compte);
  -- fermé : aucune adresse ne se montre — pas même celle déjà attribuée, sur laquelle de vrais USDT n'arriveraient nulle part
  if not coalesce((parametre('crypto') ->> 'depots_ouverts')::boolean, true) then return null; end if;
  -- un réseau fermé ne montre pas d'adresse non plus : un envoi n'y serait pas attendu
  if not exists (select 1 from reseaux where id = p_reseau and actif) then return null; end if;
  perform 1 from comptes where id = v_compte for no key update;
  select adresse into v_adresse from adresses_crypto where compte_id = v_compte and actif = p_actif and reseau = p_reseau;
  if found then return v_adresse; end if;
  select * into v_libre from adresses_libres where actif = p_actif and reseau = p_reseau order by id for update skip locked limit 1;
  if not found then return null; end if;
  delete from adresses_libres where id = v_libre.id;
  insert into adresses_crypto (compte_id, actif, reseau, adresse, indice) values (v_compte, p_actif, p_reseau, v_libre.adresse, v_libre.indice)
  on conflict (compte_id, actif, reseau) do update set adresse = adresses_crypto.adresse
  returning adresse into v_adresse;
  return v_adresse;
end $$;

-- ───────────────────────────── le retrait ──────────────────────────────────
-- Le même retrait qu'en 0002 ; seul le contrôle du réseau change : le
-- registre au lieu d'une liste, la forme de l'adresse d'après sa famille.
create or replace function demander_retrait_crypto(p_actif text, p_reseau text, p_adresse text, p_montant numeric, p_cle text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_compte uuid := auth.uid();
  v        jsonb;
  v_r      retraits_crypto;
  v_res    reseaux;
  v_frais  numeric;
  v_palier jsonb;
  v_cours  numeric;
  v_xaf    numeric;
begin
  perform _exiger_compte_actif(v_compte);
  if p_cle is not null then
    select * into v_r from retraits_crypto where compte_id = v_compte and cle = p_cle;
    if found then return _retrait_json(v_r) || '{"deja": true}'; end if;
  end if;
  if not coalesce((parametre('crypto') ->> 'retraits_ouverts')::boolean, false) then
    raise exception 'retraits crypto pas encore ouverts' using detail = 'l''envoi sur la chaîne arrive bientôt ; vos fonds restent disponibles';
  end if;
  if p_actif not in ('XAFe', 'USDT') then raise exception 'actif inconnu'; end if;
  v_res := _reseau_ouvert(p_reseau);
  if not _adresse_valide(v_res.famille, p_adresse) then
    raise exception 'adresse invalide' using detail = format('ce n''est pas une adresse %s (%s)', v_res.norme, v_res.nom);
  end if;
  if p_montant is null or p_montant <= 0 or p_montant <> round(p_montant, case p_actif when 'USDT' then 2 else 0 end) then
    raise exception 'montant invalide';
  end if;
  v := _controler_code(v_compte, p_code);
  if not (v ->> 'ok')::boolean then return v; end if;
  v_frais := (parametre('crypto') -> 'frais' ->> p_actif)::numeric;

  perform 1 from comptes where id = v_compte for no key update;
  v_palier := parametre('paliers') -> (select palier::text from comptes where id = v_compte);
  if v_palier is not null and v_palier <> 'null'::jsonb then
    if p_actif = 'USDT' then
      v_cours := (select prix from executions order by cree_le desc, id desc limit 1);
      if v_cours is null then raise exception 'pas de cours de référence' using detail = 'le plafond du palier se compte en XAF'; end if;
      v_xaf := (p_montant + v_frais) * v_cours;
    else
      v_xaf := p_montant + v_frais;
    end if;
    if _sorties_du_jour(v_compte) + v_xaf > (v_palier ->> 'sortie_jour')::numeric then
      raise exception 'plafond du palier atteint' using detail = format('%s XAF par jour, retraits crypto compris', v_palier ->> 'sortie_jour');
    end if;
  end if;
  insert into retraits_crypto (reference, compte_id, actif, reseau, adresse, montant, frais, cle)
  values ('XAFe-CR-' || lpad(nextval('retraits_crypto_numero')::text, 6, '0'), v_compte, p_actif, p_reseau, p_adresse, p_montant, v_frais, p_cle)
  returning * into v_r;
  perform _mouvement(v_compte, p_actif, -(p_montant + v_frais), p_montant + v_frais, 'retrait_crypto_bloque', 'retraits_crypto', v_r.reference);
  return _retrait_json(v_r);
end $$;

-- ─────────────────── la liste que l'écran du client lit ────────────────────
create or replace function _reseaux_publics() returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'norme', norme, 'famille', famille, 'natif', natif,
                                               'explorateur', _explorateur(id), 'maison', id = _reseau_de_la_reserve(),
                                               'confirmations', coalesce((parametre('crypto') -> 'confirmations' ->> id)::int,
                                                                         (parametre('chaine') -> id ->> 'confirmations')::int))
                            order by ordre), '[]'::jsonb)
    from reseaux where actif
$$;

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
                                 -- les réseaux ouverts, dans l'ordre où l'écran les propose
                                 'reseaux', _reseaux_publics()),
    'sortie', jsonb_build_object('ouvertes', coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true),
                                 'mode', coalesce(parametre('sortie') ->> 'mode', 'totem')),
    'operateurs', (select jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'plafond_par_transfert', plafond_par_transfert,
                                                       'plafond_jour', plafond_jour) order by id) from operateurs),
    'conditions', parametre('conditions'),
    'support', parametre('support'))
   where auth.uid() is not null
$$;

-- ─────────────────────── ce que le veilleur reçoit ─────────────────────────
-- Les deux clés d'avant (bep20, trc20) restent, pour un veilleur pas encore
-- mis à jour ; « reseaux » porte chaque réseau configuré, avec sa famille et
-- son compte de dérivation.
create or replace function chaine_configuration() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := parametre('chaine'); v_essai boolean; v_secrets jsonb := '{}'::jsonb;
begin
  v_essai := coalesce((v ->> 'essai')::boolean, false);
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb) from vault.decrypted_secrets
                where name in ('veilleur_jeton', 'essai_graine', 'essai_admin_cle')$q$ into v_secrets;
  end if;
  return jsonb_build_object(
    'essai', v_essai,
    'bep20', v -> 'bep20',
    'trc20', v -> 'trc20',
    'reseaux', (select coalesce(jsonb_object_agg(r.id, (v -> r.id) || jsonb_build_object('famille', r.famille, 'compte_hd', r.compte_hd,
                                                                                          'natif', r.natif, 'decimales_natif', r.decimales_natif,
                                                                                          'chain_id', r.chain_id)), '{}'::jsonb)
                  from reseaux r where _reseau_configure(r.id) and _reseau_lisible(r.famille)),
    'jeton', v_secrets ->> 'veilleur_jeton',
    -- jamais hors d'un réseau d'essai : en production la graine n'est pas dans la base
    'graine', case when v_essai then v_secrets ->> 'essai_graine' end,
    'admin_cle_essai', case when v_essai then v_secrets ->> 'essai_admin_cle' end);
end $$;

-- ───────────── un réveil par réseau configuré, et rien de plus ─────────────
-- Les tâches de pg_cron suivent le registre : un réseau configuré qu'un
-- veilleur sait lire a sa tâche ; une tâche dont le réseau n'est plus là
-- s'en va. Rejouée quand le paramètre « chaine » change (le déclencheur plus
-- bas) : configurer Base suffit à le faire veiller.
create or replace function planifier_veilleurs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_voulus text[]; v_id text;
begin
  select coalesce(array_agg(id order by ordre), '{}') into v_voulus from reseaux where _reseau_configure(id) and _reseau_lisible(famille);
  if to_regnamespace('cron') is null then return jsonb_build_object('planifie', false, 'reseaux', to_jsonb(v_voulus)); end if;
  execute $q$select cron.unschedule(jobid) from cron.job where jobname like 'xafe-veilleur-%' and substr(jobname, 15) <> all($1)$q$ using v_voulus;
  foreach v_id in array v_voulus loop
    execute $q$select cron.schedule($1, '* * * * *', format('select public.reveiller_veilleur(%L)', $2))$q$ using 'xafe-veilleur-' || v_id, v_id;
  end loop;
  return jsonb_build_object('planifie', true, 'reseaux', to_jsonb(v_voulus));
end $$;

create or replace function _replanifier_veilleurs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform planifier_veilleurs();
  return null;
end $$;
drop trigger if exists parametres_chaine_replanifie on parametres;
create trigger parametres_chaine_replanifie after insert or update of valeur on parametres
  for each row when (new.cle = 'chaine') execute function _replanifier_veilleurs();

select planifier_veilleurs();

-- ──────────────────────── ce que l'équipe en voit ──────────────────────────
create or replace function admin_reseaux() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('voir');
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'nom', r.nom, 'norme', r.norme, 'famille', r.famille, 'chain_id', r.chain_id, 'natif', r.natif,
      'actif', r.actif, 'maison', r.id = _reseau_de_la_reserve(), 'configure', _reseau_configure(r.id),
      'lisible', _reseau_lisible(r.famille), 'explorateur', _explorateur(r.id), 'contrat', parametre('chaine') -> r.id ->> 'xafe',
      'note', r.note,
      'adresses_attribuees', (select count(*) from adresses_crypto a where a.reseau = r.id),
      'retraits_en_cours', (select count(*) from retraits_crypto x where x.reseau = r.id and x.etat in ('en_attente', 'en_cours'))) order by r.ordre), '[]'::jsonb)
    from reseaux r);
end $$;

-- Ouvrir ou fermer un réseau aux clients. Ouvrir exige qu'un veilleur sache
-- le lire ET que le contrat XAFe y soit posé : sinon le client verrait une
-- adresse sur laquelle rien n'arriverait. Fermer le réseau maison est refusé :
-- la réserve y vit.
create or replace function admin_activer_reseau(p_id text, p_actif boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r reseaux;
begin
  perform _exiger_droit('parametres');
  select * into r from reseaux where id = p_id for update;
  if not found then raise exception 'réseau inconnu'; end if;
  if p_actif is null then raise exception 'ouvrir ou fermer ?'; end if;
  if p_actif and not _reseau_lisible(r.famille) then
    raise exception 'réseau pas encore lisible' using detail = format('aucun veilleur ne sait encore lire %s : un adaptateur est à écrire (docs/RESEAUX.md)', r.nom);
  end if;
  if p_actif and not _reseau_configure(r.id) then
    raise exception 'réseau pas configuré' using detail = format('déployez d''abord le contrat XAFe sur %s et posez-le dans « chaine » (mise en service)', r.nom);
  end if;
  if not p_actif and r.id = _reseau_de_la_reserve() then
    raise exception 'le réseau maison ne se ferme pas' using detail = 'la réserve de XAFe y vit';
  end if;
  update reseaux set actif = p_actif where id = r.id;
  perform _journaliser(case when p_actif then 'ouvrir_reseau' else 'fermer_reseau' end, r.id);
  return jsonb_build_object('ok', true, 'id', r.id, 'actif', p_actif);
end $$;

-- ─────────────── la parité et les wallets : tous les réseaux ───────────────
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
    -- chaque réseau où le contrat XAFe est posé : c'est leur SOMME qui se compare au registre
    'contrats', (select coalesce(jsonb_agg(jsonb_build_object('reseau', r.id, 'nom', r.nom, 'contrat', parametre('chaine') -> r.id ->> 'xafe', 'explorateur', _explorateur(r.id),
                                                       'maison', r.id = _reseau_de_la_reserve(),
                                                       'reserve', (select etat ->> 'chaud' from chaine_etats e where e.reseau = r.id)) order by r.ordre), '[]'::jsonb)
                   from reseaux r where _reseau_configure(r.id)),
    'essai', coalesce((parametre('chaine') ->> 'essai')::boolean, false),
    'lignes', (select coalesce(jsonb_agg(to_jsonb(l) - case when p_detail then '{}'::text[] else array['etat_registre', 'tx_attendu', 'adresse_vue'] end order by l.depuis desc), '[]'::jsonb)
                 from (select * from _parite_lignes() order by depuis desc limit case when p_detail then 500 else 100 end) l),
    'alertes', case when p_detail then (select coalesce(jsonb_agg(to_jsonb(a) order by a.ouverte_le desc), '[]'::jsonb)
                                          from parite_alertes a where a.close_le is null or a.close_le > now() - interval '7 days')
                    else (select count(*) from parite_alertes where close_le is null and gravite <> 'attention')::text::jsonb end)
$$;

create or replace function admin_wallets() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('voir');
  select jsonb_build_object(
    'reseaux', coalesce((select jsonb_agg(jsonb_build_object(
        'reseau', n.id, 'nom', n.nom, 'actif', n.actif,
        'etat', e.etat, 'maj_le', e.maj_le,
        'muet', e.maj_le is null or e.maj_le < now() - interval '2 minutes',
        'adresses_attribuees', (select count(*) from adresses_crypto a where a.reseau = n.id),
        'adresses_libres', (select count(*) from adresses_libres l where l.reseau = n.id),
        'retraits_en_cours', (select count(*) from retraits_crypto x where x.reseau = n.id and x.etat in ('en_attente', 'en_cours')),
        'retraits_remplaces', (select count(*) from retraits_crypto x where x.reseau = n.id and cardinality(x.tx_remplacees) > 0),
        'curseur', (select bloc from chaine_curseurs c where c.reseau = n.id)) order by n.ordre)
      -- les réseaux qui veillent ou que les clients voient ; les autres n'ont rien à montrer
      from reseaux n left join chaine_etats e on e.reseau = n.id
     where n.actif or _reseau_configure(n.id)), '[]'::jsonb),
    'orphelins', coalesce((select jsonb_agg(jsonb_build_object('reseau', o.reseau, 'actif', o.actif, 'adresse', o.adresse, 'montant', o.montant, 'preuve', o.preuve, 'raison', o.raison, 'vu_le', o.vu_le) order by o.vu_le desc)
                             from chaine_orphelins o), '[]'::jsonb),
    'du_usdt', (select coalesce(sum(disponible + bloque), 0) from soldes where actif = 'USDT' and compte_id <> compte_maison()),
    'maison_usdt', (select coalesce(sum(disponible + bloque), 0) from soldes where actif = 'USDT' and compte_id = compte_maison()))
    into r;
  return r;
end $$;

-- La réserve ne s'installe que sur un réseau du registre qu'un veilleur sait lire.
create or replace function _reseau_de_la_reserve() returns text
language sql stable set search_path = public as $$
  select coalesce((select id from reseaux where id = parametre('chaine') ->> 'reserve' and _reseau_lisible(famille)), 'bep20')
$$;

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on table reseaux from public, anon, authenticated;
grant all on table reseaux to service_role;
revoke all on function _reseau_configure(text), _reseau_lisible(text), _adresse_valide(text, text), _reseau_ouvert(text),
  _reseaux_publics(), planifier_veilleurs(), _replanifier_veilleurs(), admin_reseaux(), admin_activer_reseau(text, boolean)
  from public, anon, authenticated;
grant execute on function admin_reseaux(), admin_activer_reseau(text, boolean) to authenticated;
grant execute on function planifier_veilleurs() to service_role;
