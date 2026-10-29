import assert from "node:assert/strict";
import { test } from "node:test";
import { estReseauPrincipal, PLAFOND_PAR_DEFAUT_XAF, verifierLesOptions } from "./options-de-deploiement.ts";

const U = "0x55d398326f99059fF775485246999027B3197955";
const C = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const prod = { reseau: "bep20" as const, principal: true, production: true, admin: "0xA", pauseur: "0xP", geleur: "0xG", usdt: U, usdc: C };

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

test("--production sur BNB Chain et Ethereum exige aussi l'USDC officiel ; Tron refuse tout USDC", () => {
  assert.match(verifierLesOptions({ ...prod, usdc: undefined }).refus ?? "", /--usdc doit être l'USDC officiel/);
  assert.match(verifierLesOptions({ ...prod, usdc: "0xAutre" }).refus ?? "", /USDC officiel/);
  assert.match(verifierLesOptions({ ...prod, usdcEssai: true }).refus ?? "", /USDC d'essai/);
  const eth = { ...prod, reseau: "erc20" as const, usdt: "0xdAC17F958D2ee523a2206206994597C13D831ec7", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" };
  assert.equal(verifierLesOptions(eth).refus, null);
  const tron = { ...prod, reseau: "trc20" as const, usdt: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", usdc: undefined };
  assert.equal(verifierLesOptions(tron).refus, null, "Tron se déploie sans USDC");
  assert.match(verifierLesOptions({ ...tron, usdc: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8" }).refus ?? "", /ne passe pas par ce réseau/);
  assert.match(verifierLesOptions({ reseau: "trc20", principal: false, production: false, usdcEssai: true }).refus ?? "", /ne passe pas/);
});
