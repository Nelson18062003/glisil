import assert from "node:assert/strict";
import { test } from "node:test";
import { achatMax, bandeDePrix, decouperSortie, fraisOrdre, nombreDeTransferts, OPERATEURS, prixValide, quantiteValide, raisonDuRefus, simulerMarche } from "./argent.ts";
import { lisible } from "./erreurs.ts";
import { apresFrappe, enTranches, jourRelatif, numeroDeDemo, numeroEnTranches, numeroSaisi, operateurDuNumero, pourcent, prix, signe, usdt } from "./format.ts";

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
  assert.equal(operateurDuNumero("600000005"), "mtn", "démo TOTEM, MTN");
  assert.equal(operateurDuNumero("600900005"), "om", "démo TOTEM, Orange");
  assert.equal(operateurDuNumero("600500005"), null, "hors des tranches de démo");
  assert.equal(numeroDeDemo("+237 600 00 00 05"), true);
  assert.equal(numeroDeDemo("600900005"), true);
  assert.equal(numeroDeDemo("677123456"), false, "un vrai numéro n'est pas de démo");
});

test("le pavé n'accepte que des chiffres et efface", () => {
  assert.equal(apresFrappe("", "0"), "0");
  assert.equal(apresFrappe("0", "5"), "5");
  assert.equal(apresFrappe("12", "000"), "12000");
  assert.equal(apresFrappe("12000", "⌫"), "1200");
  assert.equal(apresFrappe("1234567890", "1"), "1234567890");
});

test("sans plafond par transfert, un seul transfert, quel que soit le montant", () => {
  assert.equal(nombreDeTransferts(6_000_000, null), 1);
  assert.equal(decouperSortie(6_000_000, null).transferts.length, 1);
  assert.equal(OPERATEURS.every((o) => o.plafondParTransfert === null && o.plafondParJour === null), true, "aucun plafond par défaut");
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
  assert.ok(quantiteValide(5), "le minimum est en XAFe (0027), pas en USDT : 5 USDT est une quantité valable");
  assert.ok(quantiteValide(0.01));
  assert.ok(!quantiteValide(10.123));
  assert.ok(!quantiteValide(0.001));
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
  for (const phrase of ["compte désactivé", "compte en attente d'approbation", "retraits en pause après un changement de sécurité", "transaction ID déjà utilisé", "transaction ID déjà déclaré", "trop de transaction ID en attente",
    "trop de transaction ID aujourd'hui", "retraits crypto pas encore ouverts", "aucun boîtier en ligne pour cet opérateur",
    "adresse ou mot de passe incorrect", "adresse e-mail non confirmée", "cette adresse a déjà un compte", "cette adresse est déjà utilisée", "mot de passe trop faible",
    "choisissez un mot de passe différent", "confirmation par e-mail nécessaire", "trop de demandes : attendez une minute", "connexion Google annulée",
    "mot de passe à choisir", "double authentification requise", "codes de secours à noter", "confirmez avec votre application d'authentification",
    "code de secours incorrect", "trop d'essais", "aucun code de secours", "réessayez dans un instant", "code de l'application incorrect", "aucune application d'authentification",
    "vérifications verrouillées", "trop de vérifications demandées", "vérification inconnue", "vérification expirée", "vérification épuisée",
    "vérification remplacée par un code plus récent", "vérification déjà utilisée", "la vérification ne correspond pas à cette opération",
    "code de l'application d'authentification à saisir", "mot de passe incorrect", "code e-mail incorrect", "vérification du mot de passe indisponible", "opération inconnue",
    "code SMS incorrect", "code SMS expiré", "un code vient de partir", "trop de codes demandés pour ce numéro", "ce numéro est déjà sur un autre compte",
    "numéro invalide", "pièce invalide", "pas de cours de référence"]) {
    assert.notEqual(lisible(new Error(phrase)).titre, "Ça n'a pas marché", phrase);
  }
  assert.equal(lisible(new Error("compte désactivé")).recommencer, false);
  assert.equal(lisible(new Error("compte en attente d'approbation")).recommencer, false, "attendre l'équipe, pas réessayer");
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
  const avant = structuredClone({ FRAIS: a.FRAIS, MARCHE: a.MARCHE, MARCHES: a.MARCHES, FRAIS_CRYPTO: a.FRAIS_CRYPTO, CRYPTO: a.CRYPTO, PALIERS: a.PALIERS, OPERATEURS: a.OPERATEURS });
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
  assert.equal(a.PALIERS[1].entreeJour, null, "une valeur abîmée laisse la précédente (aucun plafond par défaut)");
  assert.equal(a.PALIERS[2].entreeJour, null);
  assert.equal(a.FRAIS_CRYPTO.USDT, 2);
  assert.equal(a.CRYPTO.retraitsOuverts, false);
  assert.equal(a.operateur("om").plafondParTransfert, 750_000);
  // le plafond retiré par l'équipe (0031) : null se pose, il n'est pas ignoré
  a.appliquerParametres({ operateurs: [{ id: "om", plafond_par_transfert: null, plafond_jour: null }] });
  assert.equal(a.operateur("om").plafondParTransfert, null);
  assert.equal(a.operateur("om").plafondParJour, null);
  assert.equal(a.appliquerParametres({ frais: { sortie: 0.9 } }), true);
  assert.equal(a.FRAIS.sortie, 0.01, "des frais à 90 % ne s'affichent pas");
  assert.equal(a.appliquerParametres(null), false);
  Object.assign(a.FRAIS, avant.FRAIS); Object.assign(a.MARCHE, avant.MARCHE); Object.assign(a.FRAIS_CRYPTO, avant.FRAIS_CRYPTO);
  for (const p of Object.keys(avant.MARCHES) as (keyof typeof avant.MARCHES)[]) Object.assign(a.MARCHES[p], avant.MARCHES[p]);
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
  for (const q of [10.123, 10.005, 0.001, NaN, Infinity]) assert.equal(a.quantiteValide(q), false, `${q} : le moteur le refuse`);
  for (const p of [618.4, 618.05, 600.1, 599.95]) assert.equal(a.prixValide(p), true, `${p}`);
  for (const p of [618.004, 618.01, 618.06, 0, -5]) assert.equal(a.prixValide(p), false, `${p}`);
});

