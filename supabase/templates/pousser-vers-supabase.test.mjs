// node --test supabase/templates/pousser-vers-supabase.test.mjs
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { charge, lireLesModeles, pousser, verifier } from "./pousser-vers-supabase.mjs";

const vrais = () => lireLesModeles();

test("les vrais e-mails passent : le code, les deux langues, l'anglais par défaut", () => {
  const m = vrais();
  assert.deepEqual(Object.keys(m), ["confirmation", "magic_link", "recovery", "reauthentication"]);
  assert.deepEqual(verifier(m), []);
  assert.equal(m.confirmation.corps, m.magic_link.corps, "le code d'inscription et le lien magique : le même e-mail");
  assert.ok(!m.confirmation.corps.includes("<!--"), "les notes de l'équipe ne partent pas chez le client");
  for (const x of Object.values(m)) assert.match(x.sujet, /\{\{ else \}\}.*[A-Za-z]/, "l'objet a sa version anglaise");
});

test("TÉMOINS : chaque faute se voit", () => {
  const casse = (nom, f) => { const m = vrais(); m[nom] = { ...m[nom], ...f(m[nom]) }; return verifier(m); };
  assert.match(casse("recovery", (x) => ({ corps: x.corps.replaceAll("{{ .Token }}", "") })).join(), /pas de \{\{ \.Token \}\}/);
  /* le paragraphe principal perd sa version anglaise : le titre et le pied, eux, l'ont encore — la faute doit se voir quand même */
  const sansAnglais = (x) => ({ corps: x.corps.replace(/\n\{\{ else \}\}[\s\S]*?\n\{\{ end \}\}/, "\n{{ end }}") });
  assert.notEqual(sansAnglais(vrais().confirmation).corps, vrais().confirmation.corps, "le témoin retire bien un passage");
  assert.match(casse("confirmation", sansAnglais).join(), /un passage en français sans sa version anglaise/);
  assert.match(casse("confirmation", (x) => ({ sujet: "Votre code Glisil : {{ .Token }}" })).join(), /l'objet n'a pas ses deux langues/);
  assert.match(casse("reauthentication", (x) => ({ corps: x.corps + "{{ if .Data.x }}" })).join(), /« if » pour/);
  assert.match(casse("confirmation", (x) => ({ corps: x.corps + '<a href="{{ .ConfirmationURL }}">' })).join(), /lien à cliquer/);
});

test("la charge : objets et corps de chaque modèle ; les alertes d'Auth éteintes là où le projet les connaît", () => {
  const c = charge(vrais(), { mailer_notifications_password_changed_enabled: true, autre: 1 });
  assert.equal(Object.keys(c).length, 9);
  assert.equal(c.mailer_notifications_password_changed_enabled, false, "pas deux e-mails pour un même changement");
  assert.ok(c.mailer_templates_recovery_content.includes("{{ .Token }}"));
  assert.ok(!("autre" in c));
});

/** Un faux Supabase : il garde ce qu'on lui envoie — ou, en témoin, en perd un champ. */
function fauxSupabase({ perdre } = {}) {
  const config = { mailer_subjects_confirmation: "Confirm Your Signup", mailer_notifications_password_changed_enabled: false };
  const appels = [];
  const f = async (url, init) => {
    appels.push({ url, methode: init.method, auth: init.headers.authorization });
    if (init.method === "PATCH") { Object.assign(config, JSON.parse(init.body)); if (perdre) delete config[perdre]; }
    return new Response(JSON.stringify(config), { status: 200 });
  };
  return { f, appels, config };
}

test("pousser : envoie, relit, et la deuxième fois n'envoie rien", async () => {
  const s = fauxSupabase();
  const change = await pousser(vrais(), { jeton: "sbp_essai", projet: "dfixghiwqlwulmzixlpf", fetch: s.f });
  assert.equal(change.length, 8, "les 8 champs des 4 modèles (l'alerte d'Auth était déjà éteinte)");
  assert.deepEqual(s.appels.map((a) => a.methode), ["GET", "PATCH", "GET"]);
  assert.ok(s.appels.every((a) => a.url === "https://api.supabase.com/v1/projects/dfixghiwqlwulmzixlpf/config/auth" && a.auth === "Bearer sbp_essai"));
  assert.deepEqual(await pousser(vrais(), { jeton: "sbp_essai", projet: "dfixghiwqlwulmzixlpf", fetch: s.f }), [], "déjà à jour : rien");
});

test("TÉMOIN : un Supabase qui ne garde pas un champ fait échouer le robot, et la clé n'est jamais dans l'erreur", async () => {
  const s = fauxSupabase({ perdre: "mailer_templates_recovery_content" });
  await assert.rejects(pousser(vrais(), { jeton: "sbp_secret", projet: "dfixghiwqlwulmzixlpf", fetch: s.f }),
    (e) => /mailer_templates_recovery_content/.test(e.message) && !e.message.includes("sbp_secret"));
  const refus = async () => new Response('{"message":"forbidden"}', { status: 403 });
  await assert.rejects(pousser(vrais(), { jeton: "sbp_secret", projet: "dfixghiwqlwulmzixlpf", fetch: refus }),
    (e) => /n'a pas le droit/.test(e.message) && !e.message.includes("sbp_secret"));
});
