// Le plafond de frappe du jour, sur le réseau d'ESSAI : le chiffre du propriétaire, écrit une fois.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixerLePlafondDEssai, PLAFOND_JOUR_ESSAI_XAFE, type Signataire } from "./signataire.ts";

function faux(plafond: bigint) {
  const ecrits: unknown[][] = [];
  const s = {
    reseau: "bep20", adresse: "0xadmin",
    lire: async (_c: string, sig: string) => { assert.equal(sig, "plafondJour()"); return "0x" + plafond.toString(16); },
    ecrire: async (_c: string, sig: string, _t: string[], v: unknown[]) => { assert.equal(sig, "fixerPlafondJour(uint256)"); ecrits.push(v); plafond = v[0] as bigint; return "0xtx"; },
  } as unknown as Signataire;
  return { s, ecrits, plafond: () => plafond };
}

test("le plafond d'essai passe de 50 millions à 100 milliards, en unités du jeton (6 décimales)", async () => {
  const f = faux(50_000_000n * 1_000_000n);
  assert.equal(await fixerLePlafondDEssai(f.s, "0xjeton"), true);
  assert.deepEqual(f.ecrits, [[100_000_000_000n * 1_000_000n]]);
  assert.equal(PLAFOND_JOUR_ESSAI_XAFE, 100_000_000_000n);
});

test("déjà au bon chiffre : rien n'est signé (le veilleur passe chaque minute)", async () => {
  const f = faux(100_000_000_000n * 1_000_000n);
  assert.equal(await fixerLePlafondDEssai(f.s, "0xjeton"), false);
  assert.equal(f.ecrits.length, 0);
});