test("le devis rapide est celui du moteur, au centime (mêmes chiffres que le scénario 11.24)", async () => {
  const { devisSurLeCarnet } = await import("./argent.ts");
  const ventes = [{ prix: 600, quantite: 100 }, { prix: 610, quantite: 50 }];
  // 70 000 XAFe, marge 1 % : 69 306,93 au carnet → 100 à 600 puis 15,25 à 610 = 69 302,50 ; payés 69 995,53
  const a = devisSurLeCarnet("achat", 70_000, ventes, 0.01, 10);
  assert.deepEqual(a && { q: a.quantite, c: a.cout, t: a.total }, { q: 115.25, c: 69_302.5, t: 69_995.53 });
  assert.ok(a!.total <= 70_000, "on ne paie jamais plus que ce qu'on a donné");
  // la vente : 50 USDT à 590 = 29 500 ; reçus 29 205
  const v = devisSurLeCarnet("vente", 50, [{ prix: 590, quantite: 80 }], 0.01, 10);
  assert.equal(v?.total, 29_205);
  assert.equal(devisSurLeCarnet("vente", 1_000, [{ prix: 590, quantite: 80 }], 0.01, 10), null, "pas assez d'acheteurs : pas de devis");
  assert.equal(devisSurLeCarnet("achat", 5_000, ventes, 0.01, 10), null, "moins que la quantité minimale : pas de devis");
});

test("le réseau se lit dans l'adresse, sans recouvrement", async () => {
  const { reseauDe } = await import("./argent");
  assert.equal(reseauDe("0x7908cf9242fb2018f3487908cf9242fb2018f348"), "bep20");
  assert.equal(reseauDe(" TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE "), "trc20");
  assert.equal(reseauDe("0x7908cf9242fb2018f3487908cf9242fb2018f34"), null, "un signe de moins");
  assert.equal(reseauDe("TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLS0"), null, "le 0 n'est pas en base58");
  assert.equal(reseauDe("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"), null, "une adresse Bitcoin n'est ni l'une ni l'autre");
});

