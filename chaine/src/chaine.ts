/*
 * CE QU'UN RÉSEAU DOIT SAVOIR FAIRE pour le veilleur. La logique d'argent
 * (créditer une fois, signer-noter-diffuser, balayer, mettre au froid) vit dans
 * veilleur.ts, une seule fois ; la BNB Smart Chain (evm.ts) et Tron (tron.ts)
 * ne font que parler leur langue.
 */
import { formatUnits, id } from "ethers";
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

/**
 * Un mouvement de l'OFFRE du jeton XAFe, lu sur la chaîne : une frappe (un
 * Transfer depuis l'adresse zéro) ou une destruction (un Transfer vers elle).
 * C'est le Transfer standard qui fait foi — il ne dépend pas de ce que NOTRE
 * contrat raconte ; l'empreinte vient de l'événement Frappe / Detruit de la
 * même transaction, et vaut null si aucun ne l'accompagne : une frappe que
 * personne ne saurait expliquer, ce que le rapprochement doit crier.
 */
export type MouvementJeton = { tx: string; index: number; bloc: number; genre: "frappe" | "destruction"; adresse: string; brut: bigint; empreinte: string | null };

/** Un journal d'événement tel que les deux réseaux le rendent par eth_getLogs. */
export type JournalBrut = { tx: string; index: number; bloc: number; topics: string[]; data: string };

export const SUJETS = {
  transfert: id("Transfer(address,address,uint256)"),
  frappe: id("Frappe(address,uint256,bytes32)"),
  detruit: id("Detruit(address,uint256,bytes32)"),
  geles: id("FondsGelesDetruits(address,uint256,bytes32)"),
};
const ZERO = `0x${"0".repeat(64)}`;
const vingt = (sujet: string) => `0x${sujet.slice(-40)}`.toLowerCase();

/**
 * Les journaux du contrat XAFe → les mouvements de son offre. Un transfert
 * ordinaire (d'un client à un autre) ne change pas l'offre : il est écarté.
 * Chaque frappe se marie à l'événement Frappe de la MÊME transaction, même
 * destinataire, même montant ; chaque destruction à un Detruit ou un
 * FondsGelesDetruits — un événement ne sert qu'une fois.
 */
export function mouvementsDepuisJournaux(journaux: JournalBrut[], adresse: (vingtOctets: string) => string): MouvementJeton[] {
  const sceaux = journaux.filter((j) => [SUJETS.frappe, SUJETS.detruit, SUJETS.geles].includes(j.topics[0]?.toLowerCase()));
  const pris = new Set<JournalBrut>();
  const mouvements: MouvementJeton[] = [];
  for (const j of journaux) {
    if (j.topics[0]?.toLowerCase() !== SUJETS.transfert || j.topics.length < 3) continue;
    const depuis = j.topics[1].toLowerCase(), vers = j.topics[2].toLowerCase();
    if (depuis !== ZERO && vers !== ZERO) continue;
    const genre = depuis === ZERO ? "frappe" : "destruction";
    const qui = genre === "frappe" ? vers : depuis;
    const brut = BigInt(j.data);
    const sceau = sceaux.find((e) => !pris.has(e) && e.tx === j.tx && e.topics[1]?.toLowerCase() === qui && BigInt(e.data) === brut
      && (genre === "frappe" ? e.topics[0].toLowerCase() === SUJETS.frappe : e.topics[0].toLowerCase() !== SUJETS.frappe));
    if (sceau) pris.add(sceau);
    mouvements.push({ tx: j.tx, index: j.index, bloc: j.bloc, genre, adresse: adresse(vingt(qui)), brut, empreinte: sceau?.topics[2]?.toLowerCase() ?? null });
  }
  return mouvements.sort((a, b) => a.bloc - b.bloc || a.index - b.index);
}

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
  /** chaque frappe et chaque destruction de XAFe entre deux blocs, avec son empreinte */
  mouvementsXafe(de: number, a: number): Promise<MouvementJeton[]>;
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
