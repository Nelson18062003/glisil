-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0047 · l'approbation des comptes, à la main                  ║
-- ║                                                                        ║
-- ║  Décision du propriétaire (30/10) : n'importe qui s'inscrit et visite  ║
-- ║  tout Glisil — le marché, les cours, son compte. Mais tant que         ║
-- ║  l'équipe n'a pas APPROUVÉ le compte, aucun geste d'argent : ni dépôt  ║
-- ║  (Mobile Money ou adresse crypto), ni ordre, ni achat rapide, ni        ║
-- ║  retrait. Plus tard, quand l'approbation ne servira plus, un           ║
-- ║  interrupteur l'éteint (super admin) : les comptes en attente sont     ║
-- ║  approuvés d'office, les suivants naissent approuvés. Rallumé, il ne   ║
-- ║  bloque que les comptes ouverts APRÈS.                                 ║
-- ║                                                                        ║
-- ║  Le verrou est posé sur les TABLES où l'argent commence (dépôts,       ║
-- ║  déclarations, adresses crypto, ordres, devis, sorties, retraits       ║
-- ║  crypto, codes de sortie), pas dans chaque fonction : une fonction     ║
-- ║  écrite demain qui y écrit y passe aussi. Ce qui ne commence rien      ║
-- ║  reste ouvert : annuler un ordre, fermer son compte, ses numéros.      ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ───────────────────────────── 1 · la règle ────────────────────────────────
insert into parametres (cle, valeur) values ('approbation', '{"manuelle": true}')
on conflict (cle) do nothing;

alter table comptes add column if not exists approuve_le  timestamptz;
-- null avec approuve_le posé : approuvé d'office (né interrupteur éteint, ou en attente quand on l'a éteint)
alter table comptes add column if not exists approuve_par uuid;

-- Ceux qui existent déjà sont nés avant la règle : ils travaillaient, ils continuent.
update comptes set approuve_le = coalesce(cree_le, now()) where approuve_le is null;

create or replace function _approbation_manuelle() returns boolean
language sql stable set search_path = public, extensions, pg_temp as $$
  select coalesce((parametre('approbation') ->> 'manuelle')::boolean, true)
$$;
revoke all on function _approbation_manuelle() from public, anon, authenticated;

