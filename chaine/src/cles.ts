/*
 * LES CLÉS : une seule graine (12 ou 24 mots), et tout en découle. Chaque
 * adresse de dépôt est la dérivée n° i de la graine ; la base ne garde que
 * l'adresse et son indice — jamais une clé. Le wallet chaud est l'indice 0.
 *
 *   BEP20 (BNB Smart Chain) : m/44'/60'/0'/0/i   — l'adresse Ethereum
 *   TRC20 (Tron)            : m/44'/195'/0'/0/i  — 0x41 + les 20 octets, en Base58Check
 *
 * La graine vit dans la variable XAFE_GRAINE du service, et nulle part
 * ailleurs : ni dans le dépôt, ni dans la base, ni au journal.
 */
import { concat, encodeBase58, HDNodeWallet, Mnemonic, sha256 } from "ethers";

export type Reseau = "bep20" | "trc20";

const CHEMINS: Record<Reseau, string> = { bep20: "m/44'/60'/0'/0", trc20: "m/44'/195'/0'/0" };

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
  return { adresse: reseau === "bep20" ? portefeuille.address : adresseTron(portefeuille.address), portefeuille };
}

/* Les 24 mots → la graine binaire coûte 2 048 tours de PBKDF2 : on le fait une
 * fois par graine et par réseau, pas une fois par adresse. Dans Supabase, où le
 * temps de calcul d'un appel est compté, c'est la différence entre un tour qui
 * passe et un tour coupé. */
const racines = new Map<string, HDNodeWallet>();
function racine(graine: string, reseau: Reseau): HDNodeWallet {
  const cle = `${reseau}\u0000${graine.trim()}`;
  let r = racines.get(cle);
  if (!r) { r = HDNodeWallet.fromPhrase(graine.trim(), undefined, CHEMINS[reseau]); racines.set(cle, r); }
  return r;
}
