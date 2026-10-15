/*
 * L'arithmétique de l'argent, telle que le MOTEUR la fait (supabase/migrations).
 * L'écran ne décide rien : il MONTRE d'avance ce que la base va faire — frais,
 * découpage, achat maximal — et la base reste seule juge au moment d'écrire.
 * Si une règle change ici, elle a changé là-bas d'abord.
 */

/*
 * Les valeurs ci-dessous sont celles de la migration, au jour de l'écriture.
 * L'équipe les change en base (Paramètres) : au démarrage, l'application lit
 * parametres_publics() et appliquerParametres() les remplace ici, en place —
 * sinon l'écran annonçait, au moment de signer, d'autres frais que ceux que
 * le moteur allait prendre.
 */
export const FRAIS: { placeur: number; preneur: number; sortie: number } = {
  /** frais de celui dont l'ordre attendait au carnet */
  placeur: 0.0005,
  /** frais de celui dont l'ordre vient prendre */
  preneur: 0.001,
  /** frais d'une sortie XAFe → XAF, par transfert */
  sortie: 0.005,
};

/** frais d'un retrait vers un wallet externe, par actif (le gaz, à prix fixe) */
export const FRAIS_CRYPTO: Record<"USDT" | "XAFe", number> = { USDT: 1, XAFe: 500 };

/** Les retraits vers la chaîne : fermés par le moteur tant qu'aucun veilleur de chaîne ne les envoie. */
export const CRYPTO = { retraitsOuverts: true };

export const RESEAUX: Record<"bep20" | "trc20", { nom: string; chaine: string; confirmations: number; valide: (a: string) => boolean }> = {
  bep20: { nom: "BEP20", chaine: "BNB Smart Chain", confirmations: 15, valide: (a) => /^0x[0-9a-fA-F]{40}$/.test(a) },
  trc20: { nom: "TRC20", chaine: "Tron", confirmations: 20, valide: (a) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a) },
};

/** L'achat rapide : un prix ferme pris au carnet, plus cette marge (posée par l'équipe). */
export const RAPIDE = { marge: 0.01, ouvert: true, validiteSecondes: 20 };

/**
 * Le devis de l'achat (ou de la vente) rapide, sur un carnet donné — la même
 * arithmétique que devis_rapide() dans le moteur : on parcourt le meilleur prix
 * d'abord ; l'achat dépense un budget en XAFe (marge mise de côté), la vente
 * place une quantité d'USDT. Rend null si le carnet ne suffit pas.
 */
export function devisSurLeCarnet(sens: "achat" | "vente", montant: number, enFace: { prix: number; quantite: number }[], marge = RAPIDE.marge, quantiteMin = MARCHE.quantiteMin):
  { quantite: number; cout: number; total: number; prix: number; frais: number } | null {
  if (!(montant > 0)) return null;
  let quantite = 0;
  let cout = 0;
  if (sens === "achat") {
    const budget = Math.trunc((montant / (1 + marge)) * 100 + 1e-9) / 100;
    for (const n of enFace) {
      const q = Math.min(n.quantite, Math.trunc(((budget - cout) / n.prix) * 100 + 1e-9) / 100);
      if (q <= 0) break;
      quantite = arrondi2(quantite + q);
      cout = arrondi2(cout + arrondi2(q * n.prix));
    }
    if (quantite < quantiteMin) return null;
    const total = Math.ceil(arrondi2(cout * (1 + marge) * 100)) / 100;
    return { quantite, cout, total, prix: arrondi2(total / quantite), frais: arrondi2(total - cout) };
  }
  if (montant < quantiteMin) return null;
  for (const n of enFace) {
    const q = Math.min(n.quantite, arrondi2(montant - quantite));
    if (q <= 0) break;
    quantite = arrondi2(quantite + q);
    cout = arrondi2(cout + arrondi2(q * n.prix));
  }
  if (quantite < montant) return null;
  const total = Math.floor(arrondi2(cout * (1 - marge) * 100)) / 100;
  return { quantite, cout, total, prix: arrondi2(total / quantite), frais: arrondi2(cout - total) };
}

/** Ce que coûte (ou rend) une quantité prise au carnet, meilleur prix d'abord ; null si le carnet ne suffit pas. */
export function coutAuCarnet(enFace: { prix: number; quantite: number }[], quantite: number): number | null {
  let reste = quantite;
  let cout = 0;
  for (const n of enFace) {
    if (reste <= 0) break;
    const q = Math.min(n.quantite, reste);
    cout = arrondi2(cout + arrondi2(q * n.prix));
    reste = arrondi2(reste - q);
  }
  return reste > 0 ? null : cout;
}