test("les réseaux viennent du moteur : une adresse 0x vaut pour chaque réseau EVM ouvert, et l'écran ne choisit pas", async () => {
  const { appliquerParametres, reseauDe, reseauxPour, reseauxOuverts, infoReseau, nomsDesReseaux } = await import("./argent");
  const { lienTransaction, lienContrat, nomsReseau } = await import("./chaine");
  const bep20 = { id: "bep20", nom: "BNB Smart Chain", norme: "BEP20", famille: "evm", natif: "BNB", confirmations: 15, maison: true };
  const trc20 = { id: "trc20", nom: "Tron", norme: "TRC20", famille: "tron", natif: "TRX", confirmations: 20, maison: false };
  const base = { id: "base", nom: "Base", norme: "Base", famille: "evm", natif: "ETH", confirmations: 30, maison: false };
  const evm = "0x7908cf9242fb2018f3487908cf9242fb2018f348";
  try {
    appliquerParametres({ crypto: { reseaux: [bep20, trc20, base] } });
    assert.deepEqual(reseauxOuverts().map((r) => r.id), ["bep20", "trc20", "base"]);
    assert.deepEqual(reseauxPour(evm).map((r) => r.id), ["bep20", "base"], "0x : BSC et Base");
    assert.equal(reseauDe(evm), null, "deux possibles : au client de choisir, jamais l'écran");
    assert.equal(reseauDe("TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE"), "trc20", "T… : Tron seul, pris d'office");
    assert.equal(nomsDesReseaux(), "BEP20, TRC20 ou Base");
    assert.equal(infoReseau("base").confirmations, 30);
    assert.equal(nomsReseau("base").explorateur, "BaseScan");
    assert.equal(lienTransaction("https://basescan.org", "base", "0xab"), "https://basescan.org/tx/0xab");
    assert.equal(lienTransaction("https://tronscan.org/#", "trc20", "ab"), "https://tronscan.org/#/transaction/ab");
    assert.equal(lienContrat("https://tronscan.org/#", "trc20", "T1"), "https://tronscan.org/#/token20/T1");
    // une liste abîmée laisse celle d'avant, plutôt qu'un écran sans réseau
    appliquerParametres({ crypto: { reseaux: [bep20, { id: "../x", famille: "evm" }] } });
    assert.deepEqual(reseauxOuverts().map((r) => r.id), ["bep20", "trc20", "base"]);
    // Base fermé : il sort de la liste, mais l'historique sait encore le nommer
    appliquerParametres({ crypto: { reseaux: [bep20, trc20] } });
    assert.equal(reseauDe(evm), "bep20", "un seul réseau EVM ouvert : la lecture redevient sûre");
    assert.equal(infoReseau("base").nom, "Base");
    assert.equal(infoReseau("inconnu").nom, "INCONNU", "un réseau jamais vu ne fait pas tomber l'écran");
  } finally {
    appliquerParametres({ crypto: { reseaux: [bep20, trc20] } });
  }
});

test("la bande de prix est celle du moteur : au pas, vers l'intérieur", () => {
  assert.deepEqual(bandeDePrix("achat", 604.55), { min: 483.65, max: 665 });
  assert.deepEqual(bandeDePrix("vente", 600), { min: 540, max: 720 });
  assert.equal(bandeDePrix("achat", null), null, "sans référence, pas de bande : le premier ordre fait le marché");
});

