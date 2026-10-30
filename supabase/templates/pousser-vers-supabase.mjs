// LES E-MAILS D'AUTH, DU DÉPÔT À SUPABASE — sans copier-coller.
//
//   node supabase/templates/pousser-vers-supabase.mjs              vérifie seulement (aucune clé)
//   SUPABASE_ACCESS_TOKEN=… PROJET=… node supabase/templates/pousser-vers-supabase.mjs --pousser
//
// Les e-mails qu'Auth envoie lui-même (le code d'inscription, le code de « mot de passe oublié », la
// confirmation d'un changement de mot de passe) vivent ici, dans supabase/templates/, et leurs objets
// dans supabase/config.toml — la même source que la pile locale. Ce script les lit, les VÉRIFIE (le code
// {{ .Token }} est là, les deux langues aussi, l'anglais par défaut), les envoie au projet par l'API de
// gestion de Supabase, puis RELIT le projet et exige d'y retrouver exactement ce qu'il a envoyé.
// Le robot GitHub (.github/workflows/courriels-auth.yml) le lance à chaque changement de ces e-mails.
//
// Les alertes que Supabase sait envoyer d'elles-mêmes (mot de passe changé, application ajoutée…) restent
// éteintes : Glisil a les siennes (0048), et deux e-mails pour un même changement feraient douter.
// La clé n'est jamais écrite : ni au journal, ni dans une erreur.
import { readFileSync } from "node:fs";

