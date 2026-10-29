/*
 * Le vrai moteur : connexion par mot de passe puis application
 * d'authentification (Supabase Auth, 0035), puis les RPC admin_* — chacune
 * gardée en base par admin_a_droit(), qui exige cette session complète.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Enrolement, GesteSortie, GuichetAdmin } from "./guichet";
import { AUTH_VIDE, premierFacteurDe, type EtatAuth } from "../noyau/entree";
import type { ATraiter, Client, ClientDetail, Declaration, Entree, LigneJournal, Marche, Parametres, Profil, Retenue, Sortie, SortieNonExpliquee, StatsClients, Equipe, Tableau, Terminal, Wallets, ReseauRegistre, Beta, Signalement } from "./types";
import type { Parite, SecuriteUtilisateur } from "./types";
import { verifierPreuve } from "./preuve";

export class ErreurMoteur extends Error {
  detail?: string;
  constructor(message: string, detail?: string) { super(message); this.detail = detail; }
}

/** Les refus d'Auth, dits en mots (le code d'Auth d'abord, son texte anglais ensuite). */
function erreurAuth(e: { message: string; code?: string; status?: number }): ErreurMoteur {
  switch (e.code ?? "") {
    case "invalid_credentials": return new ErreurMoteur("adresse ou mot de passe incorrect");
    case "email_not_confirmed": return new ErreurMoteur("adresse pas encore confirmée", "un code vient de partir : entrez-le");
    case "user_already_exists": case "email_exists": return new ErreurMoteur("cette adresse a déjà un mot de passe", "connectez-vous, ou « mot de passe oublié »");
    case "weak_password": return new ErreurMoteur("mot de passe trop faible", "dix caractères au moins, des lettres et des chiffres ; pas un mot de passe déjà fuité");
    case "same_password": return new ErreurMoteur("choisissez un mot de passe différent");
    case "over_email_send_rate_limit": case "over_request_rate_limit": return new ErreurMoteur("trop de demandes : attendez une minute");
    case "mfa_verification_failed": case "mfa_challenge_expired": return new ErreurMoteur("code de l'application incorrect ou expiré", "tapez celui qui s'affiche maintenant");
    case "otp_expired": case "otp_disabled": return new ErreurMoteur("code incorrect ou expiré", "demandez-en un nouveau si besoin");
    case "session_not_found": case "refresh_token_not_found": return new ErreurMoteur("session expirée", "reconnectez-vous");
    default: return new ErreurMoteur(/rate limit|too many|seconds/i.test(e.message) ? "trop de demandes : attendez une minute" : e.message);
  }
}

const emailNormalise = (e: string) => e.trim().toLowerCase();

export class GuichetSupabase implements GuichetAdmin {
  readonly mode = "supabase" as const;
  private sb: SupabaseClient;
  private auditeurs = new Set<() => void>();

