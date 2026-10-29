/*
 * LE GUICHET DE DÉMONSTRATION : un moteur en mémoire qui suit les règles du
 * vrai (supabase/migrations/0001_socle.sql) — fonds bloqués avant d'inscrire
 * un ordre, frais dans l'actif reçu, découpage des sorties au plafond de
 * l'opérateur, appariement prix-temps, pas d'auto-négociation — avec un faux
 * TOTEM qui lit le SMS quelques secondes après « J'ai payé », et un carnet qui
 * vit. Il tourne quand l'application n'a pas de projet Supabase configuré.
 * Il n'a aucune valeur comptable : c'est une maquette qui répond.
 */
import { achatMax, adresseValide, arrondi2, FRAIS_CRYPTO, bandeDePrix, coutAuCarnet, decouperSortie, devisSurLeCarnet, FRAIS, MARCHE, montantValide, operateur as opDe, PALIERS, prixValide, quantiteValide, RAPIDE, SORTIES, fraisSortieManuelle, infoReseau, NUMEROS, RESEAUX, RESEAUX_OUVERTS } from "../noyau/argent";
import { ErreurMoteur } from "../noyau/erreurs";
import { emailNormalise, emailValide } from "../noyau/identite";
import { codeDeSecoursNormalise } from "../noyau/codesDeSecours";
import { langue } from "../noyau/langue";
import { motDePasseValide } from "../noyau/motDePasse";
import { numeroSaisi, operateurDuNumero, transactionIdNormalise, xaf as xafDe } from "../noyau/format";
import { VERSION_CONDITIONS } from "../noyau/conditions";
import type { EvenementDEntree, Guichet } from "./guichet";
import type {
  Actif, Bougie, Carnet, Chandelle, Intervalle, PageDeBougies, Compte, Cote, Cotation, Declaration, Depot, DevisRapide, Execution, IdOperateur, Niveau, Notification, Numero, Operation, Ordre, ProfilInscription, SensRapide,
  Reseau, ResultatOrdre, RetraitCrypto, Soldes, Sortie, Transaction, TransfertCrypto, TypeOrdre,
  LignePreuve, PreuveDeReserve,
  EtatDEntree, EnrolementTotp, EtatCodesDeSecours, OperationAVerifier, Verification, EtatVerification, PreuveDeVerification,
} from "./types";

const CLE_STOCKAGE = "xafe.demo.v6";
/** le code de démonstration : celui qui arrive « par SMS » pour un numéro, « par e-mail » pour confirmer une adresse ou une sortie */
export const CODE_SMS_DEMO = "123456";
export const CODE_DEMO = CODE_SMS_DEMO;
/** ce que « l'application d'authentification » affiche dans la démonstration */
export const CODE_TOTP_DEMO = "123456";
/** le mot de passe de la vitrine (dix caractères, lettres et chiffres, comme Auth l'exige) */
export const MOT_DE_PASSE_DEMO = "Glisil-2026";
/** la clé TOTP de démonstration : celle des exemples de la RFC, qui ne protège rien */
const SECRET_TOTP_DEMO = "JBSWY3DPEHPK3PXP";
/** les dix codes de secours de la démonstration, toujours les mêmes (l'aide de l'écran les donne) */
export const CODES_DE_SECOURS_DEMO = ["7K3QD9WMXA", "B2N8HT4RZE", "Q9F1C6VJKS", "M4X7P2DGWN", "T8R3Z5HBQA", "C1W9N6KPXJ", "H5D2V8MRTE", "Z3K7Q1FXWB", "N6P4T9CJDG", "R2H8W5MZKQ"];
/** la vérification avant sortie, comme la base la règle (0036) */
const VERIF = { validiteMs: 10 * 60_000, essais: 5, echecsMax: 10, fenetreMs: 60 * 60_000, fraicheurTotpMs: 5 * 60_000, renvoiMs: 60_000, parQuartDHeure: 5 };
const NUMERO_VITRINE = "677123456";
/** l'adresse de la vitrine : elle arrive avec une vie déjà écrite */
export const EMAIL_VITRINE = "demo@glisil.com";

type Tache =
  | { quand: number; type: "sms"; reference: string; declarationId: string }
  | { quand: number; type: "transfert"; reference: string; index: number; etape: "en_cours" | "faite" | "echouee" }
  | { quand: number; type: "manuelle"; reference: string; etape: "prise" | "payee" | "prouvee" | "refusee" }
  | { quand: number; type: "retrait"; reference: string }
  | { quand: number; type: "expiration"; reference: string };

type CompteDemo = Omit<Compte, "entreDuJour" | "conditionsAJour" | "langue"> & { conditionsVersion: string | null; langue?: "fr" | "en" };

/** Ce que Supabase Auth tient pour une adresse : son mot de passe, son application, ses codes de secours. */
type UtilisateurDemo = {
  motDePasse: string | null;
  emailConfirme: boolean;
  totp: "aucun" | "en_attente" | "verifie";
  codes: { code: string; utilise: boolean }[] | null;
  codesConfirmes: boolean;
  essaisCodes: number;
  verrouCodes: number | null;
};

/** Une vérification avant sortie : liée à UNE opération (son empreinte), dix minutes, cinq essais, une fois. */
type VerificationDemo = {
  id: string; email: string; operation: OperationAVerifier["operation"]; empreinte: string;
  creeLe: number; expireLe: number; essais: number; consommee: boolean; remplacee: boolean;
};

type Dossier = {
  compte: CompteDemo;
  soldes: Soldes;
  numeros: Numero[];
  depots: Depot[];
  sorties: Sortie[];
  ordres: Ordre[];
  executions: (Execution & { ordreId: string })[];
  retraits: RetraitCrypto[];
  transferts: TransfertCrypto[];
  notifications: Notification[];
  taches: Tache[];
  compteur: number;
  numerosEnAttente: Record<string, string>;
  devis?: (DevisRapide & { cout: number })[];
};

type Marche = { mid: number; transactions: Transaction[]; chandelles: Chandelle[]; alea: number };

type Etat = {
  /** la personne connectée, par son adresse ; ses dossiers sont rangés par adresse */
  session: { email: string; aal: "aal1" | "aal2"; facteur: "password" | "oauth" | "autre"; totpLe: number | null } | null;
  codeAttendu: string | null;
  /** l'adresse dont « Mot de passe oublié » attend le code */
  recuperation?: string | null;
  utilisateurs: Record<string, UtilisateurDemo>;
  dossiers: Record<string, Dossier>;
  verifications: VerificationDemo[];
  echecs: { email: string; quand: number }[];
  marche: Marche;
};

/* ------------------------------------------------------------- utilitaires */

