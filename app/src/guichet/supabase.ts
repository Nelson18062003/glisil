/*
 * LE GUICHET SUPABASE : le vrai moteur. L'authentification est celle de
 * Supabase Auth : une adresse e-mail et un code à six chiffres reçu par
 * e-mail, sans mot de passe ; tout le reste passe par les RPC du moteur
 * (supabase/migrations). Les écritures ne touchent jamais une table : la
 * base décide, l'écran montre.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { ErreurMoteur } from "../noyau/erreurs";
import { emailNormalise } from "../noyau/identite";
import { numeroSaisi, transactionIdNormalise } from "../noyau/format";
import type { Guichet } from "./guichet";
import type {
  Actif, Carnet, Chandelle, Compte, Cote, Cotation, Declaration, Depot, DevisRapide, Execution, IdOperateur, Notification, Numero, Operation, Ordre, ProfilInscription, SensRapide,
  Reseau, ResultatCode, ResultatOrdre, RetraitCrypto, Soldes, Sortie, Transaction, TransfertCrypto, TypeOrdre,
} from "./types";

type J = Record<string, unknown>;
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const sn = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** Les refus de Supabase Auth, dits en français : trop de codes demandés, adresse refusée. */
function messageAuth(m: string): string {
  if (/rate limit|too many|seconds/i.test(m)) return "trop de codes demandés : attendez une minute";
  if (/invalid.*email|email.*invalid/i.test(m)) return "adresse e-mail invalide";
  if (/signups? not allowed|disabled/i.test(m)) return "les inscriptions sont fermées pour le moment";
  return m;
}

/* ----------------------------------------------------- lectures du moteur */

/** Le moteur rend NULL pour une référence qui n'est pas sur ce compte : c'est « inconnu », pas un objet vide à démonter. */
function trouve(j: J | null, message: string): J {
  if (!j || typeof j !== "object") throw new ErreurMoteur(message);
  return j;
}

function declaration(j: J): Declaration {
  return { id: s(j.id), transactionId: s(j.transaction_id), etat: j.etat as Declaration["etat"], montant: nn(j.montant), numeroPayeur: sn(j.numero_payeur), motif: sn(j.motif), declareLe: s(j.declare_le), crediteLe: sn(j.credite_le), luLe: sn(j.lu_le) };
}
function depot(j: J): Depot {
  return {
    reference: s(j.reference), operateur: j.operateur as IdOperateur, floatNumero: s(j.float_numero), codeAgent: sn(j.code_agent),
    reception: j.reception === "retardee" || j.reception === "fermee" ? j.reception : "ouverte", montantRecu: n(j.montant_recu),
    etat: j.etat as Depot["etat"], creeLe: s(j.cree_le), expireLe: s(j.expire_le), crediteLe: sn(j.credite_le),
    declarations: ((j.declarations as J[]) ?? []).map(declaration),
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
    aCode: Boolean(j.a_code), verrouJusqua: sn(j.verrou_jusqua), verificationEnCours: (j.verification_en_cours as Compte["verificationEnCours"]) ?? null,
    entreDuJour: n(j.entre_du_jour),
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
    default: return null;
  }
}

/* ======================================================================= */

export class GuichetSupabase implements Guichet {
  readonly mode = "supabase" as const;
  private sb: SupabaseClient;
  private canal: RealtimeChannel | null = null;
  private auditeurs = new Set<() => void>();

