-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  BÊTA SEULEMENT — passer la bêta sur les NOUVEAUX contrats d'essai     ║
-- ║                                                                        ║
-- ║  Ce n'est PAS une migration : il ne s'applique qu'au projet de la      ║
-- ║  bêta, une fois, après le déploiement des contrats corrigés (la        ║
-- ║  réserve tenue par le contrat, 0040). Il refuse de tourner si          ║
-- ║  parametre beta.actif ou chaine.essai n'est pas vrai : en production,  ║
-- ║  il ne fait rien.                                                      ║
-- ║                                                                        ║
-- ║  Le veilleur neuf ne parle plus aux anciens contrats. Les XAFe d'essai ║
-- ║  partis vers des wallets externes sur l'ANCIEN contrat (E = retraits   ║
-- ║  − retours, par réseau) ne valent plus rien : ils reviennent au compte ║
-- ║  maison, en « depuis_chaine », ce qui met la frappe de réserve en file ║
-- ║  (le registre et la chaîne restent égaux). Puis toute la réserve se    ║
-- ║  rejoue sur le nouveau contrat, dans l'ordre des id ; le jeton se      ║
-- ║  relit depuis le bloc du déploiement ; les retraits et retours d'avant ║
-- ║  ne sont plus attendus sur le nouveau contrat (depuis_le).             ║
-- ║                                                                        ║
-- ║  Le curseur des DÉPÔTS (clé = réseau) est gardé : il couvre aussi      ║
-- ║  l'USDT, dont le contrat ne change pas — le remettre à zéro ferait     ║
-- ║  sauter les dépôts USDT faits pendant l'arrêt du veilleur.             ║
-- ║                                                                        ║
-- ║  Avant : pauser() les anciens contrats, arrêter le veilleur, déployer  ║
-- ║  (mise-en-service deployer), inscrire --toutes-attribuees. Puis :      ║
-- ║                                                                        ║
-- ║   psql "$BETA_DB" --single-transaction -v ON_ERROR_STOP=1 \            ║
-- ║     -v bep20_xafe=0x… -v bep20_depart=<bloc> \                         ║
-- ║     -v trc20_xafe=T… -v trc20_depart=<bloc> \                          ║
-- ║     -f supabase/beta/changer-de-contrat.sql                            ║
-- ║                                                                        ║
-- ║  Un réseau configuré sans son nouveau contrat fait tout refuser. Puis  ║
-- ║  relancer le veilleur et mise-en-service verifier. Dire aux testeurs,  ║
-- ║  sur le bandeau, que les XAFe de l'ancien contrat ne valent plus rien. ║
-- ╚════════════════════════════════════════════════════════════════════════╝
\set ON_ERROR_STOP on
\if :{?bep20_xafe}
\else
\set bep20_xafe ''
\endif
\if :{?bep20_depart}
\else
\set bep20_depart ''
\endif
\if :{?trc20_xafe}
\else
\set trc20_xafe ''
\endif
\if :{?trc20_depart}
\else
\set trc20_depart ''
\endif

select set_config('changer.bep20_xafe', :'bep20_xafe', false), set_config('changer.bep20_depart', :'bep20_depart', false),
       set_config('changer.trc20_xafe', :'trc20_xafe', false), set_config('changer.trc20_depart', :'trc20_depart', false) \gset changer_

do $$
declare
  r text; v_x text; v_d text; v_e numeric; v_ref text; v_bilan text := '';
  v_jour text := to_char(now(), 'YYYYMMDD');
