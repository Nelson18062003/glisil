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

test("en production, sans nœud dans la base : contrats et départ viennent quand même de la base, le nœud du secret", () => {
  // Témoin : l'ancien code (« if (!r || !r.noeud) return ») jetait tout le réseau — ni BEP20_XAFE ni BEP20_DEPART.
  const prod: ConfigurationMoteur = { essai: false, reseaux: { bep20: { xafe: "0xX", usdt: "0x55d398326f99059fF775485246999027B3197955", depart: 1 } } } as ConfigurationMoteur;
  const e = envDepuisConfiguration(prod, { BEP20_RPC: "https://n" });
  assert.equal(e.BEP20_XAFE, "0xX");
  assert.equal(e.BEP20_USDT, "0x55d398326f99059fF775485246999027B3197955");
  assert.equal(e.BEP20_DEPART, "1");
  assert.equal(e.BEP20_RPC, "https://n", "le nœud vient du secret de la fonction");
});

test("les clés du propriétaire (EVM_RPC_KEY, TRONGRID_KEY) donnent les nœuds des réseaux principaux — jamais en essai", () => {
  const prod: ConfigurationMoteur = { essai: false, reseaux: { bep20: { xafe: "0xX", usdt: "0xU", depart: 1 } } } as ConfigurationMoteur;
  const e = envDepuisConfiguration(prod, { EVM_RPC_KEY: "k", TRONGRID_KEY: "t" });
  assert.equal(e.BEP20_RPC, "https://bnb-mainnet.g.alchemy.com/v2/k");
  assert.equal(e.ERC20_RPC, "https://eth-mainnet.g.alchemy.com/v2/k");
  assert.equal(e.BEP20_BLOCS_PAR_REQUETE, "10", "l'offre gratuite d'Alchemy : dix blocs par lecture");
  assert.equal(e.BEP20_BLOCS_JETON_PAR_TOUR, "500");
  assert.equal(e.TRC20_NOEUD, "https://api.trongrid.io");
  assert.equal(e.TRC20_CLE_API, "t");
  // une adresse posée à la main passe avant, et son réglage avec
  const m = envDepuisConfiguration(prod, { EVM_RPC_KEY: "k", BEP20_RPC: "https://autre", BEP20_BLOCS_PAR_REQUETE: "2000" });
  assert.equal(m.BEP20_RPC, "https://autre");
  assert.equal(m.BEP20_BLOCS_PAR_REQUETE, "2000");
  // sur un réseau d'essai, jamais un nœud principal
  assert.equal(envDepuisConfiguration({ ...prod, essai: true }, { EVM_RPC_KEY: "k" }).BEP20_RPC, undefined);
});
