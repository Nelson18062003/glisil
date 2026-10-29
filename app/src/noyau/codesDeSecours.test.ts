import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { codeDeSecoursLisible, codeDeSecoursNormalise, texteDesCodes } from "./codesDeSecours";

const ESSAIS = JSON.parse(readFileSync(new URL("./codesDeSecours.fixtures.json", import.meta.url), "utf8")) as [string, string | null][];

test("un code tapé se lit comme la base le lit (tableau partagé)", () => {
  assert.ok(ESSAIS.length >= 8, "le tableau d'essais n'est pas vide");
  for (const [tape, attendu] of ESSAIS) assert.equal(codeDeSecoursNormalise(tape), attendu, `« ${tape} »`);
});

test("TÉMOIN : un U (hors de l'alphabet) ou une longueur fausse n'est jamais un code", () => {
  assert.equal(codeDeSecoursNormalise("UUUUU-UUUUU"), null);
  assert.equal(codeDeSecoursNormalise("ABCDE"), null);
});

test("lisible et gardé dans un fichier", () => {
  assert.equal(codeDeSecoursLisible("ABCDEFGHJK"), "ABCDE-FGHJK");
  assert.equal(codeDeSecoursLisible("ABCDE-FGHJK"), "ABCDE-FGHJK");
  const texte = texteDesCodes(["ABCDEFGHJK", "0123456789"], "Glisil");
  assert.match(texte, / 1\. ABCDE-FGHJK\n 2\. 01234-56789\n$/);
});
