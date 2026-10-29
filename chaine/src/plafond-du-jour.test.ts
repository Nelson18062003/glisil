// Le plafond de frappe du jour, côté veilleur : un retrait XAFe qui n'y tient pas ATTEND
// (au lieu d'être refusé par le contrat, puis remboursé au client), et la file reste dans l'ordre.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Appel, Chaine } from "./chaine.ts";
import { Veilleur } from "./veilleur.ts";

const XAF = (n: number) => BigInt(n) * 1_000_000n;
type Ligne = { reference: string; actif: "USDT" | "XAFe"; montant: number; tx_hash?: string | null };

function banc(liste: Ligne[], { plafond = XAF(1000), reste = XAF(1000), enPause = false } = {}) {
  const signes: Appel[] = [];
  const chaine = {
    reseau: "bep20", confirmations: 3, decimales: { USDT: 6, XAFe: 6 }, chaud: "0xCHAUD", reserve: "0xRESERVE",
    tete: async () => 100,
    solde: async () => 10n ** 18n,
    etatDuJeton: async () => ({ enPause, plafondJour: plafond, resteDuJour: reste, reserve: 0n }),
    adresseValable: (a: string) => a,
    signer: async (_i: number, a: Appel) => { signes.push(a); return { hash: `0xtx${signes.length}`, brut: `brut${signes.length}` }; },
    diffuser: async () => {},
    recu: async () => null,
    perimee: async () => false,
  } as unknown as Chaine;
  const rpc = async (nom: string) => {
    if (nom === "chaine_retraits_a_envoyer") return liste.map((l) => ({ adresse: "0xclient", tx_brut: l.tx_hash ? "brut" : null, tx_hash: null, ...l }));
    return null;
  };
  const v = new Veilleur(chaine, { graine: "x", journal: () => {} });
  const montants = () => signes.map((s) => ("montant" in s ? s.montant : 0n));
  return { v, rpc, signes, montants };
}

test("un retrait XAFe qui ne tient pas dans le reste du jour attend, et retient les XAFe suivants ; les USDT partent", async () => {
  const b = banc([
    { reference: "A", actif: "XAFe", montant: 600 },
    { reference: "B", actif: "XAFe", montant: 600 },
    { reference: "C", actif: "XAFe", montant: 100 },
    { reference: "D", actif: "USDT", montant: 50 },
  ]);
  await b.v.envoyerRetraits(b.rpc);
  assert.deepEqual(b.montants(), [XAF(600), XAF(50)], "A part, B attend, C attend derrière B (file stricte), D (USDT) part");
  assert.equal(b.signes[0].type, "frapper");
  assert.match(b.v.alertes.join(" "), /retrait B attend le plafond du jour/);
});

test("un retrait plus grand que le plafond entier ne bloque pas la file", async () => {
  const b = banc([{ reference: "GROS", actif: "XAFe", montant: 5000 }, { reference: "PETIT", actif: "XAFe", montant: 10 }]);
  await b.v.envoyerRetraits(b.rpc);
  assert.deepEqual(b.montants(), [XAF(10)]);
  assert.match(b.v.alertes.join(" "), /GROS.*dépasse le plafond de frappe du jour/);
});

test("ce qui est déjà signé compte contre le reste, même pas encore miné", async () => {
  const b = banc([{ reference: "SIGNE", actif: "XAFe", montant: 900, tx_hash: "0xvieux" }, { reference: "NEUF", actif: "XAFe", montant: 200 }]);
  await b.v.envoyerRetraits(b.rpc);
  assert.equal(b.signes.length, 0, "1000 − 900 = 100 : les 200 attendent");
});

test("en pause, aucun retrait XAFe ne part ; les USDT oui", async () => {
  const b = banc([{ reference: "X", actif: "XAFe", montant: 1 }, { reference: "U", actif: "USDT", montant: 2 }], { enPause: true });
  await b.v.envoyerRetraits(b.rpc);
  assert.deepEqual(b.montants(), [XAF(2)]);
  assert.match(b.v.alertes.join(" "), /contrat est en pause/);
});
