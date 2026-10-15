import assert from "node:assert/strict";
import { test } from "node:test";
import { achatMax, decouperSortie, fraisOrdre, nombreDeTransferts, prixValide, quantiteValide, simulerMarche } from "./argent.ts";
import { lisible } from "./erreurs.ts";
import { apresFrappe, enTranches, jourRelatif, numeroEnTranches, numeroSaisi, operateurDuNumero, pourcent, prix, signe, usdt } from "./format.ts";

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
  /* les phrases du moteur corrigé : chacune a ses trois lignes, aucune ne tombe sur « Ça n'a pas marché » */
  for (const phrase of ["compte désactivé", "transaction ID déjà utilisé", "transaction ID déjà déclaré", "trop de transaction ID en attente",
    "trop de transaction ID aujourd'hui", "retraits crypto pas encore ouverts", "aucun boîtier en ligne pour cet opérateur", "code secret déjà choisi",
    "code SMS incorrect", "code SMS expiré", "un code vient de partir", "trop de codes demandés pour ce numéro", "ce numéro est déjà sur un autre compte",
    "numéro invalide", "pièce invalide", "pas de cours de référence"]) {
    assert.notEqual(lisible(new Error(phrase)).titre, "Ça n'a pas marché", phrase);
  }
  assert.equal(lisible(new Error("compte désactivé")).recommencer, false);
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

test("les paramètres de l'équipe remplacent ceux de la migration, et une valeur abîmée ne passe pas", async () => {
  const a = await import("./argent.ts");
  // ce test touche des valeurs PARTAGÉES par tout le fichier : il les rend toutes en partant
  const avant = structuredClone({ FRAIS: a.FRAIS, MARCHE: a.MARCHE, FRAIS_CRYPTO: a.FRAIS_CRYPTO, CRYPTO: a.CRYPTO, PALIERS: a.PALIERS, OPERATEURS: a.OPERATEURS });
  assert.equal(a.appliquerParametres({
    frais: { placeur: 0.0005, preneur: 0.001, sortie: 0.01 },
    marche: { pas_prix: 0.1, quantite_min: "20" },
    paliers: { "0": { entree_jour: 300000, sortie_jour: 250000 }, "1": { entree_jour: "abîmé" }, "2": null },
    crypto: { frais: { USDT: 2, XAFe: 600 }, retraits_ouverts: false },
    operateurs: [{ id: "om", plafond_par_transfert: 750000, plafond_jour: 3000000 }, { id: "inconnu", plafond_par_transfert: 1 }],
  }), true);
  assert.equal(a.FRAIS.sortie, 0.01);
  assert.equal(pourcent(a.FRAIS.sortie), "1 %");
  assert.equal(pourcent(0.0005), "0,05 %");
  assert.equal(a.decouperSortie(100_000, 1_000_000).frais, 1_000, "l'écran annonce les frais que le moteur prendra");
  assert.equal(a.MARCHE.pasPrix, 0.1);
  assert.equal(a.MARCHE.quantiteMin, 20);
  assert.equal(a.PALIERS[0].sortieJour, 250_000);
  assert.equal(a.PALIERS[1].entreeJour, 5_000_000, "une valeur abîmée laisse la précédente");
  assert.equal(a.PALIERS[2].entreeJour, null);
  assert.equal(a.FRAIS_CRYPTO.USDT, 2);
  assert.equal(a.CRYPTO.retraitsOuverts, false);
  assert.equal(a.operateur("om").plafondParTransfert, 750_000);
  assert.equal(a.appliquerParametres({ frais: { sortie: 0.9 } }), true);
  assert.equal(a.FRAIS.sortie, 0.01, "des frais à 90 % ne s'affichent pas");
  assert.equal(a.appliquerParametres(null), false);
  Object.assign(a.FRAIS, avant.FRAIS); Object.assign(a.MARCHE, avant.MARCHE); Object.assign(a.FRAIS_CRYPTO, avant.FRAIS_CRYPTO);
  Object.assign(a.CRYPTO, avant.CRYPTO); Object.assign(a.PALIERS, avant.PALIERS);
  a.OPERATEURS.forEach((o, i) => Object.assign(o, avant.OPERATEURS[i]));
});


test("une intention garde sa clé jusqu'à réussir ; une autre intention a la sienne", async () => {
  const i = await import("./intention.ts");
  i.oublierToutesLesIntentions();
  const sortie = { montant: 50_000, numeroId: "n1" };
  const k1 = i.cleDeLIntention("wd", sortie);
  assert.equal(i.cleDeLIntention("wd", { numeroId: "n1", montant: 50_000 }), k1, "la même intention, champs dans un autre ordre : la même clé (revenir à l'écran du code n'en fabrique pas une neuve)");
  assert.notEqual(i.cleDeLIntention("wd", { montant: 60_000, numeroId: "n1" }), k1, "un autre montant est un autre geste");
  assert.notEqual(i.cleDeLIntention("ord", sortie), k1, "un ordre n'emprunte pas la clé d'une sortie");
  i.intentionAccomplie("wd", sortie);
  assert.notEqual(i.cleDeLIntention("wd", sortie), k1, "réussie, l'intention est oubliée : une seconde sortie identique voulue est un geste neuf");
});

test("quantités et prix se jugent au centime, comme le moteur, malgré le flottant", async () => {
  const a = await import("./argent.ts");
  for (const q of [19.99, 1.15 + 10, 10.29, 12.35, 10.1, 20.07, 33.33]) assert.equal(a.quantiteValide(q), true, `${q} a deux décimales : le moteur l'accepte`);
  for (const q of [10.123, 10.005, 9.99, NaN, Infinity]) assert.equal(a.quantiteValide(q), false, `${q} : le moteur le refuse`);
  for (const p of [618.4, 618.05, 600.1, 599.95]) assert.equal(a.prixValide(p), true, `${p}`);
  for (const p of [618.004, 618.01, 618.06, 0, -5]) assert.equal(a.prixValide(p), false, `${p}`);
});
