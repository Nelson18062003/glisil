import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256 } from "ethers";
import { avecEcheance, vingtOctets } from "./tron.ts";

// Une vraie transaction Tron non signée (un envoi de 1 TRX), fabriquée par java-tron : ce n'est pas un secret.
const RAW = "0a0200d12208a5e12efa35370ccd40caf6fa9294345a67080112630a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412320a1541711693df6018a2cb6080a7e81d4b1e7648468d511215414a8a2d982d4dba5ef12c7a998dfc44663a30ffcc18c0843d7087e9c3fe9334";
const ECHEANCE = 1792114867018;
const TXID = "e62c5160be72a51fdfbc87b2108943ce0dab7abb18426871f12565871cf4c7da";

test("réécrire l'échéance à sa propre valeur rend les mêmes octets, donc le même identifiant", () => {
  assert.equal(sha256(`0x${RAW}`).slice(2), TXID, "l'identifiant est le sha256 des octets");
  assert.equal(avecEcheance(RAW, ECHEANCE), RAW);
});

test("une autre échéance ne change que le champ 8 : l'envoi, son montant et sa destination restent", () => {
  const autre = avecEcheance(RAW, ECHEANCE + 120_000);
  assert.notEqual(sha256(`0x${autre}`).slice(2), TXID, "nouvelle échéance, nouvel identifiant");
  assert.ok(autre.includes("0a1541711693df6018a2cb6080a7e81d4b1e7648468d51"), "le payeur reste");
  assert.ok(autre.includes("1215414a8a2d982d4dba5ef12c7a998dfc44663a30ffcc18c0843d"), "la destination et le montant (1 000 000 sun) restent");
  assert.equal(avecEcheance(autre, ECHEANCE), RAW, "et l'on revient exactement aux octets de départ");
});

test("des octets abîmés sont refusés, jamais signés à moitié", () => {
  assert.throws(() => avecEcheance(RAW.slice(0, -6), ECHEANCE));
  assert.throws(() => avecEcheance("0a0200d1", ECHEANCE), /sans échéance/);
});

test("une adresse Tron n'est acceptée que si sa somme de contrôle est juste", () => {
  assert.match(vingtOctets("TPL66VK2gCXNCD7EJg9pgJRfqcRazjhUZY") ?? "", /^0x[0-9a-f]{40}$/);
  assert.equal(vingtOctets("TPL66VK2gCXNCD7EJg9pgJRfqcRazjhUZz"), null, "une lettre de travers");
  assert.equal(vingtOctets("0x92b9f0e0c5d4a1f58c3e6b5d1c4e0e7e4cf7b0f2"), null, "une adresse d'un autre réseau");
});
