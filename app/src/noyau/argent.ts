/*
 * L'arithmétique de l'argent, telle que le MOTEUR la fait (supabase/migrations).
 * L'écran ne décide rien : il MONTRE d'avance ce que la base va faire — frais,
 * découpage, achat maximal — et la base reste seule juge au moment d'écrire.
 * Si une règle change ici, elle a changé là-bas d'abord.
 */

export const FRAIS = {
  /** frais de celui dont l'ordre attendait au carnet */
  placeur: 0.0005,
  /** frais de celui dont l'ordre vient prendre */
  preneur: 0.001,
  /** frais d'une sortie XAFe → XAF, par transfert */
  sortie: 0.005,
} as const;

/** frais d'un retrait vers un wallet externe, par actif (le gaz, à prix fixe) */
export const FRAIS_CRYPTO: Record<"USDT" | "XAFe", number> = { USDT: 1, XAFe: 500 };

export const RESEAUX: Record<"bep20" | "trc20", { nom: string; chaine: string; confirmations: number; valide: (a: string) => boolean }> = {
  bep20: { nom: "BEP20", chaine: "BNB Smart Chain", confirmations: 15, valide: (a) => /^0x[0-9a-fA-F]{40}$/.test(a) },
  trc20: { nom: "TRC20", chaine: "Tron", confirmations: 20, valide: (a) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a) },
};

export const MARCHE = {
  paire: "USDT/XAFe",
  pasPrix: 0.05,
  quantiteMin: 10,
} as const;

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

/** Une quantité d'USDT valide pour le carnet : ≥ minimum, deux décimales. */
export function quantiteValide(q: number): boolean {
  return Number.isFinite(q) && q >= MARCHE.quantiteMin && Math.round(q * 100) === q * 100;
}

/** Un prix valide : positif, multiple du pas. */
export function prixValide(p: number): boolean {
  if (!Number.isFinite(p) || p <= 0) return false;
  const n = Math.round(p * 100);
  const pas = Math.round(MARCHE.pasPrix * 100);
  return n % pas === 0;
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

/** Une clé d'intention : un geste, une clé — recommencer n'en crée pas un second. */
export function nouvelleCle(prefixe = "k"): string {
  const alea = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${prefixe}-${alea}`;
}
