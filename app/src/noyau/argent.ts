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

/**
 * La crypto : les retraits vers la chaîne sont fermés par le moteur tant
 * qu'aucun veilleur ne les envoie ; les adresses de dépôt, tant que l'équipe
 * n'ouvre pas la crypto (« crypto.depots_ouverts »).
 */
export const CRYPTO = { retraitsOuverts: true, depotsOuverts: true };

/**
 * Les sorties de XAF vers Mobile Money : ouvertes ou pas (« sortie.ouvertes »),
 * et qui paie (« sortie.mode ») — TOTEM, qui compose le transfert tout seul,
 * ou l'équipe, à la main, qui donne ensuite le transaction ID.
 */
export const SORTIES: { ouvertes: boolean; mode: "totem" | "manuel" } = { ouvertes: true, mode: "totem" };

/** Les frais d'une sortie payée à la main : une seule fois sur le montant (pas de découpage par transfert). */
export function fraisSortieManuelle(montant: number): { frais: number; envoi: number } {
  const frais = Math.ceil(montant * FRAIS.sortie);
  return { frais, envoi: montant - frais };
}

/**
 * LES RÉSEAUX. Un client a UN solde ; le réseau ne se choisit qu'au dépôt ou
 * au retrait. La liste vient du moteur (parametres_publics → crypto.reseaux,
 * registre « reseaux », migration 0018) : l'équipe ouvre Base ou Ethereum, et
 * l'écran les propose sans qu'on le recompile. BEP20 et TRC20 en sont les
 * valeurs de départ, tant que la première lecture n'est pas revenue.
 */
export type Famille = "evm" | "tron" | "solana";
export type InfoReseau = {
  id: string;
  /** ce que le client lit sur son wallet : « BEP20 », « TRC20 », « Base » */
  nom: string;
  /** la chaîne : « BNB Smart Chain », « Tron » */
  chaine: string;
  famille: Famille;
  confirmations: number;
  /** la monnaie des frais de réseau : BNB, TRX, ETH */
  natif: string;
  /** le réseau où vit la réserve de XAFe */
  maison: boolean;
};

const FORMES: Record<Famille, RegExp> = {
  evm: /^0x[0-9a-fA-F]{40}$/,
  tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
};
export const adresseValide = (famille: Famille, a: string) => FORMES[famille].test(a.trim());

const DEPART: InfoReseau[] = [
  { id: "bep20", nom: "BEP20", chaine: "BNB Smart Chain", famille: "evm", confirmations: 15, natif: "BNB", maison: true },
  { id: "trc20", nom: "TRC20", chaine: "Tron", famille: "tron", confirmations: 20, natif: "TRX", maison: false },
];
/** Tous les réseaux déjà vus (l'historique peut nommer un réseau fermé depuis). */
export const RESEAUX: Record<string, InfoReseau> = Object.fromEntries(DEPART.map((r) => [r.id, r]));
/** Les réseaux ouverts, dans l'ordre où l'écran les propose : le maison d'abord. */
export const RESEAUX_OUVERTS: string[] = DEPART.map((r) => r.id);

/** Ce qu'on sait d'un réseau ; un identifiant inconnu se montre tel quel, jamais en plantant l'écran. */
export function infoReseau(id: string): InfoReseau {
  return RESEAUX[id] ?? { id, nom: id.toUpperCase(), chaine: id.toUpperCase(), famille: "evm", confirmations: 15, natif: "", maison: false };
}
export const reseauxOuverts = (): InfoReseau[] => RESEAUX_OUVERTS.map(infoReseau);
/** « BEP20 · BNB Smart Chain » ; « Base » seul quand la norme et la chaîne portent le même nom */
export const libelleReseau = (r: InfoReseau) => (r.nom === r.chaine ? r.chaine : `${r.nom} · ${r.chaine}`);

/**
 * Les réseaux OUVERTS où cette adresse peut vivre. Une adresse T… n'est que
 * Tron ; une adresse 0x… vaut pour TOUS les réseaux EVM — BSC, Base,
 * Ethereum, Polygon ont la même forme. Une seule possibilité : l'écran la
 * prend. Plusieurs : le client choisit, et l'écran ne choisit jamais pour lui
 * (des fonds envoyés sur la mauvaise chaîne sont l'erreur la plus coûteuse en crypto).
 */
