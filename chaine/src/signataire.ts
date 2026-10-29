/*
 * LES GESTES DE L'ADMIN, sur l'un et l'autre réseau : déployer un contrat,
 * donner un rôle, inscrire des adresses, envoyer de la monnaie native pour les
 * frais. Une clé qui n'est PAS celle du veilleur : en production, l'admin du
 * contrat XAFe est un wallet matériel, et ces gestes s'y signent ; sur un
 * réseau d'essai, la clé d'un wallet d'essai (ADMIN_CLE) suffit.
 *
 * Servent à la mise en service (mise-en-service.ts) et aux bancs d'épreuve.
 */
import { Contract, ContractFactory, Interface, JsonRpcProvider, Wallet } from "ethers";
import type { Reseau } from "./cles.ts";
import { adresseTron } from "./cles.ts";
import { ABI, NoeudTron, texteDeHex, vingtOctets, type TxTron } from "./tron.ts";

export type Artefact = { abi: unknown[]; bytecode: string; contractName?: string };

export interface Signataire {
  readonly reseau: Reseau;
  readonly adresse: string;
  /** déployer, attendre le bloc, rendre l'adresse du contrat */
  deployer(artefact: Artefact, types: string[], valeurs: unknown[]): Promise<string>;
  /** appeler une fonction qui écrit, attendre le bloc ; refusée par la chaîne → erreur */
  ecrire(contrat: string, signature: string, types: string[], valeurs: unknown[]): Promise<string>;
  /** lire (rien n'est signé) : les octets du résultat */
  lire(contrat: string, signature: string, types: string[], valeurs: unknown[]): Promise<string>;
  envoyerNatif(vers: string, montant: bigint): Promise<string>;
  soldeNatif(adresse?: string): Promise<bigint>;
  /** le numéro du dernier bloc (le départ de la lecture du jeton, noté au déploiement) */
  bloc(): Promise<number>;
  /** une adresse du réseau → les 20 octets qu'attend l'ABI (Tron : sans le 41) */
  pourAbi(adresse: string): string;
}

/* ------------------------------------------------------------------ EVM */
export function signataireEvm(rpcUrl: string, cle: string, reseau: Reseau = "bep20"): Signataire {
  const fournisseur = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true, pollingInterval: 300, cacheTimeout: -1 });
  const w = new Wallet(cle, fournisseur);
  const iface = (signature: string) => new Interface([`function ${signature}`]);
  const nom = (signature: string) => signature.slice(0, signature.indexOf("("));
  return {
    reseau,
    adresse: w.address,
    pourAbi: (a) => a,
    async deployer(artefact, _types, valeurs) {
      const c = await new ContractFactory(artefact.abi as never, artefact.bytecode, w).deploy(...valeurs) as unknown as Contract;
      await c.waitForDeployment();
      return c.getAddress();
    },
    async ecrire(contrat, signature, _types, valeurs) {
      const tx = await w.sendTransaction({ to: contrat, data: iface(signature).encodeFunctionData(nom(signature), valeurs) });
      const r = await tx.wait(1);
      if (!r || r.status !== 1) throw new Error(`${signature} refusé par la chaîne`);
      return tx.hash;
    },
    async lire(contrat, signature, _types, valeurs) {
      return fournisseur.call({ to: contrat, data: iface(signature).encodeFunctionData(nom(signature), valeurs) });
    },
    async envoyerNatif(vers, montant) {
      const tx = await w.sendTransaction({ to: vers, value: montant });
      await tx.wait(1);
      return tx.hash;
    },
    soldeNatif: (a) => fournisseur.getBalance(a ?? w.address),
    bloc: () => fournisseur.getBlockNumber(),
  };
}

