// L'USDC côté veilleur (livraison 2) : il se TRANSFÈRE comme l'USDT, il ne se frappe jamais ;
// un veilleur qui ne le porte pas le laisse attendre ; Tron ne le connaît pas.
// Témoin : l'envoi d'avant (« USDT ? transfert : frappe ») frappait des XAFe pour un retrait d'USDC.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Actif, Appel, Chaine } from "./chaine.ts";
import { estDollar } from "./chaine.ts";
import { veilleursDepuis } from "./service.ts";
import { ChaineTron } from "./tron.ts";
import { Veilleur } from "./veilleur.ts";

type Ligne = { reference: string; actif: Actif; montant: number };

function banc(liste: Ligne[], actifs: Actif[], soldes: Partial<Record<Actif | "natif", bigint>> = {}) {
  const signes: Appel[] = [];
  const lus: string[] = [];
  const chaine = {
    reseau: "bep20", confirmations: 3, actifs, decimales: { USDT: 18, USDC: 18, XAFe: 6 }, chaud: "0xCHAUD", reserve: "0xRESERVE",
    tete: async () => 100,
    solde: async (quoi: Actif | "natif") => { lus.push(quoi); return soldes[quoi] ?? 10n ** 24n; },
    etatDuJeton: async () => ({ enPause: false, plafondJour: 10n ** 18n, resteDuJour: 10n ** 18n, reserve: 0n }),
    adresseValable: (a: string) => a,
    signer: async (_i: number, a: Appel) => { signes.push(a); return { hash: `0xtx${signes.length}`, brut: `brut${signes.length}` }; },
    diffuser: async () => {},
    recu: async () => null,
    perimee: async () => false,
  } as unknown as Chaine;
  const rpc = async (nom: string) => {
    if (nom === "chaine_retraits_a_envoyer") return liste.map((l) => ({ adresse: "0xclient", tx_brut: null, tx_hash: null, ...l }));
    return null;
  };
  const alertes: string[] = [];
  const v = new Veilleur(chaine, { graine: "x", journal: (l) => { if (l.startsWith("ALERTE")) alertes.push(l); } });
  return { v, rpc, signes, lus, alertes };
}

test("un retrait d'USDC part en TRANSFERT d'USDC depuis le chaud — jamais en frappe de XAFe", async () => {
  const b = banc([{ reference: "XAFe-CR-000001", actif: "USDC", montant: 25.5 }], ["USDT", "USDC", "XAFe"]);
  const r = await b.v.envoyerRetraits(b.rpc);
  assert.equal(r.envoyes, 1);
  assert.equal(b.signes.length, 1);
  const a = b.signes[0];
  assert.equal(a.type, "jeton", "un dollar se transfère");
  assert.equal(a.type === "jeton" && a.actif, "USDC");
  assert.equal(a.type === "jeton" && a.montant, 25_500_000_000_000_000_000n, "18 décimales : celles de l'USDC de BNB Chain");
  assert.ok(b.lus.includes("USDC"), "le solde d'USDC du chaud est vérifié avant d'envoyer");
});

test("le chaud sans assez d'USDC : le retrait attend, l'alerte part, rien ne se signe", async () => {
  const b = banc([{ reference: "XAFe-CR-000002", actif: "USDC", montant: 10 }], ["USDT", "USDC", "XAFe"], { USDC: 1n });
  const r = await b.v.envoyerRetraits(b.rpc);
  assert.equal(r.envoyes, 0);
  assert.equal(b.signes.length, 0);
  assert.ok(b.alertes.some((l) => /pas assez d'USDC/.test(l)), b.alertes.join("\n"));
});

test("un veilleur sans le contrat USDC laisse le retrait d'USDC ATTENDRE : ni transfert d'un autre jeton, ni frappe", async () => {
  const b = banc([{ reference: "XAFe-CR-000003", actif: "USDC", montant: 10 }, { reference: "XAFe-CR-000004", actif: "USDT", montant: 3 }], ["USDT", "XAFe"]);
  const r = await b.v.envoyerRetraits(b.rpc);
  assert.equal(r.envoyes, 1, "l'USDT, lui, part");
  assert.deepEqual(b.signes.map((s) => s.type === "jeton" ? s.actif : s.type), ["USDT"]);
  assert.ok(b.alertes.some((l) => /XAFe-CR-000003.*USDC n'est pas configuré/.test(l)), b.alertes.join("\n"));
});

test("le témoin : l'envoi d'avant frappait des XAFe pour tout ce qui n'était pas de l'USDT", () => {
  const avant = (actif: Actif): Appel["type"] => (actif === "USDT" ? "jeton" : "frapper");
  const maintenant = (actif: Actif): Appel["type"] => (estDollar(actif) ? "jeton" : "frapper");
  assert.equal(avant("USDC"), "frapper", "le témoin doit montrer la faute");
  assert.equal(maintenant("USDC"), "jeton");
  assert.equal(maintenant("XAFe"), "frapper");
});

test("Tron ne porte pas l'USDC : ni dans ses actifs, ni par repli sur le contrat XAFe", async () => {
  const t = new ChaineTron({ noeud: "http://127.0.0.1:1", usdt: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", xafe: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", confirmations: 1,
                             graine: "test test test test test test test test test test test junk" });
  assert.deepEqual([...t.actifs], ["USDT", "XAFe"]);
  await assert.rejects(t.solde("USDC", t.chaud), /ne passe pas par Tron/);
});

test("un TRC20_USDC posé fait refuser le veilleur de Tron, plutôt que de lire un autre contrat", async () => {
  await assert.rejects(veilleursDepuis({ XAFE_GRAINE: "test test test test test test test test test test test junk", TRC20_NOEUD: "http://127.0.0.1:1",
                                         TRC20_USDT: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", TRC20_XAFE: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", TRC20_USDC: "TX" }),
                       /l'USDC ne passe pas par Tron/);
});
