import assert from "node:assert/strict";
import { test } from "node:test";
import { achatMax, decouperSortie, fraisOrdre, nombreDeTransferts, prixValide, quantiteValide, simulerMarche } from "./argent.ts";
import { lisible } from "./erreurs.ts";
import { apresFrappe, enTranches, jourRelatif, numeroEnTranches, numeroSaisi, operateurDuNumero, prix, signe, usdt } from "./format.ts";

test("un montant se lit en tranches", () => {
  assert.equal(enTranches(1000000), "1 000 000");
  assert.equal(enTranches(2608.05, 2), "2 608,05");
  assert.equal(enTranches(0), "0");
  assert.equal(prix(618.4), "618,40");
  assert.equal(usdt(1500), "1 500");
  assert.equal(usdt(299.7), "299,70");
  assert.equal(signe(-500000), "−500 000");
  assert.equal(signe(1000000), "+1 000 000");
});

test("un numéro se lit en tranches et part nu", () => {
  assert.equal(numeroEnTranches("677123456"), "6 77 12 34 56");
  assert.equal(numeroEnTranches("+237 6 77 12 34 56"), "6 77 12 34 56");
  assert.equal(numeroEnTranches("677"), "6 77");
  assert.equal(numeroSaisi("+237 677 12 34 56"), "677123456");
  assert.equal(operateurDuNumero("677123456"), "mtn");
  assert.equal(operateurDuNumero("699123456"), "om");
  assert.equal(operateurDuNumero("655111111"), "om");
  assert.equal(operateurDuNumero("650000000"), "mtn");
});

test("le pavé n'accepte que des chiffres et efface", () => {
  assert.equal(apresFrappe("", "0"), "0");
  assert.equal(apresFrappe("0", "5"), "5");
  assert.equal(apresFrappe("12", "000"), "12000");
  assert.equal(apresFrappe("12000", "⌫"), "1200");
  assert.equal(apresFrappe("1234567890", "1"), "1234567890");
});

test("le découpage d'une sortie est celui du moteur", () => {
  // 1 500 000 par MTN : deux transferts de 750 000, frais 3 750 chacun → 746 250 chacun
  const d = decouperSortie(1_500_000, 1_000_000);
  assert.equal(d.transferts.length, 2);
  assert.deepEqual(d.transferts[0], { montant: 750_000, frais: 3_750, envoi: 746_250 });
  assert.equal(d.frais, 7_500);
  assert.equal(d.envoi, 1_492_500);
  // 500 000 par MTN : un seul, frais 2 500 → 497 500
  assert.equal(decouperSortie(500_000, 1_000_000).envoi, 497_500);
  // 1 000 001 par OM : trois transferts, le reste sur le dernier
  const o = decouperSortie(1_000_001, 500_000);
  assert.equal(o.transferts.length, 3);
  assert.equal(o.transferts.reduce((s, t) => s + t.montant, 0), 1_000_001);
  assert.equal(nombreDeTransferts(3_000_000, 1_000_000), 3);
  assert.equal(nombreDeTransferts(0, 1_000_000), 0);
});

test("les règles du carnet sont celles du moteur", () => {
  assert.ok(prixValide(618.4));
  assert.ok(!prixValide(618.41));
  assert.ok(quantiteValide(10));
  assert.ok(!quantiteValide(5));
  assert.ok(!quantiteValide(10.123));
  assert.equal(achatMax(3_000_000, 618.4), 4851.22);
  assert.deepEqual(fraisOrdre("achat", 1500, 618.4), { montant: 1.5, actif: "USDT" });
  assert.deepEqual(fraisOrdre("vente", 1500, 618.4), { montant: 928, actif: "XAFe" });
});

test("un achat au marché s'arrête à ce que les XAFe paient", () => {
  const livre = [
    { prix: 618.0, quantite: 98.75 },
    { prix: 619.0, quantite: 1000 },
  ];
  const r = simulerMarche("achat", 98.75, livre, 50_000);
  assert.equal(r.quantite, 80.9);
  assert.equal(r.complet, false);
  const t = simulerMarche("vente", 500, [{ prix: 619, quantite: 100 }, { prix: 618, quantite: 400 }]);
  assert.equal(t.quantite, 500);
  assert.equal(t.total, 100 * 619 + 400 * 618);
});

test("une erreur du moteur se dit en français", () => {
  assert.equal(lisible(new Error("solde insuffisant")).titre, "Le solde ne suffit pas");
  assert.equal(lisible(new Error("plafond du palier atteint")).recommencer, true);
  assert.equal(lisible(new TypeError("Failed to fetch")).recommencer, false);
  assert.equal(lisible(new Error("quelque chose d'inconnu")).suite, "quelque chose d'inconnu");
});

test("une date se lit dans la langue de l'écran", () => {
  const maintenant = new Date(2026, 9, 12, 14, 2);
  assert.equal(jourRelatif(new Date(2026, 9, 12, 9, 0), maintenant), "Aujourd'hui");
  assert.equal(jourRelatif(new Date(2026, 9, 11, 23, 0), maintenant), "Hier");
  assert.equal(jourRelatif(new Date(2026, 8, 30), maintenant), "30 sept.");
  assert.equal(jourRelatif(new Date(2025, 11, 25), maintenant), "25 déc. 2025");
});
