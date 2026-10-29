/*
 * LE GUICHET SUPABASE : le vrai moteur. L'authentification est celle de
 * Supabase Auth : une adresse e-mail et un mot de passe (ou Google), un code
 * à six chiffres reçu par e-mail pour confirmer l'adresse, puis une
 * application d'authentification (TOTP) à chaque connexion — la base
 * n'ouvre rien à une session qui n'est pas à aal2 (0035). Tout le reste passe
 * par les RPC du moteur (supabase/migrations). Les écritures ne touchent
 * jamais une table : la base décide, l'écran montre.
 */
import { createClient, type AuthError, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { ErreurMoteur, type DonneesDuRefus } from "../noyau/erreurs";
import { t, langue } from "../noyau/langue";
import { emailNormalise } from "../noyau/identite";
import { numeroSaisi, transactionIdNormalise } from "../noyau/format";
import { ENTREE_VIDE, premierFacteurDe } from "../noyau/entree";
import { coqueActuelle, lireRetourOAuth, voieGoogle } from "../noyau/google";
import type { EvenementDEntree, Guichet } from "./guichet";
import type { PreuveDeReserve } from "./types";
import type {
  Actif, Carnet, Chandelle, Intervalle, PageDeBougies, Compte, Cote, Cotation, Declaration, Depot, TraceChaine, DevisRapide, Execution, IdOperateur, Notification, Numero, Operation, Ordre, ProfilInscription, SensRapide,
  Reseau, ResultatOrdre, RetraitCrypto, Soldes, Sortie, Transaction, TransfertCrypto, TypeOrdre,
  EtatDEntree, EnrolementTotp, EtatCodesDeSecours, OperationAVerifier, Verification, EtatVerification, PreuveDeVerification,
} from "./types";

type J = Record<string, unknown>;
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const sn = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/**
 * Les refus de Supabase Auth, ramenés aux clés françaises que noyau/erreurs.ts
 * sait dire (dans la langue de l'écran) — d'après leur CODE (AuthError.code),
 * pas d'après une phrase anglaise qui peut changer d'une version à l'autre.
 */
function erreurAuth(e: AuthError | { message: string; code?: string }): ErreurMoteur {
  const code = (e as { code?: string }).code ?? "";
  const m = e.message ?? "";
  switch (code) {
    case "invalid_credentials": return new ErreurMoteur("adresse ou mot de passe incorrect"); // langue-ok
    case "email_not_confirmed": return new ErreurMoteur("adresse e-mail non confirmée"); // langue-ok
    case "weak_password": {
      const raisons = (e as { reasons?: string[] }).reasons ?? [];
      return new ErreurMoteur("mot de passe trop faible", raisons.includes("pwned") ? t("ce mot de passe a déjà fuité sur un autre site", "this password has already leaked on another site") : undefined); // langue-ok
    }
    case "user_already_exists": case "email_exists": return new ErreurMoteur("cette adresse a déjà un compte"); // langue-ok
    case "over_email_send_rate_limit": case "over_request_rate_limit": return new ErreurMoteur("trop de demandes : attendez une minute"); // langue-ok
    case "otp_expired": return new ErreurMoteur("code incorrect ou expiré", t("demandez-en un nouveau si besoin", "request a new one if needed")); // langue-ok
    case "mfa_verification_failed": case "mfa_challenge_expired": return new ErreurMoteur("code de l'application incorrect"); // langue-ok
    case "insufficient_aal": return new ErreurMoteur("double authentification requise"); // langue-ok
    case "same_password": return new ErreurMoteur("choisissez un mot de passe différent"); // langue-ok
    case "reauthentication_needed": case "reauthentication_not_valid": case "reauth_nonce_missing": return new ErreurMoteur("confirmation par e-mail nécessaire"); // langue-ok
    case "email_address_invalid": case "validation_failed": return new ErreurMoteur(/email/i.test(m) ? "adresse e-mail invalide" : m); // langue-ok
    case "signup_disabled": case "email_provider_disabled": return new ErreurMoteur("les inscriptions sont fermées pour le moment"); // langue-ok
    default:
      if (/rate limit|too many/i.test(m)) return new ErreurMoteur("trop de demandes : attendez une minute"); // langue-ok
      if (/invalid.*email|email.*invalid/i.test(m)) return new ErreurMoteur("adresse e-mail invalide"); // langue-ok
      if (/signups? not allowed/i.test(m)) return new ErreurMoteur("les inscriptions sont fermées pour le moment"); // langue-ok
      return new ErreurMoteur(m);
  }
}

/** Ce qu'un refus compté rend en plus de sa phrase : essais restants, verrou, facteur en cause. */
function donneesDuRefus(j: J): DonneesDuRefus {
  return { essaisRestants: nn(j.essais_restants), verrouJusqua: sn(j.verrou_jusqua), facteur: sn(j.facteur) };
}
/** Le détail qu'on lit sous le titre : les essais qui restent, ou l'heure où le verrou se lève. */
function detailDuRefus(d: DonneesDuRefus): string | undefined {
  if (d.verrouJusqua) {
    const h = new Date(d.verrouJusqua).toLocaleTimeString(langue() === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit" });
    return t(`jusqu'à ${h}`, `until ${h}`);
  }
  if (d.essaisRestants != null) return t(`${d.essaisRestants} essai(s) restant(s)`, `${d.essaisRestants} attempt(s) left`);
  return undefined;
}

/* ----------------------------------------------------- lectures du moteur */

/** Le moteur rend NULL pour une référence qui n'est pas sur ce compte : c'est « inconnu », pas un objet vide à démonter. */
function trouve(j: J | null, message: string): J {
  if (!j || typeof j !== "object") throw new ErreurMoteur(message);
  return j;
}

function declaration(j: J): Declaration {
  return {
    id: s(j.id), transactionId: s(j.transaction_id), etat: j.etat as Declaration["etat"], montant: nn(j.montant), numeroPayeur: sn(j.numero_payeur), motif: sn(j.motif),
    declareLe: s(j.declare_le), crediteLe: sn(j.credite_le), luLe: sn(j.lu_le),
    numeroDeclare: sn(j.numero_declare), montantDeclare: nn(j.montant_declare), nomDeclare: sn(j.nom_declare), corrigible: Boolean(j.corrigible),
  };
}
function depot(j: J): Depot {
  return {
    reference: s(j.reference), operateur: j.operateur as IdOperateur, floatNumero: s(j.float_numero), titulaire: sn(j.titulaire), codeAgent: sn(j.code_agent),
    reception: j.reception === "retardee" || j.reception === "fermee" ? j.reception : "ouverte", montantRecu: n(j.montant_recu),
    etat: j.etat as Depot["etat"], creeLe: s(j.cree_le), expireLe: s(j.expire_le), crediteLe: sn(j.credite_le),
    declarations: ((j.declarations as J[]) ?? []).map(declaration),
    chaine: ((j.chaine as J[] | undefined) ?? []).map(trace),
  };
}
function trace(j: J): TraceChaine {
  return {
    reseau: j.reseau as Reseau, operation: j.operation === "detruire" ? "detruire" : "frapper", montant: n(j.montant), reference: s(j.reference),
    etat: (["a_faire", "envoye", "confirme", "echoue"].includes(s(j.etat)) ? j.etat : "a_faire") as TraceChaine["etat"],
    txHash: sn(j.tx_hash), bloc: nn(j.bloc), essai: Boolean(j.essai), contrat: sn(j.contrat), reserve: sn(j.reserve),
    explorateur: sn(j.explorateur), empreinte: sn(j.empreinte), relue: Boolean(j.relue), confirmeLe: sn(j.confirme_le),
  };
}
function devis(j: J): DevisRapide {
  return {
    id: sn(j.id), sens: j.sens as SensRapide, quantite: n(j.quantite), total: n(j.total), prix: n(j.prix), frais: n(j.frais), marge: n(j.marge),
    etat: j.id ? ((j.etat as DevisRapide["etat"]) ?? "propose") : "estimation", expireLe: sn(j.expire_le), ordre: sn(j.ordre),
  };
}
function sortie(j: J): Sortie {
  return {
    reference: s(j.reference), operateur: j.operateur as IdOperateur, numero: s(j.numero), montant: n(j.montant), frais: n(j.frais), montantXaf: n(j.montant_xaf),
    montantEnvoye: n(j.montant_envoye), montantRendu: n(j.montant_rendu), etat: j.etat as Sortie["etat"], creeLe: s(j.cree_le), termineeLe: sn(j.terminee_le),
    transferts: ((Array.isArray(j.transferts) ? j.transferts : []) as J[]).map((t) => ({ etat: t.etat as Sortie["transferts"][number]["etat"], montant: n(t.montant_xafe), envoi: n(t.montant_envoye), referenceOperateur: sn(t.reference_operateur) })),
    mode: j.mode === "manuel" ? "manuel" : "totem", nomBeneficiaire: sn(j.nom_beneficiaire), prisLe: sn(j.pris_le),
    transactionId: sn(j.transaction_id), payeeLe: sn(j.payee_le), motif: sn(j.motif),
  };
}
function ordre(j: J): Ordre {
  return {
    id: s(j.id), numero: s(j.numero), cote: j.cote as Cote, type: j.type as TypeOrdre, prix: nn(j.prix), quantite: n(j.quantite), restant: n(j.restant), executee: n(j.executee),
    totalXafe: n(j.total_xafe), bloque: n(j.bloque), prixMoyen: nn(j.prix_moyen), etat: j.etat as Ordre["etat"], creeLe: s(j.cree_le), majLe: s(j.maj_le),
    rapide: j.rapide && typeof j.rapide === "object" ? { total: n((j.rapide as J).total), frais: n((j.rapide as J).frais) } : null,
  };
}
function execution(j: J, cote: Cote): Execution {
  const preneur = Boolean(j.preneur) === (cote === "achat") ? Boolean(j.preneur_est_acheteur ?? j.preneur) : false;
  return {
    id: s(j.id), prix: n(j.prix), quantite: n(j.quantite), montantXafe: n(j.montant_xafe), cote,
    frais: cote === "achat" ? n(j.frais_acheteur) : n(j.frais_vendeur), fraisActif: cote === "achat" ? "USDT" : "XAFe",
    preneur: typeof j.mon_role === "string" ? j.mon_role === "preneur" : preneur, quand: s(j.cree_le),
  };
}
function numero(j: J): Numero {
  return { id: s(j.id), operateur: j.operateur as IdOperateur, numero: s(j.numero), verifieLe: sn(j.verifie_le), actifDes: s(j.actif_des), retireLe: sn(j.retire_le) };
}
function compte(j: J): Compte {
  return {
    id: s(j.id), telephone: s(j.telephone), nom: sn(j.nom), entreprise: sn(j.entreprise), palier: Number(j.palier ?? 0) as Compte["palier"],
    email: sn(j.email), prenom: sn(j.prenom), nomDeFamille: sn(j.nom_de_famille), dateNaissance: sn(j.date_naissance), ville: sn(j.ville), pays: sn(j.pays),
    verificationEnCours: (j.verification_en_cours as Compte["verificationEnCours"]) ?? null,
    entreDuJour: n(j.entre_du_jour),
    /* une base d'avant 0012 ne dit rien des conditions : on ne bloque personne pour ça */
    conditionsAJour: j.conditions_a_jour === undefined ? true : Boolean(j.conditions_a_jour),
    fermeLe: sn(j.ferme_le), desactive: Boolean(j.desactive),
  };
}
function retrait(j: J): RetraitCrypto {
  return { reference: s(j.reference), actif: j.actif as Actif, reseau: j.reseau as Reseau, adresse: s(j.adresse), montant: n(j.montant), frais: n(j.frais), etat: j.etat as RetraitCrypto["etat"], txHash: sn(j.tx_hash), creeLe: s(j.cree_le) };
}
function transfert(j: J): TransfertCrypto {
  return { id: s(j.id), actif: j.actif as Actif, reseau: j.reseau as Reseau, sens: j.sens as TransfertCrypto["sens"], montant: n(j.montant), txHash: s(j.tx_hash), adresse: s(j.adresse), quand: s(j.cree_le) };
}
function operation(j: J): Operation | null {
  const d = (j.detail as J) ?? {};
  switch (j.nature) {
    case "depot": { const x = depot(d); return { nature: "depot", reference: x.reference, quand: x.crediteLe ?? x.creeLe, etat: x.etat, montant: x.montantRecu, detail: x }; }
    case "sortie": { const x = sortie(d); return { nature: "sortie", reference: x.reference, quand: x.creeLe, etat: x.etat, montant: -x.montant, detail: x }; }
    case "ordre": { const x = ordre(d); return { nature: "ordre", reference: x.id, quand: x.creeLe, etat: x.etat, montant: (x.cote === "achat" ? -1 : 1) * (x.rapide?.total ?? x.totalXafe), detail: x }; }
    case "retrait": { const x = retrait(d); return { nature: "crypto", reference: x.reference, quand: x.creeLe, etat: x.etat === "envoye" ? "confirme" : x.etat === "echoue" ? "echoue" : "en_attente", montant: -x.montant, actif: x.actif, detail: x }; }
    case "transfert": { const x = transfert(d); return { nature: "crypto", reference: x.id, quand: x.quand, etat: "confirme", montant: x.sens === "entree" ? x.montant : -x.montant, actif: x.actif, detail: x }; }
    case "dotation": { const x = { reference: s(d.reference), xafe: n(d.xafe), usdt: n(d.usdt), motif: s(d.motif), creeLe: s(d.cree_le) };
      return { nature: "dotation", reference: x.reference, quand: x.creeLe, etat: "confirme", montant: x.xafe, detail: x }; }
    default: return null;
  }
}

/** Les paramètres que la base LIE au code e-mail (0036, _parametres_de) : en snake_case, l'adresse sans espaces autour. */
function parametresDeLOperation(op: OperationAVerifier): Record<string, unknown> {
  switch (op.operation) {
    case "sortie_momo": return { montant: op.montant, numero_id: op.numeroId, ...(op.nom ? { nom: op.nom } : {}) };
    case "retrait_crypto": return { actif: op.actif, reseau: op.reseau, adresse: op.adresse.trim(), montant: op.montant };
    case "retirer_numero": return { numero_id: op.numeroId };
    case "fermer_compte": return {};
  }
}
const argsDeLaPreuve = (p: PreuveDeVerification) => ({ p_verification: p.verification, p_mot_de_passe: p.motDePasse, p_code_email: p.codeEmail });

/* ======================================================================= */

export class GuichetSupabase implements Guichet {
  readonly mode = "supabase" as const;
  private sb: SupabaseClient;
  private canal: RealtimeChannel | null = null;
  private auditeurs = new Set<() => void>();
  private entree = new Set<(e: EvenementDEntree) => void>();
  private ecoute = false;

  constructor(url: string, cleAnon: string) {
    this.sb = createClient(url, cleAnon, {
      /* pkce : Google revient avec un code (?code=…) que le client échange lui-même — dans le navigateur
         (detectSessionInUrl), ou dans la coque (terminerRetourOAuth), le vérificateur restant dans la page */
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "xafe-client-auth", flowType: "pkce", detectSessionInUrl: true },
    });
    this.sb.auth.onAuthStateChange((evenement) => {
      if (evenement === "SIGNED_OUT") { this.taire(); for (const cb of this.entree) cb("deconnecte"); }
      for (const cb of this.auditeurs) cb();
    });
  }

  /** Un appel au moteur ; la phrase de l'exception PL/pgSQL devient le message. */
  private async rpc<T = unknown>(nom: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.sb.rpc(nom, args);
    if (error) {
      /* la session a perdu aal2 (un facteur retiré, un jeton relu) : la session se relit, l'écran mène où il faut */
      if (/^double authentification requise/.test(error.message)) for (const cb of this.entree) cb("aal_perdu");
      throw new ErreurMoteur(error.message, error.details || undefined);
    }
    /* un refus COMPTÉ (un mot de passe, un code faux) ne LÈVE pas côté moteur — l'échec doit rester écrit : il rend {"erreur": …} */
    if (data && typeof data === "object" && !Array.isArray(data) && typeof (data as J).erreur === "string") {
      const j = data as J;
      const d = donneesDuRefus(j);
      throw new ErreurMoteur(String(j.erreur), detailDuRefus(d), d);
    }
    return data as T;
  }

  /* -------------------------------------------------------- temps réel */

  tempsReel(actif: boolean) {
    this.ecoute = actif;
    if (actif) void this.ecouter(); else this.taire();
  }

  private async ecouter() {
    if (this.canal || !this.ecoute) return;
    const { data } = await this.sb.auth.getUser();
    const id = data.user?.id;
    if (!id) return;
    const signaler = () => { for (const cb of this.auditeurs) cb(); };
    this.canal = this.sb.channel(`compte-${id}`);
    for (const table of ["soldes", "depots", "depot_declarations", "sorties", "ordres", "notifications", "numeros", "retraits_crypto", "transferts_crypto", "comptes"]) {
      this.canal.on("postgres_changes", { event: "*", schema: "public", table }, signaler);
    }
    this.canal.subscribe();
  }

  private taire() {
    if (this.canal) { this.sb.removeChannel(this.canal); this.canal = null; }
  }

  surChangement(cb: () => void) {
    this.auditeurs.add(cb);
    return () => { this.auditeurs.delete(cb); };
  }

  surEntree(cb: (e: EvenementDEntree) => void) {
    this.entree.add(cb);
    return () => { this.entree.delete(cb); };
  }

  /** Après un code de l'application : le jeton neuf (aal2) part aussi au temps réel, qui gardait l'ancien. */
  private async jetonNeufAuTempsReel() {
    try { await this.sb.realtime.setAuth(); } catch { /* le prochain rafraîchissement du jeton s'en chargera */ }
    if (this.canal) { this.taire(); void this.ecouter(); }
  }

  /* ============================================================ session */

  async session() {
    const { data } = await this.sb.auth.getSession();
    return data.session ? { compteId: data.session.user.id } : null;
  }

  async etatDEntree(): Promise<EtatDEntree> {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) return { ...ENTREE_VIDE };
    const [aal, facteurs, etat] = await Promise.all([
      this.sb.auth.mfa.getAuthenticatorAssuranceLevel(),
      this.sb.auth.mfa.listFactors(),
      this.rpc<J>("mon_etat_d_entree"),
    ]);
    if (aal.error) throw erreurAuth(aal.error);
    const niveau = (v: unknown) => (v === "aal1" || v === "aal2" ? v : null);
    return {
      session: true,
      premierFacteur: premierFacteurDe(aal.data.currentAuthenticationMethods as ({ method?: string } | string)[]),
      aalActuel: niveau(aal.data.currentLevel), aalSuivant: niveau(aal.data.nextLevel),
      emailConfirme: Boolean(etat?.email_confirme), motDePasse: Boolean(etat?.mot_de_passe),
      codesDeSecours: Boolean(etat?.codes_de_secours), compte: Boolean(etat?.compte),
      facteurTotpId: facteurs.data?.totp?.[0]?.id ?? null,
    };
  }

  async inscrire({ email, motDePasse }: { email: string; motDePasse: string }) {
    const { data, error } = await this.sb.auth.signUp({ email: emailNormalise(email), password: motDePasse, options: { data: { langue: langue() } } });
    if (error) throw erreurAuth(error);
    /* une adresse déjà inscrite et confirmée : Auth rend un utilisateur sans identité (pour ne rien dire à un curieux) */
    return { dejaInscrit: (data.user?.identities?.length ?? 1) === 0, session: Boolean(data.session) };
  }

  async confirmerEmail({ email, code, motDePasse }: { email: string; code: string; motDePasse?: string }) {
    const e = emailNormalise(email);
    const { error } = await this.sb.auth.verifyOtp({ email: e, token: code, type: "signup" });
    if (error) throw error.code === "over_request_rate_limit" ? erreurAuth(error) : new ErreurMoteur("code incorrect ou expiré", t("demandez-en un nouveau si besoin", "request a new one if needed")); // langue-ok
    /* le code ouvre une session « otp », qui n'est jamais forte : on entre aussitôt par le mot de passe encore en mémoire */
    if (motDePasse) {
      const r = await this.sb.auth.signInWithPassword({ email: e, password: motDePasse });
      if (!r.error) return { connecte: true };
    }
    await this.sb.auth.signOut({ scope: "local" });
    return { connecte: false };
  }

  async renvoyerConfirmation(email: string) {
    const { error } = await this.sb.auth.resend({ type: "signup", email: emailNormalise(email) });
    if (error) throw erreurAuth(error);
  }

  async connecter({ email, motDePasse }: { email: string; motDePasse: string }) {
    const e = emailNormalise(email);
    const { error } = await this.sb.auth.signInWithPassword({ email: e, password: motDePasse });
    if (!error) return;
    if (error.code === "email_not_confirmed") {
      await this.renvoyerConfirmation(e).catch(() => { /* un code est peut-être déjà parti : l'écran du code permet d'en redemander */ });
    }
    throw erreurAuth(error);
  }

  async connecterGoogle() {
    const voie = voieGoogle({ demo: false, coque: coqueActuelle(), agent: typeof navigator !== "undefined" ? navigator.userAgent : "" });
    if (voie.voie === "coque") {
      /* Google refuse une WebView : la coque ouvre l'adresse dans un onglet du système et rend glisil://auth-retour?code=… */
      const { data, error } = await this.sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: "glisil://auth-retour", skipBrowserRedirect: true, queryParams: { prompt: "select_account" } } });
      if (error || !data.url) throw erreurAuth(error ?? { message: "connexion Google annulée" }); // langue-ok
      (window as unknown as { ReactNativeWebView?: { postMessage: (m: string) => void } }).ReactNativeWebView?.postMessage(JSON.stringify({ type: "connexion-google", url: data.url }));
      return;
    }
    if (voie.voie !== "web") throw new ErreurMoteur("connexion Google annulée"); // langue-ok
    const { error } = await this.sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/bienvenue/retour`, queryParams: { prompt: "select_account" } } });
    if (error) throw erreurAuth(error);
  }

  async terminerRetourOAuth(url: string) {
    const { code, erreur } = lireRetourOAuth(url);
    if (!code) throw new ErreurMoteur("connexion Google annulée", erreur ?? undefined); // langue-ok
    const { error } = await this.sb.auth.exchangeCodeForSession(code);
    if (error) throw new ErreurMoteur("connexion Google annulée", error.message); // langue-ok
  }

  async choisirMotDePasse(motDePasse: string) {
    const { error } = await this.sb.auth.updateUser({ password: motDePasse });
    if (error) throw erreurAuth(error);
  }

  private async enroler(): Promise<EnrolementTotp> {
    const quand = new Date().toISOString().slice(0, 16).replace("T", " ");
    const { data, error } = await this.sb.auth.mfa.enroll({ factorType: "totp", issuer: "Glisil", friendlyName: `Glisil ${quand}` });
    if (error || !data) throw erreurAuth(error ?? { message: "aucune application d'authentification" }); // langue-ok
    return { facteurId: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
  }

  /** Les essais abandonnés (facteurs jamais vérifiés) bloqueraient le nom du suivant : on les retire d'abord. */
  private async retirerLesFacteursNonVerifies() {
    const { data } = await this.sb.auth.mfa.listFactors();
    for (const f of data?.all ?? []) {
      if (f.factor_type === "totp" && f.status === "unverified") await this.sb.auth.mfa.unenroll({ factorId: f.id }).catch(() => undefined);
    }
  }

  async enrolerDeuxFacteurs() {
    await this.retirerLesFacteursNonVerifies();
    return this.enroler();
  }

  async confirmerDeuxFacteurs({ facteurId, code }: { facteurId: string; code: string }) {
    const { error } = await this.sb.auth.mfa.challengeAndVerify({ factorId: facteurId, code });
    if (error) throw erreurAuth(error);
    await this.jetonNeufAuTempsReel();
  }

  async verifierDeuxFacteurs(code: string) {
    const { data } = await this.sb.auth.mfa.listFactors();
    const f = data?.totp?.[0];
    if (!f) throw new ErreurMoteur("aucune application d'authentification"); // langue-ok
    const { error } = await this.sb.auth.mfa.challengeAndVerify({ factorId: f.id, code });
    if (error) throw erreurAuth(error);
    await this.jetonNeufAuTempsReel();
  }

  async genererCodesDeSecours() {
    const r = await this.rpc<J>("generer_codes_de_secours");
    return ((r?.codes as unknown[]) ?? []).map(String);
  }
  async confirmerCodesDeSecours() { await this.rpc("confirmer_codes_de_secours"); }
  async codesDeSecours(): Promise<EtatCodesDeSecours> {
    const r = (await this.rpc<J>("mes_codes_de_secours")) ?? {};
    return { confirmes: Boolean(r.confirmes), restants: n(r.restants), creesLe: sn(r.cree_le) };
  }

  async utiliserCodeDeSecours(code: string) {
    /* la base décide (code, essais, verrou) ; la fonction ne fait qu'exécuter ce qu'Auth seul peut faire : retirer le facteur */
    const { data, error } = await this.sb.functions.invoke("deux-facteurs", { body: { action: "code_de_secours", code } });
    let j = (data ?? null) as J | null;
    if (error) {
      const contexte = (error as { context?: Response }).context;
      j = contexte && typeof contexte.json === "function" ? ((await contexte.json().catch(() => null)) as J | null) : null;
      if (!j || typeof j.erreur !== "string") throw new ErreurMoteur(error.message);
    }
    if (j && typeof j.erreur === "string") { const d = donneesDuRefus(j); throw new ErreurMoteur(j.erreur, detailDuRefus(d), d); }
    /* le facteur est parti : le jeton relu redescend à aal1, et l'entrée mène à l'enrôlement d'une nouvelle application */
    await this.sb.auth.refreshSession();
  }

  async motDePasseOublie(email: string) {
    const { error } = await this.sb.auth.resetPasswordForEmail(emailNormalise(email));
    if (error) throw erreurAuth(error);
  }

  async verifierCodeDeReinitialisation({ email, code }: { email: string; code: string }) {
    const { error } = await this.sb.auth.verifyOtp({ email: emailNormalise(email), token: code, type: "recovery" });
    if (error) throw error.code === "over_request_rate_limit" ? erreurAuth(error) : new ErreurMoteur("code incorrect ou expiré", t("demandez-en un nouveau si besoin", "request a new one if needed")); // langue-ok
  }

  async nouveauMotDePasse(motDePasse: string) {
    const { error } = await this.sb.auth.updateUser({ password: motDePasse });
    if (error) throw erreurAuth(error);
    /* toutes les sessions se ferment, celle-ci comprise : on entre de nouveau, avec le nouveau mot de passe */
    await this.sb.auth.signOut({ scope: "global" });
  }

  async changerMotDePasse({ nouveau, nonce }: { nouveau: string; nonce?: string }) {
    const { error } = await this.sb.auth.updateUser({ password: nouveau, ...(nonce ? { nonce } : {}) });
    if (!error) return;
    if (!nonce && (error.code === "reauthentication_needed" || error.code === "reauth_nonce_missing")) {
      const r = await this.sb.auth.reauthenticate();
      if (r.error) throw erreurAuth(r.error);
    }
    throw erreurAuth(error);
  }

  async commencerChangementDeTelephone() {
    await this.retirerLesFacteursNonVerifies();
    return this.enroler();
  }

  async terminerChangementDeTelephone({ facteurId, code }: { facteurId: string; code: string }) {
    const { error } = await this.sb.auth.mfa.challengeAndVerify({ factorId: facteurId, code });
    if (error) throw erreurAuth(error);
    /* le nouveau facteur est prouvé (session aal2) : les anciens téléphones ne servent plus */
    const { data } = await this.sb.auth.mfa.listFactors();
    for (const f of data?.totp ?? []) if (f.id !== facteurId) await this.sb.auth.mfa.unenroll({ factorId: f.id });
    await this.sb.auth.refreshSession();
    await this.jetonNeufAuTempsReel();
  }

  async seDeconnecter(portee: "local" | "global" = "local") {
    this.taire();
    await this.sb.auth.signOut({ scope: portee });
  }

  /* ============================================================= compte */

  async compte() { return compte(trouve(await this.rpc<J | null>("mon_compte"), "compte pas encore ouvert")); } // langue-ok
  async monCompte() { const j = await this.rpc<J | null>("mon_compte"); return j ? compte(j) : null; }
  async ouvrirCompte(p: ProfilInscription) {
    return compte(await this.rpc<J>("ouvrir_mon_compte", { p_prenom: p.prenom, p_nom: p.nom, p_naissance: p.naissance, p_telephone: p.telephone, p_ville: p.ville, p_pays: p.pays, p_conditions: p.conditions }));
  }
  async nomPropose() {
    const { data } = await this.sb.auth.getUser();
    const m = (data.user?.user_metadata ?? {}) as J;
    const prenom = s(m.given_name).trim(), nom = s(m.family_name).trim();
    if (prenom || nom) return { prenom, nom };
    const complet = s(m.full_name || m.name).trim().split(/\s+/).filter(Boolean);
    return complet.length ? { prenom: complet[0], nom: complet.slice(1).join(" ") } : null;
  }
  async accepterConditions(version: string) { return compte(await this.rpc<J>("accepter_conditions", { p_version: version })); }
  async fermerCompte({ motif, preuve }: { motif: string; preuve: PreuveDeVerification }) {
    const r = await this.rpc<J>("fermer_mon_compte", { ...argsDeLaPreuve(preuve), p_motif: motif });
    return compte(r.compte as J);
  }

  async preparerVerification(op: OperationAVerifier): Promise<Verification> {
    const r = await this.rpc<J>("preparer_verification", { p_operation: op.operation, p_parametres: parametresDeLOperation(op) });
    return { id: s(r.id), expireLe: s(r.expire_le), renvoiDes: s(r.renvoi_des), emailMasque: s(r.email_masque) };
  }
  async etatVerification(id: string): Promise<EtatVerification | null> {
    const r = await this.rpc<J | null>("ma_verification", { p_id: id });
    if (!r) return null;
    const c = s(r.courriel);
    return { courriel: (["en_attente", "en_cours", "envoye", "echoue", "abandonne"].includes(c) ? c : "en_attente") as EtatVerification["courriel"], essaisRestants: n(r.essais_restants) };
  }
  async demanderVerification({ type, pieces }: { type: "identite" | "entreprise"; pieces: File[] }) {
    const { data } = await this.sb.auth.getUser();
    const id = data.user?.id;
    if (!id) throw new ErreurMoteur("non connecté"); // langue-ok
    const chemins: string[] = [];
    for (const [i, f] of pieces.entries()) {
      const chemin = `${id}/${type}/${Date.now()}-${i}-${f.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await this.sb.storage.from("verifications").upload(chemin, f, { upsert: false, contentType: f.type });
      if (error) throw new ErreurMoteur(error.message);
      chemins.push(chemin);
    }
    return compte(await this.rpc<J>("demander_verification", { p_type: type, p_pieces: chemins }));
  }

  async notifications(): Promise<Notification[]> {
    const r = await this.rpc<J[]>("mes_notifications");
    return (r ?? []).map((j) => ({ id: s(j.id), quand: s(j.cree_le), titre: s(j.titre), texte: s(j.texte), cible: s(j.cible), lue: Boolean(j.lue_le) }));
  }
  async marquerLues() { await this.rpc("marquer_notifications_lues"); }

  /* ============================================================= soldes */

  async soldes(): Promise<Soldes> {
    const r = (await this.rpc<Record<string, J>>("mes_soldes")) ?? {};
    const lire = (a: Actif) => ({ disponible: n(r[a]?.disponible), bloque: n(r[a]?.bloque) });
    return { XAFe: lire("XAFe"), USDT: lire("USDT") };
  }

  /* ============================================================= entrer */

  async ouvrirDepot({ operateur, cle }: { operateur: IdOperateur; cle: string }) { return depot(await this.rpc<J>("ouvrir_depot", { p_operateur: operateur, p_cle: cle })); }
  async depot(reference: string) { return depot(trouve(await this.rpc<J>("mon_depot", { p_reference: reference }), "dépôt inconnu")); } // langue-ok
  async declarerTransaction({ reference, transactionId, numero, montant, nom }: { reference: string; transactionId: string; numero: string; montant: number; nom: string }) {
    return declaration(await this.rpc<J>("declarer_transaction", {
      p_reference: reference, p_transaction_id: transactionIdNormalise(transactionId), p_numero: numeroSaisi(numero), p_montant: montant, p_nom: nom.trim(),
    }));
  }
  async retirerDeclaration({ reference, transactionId }: { reference: string; transactionId: string }) {
    return depot(await this.rpc<J>("retirer_declaration", { p_reference: reference, p_transaction_id: transactionId }));
  }
  async terminerDepot(reference: string) { return depot(await this.rpc<J>("terminer_depot", { p_reference: reference })); }
  async annulerDepot(reference: string) { return depot(await this.rpc<J>("annuler_depot", { p_reference: reference })); }
  async depotsEnAttente() { return ((await this.rpc<J[]>("mes_depots_en_attente")) ?? []).map(depot); }

  /* ============================================================= sortir */

  async numeros() { return ((await this.rpc<J[]>("mes_numeros")) ?? []).map(numero); }
  async ajouterNumero({ operateur, numero: num }: { operateur: IdOperateur; numero: string }) { return numero(await this.rpc<J>("ajouter_numero", { p_operateur: operateur, p_numero: numeroSaisi(num) })); }
  async confirmerNumero({ id, code }: { id: string; code: string }) { return numero(await this.rpc<J>("confirmer_numero", { p_id: id, p_code: code })); }
  async parametres() {
    const { data, error } = await this.sb.rpc("parametres_publics");
    return error ? null : data;
  }
  async signalerUnProbleme({ texte, ecran }: { texte: string; ecran?: string | null }) {
    // l'appareil aide l'équipe à reproduire (« Android 14 · Chrome ») ; rien d'autre ne part
    const appareil = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null;
    return this.rpc<{ reference: string }>("signaler_un_probleme", { p_texte: texte, p_ecran: ecran ?? null, p_appareil: appareil });
  }
  async preuveDeReserve() {
    const p = await this.rpc<PreuveDeReserve>("preuve_de_reserve");
    return { ...p, alertes: Number(p.alertes ?? 0), releve: p.releve ? { ...p.releve, floats_detail: p.releve.floats_detail ?? null } : null };
  }
  async renvoyerCodeNumero(id: string) { return numero(await this.rpc<J>("renvoyer_code_numero", { p_id: id })); }
  async retirerNumero({ id, preuve }: { id: string; preuve: PreuveDeVerification }) { await this.rpc("retirer_numero", { p_id: id, ...argsDeLaPreuve(preuve) }); }
  async demanderSortie({ montant, numeroId, cle, preuve, nom }: { montant: number; numeroId: string; cle: string; preuve: PreuveDeVerification; nom?: string }) {
    return sortie(await this.rpc<J>("demander_sortie", { p_montant: montant, p_numero_id: numeroId, p_cle: cle, ...argsDeLaPreuve(preuve), ...(nom ? { p_nom: nom } : {}) }));
  }
  async sortie(reference: string) { return sortie(trouve(await this.rpc<J>("ma_sortie", { p_reference: reference }), "sortie inconnue")); }

  /* ============================================================= marché */

  async cotation(): Promise<Cotation> {
    const r = await this.rpc<J>("cotation");
    const dernier = nn(r.dernier);
    const avant = nn(r.il_y_a_24h);
    return {
      dernier, variation24h: dernier !== null && avant ? Math.round(((dernier - avant) / avant) * 10000) / 100 : null,
      haut24h: nn(r.haut), bas24h: nn(r.bas), volume24hUsdt: n(r.volume_usdt), meilleurAchat: nn(r.meilleur_achat), meilleureVente: nn(r.meilleure_vente), reference: nn(r.reference), releveLe: new Date().toISOString(),
    };
  }
  async carnet(profondeur: number): Promise<Carnet> {
    const r = await this.rpc<J>("carnet", { p_profondeur: profondeur });
    const niveaux = (l: unknown) => ((l as J[]) ?? []).map((x) => ({ prix: n(x.prix), quantite: n(x.quantite) }));
    return { achats: niveaux(r.achats), ventes: niveaux(r.ventes) };
  }
  async transactions(nb: number): Promise<Transaction[]> {
    const r = await this.rpc<J[]>("transactions_recentes", { p_n: nb });
    return (r ?? []).map((x) => ({ quand: s(x.cree_le), prix: n(x.prix), quantite: n(x.quantite), cote: x.preneur === "achat" ? "achat" : "vente" }));
  }
  async chandelles(intervalleMinutes: number, nb: number): Promise<Chandelle[]> {
    const r = await this.rpc<J[]>("chandelles", { p_minutes: intervalleMinutes, p_n: nb });
    return (r ?? []).map((x) => ({ t: s(x.t), o: n(x.o), h: n(x.h), l: n(x.l), c: n(x.c), v: n(x.v) }));
  }
  async bougies(intervalle: Intervalle, avant?: string | null, nb = 300): Promise<PageDeBougies> {
    const r = await this.rpc<J>("bougies", { p_intervalle: intervalle, p_avant: avant ?? null, p_n: nb });
    return {
      bougies: ((r.bougies as J[]) ?? []).map((x) => ({ t: s(x.t), o: n(x.o), h: n(x.h), l: n(x.l), c: n(x.c), v: n(x.v), source: x.source === "reference" ? "reference" as const : "marche" as const })),
      plusAncien: Boolean(r.plus_ancien),
      debutMarche: r.debut_marche ? s(r.debut_marche) : null,
    };
  }
  async mesOrdres() { return ((await this.rpc<J[]>("mes_ordres")) ?? []).map(ordre); }
  async ordre(id: string) {
    const r = trouve(await this.rpc<J>("mon_ordre", { p_id: id }), "ordre inconnu");
    const o = ordre(r.ordre as J);
    return { ordre: o, executions: ((r.executions as J[]) ?? []).map((e) => execution(e, o.cote)) };
  }
  async placerOrdre({ cote, type, quantite, prix, cle }: { cote: Cote; type: TypeOrdre; quantite: number; prix?: number; cle: string }): Promise<ResultatOrdre> {
    const r = await this.rpc<J>("placer_ordre", { p_cote: cote, p_type: type, p_quantite: quantite, p_prix: type === "limite" ? prix : null, p_cle: cle });
    const o = ordre(r.ordre as J);
    return { ordre: o, executions: ((r.executions as J[]) ?? []).map((e) => execution(e, o.cote)), autoNegociation: Boolean(r.auto_negociation), deja: Boolean(r.deja) };
  }
  async annulerOrdre(id: string) { return ordre(await this.rpc<J>("annuler_ordre", { p_id: id })); }

  async devisRapide({ sens, montant, ferme }: { sens: SensRapide; montant: number; ferme: boolean }) {
    return devis(await this.rpc<J>("devis_rapide", { p_sens: sens, p_montant: montant, p_ferme: ferme }));
  }
  async executerDevis(id: string) { return devis(await this.rpc<J>("executer_devis", { p_id: id })); }

  /* ============================================================= crypto */

  async adresseDepot(actif: Actif, reseau: Reseau) { return sn(await this.rpc("adresse_depot", { p_actif: actif, p_reseau: reseau })); }
  async demanderRetraitCrypto({ actif, reseau, adresse, montant, cle, preuve }: { actif: Actif; reseau: Reseau; adresse: string; montant: number; cle: string; preuve: PreuveDeVerification }) {
    return retrait(await this.rpc<J>("demander_retrait_crypto", { p_actif: actif, p_reseau: reseau, p_adresse: adresse.trim(), p_montant: montant, p_cle: cle, ...argsDeLaPreuve(preuve) }));
  }
  async retraitCrypto(reference: string) { return retrait(trouve(await this.rpc<J>("mon_retrait_crypto", { p_reference: reference }), "retrait inconnu")); }

  /* ========================================================= historique */

  async historique(): Promise<Operation[]> {
    const r = await this.rpc<J[]>("mon_historique", { p_n: 200 });
    return (r ?? []).map(operation).filter((o): o is Operation => o !== null);
  }
  /** UNE opération, quel que soit son âge : chercher dans les 200 dernières disait « pas sur votre compte » au-delà. */
  async operation(reference: string) {
    const r = await this.rpc<J | null>("mon_operation", { p_reference: reference });
    return r ? operation(r) : null;
  }
}