const ICI = new URL("../../", import.meta.url);
const lire = (chemin) => readFileSync(new URL(chemin.replace(/^\.\//, ""), ICI), "utf8");

/** Les modèles d'Auth que Glisil remplit, et le nom de leurs champs dans l'API de gestion. */
const MODELES = ["confirmation", "magic_link", "recovery", "reauthentication"];

/** [auth.email.template.<nom>] subject = "…" ; content_path = "…" — lus dans config.toml, sans bibliothèque. */
export function lireLesModeles(toml = lire("supabase/config.toml")) {
  const modeles = {};
  for (const nom of MODELES) {
    const bloc = toml.split(`[auth.email.template.${nom}]`)[1]?.split(/\n\[/)[0];
    if (!bloc) throw new Error(`config.toml : [auth.email.template.${nom}] manque`);
    const sujet = bloc.match(/^subject\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/m)?.[1];
    const chemin = bloc.match(/^content_path\s*=\s*"([^"]+)"\s*$/m)?.[1];
    if (!sujet || !chemin) throw new Error(`config.toml : l'objet ou le fichier de « ${nom} » manque`);
    /* les commentaires HTML sont des notes pour l'équipe : ils ne partent pas chez le client */
    const corps = lire(chemin).replace(/<!--[\s\S]*?-->\s*/g, "");
    modeles[nom] = { sujet: sujet.replace(/\\"/g, '"'), corps, chemin };
  }
  return modeles;
}

/** Chaque « si la personne a choisi le français » du modèle : vrai s'il a son « sinon » (l'anglais), à son niveau. */
function blocsDeLangue(texte) {
  const jetons = [...texte.matchAll(/\{\{\s*(if\b[^}]*|else|end)\s*\}\}/g)].map((x) => x[1].trim());
  const pile = [], blocs = [];
  for (const j of jetons) {
    if (j.startsWith("if")) pile.push({ langue: /^if eq \(printf "%v" \.Data\.langue\) "fr"$/.test(j), sinon: false });
    else if (j === "else") { if (pile.length) pile[pile.length - 1].sinon = true; }
    else { const b = pile.pop(); if (b?.langue) blocs.push(b.sinon); }
  }
  return blocs;
}

/** Ce qu'un e-mail d'Auth doit porter avant de partir chez un client. */
export function verifier(modeles) {
  const fautes = [];
  for (const [nom, m] of Object.entries(modeles)) {
    if (!m.corps.includes("{{ .Token }}")) fautes.push(`${nom} : pas de {{ .Token }} — le client recevrait un e-mail sans code`);
    if (/\{\{\s*\.ConfirmationURL\s*\}\}/.test(m.corps)) fautes.push(`${nom} : un lien à cliquer — Glisil n'envoie que des codes`);
    for (const [quoi, texte] of [["l'objet", m.sujet], ["le corps", m.corps]]) {
      const blocs = blocsDeLangue(texte);
      if (!blocs.length) fautes.push(`${nom} : ${quoi} n'a pas ses deux langues (le français si choisi, l'anglais sinon)`);
      else if (blocs.some((b) => !b)) fautes.push(`${nom} : ${quoi} a un passage en français sans sa version anglaise`);
    }
    const ouvre = (m.corps.match(/\{\{\s*if\b/g) ?? []).length, ferme = (m.corps.match(/\{\{\s*end\s*\}\}/g) ?? []).length;
    if (ouvre !== ferme) fautes.push(`${nom} : ${ouvre} « if » pour ${ferme} « end » — Supabase refuserait le modèle`);
    if (m.corps.length > 50_000) fautes.push(`${nom} : ${m.corps.length} caractères, c'est trop pour un e-mail`);
  }
  return fautes;
}

/** Le corps de la requête PATCH /v1/projects/{ref}/config/auth. */
export function charge(modeles, actuel = {}) {
  const c = {};
  for (const [nom, m] of Object.entries(modeles)) {
    c[`mailer_subjects_${nom}`] = m.sujet;
    c[`mailer_templates_${nom}_content`] = m.corps;
  }
  /* les alertes d'Auth : éteintes là où le projet les connaît (Glisil envoie les siennes) */
  for (const cle of Object.keys(actuel)) if (/^mailer_notifications_.+_enabled$/.test(cle)) c[cle] = false;
  return c;
}

/** Envoie à Supabase ce qui diffère, puis relit : rend les champs changés, lève si Supabase n'a pas gardé l'envoi. */
export async function pousser(modeles, { jeton, projet, fetch: f = fetch }) {
  const api = async (methode, corps) => {
    const r = await f(`https://api.supabase.com/v1/projects/${projet}/config/auth`, {
      method: methode,
      headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
      body: corps ? JSON.stringify(corps) : undefined,
    });
    const texte = await r.text();
    if (!r.ok) {
      const aide = r.status === 401 ? " — la clé est refusée (expirée, ou mal recopiée dans le secret GitHub « SUPABASE »)"
        : r.status === 403 ? " — la clé n'a pas le droit de modifier l'authentification de ce projet"
        : r.status === 404 ? " — projet introuvable : vérifiez PROJET" : "";
      throw new Error(`Supabase ${methode} ${r.status}${aide} : ${texte.slice(0, 300)}`);
    }
    return texte ? JSON.parse(texte) : {};
  };
  const avant = await api("GET");
  const voulu = charge(modeles, avant);
  const change = Object.keys(voulu).filter((k) => avant[k] !== voulu[k]);
  if (!change.length) return [];
  await api("PATCH", Object.fromEntries(change.map((k) => [k, voulu[k]])));
  const apres = await api("GET");
  const ecarts = Object.keys(voulu).filter((k) => apres[k] !== voulu[k]);
  if (ecarts.length) throw new Error(`relu sur Supabase, ${ecarts.length} champ(s) ne correspondent pas : ${ecarts.join(", ")}`);
  return change;
}

/* lancé directement (le robot, ou à la main) ; importé par un test, il n'envoie rien */
if (import.meta.url === `file://${process.argv[1]}`) {
  const modeles = lireLesModeles();
  const fautes = verifier(modeles);
  if (fautes.length) { console.error(`✗ ${fautes.length} faute(s) :\n  ${fautes.join("\n  ")}`); process.exit(1); }
  console.log(`✓ ${Object.keys(modeles).length} e-mails vérifiés : ${Object.entries(modeles).map(([n, m]) => `${n} (${m.chemin.split("/").pop()})`).join(", ")}`);
  if (process.argv.includes("--pousser")) {
    const jeton = process.env.SUPABASE_ACCESS_TOKEN, projet = process.env.PROJET ?? "";
    if (!jeton || !/^[a-z]{20}$/.test(projet)) {
      console.error("✗ il faut SUPABASE_ACCESS_TOKEN (le secret GitHub) et PROJET (l'identifiant du projet, 20 lettres)");
      process.exit(1);
    }
    try {
      const change = await pousser(modeles, { jeton, projet });
      console.log(change.length ? `✓ envoyé à Supabase et relu à l'identique : ${change.join(", ")}` : "✓ Supabase porte déjà exactement ces e-mails : rien à envoyer");
    } catch (e) {
      /* le message ne porte jamais la clé : seulement le statut et la réponse de Supabase */
      console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  }
}