const maintenant = () => Date.now();
const iso = (t = maintenant()) => new Date(t).toISOString();
/** Le guichet rend des COPIES : un objet vivant, modifié en place, ferait croire au cache qu'il n'a pas changé. */
const copie = <T,>(x: T): T => structuredClone(x);
/** 64 chiffres hexadécimaux tirés d'un texte : la démonstration a des transactions qui ont l'air vraies, toujours les mêmes. */
function hex64(texte: string): string {
  let h = 2166136261 >>> 0, sortie = "";
  for (let tour = 0; sortie.length < 64; tour++) {
    for (const c of `${texte}#${tour}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    sortie += h.toString(16).padStart(8, "0");
  }
  return `0x${sortie.slice(0, 64)}`;
}

/** La démo frappe aussi : chaque dossier crédité a sa transaction dans la réserve, en route les trente premières secondes. */
function avecChaine(dep: Depot): Depot {
  if (dep.etat !== "credite" || !dep.crediteLe) return { ...dep, chaine: [] };
  const confirme = maintenant() - new Date(dep.crediteLe).getTime() > 30_000;
  return {
    ...dep,
    chaine: [{
      reseau: "bep20", operation: "frapper", montant: dep.montantRecu, reference: dep.reference, etat: confirme ? "confirme" : "envoye",
      txHash: hex64(`tx:${dep.reference}`), bloc: confirme ? 137_261_987 + (parseInt(dep.reference.slice(-3), 10) || 0) : null, essai: true,
      contrat: "0x750E774368240063BD5CF52b30b91183Efa4dAf3", reserve: "0x771C971497E4409d0225350C49609691E955465C",
      explorateur: "https://testnet.bscscan.com", empreinte: hex64(`empreinte:${dep.reference}`), relue: confirme,
      confirmeLe: confirme ? iso(new Date(dep.crediteLe).getTime() + 25_000) : null,
    }],
  };
}

const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

function alea(seed: number): number {
  /* un hasard reproductible : le carnet ne doit pas clignoter à chaque lecture */
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function auPas(p: number): number {
  return Math.round(p / MARCHE.pasPrix) * MARCHE.pasPrix;
}

/* ------------------------------------------------------------- le marché */

function marcheInitial(): Marche {
  const t0 = maintenant() - 28 * 3600_000;
  const chandelles: Chandelle[] = [];
  let p = 616.2;
  for (let i = 0; i < 28; i++) {
    const o = p;
    const c = auPas(o + (alea(i * 7 + 1) - 0.45) * 1.2);
    const h = Math.max(o, c) + alea(i * 3 + 2) * 0.4;
    const l = Math.min(o, c) - alea(i * 5 + 3) * 0.4;
    chandelles.push({ t: iso(t0 + i * 3600_000), o: arrondi2(o), h: arrondi2(h), l: arrondi2(l), c: arrondi2(c), v: Math.round(4000 + alea(i * 11) * 30000) });
    p = c;
  }
  const mid = chandelles[chandelles.length - 1].c;
  const transactions: Transaction[] = [];
  for (let i = 0; i < 20; i++) {
    transactions.push({ quand: iso(maintenant() - (20 - i) * 25_000), prix: auPas(mid + (alea(i + 100) - 0.5) * 0.4), quantite: Math.round(50 + alea(i + 200) * 3000), cote: alea(i + 300) > 0.5 ? "achat" : "vente" });
  }
  return { mid, transactions: transactions.reverse(), chandelles, alea: 1 };
}

/** Le carnet des AUTRES : des niveaux autour du prix, stables tant que le prix ne bouge pas. */
function livreSynthetique(mid: number, profondeur: number): Carnet {
  const ventes: Niveau[] = [];
  const achats: Niveau[] = [];
  for (let i = 1; i <= profondeur; i++) {
    const pa = arrondi2(auPas(mid + i * MARCHE.pasPrix * (i < 4 ? 1 : 2)));
    const pb = arrondi2(auPas(mid - i * MARCHE.pasPrix * (i < 4 ? 1 : 2)));
    ventes.push({ prix: pa, quantite: Math.round(200 + alea(pa * 100) * (i < 4 ? 1500 : 12000)) });
    achats.push({ prix: pb, quantite: Math.round(200 + alea(pb * 100) * (i < 4 ? 1500 : 12000)) });
  }
  return { achats, ventes };
}

/* ---------------------------------------------------------- le dossier */

function dossierVide(email: string, p: ProfilInscription, numeroDejaVerifie = false): Dossier {
  const id = uuid();
  /* comme la vraie base : le numéro de l'inscription n'est PAS un numéro de sortie vérifié ;
     on l'ajoute et on le prouve par SMS dans Compte → Mes numéros. La vitrine, elle, a déjà le sien. */
  const local = numeroDejaVerifie && /^\+2376\d{8}$/.test(p.telephone) ? p.telephone.slice(4) : null;
  return {
    compte: {
      id, telephone: p.telephone, nom: `${p.prenom} ${p.nom}`, entreprise: null, palier: 0, verificationEnCours: null,
      conditionsVersion: p.conditions, fermeLe: null, desactive: false,
      email, prenom: p.prenom, nomDeFamille: p.nom, dateNaissance: p.naissance, ville: p.ville, pays: p.pays,
    },
    soldes: { XAFe: { disponible: 0, bloque: 0 }, USDT: { disponible: 0, bloque: 0 } },
    numeros: local ? [{ id: uuid(), operateur: local.startsWith("69") || local.startsWith("65") ? "om" : "mtn", numero: local, verifieLe: iso(), actifDes: iso(), retireLe: null }] : [],
    depots: [], sorties: [], ordres: [], executions: [], retraits: [], transferts: [], notifications: [], taches: [], compteur: 417, numerosEnAttente: {},
  };
}

/** Ce qui est entré aujourd'hui : la somme des déclarations créditées depuis minuit. */
function entreDuJour(d: Dossier): number {
  const debut = new Date().setHours(0, 0, 0, 0);
  return d.depots.flatMap((x) => x.declarations).filter((x) => x.etat === "credite" && x.crediteLe && new Date(x.crediteLe).getTime() >= debut).reduce((s, x) => s + (x.montant ?? 0), 0);
}

/** La vitrine : demo@glisil.com arrive avec une vie déjà écrite. */
function dossierVitrine(): Dossier {
  const d = dossierVide(EMAIL_VITRINE, { prenom: "Nelson", nom: "Soh", naissance: "1988-06-21", telephone: `+237${NUMERO_VITRINE}`, ville: "Douala", pays: "CM", conditions: VERSION_CONDITIONS }, true);
  const hier = maintenant() - 20 * 3600_000;
  d.compte = { ...d.compte, entreprise: "NORTON GAUSS BONZINI SARL", palier: 2 };
  d.soldes = { XAFe: { disponible: 3_250_000, bloque: 0 }, USDT: { disponible: 2_608.05, bloque: 0 } };
  d.numeros.push({ id: uuid(), operateur: "om", numero: "699876543", verifieLe: iso(hier - 86400_000), actifDes: iso(hier), retireLe: null });
  d.depots.push({
    reference: "XAFe-DP-000401", operateur: "mtn", floatNumero: "677000000", titulaire: "GLISIL DÉMONSTRATION", codeAgent: null, reception: "ouverte", montantRecu: 3_000_000,
    etat: "credite", creeLe: iso(hier), expireLe: iso(hier + 1800_000), crediteLe: iso(hier + 240_000),
    declarations: [1, 2, 3].map((i) => ({ id: uuid(), transactionId: `2039481${i}04`, etat: "credite" as const, montant: 1_000_000, numeroPayeur: NUMERO_VITRINE, motif: null, declareLe: iso(hier + i * 80_000 - 20_000), crediteLe: iso(hier + i * 80_000), luLe: iso(hier + i * 80_000 - 2_000) })),
  });
  d.transferts.push({ id: uuid(), actif: "USDT", reseau: "bep20", sens: "sortie", montant: 2000, txHash: "0x8a1f3c…", adresse: "0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21", quand: iso(hier + 30_000_000) });
  const t1 = maintenant() - 2 * 3600_000;
  d.ordres.push({ id: uuid(), numero: "ORD-020931", cote: "achat", type: "limite", prix: 618.2, quantite: 1500, restant: 0, executee: 1500, totalXafe: 927_300, bloque: 0, prixMoyen: 618.2, etat: "execute", creeLe: iso(t1), majLe: iso(t1 + 40_000) });
  d.executions.push({ id: uuid(), ordreId: d.ordres[0].id, prix: 618.2, quantite: 1500, montantXafe: 927_300, frais: 1.5, fraisActif: "USDT", cote: "achat", preneur: true, quand: iso(t1 + 40_000) });
  d.ordres.push({ id: uuid(), numero: "ORD-020944", cote: "vente", type: "limite", prix: 619.0, quantite: 2000, restant: 1200, executee: 800, totalXafe: 495_200, bloque: 1200, prixMoyen: 619, etat: "partiel", creeLe: iso(t1 + 600_000), majLe: iso(t1 + 900_000) });
  d.soldes.USDT.bloque = 1200;
  d.executions.push({ id: uuid(), ordreId: d.ordres[1].id, prix: 619, quantite: 800, montantXafe: 495_200, frais: 248, fraisActif: "XAFe", cote: "vente", preneur: false, quand: iso(t1 + 900_000) });
  d.notifications.push({ id: uuid(), quand: iso(hier + 240_000), titre: "XAFe crédités", texte: "+3 000 000 XAFe reçus par MTN MoMo.", cible: "/historique/XAFe-DP-000401", lue: true });
  d.compteur = 420;
  return d;
}

/* -------------------------------------------------------- persistance */

function charger(): Etat {
  try {
    const brut = typeof localStorage !== "undefined" ? localStorage.getItem(CLE_STOCKAGE) : null;
    if (brut) { const e = JSON.parse(brut) as Partial<Etat>; return { ...e, verifications: e.verifications ?? [], echecs: e.echecs ?? [], utilisateurs: e.utilisateurs ?? {} } as Etat; }
  } catch { /* un stockage absent ou corrompu repart de zéro */ }
  return { session: null, codeAttendu: null, utilisateurs: {}, dossiers: {}, verifications: [], echecs: [], marche: marcheInitial() };
}

const utilisateurNeuf = (motDePasse: string | null): UtilisateurDemo => ({ motDePasse, emailConfirme: false, totp: "aucun", codes: null, codesConfirmes: false, essaisCodes: 0, verrouCodes: null });
/** La vitrine : une adresse déjà confirmée, son application enrôlée, ses codes notés. */
const utilisateurVitrine = (): UtilisateurDemo => ({ ...utilisateurNeuf(MOT_DE_PASSE_DEMO), emailConfirme: true, totp: "verifie", codes: CODES_DE_SECOURS_DEMO.map((code) => ({ code, utilise: false })), codesConfirmes: true });

/** Ce que la vérification LIE : la même forme pour la demande du code et pour l'opération (comme _parametres_de). */
function empreinteDe(op: OperationAVerifier): string {
  switch (op.operation) {
    case "sortie_momo": return JSON.stringify([op.operation, op.montant, op.numeroId, (op.nom ?? "").trim().replace(/\s+/g, " ") || null]);
    case "retrait_crypto": return JSON.stringify([op.operation, op.actif, op.reseau, op.adresse.trim(), op.montant]);
    case "retirer_numero": return JSON.stringify([op.operation, op.numeroId]);
    case "fermer_compte": return JSON.stringify([op.operation]);
  }
}

/* ======================================================================= */

export class GuichetDemo implements Guichet {
  readonly mode = "demo" as const;
  private etat: Etat;
  private auditeurs = new Set<() => void>();
  private entree = new Set<(e: EvenementDEntree) => void>();
  private horloge: ReturnType<typeof setInterval> | null = null;
  private tic = 0;

  constructor() {
    this.etat = charger();
    this.demarrer();
  }

  /* ------------------------------------------------------------ interne */

  private sauver() {
    try { localStorage.setItem(CLE_STOCKAGE, JSON.stringify(this.etat)); } catch { /* tant pis : la démo vit en mémoire */ }
  }

  private emettre() {
    this.sauver();
    for (const cb of this.auditeurs) cb();
  }

  private demarrer() {
    if (this.horloge || typeof setInterval === "undefined") return;
    this.horloge = setInterval(() => {
      this.tic++;
      let bouge = this.executerTaches();
      if (this.tic % 3 === 0) { this.battreLeMarche(); bouge = true; }
      if (bouge) this.emettre();
    }, 1000);
  }

  /** Comme la base (0035) : rien ne s'ouvre sans une session forte — mot de passe (ou Google) ET application. */
  private exigerSessionForte() {
    const s = this.etat.session;
    if (!s) throw new ErreurMoteur("non connecté");
    if (s.aal !== "aal2" || (s.facteur !== "password" && s.facteur !== "oauth")) throw new ErreurMoteur("double authentification requise", "entrez le code de votre application d'authentification");
  }

  private utilisateur(): UtilisateurDemo {
    const email = this.etat.session?.email;
    const u = email ? this.etat.utilisateurs[email] : undefined;
    if (!u) throw new ErreurMoteur("non connecté");
    return u;
  }

  private dossier(): Dossier {
    this.exigerSessionForte();
    const email = this.etat.session?.email;
    const d = email ? this.etat.dossiers[email] : undefined;
    if (!d) throw new ErreurMoteur(email ? "compte pas encore ouvert" : "non connecté");
    return d;
  }

  private compteParId(): Compte {
    const d = this.dossier();
    const { conditionsVersion, ...compte } = d.compte;
    return { ...compte, entreDuJour: entreDuJour(d), conditionsAJour: conditionsVersion === VERSION_CONDITIONS, langue: compte.langue === "fr" ? "fr" : "en", fermeLe: compte.fermeLe ?? null, desactive: Boolean(compte.desactive) };
  }

  private reference(d: Dossier, prefixe: string): string {
    d.compteur += 1;
    return `${prefixe}${String(d.compteur).padStart(6, "0")}`;
  }

  private mouvement(d: Dossier, actif: Actif, dispo: number, bloque: number) {
    const s = d.soldes[actif];
    const nd = arrondi2(s.disponible + dispo);
    const nb = arrondi2(s.bloque + bloque);
    if (nd < -1e-9 || nb < -1e-9) throw new ErreurMoteur("solde insuffisant");
    s.disponible = Math.max(0, nd);
    s.bloque = Math.max(0, nb);
  }

  private notifier(d: Dossier, titre: string, texte: string, cible: string) {
    d.notifications.unshift({ id: uuid(), quand: iso(), titre, texte, cible, lue: false });
  }

  private planifier(d: Dossier, t: Tache) {
    d.taches.push(t);
  }

  /* ------------------------------------------- la vérification avant sortie */

  /** Comme _verrou_verification : dix échecs dans l'heure glissante bloquent toutes les sorties ; rend la fin du blocage. */
  private verrouDeSortie(email: string): number | null {
    const recents = this.etat.echecs.filter((e) => e.email === email && e.quand > maintenant() - VERIF.fenetreMs).sort((a, b) => b.quand - a.quand);
    return recents.length >= VERIF.echecsMax ? recents[VERIF.echecsMax - 1].quand + VERIF.fenetreMs : null;
  }

  private echec(v: VerificationDemo, facteur: "mot_de_passe" | "code_email", message: string): never {
    v.essais += 1;
    this.etat.echecs.push({ email: v.email, quand: maintenant() });
    this.emettre();
    const restants = Math.max(0, VERIF.essais - v.essais);
    throw new ErreurMoteur(message, `${restants} essai(s) restant(s)`, { essaisRestants: restants, facteur }); // langue-ok (le détail se relit dans noyau/erreurs)
  }

  /** Les trois preuves, dans l'ordre de la base : la vérification elle-même, le code de l'application (frais), le mot de passe, le code e-mail. */
  /** comme la base : le code demandé pour refaire une opération déjà faite n'a rien prouvé, il se clôt */
  private cloreRejouee(operation: OperationAVerifier["operation"], id: string) {
    const v = this.etat.verifications.find((x) => x.id === id && x.email === this.etat.session?.email && x.operation === operation);
    if (v && !v.consommee && !v.remplacee) { v.remplacee = true; this.emettre(); }
  }

  private consommer(op: OperationAVerifier, preuve: PreuveDeVerification) {
    const s = this.etat.session!;
    const v = this.etat.verifications.find((x) => x.id === preuve.verification);
    if (!v || v.email !== s.email) throw new ErreurMoteur("vérification inconnue");
    const verrou = this.verrouDeSortie(s.email);
    if (verrou) throw new ErreurMoteur("vérifications verrouillées", undefined, { verrouJusqua: iso(verrou) });
    if (v.consommee) throw new ErreurMoteur("vérification déjà utilisée");
    if (v.remplacee) throw new ErreurMoteur("vérification remplacée par un code plus récent");
    if (v.expireLe <= maintenant()) throw new ErreurMoteur("vérification expirée");
    if (v.essais >= VERIF.essais) throw new ErreurMoteur("vérification épuisée");
    if (v.operation !== op.operation || v.empreinte !== empreinteDe(op)) throw new ErreurMoteur("la vérification ne correspond pas à cette opération");
    const totpFrais = s.aal === "aal2" && s.totpLe !== null && s.totpLe >= v.creeLe - 5_000 && maintenant() - s.totpLe <= VERIF.fraicheurTotpMs;
    if (!totpFrais) throw new ErreurMoteur("code de l'application d'authentification à saisir", undefined, { facteur: "totp" });
    const u = this.utilisateur();
    if (!u.motDePasse) throw new ErreurMoteur("mot de passe à choisir", "il protège chaque sortie d'argent");
    if (preuve.motDePasse !== u.motDePasse) this.echec(v, "mot_de_passe", "mot de passe incorrect");
    if (preuve.codeEmail !== CODE_DEMO) this.echec(v, "code_email", "code e-mail incorrect");
    v.consommee = true;
  }

  /** Les contrôles d'une sortie, communs à la demande du code et à l'opération (aucun code pour une sortie qui serait refusée). */
  private controlerSortie(d: Dossier, montant: number, numeroId: string, nom?: string): Numero {
    if (!montantValide(montant, 100)) throw new ErreurMoteur("montant invalide");
    const n = d.numeros.find((x) => x.id === numeroId && !x.retireLe);
    if (!n) throw new ErreurMoteur("numéro inconnu sur ce compte");
    if (!n.verifieLe || new Date(n.actifDes).getTime() > maintenant()) throw new ErreurMoteur("numéro pas encore actif");
    if (d.soldes.XAFe.disponible < montant) throw new ErreurMoteur("solde insuffisant");
    const p = PALIERS[d.compte.palier];
    if (p.sortieJour !== null) {
      const debut = new Date().setHours(0, 0, 0, 0);
      const jour = d.sorties.filter((x) => new Date(x.creeLe).getTime() >= debut && !["annulee", "echouee"].includes(x.etat)).reduce((s, x) => s + x.montant, 0);
      if (jour + montant > p.sortieJour) throw new ErreurMoteur("plafond du palier atteint", `${p.sortieJour} XAF par jour`);
    }
    if (SORTIES.mode === "manuel") {
      const propre = (nom ?? "").trim().replace(/\s+/g, " ");
      if (propre.length < 2 || propre.length > 80) throw new ErreurMoteur("nom du bénéficiaire invalide", "le nom exact du compte Mobile Money qui reçoit");
    }
    return n;
  }

  private controlerRetraitCrypto(d: Dossier, actif: Actif, reseau: Reseau, adresse: string, montant: number) {
    if (!(montant > 0)) throw new ErreurMoteur("montant invalide");
    if (!RESEAUX_OUVERTS.includes(reseau)) throw new ErreurMoteur(RESEAUX[reseau] ? "réseau pas encore ouvert" : "réseau inconnu");
    if (!adresseValide(infoReseau(reseau).famille, adresse.trim())) throw new ErreurMoteur("adresse invalide");
    if (d.soldes[actif].disponible < montant + FRAIS_CRYPTO[actif]) throw new ErreurMoteur("solde insuffisant");
  }

  private controlerFermeture(d: Dossier) {
    if (d.compte.fermeLe) throw new ErreurMoteur("compte déjà fermé");
    const reste = (["XAFe", "USDT"] as const).filter((a) => d.soldes[a].disponible + d.soldes[a].bloque > 0)
      .map((a) => `${a === "XAFe" ? xafDe(d.soldes[a].disponible + d.soldes[a].bloque) : (d.soldes[a].disponible + d.soldes[a].bloque).toFixed(2)} ${a}`);
    if (reste.length) throw new ErreurMoteur("il reste de l'argent sur le compte", `sortez d'abord : ${reste.join(", ")}`);
    if (d.ordres.some((o) => o.etat === "ouvert" || o.etat === "partiel") || d.depots.some((x) => x.etat === "en_attente")
        || d.sorties.some((s) => s.etat === "en_attente" || s.etat === "en_cours") || d.retraits.some((r) => r.etat === "en_attente")) {
      throw new ErreurMoteur("une opération est en cours", "attendez qu'elle se termine, ou annulez-la");
    }
  }

  private controlerRetraitDeNumero(d: Dossier, id: string): Numero {
    const n = d.numeros.find((x) => x.id === id && !x.retireLe);
    if (!n) throw new ErreurMoteur("numéro inconnu sur ce compte");
    if (d.numeros.filter((x) => !x.retireLe).length <= 1) throw new ErreurMoteur("le dernier numéro ne se retire pas");
    return n;
  }

  /* ------------------------------------------------------- les tâches */

  /** Le faux TOTEM et la fausse chaîne : ce qui arrive « tout seul », plus tard. */
  private executerTaches(): boolean {
    let bouge = false;
    for (const d of Object.values(this.etat.dossiers)) {
      const echues = d.taches.filter((t) => t.quand <= maintenant());
      if (!echues.length) continue;
      d.taches = d.taches.filter((t) => t.quand > maintenant());
      for (const t of echues) {
        bouge = true;
        if (t.type === "sms") this.smsRecu(d, t.reference, t.declarationId);
        else if (t.type === "transfert") this.transfertAvance(d, t.reference, t.index, t.etape);
        else if (t.type === "manuelle") this.manuelleAvance(d, t.reference, t.etape);
        else if (t.type === "retrait") this.retraitParti(d, t.reference);
        else if (t.type === "expiration") this.expirer(d, t.reference);
      }
    }
    return bouge;
  }

  /**
   * Le faux TOTEM a lu le SMS du float qui porte ce transaction ID. Dans la vraie
   * vie, le montant est celui du SMS ; ici, il se déduit de l'ID pour que la démo
   * soit prévisible : les trois derniers chiffres × 1 000 (au moins 5 000), et un
   * ID qui contient « X » n'est jamais trouvé — pour voir aussi ce chemin-là.
   */
  private smsRecu(d: Dossier, reference: string, declarationId: string) {
    const dep = d.depots.find((x) => x.reference === reference);
    const decl = dep?.declarations.find((x) => x.id === declarationId);
    if (!dep || !decl || decl.etat !== "attendu") return;
    if (decl.transactionId.includes("X")) return;
    /* le faux SMS dit ce que le client a déclaré : dans la démonstration, il a toujours bien recopié */
    const chiffres = decl.transactionId.replace(/\D/g, "");
    const montant = decl.montantDeclare ?? Math.max(5_000, Number(chiffres.slice(-3) || "250") * 1_000);
    const p = PALIERS[d.compte.palier];
    if (p.entreeJour !== null) {
      if (entreDuJour(d) + montant > p.entreeJour) {
        decl.etat = "refuse"; decl.montant = montant; decl.motif = "plafond du palier atteint : l'argent est retenu, l'équipe vous rembourse";
        this.notifier(d, "Paiement retenu", `${montant.toLocaleString("fr-FR")} XAF reçus au-delà de votre palier : ils vous seront remboursés.`, `/historique/${reference}`);
        return;
      }
    }
    decl.etat = "credite"; decl.montant = montant; decl.numeroPayeur = d.numeros[0]?.numero ?? d.compte.telephone; decl.crediteLe = iso(); decl.luLe = iso(maintenant() - 2_000);
    dep.montantRecu += montant;
    dep.etat = "credite";
    dep.crediteLe = iso();
    this.mouvement(d, "XAFe", montant, 0);
    this.notifier(d, "XAFe crédités", `+${montant.toLocaleString("fr-FR")} XAFe reçus par ${opDe(dep.operateur).nom}.`, `/historique/${reference}`);
  }

  private expirer(d: Dossier, reference: string) {
    const dep = d.depots.find((x) => x.reference === reference);
    if (dep && dep.etat === "en_attente" && dep.declarations.length === 0) dep.etat = "expire";
  }

  private transfertAvance(d: Dossier, reference: string, index: number, etape: "en_cours" | "faite" | "echouee") {
    const s = d.sorties.find((x) => x.reference === reference);
    if (!s) return;
    const t = s.transferts[index];
    if (!t || t.etat === "faite" || t.etat === "echouee") return;
    if (etape === "en_cours") { t.etat = "en_cours"; s.etat = "en_cours"; return; }
    if (etape === "faite") {
      t.etat = "faite";
      t.referenceOperateur = String(Math.floor(1_000_000_000 + Math.random() * 8_999_999_999));
      this.mouvement(d, "XAFe", 0, -t.montant);
      s.montantEnvoye += t.envoi;
    } else {
      t.etat = "echouee";
      this.mouvement(d, "XAFe", t.montant, -t.montant);
      s.montantRendu += t.montant;
    }
    if (s.transferts.every((x) => x.etat === "faite" || x.etat === "echouee")) {
      const faits = s.transferts.filter((x) => x.etat === "faite").length;
      s.etat = faits === s.transferts.length ? "envoyee" : faits === 0 ? "echouee" : "partielle";
      s.termineeLe = iso();
      this.notifier(d, s.etat === "envoyee" ? "Sortie envoyée" : s.etat === "echouee" ? "Sortie échouée" : "Sortie partielle",
        s.etat === "envoyee" ? `${s.montantEnvoye.toLocaleString("fr-FR")} XAF envoyés au ${s.numero}.` : `${s.montantRendu.toLocaleString("fr-FR")} XAFe sont revenus sur votre compte.`,
        `/historique/${reference}`);
    }
  }

  /* la fausse équipe : elle prend la demande, la paie (la sortie passe « en preuve », rien n'est détruit), puis le
     faux SMS de la puce la prouve (0038) — ou elle refuse, pour un nom qui finit par « refus », qu'on voie aussi ce chemin-là */
  private manuelleAvance(d: Dossier, reference: string, etape: "prise" | "payee" | "prouvee" | "refusee") {
    const s = d.sorties.find((x) => x.reference === reference);
    if (!s || !["en_attente", "en_cours", "en_preuve"].includes(s.etat)) return;
    if (etape === "prise") { s.etat = "en_cours"; s.prisLe = iso(); return; }
    if (etape === "payee") {
      s.transactionId = `MP${new Date().toISOString().slice(2, 10).replace(/-/g, "")}.${String(Math.floor(1000 + Math.random() * 8999))}.A${String(Math.floor(10000 + Math.random() * 89999))}`;
      s.payeeLe = iso();
      s.paiements = [{ transactionId: s.transactionId, montant: s.montantXaf }];
      s.etat = "en_preuve";
      return;
    }
    if (etape === "prouvee") {
      if (s.etat !== "en_preuve") return;
      this.mouvement(d, "XAFe", 0, -s.montant);
      s.montantEnvoye = s.montantXaf;
      s.etat = "envoyee";
      s.termineeLe = iso();
      s.prouveeLe = iso();
      this.notifier(d, "Sortie envoyée", `${s.montantXaf.toLocaleString("fr-FR")} XAF envoyés au ${s.numero}. Transaction ID : ${s.transactionId}.`, `/historique/${reference}`);
      return;
    }
    if (s.etat === "en_preuve") return;   // payée : elle ne se refuse plus
    this.mouvement(d, "XAFe", s.montant, -s.montant);
    s.montantRendu = s.montant;
    s.etat = "annulee";
    s.motif = "Le nom du compte Mobile Money ne correspond pas à celui de votre compte Glisil.";
    s.termineeLe = iso();
    this.notifier(d, "Sortie refusée", `${s.montant.toLocaleString("fr-FR")} XAFe sont revenus sur votre compte.`, `/historique/${reference}`);
  }

  private retraitParti(d: Dossier, reference: string) {
    const r = d.retraits.find((x) => x.reference === reference);
    if (!r || r.etat !== "en_attente") return;
    r.etat = "envoye";
    r.txHash = `0x${Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}…`;
    this.mouvement(d, r.actif, 0, -(r.montant + r.frais));
    d.transferts.push({ id: uuid(), actif: r.actif, reseau: r.reseau, sens: "sortie", montant: r.montant, txHash: r.txHash, adresse: r.adresse, quand: iso() });
    this.notifier(d, `${r.actif} envoyés`, `${r.montant} ${r.actif} partis vers ${r.adresse.slice(0, 8)}… (${r.reseau.toUpperCase()}).`, `/historique/${reference}`);
  }

  /** Le prix marche ; ce qu'il croise de MES ordres au carnet s'exécute (frais placeur). */
  private battreLeMarche() {
    const m = this.etat.marche;
    m.alea += 1;
    const pas = (alea(m.alea) - 0.5) * 0.3;
    m.mid = arrondi2(Math.max(600, Math.min(640, auPas(m.mid + pas))));
    const cote: Cote = pas >= 0 ? "achat" : "vente";
    const q = Math.round(30 + alea(m.alea + 0.5) * 2500);
    m.transactions.unshift({ quand: iso(), prix: m.mid, quantite: q, cote });
    m.transactions = m.transactions.slice(0, 60);
    const derniere = m.chandelles[m.chandelles.length - 1];
    const heureCourante = new Date().setMinutes(0, 0, 0);
    if (new Date(derniere.t).getTime() < heureCourante) {
      m.chandelles.push({ t: iso(heureCourante), o: derniere.c, h: m.mid, l: m.mid, c: m.mid, v: q });
      m.chandelles = m.chandelles.slice(-60);
    } else {
      derniere.c = m.mid; derniere.h = Math.max(derniere.h, m.mid); derniere.l = Math.min(derniere.l, m.mid); derniere.v += q;
    }
    for (const d of Object.values(this.etat.dossiers)) {
      for (const o of d.ordres) {
        if (!["ouvert", "partiel"].includes(o.etat) || o.prix === null) continue;
        const croise = o.cote === "achat" ? m.mid <= o.prix : m.mid >= o.prix;
        if (!croise) continue;
        const part = alea(m.alea + o.quantite) < 0.5 ? o.restant : arrondi2(Math.max(0.01, o.restant * alea(m.alea + 3)));
        this.executer(d, o, o.prix, Math.min(o.restant, part), false);
      }
    }
  }

  /* --------------------------------------------------- l'appariement */

  /** Une exécution de MON ordre `o` : `q` USDT au prix `px`. Le solde suit le moteur. */
  private executer(d: Dossier, o: Ordre, px: number, q: number, preneur: boolean) {
    q = arrondi2(q);
    if (q <= 0) return;
    const taux = preneur ? FRAIS.preneur : FRAIS.placeur;
    const xafe = arrondi2(q * px);
    let frais: number;
    let fraisActif: Actif;
    if (o.cote === "achat") {
      frais = arrondi2(q * taux); fraisActif = "USDT";
      if (o.type === "limite" && o.prix !== null) {
        /* les XAFe étaient bloqués à MON prix ; la différence avec le prix d'exécution revient */
        const diff = arrondi2(q * (o.prix - px));
        this.mouvement(d, "XAFe", diff, -xafe - diff);
        o.bloque = arrondi2(o.bloque - xafe - diff);
      } else {
        this.mouvement(d, "XAFe", -xafe, 0);
      }
      this.mouvement(d, "USDT", arrondi2(q - frais), 0);
    } else {
      frais = Math.round(xafe * taux); fraisActif = "XAFe";
      this.mouvement(d, "USDT", 0, -q);
      o.bloque = arrondi2(o.bloque - q);
      this.mouvement(d, "XAFe", xafe - frais, 0);
    }
    o.restant = arrondi2(o.restant - q);
    o.executee = arrondi2(o.executee + q);
    o.totalXafe = arrondi2(o.totalXafe + xafe);
    o.prixMoyen = arrondi2(o.totalXafe / o.executee);
    o.etat = o.restant <= 0 ? "execute" : "partiel";
    o.majLe = iso();
    if (o.restant <= 0 && o.bloque > 0) {
      /* un reste d'arrondi bloqué revient */
      this.mouvement(d, o.cote === "achat" ? "XAFe" : "USDT", o.bloque, -o.bloque);
      o.bloque = 0;
    }
    d.executions.unshift({ id: uuid(), ordreId: o.id, prix: px, quantite: q, montantXafe: xafe, frais, fraisActif, cote: o.cote, preneur, quand: iso() });
    this.etat.marche.transactions.unshift({ quand: iso(), prix: px, quantite: q, cote: o.cote });
    this.etat.marche.mid = px;
    if (o.etat === "execute") this.notifier(d, "Ordre exécuté", `${o.cote === "achat" ? "Achat" : "Vente"} de ${o.quantite} USDT à ${o.prixMoyen} en moyenne.`, `/marche/ordres/${o.id}`);
  }

  /* ============================================================ session */

  async session() {
    const email = this.etat.session?.email;
    return email ? { compteId: this.etat.dossiers[email]?.compte.id ?? email } : null;
  }

  async etatDEntree(): Promise<EtatDEntree> {
    const s = this.etat.session;
    const u = s ? this.etat.utilisateurs[s.email] : undefined;
    if (!s || !u) return { session: false, premierFacteur: null, aalActuel: null, aalSuivant: null, emailConfirme: false, motDePasse: false, codesDeSecours: false, compte: false, facteurTotpId: null };
    return {
      session: true, premierFacteur: s.facteur, aalActuel: s.aal, aalSuivant: u.totp === "verifie" ? "aal2" : "aal1",
      emailConfirme: u.emailConfirme, motDePasse: Boolean(u.motDePasse), codesDeSecours: u.codesConfirmes,
      compte: Boolean(this.etat.dossiers[s.email]), facteurTotpId: u.totp === "verifie" ? "demo-totp" : null,
    };
  }

  async inscrire({ email, motDePasse }: { email: string; motDePasse: string }) {
    const e = emailNormalise(email);
    if (!emailValide(e)) throw new ErreurMoteur("adresse e-mail invalide");
    if (!motDePasseValide(motDePasse)) throw new ErreurMoteur("mot de passe trop faible");
    const u = this.etat.utilisateurs[e];
    if (e === EMAIL_VITRINE || u?.emailConfirme) return { dejaInscrit: true, session: false };
    this.etat.utilisateurs[e] = { ...(u ?? utilisateurNeuf(null)), motDePasse };
    this.etat.codeAttendu = CODE_DEMO;
    this.sauver();
    return { dejaInscrit: false, session: false };
  }

  async confirmerEmail({ email, code, motDePasse }: { email: string; code: string; motDePasse?: string }) {
    const e = emailNormalise(email);
    const u = this.etat.utilisateurs[e];
    if (!u || code !== this.etat.codeAttendu) throw new ErreurMoteur("code incorrect ou expiré", "demandez-en un nouveau si besoin");
    u.emailConfirme = true;
    this.etat.codeAttendu = null;
    const connecte = Boolean(motDePasse) && motDePasse === u.motDePasse;
    this.etat.session = connecte ? { email: e, aal: "aal1", facteur: "password", totpLe: null } : null;
    this.emettre();
    return { connecte };
  }

  async renvoyerConfirmation(email: string) {
    if (!this.etat.utilisateurs[emailNormalise(email)]) return;
    this.etat.codeAttendu = CODE_DEMO;
    this.sauver();
  }

  async connecter({ email, motDePasse }: { email: string; motDePasse: string }) {
    const e = emailNormalise(email);
    if (e === EMAIL_VITRINE && !this.etat.utilisateurs[e]) this.etat.utilisateurs[e] = utilisateurVitrine();
    if (e === EMAIL_VITRINE && !this.etat.dossiers[e]) this.etat.dossiers[e] = dossierVitrine();
    const u = this.etat.utilisateurs[e];
    if (!u || !u.motDePasse || u.motDePasse !== motDePasse) throw new ErreurMoteur("adresse ou mot de passe incorrect");
    if (!u.emailConfirme) { this.etat.codeAttendu = CODE_DEMO; this.sauver(); throw new ErreurMoteur("adresse e-mail non confirmée"); }
    this.etat.session = { email: e, aal: "aal1", facteur: "password", totpLe: null };
    this.emettre();
  }

  async connecterGoogle() { throw new ErreurMoteur("connexion Google annulée", "pas de Google dans la démonstration"); }
  async terminerRetourOAuth(_url: string) { throw new ErreurMoteur("connexion Google annulée"); }

  async choisirMotDePasse(motDePasse: string) {
    const u = this.utilisateur();
    if (!motDePasseValide(motDePasse)) throw new ErreurMoteur("mot de passe trop faible");
    u.motDePasse = motDePasse;
    this.emettre();
  }

  private enrolementDemo(): EnrolementTotp {
    const email = this.etat.session?.email ?? "";
    const uri = `otpauth://totp/Glisil:${encodeURIComponent(email)}?secret=${SECRET_TOTP_DEMO}&issuer=Glisil&algorithm=SHA1&digits=6&period=30`;
    return { facteurId: "demo-totp-neuf", qr: "", secret: SECRET_TOTP_DEMO, uri };
  }

  async enrolerDeuxFacteurs() {
    const u = this.utilisateur();
    if (u.totp === "verifie") throw new ErreurMoteur("double authentification requise");
    u.totp = "en_attente";
    this.sauver();
    return this.enrolementDemo();
  }

  async confirmerDeuxFacteurs({ code }: { facteurId: string; code: string }) {
    const u = this.utilisateur();
    if (code !== CODE_TOTP_DEMO) throw new ErreurMoteur("code de l'application incorrect");
    u.totp = "verifie";
    this.etat.session = { ...this.etat.session!, aal: "aal2", totpLe: maintenant() };
    this.emettre();
  }

  async verifierDeuxFacteurs(code: string) {
    const u = this.utilisateur();
    if (u.totp !== "verifie") throw new ErreurMoteur("aucune application d'authentification");
    if (code !== CODE_TOTP_DEMO) throw new ErreurMoteur("code de l'application incorrect");
    this.etat.session = { ...this.etat.session!, aal: "aal2", totpLe: maintenant() };
    this.emettre();
  }

  async genererCodesDeSecours() {
    const u = this.utilisateur();
    const s = this.etat.session!;
    if (s.aal !== "aal2") throw new ErreurMoteur("double authentification requise");
    if (u.codesConfirmes && (s.totpLe === null || maintenant() - s.totpLe > VERIF.fraicheurTotpMs)) {
      throw new ErreurMoteur("confirmez avec votre application d'authentification", "entrez un code tout neuf, puis recommencez");
    }
    u.codes = CODES_DE_SECOURS_DEMO.map((code) => ({ code, utilise: false }));
    u.codesConfirmes = false;
    u.essaisCodes = 0;
    u.verrouCodes = null;
    this.emettre();
    return [...CODES_DE_SECOURS_DEMO];
  }

  async confirmerCodesDeSecours() {
    const u = this.utilisateur();
    if (!u.codes?.some((c) => !c.utilise)) throw new ErreurMoteur("aucun code de secours");
    u.codesConfirmes = true;
    this.emettre();
  }

  async codesDeSecours(): Promise<EtatCodesDeSecours> {
    const u = this.utilisateur();
    return { confirmes: u.codesConfirmes, restants: (u.codes ?? []).filter((c) => !c.utilise).length, creesLe: u.codes ? iso() : null };
  }

  async utiliserCodeDeSecours(code: string) {
    const u = this.utilisateur();
    if (!u.codes) throw new ErreurMoteur("aucun code de secours");
    if (u.verrouCodes && u.verrouCodes > maintenant()) throw new ErreurMoteur("trop d'essais", undefined, { verrouJusqua: iso(u.verrouCodes) });
    const c = codeDeSecoursNormalise(code);
    const trouve = c ? u.codes.find((x) => !x.utilise && x.code === c) : undefined;
    if (!trouve) {
      u.essaisCodes += 1;
      const restants = Math.max(0, 5 - u.essaisCodes);
      if (restants === 0) { u.verrouCodes = maintenant() + 15 * 60_000; u.essaisCodes = 0; }
      this.emettre();
      throw new ErreurMoteur("code de secours incorrect", `${restants} essai(s) restant(s)`, { essaisRestants: restants }); // langue-ok
    }
    /* comme deux-facteurs : le code sert une fois, l'application est retirée, les codes avec elle */
    trouve.utilise = true;
    u.totp = "aucun";
    u.codes = null;
    u.codesConfirmes = false;
    u.essaisCodes = 0;
    this.etat.session = { ...this.etat.session!, aal: "aal1", totpLe: null };
    this.emettre();
  }

  async motDePasseOublie(email: string) {
    const e = emailNormalise(email);
    if (!emailValide(e)) throw new ErreurMoteur("adresse e-mail invalide");
    if (e === EMAIL_VITRINE && !this.etat.utilisateurs[e]) this.etat.utilisateurs[e] = utilisateurVitrine();
    this.etat.recuperation = e;
    this.etat.codeAttendu = CODE_DEMO;
    this.sauver();
  }

  async verifierCodeDeReinitialisation({ email, code }: { email: string; code: string }) {
    const e = emailNormalise(email);
    if (this.etat.recuperation !== e || code !== this.etat.codeAttendu || !this.etat.utilisateurs[e]) throw new ErreurMoteur("code incorrect ou expiré", "demandez-en un nouveau si besoin");
    this.etat.codeAttendu = null;
    this.etat.recuperation = null;
    this.etat.session = { email: e, aal: "aal1", facteur: "autre", totpLe: null };
    this.emettre();
  }

  async nouveauMotDePasse(motDePasse: string) {
    const u = this.utilisateur();
    if (u.totp === "verifie" && this.etat.session?.aal !== "aal2") throw new ErreurMoteur("double authentification requise");
    if (!motDePasseValide(motDePasse)) throw new ErreurMoteur("mot de passe trop faible");
    if (u.motDePasse === motDePasse) throw new ErreurMoteur("choisissez un mot de passe différent");
    u.motDePasse = motDePasse;
    u.emailConfirme = true;
    this.etat.session = null;
    this.emettre();
    for (const cb of this.entree) cb("deconnecte");
  }

  async changerMotDePasse({ nouveau }: { nouveau: string; nonce?: string }) {
    this.exigerSessionForte();
    const u = this.utilisateur();
    if (!motDePasseValide(nouveau)) throw new ErreurMoteur("mot de passe trop faible");
    if (u.motDePasse === nouveau) throw new ErreurMoteur("choisissez un mot de passe différent");
    u.motDePasse = nouveau;
    this.emettre();
  }

  async commencerChangementDeTelephone() {
    this.exigerSessionForte();
    return this.enrolementDemo();
  }

  async terminerChangementDeTelephone({ code }: { facteurId: string; code: string }) {
    this.exigerSessionForte();
    if (code !== CODE_TOTP_DEMO) throw new ErreurMoteur("code de l'application incorrect");
    this.etat.session = { ...this.etat.session!, totpLe: maintenant() };
    this.emettre();
  }

  async seDeconnecter(_portee?: "local" | "global") {
    this.etat.session = null;
    this.emettre();
    for (const cb of this.entree) cb("deconnecte");
  }

  tempsReel(_actif: boolean) { /* la démonstration prévient à chaque changement, sans canal */ }

  surEntree(cb: (e: EvenementDEntree) => void) {
    this.entree.add(cb);
    return () => { this.entree.delete(cb); };
  }

  /* ---------------------------------------- la vérification avant sortie */

  async preparerVerification(op: OperationAVerifier): Promise<Verification> {
    const d = this.dossier();
    const email = this.etat.session!.email;
    const verrou = this.verrouDeSortie(email);
    if (verrou) throw new ErreurMoteur("vérifications verrouillées", undefined, { verrouJusqua: iso(verrou) });
    const miennes = this.etat.verifications.filter((v) => v.email === email);
    /* les contrôles de l'opération d'abord : aucun code n'est envoyé pour une opération qui serait refusée */
    if (op.operation === "sortie_momo") this.controlerSortie(d, op.montant, op.numeroId, op.nom);
    else if (op.operation === "retrait_crypto") this.controlerRetraitCrypto(d, op.actif, op.reseau, op.adresse, op.montant);
    else if (op.operation === "fermer_compte") this.controlerFermeture(d);
    else if (op.operation === "retirer_numero") this.controlerRetraitDeNumero(d, op.numeroId);
    else throw new ErreurMoteur("opération inconnue");
    const [local, domaine] = email.split("@");
    const vue = (v: VerificationDemo): Verification => ({ id: v.id, expireLe: iso(v.expireLe), renvoiDes: iso(v.creeLe + VERIF.renvoiMs), emailMasque: `${local.slice(0, 1)}•••@${domaine ?? ""}` });
    /* comme la base : le même écran rouvert dans la minute rend le code déjà parti */
    const ouverte = miennes.find((v) => v.operation === op.operation && v.empreinte === empreinteDe(op) && !v.consommee && !v.remplacee && v.expireLe > maintenant() && v.creeLe > maintenant() - VERIF.renvoiMs);
    if (ouverte) return vue(ouverte);
    /* un code qui a servi ne retient pas le suivant */
    if (miennes.some((v) => !v.consommee && !v.remplacee && v.creeLe > maintenant() - VERIF.renvoiMs)) throw new ErreurMoteur("trop de codes demandés : attendez une minute");
    if (miennes.filter((v) => v.creeLe > maintenant() - 15 * 60_000).length >= VERIF.parQuartDHeure) throw new ErreurMoteur("trop de vérifications demandées", "attendez un quart d'heure");
    for (const v of miennes) if (v.operation === op.operation && !v.consommee && !v.remplacee && v.expireLe > maintenant()) v.remplacee = true;
    const v: VerificationDemo = { id: uuid(), email, operation: op.operation, empreinte: empreinteDe(op), creeLe: maintenant(), expireLe: maintenant() + VERIF.validiteMs, essais: 0, consommee: false, remplacee: false };
    this.etat.verifications = [...this.etat.verifications.filter((x) => x.expireLe > maintenant() - 24 * 3600_000), v];
    this.emettre();
    return vue(v);
  }

  async etatVerification(id: string): Promise<EtatVerification | null> {
    const v = this.etat.verifications.find((x) => x.id === id && x.email === this.etat.session?.email);
    return v ? { courriel: "envoye", essaisRestants: Math.max(0, VERIF.essais - v.essais) } : null;
  }

  /* ============================================================= compte */

  async compte() { return copie(this.compteParId()); }

  async monCompte() {
    const email = this.etat.session?.email;
    return email && this.etat.dossiers[email] ? copie(this.compteParId()) : null;
  }

  async ouvrirCompte(p: ProfilInscription) {
    const email = this.etat.session?.email;
    if (!email) throw new ErreurMoteur("non connecté");
    if (this.etat.dossiers[email]) throw new ErreurMoteur("compte déjà ouvert");
    if (Object.values(this.etat.dossiers).some((d) => d.compte.telephone === p.telephone)) throw new ErreurMoteur("ce numéro est déjà utilisé", "il appartient à un autre compte");
    if (p.conditions !== VERSION_CONDITIONS) throw new ErreurMoteur("conditions non acceptées", "lisez et acceptez les conditions en vigueur");
    this.etat.dossiers[email] = dossierVide(email, p);
    /* comme la base : la langue donnée à l'inscription devient celle du compte */
    this.etat.dossiers[email].compte.langue = langue();
    this.emettre();
    return copie(this.compteParId());
  }

  async nomPropose() { return null; }

  async choisirLangue(l: "fr" | "en") {
    if (l !== "fr" && l !== "en") throw new ErreurMoteur("langue inconnue");
    this.dossier().compte.langue = l;
    this.emettre();
  }

  async accepterConditions(version: string) {
    const d = this.dossier();
    if (version !== VERSION_CONDITIONS) throw new ErreurMoteur("conditions non acceptées", "ce ne sont pas les conditions en vigueur");
    d.compte.conditionsVersion = version;
    this.emettre();
    return copie(this.compteParId());
  }

  /** Comme la base : jamais avec de l'argent dessus ni une opération en cours ; la vérification d'abord. */
  async fermerCompte({ motif, preuve }: { motif: string; preuve: PreuveDeVerification }) {
    const d = this.dossier();
    this.controlerFermeture(d);
    this.consommer({ operation: "fermer_compte" }, preuve);
    d.compte.fermeLe = iso();
    d.compte.desactive = true;
    void motif;
    this.emettre();
    return copie(this.compteParId());
  }

  async demanderVerification({ type, pieces }: { type: "identite" | "entreprise"; pieces: File[] }) {
    const d = this.dossier();
    if (pieces.length === 0) throw new ErreurMoteur("aucune pièce jointe");
    d.compte.verificationEnCours = type;
    this.notifier(d, "Pièces reçues", "L'équipe vérifie votre dossier, en général sous 24 h ouvrées.", "/compte/paliers");
    this.emettre();
    return copie(this.compteParId());
  }

  async notifications() { return copie(this.dossier().notifications); }

  async marquerLues() {
    const d = this.dossier();
    d.notifications.forEach((n) => { n.lue = true; });
    this.emettre();
  }

  /* ============================================================= soldes */

  async soldes(): Promise<Soldes> {
    const s = this.dossier().soldes;
    return { XAFe: { ...s.XAFe }, USDT: { ...s.USDT } };
  }

  /* ========================================================= entrer */

  /** On ouvre le dossier d'un dépôt AVANT de payer : il dit où payer. */
  async ouvrirDepot({ operateur, cle }: { operateur: IdOperateur; cle: string }) {
    const d = this.dossier();
    const deja = d.depots.find((x) => (x as unknown as { cle?: string }).cle === cle);
    if (deja) return deja;
    const dep: Depot & { cle: string } = {
      reference: this.reference(d, "XAFe-DP-"), operateur, floatNumero: operateur === "mtn" ? "677000000" : "699000000", titulaire: "GLISIL DÉMONSTRATION", codeAgent: operateur === "om" ? "480213" : null, reception: "ouverte",
      montantRecu: 0, etat: "en_attente", creeLe: iso(), expireLe: iso(maintenant() + 30 * 60_000), crediteLe: null, declarations: [], cle,
    };
    d.depots.unshift(dep);
    this.planifier(d, { type: "expiration", reference: dep.reference, quand: maintenant() + 30 * 60_000 });
    this.emettre();
    return copie(dep);
  }

  async depot(reference: string) {
    const dep = this.dossier().depots.find((x) => x.reference === reference);
    if (!dep) throw new ErreurMoteur("dépôt inconnu");
    /* Couture d'épreuve (démonstration seulement) : le boîtier se tait, ou l'équipe retire le float. */
    const epreuve = (globalThis as { __xafeEpreuve?: { reception?: Depot["reception"] } }).__xafeEpreuve;
    return copie(avecChaine(epreuve?.reception && dep.etat === "en_attente" ? { ...dep, reception: epreuve.reception } : dep));
  }

  /** Le client tape le transaction ID de son SMS ; le faux TOTEM « trouve » le SMS trois secondes plus tard. */
  async retirerDeclaration({ reference, transactionId }: { reference: string; transactionId: string }) {
    const dep = this.dossier().depots.find((x) => x.reference === reference);
    if (!dep) throw new ErreurMoteur("dépôt inconnu");
    const decl = dep.declarations.find((x) => x.transactionId === transactionIdNormalise(transactionId));
    if (!decl) throw new ErreurMoteur("transaction ID inconnu sur ce dépôt");
    if (decl.etat !== "attendu") throw new ErreurMoteur("cette déclaration ne se retire plus");
    dep.declarations = dep.declarations.filter((x) => x !== decl);
    this.emettre();
    return copie(dep);
  }

  async declarerTransaction({ reference, transactionId, numero, montant, nom }: { reference: string; transactionId: string; numero: string; montant: number; nom: string }): Promise<Declaration> {
    const d = this.dossier();
    const dep = d.depots.find((x) => x.reference === reference);
    if (!dep) throw new ErreurMoteur("dépôt inconnu");
    if (dep.etat === "annule") throw new ErreurMoteur("ce dépôt est annulé");
    const id = transactionIdNormalise(transactionId);
    if (id.length < 6) throw new ErreurMoteur("transaction ID invalide", "au moins six caractères, tel qu'il est écrit dans le SMS");
    const num = numeroSaisi(numero);
    if (!/^6\d{8}$/.test(num) || operateurDuNumero(num) !== dep.operateur) throw new ErreurMoteur("numéro du payeur invalide", "le numéro qui a payé, neuf chiffres, du même opérateur");
    if (!Number.isSafeInteger(montant) || montant <= 0) throw new ErreurMoteur("montant invalide", "le montant exact envoyé, en francs");
    if (nom.trim().length < 2) throw new ErreurMoteur("nom du payeur invalide", "le nom du titulaire du compte qui a payé");
    const partout = d.depots.flatMap((x) => x.declarations).find((x) => x.transactionId === id);
    if (partout) {
      if (dep.declarations.includes(partout)) return copie(partout);
      throw new ErreurMoteur("transaction ID déjà utilisé", "ce paiement a déjà été crédité");
    }
    const decl: Declaration = { id: uuid(), transactionId: id, etat: "attendu", montant: null, numeroPayeur: null, motif: null, declareLe: iso(), crediteLe: null,
      numeroDeclare: num, montantDeclare: montant, nomDeclare: nom.trim(), corrigible: false };
    dep.declarations.push(decl);
    this.planifier(d, { type: "sms", reference, declarationId: decl.id, quand: maintenant() + 3000 });
    this.emettre();
    return copie(decl);
  }

  /** « Terminer » : un dossier sans aucun paiement se ferme comme annulé, sinon il reste ce qu'il est. */
  async terminerDepot(reference: string) {
    const d = this.dossier();
    const dep = d.depots.find((x) => x.reference === reference);
    if (!dep) throw new ErreurMoteur("dépôt inconnu");
    if (dep.etat === "en_attente" && dep.declarations.length === 0) dep.etat = "annule";
    this.emettre();
    return copie(dep);
  }

  async annulerDepot(reference: string) {
    const d = this.dossier();
    const dep = d.depots.find((x) => x.reference === reference);
    if (!dep) throw new ErreurMoteur("dépôt inconnu");
    if (dep.etat !== "en_attente" || dep.declarations.some((x) => x.etat === "attendu")) throw new ErreurMoteur("ce dépôt ne peut plus être annulé");
    dep.etat = "annule";
    d.taches = d.taches.filter((t) => !("reference" in t && t.reference === reference));
    this.emettre();
    return copie(dep);
  }

  async depotsEnAttente() {
    return copie(this.dossier().depots.filter((x) => (x.etat === "en_attente" && new Date(x.expireLe).getTime() > maintenant()) || x.declarations.some((y) => y.etat === "attendu")));
  }

  /* ========================================================= sortir */

  async numeros() { return copie(this.dossier().numeros.filter((n) => !n.retireLe)); }

  async ajouterNumero({ operateur, numero }: { operateur: IdOperateur; numero: string }) {
    const d = this.dossier();
    const n = numeroSaisi(numero);
    if (!/^6\d{8}$/.test(n) || operateurDuNumero(n) !== operateur) throw new ErreurMoteur("numéro invalide");
    const deja = d.numeros.find((x) => x.numero === n && !x.retireLe);
    // comme le moteur (0020) : sans code SMS, le numéro est retenu tout de suite, après le délai réglé
    const sms = NUMEROS.verificationSms, delai = NUMEROS.delaiHeures * 3600_000;
    if (deja?.verifieLe) { if (!sms) return copie(deja); throw new ErreurMoteur("ce numéro est déjà sur votre compte"); }
    if (deja && !sms) { deja.verifieLe = iso(); deja.actifDes = iso(maintenant() + delai); this.emettre(); return copie(deja); }
    if (deja) { d.numerosEnAttente[deja.id] = CODE_SMS_DEMO; return copie(deja); }
    const nouveau: Numero = { id: uuid(), operateur, numero: n, verifieLe: sms ? null : iso(), actifDes: iso(maintenant() + delai), retireLe: null };
    d.numeros.push(nouveau);
    if (sms) d.numerosEnAttente[nouveau.id] = CODE_SMS_DEMO;
    this.emettre();
    return copie(nouveau);
  }

  async confirmerNumero({ id, code }: { id: string; code: string }) {
    const d = this.dossier();
    const n = d.numeros.find((x) => x.id === id);
    if (!n) throw new ErreurMoteur("numéro inconnu sur ce compte");
    if (d.numerosEnAttente[id] !== code) throw new ErreurMoteur("code SMS incorrect");
    n.verifieLe = iso();
    n.actifDes = iso(maintenant() + 24 * 3600_000);
    delete d.numerosEnAttente[id];
    this.emettre();
    return copie(n);
  }

  /** la démonstration garde les valeurs de la migration, écrites dans noyau/argent.ts */
  /* la démonstration a tout ouvert ; une épreuve peut poser les paramètres que l'équipe poserait (« seulement les dépôts ») */
  private signalements = 0;
  async signalerUnProbleme({ texte }: { texte: string; ecran?: string | null }) {
    this.dossier();
    const t = texte.trim();
    if (t.length < 3 || t.length > 2000) throw new ErreurMoteur("texte invalide");
    if (this.signalements >= 20) throw new ErreurMoteur("trop de signalements");
    return { reference: `SIG-${String(++this.signalements).padStart(6, "0")}` };
  }
  async parametres() { return (globalThis as { __xafeEpreuve?: { parametres?: unknown } }).__xafeEpreuve?.parametres ?? null; }

  /** La preuve de la démonstration : une maison en ordre, la frappe la plus récente encore en route. */
  async preuveDeReserve(): Promise<PreuveDeReserve> {
    const t = maintenant();
    const lignes: LignePreuve[] = [
      { reference: "XAFe-DP-000418", nature: "reserve", reseau: "bep20", genre: "frappe", montant: 500_000, depuis: iso(t - 20_000), empreinte: hex64("empreinte:XAFe-DP-000418"), tx_vu: null, bloc_vu: null, montant_vu: null, verdict: "en_route" },
      ...[["XAFe-DP-000401", 3_000_000, 20], ["XAFe-WD-000207", -49_500, 26], ["XAFe-DP-000377", 1_250_000, 31], ["XAFe-CR-000012", 750_000, 40], ["XAFe-DP-000350", 8_000_000, 52]].map(([ref, m, h], i): LignePreuve => {
        const montant = Math.abs(m as number);
        return { reference: ref as string, nature: String(ref).includes("-CR-") ? "retrait" : "reserve", reseau: "bep20", genre: (m as number) > 0 ? "frappe" : "destruction", montant,
                 depuis: iso(t - (h as number) * 3600_000), empreinte: hex64(`empreinte:${ref}`), tx_vu: hex64(`tx:${ref}`), bloc_vu: 137_261_987 - i * 1_200, montant_vu: montant, verdict: "concorde" };
      }),
    ];
    const registre = 12_450_500, enRoute = 500_000;
    return {
      releve: {
        fait_le: iso(t - 70_000), statut: "en_cours", registre, dans_comptes: registre - 750_000, sur_wallets: 750_000,
        chaine: registre - enRoute, offre_lue: registre - enRoute, en_route: enRoute, ecart: 0, floats: 14_000_000, couverture: Math.floor((14_620_000 - registre) / 1e6) * 1e6, floats_arrondi: 1_000_000, anomalies: 0,
        reseaux: [{ reseau: "bep20", offre: registre - enRoute, reserve: registre - enRoute - 750_000, bloc: 137_263_410, a_jour: true, lu_le: iso(t - 30_000) },
                  { reseau: "trc20", offre: 0, reserve: 0, bloc: 71_897_120, a_jour: true, lu_le: iso(t - 45_000) }],
        floats_detail: [{ operateur: "mtn", solde: 9_000_000, annonce_le: iso(t - 6 * 60_000), connu: true }, { operateur: "om", solde: 4_000_000, annonce_le: iso(t - 41 * 60_000), connu: true }],
      },
      historique: Array.from({ length: 48 }, (_, i) => ({ fait_le: iso(t - (48 - i) * 3600_000), statut: "juste" as const, registre: registre - (48 - i) * 60_000, chaine: registre - (48 - i) * 60_000, ecart: 0, floats: Math.floor((14_620_000 - (48 - i) * 50_000) / 1e6) * 1e6 })),
      contrats: [{ reseau: "bep20", contrat: "0x750E774368240063BD5CF52b30b91183Efa4dAf3", explorateur: "https://testnet.bscscan.com", reserve: "0x771C971497E4409d0225350C49609691E955465C" },
                 { reseau: "trc20", contrat: "TFtfFFmagGUjxGrG3cM4MX4kTv8YvBgLnk", explorateur: "https://nile.tronscan.org/#", reserve: "TEW4N3ZiF23GxHTYu8pen6r8uhHeZpALYZ" }],
      essai: true, lignes, alertes: 0,
    };
  }

  async renvoyerCodeNumero(id: string) {
    const d = this.dossier();
    const n = d.numeros.find((x) => x.id === id && !x.retireLe);
    if (!n) throw new ErreurMoteur("numéro inconnu sur ce compte");
    if (!n.verifieLe) d.numerosEnAttente[id] = CODE_SMS_DEMO;
    return copie(n);
  }

  async retirerNumero({ id, preuve }: { id: string; preuve: PreuveDeVerification }) {
    const d = this.dossier();
    const n = this.controlerRetraitDeNumero(d, id);
    this.consommer({ operation: "retirer_numero", numeroId: id }, preuve);
    n.retireLe = iso();
    this.emettre();
  }

  async demanderSortie({ montant, numeroId, cle, preuve, nom }: { montant: number; numeroId: string; cle: string; preuve: PreuveDeVerification; nom?: string }) {
    const d = this.dossier();
    /* la clé d'abord : une réponse perdue puis rejouée rend la sortie déjà faite, même si sa vérification a servi */
    const deja = d.sorties.find((x) => (x as unknown as { cle?: string }).cle === cle);
    if (deja) { this.cloreRejouee("sortie_momo", preuve.verification); return copie(deja); }
    const n = this.controlerSortie(d, montant, numeroId, nom);
    this.consommer({ operation: "sortie_momo", montant, numeroId, nom: SORTIES.mode === "manuel" ? nom : undefined }, preuve);
    if (SORTIES.mode === "manuel") {
      /* comme la base : le nom du compte exigé, mis de côté tout de suite, aucun transfert pour un boîtier */
      const nomPropre = (nom ?? "").trim().replace(/\s+/g, " ");
      const { frais, envoi } = fraisSortieManuelle(montant);
      if (envoi <= 0) throw new ErreurMoteur("montant trop petit");
      this.mouvement(d, "XAFe", -montant, montant);
      const m: Sortie & { cle: string } = {
        reference: this.reference(d, "XAFe-WD-"), operateur: n.operateur, numero: n.numero, montant, frais, montantXaf: envoi,
        montantEnvoye: 0, montantRendu: 0, etat: "en_attente", creeLe: iso(), termineeLe: null, transferts: [], cle,
        mode: "manuel", nomBeneficiaire: nomPropre, prisLe: null, transactionId: null, payeeLe: null, motif: null, prouveeLe: null, paiements: [],
      };
      d.sorties.unshift(m);
      const refus = /refus$/i.test(nomPropre);
      this.planifier(d, { type: "manuelle", reference: m.reference, etape: "prise", quand: maintenant() + 4000 });
      this.planifier(d, { type: "manuelle", reference: m.reference, etape: refus ? "refusee" : "payee", quand: maintenant() + 12000 });
      if (!refus) this.planifier(d, { type: "manuelle", reference: m.reference, etape: "prouvee", quand: maintenant() + 17000 });
      this.emettre();
      return copie(m);
    }
    const dec = decouperSortie(montant, opDe(n.operateur).plafondParTransfert);
    this.mouvement(d, "XAFe", -montant, montant);
    const s: Sortie & { cle: string } = {
      reference: this.reference(d, "XAFe-WD-"), operateur: n.operateur, numero: n.numero, montant, frais: dec.frais, montantXaf: dec.envoi,
      montantEnvoye: 0, montantRendu: 0, etat: "en_attente", creeLe: iso(), termineeLe: null,
      transferts: dec.transferts.map((t) => ({ etat: "en_attente" as const, montant: t.montant, envoi: t.envoi, referenceOperateur: null })), cle,
      mode: "totem", nomBeneficiaire: null, prisLe: null, transactionId: null, payeeLe: null, motif: null, prouveeLe: null, paiements: [],
    };
    d.sorties.unshift(s);
    /* le faux TOTEM : un numéro qui finit par 99 échoue, pour qu'on voie aussi ce chemin-là */
    const echoue = n.numero.endsWith("99");
    s.transferts.forEach((_, i) => {
      this.planifier(d, { type: "transfert", reference: s.reference, index: i, etape: "en_cours", quand: maintenant() + 2000 + i * 5000 });
      this.planifier(d, { type: "transfert", reference: s.reference, index: i, etape: echoue ? "echouee" : "faite", quand: maintenant() + (echoue ? 12000 : 7000) + i * 5000 });
    });
    this.emettre();
    /* Couture d'épreuve (démonstration seulement, jamais le vrai guichet) : la sortie est partie, mais sa
       réponse « se perd en route ». C'est la panne que la clé d'intention doit rendre inoffensive. */
    const epreuve = (globalThis as { __xafeEpreuve?: { perdreLaProchaineReponse?: boolean; sorties?: number } }).__xafeEpreuve;
    if (epreuve) {
      epreuve.sorties = d.sorties.length;
      if (epreuve.perdreLaProchaineReponse) { epreuve.perdreLaProchaineReponse = false; throw new Error("Failed to fetch"); }
    }
    return copie(s);
  }

  async sortie(reference: string) {
    const s = this.dossier().sorties.find((x) => x.reference === reference);
    if (!s) throw new ErreurMoteur("sortie inconnue");
    return copie(s);
  }

  /* ========================================================= marché */

  private mesNiveaux(cote: Cote): Niveau[] {
    const d = this.etat.session ? this.etat.dossiers[this.etat.session.email] : undefined;
    if (!d) return [];
    const parPrix = new Map<number, number>();
    for (const o of d.ordres) if (["ouvert", "partiel"].includes(o.etat) && o.cote === cote && o.prix !== null) parPrix.set(o.prix, arrondi2((parPrix.get(o.prix) ?? 0) + o.restant));
    return [...parPrix].map(([prix, quantite]) => ({ prix, quantite }));
  }

  private fusionner(a: Niveau[], b: Niveau[], sens: "asc" | "desc", profondeur: number): Niveau[] {
    const m = new Map<number, number>();
    for (const n of [...a, ...b]) m.set(n.prix, arrondi2((m.get(n.prix) ?? 0) + n.quantite));
    return [...m].map(([prix, quantite]) => ({ prix, quantite })).sort((x, y) => (sens === "asc" ? x.prix - y.prix : y.prix - x.prix)).slice(0, profondeur);
  }

  async cotation(): Promise<Cotation> {
    const m = this.etat.marche;
    const livre = livreSynthetique(m.mid, 1);
    const ilYa24h = m.chandelles[Math.max(0, m.chandelles.length - 25)]?.o ?? m.mid;
    const dernieres = m.chandelles.slice(-24);
    return {
      dernier: m.mid, variation24h: arrondi2(((m.mid - ilYa24h) / ilYa24h) * 100),
      haut24h: Math.max(...dernieres.map((c) => c.h)), bas24h: Math.min(...dernieres.map((c) => c.l)),
      volume24hUsdt: dernieres.reduce((s, c) => s + c.v, 0),
      meilleurAchat: livre.achats[0]?.prix ?? null, meilleureVente: livre.ventes[0]?.prix ?? null, reference: m.mid, releveLe: iso(),
    };
  }

  async carnet(profondeur: number): Promise<Carnet> {
    const livre = livreSynthetique(this.etat.marche.mid, profondeur);
    return {
      achats: this.fusionner(livre.achats, this.mesNiveaux("achat"), "desc", profondeur),
      ventes: this.fusionner(livre.ventes, this.mesNiveaux("vente"), "asc", profondeur),
    };
  }

  async transactions(n: number) { return this.etat.marche.transactions.slice(0, n); }

  /*
   * Les bougies de la démonstration : le même dessin que le moteur (0025) —
   * le cours de référence jour par jour avant l'ouverture du marché (il y a
   * trente jours ici), les échanges ensuite —, fabriqué par une formule
   * reproductible : la même bougie ne change pas d'une lecture à l'autre.
   */
  async bougies(intervalle: Intervalle, avant?: string | null, nb = 300): Promise<PageDeBougies> {
    const MIN = 60_000, JOUR = 86_400_000;
    const maint = maintenant();
    const debut = Math.floor((maint - 30 * JOUR) / JOUR) * JOUR;
    const mid = this.etat.marche.mid;
    // le marché : une marche lente, des vagues, un peu de bruit — recalée pour finir au dernier prix
    const brut = (minute: number) => 4 * Math.sin(minute / 2900) + 1.6 * Math.sin(minute / 310) + 0.7 * Math.sin(minute / 41) + (alea(minute) - 0.5) * 0.5;
    const prixA = (ms: number) => mid + brut(Math.floor(ms / MIN)) - brut(Math.floor(maint / MIN));
    // le cours de référence : 655,957 / EUR/USD, un EUR/USD qui ondule comme le vrai
    const reference = (jour: number) => 655.957 / (1.12 + 0.07 * Math.sin(jour / 260) + 0.025 * Math.sin(jour / 47) + (alea(jour) - 0.5) * 0.006);
    const duree: Record<Intervalle, number> = { "1m": MIN, "5m": 5 * MIN, "15m": 15 * MIN, "30m": 30 * MIN, "1h": 60 * MIN, "4h": 240 * MIN, "1j": JOUR, "1s": 7 * JOUR, "1M": 30 * JOUR };
    const d = duree[intervalle];
    const fin = avant ? new Date(avant).getTime() : maint + 1;
    const debutDe = (ms: number) => intervalle === "1M"
      ? Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), 1)
      : intervalle === "1s" ? Math.floor((ms - 4 * JOUR) / d) * d + 4 * JOUR : Math.floor(ms / d) * d;
    const premierJour = Date.UTC(2016, 0, 1);
    const sortie: Bougie[] = [];
    let t = debutDe(fin - 1);
    if (t >= fin) t = debutDe(t - 1);
    while (sortie.length < nb) {
      const suivant = intervalle === "1M" ? Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1) : t + d;
      if (suivant <= debut && (d < JOUR)) break;
      if (suivant <= premierJour) break;
      const points: number[] = [];
      let source: Bougie["source"] = "marche";
      if (t >= debut) {
        const pas = Math.max(MIN, Math.floor(d / 60));
        for (let x = t; x < Math.min(suivant, maint); x += pas) points.push(prixA(x));
      } else {
        source = "reference";
        for (let x = Math.max(t, premierJour); x < Math.min(suivant, debut); x += JOUR) {
          const j = Math.floor(x / JOUR), jour = new Date(x).getUTCDay();
          if (jour !== 0 && jour !== 6) points.push(reference(j));
        }
      }
      if (points.length) {
        const o = source === "reference" ? reference(Math.floor(t / JOUR) - 1) : points[0];
        sortie.push({ t: iso(t), o: arrondi2(o), h: arrondi2(Math.max(o, ...points)), l: arrondi2(Math.min(o, ...points)), c: arrondi2(points[points.length - 1]),
                      v: source === "reference" ? 0 : Math.round(points.length * (300 + alea(t / MIN) * 900)), source });
      }
      const precedent = intervalle === "1M" ? Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() - 1, 1) : t - d;
      if (precedent < premierJour - d) break;
      t = precedent;
    }
    sortie.reverse();
    const plusAncien = sortie.length > 0 && new Date(sortie[0].t).getTime() > (d < JOUR ? debut : premierJour) + d;
    return { bougies: sortie, plusAncien, debutMarche: iso(debut) };
  }

  async chandelles(intervalleMinutes: number, n: number): Promise<Chandelle[]> {
    const base = this.etat.marche.chandelles;
    if (intervalleMinutes <= 60) return base.slice(-n);
    const groupe = Math.max(1, Math.round(intervalleMinutes / 60));
    const sortie: Chandelle[] = [];
    for (let i = 0; i < base.length; i += groupe) {
      const bloc = base.slice(i, i + groupe);
      sortie.push({ t: bloc[0].t, o: bloc[0].o, c: bloc[bloc.length - 1].c, h: Math.max(...bloc.map((c) => c.h)), l: Math.min(...bloc.map((c) => c.l)), v: bloc.reduce((s, c) => s + c.v, 0) });
    }
    return sortie.slice(-n);
  }

  async mesOrdres() {
    return copie([...this.dossier().ordres].sort((a, b) => b.creeLe.localeCompare(a.creeLe)));
  }

  async ordre(id: string) {
    const d = this.dossier();
    const o = d.ordres.find((x) => x.id === id);
    if (!o) throw new ErreurMoteur("ordre inconnu");
    return copie({ ordre: o, executions: d.executions.filter((e) => e.ordreId === id) });
  }

  async placerOrdre({ cote, type, quantite, prix, cle }: { cote: Cote; type: TypeOrdre; quantite: number; prix?: number; cle: string }): Promise<ResultatOrdre> {
    const d = this.dossier();
    const deja = d.ordres.find((x) => (x as unknown as { cle?: string }).cle === cle);
    if (deja) return copie({ ordre: deja, executions: d.executions.filter((e) => e.ordreId === deja.id), autoNegociation: false, deja: true });
    if (!quantiteValide(quantite)) throw new ErreurMoteur("quantité invalide", `au moins ${MARCHE.quantiteMin} USDT, deux décimales`);
    if (type === "limite" && (prix === undefined || !prixValide(prix))) throw new ErreurMoteur("prix invalide", `un multiple de ${MARCHE.pasPrix}`);
    /* les règles du marché (0017), avec les mêmes phrases que le moteur */
    if (quantite > MARCHE.quantiteMax) throw new ErreurMoteur("quantité trop grande", `au plus ${MARCHE.quantiteMax} USDT par ordre`);
    if (type === "marche" && quantite > MARCHE.marcheQuantiteMax) throw new ErreurMoteur("ordre au marché trop grand", `au plus ${MARCHE.marcheQuantiteMax} USDT au marché`);
    const bande = type === "limite" ? bandeDePrix(cote, this.etat.marche.mid) : null;
    if (bande && (prix! < bande.min || prix! > bande.max)) throw new ErreurMoteur("prix hors de la bande", `entre ${bande.min} et ${bande.max} XAFe`);
    if (type === "limite" && d.ordres.filter((x) => x.etat === "ouvert" || x.etat === "partiel").length >= MARCHE.ordresOuvertsMax) {
      throw new ErreurMoteur("trop d'ordres ouverts", `au plus ${MARCHE.ordresOuvertsMax}`);
    }
    const px = type === "limite" ? prix! : null;

    const o: Ordre & { cle: string } = {
      id: uuid(), numero: this.reference(d, "ORD-"), cote, type, prix: px, quantite, restant: quantite, executee: 0, totalXafe: 0, bloque: 0, prixMoyen: null,
      etat: "ouvert", creeLe: iso(), majLe: iso(), cle,
    };
    /* tout ce qui est au carnet est déjà déposé */
    if (type === "limite") {
      if (cote === "achat") { o.bloque = arrondi2(px! * quantite); this.mouvement(d, "XAFe", -o.bloque, o.bloque); }
      else { o.bloque = quantite; this.mouvement(d, "USDT", -quantite, quantite); }
    } else if (cote === "vente") {
      o.bloque = quantite; this.mouvement(d, "USDT", -quantite, quantite);
    } else if (d.soldes.XAFe.disponible <= 0) {
      throw new ErreurMoteur("solde insuffisant");
    }
    d.ordres.unshift(o);

    /* l'appariement : le meilleur prix d'abord ; mes propres ordres en face arrêtent l'entrant */
    const livre = livreSynthetique(this.etat.marche.mid, 30);
    const enFace = cote === "achat" ? livre.ventes : livre.achats;
    const miens = this.mesNiveaux(cote === "achat" ? "vente" : "achat");
    let auto = false;
    const avantIndex = d.executions.length;
    for (const niveau of enFace) {
      if (o.restant <= 0) break;
      if (px !== null && (cote === "achat" ? niveau.prix > px : niveau.prix < px)) break;
      const mienIci = miens.find((m) => (cote === "achat" ? m.prix <= niveau.prix : m.prix >= niveau.prix) && (px === null || (cote === "achat" ? m.prix <= px : m.prix >= px)));
      if (mienIci && (cote === "achat" ? mienIci.prix <= niveau.prix : mienIci.prix >= niveau.prix)) { auto = true; break; }
      let q = Math.min(o.restant, niveau.quantite);
      if (cote === "achat" && type === "marche") q = Math.min(q, achatMax(d.soldes.XAFe.disponible, niveau.prix));
      if (q <= 0) break;
      this.executer(d, o, niveau.prix, q, true);
    }
    /* un ordre au marché ne reste pas ; un entrant arrêté par l'auto-négociation non plus */
    if (o.restant > 0 && (type === "marche" || auto)) {
      if (o.bloque > 0) { this.mouvement(d, cote === "achat" ? "XAFe" : "USDT", o.bloque, -o.bloque); o.bloque = 0; }
      o.etat = o.executee > 0 ? "execute" : "annule";
      o.restant = 0;
      o.majLe = iso();
    }
    this.emettre();
    return copie({ ordre: o, executions: d.executions.slice(0, d.executions.length - avantIndex), autoNegociation: auto });
  }

  /** L'achat rapide de la démonstration : le même devis que le moteur, sur le carnet synthétique. */
  async devisRapide({ sens, montant, ferme }: { sens: SensRapide; montant: number; ferme: boolean }) {
    const d = this.dossier();
    if (!RAPIDE.ouvert) throw new ErreurMoteur("achat rapide fermé");
    if (!(montant > 0) || Math.round(montant * 100) !== Math.round(montant * 100 * 1e6) / 1e6) throw new ErreurMoteur("montant invalide");
    if (sens === "vente" && montant < MARCHE.quantiteMin) throw new ErreurMoteur("quantité invalide", `au moins ${MARCHE.quantiteMin} USDT`);
    const livre = livreSynthetique(this.etat.marche.mid, 30);
    const r = devisSurLeCarnet(sens, montant, sens === "achat" ? livre.ventes : livre.achats);
    if (!r) throw new ErreurMoteur(sens === "achat" ? "pas assez de vendeurs au carnet" : "pas assez d'acheteurs au carnet");
    const v: DevisRapide = {
      id: ferme ? uuid() : null, sens, quantite: r.quantite, total: r.total, prix: r.prix, frais: r.frais, marge: RAPIDE.marge,
      etat: ferme ? "propose" : "estimation", expireLe: ferme ? iso(maintenant() + RAPIDE.validiteSecondes * 1000) : null, ordre: null,
    };
    if (ferme) { (d.devis ??= []).unshift({ ...v, cout: r.cout }); this.sauver(); }
    return copie(v);
  }

  async executerDevis(id: string) {
    const d = this.dossier();
    const v = (d.devis ?? []).find((x) => x.id === id);
    if (!v) throw new ErreurMoteur("devis inconnu");
    const { cout: _c, ...rendu } = v;
    if (v.etat === "execute") return copie(rendu);
    if (new Date(v.expireLe!).getTime() < maintenant()) throw new ErreurMoteur("devis expiré", "demandez un nouveau prix");
    const livre = livreSynthetique(this.etat.marche.mid, 30);
    const cout = coutAuCarnet(v.sens === "achat" ? livre.ventes : livre.achats, v.quantite);
    if (cout === null || (v.sens === "achat" ? cout > v.cout : cout < v.cout)) throw new ErreurMoteur("le prix a changé", "le carnet a bougé : demandez un nouveau prix");
    if (v.sens === "achat") {
      if (d.soldes.XAFe.disponible < v.total) throw new ErreurMoteur("solde insuffisant");
      this.mouvement(d, "XAFe", -v.total, 0); this.mouvement(d, "USDT", v.quantite, 0);
    } else {
      if (d.soldes.USDT.disponible < v.quantite) throw new ErreurMoteur("solde insuffisant");
      this.mouvement(d, "USDT", -v.quantite, 0); this.mouvement(d, "XAFe", v.total, 0);
    }
    const o: Ordre = {
      id: uuid(), numero: this.reference(d, "ORD-"), cote: v.sens, type: "marche", prix: null, quantite: v.quantite, restant: 0, executee: v.quantite,
      totalXafe: v.cout, bloque: 0, prixMoyen: arrondi2(v.cout / v.quantite), etat: "execute", creeLe: iso(), majLe: iso(),
      rapide: { total: v.total, frais: v.frais },
    };
    d.ordres.unshift(o);
    v.etat = "execute"; v.ordre = o.numero;
    this.emettre();
    const { cout: _c2, ...fini } = v;
    return copie(fini);
  }

  async annulerOrdre(id: string) {
    const d = this.dossier();
    const o = d.ordres.find((x) => x.id === id);
    if (!o) throw new ErreurMoteur("ordre inconnu");
    if (!["ouvert", "partiel"].includes(o.etat)) throw new ErreurMoteur("cet ordre ne peut plus être annulé", o.etat);
    if (o.bloque > 0) this.mouvement(d, o.cote === "achat" ? "XAFe" : "USDT", o.bloque, -o.bloque);
    o.bloque = 0; o.restant = 0; o.etat = "annule"; o.majLe = iso();
    this.emettre();
    return copie(o);
  }

  /* ========================================================= crypto */

  async adresseDepot(actif: Actif, reseau: Reseau) {
    const d = this.dossier();
    const graine = `${d.compte.id}-${actif}-${reseau}`;
    let h = 0;
    for (const c of graine) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const hex = (n: number) => Array.from({ length: n }, (_, i) => ((h >> ((i * 5) % 28)) & 15).toString(16)).join("");
    if (!RESEAUX_OUVERTS.includes(reseau)) return null;   // comme le moteur : un réseau fermé ne montre pas d'adresse
    return infoReseau(reseau).famille === "tron" ? `T${hex(16).toUpperCase()}${hex(17)}` : `0x${hex(20)}${hex(20)}`;
  }

  async demanderRetraitCrypto({ actif, reseau, adresse, montant, cle, preuve }: { actif: Actif; reseau: Reseau; adresse: string; montant: number; cle: string; preuve: PreuveDeVerification }) {
    const d = this.dossier();
    const deja = d.retraits.find((x) => (x as unknown as { cle?: string }).cle === cle);
    if (deja) { this.cloreRejouee("retrait_crypto", preuve.verification); return copie(deja); }
    this.controlerRetraitCrypto(d, actif, reseau, adresse, montant);
    this.consommer({ operation: "retrait_crypto", actif, reseau, adresse, montant }, preuve);
    adresse = adresse.trim();
    const frais = FRAIS_CRYPTO[actif];
    this.mouvement(d, actif, -(montant + frais), montant + frais);
    const r: RetraitCrypto & { cle: string } = { reference: this.reference(d, "XAFe-CR-"), actif, reseau, adresse, montant, frais, etat: "en_attente", txHash: null, creeLe: iso(), cle };
    d.retraits.unshift(r);
    this.planifier(d, { type: "retrait", reference: r.reference, quand: maintenant() + 9000 });
    this.emettre();
    return copie(r);
  }

  async retraitCrypto(reference: string) {
    const r = this.dossier().retraits.find((x) => x.reference === reference);
    if (!r) throw new ErreurMoteur("retrait inconnu");
    return copie(r);
  }

  /* ===================================================== historique */

  async historique(): Promise<Operation[]> {
    const d = this.dossier();
    const ops: Operation[] = [
      ...d.depots.filter((x) => x.etat !== "annule" && x.etat !== "expire").map((x): Operation => ({ nature: "depot", reference: x.reference, quand: x.crediteLe ?? x.creeLe, etat: x.etat, montant: x.montantRecu, detail: avecChaine(x) })),
      ...d.sorties.map((x): Operation => ({ nature: "sortie", reference: x.reference, quand: x.creeLe, etat: x.etat, montant: -x.montant, detail: x })),
      ...d.ordres.filter((x) => x.executee > 0 || x.etat !== "annule").map((x): Operation => ({ nature: "ordre", reference: x.id, quand: x.creeLe, etat: x.etat, montant: (x.cote === "achat" ? -1 : 1) * (x.rapide?.total ?? x.totalXafe), detail: x })),
      ...d.retraits.map((x): Operation => ({ nature: "crypto", reference: x.reference, quand: x.creeLe, etat: x.etat === "envoye" ? "confirme" : x.etat === "echoue" ? "echoue" : "en_attente", montant: -x.montant, actif: x.actif, detail: x })),
      ...d.transferts.filter((x) => x.sens === "entree").map((x): Operation => ({ nature: "crypto", reference: x.id, quand: x.quand, etat: "confirme", montant: x.montant, actif: x.actif, detail: x })),
    ];
    const poids = (o: Operation) => (["en_attente", "partiel", "en_cours", "ouvert"].includes(o.etat) ? 1 : 0);
    return copie(ops.sort((a, b) => poids(b) - poids(a) || b.quand.localeCompare(a.quand)));
  }

  async operation(reference: string) {
    return (await this.historique()).find((o) => o.reference === reference) ?? null;
  }

  surChangement(cb: () => void) {
    this.auditeurs.add(cb);
    return () => { this.auditeurs.delete(cb); };
  }
}
