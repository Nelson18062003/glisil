-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0029 · l'écran sait que la démo TOTEM est branchée           ║
-- ║                                                                        ║
-- ║  0028 a ouvert, dans la base, les dépôts sur les floats de démo et les ║
-- ║  retraits vers les numéros de démo. L'écran, lui, lisait seulement     ║
-- ║  « sorties fermées » et « dépôts réels fermés » : il affichait         ║
-- ║  « Fermé (bêta) » devant une porte que la base laissait passer.        ║
-- ║  Les paramètres publics disent maintenant si un float de démo est      ║
-- ║  branché (« beta.demo_totem ») ; l'écran ouvre Entrer et Sortir, et    ║
-- ║  ne propose pour sortir que les numéros de démo.                       ║
-- ╚════════════════════════════════════════════════════════════════════════╝

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
                                 'reseaux', _reseaux_publics()),
    'sortie', jsonb_build_object('ouvertes', coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true),
                                 'mode', coalesce(parametre('sortie') ->> 'mode', 'totem')),
    'numeros', jsonb_build_object('verification_sms', coalesce((parametre('numeros') ->> 'verification_sms')::boolean, true),
                                  'delai_heures', coalesce((parametre('numeros') ->> 'delai_heures')::int, 24)),
    'operateurs', (select jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'plafond_par_transfert', plafond_par_transfert,
                                                       'plafond_jour', plafond_jour) order by id) from operateurs),
    -- la bêta : ce que l'écran annonce, la dotation d'un nouveau testeur, et si CE compte peut payer en vrai
    'beta', jsonb_build_object('actif', coalesce((parametre('beta') ->> 'actif')::boolean, false),
                               'message', parametre('beta') ->> 'message',
                               'dotation', parametre('beta') -> 'dotation',
                               'depots_reels', _depots_reels_ouverts(auth.uid()),
                               -- un float de démo TOTEM est branché : dépôts et retraits s'ouvrent vers la démo (0028)
                               'demo_totem', exists (select 1 from floats f join terminaux t on t.id = f.terminal
                                                      where f.actif and t.demo)),
    'conditions', parametre('conditions'),
    'support', parametre('support'))
   where auth.uid() is not null
$$;
