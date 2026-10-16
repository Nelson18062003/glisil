import { strict as assert } from "node:assert";
import { test } from "node:test";
import { codeDeRetrait, lienUssd } from "./depot";

test("les codes de retrait sont ceux du document remis aux clients", () => {
  assert.equal(codeDeRetrait("mtn", "652403602", null, 50000), "*126*14*652403602*50000#");
  assert.equal(codeDeRetrait("om", "696103864", "515318", 50000), "#150*14*515318*696103864*50000#");
  assert.equal(codeDeRetrait("mtn", "+237 6 52 40 36 02", null, 1000), "*126*14*652403602*1000#", "le numéro se lit tel qu'il est rangé");
});

test("sans montant connu, le code le dit au lieu d'inventer ; Orange sans code agent n'a pas de retrait", () => {
  assert.equal(codeDeRetrait("mtn", "652403602", null, null), "*126*14*652403602*MONTANT#");
  assert.equal(lienUssd("*126*14*652403602*MONTANT#"), null, "on ne compose pas un code incomplet");
  assert.equal(codeDeRetrait("om", "696103864", null, 5000), null);
  assert.equal(codeDeRetrait("mtn", "12345", null, 5000), null);
});

test("le lien du clavier écrit # en %23", () => {
  assert.equal(lienUssd("#150*14*515318*696103864*50000#"), "tel:%23150*14*515318*696103864*50000%23");
});
