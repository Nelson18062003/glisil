-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0040 · la réserve tenue par le contrat (lecture seulement)    ║
-- ║                                                                        ║
-- ║  Le contrat XAFe tient maintenant lui-même la réserve (address(this)), ║
-- ║  intransférable : elle s'y frappe et s'y détruit (frapperReserve,      ║
-- ║  detruireReserve). Rien ne change dans les chemins de l'argent — les   ║
-- ║  opérations de réserve, leurs références et le rapprochement ligne à   ║
-- ║  ligne restent les mêmes. Ce qui change, c'est ce qu'on MONTRE :       ║
-- ║   · l'adresse de la réserve est celle du contrat (jamais plus le wallet║
-- ║     chaud du veilleur) ;                                               ║
-- ║   · la page publique dit le plafond de frappe du jour et la pause ;    ║
-- ║   · un réseau qui change de contrat (la bêta, sur un nouveau contrat   ║
-- ║     d'essai) n'attend plus sur le nouveau les retraits et les retours  ║
-- ║     faits sur l'ancien (chaine.<réseau>.depuis_le). En production, le  ║
-- ║     réglage n'existe pas : rien n'est filtré.                          ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- Les lignes d'avant le contrat configuré sur un réseau ne s'y attendent pas.
create or replace function _contrat_depuis(p_reseau text) returns timestamptz
language sql stable set search_path = public as $$
  select coalesce((parametre('chaine') -> p_reseau ->> 'depuis_le')::timestamptz, '-infinity'::timestamptz)
$$;

create or replace function _trace_chaine(p_table text, p_source text) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('reseau', r.reseau, 'operation', r.operation, 'montant', r.montant,
                                               'reference', r.reference, 'etat', r.etat, 'tx_hash', r.tx_hash, 'bloc', r.bloc,
                                               'essai', coalesce((parametre('chaine') ->> 'essai')::boolean, false),
                                               'contrat', parametre('chaine') -> r.reseau ->> 'xafe',
                                               -- la réserve EST le contrat (0040) : elle ne dépend plus de l'état du veilleur
                                               'reserve', parametre('chaine') -> r.reseau ->> 'xafe',
                                               'explorateur', _explorateur(r.reseau),
                                               'empreinte', (select e.empreinte from chaine_empreintes e where e.reference = r.reference limit 1),
                                               'relue', exists (select 1 from chaine_mouvements_jeton m where m.reseau = r.reseau and m.tx_hash = r.tx_hash),
                                               'confirme_le', r.traite_le) order by r.id), '[]'::jsonb)
    from reserve_chaine r where r.source_table = p_table and r.source_id = p_source
$$;

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
       and x.cree_le >= _contrat_depuis(x.reseau)   -- d'avant le contrat configuré : sur l'ancien, pas attendue ici
    union all
    select t.tx_hash, 'retour', t.reseau, 'destruction', t.montant, 'confirme', null, t.cree_le
      from transferts_crypto t where t.actif = 'XAFe' and t.sens = 'entree' and t.cree_le >= _contrat_depuis(t.reseau)
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

create or replace function _parite_json(p_detail boolean) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'releve', (select case when p_detail then to_jsonb(p) - 'detail'
                           else to_jsonb(p) - 'detail' - 'floats' - 'couverture'
                                || jsonb_build_object('floats', _arrondi_public(p.floats), 'couverture', _arrondi_public(p.couverture), 'floats_arrondi', 1000000) end
                 || jsonb_build_object('reseaux', p.detail -> 'reseaux',
                 'floats_detail', case when p_detail then p.detail -> 'floats'
                                when coalesce((parametre('parite') ->> 'publier_floats')::boolean, true)
                                then (select coalesce(jsonb_agg(jsonb_build_object('operateur', o, 'solde', _arrondi_public(s), 'annonce_le', d, 'connu', c)), '[]'::jsonb)
                                        from (select x ->> 'operateur' o, sum((x ->> 'solde')::numeric) s, min((x ->> 'annonce_le')::timestamptz) d, bool_and((x ->> 'connu')::boolean) c
                                                from jsonb_array_elements(p.detail -> 'floats') x group by 1) g) end)
                 from parite_releves p order by p.fait_le desc limit 1),
    'historique', (select coalesce(jsonb_agg(jsonb_build_object('fait_le', fait_le, 'statut', statut, 'registre', registre, 'chaine', chaine, 'ecart', ecart,
                                                                'floats', case when p_detail then floats else _arrondi_public(floats) end) order by fait_le), '[]'::jsonb)
                     from (select * from parite_releves where fait_le > now() - interval '7 days' and (extract(minute from fait_le)::int % 60) < 5 order by fait_le) h),
    -- chaque réseau où le contrat XAFe est posé : c'est leur SOMME qui se compare au registre
    'contrats', (select coalesce(jsonb_agg(jsonb_build_object('reseau', r.id, 'nom', r.nom, 'contrat', parametre('chaine') -> r.id ->> 'xafe', 'explorateur', _explorateur(r.id),
                                                       'maison', r.id = _reseau_de_la_reserve(),
                                                       -- la réserve est le contrat XAFe du réseau qui la porte (0040)
                                                       'reserve', case when r.id = _reseau_de_la_reserve() then parametre('chaine') -> r.id ->> 'xafe' end,
                                                       'plafond_jour', (select etat ->> 'plafond_jour' from chaine_etats e where e.reseau = r.id),
                                                       'en_pause', (select (etat ->> 'en_pause')::boolean from chaine_etats e where e.reseau = r.id)) order by r.ordre), '[]'::jsonb)
                   from reseaux r where _reseau_configure(r.id)),
    'essai', coalesce((parametre('chaine') ->> 'essai')::boolean, false),
    -- la bêta : la part du registre qui est de l'argent de test (sans XAF derrière)
    'xafe_de_test', _xafe_de_test(),
    'lignes', (select coalesce(jsonb_agg(to_jsonb(l) - case when p_detail then '{}'::text[] else array['etat_registre', 'tx_attendu', 'adresse_vue'] end order by l.depuis desc), '[]'::jsonb)
                 from (select * from _parite_lignes() order by depuis desc limit case when p_detail then 500 else 100 end) l),
    'alertes', case when p_detail then (select coalesce(jsonb_agg(to_jsonb(a) order by a.ouverte_le desc), '[]'::jsonb)
                                          from parite_alertes a where a.close_le is null or a.close_le > now() - interval '7 days')
                    else (select count(*) from parite_alertes where close_le is null and gravite <> 'attention')::text::jsonb end)
$$;

revoke all on function _contrat_depuis(text), _trace_chaine(text, text), _parite_lignes(), _parite_json(boolean) from public, anon, authenticated;
