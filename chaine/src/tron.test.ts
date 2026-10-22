import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { concat, getBytes, hexlify, id, Interface, Mnemonic, sha256 } from "ethers";
import { adresseTron } from "./cles.ts";
import { avecEcheance, ChaineTron, verifierCeQuOnSigne, vingtOctets } from "./tron.ts";

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

/* ------------------------------------------ ce que l'on signe, relu (revue du 22/10/2026) */
const PAYEUR = adresseTron("0x711693df6018a2cb6080a7e81d4b1e7648468d51");
const BENEFICIAIRE = adresseTron("0x4a8a2d982d4dba5ef12c7a998dfc44663a30ffcc");

test("un envoi de TRX n'est signé que s'il va au bon destinataire, pour le bon montant", () => {
  verifierCeQuOnSigne(RAW, { type: "natif", depuis: PAYEUR, vers: BENEFICIAIRE, montant: 1_000_000n });
  assert.throws(() => verifierCeQuOnSigne(RAW, { type: "natif", depuis: PAYEUR, vers: BENEFICIAIRE, montant: 10n }), /montant/);
  assert.throws(() => verifierCeQuOnSigne(RAW, { type: "natif", depuis: PAYEUR, vers: PAYEUR, montant: 1_000_000n }), /destinataire/);
  assert.throws(() => verifierCeQuOnSigne(RAW, { type: "natif", depuis: BENEFICIAIRE, vers: BENEFICIAIRE, montant: 1_000_000n }), /signataire/);
});

// un TriggerSmartContract fabriqué ici, octet par octet, comme le ferait java-tron
const vi = (v: bigint) => { const o: number[] = []; do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const oct = (n: number, b: Uint8Array) => [...vi(BigInt((n << 3) | 2)), ...vi(BigInt(b.length)), ...b];
const ent = (n: number, v: bigint) => [...vi(BigInt(n << 3)), ...vi(v)];
const t21 = (t: string) => getBytes(concat(["0x41", vingtOctets(t)!]));
function appelBrut(depuis: string, contrat: string, donnees: string, frais: bigint) {
  const trigger = new Uint8Array([...oct(1, t21(depuis)), ...oct(2, t21(contrat)), ...oct(4, getBytes(donnees))]);
  const any = new Uint8Array([...oct(1, new TextEncoder().encode("type.googleapis.com/protocol.TriggerSmartContract")), ...oct(2, trigger)]);
  const c = new Uint8Array([...ent(1, 31n), ...oct(2, any)]);
  return hexlify(new Uint8Array([...oct(1, getBytes("0x1234")), ...oct(4, getBytes("0x" + "00".repeat(8))), ...ent(8, 1n), ...oct(11, c), ...ent(18, frais)])).slice(2);
}

test("un nœud menteur ne fait pas signer un autre envoi que celui demandé", async () => {
  const graine = Mnemonic.fromEntropy(randomBytes(16)).phrase;   // jetable, jamais affichée
  const usdt = adresseTron("0x" + "a6".repeat(20)), client = adresseTron("0x" + "c1".repeat(20)), voleur = adresseTron("0x" + "be".repeat(20));
  const iface = new Interface(["function transfer(address,uint256)"]);
  let menteur = true, chaud = "";
  const vrai = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    const chemin = new URL(url).pathname, corps = JSON.parse(init.body);
    const rep = (j: unknown) => ({ ok: true, status: 200, json: async () => j }) as unknown as Response;
    if (chemin === "/wallet/getnowblock") return rep({ block_header: { raw_data: { number: 100, timestamp: Date.now() } } });
    if (chemin === "/wallet/triggersmartcontract") {
      const donnees = menteur ? iface.encodeFunctionData("transfer", [vingtOctets(voleur), 10n ** 12n])
                              : id(corps.function_selector).slice(0, 10) + corps.parameter;
      const raw_data_hex = appelBrut(chaud, usdt, donnees, BigInt(corps.fee_limit));
      return rep({ result: { result: true }, transaction: { txID: sha256("0x" + raw_data_hex).slice(2), raw_data: { expiration: 0 }, raw_data_hex, visible: true } });
    }
    throw new Error(`appel inattendu ${chemin}`);
  }) as typeof fetch;
  try {
    const ch = new ChaineTron({ noeud: "https://noeud.exemple", usdt, xafe: usdt, graine, confirmations: 20 });
    chaud = ch.chaud;
    await assert.rejects(ch.signer(0, { type: "jeton", actif: "USDT", vers: client, montant: 10_000_000n }), /ne fait pas ce qui a été demandé/,
                         "le transfert vers le voleur n'est jamais signé");
    menteur = false;   // le témoin : un nœud honnête, et la même demande se signe
    const { brut } = await ch.signer(0, { type: "jeton", actif: "USDT", vers: client, montant: 10_000_000n });
    assert.ok(JSON.parse(brut).signature?.length === 1);
  } finally { globalThis.fetch = vrai; }
});

test("des frais au-delà du plafond permis ne se signent pas", () => {
  const depuis = adresseTron("0x" + "11".repeat(20)), contrat = adresseTron("0x" + "a6".repeat(20));
  const donnees = "0xa9059cbb" + "00".repeat(64);
  verifierCeQuOnSigne(appelBrut(depuis, contrat, donnees, 100n), { type: "appel", depuis, contrat, donnees, plafondFrais: 100 });
  assert.throws(() => verifierCeQuOnSigne(appelBrut(depuis, contrat, donnees, 101n), { type: "appel", depuis, contrat, donnees, plafondFrais: 100 }), /frais/);
  assert.throws(() => verifierCeQuOnSigne(appelBrut(depuis, depuis, donnees, 1n), { type: "appel", depuis, contrat, donnees, plafondFrais: 100 }), /contrat/);
});
