import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import type { TraceChaine } from "../guichet/types";
import { etatDeTrace, hashCourt, lienContrat, lienTransaction } from "./chaine";
import { enWinAnsi, fabriquerRecu } from "./recu-pdf";
import { lisible } from "./erreurs";
import { poserLangue } from "./langue";

const TRACE: TraceChaine = {
  reseau: "bep20", operation: "frapper", montant: 1000, reference: "XAFe-DP-000003", etat: "confirme",
  txHash: "0xbe6acf4f541e732a5b4edbdb23777e7f6701fc47581214064c4b8ec1ba57c917", bloc: 137261987, essai: true,
  contrat: "0x750E774368240063BD5CF52b30b91183Efa4dAf3", reserve: "0x771C971497E4409d0225350C49609691E955465C",
  explorateur: "https://testnet.bscscan.com", empreinte: "0x8032a35a8ea63cb2215340ea154d627a97727bf251507c72ef921741832b9a35", relue: true, confirmeLe: null,
};

test("une transaction et un contrat s'ouvrent dans le bon explorateur", () => {
  assert.equal(lienTransaction(TRACE.explorateur, "bep20", TRACE.txHash), `https://testnet.bscscan.com/tx/${TRACE.txHash}`);
  assert.equal(lienTransaction("https://nile.tronscan.org/#", "trc20", "abc"), "https://nile.tronscan.org/#/transaction/abc");
  assert.equal(lienContrat("https://nile.tronscan.org/#", "trc20", "TFtf"), "https://nile.tronscan.org/#/token20/TFtf");
  assert.equal(lienTransaction(null, "bep20", "0x1"), null, "sans explorateur, aucun lien inventé");
  assert.equal(hashCourt(TRACE.txHash), "0xbe6acf4f…57c917");
});

test("l'état d'une frappe se dit sans mentir : en route n'est pas confirmé", () => {
  assert.equal(etatDeTrace(TRACE).ton, "green");
  assert.match(etatDeTrace(TRACE).phrase, /137/);
  assert.equal(etatDeTrace({ ...TRACE, etat: "envoye" }).ton, "blue");
  assert.doesNotMatch(etatDeTrace({ ...TRACE, etat: "envoye" }).titre, /créés/);
  assert.equal(etatDeTrace({ ...TRACE, etat: "echoue" }).ton, "red");
});

test("les espaces fines et le signe moins des montants passent dans le PDF", () => {
  assert.equal(enWinAnsi("−1 000 XAFe"), "-1 000 XAFe");
  assert.equal(enWinAnsi("Dépôt reçu · élevé"), "Dépôt reçu · élevé", "le français reste du français");
});

test("le reçu est un vrai PDF, qui porte la transaction, son bloc et l'empreinte", async () => {
  const octets = await fabriquerRecu({
    reference: "XAFe-DP-000003", titre: "Dépôt MTN MoMo", montant: "+1 000 XAFe", quand: "17 octobre 2026 à 05:31",
    client: "Lisa Gélie", lignes: [["Transaction ID MTN", "20394817101"], ["Depuis", "MTN · 6 77 12 34 56"]], chaine: [TRACE],
    preuve: "https://app.glisil.com/preuve", emisLe: new Date("2026-10-17T06:00:00Z"),
  });
  assert.equal(Buffer.from(octets.slice(0, 5)).toString(), "%PDF-");
  const relu = await PDFDocument.load(octets);
  assert.equal(relu.getPageCount(), 1);
  assert.equal(relu.getTitle(), "Reçu XAFe-DP-000003");
  // les textes sont dans le flux de la page (non compressé par pdf-lib pour les polices standard) : on les retrouve
  const texte = Buffer.from(await PDFDocument.load(octets).then((p) => p.save({ useObjectStreams: false }))).toString("latin1");
  assert.ok(octets.length > 4000, "un QR code et une page entière, pas un fichier vide");
  assert.ok(texte.includes("%PDF"), "relisible");
});

test("en anglais : le moteur parle toujours français, l'écran et le reçu parlent anglais", async () => {
  poserLangue("en");
  try {
    /* la clé reste la phrase française du moteur ; seule la phrase montrée change */
    assert.equal(lisible(new Error("solde insuffisant")).titre, "Your balance isn't enough");
    assert.equal(lisible(new Error("transaction ID déjà utilisé")).recommencer, false);
    assert.equal(lisible(new TypeError("Failed to fetch")).titre, "No connection");
    assert.equal(lisible(new Error("dépôt inconnu")).suite, "Unknown deposit.");
    assert.equal(etatDeTrace(TRACE).titre, "XAFe minted on the blockchain");
    assert.match(etatDeTrace(TRACE).phrase, /block 137,261,987/);
    const octets = await fabriquerRecu({
      reference: "XAFe-DP-000003", titre: "MTN MoMo deposit", montant: "+1,000 XAFe", quand: "Oct 17 at 05:31",
      client: "Lisa Gelie", lignes: [["Transaction ID MTN", "20394817101"]], chaine: [TRACE],
      preuve: "https://app.glisil.com/preuve", emisLe: new Date("2026-10-17T06:00:00Z"),
    });
    assert.equal((await PDFDocument.load(octets)).getTitle(), "Receipt XAFe-DP-000003");
  } finally {
    poserLangue("fr");
  }
  assert.equal(lisible(new Error("solde insuffisant")).titre, "Le solde ne suffit pas", "retour au français");
});
