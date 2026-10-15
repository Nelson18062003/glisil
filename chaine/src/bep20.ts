/*
 * LA BNB SMART CHAIN, pour le veilleur : lire les dépôts, envoyer les retraits,
 * balayer les adresses de dépôt vers le wallet chaud.
 *
 * Trois règles, qui viennent toutes de la même crainte — l'argent qui part
 * deux fois, ou qui n'arrive jamais au compte :
 *   1. un dépôt n'est crédité qu'après `confirmations` blocs, et sa preuve
 *      (« hash:index du journal ») le rend unique : relu, il ne crédite pas
 *      deux fois ;
 *   2. un retrait est SIGNÉ, puis noté au moteur (hash + transaction brute),
 *      PUIS diffusé : après une coupure, c'est la même transaction qu'on
 *      rediffuse, jamais une seconde ;
 *   3. des XAFe rendus sur l'adresse de dépôt d'un client sont DÉTRUITS sur la
 *      chaîne avant d'être crédités : la circulation ne compte jamais deux
 *      fois le même XAFe.
 */
import { Contract, formatUnits, getAddress, HDNodeWallet, Interface, JsonRpcProvider, keccak256, parseUnits, toUtf8Bytes, Transaction, zeroPadValue, type TransactionRequest } from "ethers";
import { CHAUD, deriver } from "./cles.ts";
import type { Rpc } from "./moteur.ts";

const ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 montant) returns (bool)",
  "function frapper(address vers, uint256 montant, bytes32 empreinte)",
  "function detruireDepot(address adresse, uint256 montant, bytes32 empreinte)",
  "function estAdresseDeDepot(address) view returns (bool)",
  "function totalSupply() view returns (uint256)",
];
const ERC20 = new Interface(ABI);
const TRANSFER = ERC20.getEvent("Transfer")!.topicHash;

export type Actif = "USDT" | "XAFe";
export type Config = {
  rpcUrl: string;
  usdt: string;
  xafe: string;
  confirmations: number;
  graine: string;
  /** combien d'adresses libres garder prêtes, par actif */
  reserve?: number;
  /** au-delà de ce solde (en USDT), une adresse de dépôt est balayée vers le chaud */
  seuilBalayage?: number;
  journal?: (ligne: string) => void;
  /** pour l'épreuve : ce qui se passe entre la signature notée et la diffusion */
  apresSignature?: (reference: string) => void;
};
type Attribuee = { adresse: string; actif: Actif; indice: number; compte_id: string };
type Retrait = { reference: string; actif: Actif; adresse: string; montant: number; tx_hash: string | null; tx_brut: string | null };

/** Un montant de la chaîne en montant du moteur : deux décimales, arrondi vers le bas (le reste ne se crédite pas). */
export function versMoteur(brut: bigint, decimales: number): number {
  if (decimales <= 2) return Number(formatUnits(brut, decimales));
  const pas = 10n ** BigInt(decimales - 2);
  return Number(formatUnits(brut / pas, 2));
}

export class ChaineBep20 {
  readonly reseau = "bep20" as const;
  readonly fournisseur: JsonRpcProvider;
  readonly chaud: HDNodeWallet;
  readonly jetons: Record<Actif, Contract>;
  decimales: Record<Actif, number> = { USDT: 18, XAFe: 6 };
  private journal: (l: string) => void;

  readonly c: Config;

  constructor(c: Config) {
    this.c = c;
    // cacheTimeout -1 : ethers garde sinon 250 ms la réponse « pas de reçu », et un tour qui suit de près croit
    // jamais partie une transaction déjà minée — sur de l'argent, une réponse d'avant ne vaut rien
    this.fournisseur = new JsonRpcProvider(c.rpcUrl, undefined, { staticNetwork: true, pollingInterval: 500, cacheTimeout: -1 });
    this.chaud = deriver(c.graine, "bep20", CHAUD).portefeuille.connect(this.fournisseur);
    this.jetons = { USDT: new Contract(c.usdt, ABI, this.chaud), XAFe: new Contract(c.xafe, ABI, this.chaud) };
    this.journal = c.journal ?? ((l) => console.log(l));
  }

