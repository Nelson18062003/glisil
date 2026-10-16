-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0010 · la vue d'ensemble des clients, pour l'équipe          ║
-- ║  Combien de clients, combien vivent vraiment, qui vient d'arriver ; la ║
-- ║  liste qui se filtre et se cherche par nom, e-mail ou numéro ; la      ║
-- ║  fiche complète d'un client, profil, connexions et tout son historique.║
-- ║  Tout passe par le droit « clients ».                                  ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- Un client ACTIF a bougé de l'argent dans les 30 derniers jours (une
-- écriture sur son compte) : se connecter sans rien faire ne compte pas.
create or replace function _derniere_operation(p_compte uuid) returns timestamptz language sql stable as $$
  select max(cree_le) from ecritures where compte_id = p_compte
$$;

create or replace function _derniere_connexion(p_compte uuid) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare v timestamptz;
begin
  if to_regclass('auth.users') is null then return null; end if;
  execute 'select last_sign_in_at from auth.users where id = $1' into v using p_compte;
  return v;
exception when undefined_column then return null;
end $$;

-- Les chiffres en tête de la page Clients.
create or replace function admin_statistiques_clients() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_inacheves int := 0;
begin
  perform _exiger_droit('clients');
  -- des personnes ont prouvé leur adresse e-mail, mais n'ont pas fini leur profil
  if to_regclass('auth.users') is not null then
    execute $q$select count(*) from auth.users u
                where u.email_confirmed_at is not null
                  and not exists (select 1 from comptes c where c.id = u.id)
                  and not exists (select 1 from administrateurs a where a.id = u.id)$q$ into v_inacheves;
  end if;
  select jsonb_build_object(
    'total',            count(*),
    'actifs_30j',       count(*) filter (where c.desactive_le is null and exists (select 1 from ecritures e where e.compte_id = c.id and e.cree_le > now() - interval '30 days')),
    'connectes_7j',     count(*) filter (where _derniere_connexion(c.id) > now() - interval '7 days'),
    'nouveaux_7j',      count(*) filter (where c.cree_le > now() - interval '7 days'),
    'nouveaux_30j',     count(*) filter (where c.cree_le > now() - interval '30 days'),
    'verifies',         count(*) filter (where c.palier >= 1),
    'en_verification',  count(*) filter (where c.verification_en_cours is not null),
    'desactives',       count(*) filter (where c.desactive_le is not null),
    'inscriptions_inachevees', v_inacheves,
    'par_pays',         (select coalesce(jsonb_object_agg(pays, n), '{}'::jsonb) from (select coalesce(pays, '?') pays, count(*) n from comptes where not maison group by 1) p),
    'inscriptions_30j', (select coalesce(jsonb_agg(jsonb_build_object('jour', j, 'n', n) order by j), '[]'::jsonb) from (
                           select d::date j, (select count(*) from comptes x where not x.maison and (x.cree_le at time zone 'Africa/Douala')::date = d::date) n
                             from generate_series((now() at time zone 'Africa/Douala')::date - 29, (now() at time zone 'Africa/Douala')::date, interval '1 day') d) s))
    into r from comptes c where not c.maison;
  return r;
end $$;

-- La liste : cherchée par nom, e-mail ou numéro ; filtrée par état.
--   p_filtre : null (tous) · actifs · inactifs · nouveaux · verifications · desactives
create or replace function admin_clients(p_recherche text default null, p_n int default 100, p_filtre text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_q text := nullif(trim(coalesce(p_recherche, '')), ''); v_chiffres text;
begin
  perform _exiger_droit('clients');
  v_chiffres := regexp_replace(coalesce(v_q, ''), '[^0-9]', '', 'g');
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'entreprise', c.entreprise, 'palier', c.palier,
                            'email', c.email, 'ville', c.ville, 'pays', c.pays,
                            'verification_en_cours', c.verification_en_cours, 'cree_le', c.cree_le, 'desactive_le', c.desactive_le,
                            'derniere_operation', c.derniere_operation, 'derniere_connexion', _derniere_connexion(c.id),
                            'xafe', (select coalesce(disponible + bloque, 0) from soldes where compte_id = c.id and actif = 'XAFe'),
                            'usdt', (select coalesce(disponible + bloque, 0) from soldes where compte_id = c.id and actif = 'USDT')) order by c.cree_le desc), '[]'::jsonb)
    into r
    from (select x.*, _derniere_operation(x.id) derniere_operation from comptes x where not x.maison
             and (p_filtre is null
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

-- La fiche : le profil complet, les connexions, et tout l'historique.
create or replace function admin_client(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _exiger_droit('clients');
  select jsonb_build_object(
    'compte', _compte_json(c) || jsonb_build_object('cree_le', c.cree_le, 'desactive_le', c.desactive_le, 'verification_pieces', c.verification_pieces,
                                                    'code_verrou_jusqua', c.code_verrou_jusqua, 'derniere_connexion', _derniere_connexion(c.id),
                                                    'derniere_operation', _derniere_operation(c.id)),
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

revoke all on function _derniere_operation(uuid), _derniere_connexion(uuid), admin_statistiques_clients() from public, anon, authenticated;
grant execute on function admin_statistiques_clients() to authenticated;
grant execute on function _derniere_operation(uuid), _derniere_connexion(uuid), admin_statistiques_clients() to service_role;
