-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0044 · les politiques de lecture lisent l'identité UNE fois   ║
-- ║                                                                        ║
-- ║  Le conseiller de performance de Supabase (auth_rls_initplan) : une    ║
-- ║  politique « compte_id = auth.uid() » relit le jeton à CHAQUE ligne.   ║
-- ║  Écrit « (select auth.uid()) », PostgreSQL le lit une fois par         ║
-- ║  requête. Les mêmes quinze politiques, la même règle — rien d'autre ne ║
-- ║  change (les politiques RESTRICTIVES de 0035 restent telles quelles).  ║
-- ╚════════════════════════════════════════════════════════════════════════╝
do $$
declare p record;
begin
  for p in select * from (values
    ('administrateurs',   'lire_sa_fiche',            'id = (select auth.uid())'),
    ('adresses_crypto',   'lire_mes_adresses',        'compte_id = (select auth.uid())'),
    ('comptes',           'lire_mon_compte',          'id = (select auth.uid())'),
    ('depot_declarations','lire_mes_declarations',    'compte_id = (select auth.uid())'),
    ('depot_paiements',   'lire_mes_depot_paiements', 'depot_id in (select d.id from depots d where d.compte_id = (select auth.uid()))'),
    ('depots',            'lire_mes_depots',          'compte_id = (select auth.uid())'),
    ('ecritures',         'lire_mes_ecritures',       'compte_id = (select auth.uid())'),
    ('executions',        'lire_mes_executions',      'ordre_achat in (select o.id from ordres o where o.compte_id = (select auth.uid())) or ordre_vente in (select o.id from ordres o where o.compte_id = (select auth.uid()))'),
    ('notifications',     'lire_mes_notifications',   'compte_id = (select auth.uid())'),
    ('numeros',           'lire_mes_numeros',         'compte_id = (select auth.uid())'),
    ('ordres',            'lire_mes_ordres',          'compte_id = (select auth.uid())'),
    ('retraits_crypto',   'lire_mes_retraits',        'compte_id = (select auth.uid())'),
    ('soldes',            'lire_mes_soldes',          'compte_id = (select auth.uid())'),
    ('sorties',           'lire_mes_sorties',         'compte_id = (select auth.uid())'),
    ('transferts_crypto', 'lire_mes_transferts',      'compte_id = (select auth.uid())')
  ) as t(tab, nom, regle) loop
    if to_regclass('public.' || p.tab) is null then continue; end if;
    execute format('drop policy if exists %I on public.%I', p.nom, p.tab);
    execute format('create policy %I on public.%I for select to authenticated using (%s)', p.nom, p.tab, p.regle);
  end loop;
end $$;