  async demarrer() {
    this.decimales = { USDT: Number(await this.jetons.USDT.decimals()), XAFe: Number(await this.jetons.XAFe.decimals()) };
  }

  /* -------------------------------------------------------- les adresses */

  /** Garder `reserve` adresses libres par actif. Les XAFe n'entrent que inscrites au contrat (par l'admin, hors ligne). */
  async preparerAdresses(rpc: Rpc): Promise<{ ajoutees: number; aInscrire: string[] }> {
    const etat = await rpc("chaine_adresses", { p_reseau: this.reseau });
    const reserve = this.c.reserve ?? 20;
    let indice = Number(etat.indice_max ?? 0);
    let ajoutees = 0;
    const aInscrire: string[] = [];
    for (const actif of ["USDT", "XAFe"] as Actif[]) {
      const manque = reserve - Number(etat.libres?.[actif] ?? 0);
      if (manque <= 0) continue;
      const lot: { adresse: string; indice: number }[] = [];
      for (let i = 0; i < manque; i++) {
        indice += 1;
        const { adresse } = deriver(this.c.graine, this.reseau, indice);
        if (actif === "XAFe" && !(await this.jetons.XAFe.estAdresseDeDepot(adresse))) { aInscrire.push(adresse); continue; }
        lot.push({ adresse, indice });
      }
      if (lot.length) ajoutees += Number(await rpc("chaine_ajouter_adresses", { p_actif: actif, p_reseau: this.reseau, p_adresses: lot }));
    }
    if (aInscrire.length) this.journal(`${aInscrire.length} adresse(s) XAFe attendent leur inscription au contrat par l'admin (chaine/inscrire.ts)`);
    return { ajoutees, aInscrire };
  }

  /* ----------------------------------------------------------- les dépôts */

  /** Les transferts entrants vers nos adresses, entre deux blocs, déjà assez confirmés. */
  async lireDepots(depuis: number, jusqua: number, attribuees: Attribuee[]) {
    const vus: { actif: Actif; adresse: string; brut: bigint; preuve: string }[] = [];
    for (const actif of ["USDT", "XAFe"] as Actif[]) {
      const miennes = attribuees.filter((a) => a.actif === actif && /^0x[0-9a-fA-F]{40}$/.test(a.adresse)).map((a) => a.adresse.toLowerCase());
      for (let i = 0; i < miennes.length; i += 50) {
        const vers = miennes.slice(i, i + 50).map((a) => zeroPadValue(a, 32));
        for (let de = depuis; de <= jusqua; de += 2000) {
          const journaux = await this.fournisseur.getLogs({ address: await this.jetons[actif].getAddress(), topics: [TRANSFER, null, vers], fromBlock: de, toBlock: Math.min(jusqua, de + 1999) });
          for (const j of journaux) {
            const e = ERC20.parseLog(j)!;
            vus.push({ actif, adresse: String(e.args.to), brut: BigInt(e.args.value), preuve: `${j.transactionHash}:${j.index}` });
          }
        }
      }
    }
    return vus;
  }

  /** Un tour de lecture : du curseur jusqu'au dernier bloc assez confirmé. Rend combien de dépôts ont été crédités. */
  async crediterDepots(rpc: Rpc): Promise<number> {
    const tete = await this.fournisseur.getBlockNumber();
    const jusqua = tete - this.c.confirmations + 1;
    const curseur = await rpc("chaine_curseur", { p_reseau: this.reseau });
    const depuis = curseur == null ? 0 : Number(curseur) + 1;
    if (jusqua < depuis) return 0;
    const { attribuees, reserve } = await rpc("chaine_adresses", { p_reseau: this.reseau });
    let credites = 0;
    for (const d of await this.lireDepots(depuis, jusqua, [...attribuees, ...(reserve ?? [])])) {
      const montant = versMoteur(d.brut, this.decimales[d.actif]);
      if (montant <= 0) continue;
      try {
        // des XAFe ne se détruisent que sur une adresse attribuée : sur la réserve, ils restent, et l'alerte part
        if (d.actif === "XAFe" && attribuees.some((a: Attribuee) => a.adresse.toLowerCase() === d.adresse.toLowerCase())) await this.detruireRetour(d.adresse, d.brut, d.preuve);
        const r = await rpc("chaine_crediter_depot", { p_reseau: this.reseau, p_adresse: d.adresse, p_actif: d.actif, p_montant: montant, p_preuve: d.preuve });
        if (!r?.deja) { credites += 1; this.journal(`dépôt ${d.actif} crédité : ${montant} sur ${d.adresse} (${d.preuve})`); }
      } catch (e) {
        // une adresse de la réserve, jamais montrée à un client : on le dit fort, on ne crédite personne au hasard
        this.journal(`ALERTE dépôt non crédité : ${d.actif} ${montant} sur ${d.adresse} (${d.preuve}) — ${(e as Error).message}`);
      }
    }
    await rpc("chaine_curseur", { p_reseau: this.reseau, p_bloc: jusqua });
    return credites;
  }