  constructor(url: string, cleAnon: string) {
    this.sb = createClient(url, cleAnon, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "xafe-admin-auth" } });
    this.sb.auth.onAuthStateChange(() => { for (const cb of this.auditeurs) cb(); });
  }

  private async rpc<T>(nom: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.sb.rpc(nom, args);
    if (error) throw new ErreurMoteur(error.message, error.details || undefined);
    return data as T;
  }

  async session() {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) return null;
    /* avant la session complète, la base ne dit rien : inutile de demander */
    const aal = await this.sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal.data?.currentLevel !== "aal2") return null;
    return (await this.rpc<Profil | null>("mon_profil_admin").catch(() => null)) ?? null;
  }

  async etatAuth(): Promise<EtatAuth> {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) return { ...AUTH_VIDE };
    const [aal, etat] = await Promise.all([
      this.sb.auth.mfa.getAuthenticatorAssuranceLevel(),
      this.rpc<Record<string, unknown> | null>("mon_etat_d_entree"),
    ]);
    if (aal.error) throw erreurAuth(aal.error);
    const niveau = (v: unknown) => (v === "aal1" || v === "aal2" ? v : null);
    return {
      session: true,
      premierFacteur: premierFacteurDe(aal.data.currentAuthenticationMethods as ({ method?: string } | string)[]),
      aalActuel: niveau(aal.data.currentLevel), aalSuivant: niveau(aal.data.nextLevel),
      emailConfirme: Boolean(etat?.email_confirme), motDePasse: Boolean(etat?.mot_de_passe), codesDeSecours: Boolean(etat?.codes_de_secours),
    };
  }
  async connecter(email: string, motDePasse: string) {
    const e = emailNormalise(email);
    const { error } = await this.sb.auth.signInWithPassword({ email: e, password: motDePasse });
    if (!error) return;
    if (error.code === "email_not_confirmed") await this.renvoyerConfirmation(e).catch(() => undefined);
    throw erreurAuth(error);
  }
  async premiereConnexion(email: string, motDePasse: string) {
    const { data, error } = await this.sb.auth.signUp({ email: emailNormalise(email), password: motDePasse, options: { data: { langue: "fr" } } });
    if (error) throw erreurAuth(error);
    /* une adresse déjà confirmée : Auth rend un utilisateur sans identité, pour ne rien dire à un curieux */
    if ((data.user?.identities?.length ?? 1) === 0) throw new ErreurMoteur("cette adresse a déjà un mot de passe", "connectez-vous, ou « mot de passe oublié »");
  }
  async confirmerEmail(email: string, code: string, motDePasse: string | null) {
    const e = emailNormalise(email);
    const { error } = await this.sb.auth.verifyOtp({ email: e, token: code, type: "signup" });
    if (error) throw error.code === "over_request_rate_limit" ? erreurAuth(error) : new ErreurMoteur("code incorrect ou expiré", "demandez-en un nouveau si besoin");
    /* le code ouvre une session « otp », jamais forte : on entre aussitôt par le mot de passe encore en mémoire */
    if (motDePasse && !(await this.sb.auth.signInWithPassword({ email: e, password: motDePasse })).error) return;
    await this.sb.auth.signOut({ scope: "local" });
  }
  async renvoyerConfirmation(email: string) {
    const { error } = await this.sb.auth.resend({ type: "signup", email: emailNormalise(email) });
    if (error) throw erreurAuth(error);
  }
  async enrolerDeuxFacteurs(): Promise<Enrolement> {
    /* un essai abandonné (facteur jamais vérifié) bloquerait le suivant : on le retire d'abord */
    const { data: l } = await this.sb.auth.mfa.listFactors();
    for (const f of l?.all ?? []) if (f.factor_type === "totp" && f.status === "unverified") await this.sb.auth.mfa.unenroll({ factorId: f.id }).catch(() => undefined);
    const quand = new Date().toISOString().slice(0, 16).replace("T", " ");
    const { data, error } = await this.sb.auth.mfa.enroll({ factorType: "totp", issuer: "Glisil Administration", friendlyName: `Glisil admin ${quand}` });
    if (error || !data) throw erreurAuth(error ?? { message: "aucune application d'authentification" });
    return { facteurId: data.id, secret: data.totp.secret, uri: data.totp.uri, qr: data.totp.qr_code };
  }
  async confirmerDeuxFacteurs(facteurId: string, code: string) {
    const { error } = await this.sb.auth.mfa.challengeAndVerify({ factorId: facteurId, code });
    if (error) throw erreurAuth(error);
  }
  async verifierDeuxFacteurs(code: string) {
    const { data } = await this.sb.auth.mfa.listFactors();
    const f = data?.totp?.[0];
    if (!f) throw new ErreurMoteur("aucune application d'authentification");
    const { error } = await this.sb.auth.mfa.challengeAndVerify({ factorId: f.id, code });
    if (error) throw erreurAuth(error);
  }
  async genererCodesDeSecours() {
    const r = await this.rpc<{ codes?: unknown[] } | null>("generer_codes_de_secours");
    return (r?.codes ?? []).map(String);
  }
  async confirmerCodesDeSecours() { await this.rpc("confirmer_codes_de_secours"); }
  async utiliserCodeDeSecours(code: string) {
    const { data, error } = await this.sb.functions.invoke("deux-facteurs", { body: { action: "code_de_secours", code } });
    let j = (data ?? null) as Record<string, unknown> | null;
    if (error) {
      const contexte = (error as { context?: Response }).context;
      j = contexte && typeof contexte.json === "function" ? ((await contexte.json().catch(() => null)) as Record<string, unknown> | null) : null;
      if (!j || typeof j.erreur !== "string") throw new ErreurMoteur(error.message);
    }
    if (j && typeof j.erreur === "string") {
      const reste = typeof j.essais_restants === "number" ? `${j.essais_restants} essai(s) restant(s)` : typeof j.verrou_jusqua === "string" ? `jusqu'à ${new Date(j.verrou_jusqua).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : undefined;
      throw new ErreurMoteur(j.erreur, reste);
    }
    /* le facteur est parti : le jeton relu redescend, et l'entrée mène à l'enrôlement d'une nouvelle application */
    await this.sb.auth.refreshSession();
  }
  async motDePasseOublie(email: string) {
    const { error } = await this.sb.auth.resetPasswordForEmail(emailNormalise(email));
    if (error) throw erreurAuth(error);
  }
  async verifierCodeDeReinitialisation(email: string, code: string) {
    const { error } = await this.sb.auth.verifyOtp({ email: emailNormalise(email), token: code, type: "recovery" });
    if (error) throw error.code === "over_request_rate_limit" ? erreurAuth(error) : new ErreurMoteur("code incorrect ou expiré", "demandez-en un nouveau si besoin");
  }
  async nouveauMotDePasse(motDePasse: string) {
    const { error } = await this.sb.auth.updateUser({ password: motDePasse });
    if (error) throw erreurAuth(error);
    await this.sb.auth.signOut({ scope: "global" });
  }
  async entrer() {
    /* l'invitation devient la fiche d'administrateur ici, au premier passage */
    const p = await this.rpc<Profil | null>("entrer_administration");
    if (!p) { await this.sb.auth.signOut(); throw new ErreurMoteur("cette adresse n'administre pas Glisil", "demandez au super administrateur de vous inviter"); }
    return p;
  }
  async deconnecter(portee: "local" | "global" = "local") { await this.sb.auth.signOut({ scope: portee }); }

  tableau() { return this.rpc<Tableau>("admin_tableau"); }
  entrees(etat?: string | null) { return this.rpc<Entree[]>("admin_entrees", { p_etat: etat ?? null, p_n: 200 }); }
  retenues(etat: "retenue" | "rapprochee" | "remboursee" | "rejetee" = "retenue") { return this.rpc<Retenue[]>("admin_retenues", { p_etat: etat, p_n: 200 }); }
  rapprocher(id: number, reference: string) { return this.rpc<Declaration>("admin_rapprocher_retenue", { p_id: id, p_reference: reference }); }
  rembourser(id: number, note: string) { return this.rpc<{ montant: number; numero: string }>("admin_rembourser_retenue", { p_id: id, p_note: note }); }
  liberer(id: number, ancrer: boolean, note: string) { return this.rpc<{ credite: boolean; reference?: string; reexaminees?: number }>("admin_liberer_retenue", { p_id: id, p_ancrer: ancrer, p_note: note }); }
  async rejeter(id: number, note: string) { await this.rpc("admin_rejeter_retenue", { p_id: id, p_note: note }); }
  sorties(etat?: string | null) { return this.rpc<Sortie[]>("admin_sorties", { p_etat: etat ?? null, p_n: 200 }); }
  async libererCommande(id: number) { await this.rpc("admin_liberer_commande", { p_id: id }); }
  async reaffecterCommande(id: number, terminal: string) { await this.rpc("admin_reaffecter_commande", { p_id: id, p_terminal: terminal }); }
  async prendreSortie(reference: string) { await this.rpc("admin_prendre_sortie", { p_reference: reference }); }
  payerSortie(reference: string, transactionId: string, preuve: string | null, montant?: number | null) {
    return this.rpc<GesteSortie>("admin_payer_sortie", { p_reference: reference, p_transaction_id: transactionId, p_preuve: preuve, p_montant: montant ?? null });
  }
  confirmerSortie(reference: string) { return this.rpc<GesteSortie>("admin_confirmer_sortie", { p_reference: reference }); }
  verifierSortie(reference: string) { return this.rpc<GesteSortie>("admin_verifier_sortie", { p_reference: reference }); }
  corrigerPaiement(reference: string, ancien: string, nouveau: string, note: string, montant?: number | null) {
    return this.rpc<GesteSortie>("admin_corriger_paiement", { p_reference: reference, p_ancien: ancien, p_nouveau: nouveau, p_note: note, p_montant: montant ?? null });
  }
  forcerSortie(reference: string, note: string) { return this.rpc<GesteSortie>("admin_forcer_sortie", { p_reference: reference, p_note: note }); }
  async refuserSortie(reference: string, motif: string) { await this.rpc("admin_refuser_sortie", { p_reference: reference, p_motif: motif }); }
  async deposerPreuve(reference: string, fichier: File) {
    const ext = verifierPreuve(fichier);
    const chemin = `${reference}/${Date.now()}.${ext}`;
    const { error } = await this.sb.storage.from("preuves-sorties").upload(chemin, fichier, { contentType: fichier.type, upsert: false });
    if (error) throw new ErreurMoteur("la capture n'a pas pu être déposée", error.message);
    return chemin;
  }
  async lienPreuve(chemin: string) {
    const { data, error } = await this.sb.storage.from("preuves-sorties").createSignedUrl(chemin, 600);
    if (error || !data) throw new ErreurMoteur("capture introuvable", error?.message);
    return data.signedUrl;
  }
  sortiesNonExpliquees() { return this.rpc<SortieNonExpliquee[]>("admin_sorties_non_expliquees", { p_n: 100 }); }
  aTraiter() { return this.rpc<ATraiter>("admin_a_traiter"); }
  async annulerSortie(reference: string, note: string) {
    const r = await this.rpc<{ rendu: number; etat: string }>("admin_annuler_sortie", { p_reference: reference, p_note: note });
    return { rendu: Number(r.rendu), etat: String(r.etat) };
  }
  terminaux() { return this.rpc<Terminal[]>("admin_terminaux"); }
  creerTerminal({ id, nom, lieu }: { id: string; nom: string; lieu: string }) { return this.rpc<{ id: string; cle: string }>("admin_creer_terminal", { p_id: id, p_nom: nom, p_lieu: lieu }); }
  renouvelerCle(id: string) { return this.rpc<{ cle: string }>("admin_renouveler_cle", { p_id: id }); }
  async creerFloat({ operateur, numero, terminal, codeAgent, titulaire }: { operateur: string; numero: string; terminal: string; codeAgent?: string | null; titulaire?: string | null }) {
    await this.rpc("admin_creer_float", { p_operateur: operateur, p_numero: numero, p_terminal: terminal, p_code_agent: codeAgent ?? null, p_titulaire: titulaire ?? null });
  }
  async activerFloat(id: number, actif: boolean) { await this.rpc("admin_activer_float", { p_id: id, p_actif: actif }); }
  statistiquesClients() { return this.rpc<StatsClients>("admin_statistiques_clients"); }
  clients(recherche?: string, filtre?: string | null) { return this.rpc<Client[]>("admin_clients", { p_recherche: recherche ?? null, p_n: 200, p_filtre: filtre ?? null }); }
  client(id: string) { return this.rpc<ClientDetail>("admin_client", { p_id: id }); }
  securite(utilisateur: string) { return this.rpc<SecuriteUtilisateur>("admin_securite_utilisateur", { p_utilisateur: utilisateur }); }
  async reinitialiserDeuxFacteurs(utilisateur: string, motif: string) {
    /* 1 · l'autorisation, avec SA session : la base vérifie le droit, le motif, la limite du jour, et la journalise */
    const a = await this.rpc<{ id: string }>("admin_autoriser_reinitialisation_2fa", { p_utilisateur: utilisateur, p_motif: motif });
    /* 2 · l'exécution de CETTE autorisation, par la fonction (seule Auth retire un facteur) */
    const { data, error } = await this.sb.functions.invoke("deux-facteurs", { body: { action: "reinitialisation", id: a.id } });
    let j = (data ?? null) as Record<string, unknown> | null;
    if (error) {
      const contexte = (error as { context?: Response }).context;
      j = contexte && typeof contexte.json === "function" ? ((await contexte.json().catch(() => null)) as Record<string, unknown> | null) : null;
      if (!j || typeof j.erreur !== "string") throw new ErreurMoteur("la double authentification n'a pas pu être retirée", error.message);
    }
    if (j && typeof j.erreur === "string") throw new ErreurMoteur(j.erreur, typeof j.detail === "string" ? j.detail : undefined);
    return { facteurs: Number(j?.facteurs ?? 0) };
  }
  async doter(id: string, xafe: number, usdt: number, motif?: string) { return this.rpc<{ reference: string }>("admin_doter", { p_compte: id, p_xafe: xafe, p_usdt: usdt, p_motif: motif ?? null }); }
  async changerPalier(id: string, palier: number, note?: string) { await this.rpc("admin_changer_palier", { p_id: id, p_palier: palier, p_note: note ?? null }); }
  validerVerification(id: string, ok: boolean, note?: string) { return this.rpc<{ palier: number }>("admin_valider_verification", { p_id: id, p_ok: ok, p_note: note ?? null }); }
  async desactiverCompte(id: string, actif: boolean, note?: string) { await this.rpc("admin_desactiver_compte", { p_id: id, p_actif: actif, p_note: note ?? null }); }
  equipe() { return this.rpc<Equipe>("admin_equipe"); }
  async inviterAdministrateur({ email, nom, role }: { email: string; nom: string; role: string }) { await this.rpc("admin_inviter_administrateur", { p_email: email, p_nom: nom, p_role: role }); }
  async retirerInvitation(email: string) { await this.rpc("admin_retirer_invitation", { p_email: email }); }
  async changerRole(id: string, role: string) { await this.rpc("admin_changer_role", { p_id: id, p_role: role }); }
  async activerAdministrateur(id: string, actif: boolean) { await this.rpc("admin_desactiver_administrateur", { p_id: id, p_actif: actif }); }
  marche() { return this.rpc<Marche>("admin_marche"); }
  parametres() { return this.rpc<Parametres>("admin_parametres"); }
  async modifierParametre(cle: string, valeur: unknown) { await this.rpc("admin_modifier_parametre", { p_cle: cle, p_valeur: valeur }); }
  journal() { return this.rpc<LigneJournal[]>("admin_journal", { p_n: 200 }); }
  wallets() { return this.rpc<Wallets>("admin_wallets"); }
  reseaux() { return this.rpc<ReseauRegistre[]>("admin_reseaux"); }
  async activerReseau(id: string, actif: boolean) { await this.rpc("admin_activer_reseau", { p_id: id, p_actif: actif }); }
  parite() { return this.rpc<Parite>("admin_parite"); }
  async rapprocherMaintenant() { await this.rpc("admin_rapprocher_maintenant"); }
  async saisirReleve(floatId: number, solde: number, annonceLe: string, preuve: string, note?: string) {
    await this.rpc("admin_saisir_releve", { p_float: floatId, p_solde: solde, p_annonce_le: annonceLe, p_preuve: preuve, p_note: note ?? null });
  }
  async deposerReleve(floatId: number, fichier: File) {
    const ext = verifierPreuve(fichier);
    const chemin = `${floatId}/${Date.now()}.${ext}`;
    const { error } = await this.sb.storage.from("releves-floats").upload(chemin, fichier, { contentType: fichier.type, upsert: false });
    if (error) throw new ErreurMoteur("le relevé n'a pas pu être déposé", error.message);
    return chemin;
  }
  async lienReleve(chemin: string) {
    const { data, error } = await this.sb.storage.from("releves-floats").createSignedUrl(chemin, 600);
    if (error || !data) throw new ErreurMoteur("relevé introuvable", error?.message);
    return data.signedUrl;
  }

  beta() { return this.rpc<Beta>("admin_beta"); }
  signalements(etat?: Signalement["etat"] | null) { return this.rpc<Signalement[]>("admin_signalements", { p_etat: etat ?? null, p_limite: 200 }); }
  async traiterSignalement(id: number, etat: Signalement["etat"], note?: string) { await this.rpc("admin_traiter_signalement", { p_id: id, p_etat: etat, p_note: note ?? null }); }
  releverLeCours() { return this.rpc<{ pose: boolean; erreur?: string | null }>("admin_relever_le_cours"); }
  poserLeCours(eurUsd: number) { return this.rpc<{ prix: number }>("admin_poser_le_cours", { p_eur_usd: eurUsd }); }

  surChangement(cb: () => void) { this.auditeurs.add(cb); return () => { this.auditeurs.delete(cb); }; }
}