export function reseauxPour(adresse: string): InfoReseau[] {
  const a = adresse.trim();
  return reseauxOuverts().filter((r) => adresseValide(r.famille, a));
}

/** Le réseau de l'adresse, s'il n'y en a qu'un possible ; sinon null (aucun, ou à choisir). */
export function reseauDe(adresse: string): string | null {
  const l = reseauxPour(adresse);
  return l.length === 1 ? l[0].id : null;
}

/** « BEP20 ou TRC20 », « BEP20, TRC20 ou Base » */
export function nomsDesReseaux(): string {
  const n = reseauxOuverts().map((r) => r.nom);
  return n.length <= 1 ? (n[0] ?? "aucun réseau") : `${n.slice(0, -1).join(", ")} ou ${n[n.length - 1]}`;
}

function appliquerReseaux(liste: unknown) {
  if (!Array.isArray(liste)) return;
  const lus: InfoReseau[] = [];
  for (const x of liste) {
    if (!x || typeof x !== "object") return;
    const r = x as Record<string, unknown>;
    if (typeof r.id !== "string" || !/^[a-z][a-z0-9]{1,11}$/.test(r.id) || !["evm", "tron", "solana"].includes(String(r.famille))) return;   // une liste abîmée laisse celle d'avant
    const confirmations = typeof r.confirmations === "number" && r.confirmations >= 1 && r.confirmations <= 1000 ? r.confirmations : infoReseau(r.id).confirmations;
    lus.push({ id: r.id, nom: typeof r.norme === "string" ? r.norme : r.id.toUpperCase(), chaine: typeof r.nom === "string" ? r.nom : r.id,
               famille: r.famille as Famille, confirmations, natif: typeof r.natif === "string" ? r.natif : "", maison: r.maison === true });
  }
  for (const r of lus) RESEAUX[r.id] = r;
  RESEAUX_OUVERTS.splice(0, RESEAUX_OUVERTS.length, ...lus.map((r) => r.id));
}

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

/**
 * Les règles du marché (docs/REGLES-DU-MARCHE.md, migration 0017) : les mêmes
 * que le moteur fait respecter. L'écran les lit pour dire AVANT l'envoi
 * pourquoi un ordre serait refusé — le moteur reste seul juge.
 */