/* ----------------------------------------------------------------- Tron */
export function signataireTron(noeudUrl: string, cle: string, cleApi?: string, attenteMs = 90_000): Signataire {
  const noeud = new NoeudTron(noeudUrl, cleApi);
  const cleHex = cle.startsWith("0x") ? cle : `0x${cle}`;
  const adresse = adresseTron(new Wallet(cleHex).address);
  const versAbi = (a: string) => {
    const x = vingtOctets(a);
    if (!x) throw new Error(`adresse Tron invalide : ${a}`);
    return x;
  };
  // une adresse dans les valeurs se donne au format Tron (T…) : l'ABI veut ses 20 octets
  const valeursAbi = (types: string[], valeurs: unknown[]) => valeurs.map((v, i) =>
    types[i] === "address" ? versAbi(String(v)) : types[i] === "address[]" ? (v as string[]).map(versAbi) : v);
  const signerEtAttendre = async (tx: TxTron) => {
    const { hash, brut } = await noeud.signer(tx, cleHex, 120);
    await noeud.diffuser(brut);
    const fin = Date.now() + attenteMs;
    while (Date.now() < fin) {
      const r = await noeud.recu(hash);
      if (r) {
        if (!r.ok) throw new Error(`transaction ${hash} refusée par la chaîne (${r.info?.receipt?.result ?? r.info?.result ?? "?"} ${r.info?.resMessage ? texteDeHex(r.info.resMessage) : ""})`.trim());
        return r.info;
      }
      await new Promise((ok) => setTimeout(ok, 500));
    }
    throw new Error(`transaction ${hash} toujours pas dans un bloc`);
  };
  return {
    reseau: "trc20",
    adresse,
    pourAbi: versAbi,
    async deployer(artefact, types, valeurs) {
      const tx = await noeud.api("/wallet/deploycontract", {
        owner_address: adresse, abi: JSON.stringify(artefact.abi), bytecode: artefact.bytecode.replace(/^0x/, ""),
        parameter: types.length ? ABI.encode(types, valeursAbi(types, valeurs)).slice(2) : "",
        fee_limit: 1_000_000_000, call_value: 0, consume_user_resource_percent: 100, origin_energy_limit: 10_000_000,
        name: artefact.contractName ?? "Contrat", visible: true,
      });
      // l'adresse du contrat découle de l'identifiant de la transaction, qui change avec l'échéance : on la lit au reçu
      const info = await signerEtAttendre(tx);
      if (!info.contract_address) throw new Error("tron : déploiement sans adresse de contrat");
      return adresseTron(`0x${String(info.contract_address).slice(-40)}`);
    },
    async ecrire(contrat, signature, types, valeurs) {
      const info = await signerEtAttendre(await noeud.fabriquerAppel(adresse, contrat, signature, types, valeursAbi(types, valeurs), 1_000_000_000));
      return String(info.id);
    },
    lire: (contrat, signature, types, valeurs) => noeud.lire(adresse, contrat, signature, types, valeursAbi(types, valeurs)),
    async envoyerNatif(vers, montant) {
      const info = await signerEtAttendre(await noeud.api("/wallet/createtransaction", { owner_address: adresse, to_address: vers, amount: Number(montant), visible: true }));
      return String(info.id);
    },
    async soldeNatif(a) { return BigInt((await noeud.api("/wallet/getaccount", { address: a ?? adresse, visible: true })).balance ?? 0); },
    async bloc() { return (await noeud.tete()).numero; },
  };
}

/* --------------------------------------------- les gestes sur le contrat */
/** les rôles du wallet chaud — et lui seul les a */
export const ROLES = { FRAPPEUR: "FRAPPEUR_ROLE", DESTRUCTEUR: "DESTRUCTEUR_ROLE" } as const;
/** les rôles de garde : arrêter (sans pouvoir reprendre) et geler — le wallet du propriétaire, jamais le chaud */
export const ROLES_DE_GARDE = { PAUSEUR: "PAUSEUR_ROLE", GELEUR: "GELEUR_ROLE" } as const;
/** inscrire d'avance des adresses de dépôt NEUVES : la clé de mise en service, le temps du stock, puis elle renonce */
export const INSCRIPTEUR = "INSCRIPTEUR_ROLE";

