import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DROITS, aLeDroit, type Role } from "./droits.ts";

/* La migration est la vérité ; l'écran en porte une copie. Les deux doivent dire la même chose. */
test("la matrice des droits de l'écran est celle de la base", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/0003_administration.sql", import.meta.url), "utf8");
  const bloc = sql.slice(sql.indexOf("create function droits_du_role"), sql.indexOf("$$;", sql.indexOf("create function droits_du_role")));
  const roles: Role[] = ["super_admin", "operateur", "tresorier", "support"];
  for (const role of roles) {
    const m = bloc.match(new RegExp(`when '${role}'\\s+then\\s+array\\[([^\\]]*)\\]`));
    assert.ok(m, `le rôle ${role} est dans la migration`);
    const enBase = m![1].split(",").map((x) => x.trim().replace(/'/g, "")).filter(Boolean).sort();
    assert.deepEqual([...DROITS[role]].sort(), enBase, `les droits de ${role} diffèrent entre l'écran et la base`);
  }
});

test("un droit se lit par rôle, et un rôle absent n'a rien", () => {
  assert.ok(aLeDroit("super_admin", "administrateurs"));
  assert.ok(aLeDroit("operateur", "rapprocher"));
  assert.ok(!aLeDroit("operateur", "rembourser"));
  assert.ok(!aLeDroit("support", "paliers"));
  assert.ok(!aLeDroit(null, "voir"));
});