begin
  if not coalesce((parametre('beta') ->> 'actif')::boolean, false) then
    raise exception 'refusé : la bêta n''est pas active (parametre beta.actif) — ce script ne touche jamais la production';
  end if;
  if not coalesce((parametre('chaine') ->> 'essai')::boolean, false) then
    raise exception 'refusé : chaine.essai n''est pas vrai — ce script ne sert que sur les réseaux d''essai';
  end if;
  -- le veilleur doit être arrêté ; s'il ne l'est pas, il attend ici la fin du changement
  lock table reserve_chaine, chaine_mouvements_jeton, chaine_curseurs, emissions in exclusive mode;

  foreach r in array array['bep20', 'trc20'] loop
    v_x := current_setting('changer.' || r || '_xafe');
    v_d := current_setting('changer.' || r || '_depart');
    if v_x = '' then
      if jsonb_typeof(parametre('chaine') -> r) = 'object' and coalesce(parametre('chaine') -> r ->> 'xafe', '') <> '' then
        raise exception 'refusé : % est configuré — donner son nouveau contrat (-v %_xafe=… -v %_depart=<bloc>)', r, r, r;
      end if;
      continue;
    end if;
    if v_d !~ '^[0-9]+$' then raise exception 'refusé : %_depart doit être le bloc du déploiement (un nombre), reçu « % »', r, v_d; end if;
    if v_x = coalesce(parametre('chaine') -> r ->> 'xafe', '') then
      raise exception 'refusé : % est déjà le contrat de % — rien à changer (le script a-t-il déjà tourné ?)', v_x, r;
    end if;
    -- un retrait de XAFe pas encore joué partirait sur le nouveau contrat sans y être attendu
    if exists (select 1 from retraits_crypto where reseau = r and actif = 'XAFe' and etat in ('en_attente', 'en_cours')) then
      raise exception 'refusé : des retraits XAFe % sont encore en cours — les laisser finir (ou les annuler) avant de changer de contrat', r;
    end if;

    -- E : les XAFe d'essai restés sur des wallets externes de l'ANCIEN contrat
    select coalesce((select sum(e.montant) from emissions e join retraits_crypto x on x.reference = e.source_id
                      where e.sens = 'vers_chaine' and e.source_table = 'retraits_crypto' and x.reseau = r), 0)
         - coalesce((select sum(e.montant) from emissions e join transferts_crypto t on t.id::text = e.source_id
                      where e.sens = 'depuis_chaine' and e.source_table = 'transferts_crypto' and t.reseau = r), 0)
      into v_e;
    if v_e > 0 then
      v_ref := r || '-' || v_jour;
      perform _mouvement(compte_maison(), 'XAFe', v_e, 0, 'rebase_essai', 'rebase_essai', v_ref);
      insert into emissions (sens, montant, source_table, source_id) values ('depuis_chaine', v_e, 'rebase_essai', v_ref);
    end if;

    -- le jeton se relit sur le nouveau contrat, depuis son déploiement
    delete from chaine_mouvements_jeton where reseau = r;
    delete from chaine_curseurs where reseau = r || ':jeton';

    update parametres set valeur = valeur || jsonb_build_object(r,
      case when jsonb_typeof(valeur -> r) = 'object' then valeur -> r else '{}'::jsonb end
      || jsonb_build_object('xafe', v_x, 'depart', v_d::bigint, 'depuis_le', now())), maj_le = now()
     where cle = 'chaine';
    v_bilan := v_bilan || format(' %s → %s (bloc %s, %s XAFe rendus à la maison) ;', r, v_x, v_d, v_e);
  end loop;

  if v_bilan = '' then raise exception 'refusé : aucun nouveau contrat donné (-v bep20_xafe=… / -v trc20_xafe=…)'; end if;

  -- toute la réserve se rejoue sur le nouveau contrat, dans l'ordre ; les références y sont neuves
  update reserve_chaine set etat = 'a_faire', tx_hash = null, tx_brut = null, bloc = null, resultat = null, traite_le = null
   where reseau = _reseau_de_la_reserve();

  raise notice 'contrats changés :%', v_bilan;
end $$;

-- Ce qui doit tenir à la fin : la somme des soldes vaut la circulation.
do $$
declare v_t numeric := (select coalesce(sum(disponible + bloque), 0) from soldes where actif = 'XAFe');
begin
  if v_t <> circulation() then
    raise exception 'la somme des soldes XAFe (%) ne vaut plus la circulation (%) — rien n''est écrit', v_t, circulation();
  end if;
end $$;
