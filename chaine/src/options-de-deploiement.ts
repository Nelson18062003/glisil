/*
 * Ce que le déploiement d'un contrat XAFe exige, avant de signer quoi que ce
 * soit — sans réseau ni clé, pour s'éprouver seul (options-de-deploiement.test.ts).
 *
 * Sur un réseau PRINCIPAL (BSC 56, Ethereum 1, Base 8453, Polygon 137, ou le
 * nœud Tron de production), le déploiement se fait en --production ou pas du
 * tout : un admin d'essai sur un vrai contrat serait une clé de serveur maître
 * de l'argent réel.
 */
import type { Reseau } from "./cles.ts";

export const USDT_OFFICIEL: Partial<Record<Reseau, string>> = {
  bep20: "0x55d398326f99059fF775485246999027B3197955", trc20: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  erc20: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
};
/**
 * L'USDC des réseaux qui le portent (livraison 2) : celui d'Ethereum est émis par Circle (6 décimales) ; celui de
 * BNB Chain est l'USDC « Binance-Peg » que BscScan, Binance et les wallets reconnaissent (18 décimales). PAS de Tron :
 * Circle y a cessé l'USDC en 2024. À revérifier sur circle.com et bscscan.com avant usage.
 */
export const USDC_OFFICIEL: Partial<Record<Reseau, string>> = {
  bep20: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  erc20: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
};
const CHAINES_PRINCIPALES = new Set([1, 56, 137, 8453]);
const NOEUDS_TRON_PRINCIPAUX = new Set(["api.trongrid.io", "api.tronstack.io"]);
/** un plafond de frappe par jour, en XAF : la décision du propriétaire */
export const PLAFOND_PAR_DEFAUT_XAF = 1_000_000_000n;

/** le nœud (ou l'identifiant de chaîne lu au nœud) désigne-t-il un réseau principal ? */
export function estReseauPrincipal(reseau: Reseau, noeud: string, chainId?: number | bigint | null): boolean {
  if (reseau === "trc20") {
    try { return NOEUDS_TRON_PRINCIPAUX.has(new URL(noeud).hostname); } catch { return false; }
  }
  return chainId != null && CHAINES_PRINCIPALES.has(Number(chainId));
}

const memeAdresse = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export type OptionsDeDeploiement = {
  reseau: Reseau; principal: boolean; production: boolean;
  admin?: string; pauseur?: string; geleur?: string; usdt?: string; usdtEssai?: boolean; plafond?: string;
  usdc?: string; usdcEssai?: boolean;
};

/** rend la raison du refus, ou null ; le plafond retenu en XAF */
export function verifierLesOptions(o: OptionsDeDeploiement): { refus: string | null; plafondXaf: bigint } {
  const refus = (t: string) => ({ refus: t, plafondXaf: 0n });
  if (o.principal && !o.production) return refus("réseau PRINCIPAL : --production exigé (l'admin est le wallet du propriétaire, jamais une clé d'essai)");
  if (o.production) {
    for (const k of ["admin", "pauseur", "geleur"] as const) if (!o[k]) return refus(`--production : --${k} <adresse> (le wallet du propriétaire)`);
    if (o.usdtEssai) return refus("--production : jamais d'USDT d'essai");
    const officiel = USDT_OFFICIEL[o.reseau];
    if (!officiel || !o.usdt || !memeAdresse(o.usdt, officiel)) return refus(`--production : --usdt doit être l'USDT officiel du réseau (${officiel ?? "inconnu ici"})`);
    if (o.usdcEssai) return refus("--production : jamais d'USDC d'essai");
    const usdc = USDC_OFFICIEL[o.reseau];
    if (usdc && (!o.usdc || !memeAdresse(o.usdc, usdc))) return refus(`--production : --usdc doit être l'USDC officiel du réseau (${usdc})`);
  }
  // l'USDC ne passe pas partout : sur Tron, un « USDC » serait un jeton abandonné
  if ((o.usdc || o.usdcEssai) && !USDC_OFFICIEL[o.reseau]) return refus(`--usdc : l'USDC ne passe pas par ce réseau (seulement ${Object.keys(USDC_OFFICIEL).join(", ")})`);
  let plafondXaf = PLAFOND_PAR_DEFAUT_XAF;
  if (o.plafond) {
    if (!/^[1-9][0-9]*$/.test(o.plafond)) return refus("--plafond : un nombre entier de XAF par jour, plus grand que zéro");
    plafondXaf = BigInt(o.plafond);
  }
  return { refus: null, plafondXaf };
}
