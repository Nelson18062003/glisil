-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0033 · le bandeau de la bêta, aussi en anglais               ║
-- ║                                                                        ║
-- ║  L'application parle maintenant français ET anglais. Le bandeau de la  ║
-- ║  bêta est le seul texte que l'équipe écrit elle-même dans la base :    ║
-- ║  il a désormais sa version anglaise (« beta.message_en »), posée ici   ║
-- ║  si elle manque. L'écran prend celle de sa langue.                     ║
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
                               'message_en', parametre('beta') ->> 'message_en',
                               'dotation', parametre('beta') -> 'dotation',
                               'depots_reels', _depots_reels_ouverts(auth.uid()),
                               -- un float de démo TOTEM est branché : dépôts et retraits s'ouvrent vers la démo (0028)
                               'demo_totem', exists (select 1 from floats f join terminaux t on t.id = f.terminal
                                                      where f.actif and t.demo)),
    'conditions', parametre('conditions'),
    'support', parametre('support'))
   where auth.uid() is not null
$$;

update parametres set valeur = valeur || jsonb_build_object('message_en',
  'Glisil is in beta: all the money here is test money, with no real value. Real deposits and withdrawals are closed. The market is driven by test robots.')
 where cle = 'beta' and not (valeur ? 'message_en');