export const MARCHE: {
  paire: string; pasPrix: number; quantiteMin: number; ouvert: boolean;
  quantiteMax: number; marcheQuantiteMax: number; ordresOuvertsMax: number;
  bandeAchat: [number, number]; bandeVente: [number, number]; bandeExecution: number;
  /** le prix autour duquel la bande se calcule (moyenne des échanges récents, ou celle posée par l'équipe) */
  reference: number | null;
} = {
  paire: "USDT/XAFe",
  ouvert: true,
  pasPrix: 0.05,
  quantiteMin: 10,
  quantiteMax: 1_000_000,
  marcheQuantiteMax: 100_000,
  ordresOuvertsMax: 200,
  bandeAchat: [0.8, 1.1],
  bandeVente: [0.9, 1.2],
  bandeExecution: 0.05,
  reference: null,
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
  0: { entreeJour: 500_000, sortieJour: 500_000, nom: "Palier 0 · e-mail vérifié" },
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

/**
 * La bande de prix d'un ordre limite, comme le moteur la calcule : la
 * référence multipliée par les bornes du côté, ramenée au pas VERS
 * L'INTÉRIEUR. Null sans référence : le premier ordre fait le marché.
 */
export function bandeDePrix(cote: "achat" | "vente", reference: number | null | undefined): { min: number; max: number } | null {
  if (!reference || !(reference > 0)) return null;
  const [bas, haut] = cote === "achat" ? MARCHE.bandeAchat : MARCHE.bandeVente;
  const pas = MARCHE.pasPrix;
  return { min: arrondi2(Math.ceil(arrondi2(reference * bas) / pas - 1e-9) * pas), max: arrondi2(Math.floor(arrondi2(reference * haut) / pas + 1e-9) * pas) };
}

/**
 * Pourquoi le moteur refuserait cet ordre — dans l'ordre où il vérifie, en
 * une phrase qui dit la règle ET la borne. Null : rien ne s'y oppose.
 */
export function raisonDuRefus(o: {
  cote: "achat" | "vente"; type: "limite" | "marche"; prix: number; quantite: number;
  dispoXafe: number; dispoUsdt: number; reference: number | null | undefined; ouverts: number;
}): string | null {
  if (!(o.quantite > 0)) return null;
  if (o.type === "limite" && !(o.prix > 0)) return "Fixez votre prix.";
  if (!quantiteValide(o.quantite)) {
    return `Au moins ${MARCHE.quantiteMin} USDT par ordre${o.prix > 0 ? ` (≈ ${Math.ceil(MARCHE.quantiteMin * o.prix).toLocaleString("fr-FR")} XAFe)` : ""}, deux décimales au plus.`;
  }
  if (o.type === "limite" && !prixValide(o.prix)) return `Le prix va de ${String(MARCHE.pasPrix).replace(".", ",")} en ${String(MARCHE.pasPrix).replace(".", ",")} XAFe.`;
  if (o.quantite > MARCHE.quantiteMax) return `Au plus ${MARCHE.quantiteMax.toLocaleString("fr-FR")} USDT par ordre.`;
  if (o.type === "marche" && o.quantite > MARCHE.marcheQuantiteMax) {
    return `Au plus ${MARCHE.marcheQuantiteMax.toLocaleString("fr-FR")} USDT au marché : au-delà, posez un ordre limite.`;
  }
  const bande = o.type === "limite" ? bandeDePrix(o.cote, o.reference) : null;
  if (bande && (o.prix < bande.min || o.prix > bande.max)) {
    return `${o.cote === "achat" ? "Un achat" : "Une vente"} se place entre ${bande.min.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} et ${bande.max.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} XAFe (prix de référence ${o.reference!.toLocaleString("fr-FR", { minimumFractionDigits: 2 })}).`;
  }
  if (o.type === "limite" && o.ouverts >= MARCHE.ordresOuvertsMax) return `Vous avez déjà ${o.ouverts} ordres ouverts, le maximum : annulez-en un.`;
  if (o.type === "limite" && o.cote === "achat" && arrondi2(o.prix * o.quantite) > o.dispoXafe) {
    return `Il faut ${Math.ceil(arrondi2(o.prix * o.quantite)).toLocaleString("fr-FR")} XAFe ; vous en avez ${Math.floor(o.dispoXafe).toLocaleString("fr-FR")}.`;
  }
  if (o.cote === "vente" && o.quantite > o.dispoUsdt) return `Vous avez ${o.dispoUsdt.toLocaleString("fr-FR")} USDT disponibles.`;
  return null;
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
  if (typeof r.crypto?.depots_ouverts === "boolean") CRYPTO.depotsOuverts = r.crypto.depots_ouverts;
  appliquerReseaux(r.crypto?.reseaux);
  if (typeof r.sortie?.ouvertes === "boolean") SORTIES.ouvertes = r.sortie.ouvertes;
  if (r.sortie?.mode === "totem" || r.sortie?.mode === "manuel") SORTIES.mode = r.sortie.mode;
  if (typeof r.marche?.ouvert === "boolean") MARCHE.ouvert = r.marche.ouvert;
  poser(MARCHE, "quantiteMax", nombre(r.marche?.quantite_max, 0.01, 1e9));
  poser(MARCHE, "marcheQuantiteMax", nombre(r.marche?.marche_quantite_max, 0.01, 1e9));
  poser(MARCHE, "ordresOuvertsMax", nombre(r.marche?.ordres_ouverts_max, 1, 10000));
  poser(MARCHE, "bandeExecution", nombre(r.marche?.bande_execution, 0.001, 0.5));
  for (const [cle, champ] of [["bande_achat", "bandeAchat"], ["bande_vente", "bandeVente"]] as const) {
    const b = r.marche?.[cle];
    if (Array.isArray(b) && b.length === 2 && b.every((x: unknown) => typeof x === "number" && x > 0)) MARCHE[champ] = [b[0], b[1]];
  }
  if (r.marche && "reference" in r.marche) MARCHE.reference = nombre(r.marche.reference, 0.01, 1e9);
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
