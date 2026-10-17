import assert from "node:assert/strict";
import { test } from "node:test";
import { SigningKey, computeAddress } from "ethers";
import { readFileSync } from "node:fs";
import { adresseTron, deriver, estReseau, graineValide, RESEAUX, type Reseau } from "./cles.ts";
import { verifierLeRegistre } from "./service.ts";

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

test("chaque réseau EVM a son compte : BSC ne bouge pas, Base n'a jamais les adresses de BSC", () => {
  // le compte 0 : les adresses d'avant le registre, telles quelles (celles de Hardhat)
  assert.equal(deriver(ESSAI, "bep20", 0).adresse, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  const vues = new Set<string>();
  for (const r of Object.keys(RESEAUX) as Reseau[]) {
    for (const i of [0, 1, 2]) {
      const a = deriver(ESSAI, r, i).adresse.toLowerCase();
      assert.ok(!vues.has(a), `${r} n° ${i} reprend une adresse d'un autre réseau`);
      vues.add(a);
    }
  }
  assert.match(deriver(ESSAI, "base", 1).adresse, /^0x[0-9a-fA-F]{40}$/);
});

test("le registre du code et celui de la base (0018) disent la même famille et le même compte", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/0018_reseaux.sql", import.meta.url), "utf8");
  // les lignes du registre : ('id', 'nom', 'norme', 'famille', chain_id, compte_hd, …
  const lignes = [...sql.matchAll(/\('([a-z0-9]+)',\s*'[^']*',\s*'[^']*',\s*'(evm|tron|solana)',\s*(?:\d+|null),\s*(\d+),/g)];
  assert.ok(lignes.length >= 5, `le registre de la base se lit (${lignes.length} lignes)`);
  const base = new Map(lignes.map((m) => [m[1], { famille: m[2], compte: Number(m[3]) }]));
  for (const [id, f] of Object.entries(RESEAUX)) {
    assert.ok(base.has(id), `${id} est dans le code et pas dans la base`);
    assert.deepEqual(base.get(id), { famille: f.famille, compte: f.compte }, id);
  }
  // l'inverse : la base peut porter un réseau qu'aucun veilleur ne lit encore (Solana), jamais un réseau EVM ou Tron oublié du code
  for (const [id, b] of base) if (b.famille !== "solana") assert.ok(estReseau(id), `${id} est dans la base, le code ne sait pas le dériver`);
});

test("une famille ou un compte qui diffère entre la base et le code arrête le veilleur", () => {
  assert.doesNotThrow(() => verifierLeRegistre("base", { BASE_FAMILLE: "evm", BASE_COMPTE_HD: "2" }));
  assert.throws(() => verifierLeRegistre("base", { BASE_COMPTE_HD: "0" }), /compte de dérivation/);
  assert.throws(() => verifierLeRegistre("trc20", { TRC20_FAMILLE: "evm" }), /famille/);
});
