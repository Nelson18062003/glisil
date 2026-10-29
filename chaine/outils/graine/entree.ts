/*
 * LA GRAINE, DANS LE NAVIGATEUR — pour un propriétaire qui n'ouvre jamais de terminal.
 *
 * Le même calcul que « npm run mise-en-service -- graine » : 256 bits de hasard du système
 * (crypto.getRandomValues), 24 mots BIP-39, et les wallets chauds dérivés par src/cles.ts — le
 * MÊME code que le veilleur, importé tel quel. Une page qui recalculerait les adresses à sa façon
 * pourrait montrer un wallet chaud que le veilleur ne retrouverait pas ; celle-ci ne le peut pas.
 *
 * fabriquer.mjs en fait UN fichier HTML autonome : aucun script ni police chargé d'ailleurs, et une
 * politique de contenu qui interdit toute connexion — la page ne PEUT rien envoyer, Wi-Fi ou pas.
 * verifier.mjs rejoue la dérivation de la page contre src/cles.ts.
 */
import { Mnemonic } from "ethers";
import { CHAUD, deriver, graineValide, RESEAUX, type Reseau } from "../../src/cles.ts";

/** Les réseaux ouverts ou prévus pour la mise en service : BNB Chain, Tron, Ethereum. */
export const RESEAUX_DE_LA_PAGE: Reseau[] = ["bep20", "trc20", "erc20"];

/** 24 mots, à partir de 32 octets de hasard du système. */
export function nouvelleGraine(hasard: (n: Uint8Array) => Uint8Array = (n) => crypto.getRandomValues(n)): string[] {
  const entropie = hasard(new Uint8Array(32));
  if (entropie.length !== 32 || entropie.every((o) => o === 0)) throw new Error("hasard indisponible");
  return Mnemonic.fromEntropy(entropie).phrase.split(" ");
}

/** Les wallets chauds (indice 0) : des adresses PUBLIQUES, à donner pour les rôles et les frais. */
export function walletsChauds(mots: string[]): { reseau: Reseau; nom: string; adresse: string }[] {
  const graine = mots.join(" ");
  if (!graineValide(graine)) throw new Error("graine invalide");
  return RESEAUX_DE_LA_PAGE.map((r) => ({ reseau: r, nom: RESEAUX[r].nom, adresse: deriver(graine, r, CHAUD).adresse }));
}
