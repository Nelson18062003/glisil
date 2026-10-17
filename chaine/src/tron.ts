/*
 * TRON (TRC20) : ce que le veilleur lui demande, par l'API HTTP d'un nœud
 * (TronGrid, ou le nôtre) — sans TronWeb.
 *
 *   · lire : l'interface compatible Ethereum du nœud (/jsonrpc, eth_getLogs) ;
 *     les adresses y sont les 20 octets, sans le 0x41 de Tron ;
 *   · signer : le nœud fabrique la transaction (/wallet/triggersmartcontract),
 *     on signe ICI son identifiant (sha256 de raw_data_hex) avec la clé dérivée,
 *     et on la diffuse (/wallet/broadcasttransaction) — la clé ne sort jamais ;
 *   · une transaction Tron a une ÉCHÉANCE (raw_data.expiration) : passée sans
 *     entrer dans un bloc, elle ne pourra plus jamais y entrer, et c'est le seul
 *     cas où l'on a le droit d'en signer une autre pour le même retrait.
 */
import { AbiCoder, decodeBase58, getBytes, hexlify, sha256, SigningKey, toBeHex, zeroPadValue } from "ethers";
import type { Actif, Appel, Chaine, JournalBrut, MouvementJeton, Transfert } from "./chaine.ts";
import { mouvementsDepuisJournaux, SUJETS } from "./chaine.ts";
import { adresseTron, CHAUD, deriver } from "./cles.ts";

export const ABI = AbiCoder.defaultAbiCoder();
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** Des octets en hexadécimal → le texte UTF-8 (sans Buffer : le même code tourne sous Node et sous Deno). */
export function texteDeHex(hex: string): string {
  return new TextDecoder().decode(getBytes(`0x${hex.replace(/^0x/, "")}`));
}

/** « T… » → les 20 octets (0x…), si la somme de contrôle est juste ; sinon null. */
export function vingtOctets(base58: string): string | null {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(base58)) return null;
  try {
    const hex = toBeHex(decodeBase58(base58), 25);
    if (!hex.startsWith("0x41")) return null;
    if (adresseTron(`0x${hex.slice(4, 44)}`) !== base58) return null;  // la somme de contrôle refaite doit être la même
    return `0x${hex.slice(4, 44)}`;
  } catch { return null; }
}

/* ------------------------------------------------- l'échéance, réécrite
 * Le nœud choisit l'échéance (60 s chez TronGrid, des heures ailleurs). C'est
 * elle qui décide combien de temps un retrait coupé reste bloqué avant qu'on
 * ait le droit d'en signer un autre : on la fixe nous-mêmes, dans les octets
 * de raw_data (protobuf, champ 8, entier) — et l'identifiant se refait, c'est
 * le sha256 de ces octets. */
function varint(o: Uint8Array, i: number): [bigint, number] {
  let v = 0n, d = 0n;
  for (;;) {
    if (i >= o.length) throw new Error("tron : raw_data tronqué");
    const b = o[i++]; v |= BigInt(b & 0x7f) << d; d += 7n;
    if (!(b & 0x80)) return [v, i];
  }
}
function enVarint(v: bigint): number[] {
  const o: number[] = [];
  do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; o.push(b); } while (v);
  return o;
}
export function avecEcheance(rawHex: string, echeance: number): string {
  const o = getBytes(`0x${rawHex}`);
  const sortie: number[] = [];
  let i = 0, posee = false;
  while (i < o.length) {
    const debut = i;
    const [cle, j] = varint(o, i); i = j;
    const champ = Number(cle >> 3n), type = Number(cle & 7n);
    if (type === 0) [, i] = varint(o, i);
    else if (type === 2) { const [n, k] = varint(o, i); i = k + Number(n); }
    else if (type === 1) i += 8;
    else if (type === 5) i += 4;
    else throw new Error(`tron : champ protobuf de type ${type} inattendu`);
    if (i > o.length) throw new Error("tron : raw_data tronqué");
    if (champ === 8) { if (type !== 0) throw new Error("tron : échéance illisible"); sortie.push(0x40, ...enVarint(BigInt(echeance))); posee = true; }
    else sortie.push(...o.slice(debut, i));
  }
  if (!posee) throw new Error("tron : raw_data sans échéance");
  return hexlify(new Uint8Array(sortie)).slice(2);
}