test("le bouton gris dit pourquoi : la règle et sa borne, dans l'ordre du moteur", () => {
  const base = { cote: "achat" as const, type: "limite" as const, prix: 618.4, quantite: 10, dispoXafe: 1_000_000, dispoBase: 0, reference: 618.4, ouverts: 0 };
  /* les nombres s'écrivent à la française, avec des espaces fines : on les lit comme des espaces */
  const raison = (o: Parameters<typeof raisonDuRefus>[0]) => raisonDuRefus(o)?.replace(/[\u202f\u00a0]/g, " ") ?? null;
  assert.equal(raison(base), null);
  // le minimum est en XAFe (0027) : 1,61 USDT à 618,40 font 995,62 XAFe, sous 1 500
  assert.match(raison({ ...base, quantite: 1.61, dispoXafe: 1000 })!, /Au moins 1 500 XAFe par ordre \(≈ 2,43 USDT/);
  assert.equal(raison({ ...base, quantite: 2.43 }), null, "2,43 USDT font 1 502,71 XAFe : assez");
  assert.match(raison({ ...base, quantite: 0.005 })!, /deux décimales/);
  // pas de plafond : un ordre énorme ne bute que sur le solde
  assert.match(raison({ ...base, quantite: 5_000_000 })!, /Il faut .* XAFe/);
  assert.equal(raison({ ...base, prix: 0 }), "Fixez votre prix.", "une case vide n'est pas un prix");
  assert.match(raison({ ...base, prix: 618.41 })!, /0,05/);
  assert.match(raison({ ...base, prix: 700 })!, /entre 494,75 et 680,20/);
  assert.match(raison({ ...base, quantite: 2000 })!, /Il faut 1 236 800 XAFe/);
  assert.match(raison({ ...base, ouverts: 200 })!, /200 ordres ouverts/);
  assert.match(raison({ ...base, cote: "vente", dispoBase: 5 })!, /5 USDT disponibles/);
  assert.equal(raison({ ...base, type: "marche", quantite: 200_000 }), null, "au marché non plus, pas de plafond (0027)");
});

test("achat max : sans prix, on ne sait pas — jamais une division par 1", () => {
  assert.equal(achatMax(1000, 0), 0);
  assert.equal(achatMax(1000, 618.4), 1.61);
});

test("en anglais, les montants et les dates se lisent à l'anglaise", async () => {
  const { poserLangue } = await import("./langue.ts");
  const f = await import("./format.ts");
  poserLangue("en");
  try {
    assert.equal(f.xaf(1250000), "1,250,000");
    assert.equal(f.prix(588.15), "588.15");
    assert.equal(f.pourcent(0.005), "0.5%");
    const maintenant = new Date(2026, 9, 19, 15, 0);
    assert.equal(f.jourRelatif(new Date(2026, 9, 19, 9, 0), maintenant), "Today");
    assert.equal(f.jourRelatif(new Date(2026, 9, 18, 9, 0), maintenant), "Yesterday");
    assert.equal(f.jourRelatif(new Date(2026, 9, 12, 9, 0), maintenant), "12 Oct");
    assert.equal(f.quand(new Date(2026, 9, 19, 9, 5), maintenant), "today at 09:05");
  } finally {
    poserLangue("fr");
  }
  assert.equal(f.xaf(1250000), "1 250 000", "le français revient tel quel");
});

test("les textes de la base se lisent en anglais, et un texte imprévu reste tel quel", async () => {
  const { poserLangue } = await import("./langue.ts");
  const s = await import("./serveur.ts");
  assert.equal(s.texteDuServeur("+80,000,000 XAFe reçus par MTN MoMo."), "+80,000,000 XAFe reçus par MTN MoMo.", "en français, rien ne bouge");
  poserLangue("en");
  try {
    assert.equal(s.titreDuServeur("XAFe crédités"), "XAFe credited");
    assert.equal(s.titreDuServeur("Palier 1"), "Tier 1");
    assert.equal(s.titreDuServeur("Paiement en vérification"), "Payment under review");
    assert.equal(s.texteDuServeur("Votre paiement de 7,500,000 XAF est arrivé : l'équipe le vérifie avant de créditer vos XAFe."),
      "Your payment of 7,500,000 XAF has arrived: the team is checking it before crediting your XAFe.");
    assert.equal(s.texteDuServeur("+80,000,000 XAFe reçus par MTN MoMo."), "+80,000,000 XAFe received via MTN MoMo.");
    assert.equal(s.texteDuServeur("12,760,000 XAF envoyés au 600000003. Transaction ID : 18300000003."), "12,760,000 XAF sent to 600000003. Transaction ID: 18300000003.");
    /* 0038 : un remboursement payé en plusieurs transferts dit tous ses ID */
    assert.equal(s.texteDuServeur("1,500,000 XAF envoyés au 677444054. Transaction ID : MP1, MP2."), "1,500,000 XAF sent to 677444054. Transaction ID: MP1, MP2.");
    assert.equal(s.texteDuServeur("90,000,000 XAFe sont revenus sur votre compte. Démo : Solde insuffisant : 0 FCFA."),
      "90,000,000 XAFe are back in your account. Demo: Insufficient balance: 0 FCFA.");
    assert.equal(s.texteDuServeur("Achat de 221.77 USDT à 575.65."), "Bought 221.77 USDT at 575.65.");
    assert.equal(s.motifLisible("le montant déclaré ne correspond pas au paiement reçu : vérifiez-le."),
      "The amount you entered does not match the payment received: please check it.");
    assert.equal(s.motifLisible("Le client a demandé l'annulation."), "Le client a demandé l'annulation.", "un motif tapé par l'équipe n'est pas inventé");
  } finally {
    poserLangue("fr");
  }
});

test("deux carnets (0045) : chacun ses règles, « marche.paires » ne change que ce qu'il nomme, et les refus nomment le bon dollar", async () => {
  const a = await import("./argent.ts");
  const avant = structuredClone({ MARCHE: a.MARCHE, MARCHES: a.MARCHES });
  a.appliquerParametres({
    marche: { pas_prix: 0.05, quantite_min: 10, ouvert: true },
    marches: { "USDT/XAFe": { paire: "USDT/XAFe", pas_prix: 0.05, quantite_min: 10, ouvert: true },
               "USDC/XAFe": { paire: "USDC/XAFe", pas_prix: 0.05, quantite_min: 25, ouvert: false } },
  });
  assert.equal(a.MARCHES["USDC/XAFe"].quantiteMin, 25);
  assert.equal(a.MARCHES["USDC/XAFe"].ouvert, false);
  assert.equal(a.MARCHES["USDT/XAFe"].quantiteMin, 10, "la règle d'une paire ne fuit pas dans l'autre");
  a.choisirLaPaire("USDC/XAFe");
  assert.equal(a.MARCHE.base, "USDC");
  assert.equal(a.MARCHE.quantiteMin, 25, "l'écran juge avec les règles du carnet choisi");
  const r = a.raisonDuRefus({ cote: "vente", type: "limite", prix: 600, quantite: 30, dispoXafe: 0, dispoBase: 5, reference: 600, ouverts: 0 });
  assert.match(r ?? "", /USDC/, "le refus nomme l'USDC, pas l'USDT");
  assert.equal(a.fraisOrdre("achat", 100, 600).actif, "USDC", "l'acheteur paie ses frais dans l'actif qu'il reçoit");
  // une base d'avant 0045 : « marche » seul vaut pour la paire principale
  a.appliquerParametres({ marche: { pas_prix: 0.1, quantite_min: 12 } });
  assert.equal(a.MARCHES["USDT/XAFe"].quantiteMin, 12);
  assert.equal(a.MARCHES["USDC/XAFe"].quantiteMin, 25);
  assert.equal(a.MARCHES["USDC/XAFe"].ouvert, false, "une base qui ne connaît pas le carnet USDC ne l'ouvre pas");
  Object.assign(a.MARCHE, avant.MARCHE);
  for (const p of Object.keys(avant.MARCHES) as (keyof typeof avant.MARCHES)[]) Object.assign(a.MARCHES[p], avant.MARCHES[p]);
});

test("l'USDC passe par BNB Chain et Ethereum, jamais par Tron ; chaque réseau a ses frais", async () => {
  const a = await import("./argent.ts");
  a.appliquerParametres({ crypto: { frais: { USDT: 1, XAFe: 500 }, reseaux: [
    { id: "bep20", norme: "BEP20", nom: "BNB Smart Chain", famille: "evm", actifs: ["XAFe", "USDT", "USDC"], frais: { USDT: 1, USDC: 1, XAFe: 500 } },
    { id: "trc20", norme: "TRC20", nom: "Tron", famille: "tron", actifs: ["XAFe", "USDT"] },
    { id: "erc20", norme: "ERC20", nom: "Ethereum", famille: "evm", actifs: ["XAFe", "USDT", "USDC"], frais: { USDT: 5, USDC: 5, XAFe: 3000 } },
  ] } });
  assert.deepEqual(a.reseauxDe("USDC").map((r) => r.id), ["bep20", "erc20"]);
  assert.deepEqual(a.reseauxDe("USDT").map((r) => r.id), ["bep20", "trc20", "erc20"]);
  assert.equal(a.reseauxPour("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "USDC").length, 0, "une adresse Tron ne reçoit pas d'USDC");
  assert.equal(a.fraisRetrait("USDC", "erc20"), 5);
  assert.equal(a.fraisRetrait("USDC", "bep20"), 1);
  assert.equal(a.FRAIS_CRYPTO.USDC, 1, "sans frais d'USDC posés, ceux de l'USDT");
  a.appliquerParametres({ crypto: { reseaux: [
    { id: "bep20", norme: "BEP20", nom: "BNB Smart Chain", famille: "evm" }, { id: "trc20", norme: "TRC20", nom: "Tron", famille: "tron" } ] } });
  assert.deepEqual(a.reseauxDe("USDC").map((r) => r.id), [], "une base d'avant 0045 ne dit rien de l'USDC : il n'est nulle part");
});