  constructor(url: string, cleAnon: string) {
    this.sb = createClient(url, cleAnon, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "xafe-client-auth" } });
    this.sb.auth.onAuthStateChange((evenement) => {
      if (evenement === "SIGNED_IN") this.ecouter();
      if (evenement === "SIGNED_OUT") this.taire();
      for (const cb of this.auditeurs) cb();
    });
  }

  /** Un appel au moteur ; la phrase de l'exception PL/pgSQL devient le message. */
  private async rpc<T = unknown>(nom: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.sb.rpc(nom, args);
    if (error) throw new ErreurMoteur(error.message, error.details || undefined);
    /* un code secret faux ne LÈVE pas côté moteur (l'échec doit être compté) : il rend {"erreur": …} */
    if (data && typeof data === "object" && !Array.isArray(data) && typeof (data as J).erreur === "string") {
      const j = data as J;
      throw new ErreurMoteur(String(j.erreur), j.essais_restants != null ? `${j.essais_restants} essai(s) restant(s)` : undefined);
    }
    return data as T;
  }

  /* -------------------------------------------------------- temps réel */

  private async ecouter() {
    if (this.canal) return;
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
    void this.ecouter();
    return () => { this.auditeurs.delete(cb); };
  }

  /* ============================================================ session */

  async session() {
    const { data } = await this.sb.auth.getSession();
    return data.session ? { compteId: data.session.user.id } : null;
  }

  async demanderCode(email: string) {
    const { error } = await this.sb.auth.signInWithOtp({ email: emailNormalise(email), options: { shouldCreateUser: true } });
    if (error) throw new ErreurMoteur(messageAuth(error.message));
  }

  async verifierCode(email: string, code: string) {
    const { data, error } = await this.sb.auth.verifyOtp({ email: emailNormalise(email), token: code, type: "email" });
    if (error || !data.user) throw new ErreurMoteur("code incorrect ou expiré", "demandez-en un nouveau si besoin");
    return { nouveau: (await this.monCompte()) === null };
  }

  async seDeconnecter() {
    this.taire();
    await this.sb.auth.signOut();
  }

  /* ============================================================= compte */

  async compte() { return compte(trouve(await this.rpc<J | null>("mon_compte"), "compte pas encore ouvert")); }
  async monCompte() { const j = await this.rpc<J | null>("mon_compte"); return j ? compte(j) : null; }
  async ouvrirCompte(p: ProfilInscription) {
    return compte(await this.rpc<J>("ouvrir_mon_compte", { p_prenom: p.prenom, p_nom: p.nom, p_naissance: p.naissance, p_telephone: p.telephone, p_ville: p.ville, p_pays: p.pays }));
  }
  async completerProfil({ nom, codeSecret }: { nom: string; codeSecret: string }) { return compte(await this.rpc<J>("completer_profil", { p_nom: nom, p_code: codeSecret })); }
  async verifierCodeSecret(code: string): Promise<ResultatCode> {
    /* PAS this.rpc : un code faux revient en {"ok": false, "erreur": …} — c'est une RÉPONSE que l'écran
       de déverrouillage doit lire (essais restants, verrou), pas une exception qui le laisserait muet,
       le code faux toujours dans les cases, renvoyé à chaque touche jusqu'au verrou. */
    const { data, error } = await this.sb.rpc("verifier_code_secret", { p_code: code });
    if (error) throw new ErreurMoteur(error.message, error.details || undefined);
    const r = (data ?? {}) as J;
    return { ok: Boolean(r.ok), essaisRestants: nn(r.essais_restants) ?? undefined, verrouJusqua: sn(r.verrou_jusqua) };
  }
  async changerCodeSecret({ ancien, nouveau }: { ancien: string; nouveau: string }) { await this.rpc("changer_code_secret", { p_ancien: ancien, p_nouveau: nouveau }); }
  async demanderVerification({ type, pieces }: { type: "identite" | "entreprise"; pieces: File[] }) {
    const { data } = await this.sb.auth.getUser();
    const id = data.user?.id;
    if (!id) throw new ErreurMoteur("non connecté");
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
  async depot(reference: string) { return depot(trouve(await this.rpc<J>("mon_depot", { p_reference: reference }), "dépôt inconnu")); }
  async declarerTransaction({ reference, transactionId }: { reference: string; transactionId: string }) {
    return declaration(await this.rpc<J>("declarer_transaction", { p_reference: reference, p_transaction_id: transactionIdNormalise(transactionId) }));
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
  async renvoyerCodeNumero(id: string) { return numero(await this.rpc<J>("renvoyer_code_numero", { p_id: id })); }
  async retirerNumero({ id, codeSecret }: { id: string; codeSecret: string }) { await this.rpc("retirer_numero", { p_id: id, p_code: codeSecret }); }
  async demanderSortie({ montant, numeroId, cle, codeSecret }: { montant: number; numeroId: string; cle: string; codeSecret: string }) {
    return sortie(await this.rpc<J>("demander_sortie", { p_montant: montant, p_numero_id: numeroId, p_cle: cle, p_code: codeSecret }));
  }
  async sortie(reference: string) { return sortie(trouve(await this.rpc<J>("ma_sortie", { p_reference: reference }), "sortie inconnue")); }

  /* ============================================================= marché */

  async cotation(): Promise<Cotation> {
    const r = await this.rpc<J>("cotation");
    const dernier = nn(r.dernier);
    const avant = nn(r.il_y_a_24h);
    return {
      dernier, variation24h: dernier !== null && avant ? Math.round(((dernier - avant) / avant) * 10000) / 100 : null,
      haut24h: nn(r.haut), bas24h: nn(r.bas), volume24hUsdt: n(r.volume_usdt), meilleurAchat: nn(r.meilleur_achat), meilleureVente: nn(r.meilleure_vente), releveLe: new Date().toISOString(),
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
  async demanderRetraitCrypto({ actif, reseau, adresse, montant, cle, codeSecret }: { actif: Actif; reseau: Reseau; adresse: string; montant: number; cle: string; codeSecret: string }) {
    return retrait(await this.rpc<J>("demander_retrait_crypto", { p_actif: actif, p_reseau: reseau, p_adresse: adresse, p_montant: montant, p_cle: cle, p_code: codeSecret }));
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
