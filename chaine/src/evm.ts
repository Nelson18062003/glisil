/* La BNB Smart Chain (et toute chaîne EVM) : ce que le veilleur lui demande. */
import { Contract, getAddress, Interface, JsonRpcProvider, Transaction, zeroPadValue, type TransactionRequest } from "ethers";
import type { Actif, Appel, Chaine, EtatDuJeton, MouvementJeton, Transfert } from "./chaine.ts";
import { mouvementsDepuisJournaux, SUJETS } from "./chaine.ts";
import { CHAUD, deriver, type Reseau } from "./cles.ts";

export const ABI_JETON = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 montant) returns (bool)",
  "function frapper(address vers, uint256 montant, bytes32 empreinte)",
  "function detruireDepot(address adresse, uint256 montant, bytes32 empreinte)",
  "function frapperReserve(uint256 montant, bytes32 empreinte)",
  "function detruireReserve(uint256 montant, bytes32 empreinte)",
  "function paused() view returns (bool)",
  "function plafondJour() view returns (uint256)",
  "function resteDuJour() view returns (uint256)",
  "function reserve() view returns (uint256)",
  "function estAdresseDeDepot(address) view returns (bool)",
  "function destructionReferencee(bytes32) view returns (bool)",
  "function totalSupply() view returns (uint256)",
];
const IFACE = new Interface(ABI_JETON);
const TRANSFER = IFACE.getEvent("Transfer")!.topicHash;

export type ConfigEvm = { rpcUrl: string; usdt: string; xafe: string; confirmations: number; graine: string;
  /** le réseau EVM : BSC par défaut, Ethereum, Base, Polygon… — il décide du compte de dérivation */
  reseau?: Reseau };

export class ChaineEvm implements Chaine {
  readonly reseau: Reseau;
  readonly confirmations: number;
  readonly fournisseur: JsonRpcProvider;
  readonly chaud: string;
  readonly reserve: string;
  readonly jetons: Record<Actif, Contract>;
  decimales: Record<Actif, number> = { USDT: 18, XAFe: 6 };
  private graine: string;

  constructor(c: ConfigEvm) {
    this.reseau = c.reseau ?? "bep20";
    this.confirmations = c.confirmations;
    this.graine = c.graine;
    // cacheTimeout -1 : ethers garde sinon 250 ms la réponse « pas de reçu », et un tour qui suit de près croit
    // jamais partie une transaction déjà minée — sur de l'argent, une réponse d'avant ne vaut rien
    this.fournisseur = new JsonRpcProvider(c.rpcUrl, undefined, { staticNetwork: true, pollingInterval: 500, cacheTimeout: -1 });
    this.chaud = deriver(c.graine, this.reseau, CHAUD).adresse;
    this.reserve = getAddress(c.xafe);
    this.jetons = { USDT: new Contract(c.usdt, ABI_JETON, this.fournisseur), XAFe: new Contract(c.xafe, ABI_JETON, this.fournisseur) };
  }

  async demarrer() {
    this.decimales = { USDT: Number(await this.jetons.USDT.decimals()), XAFe: Number(await this.jetons.XAFe.decimals()) };
  }

  tete() { return this.fournisseur.getBlockNumber(); }

  async transferts(actif: Actif, vers: string[], de: number, a: number): Promise<Transfert[]> {
    const vus: Transfert[] = [];
    const valables = vers.filter((x) => /^0x[0-9a-fA-F]{40}$/.test(x)).map((x) => zeroPadValue(x.toLowerCase(), 32));
    const contrat = await this.jetons[actif].getAddress();
    for (let i = 0; i < valables.length; i += 50) {
      for (let b = de; b <= a; b += 2000) {
        const journaux = await this.fournisseur.getLogs({ address: contrat, topics: [TRANSFER, null, valables.slice(i, i + 50)], fromBlock: b, toBlock: Math.min(a, b + 1999) });
        for (const j of journaux) {
          const e = IFACE.parseLog(j)!;
          vus.push({ adresse: String(e.args.to), brut: BigInt(e.args.value), preuve: `${j.transactionHash}:${j.index}` });
        }
      }
    }
    return vus;
  }

