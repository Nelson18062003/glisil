import assert from "node:assert/strict";
import { test } from "node:test";
import { envDepuisConfiguration, type ConfigurationMoteur } from "./service.ts";

const base: ConfigurationMoteur = {
  essai: true, jeton: "j".repeat(40), graine: "graine d'essai", admin_cle_essai: "0xadmin",
  bep20: { noeud: "https://bsc", usdt: "0xU", xafe: "0xX", confirmations: 3, froid: "0xF" },
  trc20: null,
};

test("sur un réseau d'essai, la base donne tout : nœud, contrats, froid, graine et clé admin d'essai", () => {
  const e = envDepuisConfiguration(base, {});
  assert.equal(e.BEP20_RPC, "https://bsc");
  assert.equal(e.BEP20_CONFIRMATIONS, "3");
  assert.equal(e.BEP20_FROID, "0xF");
  assert.equal(e.XAFE_GRAINE, "graine d'essai");
  assert.equal(e.BEP20_ADMIN_CLE_ESSAI, "0xadmin");
  assert.equal(e.TRC20_NOEUD, undefined, "un réseau non configuré reste absent");
});

test("en production, la base ne fournit JAMAIS la graine ni la clé admin : seul un secret de la fonction le peut", () => {
  const prod = { ...base, essai: false };
  const e = envDepuisConfiguration(prod, {});
  assert.equal(e.XAFE_GRAINE, undefined);
  assert.equal(e.BEP20_ADMIN_CLE_ESSAI, undefined);
  assert.equal(envDepuisConfiguration(prod, { XAFE_GRAINE: "la vraie" }).XAFE_GRAINE, "la vraie");
});

test("un secret de la fonction passe avant la base ; une variable vide ne l'efface pas", () => {
  const e = envDepuisConfiguration(base, { XAFE_GRAINE: "secret", BEP20_RPC: "" });
  assert.equal(e.XAFE_GRAINE, "secret");
  assert.equal(e.BEP20_RPC, "https://bsc");
});
