-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0019 · recevoir des XAFe depuis son propre wallet            ║
-- ║                                                                        ║
-- ║  Tout était prêt dans le moteur : des adresses XAFe préparées et       ║
-- ║  inscrites au contrat, le crédit à l'arrivée, la destruction sur       ║
-- ║  l'adresse et la recréation dans la réserve (0015). Il manquait à      ║
-- ║  l'écran l'adresse du CONTRAT XAFe de chaque réseau : sans elle, un    ║
-- ║  wallet (MetaMask, Trust Wallet…) ne montre pas les XAFe qu'il tient,  ║
-- ║  et le client ne peut pas les renvoyer. Une adresse de contrat est     ║
-- ║  publique : elle se lit déjà sur la page de la preuve.                 ║
-- ╚════════════════════════════════════════════════════════════════════════╝

create or replace function _reseaux_publics() returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'norme', norme, 'famille', famille, 'natif', natif,
                                               'explorateur', _explorateur(id), 'maison', id = _reseau_de_la_reserve(),
                                               'confirmations', coalesce((parametre('crypto') -> 'confirmations' ->> id)::int,
                                                                         (parametre('chaine') -> id ->> 'confirmations')::int),
                                               -- le contrat XAFe du réseau : de quoi l'ajouter à son wallet
                                               'contrat_xafe', nullif(parametre('chaine') -> id ->> 'xafe', ''))
                            order by ordre), '[]'::jsonb)
    from reseaux where actif
$$;

revoke all on function _reseaux_publics() from public, anon, authenticated;
