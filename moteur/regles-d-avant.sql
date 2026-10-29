-- LES RÈGLES D'AVANT, pour les scénarios écrits avant elles.
--
-- Les scénarios, les courses, le hasard et la charge éprouvent des mécanismes
-- (le code SMS, les plafonds, la composition par TOTEM…) que les règles
-- d'aujourd'hui éteignent en service. Chaque harnais qui les joue — le moteur
-- (moteur/verifier-le-moteur.sh) et la vraie pile Supabase
-- (supabase/epreuve/eprouver.sh) — pose ces règles d'abord, depuis CE fichier :
-- deux copies avaient déjà divergé (la vraie pile jouait en bêta et tombait au
-- premier dépôt). Chaque règle d'aujourd'hui est éprouvée par son propre
-- scénario, dans sa transaction.

-- Les scénarios, les courses, le hasard et la charge ont été écrits avant 0013 : ils déclarent
-- l'ID seul. La règle stricte (numéro, montant, nom) est éprouvée à part, par le scénario 11.34,
-- qui la rallume dans sa transaction ; ailleurs, on l'éteint ici — et SEULEMENT ici.
update parametres set valeur = valeur || '{"declaration_complete": false}' where cle = 'depot';
-- Même chose pour les numéros (0020) : les scénarios d'avant éprouvent le code SMS et le délai de 24 h.
-- La règle d'aujourd'hui (ni code ni délai) est éprouvée par le scénario 11.41, dans sa transaction.
update parametres set valeur = '{"verification_sms": true, "delai_heures": 24}' where cle = 'numeros';
-- La bêta (0021) ferme les dépôts réels et dote chaque inscrit : les scénarios d'avant jouent hors bêta.
-- La bêta elle-même est éprouvée par le scénario 11.42, dans sa transaction.
update parametres set valeur = valeur || '{"actif": false}' where cle = 'beta';
-- Sans plafond (0027) : la plateforme n'a plus de taille maximale ni de plafond de palier, et compte un minimum
-- en XAFe. Les scénarios d'avant éprouvent les plafonds (le mécanisme existe toujours, vide en service) :
-- ils jouent avec les règles d'avant. La règle d'aujourd'hui est éprouvée par le scénario 11.48.
update parametres set valeur = valeur || '{"quantite_min": 10, "quantite_max": 1000000, "marche_quantite_max": 100000, "montant_min": 0}' where cle = 'marche';
update parametres set valeur = '{"0": {"entree_jour": 500000, "sortie_jour": 500000}, "1": {"entree_jour": 5000000, "sortie_jour": 5000000}, "2": null}' where cle = 'paliers';

-- 0038 met les sorties en manuel : les scénarios d'avant éprouvent la composition par TOTEM. La règle
-- d'aujourd'hui (le remboursement manuel prouvé par la puce) est éprouvée par 11.36 et 11.80+, dans leur transaction.
update parametres set valeur = valeur || '{"mode": "totem"}' where cle = 'sortie';
-- 0039 retient tout SMS d'argent dont le solde ne suit pas : les scénarios d'avant n'annoncent aucun solde.
-- Ils jouent la garde en « surveiller » (crédité, signalé) ; la garde elle-même (« exiger ») est éprouvée
-- par le scénario 11.81, dans sa transaction, et par l'attaque #F1 de rouge-puis-vert.
update parametres set valeur = valeur || '{"mode": "surveiller"}' where cle = 'continuite';
