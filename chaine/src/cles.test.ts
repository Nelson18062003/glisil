import assert from "node:assert/strict";
import { test } from "node:test";
import { SigningKey, computeAddress } from "ethers";
import { adresseTron, deriver, graineValide } from "./cles.ts";

// La graine de test de Hardhat — PUBLIQUE, jamais pour de l'argent.
const ESSAI = "test test test test test test test test test test test junk";

test("une graine donne toujours les mêmes adresses, et ce sont celles des portefeuilles connus", () => {
  // les comptes que Hardhat dérive de la même graine, au même chemin
  assert.equal(deriver(ESSAI, "bep20", 0).adresse, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  assert.equal(deriver(ESSAI, "bep20", 1).adresse, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  assert.equal(deriver(ESSAI, "bep20", 7).adresse, deriver(ESSAI, "bep20", 7).adresse);
  assert.notEqual(deriver(ESSAI, "trc20", 1).adresse, adresseTron(deriver(ESSAI, "bep20", 1).adresse), "Tron a son propre chemin (195)");
});

test("une adresse Tron est celle que Tron calcule pour la même clé", () => {
  // vecteur publié par TronWeb : cette clé privée → TPL66VK2gCXNCD7EJg9pgJRfqcRazjhUZY
  const cle = "0xda146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0";
  assert.equal(adresseTron(computeAddress(new SigningKey(cle).publicKey)), "TPL66VK2gCXNCD7EJg9pgJRfqcRazjhUZY");
  assert.match(deriver(ESSAI, "trc20", 3).adresse, /^T[1-9A-HJ-NP-Za-km-z]{33}$/);
});

test("une graine abîmée est refusée", () => {
  assert.equal(graineValide(ESSAI), true);
  assert.equal(graineValide("test test test"), false);
  assert.throws(() => deriver(ESSAI, "bep20", -1));
});
