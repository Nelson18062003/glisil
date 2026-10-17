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
import { numeroSaisi, operateurDuNumero, transactionIdNormalise, xaf as xafDe } from "../noyau/format";
import { VERSION_CONDITIONS } from "../noyau/conditions";
import type { Guichet } from "./guichet";
import type {
  Actif, Carnet, Chandelle, Compte, Cote, Cotation, Declaration, Depot, DevisRapide, Execution, IdOperateur, Niveau, Notification, Numero, Operation, Ordre, ProfilInscription, SensRapide,
  Reseau, ResultatCode, ResultatOrdre, RetraitCrypto, Soldes, Sortie, Transaction, TransfertCrypto, TypeOrdre,
  LignePreuve, PreuveDeReserve,
} from "./types";

const CLE_STOCKAGE = "xafe.demo.v5";
/** le code de démonstration : celui qui arrive « par SMS » pour un numéro, et « par e-mail » pour se connecter */
export const CODE_SMS_DEMO = "123456";
export const CODE_DEMO = CODE_SMS_DEMO;
const NUMERO_VITRINE = "677123456";
/** l'adresse de la vitrine : elle arrive avec une vie déjà écrite */
export const EMAIL_VITRINE = "demo@glisil.com";

type Tache =
  | { quand: number; type: "sms"; reference: string; declarationId: string }
  | { quand: number; type: "transfert"; reference: string; index: number; etape: "en_cours" | "faite" | "echouee" }
  | { quand: number; type: "manuelle"; reference: string; etape: "prise" | "payee" | "refusee" }
  | { quand: number; type: "retrait"; reference: string }
  | { quand: number; type: "expiration"; reference: string };

type CompteDemo = Omit<Compte, "entreDuJour" | "conditionsAJour"> & { codeSecret: string | null; echecs: number; conditionsVersion: string | null };

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
  session: { email: string } | null;
  codeAttendu: string | null;
  dossiers: Record<string, Dossier>;
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
      id, telephone: p.telephone, nom: `${p.prenom} ${p.nom}`, entreprise: null, palier: 0, aCode: false, verrouJusqua: null, verificationEnCours: null, codeSecret: null, echecs: 0,
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
  d.compte = { ...d.compte, entreprise: "NORTON GAUSS BONZINI SARL", palier: 2, aCode: true, codeSecret: "1234" };
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
    if (brut) return JSON.parse(brut) as Etat;
  } catch { /* un stockage absent ou corrompu repart de zéro */ }
  return { session: null, codeAttendu: null, dossiers: {}, marche: marcheInitial() };
}

/* ======================================================================= */

export class GuichetDemo implements Guichet {
  readonly mode = "demo" as const;
  private etat: Etat;
  private auditeurs = new Set<() => void>();
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

  private dossier(): Dossier {
    const email = this.etat.session?.email;
    const d = email ? this.etat.dossiers[email] : undefined;
    if (!d) throw new ErreurMoteur(email ? "compte pas encore ouvert" : "non connecté");
    return d;
  }