export async function role(s: Signataire, xafe: string, nom: string): Promise<string> {
  return s.lire(xafe, `${nom}()`, [], []);
}
export async function aLeRole(s: Signataire, xafe: string, nom: string, qui: string): Promise<boolean> {
  return BigInt(await s.lire(xafe, "hasRole(bytes32,address)", ["bytes32", "address"], [await role(s, xafe, nom), qui])) === 1n;
}
/** donner FRAPPEUR et DESTRUCTEUR au wallet chaud (ce qui manque seulement) */
export async function donnerLesRoles(s: Signataire, xafe: string, chaud: string): Promise<string[]> {
  const donnes: string[] = [];
  for (const nom of Object.values(ROLES)) {
    if (await aLeRole(s, xafe, nom, chaud)) continue;
    await s.ecrire(xafe, "grantRole(bytes32,address)", ["bytes32", "address"], [await role(s, xafe, nom), chaud]);
    donnes.push(nom);
  }
  return donnes;
}
/**
 * RÉSEAU D'ESSAI SEULEMENT : le plafond de frappe du jour que le propriétaire
 * a fixé — 100 milliards de XAFe (« mets à 100 milliards »). Un dépôt de
 * 80 000 000 restait « bientôt sur la blockchain » : le contrat d'essai avait
 * été déployé à 50 000 000 par jour. En production, le plafond se règle depuis
 * le wallet matériel de l'admin, jamais d'ici. Rend vrai s'il a fallu l'écrire.
 */
export const PLAFOND_JOUR_ESSAI_XAFE = 100_000_000_000n;
export async function fixerLePlafondDEssai(s: Signataire, xafe: string, plafondXafe = PLAFOND_JOUR_ESSAI_XAFE): Promise<boolean> {
  const voulu = plafondXafe * 1_000_000n;
  if (BigInt(await s.lire(xafe, "plafondJour()", [], [])) === voulu) return false;
  await s.ecrire(xafe, "fixerPlafondJour(uint256)", ["uint256"], [voulu]);
  return true;
}
/**
 * L'INSCRIPTEUR inscrit d'avance un stock d'adresses de dépôt NEUVES (le contrat
 * refuse une adresse qui porte déjà des XAFe, et ne permet pas d'en retirer).
 * Celles déjà inscrites sont sautées. Rend combien ont été inscrites.
 */
export async function preinscrire(s: Signataire, xafe: string, adresses: string[], lot = s.reseau === "trc20" ? 100 : 300): Promise<number> {
  const neuves: string[] = [];
  for (const a of adresses) {
    if (BigInt(await s.lire(xafe, "estAdresseDeDepot(address)", ["address"], [a])) !== 1n) neuves.push(a);
  }
  for (let i = 0; i < neuves.length; i += lot) {
    await s.ecrire(xafe, "inscrireAdressesNeuves(address[])", ["address[]"], [neuves.slice(i, i + lot)]);
  }
  return neuves.length;
}
/** renoncer à un rôle : la clé ne le tient plus, et ne peut pas se le redonner */
export async function renoncer(s: Signataire, xafe: string, nom: string) {
  await s.ecrire(xafe, "renounceRole(bytes32,address)", ["bytes32", "address"], [await role(s, xafe, nom), s.adresse]);
}
/** inscrire au registre du contrat les adresses de dépôt XAFe (le seul endroit où des XAFe se détruisent) — l'ADMIN */
export async function inscrire(s: Signataire, xafe: string, adresses: string[]) {
  for (let i = 0; i < adresses.length; i += 100) {
    await s.ecrire(xafe, "inscrireAdressesDeDepot(address[],bool)", ["address[]", "bool"], [adresses.slice(i, i + 100), true]);
  }
}
