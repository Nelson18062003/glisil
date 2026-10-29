import { strict as assert } from "node:assert";
import { test } from "node:test";
import { lireRetourOAuth, voieGoogle } from "./google";

const CHROME = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36";

test("Google, où il marche et où il se tait", () => {
  assert.deepEqual(voieGoogle({ demo: false, coque: undefined, agent: CHROME }), { voie: "web" });
  assert.deepEqual(voieGoogle({ demo: false, coque: { version: 2, google: true }, agent: CHROME }), { voie: "coque" });
  assert.deepEqual(voieGoogle({ demo: false, coque: { version: 1 }, agent: CHROME }), { voie: "aucune", raison: "coque_ancienne" });
  assert.deepEqual(voieGoogle({ demo: false, coque: undefined, agent: `${CHROME} WhatsApp/2.24` }), { voie: "aucune", raison: "navigateur_integre" });
  assert.deepEqual(voieGoogle({ demo: false, coque: undefined, agent: `${CHROME} [FBAN/FB4A;FBAV/450.0]` }), { voie: "aucune", raison: "navigateur_integre" });
  assert.deepEqual(voieGoogle({ demo: true, coque: undefined, agent: CHROME }), { voie: "aucune", raison: "demo" });
});

test("le retour OAuth : le code, ou le refus", () => {
  assert.deepEqual(lireRetourOAuth("glisil://auth-retour?code=abc-123"), { code: "abc-123", erreur: null });
  assert.deepEqual(lireRetourOAuth("https://app.glisil.com/bienvenue/retour?error=access_denied&error_description=User%20cancelled"), { code: null, erreur: "User cancelled" });
  assert.deepEqual(lireRetourOAuth("https://app.glisil.com/bienvenue/retour#error=server_error"), { code: null, erreur: "server_error" });
  assert.deepEqual(lireRetourOAuth("pas une adresse"), { code: null, erreur: null });
});
