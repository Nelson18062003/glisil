import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak256, toBeHex, toUtf8Bytes, zeroPadValue } from "ethers";
import type { Chaine, JournalBrut, MouvementJeton } from "./chaine.ts";
import { mouvementsDepuisJournaux, SUJETS } from "./chaine.ts";
import { Veilleur } from "./veilleur.ts";

const ZERO = zeroPadValue("0x00", 32);
const A = zeroPadValue("0x00000000000000000000000000000000000000aa", 32);
const B = zeroPadValue("0x00000000000000000000000000000000000000bb", 32);
const montant = (n: bigint) => toBeHex(n, 32);
const E1 = keccak256(toUtf8Bytes("XAFe-DP-000003"));
const E2 = keccak256(toUtf8Bytes("XAFe-WD-000001"));
const j = (tx: string, index: number, topics: string[], data: string, bloc = 10): JournalBrut => ({ tx, index, bloc, topics, data });
const tel = (x: string) => x;

test("une frappe se lit sur le Transfer standard, et prend l'empreinte de SA transaction", () => {
  const m = mouvementsDepuisJournaux([
    j("0x1", 0, [SUJETS.transfert, ZERO, A], montant(1000n)),
    j("0x1", 1, [SUJETS.frappe, A, E1], montant(1000n)),
  ], tel);
  assert.deepEqual(m, [{ tx: "0x1", index: 0, bloc: 10, genre: "frappe", adresse: `0x${"0".repeat(38)}aa`, brut: 1000n, empreinte: E1.toLowerCase() }]);
});

test("un transfert d'un client à un autre ne change pas l'offre : il est écarté", () => {
  assert.deepEqual(mouvementsDepuisJournaux([j("0x2", 0, [SUJETS.transfert, A, B], montant(5n))], tel), []);
});

test("une frappe sans événement Frappe garde une empreinte nulle : personne ne saurait l'expliquer", () => {
  const m = mouvementsDepuisJournaux([j("0x3", 0, [SUJETS.transfert, ZERO, B], montant(7n))], tel);
  assert.equal(m[0].empreinte, null);
  // un Frappe d'une AUTRE transaction, ou d'un autre montant, ne la justifie pas
  const m2 = mouvementsDepuisJournaux([
    j("0x3", 0, [SUJETS.transfert, ZERO, B], montant(7n)),
    j("0x4", 0, [SUJETS.frappe, B, E1], montant(7n)),
    j("0x3", 1, [SUJETS.frappe, B, E2], montant(8n)),
  ], tel);
  assert.equal(m2[0].empreinte, null);
});

test("une destruction se marie à son Detruit ; un sceau ne sert qu'une fois", () => {
  const m = mouvementsDepuisJournaux([
    j("0x5", 0, [SUJETS.transfert, A, ZERO], montant(500n)),
    j("0x5", 1, [SUJETS.detruit, A, E2], montant(500n)),
    j("0x5", 2, [SUJETS.transfert, A, ZERO], montant(500n)),
  ], tel);
  assert.equal(m.length, 2);
  assert.equal(m[0].genre, "destruction");
  assert.equal(m[0].empreinte, E2.toLowerCase());
  assert.equal(m[1].empreinte, null, "le second Transfer n'a pas de sceau à lui");
  // un Frappe ne justifie jamais une destruction
  const m2 = mouvementsDepuisJournaux([j("0x6", 0, [SUJETS.transfert, A, ZERO], montant(9n)), j("0x6", 1, [SUJETS.frappe, A, E1], montant(9n))], tel);
  assert.equal(m2[0].empreinte, null);
});

/* La lecture du jeton par le veilleur, sur une fausse chaîne. */
function banc({ tete = 100, curseur = null as number | null, offre = 3_000_000_000n, reserve = 2_000_000_000n, apres = [] as MouvementJeton[] } = {}) {
  const lectures: [number, number][] = [];
  const appels: [string, any][] = [];
  const chaine = {
    reseau: "bep20", confirmations: 5, decimales: { USDT: 18, XAFe: 6 }, chaud: "0xCHAUD",
    tete: async () => tete,
    offreXafe: async () => offre,
    solde: async () => reserve,
    mouvementsXafe: async (de: number, a: number) => {
      lectures.push([de, a]);
      if (de > tete - 5 + 1) return apres;
      return [{ tx: "0xt", index: 0, bloc: de, genre: "frappe", adresse: "0xCHAUD", brut: 1_000_000_000n, empreinte: E1 }];
    },
  } as unknown as Chaine;
  const rpc = async (nom: string, args: any) => {
    appels.push([nom, args]);
    if (nom === "chaine_references_sans_empreinte") return ["XAFe-DP-000003"];
    if (nom === "chaine_curseur") return curseur;
    if (nom === "chaine_noter_mouvements") return args.p_mouvements.length;
    return null;
  };
  return { v: new Veilleur(chaine, { graine: "x", journal: () => {}, departJeton: 40, blocsJetonParTour: 1000 }), rpc, lectures, appels };
}

test("la lecture part du déploiement du contrat, et la base apprend l'empreinte de chaque référence", async () => {
  const b = banc();
  const r = await b.v.lireLeJeton(b.rpc);
  assert.deepEqual(b.lectures[0], [40, 96], "du bloc de déploiement jusqu'au dernier bloc assez confirmé");
  assert.deepEqual(b.appels.find(([n]) => n === "chaine_noter_empreintes")![1], { p_empreintes: [{ reference: "XAFe-DP-000003", empreinte: E1 }] });
  const notes = b.appels.find(([n]) => n === "chaine_noter_mouvements")![1];
  assert.equal(notes.p_jusqua, 96, "le curseur avance avec les mouvements, dans le même appel");
  assert.equal(notes.p_mouvements[0].montant, "1000.0");
  assert.equal(r.a_jour, true);
});

test("l'offre et la réserve se disent AU bloc lu : ce qui est arrivé après est retiré", async () => {
  const apres: MouvementJeton[] = [
    { tx: "0xn", index: 0, bloc: 98, genre: "frappe", adresse: "0xchaud", brut: 500_000_000n, empreinte: E2 },
    { tx: "0xm", index: 0, bloc: 99, genre: "frappe", adresse: "0xclient", brut: 100_000_000n, empreinte: E2 },
  ];
  const b = banc({ curseur: 90, apres });
  const r = await b.v.lireLeJeton(b.rpc);
  assert.equal(r.offre, "2400.0", "3000 lus à la tête, moins 600 frappés après le bloc lu");
  assert.equal(r.reserve, "1500.0", "la réserve ne perd que ce qui l'a touchée");
});

test("pendant le rattrapage, aucun total : un chiffre d'avant la fin de la lecture ne se compare à rien", async () => {
  const b = banc({ tete: 1_000_000 });
  const r = await b.v.lireLeJeton(b.rpc);
  assert.deepEqual(b.lectures, [[40, 1039]], "mille blocs par tour, pas plus");
  assert.equal(r.a_jour, false);
  assert.equal(r.offre, null);
});
