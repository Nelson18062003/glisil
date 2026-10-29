import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { EtatDEntree } from "../guichet/types";
import { cheminDeLaPhase, cheminPermis, ENTREE_VIDE, phaseDEntree, premierFacteurDe } from "./entree";

const PRET: EtatDEntree = {
  session: true, premierFacteur: "password", aalActuel: "aal2", aalSuivant: "aal2",
  emailConfirme: true, motDePasse: true, codesDeSecours: true, compte: true, facteurTotpId: "f1",
};
const avec = (p: Partial<EtatDEntree>): EtatDEntree => ({ ...PRET, ...p });

test("la table de vérité de l'entrée, dans l'ordre", () => {
  assert.deepEqual(phaseDEntree(ENTREE_VIDE, false), { phase: "anonyme" });
  assert.deepEqual(phaseDEntree(PRET, false), { phase: "connecte" });
  assert.deepEqual(phaseDEntree(avec({ emailConfirme: false }), false), { phase: "email_a_confirmer" });
  assert.deepEqual(phaseDEntree(avec({ motDePasse: false, premierFacteur: "oauth", aalActuel: "aal1", aalSuivant: "aal1" }), false), { phase: "mot_de_passe_a_choisir" });
  assert.deepEqual(phaseDEntree(avec({ aalActuel: "aal1", aalSuivant: "aal1", facteurTotpId: null }), false), { phase: "deux_facteurs_a_enroler" });
  assert.deepEqual(phaseDEntree(avec({ aalActuel: "aal1" }), false), { phase: "deux_facteurs_a_verifier" });
  assert.deepEqual(phaseDEntree(avec({ codesDeSecours: false }), false), { phase: "codes_a_noter" });
  assert.deepEqual(phaseDEntree(avec({ compte: false }), false), { phase: "inscription" });
});

test("TÉMOIN : une session ouverte par un code e-mail seul n'entre jamais, même à aal2 avec tout le reste", () => {
  assert.deepEqual(phaseDEntree(avec({ premierFacteur: "autre" }), false), { phase: "anonyme", raison: "facteur_faible" });
  assert.notEqual(phaseDEntree(avec({ premierFacteur: "autre" }), false).phase, "connecte");
});

test("un compte Google sans mot de passe le choisit avant tout le reste", () => {
  const google = avec({ premierFacteur: "oauth", motDePasse: false, aalActuel: "aal1", aalSuivant: "aal1", codesDeSecours: false, compte: false });
  assert.deepEqual(phaseDEntree(google, false), { phase: "mot_de_passe_a_choisir" });
  assert.deepEqual(phaseDEntree({ ...google, motDePasse: true }, false), { phase: "deux_facteurs_a_enroler" });
});

test("la récupération : l'application d'abord s'il y en a une, puis le nouveau mot de passe", () => {
  const recup = avec({ premierFacteur: "autre", aalActuel: "aal1" });
  assert.deepEqual(phaseDEntree(recup, true), { phase: "recuperation", etape: "deux_facteurs" });
  assert.deepEqual(phaseDEntree({ ...recup, aalActuel: "aal2" }, true), { phase: "recuperation", etape: "nouveau" });
  /* un code de secours a retiré l'application : plus de second facteur à demander */
  assert.deepEqual(phaseDEntree({ ...recup, aalSuivant: "aal1" }, true), { phase: "recuperation", etape: "nouveau" });
  assert.deepEqual(phaseDEntree(ENTREE_VIDE, true), { phase: "anonyme" });
});

test("le premier facteur se lit dans l'amr, objets ou chaînes", () => {
  assert.equal(premierFacteurDe([{ method: "totp" }, { method: "password" }]), "password");
  assert.equal(premierFacteurDe(["oauth"]), "oauth");
  assert.equal(premierFacteurDe([{ method: "otp" }, { method: "totp" }]), "autre");
  assert.equal(premierFacteurDe([{ method: "mfa/totp" }, { method: "recovery" }]), "autre");
  assert.equal(premierFacteurDe([]), null);
});

test("chaque phase a son chemin, et n'en ouvre pas d'autre", () => {
  assert.equal(cheminDeLaPhase({ phase: "deux_facteurs_a_verifier" }), "/bienvenue/deux-facteurs/code");
  assert.equal(cheminDeLaPhase({ phase: "recuperation", etape: "nouveau" }), "/bienvenue/oubli/nouveau");
  assert.ok(cheminPermis({ phase: "anonyme" }, "/bienvenue/oubli/code"));
  assert.ok(cheminPermis({ phase: "anonyme" }, "/bienvenue/retour"));
  assert.ok(!cheminPermis({ phase: "anonyme" }, "/bienvenue/inscription"));
  assert.ok(cheminPermis({ phase: "deux_facteurs_a_verifier" }, "/bienvenue/secours"));
  assert.ok(!cheminPermis({ phase: "codes_a_noter" }, "/bienvenue/inscription"));
  assert.ok(!cheminPermis({ phase: "inscription" }, "/bienvenue/codes-de-secours"));
});