export type TxTron = { txID: string; raw_data: { expiration: number } & Record<string, unknown>; raw_data_hex: string; signature?: string[]; visible?: boolean; contract_address?: string };

/* ----------------------------------------------------------------- le nœud */
export class NoeudTron {
  readonly url: string;
  private cleApi?: string;
  constructor(url: string, cleApi?: string) { this.url = url.replace(/\/$/, ""); this.cleApi = cleApi; }

  async api(chemin: string, corps: unknown): Promise<any> {
    const r = await fetch(`${this.url}${chemin}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.cleApi ? { "TRON-PRO-API-KEY": this.cleApi } : {}) },
      body: JSON.stringify(corps),
    });
    if (!r.ok) throw new Error(`tron ${chemin} ${r.status}`);
    return r.json();
  }
  async jsonrpc(methode: string, params: unknown[]): Promise<any> {
    const j = await this.api("/jsonrpc", { jsonrpc: "2.0", id: 1, method: methode, params });
    if (j.error) throw new Error(`tron ${methode} : ${j.error.message}`);
    return j.result;
  }
  async tete(): Promise<{ numero: number; date: number }> {
    const b = await this.api("/wallet/getnowblock", {});
    return { numero: Number(b.block_header.raw_data.number), date: Number(b.block_header.raw_data.timestamp) };
  }
  /** une lecture de contrat (rien n'est signé) ; rend les octets du résultat */
  async lire(depuis: string, contrat: string, signature: string, types: string[], valeurs: unknown[]): Promise<string> {
    const r = await this.api("/wallet/triggerconstantcontract", {
      owner_address: depuis, contract_address: contrat, function_selector: signature,
      parameter: ABI.encode(types, valeurs).slice(2), visible: true,
    });
    if (!r.constant_result?.[0] || r.result?.result === false) throw new Error(`tron lecture ${signature} : ${JSON.stringify(r.result ?? r)}`);
    return `0x${r.constant_result[0]}`;
  }
  /** fabriquer (par le nœud) un appel de contrat, pas encore signé */
  async fabriquerAppel(depuis: string, contrat: string, signature: string, types: string[], valeurs: unknown[], plafondFrais: number): Promise<TxTron> {
    const r = await this.api("/wallet/triggersmartcontract", {
      owner_address: depuis, contract_address: contrat, function_selector: signature,
      parameter: ABI.encode(types, valeurs).slice(2), fee_limit: plafondFrais, call_value: 0, visible: true,
    });
    if (!r.result?.result || !r.transaction) throw new Error(`tron : ${signature} n'a pas été fabriqué (${JSON.stringify(r.result ?? r)})`);
    return r.transaction;
  }
  /** signer ici : l'échéance réécrite, l'identifiant refait, la clé ne sort pas */
  async signer(tx: TxTron, clePrivee: string, echeanceSecondes: number): Promise<{ hash: string; brut: string }> {
    if (!tx?.txID) throw new Error(`tron : la transaction n'a pas été fabriquée (${JSON.stringify(tx)})`);
    // l'identifiant EST le sha256 de raw_data_hex : vérifié, un nœud menteur ne nous fait pas signer autre chose
    if (sha256(`0x${tx.raw_data_hex}`).slice(2) !== tx.txID) throw new Error("tron : identifiant de transaction incohérent");
    // l'échéance se compte depuis le bloc d'en tête — l'horloge de la chaîne, pas la nôtre
    const echeance = (await this.tete()).date + echeanceSecondes * 1000;
    const raw_data_hex = avecEcheance(tx.raw_data_hex, echeance);
    const txID = sha256(`0x${raw_data_hex}`).slice(2);
    const sig = new SigningKey(clePrivee).sign(`0x${txID}`);
    const signee = { ...tx, txID, raw_data: { ...tx.raw_data, expiration: echeance }, raw_data_hex, signature: [hexlify(getBytes(sig.serialized)).slice(2)] };
    return { hash: txID, brut: JSON.stringify(signee) };
  }
  async diffuser(brut: string) {
    const r = await this.api("/wallet/broadcasttransaction", JSON.parse(brut));
    if (r.result) return;
    if (r.code === "DUP_TRANSACTION_ERROR") return;  // déjà reçue : ce n'est pas une seconde
    // le message vient en hexadécimal chez TronGrid, en clair ailleurs
    const message = !r.message ? "" : /^([0-9a-f]{2})+$/i.test(r.message) ? texteDeHex(r.message) : String(r.message);
    throw new Error(`tron : diffusion refusée (${r.code ?? "?"} ${message})`);
  }
  async recu(hash: string): Promise<{ bloc: number; ok: boolean; info: any } | null> {
    const i = await this.api("/wallet/gettransactioninfobyid", { value: hash });
    if (!i || i.blockNumber === undefined) return null;
    const ok = i.result !== "FAILED" && (!i.receipt?.result || i.receipt.result === "SUCCESS");
    return { bloc: Number(i.blockNumber), ok, info: i };
  }
}

/* --------------------------------------------------------------- la chaîne */
export type ConfigTron = {
  noeud: string; usdt: string; xafe: string; confirmations: number; graine: string; cleApi?: string;
  /** le TRX qu'une transaction de contrat peut brûler au plus, en sun (défaut 100 TRX) */
  plafondFraisSun?: number;
  /** durée de vie d'une transaction signée, en secondes (défaut 120) : la NÔTRE, pas celle du nœud */
  echeanceSecondes?: number;
};

export class ChaineTron implements Chaine {
  readonly reseau = "trc20" as const;
  readonly confirmations: number;
  readonly chaud: string;
  readonly noeud: NoeudTron;
  decimales: Record<Actif, number> = { USDT: 6, XAFe: 6 };
  private graine: string;
  private c: ConfigTron;

