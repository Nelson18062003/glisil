/*
 * LE GUICHET DE DÉMONSTRATION : un moteur en mémoire qui suit les règles du
 * vrai (supabase/migrations/0001_socle.sql) — fonds bloqués avant d'inscrire
 * un ordre, frais dans l'actif reçu, découpage des sorties au plafond de
 * l'opérateur, appariement prix-temps, pas d'auto-négociation — avec un faux
 * TOTEM qui lit le SMS quelques secondes après « J'ai payé », et un carnet qui
 * vit. Il tourne quand l'application n'a pas de projet Supabase configuré.
 * Il n'a aucune valeur comptable : c'est une maquette qui répond.
 */
import { achatMax, arrondi2, decouperSortie, FRAIS, MARCHE, montantValide, operateur as opDe, PALIERS, prixValide, quantiteValide } from "../noyau/argent";
import { ErreurMoteur } from "../noyau/erreurs";
import { numeroSaisi, operateurDuNumero, transactionIdNormalise } from "../noyau/format";
import type { Guichet } from "./guichet";
import type {
  Actif, Carnet, Chandelle, Compte, Cote, Cotation, Declaration, Depot, Execution, IdOperateur, Niveau, Notification, Numero, Operation, Ordre,
  Reseau, ResultatCode, ResultatOrdre, RetraitCrypto, Soldes, Sortie, Transaction, TransfertCrypto, TypeOrdre,
} from "./types";

const CLE_STOCKAGE = "xafe.demo.v3";
export const CODE_SMS_DEMO = "123456";
const NUMERO_VITRINE = "677123456";

type Tache =
  | { quand: number; type: "sms"; reference: string; declarationId: string }
  | { quand: number; type: "transfert"; reference: string; index: number; etape: "en_cours" | "faite" | "echouee" }
  | { quand: number; type: "retrait"; reference: string }
  | { quand: number; type: "expiration"; reference: string };

type CompteDemo = Compte & { codeSecret: string | null; echecs: number };

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
};

type Marche = { mid: number; transactions: Transaction[]; chandelles: Chandelle[]; alea: number };

type Etat = {
  session: { telephone: string } | null;
  codeAttendu: string | null;
  dossiers: Record<string, Dossier>;
  marche: Marche;
};

/* ------------------------------------------------------------- utilitaires */

const maintenant = () => Date.now();
const iso = (t = maintenant()) => new Date(t).toISOString();
/** Le guichet rend des COPIES : un objet vivant, modifié en place, ferait croire au cache qu'il n'a pas changé. */
const copie = <T,>(x: T): T => structuredClone(x);
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

function dossierVide(telephone: string): Dossier {
  const id = uuid();
  return {
    compte: { id, telephone, nom: null, entreprise: null, palier: 0, aCode: false, verrouJusqua: null, verificationEnCours: null, codeSecret: null, echecs: 0 },
    soldes: { XAFe: { disponible: 0, bloque: 0 }, USDT: { disponible: 0, bloque: 0 } },
    numeros: [{ id: uuid(), operateur: telephone.startsWith("69") || telephone.startsWith("65") ? "om" : "mtn", numero: telephone, verifieLe: iso(), actifDes: iso(), retireLe: null }],
    depots: [], sorties: [], ordres: [], executions: [], retraits: [], transferts: [], notifications: [], taches: [], compteur: 417, numerosEnAttente: {},
  };
}

