/*
 * LES CLÉS : une seule graine (12 ou 24 mots), et tout en découle. Chaque
 * adresse de dépôt est la dérivée n° i de la graine ; la base ne garde que
 * l'adresse et son indice — jamais une clé. Le wallet chaud est l'indice 0.
 *
 *   famille EVM  : m/44'/60'/<compte>'/0/i   — l'adresse Ethereum
 *   famille Tron : m/44'/195'/<compte>'/0/i  — 0x41 + les 20 octets, en Base58Check
 *
 * Le <compte> sépare les réseaux d'une même famille : BSC est le compte 0
 * (les adresses d'avant ne bougent pas), Ethereum 1, Base 2, Polygon 3. Deux
 * réseaux EVM n'ont donc jamais la même adresse de dépôt — la base exige
 * qu'une adresse ne serve qu'une fois, et un envoi fait par erreur sur le
 * mauvais réseau arrive quand même à une adresse que la graine contrôle.
 *
 * La graine vit dans la variable XAFE_GRAINE du service, et nulle part
 * ailleurs : ni dans le dépôt, ni dans la base, ni au journal.
 */
import { concat, encodeBase58, HDNodeWallet, Mnemonic, sha256 } from "ethers";

/** Les familles qu'un veilleur sait lire. Solana viendra avec son adaptateur. */
export type Famille = "evm" | "tron";

/**
 * Ce que le code sait de chaque réseau : de quoi dériver ses clés et payer ses
 * frais. LE MÊME registre vit dans la base (table « reseaux », migration
 * 0018), qui décide lequel est ouvert aux clients ; un test (cles.test.ts)
 * exige que les deux disent la même famille et le même compte.
 */
export type FicheReseau = {
  famille: Famille;
  compte: number;
  nom: string;
  natif: string;
  decimalesNatif: number;
  /** sous ce solde de monnaie native, le chaud ne paie plus que quelques retraits */
  natifMinimum: number;
  /** ce que « deployer » envoie au chaud sur un réseau d'essai */
  natifEssai: string;
  confirmations: number;
  /** combien de blocs la lecture du jeton avance par tour */
  blocsParTour: number;
  /** les décimales de l'USDT de ce réseau (le BSC-USD en a 18, les autres 6) */
  decimalesUsdt: readonly number[];
  /** les décimales de l'USDC de ce réseau (celui de BNB Chain en a 18, celui d'Ethereum 6) ; vide : pas d'USDC ici */
  decimalesUsdc: readonly number[];
  /** les chaînes EVM que le nœud a le droit d'annoncer : la principale, celle d'essai, et le nœud local du harnais (31337) */
  chainIds: readonly number[];
};

export const RESEAUX = {
  bep20:   { famille: "evm",  compte: 0, nom: "BNB Smart Chain", natif: "BNB", decimalesNatif: 18, natifMinimum: 0.01,  natifEssai: "0.05", confirmations: 15, blocsParTour: 100_000, decimalesUsdt: [6, 18], decimalesUsdc: [6, 18], chainIds: [56, 97, 31337] },
  trc20:   { famille: "tron", compte: 0, nom: "Tron",            natif: "TRX", decimalesNatif: 6,  natifMinimum: 50,    natifEssai: "200",  confirmations: 20, blocsParTour: 40_000,  decimalesUsdt: [6],     decimalesUsdc: [],      chainIds: [] },
  erc20:   { famille: "evm",  compte: 1, nom: "Ethereum",        natif: "ETH", decimalesNatif: 18, natifMinimum: 0.005, natifEssai: "0.02", confirmations: 12, blocsParTour: 20_000,  decimalesUsdt: [6],     decimalesUsdc: [6],     chainIds: [1, 11155111, 31337] },
  base:    { famille: "evm",  compte: 2, nom: "Base",            natif: "ETH", decimalesNatif: 18, natifMinimum: 0.001, natifEssai: "0.005", confirmations: 30, blocsParTour: 100_000, decimalesUsdt: [6],     decimalesUsdc: [6],     chainIds: [8453, 84532, 31337] },
  polygon: { famille: "evm",  compte: 3, nom: "Polygon",         natif: "POL", decimalesNatif: 18, natifMinimum: 1,     natifEssai: "5",    confirmations: 64, blocsParTour: 100_000, decimalesUsdt: [6],     decimalesUsdc: [6],     chainIds: [137, 80002, 31337] },
} as const satisfies Record<string, FicheReseau>;

export type Reseau = keyof typeof RESEAUX;

export function estReseau(r: unknown): r is Reseau {
  return typeof r === "string" && Object.prototype.hasOwnProperty.call(RESEAUX, r);
}
export function fiche(r: Reseau): FicheReseau { return RESEAUX[r]; }
/** BEP20, TRC20, ERC20, BASE, POLYGON : le préfixe des variables du veilleur */
export const prefixe = (r: Reseau) => r.toUpperCase();
/** la variable qui porte le nœud : BEP20_RPC pour l'EVM, TRC20_NOEUD pour Tron (les noms d'avant) */
export const variableDuNoeud = (r: Reseau) => `${prefixe(r)}_${RESEAUX[r].famille === "evm" ? "RPC" : "NOEUD"}`;

const chemin = (r: Reseau) => `m/44'/${RESEAUX[r].famille === "evm" ? 60 : 195}'/${RESEAUX[r].compte}'/0`;

/** L'indice du wallet chaud : celui qui signe les retraits et paie le gaz. */
export const CHAUD = 0;

export function graineValide(graine: string): boolean {
  try { Mnemonic.fromPhrase(graine.trim()); return true; } catch { return false; }
}

/** Une adresse Tron à partir de l'adresse Ethereum de la même clé. */
export function adresseTron(evm: string): string {
  const corps = concat(["0x41", evm]);
  const somme = sha256(sha256(corps)).slice(0, 10);
  return encodeBase58(concat([corps, somme]));
}

/** La dérivée n° indice : son adresse (celle qu'on montre au client) et son portefeuille (pour signer). */
export function deriver(graine: string, reseau: Reseau, indice: number): { adresse: string; portefeuille: HDNodeWallet } {
  if (!Number.isInteger(indice) || indice < 0) throw new Error("indice invalide");
  const portefeuille = racine(graine, reseau).deriveChild(indice);
  return { adresse: RESEAUX[reseau].famille === "evm" ? portefeuille.address : adresseTron(portefeuille.address), portefeuille };
}

/* Les 24 mots → la graine binaire coûte 2 048 tours de PBKDF2 : on le fait une
 * fois par graine et par réseau, pas une fois par adresse. Dans Supabase, où le
 * temps de calcul d'un appel est compté, c'est la différence entre un tour qui
 * passe et un tour coupé. */
const racines = new Map<string, HDNodeWallet>();
function racine(graine: string, reseau: Reseau): HDNodeWallet {
  const cle = `${reseau}\u0000${graine.trim()}`;
  let r = racines.get(cle);
  if (!r) { r = HDNodeWallet.fromPhrase(graine.trim(), undefined, chemin(reseau)); racines.set(cle, r); }
  return r;
}
