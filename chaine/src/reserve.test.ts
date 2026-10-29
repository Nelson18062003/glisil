import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak256, toUtf8Bytes } from "ethers";
import type { Appel, Chaine } from "./chaine.ts";
import { Veilleur } from "./veilleur.ts";

/* Une fausse chaîne et un faux moteur : ce que le veilleur signe, dans quel ordre, et ce qu'il note. */
function banc(liste: any[], { reserve = 10n ** 12n, chaudXafe = 0n, enPause = false, blocs = {} as Record<string, number> } = {}) {
  const signes: Appel[] = [];
  const appels: [string, any][] = [];
  const chaine = {
    reseau: "bep20", confirmations: 3, actifs: ["USDT", "XAFe"], decimales: { USDT: 18, XAFe: 6 }, chaud: "0xCHAUD", reserve: "0xRESERVE",
    tete: async () => 100,
    // le chaud ne tient rien ; la réserve se lit AU CONTRAT
    solde: async (_q: string, a: string) => (a === "0xRESERVE" ? reserve : chaudXafe),
    etatDuJeton: async () => ({ enPause, plafondJour: 10n ** 15n, resteDuJour: 10n ** 15n, reserve }),
    signer: async (_i: number, a: Appel) => { signes.push(a); return { hash: `0xtx${signes.length}`, brut: `brut${signes.length}` }; },
    diffuser: async () => {},
    recu: async (h: string) => (h in blocs ? { bloc: blocs[h], ok: true } : null),
    perimee: async () => false,
  } as unknown as Chaine;
  const rpc = async (nom: string, args: any) => {
    appels.push([nom, args]);
    if (nom === "chaine_reserve_a_jouer") return liste;
    return null;
  };
  const v = new Veilleur(chaine, { graine: "x", journal: () => {} });
  return { v, rpc, signes, appels };
}

test("un dépôt crédité est frappé DANS LE CONTRAT, sous l'empreinte de SA référence — jamais sur le chaud", async () => {
  const b = banc([{ id: 1, operation: "frapper", montant: 1000, reference: "XAFe-DP-000003", etat: "a_faire", tx_hash: null, tx_brut: null }]);
  await b.v.jouerReserve(b.rpc);
  assert.deepEqual(b.signes[0], { type: "frapperReserve", montant: 1_000_000_000n, empreinte: keccak256(toUtf8Bytes("XAFe-DP-000003")) });
  assert.deepEqual(b.appels.find(([n]) => n === "chaine_reserve_marquer_envoi")![1], { p_id: 1, p_tx_hash: "0xtx1", p_brut: "brut1" }, "noté avant d'être diffusé");
});

test("une opération à la fois : la suivante attend que la précédente soit dans un bloc ET confirmée", async () => {
  const liste = [
    { id: 1, operation: "frapper", montant: 1000, reference: "A", etat: "envoye", tx_hash: "0xvieux", tx_brut: "b" },
    { id: 2, operation: "detruire", montant: 500, reference: "B", etat: "a_faire", tx_hash: null, tx_brut: null },
  ];
  let b = banc(liste);  // pas encore dans un bloc
  await b.v.jouerReserve(b.rpc);
  assert.equal(b.signes.length, 0, "la destruction attend la frappe");
  b = banc(liste, { blocs: { "0xvieux": 99 } });  // dans un bloc, 2 confirmations sur 3
  await b.v.jouerReserve(b.rpc);
  assert.equal(b.signes.length, 0, "pas assez confirmée");
  b = banc(liste, { blocs: { "0xvieux": 97 } });  // 4 confirmations
  const r = await b.v.jouerReserve(b.rpc);
  assert.deepEqual(r, { frappees: 1, detruites: 0 });
  assert.deepEqual(b.appels.find(([n]) => n === "chaine_reserve_resultat")![1], { p_id: 1, p_ok: true, p_bloc: 97, p_resultat: "bloc 97" });
  assert.deepEqual(b.signes[0], { type: "detruireReserve", montant: 500_000_000n, empreinte: keccak256(toUtf8Bytes("B")) });
});

test("la destruction se compare à la réserve du CONTRAT, pas au chaud (qui ne tient rien)", async () => {
  const b = banc([{ id: 4, operation: "detruire", montant: 500, reference: "D", etat: "a_faire", tx_hash: null, tx_brut: null }], { reserve: 10n ** 12n, chaudXafe: 0n });
  await b.v.jouerReserve(b.rpc);
  assert.deepEqual(b.signes[0], { type: "detruireReserve", montant: 500_000_000n, empreinte: keccak256(toUtf8Bytes("D")) });
  assert.equal(b.v.alertes.length, 0);
});

test("contrat en pause : la réserve ne signe rien, et le dit", async () => {
  const b = banc([{ id: 5, operation: "frapper", montant: 10, reference: "E", etat: "a_faire", tx_hash: null, tx_brut: null }], { enPause: true });
  await b.v.jouerReserve(b.rpc);
  assert.equal(b.signes.length, 0);
  assert.match(b.v.alertes.join(" "), /en pause/);
});

test("détruire plus que la réserve n'en a : rien ne part, l'équipe est prévenue", async () => {
  const b = banc([{ id: 3, operation: "detruire", montant: 500, reference: "C", etat: "a_faire", tx_hash: null, tx_brut: null }], { reserve: 100n });
  await b.v.jouerReserve(b.rpc);
  assert.equal(b.signes.length, 0);
  assert.match(b.v.alertes.join(" "), /pas assez/);
});
