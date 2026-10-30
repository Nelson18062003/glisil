/*
 * LE WALLET D'UN SIGNATAIRE, DANS LE NAVIGATEUR — le jumeau de la page de la graine (../graine).
 *
 * Les contrats ont un patron à trois clés, dont deux signent (le Safe de BNB Chain et d'Ethereum, le
 * compte TronLink 2 sur 3). Le propriétaire veut 24 mots pour chacune ; MetaMask n'en crée que 12, mais
 * IMPORTE une phrase de 24. Cette page crée les 24 mots hors ligne (256 bits du hasard du système), sur
 * l'appareil même qui gardera la clé — l'ordinateur, puis chaque téléphone, jamais les trois au même
 * endroit — et montre l'adresse que MetaMask (compte 1) et TronLink afficheront après l'import, pour que
 * le propriétaire vérifie de ses yeux que l'import est juste.
 *
 * Les chemins sont ceux des deux applications : MetaMask m/44'/60'/0'/0/0, TronLink m/44'/195'/0'/0/0.
 * L'adresse Tron passe par src/cles.ts (le code du veilleur). Ces mots ne vont JAMAIS dans Infisical.
 */
import { HDNodeWallet, Mnemonic } from "ethers";
import { adresseTron } from "../../src/cles.ts";

export const CHEMIN_METAMASK = "m/44'/60'/0'/0/0";
export const CHEMIN_TRONLINK = "m/44'/195'/0'/0/0";

/** 24 mots, à partir de 32 octets de hasard du système. */
export function nouvelleGraine(hasard: (n: Uint8Array) => Uint8Array = (n) => crypto.getRandomValues(n)): string[] {
  const entropie = hasard(new Uint8Array(32));
  if (entropie.length !== 32 || entropie.every((o) => o === 0)) throw new Error("hasard indisponible");
  return Mnemonic.fromEntropy(entropie).phrase.split(" ");
}

/** Les adresses PUBLIQUES que MetaMask (compte 1) et TronLink montreront pour ces mots. */
export function adressesDuSignataire(mots: string[]): { metamask: string; tronlink: string } {
  const phrase = mots.join(" ");
  return {
    metamask: HDNodeWallet.fromPhrase(phrase, undefined, CHEMIN_METAMASK).address,
    tronlink: adresseTron(HDNodeWallet.fromPhrase(phrase, undefined, CHEMIN_TRONLINK).address),
  };
}
