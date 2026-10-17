/*
 * CE QU'UN RÉSEAU DOIT SAVOIR FAIRE pour le veilleur. La logique d'argent
 * (créditer une fois, signer-noter-diffuser, balayer, mettre au froid) vit dans
 * veilleur.ts, une seule fois ; la BNB Smart Chain (evm.ts) et Tron (tron.ts)
 * ne font que parler leur langue.
 */
import { formatUnits } from "ethers";
import type { Reseau } from "./cles.ts";

export type Actif = "USDT" | "XAFe";

/** Ce qu'on demande à la chaîne de faire, depuis une adresse dérivée de la graine. */
export type Appel =
  | { type: "jeton"; actif: Actif; vers: string; montant: bigint }
  | { type: "natif"; vers: string; montant: bigint }
  | { type: "frapper"; vers: string; montant: bigint; empreinte: string }
  | { type: "detruireDepot"; adresse: string; montant: bigint; empreinte: string }
  /** détruire sur le solde de l'appelant : la réserve de Glisil (le wallet chaud) */
  | { type: "detruire"; montant: bigint; empreinte: string };

export type Transfert = { adresse: string; brut: bigint; preuve: string };

export interface Chaine {
  readonly reseau: Reseau;
  readonly confirmations: number;
  decimales: Record<Actif, number>;
  /** l'adresse du wallet chaud (indice 0), au format du réseau */
  readonly chaud: string;
  demarrer(): Promise<void>;
  /** le numéro du dernier bloc */
  tete(): Promise<number>;
  /** les transferts d'un jeton VERS ces adresses, entre deux blocs */
  transferts(actif: Actif, vers: string[], de: number, a: number): Promise<Transfert[]>;
  solde(quoi: Actif | "natif", adresse: string): Promise<bigint>;
  estAdresseDeDepot(adresse: string): Promise<boolean>;
  dejaDetruit(empreinte: string): Promise<boolean>;
  /** les XAFe en circulation sur ce réseau (totalSupply), en unités de la chaîne */
  offreXafe(): Promise<bigint>;
  /** ce qu'il faut de monnaie native à une adresse de dépôt pour envoyer ce jeton */
  fraisJeton(actif: Actif, depuisIndice: number, vers: string, montant: bigint): Promise<bigint>;
  /** une adresse de retrait valable, écrite comme le réseau l'attend — null si c'est une faute de frappe */
  adresseValable(adresse: string): string | null;
  /** signer SANS diffuser : le hash et la transaction brute, à noter avant de diffuser */
  signer(indice: number, appel: Appel): Promise<{ hash: string; brut: string }>;
  diffuser(brut: string): Promise<void>;
  /** null tant que la transaction n'est pas dans un bloc */
  recu(hash: string): Promise<{ bloc: number; ok: boolean } | null>;
  /**
   * Une transaction signée qui ne pourra JAMAIS plus entrer dans un bloc — la
   * seule raison d'en signer une autre pour le même retrait. Jugé sur la
   * CHAÎNE, assez confirmée, jamais sur l'horloge du service : un nœud en
   * retard qui ne voit pas encore un reçu ne doit pas faire payer deux fois.
   * Tron : le bloc confirmé est daté après son échéance ; EVM : son nonce est
   * pris, dans un bloc confirmé, par une autre transaction.
   */
  perimee(hash: string, brut: string): Promise<boolean>;
}

/** Un montant de la chaîne en montant du moteur : deux décimales, arrondi vers le bas (le reste ne se crédite pas). */
export function versMoteur(brut: bigint, decimales: number): number {
  if (decimales <= 2) return Number(formatUnits(brut, decimales));
  const pas = 10n ** BigInt(decimales - 2);
  return Number(formatUnits(brut / pas, 2));
}
