import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { manquesDuMotDePasse, MOT_DE_PASSE_MIN, motDePasseValide, SYMBOLES } from "./motDePasse";

test("dix caractères : une minuscule, une majuscule, un chiffre ET un symbole", () => {
  assert.ok(motDePasseValide("Glisil-2026x"));
  assert.ok(motDePasseValide("Kamga 2026 Douala!"));
  assert.deepEqual(manquesDuMotDePasse("Motdepasse1"), ["symboles"]);
  assert.deepEqual(manquesDuMotDePasse("motdepasse-1"), ["majuscules"]);
  assert.deepEqual(manquesDuMotDePasse("MOTDEPASSE-1"), ["minuscules"]);
  assert.deepEqual(manquesDuMotDePasse("Motdepasse-"), ["chiffres"]);
  assert.deepEqual(manquesDuMotDePasse("Ab1-"), ["longueur"]);
  assert.deepEqual(manquesDuMotDePasse(""), ["longueur", "minuscules", "majuscules", "chiffres", "symboles"]);
  assert.ok(!motDePasseValide("glisil2026x"), "TÉMOIN : la règle d'avant (lettres et chiffres) l'acceptait");
  assert.ok(!motDePasseValide("Kamga 2026 Douala"), "l'espace n'est pas un symbole pour Auth");
  assert.ok(!motDePasseValide("Éléphant2026é"), "un accent n'est pas un symbole, ni une minuscule ASCII pour Auth");
  assert.ok(!motDePasseValide(`Aa1-${"x".repeat(80)}`), "au-delà de 72 octets, bcrypt ignorerait la fin");
  for (const s of "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~") assert.ok(motDePasseValide(`Glisil2026${s}`), `« ${s} » est un symbole d'Auth`);
  assert.equal(SYMBOLES.length, 32, "les 32 symboles d'Auth");
});

test("la règle est celle de config.toml, quand le fichier la porte", () => {
  let toml = "";
  try { toml = readFileSync(new URL("../../../supabase/config.toml", import.meta.url), "utf8"); } catch { /* le dépôt sans le moteur */ }
  const longueur = toml.match(/^\s*minimum_password_length\s*=\s*(\d+)/m);
  const exigence = toml.match(/^\s*password_requirements\s*=\s*"([^"]+)"/m);
  if (longueur) assert.equal(Number(longueur[1]), MOT_DE_PASSE_MIN, "la longueur minimale du toml et de l'écran");
  if (exigence) assert.equal(exigence[1], "lower_upper_letters_digits_symbols", "l'exigence du toml et de l'écran");
  assert.ok(longueur && exigence, "config.toml porte la règle : la pile locale l'applique comme la production");
});
