import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { adresseGoogleDirecte, ATTENTE_MAX_MS, empreinteHex, hasard, lireRetourOAuth, nouvelEtat, retourVersLaCoque, verifierLeRetour, voieGoogle } from "./google";

const CHROME = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36";
const ID = "123-abc.apps.googleusercontent.com";

test("Google, où il marche et où il se tait", () => {
  assert.deepEqual(voieGoogle({ demo: false, coque: undefined, agent: CHROME }), { voie: "web", direct: false });
  assert.deepEqual(voieGoogle({ demo: false, coque: { version: 2, google: true }, agent: CHROME }), { voie: "coque", direct: false });
  assert.deepEqual(voieGoogle({ demo: false, coque: { version: 1 }, agent: CHROME }), { voie: "aucune", raison: "coque_ancienne" });
  assert.deepEqual(voieGoogle({ demo: false, coque: undefined, agent: `${CHROME} WhatsApp/2.24` }), { voie: "aucune", raison: "navigateur_integre" });
  assert.deepEqual(voieGoogle({ demo: false, coque: undefined, agent: `${CHROME} [FBAN/FB4A;FBAV/450.0]` }), { voie: "aucune", raison: "navigateur_integre" });
  assert.deepEqual(voieGoogle({ demo: true, coque: undefined, agent: CHROME, clientId: ID }), { voie: "aucune", raison: "demo" });
});

test("le chemin direct : avec un Client ID, et dans la coque seulement si son pont sait l'ouvrir (v3)", () => {
  assert.deepEqual(voieGoogle({ demo: false, coque: undefined, agent: CHROME, clientId: ID }), { voie: "web", direct: true });
  assert.deepEqual(voieGoogle({ demo: false, coque: { version: 3, google: true }, agent: CHROME, clientId: ID }), { voie: "coque", direct: true });
  /* la coque v2 installée refuse toute adresse qui n'est pas celle de Supabase : elle garde l'ancien chemin */
  assert.deepEqual(voieGoogle({ demo: false, coque: { version: 2, google: true }, agent: CHROME, clientId: ID }), { voie: "coque", direct: false });
  assert.deepEqual(voieGoogle({ demo: false, coque: { version: 3, google: true }, agent: CHROME }), { voie: "coque", direct: false });
});

test("l'adresse de Google : notre retour (pas celui de Supabase), un jeton d'identité, le nonce haché", () => {
  const u = new URL(adresseGoogleDirecte({ clientId: ID, origine: "https://app.glisil.com", nonceHache: "abcd", etat: "w.xyz" }));
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("redirect_uri"), "https://app.glisil.com/bienvenue/retour");
  assert.equal(u.searchParams.get("response_type"), "id_token");
  assert.equal(u.searchParams.get("scope"), "openid email profile");
  assert.equal(u.searchParams.get("nonce"), "abcd");
  assert.equal(u.searchParams.get("state"), "w.xyz");
  assert.equal(u.searchParams.get("client_id"), ID);
  assert.ok(!u.toString().includes("supabase"));
});

test("le nonce : haché comme Supabase le compare (SHA-256, hexadécimal)", async () => {
  const n = hasard();
  assert.match(n, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(n, hasard());
  assert.equal(await empreinteHex(n), createHash("sha256").update(n).digest("hex"));
});

test("le retour : le code (par Supabase), le jeton et l'état (direct), ou le refus", () => {
  const vide = { code: null, jeton: null, etat: null, erreur: null };
  assert.deepEqual(lireRetourOAuth("glisil://auth-retour?code=abc-123"), { ...vide, code: "abc-123" });
  assert.deepEqual(lireRetourOAuth("https://app.glisil.com/bienvenue/retour?error=access_denied&error_description=User%20cancelled"), { ...vide, erreur: "User cancelled" });
  assert.deepEqual(lireRetourOAuth("https://app.glisil.com/bienvenue/retour#error=server_error"), { ...vide, erreur: "server_error" });
  assert.deepEqual(lireRetourOAuth("https://app.glisil.com/bienvenue/retour#state=w.e1&id_token=eyJ.a.b&authuser=0"), { ...vide, jeton: "eyJ.a.b", etat: "w.e1" });
  assert.deepEqual(lireRetourOAuth("pas une adresse"), vide);
});

test("dans l'onglet du système, le retour de la coque repart vers la coque, tel quel ; celui du navigateur reste", () => {
  assert.equal(retourVersLaCoque("https://app.glisil.com/bienvenue/retour#state=c.e1&id_token=eyJ.a.b"), "glisil://auth-retour#state=c.e1&id_token=eyJ.a.b");
  assert.equal(retourVersLaCoque("https://app.glisil.com/bienvenue/retour#error=access_denied&state=c.e1"), "glisil://auth-retour#error=access_denied&state=c.e1");
  assert.equal(retourVersLaCoque("https://app.glisil.com/bienvenue/retour#state=w.e1&id_token=eyJ.a.b"), null);
  assert.equal(retourVersLaCoque("https://app.glisil.com/bienvenue/retour?code=abc"), null);
  assert.equal(nouvelEtat(true, "x"), "c.x");
  assert.equal(nouvelEtat(false, "x"), "w.x");
});

test("un retour ne vaut que pour SON départ : pas d'attente, autre état, trop tard, refus de Google", () => {
  const attente = { etat: "w.e1", nonce: "n1", quand: 1_000 };
  const bon = { etat: "w.e1", jeton: "eyJ.a.b", erreur: null };
  assert.deepEqual(verifierLeRetour(attente, bon, 2_000), { nonce: "n1", jeton: "eyJ.a.b" });
  assert.ok("refus" in verifierLeRetour(null, bon, 2_000));
  /* TÉMOIN : un lien piégé qui apporte le jeton d'un autre, avec un autre état */
  assert.ok("refus" in verifierLeRetour(attente, { ...bon, etat: "w.autre" }, 2_000));
  assert.ok("refus" in verifierLeRetour(attente, { ...bon, etat: null }, 2_000));
  assert.ok("refus" in verifierLeRetour(attente, bon, 1_000 + ATTENTE_MAX_MS + 1));
  assert.deepEqual(verifierLeRetour(attente, { etat: "w.e1", jeton: null, erreur: "access_denied" }, 2_000), { refus: "access_denied" });
  assert.ok("refus" in verifierLeRetour(attente, { ...bon, jeton: null }, 2_000));
});
