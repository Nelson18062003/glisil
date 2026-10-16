import assert from "node:assert/strict";
import { test } from "node:test";
import { ageAu, dateDepuis, emailNormalise, emailValide, nomPropre, nomValide, PAYS, telephoneE164, telephoneEnDirect, telephoneLisible, verdictNaissance } from "./identite.ts";

test("un nom prend ses capitales comme la base les pose", () => {
  assert.equal(nomPropre("jean-paul"), "Jean-Paul");
  assert.equal(nomPropre("NGONO-MBALLA"), "Ngono-Mballa");
  assert.equal(nomPropre("d'almeida"), "D'Almeida");
  assert.equal(nomPropre("d’almeida"), "D'Almeida");
  assert.equal(nomPropre("élise   marie"), "Élise Marie");
  assert.equal(nomPropre("  awa"), "Awa", "les espaces du début tombent");
  assert.equal(nomPropre("yaoundé"), "Yaoundé");
});

test("un nom fait de lettres, de 2 à 60", () => {
  assert.ok(nomValide("Awa"));
  assert.ok(nomValide("Ngono-Mballa"));
  assert.ok(nomValide("N'Djaména"));
  assert.ok(!nomValide("A"), "trop court");
  assert.ok(!nomValide("A1"), "un chiffre n'est pas un nom");
  assert.ok(!nomValide("Jean--"), "un trait d'union ne finit pas un nom");
  assert.ok(!nomValide("x".repeat(61)));
});

test("une adresse e-mail en minuscules, et qui a la forme d'une adresse", () => {
  assert.equal(emailNormalise("  Awa.Ngono@Example.COM "), "awa.ngono@example.com");
  assert.ok(emailValide("awa@example.cm"));
  assert.ok(!emailValide("awa@example"));
  assert.ok(!emailValide("awa example.com"));
  assert.ok(!emailValide("@example.com"));
});

test("une date de naissance existe, et l'âge se compte au jour près", () => {
  assert.equal(dateDepuis("14", "5", "1990"), "1990-05-14");
  assert.equal(dateDepuis("31", "2", "1990"), null, "le 31 février n'existe pas");
  assert.equal(dateDepuis("29", "2", "2000"), "2000-02-29");
  assert.equal(dateDepuis("29", "2", "2001"), null);
  const le = new Date(2026, 9, 16);
  assert.equal(ageAu("2008-10-16", le), 18, "le jour même de ses 18 ans");
  assert.equal(ageAu("2008-10-17", le), 17, "la veille");
  assert.deepEqual(verdictNaissance("17", "10", "2008", le), { ok: false, raison: "mineur", age: 17 });
  assert.deepEqual(verdictNaissance("16", "10", "2008", le), { ok: true, age: 18 });
  assert.deepEqual(verdictNaissance("1", "1", "2030", le), { ok: false, raison: "future" });
  assert.deepEqual(verdictNaissance("14", "5", "19", le), { ok: false, raison: "incomplete" });
});

test("un numéro se met en forme pendant la frappe et part au format international", () => {
  assert.equal(telephoneEnDirect("CM", "677123456"), "6 77 12 34 56");
  assert.equal(telephoneE164("CM", "6 77 12 34 56"), "+237677123456");
  assert.equal(telephoneE164("CM", "+237 6 77 12 34 56"), "+237677123456");
  assert.equal(telephoneE164("CM", "222 23 45 67"), "+237222234567", "un fixe camerounais");
  assert.equal(telephoneE164("CM", "67712345"), null, "un chiffre de moins");
  assert.equal(telephoneE164("CM", "577123456"), null, "un mobile camerounais commence par 6");
  assert.equal(telephoneE164("FR", "06 12 34 56 78"), "+33612345678");
  assert.equal(telephoneE164("GA", "06 23 45 67"), "+24106234567", "au Gabon, le 0 fait partie du numéro");
  assert.equal(telephoneLisible("+237677123456"), "+237 6 77 12 34 56");
  assert.equal(telephoneLisible("677123456"), "677123456", "un ancien numéro local reste tel quel");
});

test("la liste des pays commence par la zone du franc CFA et contient le monde", () => {
  assert.deepEqual(PAYS.slice(0, 6).map((p) => p.code), ["CM", "GA", "CG", "TD", "CF", "GQ"]);
  assert.equal(PAYS[0].nom, "Cameroun");
  assert.equal(PAYS[0].indicatif, "+237");
  assert.ok(PAYS.length > 200);
  assert.equal(new Set(PAYS.map((p) => p.code)).size, PAYS.length, "aucun pays deux fois");
});