  constructor(c: ConfigTron) {
    this.c = c;
    this.confirmations = c.confirmations;
    this.graine = c.graine;
    this.noeud = new NoeudTron(c.noeud, c.cleApi);
    this.chaud = deriver(c.graine, "trc20", CHAUD).adresse;
  }

  private contrat(actif: Actif) { return actif === "USDT" ? this.c.usdt : this.c.xafe; }
  private lire(contrat: string, signature: string, types: string[], valeurs: unknown[]) { return this.noeud.lire(this.chaud, contrat, signature, types, valeurs); }

  /* --------------------------------------------------------------- lire */
  async demarrer() {
    for (const a of ["USDT", "XAFe"] as Actif[]) this.decimales[a] = Number(BigInt(await this.lire(this.contrat(a), "decimals()", [], [])));
  }

  async tete() { return (await this.noeud.tete()).numero; }

  async transferts(actif: Actif, vers: string[], de: number, a: number): Promise<Transfert[]> {
    const vus: Transfert[] = [];
    const cibles = vers.map(vingtOctets).filter((x): x is string => x !== null).map((x) => zeroPadValue(x, 32));
    const contrat = vingtOctets(this.contrat(actif));
    for (let i = 0; i < cibles.length; i += 50) {
      for (let b = de; b <= a; b += 1000) {
        const journaux: any[] = await this.noeud.jsonrpc("eth_getLogs", [{ address: contrat, topics: [TRANSFER, null, cibles.slice(i, i + 50)], fromBlock: toBeHex(b), toBlock: toBeHex(Math.min(a, b + 999)) }]);
        for (const j of journaux ?? []) {
          if (String(j.topics?.[0]).toLowerCase() !== TRANSFER) continue;
          vus.push({ adresse: adresseTron(`0x${String(j.topics[2]).slice(-40)}`), brut: BigInt(j.data), preuve: `${String(j.transactionHash).replace(/^0x/, "")}:${Number(j.logIndex)}` });
        }
      }
    }
    return vus;
  }

  async solde(quoi: Actif | "natif", adresse: string) {
    if (quoi === "natif") return BigInt((await this.noeud.api("/wallet/getaccount", { address: adresse, visible: true })).balance ?? 0);
    return BigInt(await this.lire(this.contrat(quoi), "balanceOf(address)", ["address"], [vingtOctets(adresse)]));
  }
  async estAdresseDeDepot(adresse: string) {
    return BigInt(await this.lire(this.c.xafe, "estAdresseDeDepot(address)", ["address"], [vingtOctets(adresse)])) === 1n;
  }
  async dejaDetruit(empreinte: string) {
    return BigInt(await this.lire(this.c.xafe, "destructionReferencee(bytes32)", ["bytes32"], [empreinte])) === 1n;
  }
  async offreXafe() { return BigInt(await this.lire(this.c.xafe, "totalSupply()", [], [])); }

