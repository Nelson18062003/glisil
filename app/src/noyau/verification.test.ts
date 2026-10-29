import { strict as assert } from "node:assert";
import { test } from "node:test";
import { champDeLErreur, courrielEnPanne, preuvesCompletes, secondesAvant, sixChiffres } from "./verification";

test("chaque refus du moteur va sur son champ", () => {
  assert.equal(champDeLErreur("code de l'application d'authentification à saisir"), "totp");
  assert.equal(champDeLErreur("code de l'application incorrect"), "totp");
  assert.equal(champDeLErreur("aucune application d'authentification"), "totp");
  assert.equal(champDeLErreur("mot de passe incorrect"), "mot_de_passe");
  assert.equal(champDeLErreur("code e-mail incorrect"), "code_email");
  assert.equal(champDeLErreur("mot de passe à choisir"), "mot_de_passe_a_choisir");
  assert.equal(champDeLErreur("vérifications verrouillées"), "verrou");
  for (const m of ["vérification expirée", "vérification épuisée", "vérification remplacée par un code plus récent", "vérification déjà utilisée", "vérification inconnue", "la vérification ne correspond pas à cette opération"]) {
    assert.equal(champDeLErreur(m), "nouveau_code", m);
  }
});

test("TÉMOIN : un refus qui n'est pas celui de la vérification n'est pas avalé", () => {
  assert.equal(champDeLErreur("solde insuffisant"), null);
  assert.equal(champDeLErreur("numéro pas encore actif"), null);
  assert.equal(champDeLErreur("Failed to fetch"), null);
  assert.equal(champDeLErreur("vérifications demandées"), null);
});

test("le compte à rebours, les codes, l'e-mail en panne", () => {
  const t0 = Date.parse("2026-10-29T12:00:00Z");
  assert.equal(secondesAvant("2026-10-29T12:01:00Z", t0), 60);
  assert.equal(secondesAvant("2026-10-29T11:59:00Z", t0), 0);
  assert.equal(secondesAvant(null, t0), 0);
  assert.equal(secondesAvant("pas une date", t0), 0);
  assert.equal(sixChiffres("482 913"), "482913");
  assert.equal(sixChiffres("48-29-13-77"), "482913");
  assert.ok(preuvesCompletes("x", "123456", "654321"));
  assert.ok(!preuvesCompletes("", "123456", "654321"));
  assert.ok(!preuvesCompletes("x", "12345", "654321"));
  assert.ok(courrielEnPanne("echoue") && courrielEnPanne("abandonne") && !courrielEnPanne("envoye") && !courrielEnPanne(null));
});
