-- Le constat de la production, en fin de commande (docs/PRODUCTION.md). Il
-- LÈVE — et toute la transaction s'annule — si le profil ne tient pas. À
-- l'installation (profil annoncé), il exige en plus une base neuve.
\set ON_ERROR_STOP on
\pset tuples_only on
select jsonb_pretty(verifier_le_profil_production(coalesce(current_setting('glisil.profil', true) = 'production', false)));