  async solde(quoi: Actif | "natif", adresse: string) {
    return quoi === "natif" ? this.fournisseur.getBalance(adresse) : BigInt(await this.jetons[quoi].balanceOf(adresse));
  }
  async estAdresseDeDepot(adresse: string) { return Boolean(await this.jetons.XAFe.estAdresseDeDepot(adresse)); }
  async dejaDetruit(empreinte: string) { return Boolean(await this.jetons.XAFe.destructionReferencee(empreinte)); }
  async offreXafe() { return BigInt(await this.jetons.XAFe.totalSupply()); }
  async etatDuJeton(): Promise<EtatDuJeton> {
    const j = this.jetons.XAFe;
    const [enPause, plafondJour, resteDuJour, reserve] = await Promise.all([j.paused(), j.plafondJour(), j.resteDuJour(), j.reserve()]);
    return { enPause: Boolean(enPause), plafondJour: BigInt(plafondJour), resteDuJour: BigInt(resteDuJour), reserve: BigInt(reserve) };
  }

  async mouvementsXafe(de: number, a: number): Promise<MouvementJeton[]> {
    const contrat = await this.jetons.XAFe.getAddress();
    const journaux = [];
    for (let b = de; b <= a; b += 5000) {
      for (const j of await this.fournisseur.getLogs({ address: contrat, topics: [Object.values(SUJETS)], fromBlock: b, toBlock: Math.min(a, b + 4999) })) {
        journaux.push({ tx: j.transactionHash, index: j.index, bloc: j.blockNumber, topics: [...j.topics], data: j.data });
      }
    }
    return mouvementsDepuisJournaux(journaux, (x) => getAddress(x));
  }

  async fraisJeton(actif: Actif, depuisIndice: number, vers: string, montant: bigint) {
    const depuis = deriver(this.graine, this.reseau, depuisIndice).adresse;
    const gaz = (await this.fournisseur.estimateGas({ from: depuis, to: await this.jetons[actif].getAddress(), data: IFACE.encodeFunctionData("transfer", [vers, montant]) })) * 12n / 10n;
    return gaz * ((await this.fournisseur.getFeeData()).gasPrice ?? 1_000_000_000n);
  }

  adresseValable(adresse: string): string | null {
    // tout en minuscules ou tout en majuscules : pas de somme de contrôle ; sinon elle doit être juste
    try { return getAddress(/^0x[0-9a-f]{40}$|^0x[0-9A-F]{40}$/.test(adresse) ? adresse.toLowerCase() : adresse); } catch { return null; }
  }

  async signer(indice: number, appel: Appel) {
    const p = deriver(this.graine, this.reseau, indice).portefeuille.connect(this.fournisseur);
    let tx: TransactionRequest;
    if (appel.type === "natif") tx = { to: appel.vers, value: appel.montant };
    else if (appel.type === "jeton") tx = { to: await this.jetons[appel.actif].getAddress(), data: IFACE.encodeFunctionData("transfer", [appel.vers, appel.montant]) };
    else if (appel.type === "frapper") tx = { to: await this.jetons.XAFe.getAddress(), data: IFACE.encodeFunctionData("frapper", [appel.vers, appel.montant, appel.empreinte]) };
    else if (appel.type === "frapperReserve") tx = { to: await this.jetons.XAFe.getAddress(), data: IFACE.encodeFunctionData("frapperReserve", [appel.montant, appel.empreinte]) };
    else if (appel.type === "detruireReserve") tx = { to: await this.jetons.XAFe.getAddress(), data: IFACE.encodeFunctionData("detruireReserve", [appel.montant, appel.empreinte]) };
    else tx = { to: await this.jetons.XAFe.getAddress(), data: IFACE.encodeFunctionData("detruireDepot", [appel.adresse, appel.montant, appel.empreinte]) };
    const pret = await p.populateTransaction({ ...tx, nonce: await this.fournisseur.getTransactionCount(p.address, "pending") });
    const brut = await p.signTransaction(pret);
    return { hash: Transaction.from(brut).hash!, brut };
  }

  async diffuser(brut: string) {
    await this.fournisseur.broadcastTransaction(brut).catch((e) => { if (!/already known|nonce too low|known transaction/i.test(String(e))) throw e; });
  }

  async recu(hash: string) {
    const r = await this.fournisseur.getTransactionReceipt(hash);
    return r ? { bloc: r.blockNumber, ok: r.status === 1 } : null;
  }

  /** son nonce a servi, dans un bloc assez confirmé, à une AUTRE transaction : la nôtre ne passera plus jamais */
  async perimee(hash: string, brut: string) {
    const t = Transaction.from(brut);
    const confirme = (await this.tete()) - this.confirmations + 1;
    if (confirme < 0) return false;
    const pris = await this.fournisseur.getTransactionCount(t.from!, confirme);
    if (t.nonce >= pris) return false;
    return (await this.recu(hash)) === null;
  }
}
