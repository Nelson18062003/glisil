import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EVENEMENTS } from "./securite.ts";

/* La migration est la vérité : chaque événement que la base peut écrire a ses mots à l'écran. */
test("chaque événement du journal de sécurité se dit en mots", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/0035_connexion_mot_de_passe_2fa.sql", import.meta.url), "utf8");
  const m = sql.match(/evenement\s+text not null check \(evenement in \(([^)]*)\)\)/);
  assert.ok(m, "la liste des événements est introuvable dans 0035");
  const enBase = [...m![1].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]);
  assert.ok(enBase.length >= 7, enBase.join(", "));
  for (const e of enBase) assert.ok(EVENEMENTS[e], `« ${e} » n'a pas de mots à l'écran`);
  /* témoin : un libellé retiré se voit */
  const sansUn = { ...EVENEMENTS }; delete sansUn[enBase[0]];
  assert.ok(enBase.some((e) => !sansUn[e]));
});