  /** l'interface Ethereum du nœud borne une lecture à 5 000 blocs */
  async mouvementsXafe(de: number, a: number): Promise<MouvementJeton[]> {
    const contrat = vingtOctets(this.c.xafe);
    const journaux: JournalBrut[] = [];
    for (let b = de; b <= a; b += 5000) {
      const lus: any[] = await this.noeud.jsonrpc("eth_getLogs", [{ address: contrat, topics: [Object.values(SUJETS)], fromBlock: toBeHex(b), toBlock: toBeHex(Math.min(a, b + 4999)) }]);
      for (const j of lus ?? []) {
        journaux.push({ tx: String(j.transactionHash).replace(/^0x/, ""), index: Number(j.logIndex), bloc: Number(j.blockNumber), topics: (j.topics ?? []).map((t: string) => `0x${String(t).replace(/^0x/, "")}`), data: `0x${String(j.data).replace(/^0x/, "") || "0"}` });
      }
    }
    return mouvementsDepuisJournaux(journaux, (x) => adresseTron(x));
  }

  /** le TRX que brûle un transfert de jeton depuis une adresse sans énergie : énergie × prix, plus la bande passante */
  async fraisJeton(actif: Actif, depuisIndice: number, vers: string, montant: bigint) {
    const depuis = deriver(this.graine, this.reseau, depuisIndice).adresse;
    const r = await this.noeud.api("/wallet/triggerconstantcontract", {
      owner_address: depuis, contract_address: this.contrat(actif), function_selector: "transfer(address,uint256)",
      parameter: ABI.encode(["address", "uint256"], [vingtOctets(vers), montant]).slice(2), visible: true,
    });
    const p = await this.noeud.api("/wallet/getchainparameters", {});
    const prix = BigInt((p.chainParameter ?? []).find((x: { key: string }) => x.key === "getEnergyFee")?.value ?? 420);
    return (BigInt(r.energy_used ?? 70_000) * prix * 13n) / 10n + 1_000_000n;  // +1 TRX : bande passante
  }

  adresseValable(adresse: string) { return vingtOctets(adresse) ? adresse : null; }

  /* -------------------------------------------------------------- signer */
  async signer(indice: number, appel: Appel) {
    const depuis = deriver(this.graine, this.reseau, indice);
    let tx: TxTron;
    if (appel.type === "natif") {
      tx = await this.noeud.api("/wallet/createtransaction", { owner_address: depuis.adresse, to_address: appel.vers, amount: Number(appel.montant), visible: true });
    } else {
      const [contrat, selecteur, types, valeurs] =
        appel.type === "jeton" ? [this.contrat(appel.actif), "transfer(address,uint256)", ["address", "uint256"], [vingtOctets(appel.vers), appel.montant]]
        : appel.type === "frapper" ? [this.c.xafe, "frapper(address,uint256,bytes32)", ["address", "uint256", "bytes32"], [vingtOctets(appel.vers), appel.montant, appel.empreinte]]
        : appel.type === "detruire" ? [this.c.xafe, "detruire(uint256,bytes32)", ["uint256", "bytes32"], [appel.montant, appel.empreinte]]
        : [this.c.xafe, "detruireDepot(address,uint256,bytes32)", ["address", "uint256", "bytes32"], [vingtOctets(appel.adresse), appel.montant, appel.empreinte]];
      tx = await this.noeud.fabriquerAppel(depuis.adresse, contrat as string, selecteur as string, types as string[], valeurs as unknown[], this.c.plafondFraisSun ?? 100_000_000);
    }
    return this.noeud.signer(tx, depuis.portefeuille.privateKey, this.c.echeanceSecondes ?? 120);
  }

  diffuser(brut: string) { return this.noeud.diffuser(brut); }
  recu(hash: string) { return this.noeud.recu(hash); }

  /** le dernier bloc confirmé est daté APRÈS l'échéance, et la transaction n'est dans aucun bloc */
  async perimee(hash: string, brut: string) {
    const echeance = Number((JSON.parse(brut) as TxTron).raw_data?.expiration ?? 0);
    const confirme = (await this.tete()) - this.confirmations + 1;
    if (!echeance || confirme < 0) return false;
    const b = await this.noeud.api("/wallet/getblockbynum", { num: confirme });
    const date = Number(b?.block_header?.raw_data?.timestamp ?? 0);
    if (!date || date <= echeance) return false;
    return (await this.recu(hash)) === null;
  }
}