export const MARCHE: { paire: string; pasPrix: number; quantiteMin: number } = {
  paire: "USDT/XAFe",
  pasPrix: 0.05,
  quantiteMin: 10,
};

export type Operateur = {
  id: "mtn" | "om";
  nom: string;
  plafondParTransfert: number;
  plafondParJour: number;
};

export const OPERATEURS: Operateur[] = [
  { id: "mtn", nom: "MTN MoMo", plafondParTransfert: 1_000_000, plafondParJour: 100_000_000 },
  { id: "om", nom: "Orange Money", plafondParTransfert: 500_000, plafondParJour: 1_500_000 },
];

export function operateur(id: string): Operateur {
  return OPERATEURS.find((o) => o.id === id) ?? OPERATEURS[0];
}

export const PALIERS: Record<number, { entreeJour: number | null; sortieJour: number | null; nom: string }> = {
  0: { entreeJour: 500_000, sortieJour: 500_000, nom: "Palier 0 · numéro vérifié" },
  1: { entreeJour: 5_000_000, sortieJour: 5_000_000, nom: "Palier 1 · identité vérifiée" },
  2: { entreeJour: null, sortieJour: null, nom: "Palier 2 · entreprise vérifiée" },
};

/** Combien de transferts MoMo il faut pour un montant, au plafond de l'opérateur. */
export function nombreDeTransferts(montant: number, plafondParTransfert: number): number {
  if (montant <= 0) return 0;
  return Math.max(1, Math.ceil(montant / plafondParTransfert));
}

export type Transfert = { montant: number; frais: number; envoi: number };

/**
 * Le découpage d'une sortie, à l'identique de `demander_sortie` :
 * n transferts de parts égales (le reste sur le dernier), frais arrondis au
 * franc SUPÉRIEUR par transfert, ce qui part = la part moins ses frais.
 */
export function decouperSortie(montant: number, plafondParTransfert: number, taux = FRAIS.sortie): {
  transferts: Transfert[];
  frais: number;
  envoi: number;
} {
  const n = nombreDeTransferts(montant, plafondParTransfert);
  if (n === 0) return { transferts: [], frais: 0, envoi: 0 };
  const part = Math.trunc(montant / n);
  const reste = montant - part * n;
  const transferts: Transfert[] = [];
  for (let i = 1; i <= n; i++) {
    const m = part + (i === n ? reste : 0);
    const frais = Math.ceil(m * taux);
    transferts.push({ montant: m, frais, envoi: m - frais });
  }
  return {
    transferts,
    frais: transferts.reduce((s, t) => s + t.frais, 0),
    envoi: transferts.reduce((s, t) => s + t.envoi, 0),
  };
}

/** Un montant XAF/XAFe valide : entier, strictement positif, sûr. */
export function montantValide(n: number, minimum = 1): boolean {
  return Number.isSafeInteger(n) && n >= minimum;
}

/**
 * Le nombre de centimes d'une valeur, si elle en a un nombre entier ; sinon
 * null. Le moteur juge en décimal exact (« q <> round(q, 2) ») ; un flottant
 * n'est jamais exact : 19,99 × 100 vaut 1 998,999 999 999 999 8. Comparer
 * « Math.round(q × 100) === q × 100 » refusait donc 19,99, 1,15, 0,29 —
 * le bouton restait gris sur un ordre que le moteur acceptait. On tolère
 * l'erreur du flottant, jamais un vrai troisième chiffre.
 */
export function centimes(x: number): number | null {
  if (!Number.isFinite(x)) return null;
  const n = Math.round(x * 100);
  return Math.abs(x * 100 - n) < 1e-6 ? n : null;
}

/** Une quantité d'USDT valide pour le carnet : ≥ minimum, deux décimales au plus. */
export function quantiteValide(q: number): boolean {
  return centimes(q) !== null && q >= MARCHE.quantiteMin;
}

/** Un prix valide : positif, deux décimales au plus, multiple du pas. */
export function prixValide(p: number): boolean {
  const n = centimes(p);
  const pas = centimes(MARCHE.pasPrix);
  return n !== null && n > 0 && pas !== null && pas > 0 && n % pas === 0;
}

export function arrondi2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Ce qu'un acheteur peut prendre au plus avec ses XAFe à ce prix (comme le moteur : trunc à 2 déc.). */
export function achatMax(dispoXafe: number, prix: number): number {
  if (prix <= 0) return 0;
  return Math.trunc((dispoXafe / prix) * 100) / 100;
}

/**
 * Les frais d'un ordre, estimés comme preneur (le cas le plus cher) :
 * l'acheteur paie en USDT (ce qu'il reçoit), le vendeur en XAFe.
 */
