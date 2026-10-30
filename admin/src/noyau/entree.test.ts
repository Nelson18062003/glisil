import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTH_VIDE, motDePasseValide, phaseAdmin, premierFacteurDe, type EtatAuth } from "./entree.ts";

const complet: EtatAuth = { session: true, premierFacteur: "password", aalActuel: "aal2", aalSuivant: "aal2", emailConfirme: true, motDePasse: true, codesDeSecours: true };

test("l'entrée mène à chaque étape, dans l'ordre", () => {
  assert.deepEqual(phaseAdmin(AUTH_VIDE, false), { phase: "anonyme" });
  assert.deepEqual(phaseAdmin({ ...complet, emailConfirme: false }, false), { phase: "email_a_confirmer" });
  assert.deepEqual(phaseAdmin({ ...complet, motDePasse: false }, false), { phase: "mot_de_passe_a_choisir" });
  assert.deepEqual(phaseAdmin({ ...complet, aalActuel: "aal1", aalSuivant: "aal1" }, false), { phase: "deux_facteurs_a_enroler" });
  assert.deepEqual(phaseAdmin({ ...complet, aalActuel: "aal1" }, false), { phase: "deux_facteurs_a_verifier" });
  assert.deepEqual(phaseAdmin({ ...complet, codesDeSecours: false }, false), { phase: "codes_a_noter" });
  assert.deepEqual(phaseAdmin(complet, false), { phase: "pret" });
});

test("seul le mot de passe ouvre l'administration : ni un code e-mail seul, ni Google", () => {
  assert.deepEqual(phaseAdmin({ ...complet, premierFacteur: "autre" }, false), { phase: "anonyme", raison: "facteur_faible" });
  assert.deepEqual(phaseAdmin({ ...complet, premierFacteur: "oauth" }, false), { phase: "anonyme", raison: "facteur_faible" });
  assert.deepEqual(phaseAdmin({ ...complet, premierFacteur: null }, false), { phase: "anonyme", raison: "facteur_faible" });
  /* témoin : la règle de l'application cliente (Google admis) laisserait passer « oauth » */
  const regleCliente = (e: EtatAuth) => e.premierFacteur === "password" || e.premierFacteur === "oauth";
  assert.equal(regleCliente({ ...complet, premierFacteur: "oauth" }), true);
});

test("mot de passe oublié : l'application d'abord, s'il y en a une, puis le nouveau mot de passe", () => {
  const recup: EtatAuth = { ...complet, premierFacteur: "autre", aalActuel: "aal1", aalSuivant: "aal2" };
  assert.deepEqual(phaseAdmin(recup, true), { phase: "recuperation", etape: "deux_facteurs" });
  assert.deepEqual(phaseAdmin({ ...recup, aalActuel: "aal2" }, true), { phase: "recuperation", etape: "nouveau" });
  assert.deepEqual(phaseAdmin({ ...recup, aalSuivant: "aal1" }, true), { phase: "recuperation", etape: "nouveau" }, "un ancien administrateur sans application");
  assert.deepEqual(phaseAdmin(AUTH_VIDE, true), { phase: "anonyme" });
});

test("le premier facteur se lit dans amr, sous ses deux formes", () => {
  assert.equal(premierFacteurDe([{ method: "password", timestamp: 1 } as { method: string }, { method: "totp" }]), "password");
  assert.equal(premierFacteurDe(["otp"]), "autre");
  assert.equal(premierFacteurDe([]), null);
  assert.equal(premierFacteurDe(null), null);
});

test("le mot de passe suit la règle d'Auth", () => {
  assert.equal(motDePasseValide("Glisil-2026"), true);
  assert.equal(motDePasseValide("glisil2026"), false, "TÉMOIN : la règle d'avant l'acceptait — ni majuscule ni symbole");
  assert.equal(motDePasseValide("Glisil 2026x"), false, "l'espace n'est pas un symbole pour Auth");
  assert.equal(motDePasseValide("court1"), false);
  assert.equal(motDePasseValide("seulementdeslettres"), false);
  assert.equal(motDePasseValide("1234567890"), false);
  assert.equal(motDePasseValide("éééééééééé1"), false, "Auth ne compte que les lettres ASCII");
  assert.equal(motDePasseValide("a1" + "x".repeat(71)), false, "plus de 72 octets");
  /* la même règle que l'application cliente, sur les mêmes essais */
  const essais = ["Glisil-2026", "glisil2026", "Glisil2026", "glisil-2026", "GLISIL-2026", "Glisil 2026x", "Glisil~2026", "court1", "1234567890", "éééééééééé1", "seulementdeslettres", "Aa1-" + "x".repeat(69)];
  return import("../../../app/src/noyau/motDePasse.ts").then((client) => {
    for (const e of essais) assert.equal(motDePasseValide(e), client.motDePasseValide(e), `même verdict pour « ${e.slice(0, 20)} »`);
  });
});