/** La vitrine : le compte 6 77 12 34 56 arrive avec une vie déjà écrite. */
function dossierVitrine(): Dossier {
  const d = dossierVide(NUMERO_VITRINE);
  const hier = maintenant() - 20 * 3600_000;
  d.compte = { ...d.compte, nom: "Nelson Soh", entreprise: "NORTON GAUSS BONZINI SARL", palier: 2, aCode: true, codeSecret: "1234" };
  d.soldes = { XAFe: { disponible: 3_250_000, bloque: 0 }, USDT: { disponible: 2_608.05, bloque: 0 } };
  d.numeros.push({ id: uuid(), operateur: "om", numero: "699876543", verifieLe: iso(hier - 86400_000), actifDes: iso(hier), retireLe: null });
  d.depots.push({
    reference: "XAFe-DP-000401", operateur: "mtn", floatNumero: "677000000", codeAgent: "480213", montantRecu: 3_000_000,
    etat: "credite", creeLe: iso(hier), expireLe: iso(hier + 1800_000), crediteLe: iso(hier + 240_000),
    declarations: [1, 2, 3].map((i) => ({ id: uuid(), transactionId: `2039481${i}04`, etat: "credite" as const, montant: 1_000_000, numeroPayeur: NUMERO_VITRINE, motif: null, declareLe: iso(hier + i * 80_000 - 20_000), crediteLe: iso(hier + i * 80_000) })),
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
    const tel = this.etat.session?.telephone;
    const d = tel ? this.etat.dossiers[tel] : undefined;
    if (!d) throw new ErreurMoteur("non connecté");
    return d;
  }

  private compteParId(): Compte {
    const { codeSecret: _c, echecs: _e, ...compte } = this.dossier().compte;
    return compte;
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
    const chiffres = decl.transactionId.replace(/\D/g, "");
    const montant = Math.max(5_000, Number(chiffres.slice(-3) || "250") * 1_000);
    const p = PALIERS[d.compte.palier];
    if (p.entreeJour !== null) {
      const debut = new Date().setHours(0, 0, 0, 0);
      const jour = d.depots.flatMap((x) => x.declarations).filter((x) => x.etat === "credite" && x.crediteLe && new Date(x.crediteLe).getTime() >= debut).reduce((s, x) => s + (x.montant ?? 0), 0);
      if (jour + montant > p.entreeJour) {
        decl.etat = "refuse"; decl.montant = montant; decl.motif = "plafond du palier atteint : l'argent est retenu, l'équipe vous rembourse";
        this.notifier(d, "Paiement retenu", `${montant.toLocaleString("fr-FR")} XAF reçus au-delà de votre palier : ils vous seront remboursés.`, `/historique/${reference}`);
        return;
      }
    }
    decl.etat = "credite"; decl.montant = montant; decl.numeroPayeur = d.compte.telephone; decl.crediteLe = iso();
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
    const tel = this.etat.session?.telephone;
    return tel && this.etat.dossiers[tel] ? { compteId: this.etat.dossiers[tel].compte.id } : null;
  }

  async demanderCode(telephone: string) {
    const n = numeroSaisi(telephone);
    if (!/^6\d{8}$/.test(n)) throw new ErreurMoteur("numéro invalide");
    this.etat.codeAttendu = CODE_SMS_DEMO;
    this.sauver();
  }

  async verifierCodeSms(telephone: string, code: string) {
    const n = numeroSaisi(telephone);
    if (code !== this.etat.codeAttendu) throw new ErreurMoteur("code SMS incorrect");
    if (!this.etat.dossiers[n]) this.etat.dossiers[n] = n === NUMERO_VITRINE ? dossierVitrine() : dossierVide(n);
    this.etat.session = { telephone: n };
    this.etat.codeAttendu = null;
    this.emettre();
    return { compteId: this.etat.dossiers[n].compte.id, nouveau: !this.etat.dossiers[n].compte.nom };
  }

  async seDeconnecter() {
    this.etat.session = null;
    this.emettre();
  }

  /* ============================================================= compte */

  async compte() { return copie(this.compteParId()); }

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
      reference: this.reference(d, "XAFe-DP-"), operateur, floatNumero: operateur === "mtn" ? "677000000" : "699000000", codeAgent: operateur === "mtn" ? "480213" : null,
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
    return copie(dep);
  }

  /** Le client tape le transaction ID de son SMS ; le faux TOTEM « trouve » le SMS trois secondes plus tard. */
  async declarerTransaction({ reference, transactionId }: { reference: string; transactionId: string }): Promise<Declaration> {
    const d = this.dossier();
    const dep = d.depots.find((x) => x.reference === reference);
    if (!dep) throw new ErreurMoteur("dépôt inconnu");
    if (dep.etat === "annule") throw new ErreurMoteur("ce dépôt est annulé");
    const id = transactionIdNormalise(transactionId);
    if (id.length < 6) throw new ErreurMoteur("transaction ID invalide", "au moins six caractères, tel qu'il est écrit dans le SMS");
    const partout = d.depots.flatMap((x) => x.declarations).find((x) => x.transactionId === id);
    if (partout) {
      if (dep.declarations.includes(partout)) return copie(partout);
      throw new ErreurMoteur("transaction ID déjà utilisé", "ce paiement a déjà été crédité");
    }
    const decl: Declaration = { id: uuid(), transactionId: id, etat: "attendu", montant: null, numeroPayeur: null, motif: null, declareLe: iso(), crediteLe: null };
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
    if (deja?.verifieLe) throw new ErreurMoteur("ce numéro est déjà sur votre compte");
    if (deja) { d.numerosEnAttente[deja.id] = CODE_SMS_DEMO; return copie(deja); }
    const nouveau: Numero = { id: uuid(), operateur, numero: n, verifieLe: null, actifDes: iso(maintenant() + 24 * 3600_000), retireLe: null };
    d.numeros.push(nouveau);
    d.numerosEnAttente[nouveau.id] = CODE_SMS_DEMO;
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
  async parametres() { return null; }

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

  async demanderSortie({ montant, numeroId, cle, codeSecret }: { montant: number; numeroId: string; cle: string; codeSecret: string }) {
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
    const dec = decouperSortie(montant, opDe(n.operateur).plafondParTransfert);
    this.mouvement(d, "XAFe", -montant, montant);
    const s: Sortie & { cle: string } = {
      reference: this.reference(d, "XAFe-WD-"), operateur: n.operateur, numero: n.numero, montant, frais: dec.frais, montantXaf: dec.envoi,
      montantEnvoye: 0, montantRendu: 0, etat: "en_attente", creeLe: iso(), termineeLe: null,
      transferts: dec.transferts.map((t) => ({ etat: "en_attente" as const, montant: t.montant, envoi: t.envoi, referenceOperateur: null })), cle,
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
    const d = this.etat.session ? this.etat.dossiers[this.etat.session.telephone] : undefined;
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
      meilleurAchat: livre.achats[0]?.prix ?? null, meilleureVente: livre.ventes[0]?.prix ?? null, releveLe: iso(),
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
    return reseau === "bep20" ? `0x${hex(20)}${hex(20)}` : `T${hex(16).toUpperCase()}${hex(17)}`;
  }

  async demanderRetraitCrypto({ actif, reseau, adresse, montant, cle, codeSecret }: { actif: Actif; reseau: Reseau; adresse: string; montant: number; cle: string; codeSecret: string }) {
    const d = this.dossier();
    const deja = d.retraits.find((x) => (x as unknown as { cle?: string }).cle === cle);
    if (deja) return copie(deja);
    if (!(montant > 0)) throw new ErreurMoteur("montant invalide");
    if (!(reseau === "bep20" ? /^0x[0-9a-fA-F]{40}$/.test(adresse) : /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(adresse))) throw new ErreurMoteur("adresse invalide");
    this.exigerCode(d, codeSecret);
    const frais = actif === "USDT" ? 1 : 500;
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
      ...d.depots.filter((x) => x.etat !== "annule" && x.etat !== "expire").map((x): Operation => ({ nature: "depot", reference: x.reference, quand: x.crediteLe ?? x.creeLe, etat: x.etat, montant: x.montantRecu, detail: x })),
      ...d.sorties.map((x): Operation => ({ nature: "sortie", reference: x.reference, quand: x.creeLe, etat: x.etat, montant: -x.montant, detail: x })),
      ...d.ordres.filter((x) => x.executee > 0 || x.etat !== "annule").map((x): Operation => ({ nature: "ordre", reference: x.id, quand: x.creeLe, etat: x.etat, montant: x.cote === "achat" ? -x.totalXafe : x.totalXafe, detail: x })),
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