-- Interrupteur éteint : le compte naît approuvé (d'office, sans approbateur). Les comptes de la maison
-- (le compte maison, les robots de la bêta, les comptes de test) ne sont pas des clients : ils naissent approuvés.
create or replace function _approuver_a_la_naissance() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  if new.approuve_le is null and (new.maison or new.genre <> 'client' or not _approbation_manuelle()) then
    new.approuve_le := now();
    new.approuve_par := null;
  end if;
  return new;
end $$;
revoke all on function _approuver_a_la_naissance() from public, anon, authenticated;
drop trigger if exists approuver_a_la_naissance on comptes;
create trigger approuver_a_la_naissance before insert on comptes
  for each row execute function _approuver_a_la_naissance();

-- ───────────────────────────── 2 · le verrou ───────────────────────────────
create or replace function _exiger_compte_approuve(p_compte uuid) returns void
language plpgsql stable set search_path = public, extensions, pg_temp as $$
begin
  if p_compte is null then return; end if;
  if exists (select 1 from comptes where id = p_compte and approuve_le is null and not maison) and _approbation_manuelle() then
    raise exception 'compte en attente d''approbation'
      using detail = 'l''équipe Glisil vérifie votre compte : les dépôts, le marché et les retraits s''ouvrent dès qu''il est approuvé';
  end if;
end $$;
revoke all on function _exiger_compte_approuve(uuid) from public, anon, authenticated;

create or replace function _verrou_d_approbation() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  -- un code de sortie (0036) : seulement pour l'argent qui SORT. Fermer son compte, retirer un numéro restent permis.
  -- (deux « if » : plpgsql résout new.operation même derrière un « and » faux, et les autres tables n'ont pas ce champ)
  if tg_table_name = 'verifications' then
    if new.operation not in ('sortie_momo', 'retrait_crypto') then return new; end if;
  end if;
  perform _exiger_compte_approuve(new.compte_id);
  return new;
end $$;
revoke all on function _verrou_d_approbation() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['depots', 'depot_declarations', 'adresses_crypto', 'ordres', 'devis_rapides', 'sorties', 'retraits_crypto', 'verifications'] loop
    execute format('drop trigger if exists verrou_d_approbation on %I', t);
    execute format('create trigger verrou_d_approbation before insert on %I for each row execute function _verrou_d_approbation()', t);
  end loop;
end $$;

-- ─────────────────────── 3 · ce que voit le client ─────────────────────────
-- 0037, plus « approuve » : l'application montre l'attente avant le premier geste, au lieu d'un refus après.
create or replace function _compte_json(c comptes) returns jsonb
language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'entreprise', c.entreprise, 'palier', c.palier,
                            'email', c.email, 'prenom', c.prenom, 'nom_de_famille', c.nom_de_famille,
                            'date_naissance', c.date_naissance, 'ville', c.ville, 'pays', c.pays,
                            'langue', c.langue,
                            'verification_en_cours', c.verification_en_cours,
                            'conditions_version', c.conditions_version, 'conditions_acceptees_le', c.conditions_acceptees_le,
                            'conditions_a_jour', c.maison or c.conditions_version is not distinct from (parametre('conditions') ->> 'version'),
                            'ferme_le', c.ferme_le, 'desactive', c.desactive_le is not null,
                            'approuve', c.maison or c.approuve_le is not null or not _approbation_manuelle(),
                            'approuve_le', c.approuve_le,
                            -- ce qui est déjà entré aujourd'hui : l'écran montre ce qui RESTE du plafond, pas le plafond
                            'entre_du_jour', (select coalesce(sum(montant), 0) from depot_declarations
                                               where compte_id = c.id and etat = 'credite' and credite_le >= debut_du_jour()))
$$;
revoke all on function _compte_json(comptes) from public, anon, authenticated;

-- ─────────────────────────── 4 · ce que fait l'équipe ──────────────────────
-- Approuver : le droit « paliers » (aujourd'hui, le super admin seul), comme les vérifications d'identité.
create or replace function admin_approuver_client(p_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_c comptes;
begin
  perform _exiger_droit('paliers');
  select * into v_c from comptes where id = p_id for update;
  if not found or v_c.maison or v_c.genre <> 'client' then raise exception 'client inconnu'; end if;
  if v_c.approuve_le is not null then
    return jsonb_build_object('ok', true, 'deja', true, 'approuve_le', v_c.approuve_le);
  end if;
  if v_c.ferme_le is not null then raise exception 'compte fermé'; end if;
  update comptes set approuve_le = now(), approuve_par = auth.uid() where id = p_id returning * into v_c;
  perform _journaliser('approuver_client', p_id::text, jsonb_build_object('note', nullif(trim(coalesce(p_note, '')), '')));
  perform _notifier(p_id,
    case when v_c.langue = 'fr' then 'Compte approuvé' else 'Account approved' end,
    case when v_c.langue = 'fr' then 'Votre compte Glisil est approuvé : les dépôts, le marché et les retraits sont ouverts.'
         else 'Your Glisil account is approved: deposits, trading and withdrawals are open.' end,
    '/');
  perform _envoyer_courriel(p_id, 'compte_approuve', jsonb_build_object('lien', '/'), 'compte_approuve:' || p_id::text);
  return jsonb_build_object('ok', true, 'approuve_le', v_c.approuve_le);
end $$;
revoke all on function admin_approuver_client(uuid, text) from public, anon;
grant execute on function admin_approuver_client(uuid, text) to authenticated;

-- L'interrupteur : le droit « administrateurs » (le super admin seul). Éteint, il approuve d'office ceux qui attendent.
create or replace function admin_regler_approbation(p_manuelle boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_n int := 0;
begin
  perform _exiger_droit('administrateurs');
  if p_manuelle is null then raise exception 'valeur invalide'; end if;
  update parametres set valeur = valeur || jsonb_build_object('manuelle', p_manuelle) where cle = 'approbation';
  if not found then insert into parametres (cle, valeur) values ('approbation', jsonb_build_object('manuelle', p_manuelle)); end if;
  if not p_manuelle then
    -- d'office : approuve_par reste vide, le journal dit qui a éteint
    update comptes set approuve_le = now(), approuve_par = null where approuve_le is null and not maison;
    get diagnostics v_n = row_count;
  end if;
  perform _journaliser('regler_approbation', 'approbation', jsonb_build_object('manuelle', p_manuelle, 'approuves_d_office', v_n));
  return jsonb_build_object('ok', true, 'manuelle', p_manuelle, 'approuves_d_office', v_n);
end $$;
revoke all on function admin_regler_approbation(boolean) from public, anon;
grant execute on function admin_regler_approbation(boolean) to authenticated;

-- L'état, pour l'en-tête de l'administration : l'interrupteur et la file.
create or replace function admin_approbation() returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
begin
  perform _exiger_droit('clients');
  return jsonb_build_object(
    'manuelle', _approbation_manuelle(),
    'en_attente', (select count(*) from comptes where approuve_le is null and not maison and genre = 'client' and ferme_le is null),
    'peut_approuver', admin_a_droit('paliers'),
    'peut_regler', admin_a_droit('administrateurs'));
end $$;
revoke all on function admin_approbation() from public, anon;
grant execute on function admin_approbation() to authenticated;

-- 0045, plus le filtre « a_approuver » et la date d'approbation.
create or replace function admin_clients(p_recherche text default null, p_n integer default 100, p_filtre text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_q text := nullif(trim(coalesce(p_recherche, '')), ''); v_chiffres text;
begin
  perform _exiger_droit('clients');
  v_chiffres := regexp_replace(coalesce(v_q, ''), '[^0-9]', '', 'g');
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'entreprise', c.entreprise, 'palier', c.palier,
                            'email', c.email, 'ville', c.ville, 'pays', c.pays, 'genre', c.genre,
                            'verification_en_cours', c.verification_en_cours, 'cree_le', c.cree_le, 'desactive_le', c.desactive_le,
                            'approuve_le', c.approuve_le, 'ferme_le', c.ferme_le,
                            'derniere_operation', c.derniere_operation, 'derniere_connexion', _derniere_connexion(c.id),
                            'xafe', (select coalesce(disponible + bloque, 0) from soldes where compte_id = c.id and actif = 'XAFe'),
                            'usdt', (select coalesce(disponible + bloque, 0) from soldes where compte_id = c.id and actif = 'USDT'),
                            'usdc', (select coalesce(disponible + bloque, 0) from soldes where compte_id = c.id and actif = 'USDC')) order by c.cree_le desc), '[]'::jsonb)
    into r
    from (select x.*, _derniere_operation(x.id) derniere_operation from comptes x where not x.maison
             -- les robots du marché et les comptes de test ont leur propre filtre ; ailleurs, seuls les vrais clients
             and x.genre = case p_filtre when 'robots' then 'robot' when 'tests' then 'test' else 'client' end
             and (p_filtre is null or p_filtre in ('robots', 'tests')
                  or (p_filtre = 'a_approuver' and x.approuve_le is null and x.ferme_le is null)
                  or (p_filtre = 'verifications' and x.verification_en_cours is not null)
                  or (p_filtre = 'desactives' and x.desactive_le is not null)
                  or (p_filtre = 'nouveaux' and x.cree_le > now() - interval '7 days')
                  or (p_filtre = 'actifs' and x.desactive_le is null and exists (select 1 from ecritures e where e.compte_id = x.id and e.cree_le > now() - interval '30 days'))
                  or (p_filtre = 'inactifs' and x.desactive_le is null and not exists (select 1 from ecritures e where e.compte_id = x.id and e.cree_le > now() - interval '30 days')))
             and (v_q is null
                  or (length(v_chiffres) >= 3 and regexp_replace(coalesce(x.telephone, ''), '[^0-9]', '', 'g') like '%' || v_chiffres || '%')
                  or x.nom ilike '%' || v_q || '%' or x.entreprise ilike '%' || v_q || '%' or x.email ilike '%' || v_q || '%'
                  or x.ville ilike '%' || v_q || '%')
           order by x.cree_le desc limit least(greatest(coalesce(p_n, 100), 1), 500)) c;
  return r;
end $$;

-- 0010, plus qui a approuvé et quand (le nom de l'administrateur, ou « d'office »).
create or replace function admin_client(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('clients');
  select jsonb_build_object(
    'compte', _compte_json(c) || jsonb_build_object('cree_le', c.cree_le, 'desactive_le', c.desactive_le, 'verification_pieces', c.verification_pieces,
                                                    'code_verrou_jusqua', c.code_verrou_jusqua, 'derniere_connexion', _derniere_connexion(c.id),
                                                    'derniere_operation', _derniere_operation(c.id),
                                                    'approuve_le', c.approuve_le,
                                                    'approuve_par', (select coalesce(a.nom, a.email) from administrateurs a where a.id = c.approuve_par)),
    'soldes', (select coalesce(jsonb_object_agg(actif, jsonb_build_object('disponible', disponible, 'bloque', bloque)), '{}'::jsonb) from soldes where compte_id = c.id),
    'numeros', (select coalesce(jsonb_agg(_numero_json(n) order by n.verifie_le), '[]'::jsonb) from numeros n where n.compte_id = c.id),
    'totaux', jsonb_build_object(
       'entre_xaf',   (select coalesce(sum(montant), 0) from depot_declarations where compte_id = c.id and etat = 'credite'),
       'sorti_xaf',   (select coalesce(sum(montant_envoye), 0) from sorties where compte_id = c.id and etat in ('envoyee', 'partielle')),
       'ordres',      (select count(*) from ordres where compte_id = c.id),
       'retraits_crypto', (select count(*) from retraits_crypto where compte_id = c.id)),
    'depots', (select coalesce(jsonb_agg(_depot_json(d) order by d.cree_le desc), '[]'::jsonb) from (select * from depots where compte_id = c.id order by cree_le desc limit 50) d),
    'sorties', (select coalesce(jsonb_agg(_sortie_json(s) order by s.cree_le desc), '[]'::jsonb) from (select * from sorties where compte_id = c.id order by cree_le desc limit 50) s),
    'ordres', (select coalesce(jsonb_agg(_ordre_json(o) order by o.cree_le desc), '[]'::jsonb) from (select * from ordres where compte_id = c.id order by cree_le desc limit 50) o),
    'retraits_crypto', (select coalesce(jsonb_agg(_retrait_json(x) order by x.cree_le desc), '[]'::jsonb) from (select * from retraits_crypto where compte_id = c.id order by cree_le desc limit 50) x),
    'transferts_crypto', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'actif', t.actif, 'reseau', t.reseau, 'sens', t.sens, 'montant', t.montant,
                                                                        'adresse', t.adresse, 'tx_hash', t.tx_hash, 'cree_le', t.cree_le) order by t.cree_le desc), '[]'::jsonb)
                            from (select * from transferts_crypto where compte_id = c.id order by cree_le desc limit 50) t),
    'ecritures', (select coalesce(jsonb_agg(jsonb_build_object('actif', e.actif, 'disponible', e.disponible_delta, 'bloque', e.bloque_delta, 'nature', e.nature, 'source', e.source_id, 'quand', e.cree_le) order by e.cree_le desc), '[]'::jsonb)
                    from (select * from ecritures where compte_id = c.id order by cree_le desc limit 100) e))
    into r from comptes c where c.id = p_id;
  return r;
end $$;