  private compteParId(): Compte {
    const d = this.dossier();
    const { codeSecret: _c, echecs: _e, conditionsVersion, ...compte } = d.compte;
    return { ...compte, entreDuJour: entreDuJour(d), conditionsAJour: conditionsVersion === VERSION_CONDITIONS, fermeLe: compte.fermeLe ?? null, desactive: Boolean(compte.desactive) };
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

  private exigerCode(d: Dossier, code: string) {
    const r = this.controlerCode(d, code);
    if (!r.ok) throw new ErreurMoteur(r.verrouJusqua ? "compte verrouillé" : "code secret incorrect");
  }

  private controlerCode(d: Dossier, code: string): ResultatCode {
    const c = d.compte;
    if (c.verrouJusqua && new Date(c.verrouJusqua).getTime() > maintenant()) return { ok: false, essaisRestants: 0, verrouJusqua: c.verrouJusqua };
    if (c.verrouJusqua) { c.verrouJusqua = null; c.echecs = 0; }
    if (!c.codeSecret || code !== c.codeSecret) {
      c.echecs += 1;
      if (c.echecs >= 3) { c.verrouJusqua = iso(maintenant() + 15 * 60_000); c.echecs = 0; this.emettre(); return { ok: false, essaisRestants: 0, verrouJusqua: c.verrouJusqua }; }
      this.emettre();
      return { ok: false, essaisRestants: 3 - c.echecs, verrouJusqua: null };
    }
    c.echecs = 0;
    return { ok: true };
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

  /* la fausse équipe : elle prend la demande, puis paie — ou refuse, pour un nom qui finit par « refus », qu'on voie aussi ce chemin-là */
  private manuelleAvance(d: Dossier, reference: string, etape: "prise" | "payee" | "refusee") {
    const s = d.sorties.find((x) => x.reference === reference);
    if (!s || !["en_attente", "en_cours"].includes(s.etat)) return;
    if (etape === "prise") { s.etat = "en_cours"; s.prisLe = iso(); return; }
    if (etape === "payee") {
      s.transactionId = `MP${new Date().toISOString().slice(2, 10).replace(/-/g, "")}.${String(Math.floor(1000 + Math.random() * 8999))}.A${String(Math.floor(10000 + Math.random() * 89999))}`;
      s.payeeLe = iso();
      this.mouvement(d, "XAFe", 0, -s.montant);
      s.montantEnvoye = s.montantXaf;
      s.etat = "envoyee";
      s.termineeLe = iso();
      this.notifier(d, "Sortie envoyée", `${s.montantXaf.toLocaleString("fr-FR")} XAF envoyés au ${s.numero}. Transaction ID : ${s.transactionId}.`, `/historique/${reference}`);
      return;
    }
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

  async demanderCode(email: string) {
    if (!emailValide(email)) throw new ErreurMoteur("adresse e-mail invalide");
    this.etat.codeAttendu = CODE_DEMO;
    this.sauver();
  }

  async verifierCode(email: string, code: string) {
    const e = emailNormalise(email);
    if (code !== this.etat.codeAttendu) throw new ErreurMoteur("code incorrect ou expiré", "demandez-en un nouveau si besoin");
    if (e === EMAIL_VITRINE && !this.etat.dossiers[e]) this.etat.dossiers[e] = dossierVitrine();
    this.etat.session = { email: e };
    this.etat.codeAttendu = null;
    this.emettre();
    return { nouveau: !this.etat.dossiers[e] };
  }

  async seDeconnecter() {
    this.etat.session = null;
    this.emettre();
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
    this.emettre();
    return copie(this.compteParId());
  }

  async completerProfil({ nom, codeSecret }: { nom: string; codeSecret: string }) {
    const d = this.dossier();
    if (!nom.trim()) throw new ErreurMoteur("nom manquant");
    if (!/^\d{4,6}$/.test(codeSecret)) throw new ErreurMoteur("code secret invalide");
    d.compte.nom = nom.trim();
    d.compte.codeSecret = codeSecret;
    d.compte.aCode = true;
    this.emettre();
    return copie(this.compteParId());
  }

  async verifierCodeSecret(code: string) {
    const d = this.dossier();
    return this.controlerCode(d, code);
  }

  async accepterConditions(version: string) {
    const d = this.dossier();
    if (version !== VERSION_CONDITIONS) throw new ErreurMoteur("conditions non acceptées", "ce ne sont pas les conditions en vigueur");
    d.compte.conditionsVersion = version;
    this.emettre();
    return copie(this.compteParId());
  }

  /** Comme la base : jamais avec de l'argent dessus ni une opération en cours ; le code d'abord compté. */
  async fermerCompte({ codeSecret, motif }: { codeSecret: string; motif: string }) {
    const d = this.dossier();
    if (d.compte.fermeLe) throw new ErreurMoteur("compte déjà fermé");
    const reste = (["XAFe", "USDT"] as const).filter((a) => d.soldes[a].disponible + d.soldes[a].bloque > 0)
      .map((a) => `${a === "XAFe" ? xafDe(d.soldes[a].disponible + d.soldes[a].bloque) : (d.soldes[a].disponible + d.soldes[a].bloque).toFixed(2)} ${a}`);
    if (reste.length) throw new ErreurMoteur("il reste de l'argent sur le compte", `sortez d'abord : ${reste.join(", ")}`);
    if (d.ordres.some((o) => o.etat === "ouvert" || o.etat === "partiel") || d.depots.some((x) => x.etat === "en_attente")
        || d.sorties.some((s) => s.etat === "en_attente" || s.etat === "en_cours") || d.retraits.some((r) => r.etat === "en_attente")) {
      throw new ErreurMoteur("une opération est en cours", "attendez qu'elle se termine, ou annulez-la");
    }
    this.exigerCode(d, codeSecret);
    d.compte.fermeLe = iso();
    d.compte.desactive = true;
    void motif;
    this.emettre();
    return copie(this.compteParId());
  }

  async changerCodeSecret({ ancien, nouveau }: { ancien: string; nouveau: string }) {
    const d = this.dossier();
    this.exigerCode(d, ancien);
    if (!/^\d{4,6}$/.test(nouveau)) throw new ErreurMoteur("code secret invalide");
    d.compte.codeSecret = nouveau;
    this.emettre();
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
        chaine: registre - enRoute, offre_lue: registre - enRoute, en_route: enRoute, ecart: 0, floats: 13_120_000, couverture: 13_120_000 - registre, anomalies: 0,
        reseaux: [{ reseau: "bep20", offre: registre - enRoute, reserve: registre - enRoute - 750_000, bloc: 137_263_410, a_jour: true, lu_le: iso(t - 30_000) },
                  { reseau: "trc20", offre: 0, reserve: 0, bloc: 71_897_120, a_jour: true, lu_le: iso(t - 45_000) }],
        floats_detail: [{ operateur: "mtn", solde: 8_420_000, annonce_le: iso(t - 6 * 60_000), connu: true }, { operateur: "om", solde: 4_700_000, annonce_le: iso(t - 41 * 60_000), connu: true }],
      },
      historique: Array.from({ length: 48 }, (_, i) => ({ fait_le: iso(t - (48 - i) * 3600_000), statut: "juste" as const, registre: registre - (48 - i) * 60_000, chaine: registre - (48 - i) * 60_000, ecart: 0, floats: 13_120_000 - (48 - i) * 50_000 })),
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

  async retirerNumero({ id, codeSecret }: { id: string; codeSecret: string }) {
    const d = this.dossier();
    this.exigerCode(d, codeSecret);
    const n = d.numeros.find((x) => x.id === id);
    if (!n) throw new ErreurMoteur("numéro inconnu sur ce compte");
    if (d.numeros.filter((x) => !x.retireLe).length <= 1) throw new ErreurMoteur("le dernier numéro ne se retire pas");
    n.retireLe = iso();
    this.emettre();
  }

  async demanderSortie({ montant, numeroId, cle, codeSecret, nom }: { montant: number; numeroId: string; cle: string; codeSecret: string; nom?: string }) {
    const d = this.dossier();
    const deja = d.sorties.find((x) => (x as unknown as { cle?: string }).cle === cle);
    if (deja) return copie(deja);
    if (!montantValide(montant, 100)) throw new ErreurMoteur("montant invalide");
    const n = d.numeros.find((x) => x.id === numeroId && !x.retireLe);
    if (!n) throw new ErreurMoteur("numéro inconnu sur ce compte");
    if (!n.verifieLe || new Date(n.actifDes).getTime() > maintenant()) throw new ErreurMoteur("numéro pas encore actif");
    const p = PALIERS[d.compte.palier];
    if (p.sortieJour !== null) {
      const debut = new Date().setHours(0, 0, 0, 0);
      const jour = d.sorties.filter((x) => new Date(x.creeLe).getTime() >= debut && !["annulee", "echouee"].includes(x.etat)).reduce((s, x) => s + x.montant, 0);
      if (jour + montant > p.sortieJour) throw new ErreurMoteur("plafond du palier atteint", `${p.sortieJour} XAF par jour`);
    }
    this.exigerCode(d, codeSecret);
    if (SORTIES.mode === "manuel") {
      /* comme la base : le nom du compte exigé, mis de côté tout de suite, aucun transfert pour un boîtier */
      const nomPropre = (nom ?? "").trim().replace(/\s+/g, " ");
      if (nomPropre.length < 2 || nomPropre.length > 80) throw new ErreurMoteur("nom du bénéficiaire invalide", "le nom exact du compte Mobile Money qui reçoit");
      const { frais, envoi } = fraisSortieManuelle(montant);
      if (envoi <= 0) throw new ErreurMoteur("montant trop petit");
      this.mouvement(d, "XAFe", -montant, montant);
      const m: Sortie & { cle: string } = {
        reference: this.reference(d, "XAFe-WD-"), operateur: n.operateur, numero: n.numero, montant, frais, montantXaf: envoi,
        montantEnvoye: 0, montantRendu: 0, etat: "en_attente", creeLe: iso(), termineeLe: null, transferts: [], cle,
        mode: "manuel", nomBeneficiaire: nomPropre, prisLe: null, transactionId: null, payeeLe: null, motif: null,
      };
      d.sorties.unshift(m);
      const refus = /refus$/i.test(nomPropre);
      this.planifier(d, { type: "manuelle", reference: m.reference, etape: "prise", quand: maintenant() + 4000 });
      this.planifier(d, { type: "manuelle", reference: m.reference, etape: refus ? "refusee" : "payee", quand: maintenant() + 12000 });
      this.emettre();
      return copie(m);
    }
    const dec = decouperSortie(montant, opDe(n.operateur).plafondParTransfert);
    this.mouvement(d, "XAFe", -montant, montant);
    const s: Sortie & { cle: string } = {
      reference: this.reference(d, "XAFe-WD-"), operateur: n.operateur, numero: n.numero, montant, frais: dec.frais, montantXaf: dec.envoi,
      montantEnvoye: 0, montantRendu: 0, etat: "en_attente", creeLe: iso(), termineeLe: null,
      transferts: dec.transferts.map((t) => ({ etat: "en_attente" as const, montant: t.montant, envoi: t.envoi, referenceOperateur: null })), cle,
      mode: "totem", nomBeneficiaire: null, prisLe: null, transactionId: null, payeeLe: null, motif: null,
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

  async demanderRetraitCrypto({ actif, reseau, adresse, montant, cle, codeSecret }: { actif: Actif; reseau: Reseau; adresse: string; montant: number; cle: string; codeSecret: string }) {
    const d = this.dossier();
    const deja = d.retraits.find((x) => (x as unknown as { cle?: string }).cle === cle);
    if (deja) return copie(deja);
    if (!(montant > 0)) throw new ErreurMoteur("montant invalide");
    if (!RESEAUX_OUVERTS.includes(reseau)) throw new ErreurMoteur(RESEAUX[reseau] ? "réseau pas encore ouvert" : "réseau inconnu");
    if (!adresseValide(infoReseau(reseau).famille, adresse)) throw new ErreurMoteur("adresse invalide");
    this.exigerCode(d, codeSecret);
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
