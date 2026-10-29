import assert from "node:assert/strict";
import { test } from "node:test";
import { estReseauPrincipal, PLAFOND_PAR_DEFAUT_XAF, verifierLesOptions } from "./options-de-deploiement.ts";

const U = "0x55d398326f99059fF775485246999027B3197955";
const prod = { reseau: "bep20" as const, principal: true, production: true, admin: "0xA", pauseur: "0xP", geleur: "0xG", usdt: U };

test("un réseau principal se reconnaît : BSC 56 par l'identifiant, Tron par son nœud ; les réseaux d'essai non", () => {
  assert.equal(estReseauPrincipal("bep20", "https://x", 56), true);
  assert.equal(estReseauPrincipal("bep20", "https://x", 97n), false);
  assert.equal(estReseauPrincipal("trc20", "https://api.trongrid.io"), true);
  assert.equal(estReseauPrincipal("trc20", "https://nile.trongrid.io"), false);
});

test("sur un réseau principal, sans --production : refusé (témoin : l'ancien deployer signait avec la clé d'essai, admin compris)", () => {
  assert.match(verifierLesOptions({ reseau: "bep20", principal: true, production: false }).refus ?? "", /PRINCIPAL/);
});

test("--production exige l'admin, le pauseur, le geleur, l'USDT officiel — jamais l'USDT d'essai", () => {
  assert.equal(verifierLesOptions(prod).refus, null);
  assert.match(verifierLesOptions({ ...prod, admin: undefined }).refus ?? "", /--admin/);
  assert.match(verifierLesOptions({ ...prod, geleur: undefined }).refus ?? "", /--geleur/);
  assert.match(verifierLesOptions({ ...prod, usdtEssai: true }).refus ?? "", /USDT d'essai/);
  assert.match(verifierLesOptions({ ...prod, usdt: "0xAutre" }).refus ?? "", /officiel/);
});

test("le plafond par défaut est d'un milliard de XAF par jour ; un plafond se donne en entier positif", () => {
  assert.equal(verifierLesOptions(prod).plafondXaf, PLAFOND_PAR_DEFAUT_XAF);
  assert.equal(PLAFOND_PAR_DEFAUT_XAF, 1_000_000_000n);
  assert.equal(verifierLesOptions({ ...prod, plafond: "2500000000" }).plafondXaf, 2_500_000_000n);
  assert.match(verifierLesOptions({ ...prod, plafond: "-1" }).refus ?? "", /--plafond/);
  assert.match(verifierLesOptions({ ...prod, plafond: "1e9" }).refus ?? "", /--plafond/);
});