  /** Des XAFe rendus : détruits LÀ où ils sont arrivés, sous la référence du dépôt. Déjà détruits : rien à refaire. */
  private async detruireRetour(adresse: string, brut: bigint, preuve: string) {
    const empreinte = keccak256(toUtf8Bytes(preuve));
    if (await this.dejaDetruit(empreinte)) return;
    await (await this.jetons.XAFe.detruireDepot(adresse, brut, empreinte)).wait(1);
  }

  private async dejaDetruit(empreinte: string): Promise<boolean> {
    const c = new Contract(await this.jetons.XAFe.getAddress(), ["function destructionReferencee(bytes32) view returns (bool)"], this.fournisseur);
    return Boolean(await c.destructionReferencee(empreinte));
  }

  /* ---------------------------------------------------------- les retraits */

  /** Envoyer ce qui attend, reprendre ce qui a été signé, rendre compte de ce qui est confirmé. */
  async envoyerRetraits(rpc: Rpc): Promise<{ envoyes: number; confirmes: number; echoues: number }> {
    const bilan = { envoyes: 0, confirmes: 0, echoues: 0 };
    const liste: Retrait[] = await rpc("chaine_retraits_a_envoyer", { p_reseau: this.reseau });
    for (const r of liste) {
      // un retrait qui casse ne retient pas les autres : chacun le sien, l'erreur au journal
      try { await this.unRetrait(rpc, r, bilan); } catch (e) { this.journal(`retrait ${r.reference} : ${(e as Error).message}`); }
    }
    return bilan;
  }