export function fraisOrdre(cote: "achat" | "vente", quantite: number, prix: number, taux = FRAIS.preneur): { montant: number; actif: "USDT" | "XAFe" } {
  if (cote === "achat") return { montant: arrondi2(quantite * taux), actif: "USDT" };
  return { montant: Math.round(quantite * prix * taux), actif: "XAFe" };
}

/** Le total XAFe d'un ordre limite : prix × quantité, au centime. */
export function totalOrdre(quantite: number, prix: number): number {
  return arrondi2(quantite * prix);
}

/** Ce que le carnet consomme pour un ordre au marché, en marchant dans les niveaux. */
export function simulerMarche(
  cote: "achat" | "vente",
  quantite: number,
  niveaux: { prix: number; quantite: number }[],
  dispoXafe = Infinity,
): { quantite: number; total: number; prixMoyen: number | null; complet: boolean } {
  let reste = quantite;
  let total = 0;
  let pris = 0;
  for (const n of niveaux) {
    if (reste <= 0) break;
    let q = Math.min(reste, n.quantite);
    if (cote === "achat") {
      const maxIci = achatMax(dispoXafe - total, n.prix);
      q = Math.min(q, maxIci);
      if (q <= 0) break;
    }
    pris = arrondi2(pris + q);
    total = arrondi2(total + q * n.prix);
    reste = arrondi2(reste - q);
  }
  return { quantite: pris, total, prixMoyen: pris > 0 ? arrondi2(total / pris) : null, complet: reste <= 0 };
}

/**
 * Pose en place les paramètres lus dans le moteur (parametres_publics). Ne
 * touche qu'aux valeurs lisibles et plausibles : un champ absent ou abîmé
 * laisse la valeur d'avant, plutôt qu'un NaN à l'écran. Rend vrai si la
 * réponse a été reconnue.
 */
export function appliquerParametres(p: unknown): boolean {
  if (!p || typeof p !== "object") return false;
  const r = p as Record<string, any>;
  const nombre = (v: unknown, min: number, max: number): number | null => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const poser = <T extends object>(cible: T, cle: keyof T, v: number | null) => { if (v !== null) (cible as Record<keyof T, number>)[cle] = v; };
  poser(FRAIS, "placeur", nombre(r.frais?.placeur, 0, 0.05));
  poser(FRAIS, "preneur", nombre(r.frais?.preneur, 0, 0.05));
  poser(FRAIS, "sortie", nombre(r.frais?.sortie, 0, 0.05));
  poser(MARCHE, "pasPrix", nombre(r.marche?.pas_prix, 0.01, 100));
  poser(MARCHE, "quantiteMin", nombre(r.marche?.quantite_min, 0.01, 1_000_000));
  poser(FRAIS_CRYPTO, "USDT", nombre(r.crypto?.frais?.USDT, 0, 1000));
  poser(FRAIS_CRYPTO, "XAFe", nombre(r.crypto?.frais?.XAFe, 0, 1_000_000));
  if (typeof r.crypto?.retraits_ouverts === "boolean") CRYPTO.retraitsOuverts = r.crypto.retraits_ouverts;
  poser(RAPIDE, "marge", nombre(r.rapide?.marge, 0, 0.2));
  poser(RAPIDE, "validiteSecondes", nombre(r.rapide?.validite_secondes, 5, 120));
  if (typeof r.rapide?.ouvert === "boolean") RAPIDE.ouvert = r.rapide.ouvert;
  for (const o of Array.isArray(r.operateurs) ? r.operateurs : []) {
    const cible = OPERATEURS.find((x) => x.id === o?.id);
    if (!cible) continue;
    poser(cible, "plafondParTransfert", nombre(o.plafond_par_transfert, 1, 1e12));
    poser(cible, "plafondParJour", nombre(o.plafond_jour, 1, 1e13));
  }
  for (const k of ["0", "1", "2"]) {
    if (!r.paliers || !(k in r.paliers)) continue;
    const v = r.paliers[k];
    const cible = PALIERS[Number(k)];
    if (v === null) { cible.entreeJour = null; cible.sortieJour = null; continue; }
    const e = nombre(v?.entree_jour, 0, 1e13); const s = nombre(v?.sortie_jour, 0, 1e13);
    if (e !== null) cible.entreeJour = e;
    if (s !== null) cible.sortieJour = s;
  }
  return true;
}

/** Une clé d'intention : un geste, une clé — recommencer n'en crée pas un second. */
export function nouvelleCle(prefixe = "k"): string {
  const alea = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${prefixe}-${alea}`;
}
