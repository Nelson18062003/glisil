import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { manquesDuMotDePasse, MOT_DE_PASSE_MIN, motDePasseValide } from "./motDePasse";

test("dix caractères, des lettres ET des chiffres", () => {
  assert.ok(motDePasseValide("glisil2026x"));
  assert.ok(motDePasseValide("Kamga 2026 Douala"));
  assert.deepEqual(manquesDuMotDePasse("motdepasse"), ["chiffres"]);
  assert.deepEqual(manquesDuMotDePasse("1234567890"), ["lettres"]);
  assert.deepEqual(manquesDuMotDePasse("abc123"), ["longueur"]);
  assert.deepEqual(manquesDuMotDePasse(""), ["longueur", "lettres", "chiffres"]);
  assert.ok(!motDePasseValide("éééééééééé1"), "Auth ne compte que les lettres ASCII");
  assert.ok(!motDePasseValide(`a1${"x".repeat(80)}`), "au-delà de 72 octets, bcrypt ignorerait la fin");
});

test("la règle est celle de config.toml, quand le fichier la porte", () => {
  let toml = "";
  try { toml = readFileSync(new URL("../../../supabase/config.toml", import.meta.url), "utf8"); } catch { /* le dépôt sans le moteur */ }
  const longueur = toml.match(/^\s*minimum_password_length\s*=\s*(\d+)/m);
  const exigence = toml.match(/^\s*password_requirements\s*=\s*"([^"]+)"/m);
  if (longueur) assert.equal(Number(longueur[1]), MOT_DE_PASSE_MIN, "la longueur minimale du toml et de l'écran");
  if (exigence) assert.equal(exigence[1], "letters_digits", "l'exigence du toml et de l'écran");
});