  private async unRetrait(rpc: Rpc, r: Retrait, bilan: { envoyes: number; confirmes: number; echoues: number }) {
    {
      if (r.tx_hash) {
        const recu = await this.fournisseur.getTransactionReceipt(r.tx_hash);
        if (!recu) {
          this.journal(`retrait ${r.reference} : pas encore de reçu pour ${r.tx_hash}, rediffusion`);
          // signé et noté, peut-être jamais parti (coupure) : la MÊME transaction, rediffusée
          if (r.tx_brut) await this.fournisseur.broadcastTransaction(r.tx_brut).catch((e) => { if (!/already known|nonce too low|known transaction/i.test(String(e))) throw e; });
          return;
        }
        const confirmations = await recu.confirmations();
        if (confirmations < this.c.confirmations) { this.journal(`retrait ${r.reference} : ${confirmations} confirmation(s) sur ${this.c.confirmations}`); return; }
        await rpc("chaine_resultat_retrait", { p_reference: r.reference, p_ok: recu.status === 1, p_tx_hash: r.tx_hash, p_resultat: recu.status === 1 ? `bloc ${recu.blockNumber}` : "transaction refusée par la chaîne" });
        if (recu.status === 1) bilan.confirmes += 1; else bilan.echoues += 1;
        return;
      }
      /* une adresse dont la somme de contrôle est fausse est une faute de frappe : on n'envoie pas, l'argent revient */
      let vers: string;
      try { vers = getAddress(/^0x[0-9a-f]{40}$|^0x[0-9A-F]{40}$/.test(r.adresse) ? r.adresse.toLowerCase() : r.adresse); }
      catch {
        await rpc("chaine_resultat_retrait", { p_reference: r.reference, p_ok: false, p_tx_hash: null, p_resultat: "adresse invalide : la somme de contrôle ne correspond pas (faute de frappe ?)" });
        bilan.echoues += 1;
        this.journal(`retrait ${r.reference} refusé : adresse ${r.adresse} invalide, les fonds reviennent au client`);
        return;
      }
      const montant = parseUnits(String(r.montant), r.actif === "USDT" ? this.decimales.USDT : this.decimales.XAFe);
      if (r.actif === "USDT" && (await this.jetons.USDT.balanceOf(this.chaud.address)) < montant) {
        this.journal(`le wallet chaud n'a pas assez d'USDT pour ${r.reference} (${r.montant}) : il attend le balayage ou un réapprovisionnement`);
        return;
      }
      const appel: TransactionRequest = r.actif === "USDT"
        ? await this.jetons.USDT.transfer.populateTransaction(vers, montant)
        : await this.jetons.XAFe.frapper.populateTransaction(vers, montant, keccak256(toUtf8Bytes(r.reference)));
      const pret = await this.chaud.populateTransaction({ ...appel, nonce: await this.fournisseur.getTransactionCount(this.chaud.address, "pending") });
      const brut = await this.chaud.signTransaction(pret);
      const hash = Transaction.from(brut).hash!;
      await rpc("chaine_marquer_envoi", { p_reference: r.reference, p_tx_hash: hash, p_brut: brut });
      this.c.apresSignature?.(r.reference);
      await this.fournisseur.broadcastTransaction(brut);
      bilan.envoyes += 1;
      this.journal(`retrait ${r.reference} envoyé : ${r.montant} ${r.actif} vers ${r.adresse} (${hash})`);
    }
  }

  /* ------------------------------------------------------------ le balayage */

  /** Les USDT des adresses de dépôt rejoignent le wallet chaud (qui avance le gaz). */
  async balayer(rpc: Rpc): Promise<number> {
    const { attribuees } = await rpc("chaine_adresses", { p_reseau: this.reseau });
    const seuil = parseUnits(String(this.c.seuilBalayage ?? 50), this.decimales.USDT);
    let balayees = 0;
    for (const a of (attribuees as Attribuee[]).filter((x) => x.actif === "USDT" && x.indice != null)) {
      const solde: bigint = await this.jetons.USDT.balanceOf(a.adresse);
      if (solde < seuil) continue;
      const depot = deriver(this.c.graine, this.reseau, a.indice).portefeuille.connect(this.fournisseur);
      const usdt = this.jetons.USDT.connect(depot) as Contract;
      const gaz = (await usdt.transfer.estimateGas(this.chaud.address, solde)) * 12n / 10n;
      const prix = (await this.fournisseur.getFeeData()).gasPrice ?? 1_000_000_000n;
      const besoin = gaz * prix;
      const bnb = await this.fournisseur.getBalance(a.adresse);
      if (bnb < besoin) await (await this.chaud.sendTransaction({ to: a.adresse, value: besoin - bnb })).wait(1);
      await (await usdt.transfer(this.chaud.address, solde, { gasLimit: gaz, gasPrice: prix })).wait(1);
      balayees += 1;
      this.journal(`balayé : ${formatUnits(solde, this.decimales.USDT)} USDT de ${a.adresse} vers le wallet chaud`);
    }
    return balayees;
  }

  /** Ce que la plateforme tient sur la chaîne, adresse par adresse (le chaud et les dépôts). */
  async avoirs(rpc: Rpc): Promise<{ usdt: bigint; xafeEnCirculation: bigint }> {
    const { attribuees } = await rpc("chaine_adresses", { p_reseau: this.reseau });
    let usdt: bigint = await this.jetons.USDT.balanceOf(this.chaud.address);
    for (const a of (attribuees as Attribuee[]).filter((x) => x.actif === "USDT" && x.indice != null)) usdt += await this.jetons.USDT.balanceOf(a.adresse);
    return { usdt, xafeEnCirculation: await this.jetons.XAFe.totalSupply() };
  }
}
