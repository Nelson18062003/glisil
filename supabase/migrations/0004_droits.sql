-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  XAFe Exchange · 0004 · les droits, en un seul endroit                 ║
-- ║  Chez Supabase, anon et authenticated reçoivent d'office EXECUTE sur   ║
-- ║  toute fonction et ALL sur toute table de public. « revoke … from      ║
-- ║  public » ne leur retire rien : une fonction de service (totem_*,      ║
-- ║  chaine_*, crediter_crypto, _mouvement) était donc de l'argent gratuit ║
-- ║  pour n'importe quel client. Ici on ferme TOUT, puis on ouvre la       ║
-- ║  liste — et le harnais (scénario 8) vérifie qu'il n'y a rien d'autre.  ║
-- ╚════════════════════════════════════════════════════════════════════════╝

revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;

-- ─────────────────────────── ce que lit un client ──────────────────────────
-- Toujours à travers sa politique (RLS) : ses lignes, rien d'autre. Ces
-- lectures servent surtout au temps réel ; les écrans passent par les RPC.
-- Aucune table ne s'écrit en direct.
grant select on parametres, operateurs, comptes, numeros, soldes, ecritures, depots, depot_paiements, depot_declarations,
                notifications, sorties, adresses_crypto, transferts_crypto, ordres, executions, retraits_crypto
  to authenticated;
-- l'administrateur lit sa propre fiche (politique lire_sa_fiche)
grant select on administrateurs to authenticated;

-- ─────────────────────────── ce qu'appelle un client ───────────────────────
-- Chacune lit auth.uid() et n'agit que sur le compte de la session.
grant execute on function
  -- dépôts
  ouvrir_depot(text, text), mon_depot(text), mes_depots_en_attente(),
  declarer_transaction(text, text), retirer_declaration(text, text), terminer_depot(text), annuler_depot(text),
  -- le compte
  mon_compte(), completer_profil(text, text), verifier_code_secret(text), changer_code_secret(text, text),
  demander_verification(text, jsonb), mes_notifications(), marquer_notifications_lues(),
  -- les numéros
  mes_numeros(), ajouter_numero(text, text), confirmer_numero(uuid, text), renvoyer_code_numero(uuid), retirer_numero(uuid, text),
  -- les sorties : seulement la version AVEC le code secret
  demander_sortie(numeric, uuid, text, text), ma_sortie(text),
  -- le marché
  placer_ordre(text, text, numeric, numeric, text), annuler_ordre(uuid), mes_ordres(), mon_ordre(uuid), mes_soldes(),
  carnet(int), transactions_recentes(int), cotation(), chandelles(int, int), parametres_publics(),
  -- la crypto
  adresse_depot(text, text), demander_retrait_crypto(text, text, text, numeric, text, text), mon_retrait_crypto(text),
  -- l'historique
  mon_historique(int), mon_operation(text)
  to authenticated;

-- ─────────────────────────── ce qu'appelle l'équipe ────────────────────────
-- Toutes gardées DANS la fonction par _exiger_droit('<droit>') : un client qui
-- les appelle reçoit « accès non autorisé ».
grant execute on function
  mon_profil_admin(), admin_a_droit(text),
  admin_creer_administrateur(uuid, text, text, text), admin_desactiver_administrateur(uuid, boolean),
  admin_tableau(), admin_entrees(text, int), admin_retenues(text, int),
  admin_rapprocher_retenue(bigint, text), admin_rembourser_retenue(bigint, text), admin_liberer_remboursement(bigint),
  admin_sorties(text, int), admin_liberer_commande(bigint), admin_reaffecter_commande(bigint, text), admin_annuler_sortie(text, text),
  admin_terminaux(), admin_creer_terminal(text, text, text), admin_renouveler_cle(text),
  admin_creer_float(text, text, text, text), admin_activer_float(int, boolean),
  admin_clients(text, int, text), admin_client(uuid), admin_changer_palier(uuid, int, text),
  admin_valider_verification(uuid, boolean, text), admin_desactiver_compte(uuid, boolean, text),
  admin_marche(), admin_parametres(), admin_modifier_parametre(text, jsonb), admin_journal(int)
  to authenticated;

-- ─────────────────────────── la clé de service ─────────────────────────────
-- Les portes de TOTEM (edge functions) et le veilleur de chaîne : totem_*,
-- chaine_resultat_retrait, crediter_crypto, expirer_depots.
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ─────────────────────── les pièces des vérifications ──────────────────────
-- Le stockage « verifications » : privé ; un client dépose et relit dans SON
-- dossier (« <id du compte>/… ») ; l'équipe qui valide les paliers lit tout.
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  -- Les colonnes « public », « file_size_limit », « allowed_mime_types » sont
  -- ajoutées par le service de stockage lui-même, pas par la base : sur une
  -- base neuve elles n'existent pas encore. On crée le stockage avec ce qui
  -- existe toujours, puis on pose les bornes si leurs colonnes sont là.
  insert into storage.buckets (id, name) values ('verifications', 'verifications') on conflict (id) do nothing;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public') then
    execute $p$update storage.buckets set public = false where id = 'verifications'$p$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $p$update storage.buckets set file_size_limit = 10485760,
                 allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] where id = 'verifications'$p$;
  end if;
  execute $p$drop policy if exists verifications_deposer on storage.objects$p$;
  execute $p$drop policy if exists verifications_relire on storage.objects$p$;
  execute $p$create policy verifications_deposer on storage.objects for insert to authenticated
            with check (bucket_id = 'verifications' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  execute $p$create policy verifications_relire on storage.objects for select to authenticated
            using (bucket_id = 'verifications'
                   and ((storage.foldername(name))[1] = auth.uid()::text or public.admin_a_droit('paliers')))$p$;
end $$;
