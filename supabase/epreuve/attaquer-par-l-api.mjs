// L'API, ATTAQUÉE COMME UN CLIENT L'ATTAQUERAIT.
//
//   sh supabase/epreuve/eprouver.sh        (monte la pile, lance ceci, démonte)
//
// Pas de cale : un vrai GoTrue délivre les jetons (inscription par OTP, comme
// l'application), un vrai PostgREST reçoit les appels, la vraie base de
// Supabase décide. Le harnais du moteur IMITE les droits d'office de
// Supabase ; ici on ne les imite plus, on les subit.
//
// Ce que l'on exige :
//   1. anon n'atteint AUCUNE fonction et ne lit AUCUNE table ;
//   2. un client connecté atteint EXACTEMENT les fonctions que les migrations
//      lui ouvrent, lues dans leur TEXTE, dans l'ordre (grant, revoke, drop) —
//      ni une de plus (une porte oubliée), ni une de moins (un écran cassé en
//      production) — et ne lit que les tables qu'elles ouvrent ;
//   3. aucune table ne s'écrit en direct ;
//   4. la vie d'un client passe, comme dans l'application (0035) : e-mail et
//      mot de passe chez GoTrue, puis l'application d'authentification enrôlée
//      et vérifiée CHEZ GOTRUE (le code TOTP calculé ici) — une session sans ce
//      second facteur n'atteint rien ; codes de secours, compte ouvert, dépôt
//      crédité par TOTEM avec la clé de service ;
//   5. un client ne voit rien d'un autre, et n'administre rien.
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { inscrireParEmail } from "./inscription.mjs";

const ICI = new URL("../../", import.meta.url).pathname;
const REST = `http://127.0.0.1:${process.env.PORT_REST ?? 53000}`;
const AUTH = `http://127.0.0.1:${process.env.PORT_AUTH ?? 59999}`;
const SECRET = process.env.SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long";

let echecs = 0;
const ok = (t) => console.log(`✓ ${t}`);
const non = (t) => { echecs++; console.log(`✗ ${t}`); };
const exiger = (c, t, detail = "") => (c ? ok(t) : non(`${t}${detail ? `\n    ${detail}` : ""}`));

/* ------------------------------------------------------------ jetons */
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jeton = (charge) => {
  const tete = b64({ alg: "HS256", typ: "JWT" });
  const corps = b64({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...charge });
  return `${tete}.${corps}.${createHmac("sha256", SECRET).update(`${tete}.${corps}`).digest("base64url")}`;
};
const ANON = jeton({ role: "anon" });
const SERVICE = jeton({ role: "service_role" });

/* ------------------------------------------------------------ appels */
async function appel(chemin, { methode = "GET", corps, jeton: j = ANON } = {}) {
  const r = await fetch(`${REST}${chemin}`, {
    method: methode,
    headers: { apikey: ANON, authorization: `Bearer ${j}`, "content-type": "application/json", prefer: "return=representation" },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await r.text();
  let json = null;
  try { json = texte ? JSON.parse(texte) : null; } catch { json = texte; }
  return { statut: r.status, json };
}
const rpc = (nom, args, j) => appel(`/rpc/${nom}`, { methode: "POST", corps: args ?? {}, jeton: j });
/** Refusé par les DROITS (pas par la fonction) : 42501, ou PostgREST qui ne la propose pas. */
const refuse = (r) => r.json?.code === "42501" || r.json?.code === "PGRST202" || r.json?.code === "PGRST205";

function sql(requete) {
  const r = spawnSync("psql", ["-h", "127.0.0.1", "-p", process.env.PORT_DB ?? "55432", "-U", "supabase_admin", "-d", "postgres", "-Atc", requete],
    { env: { ...process.env, PGPASSWORD: process.env.MDP ?? "essai" }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql : ${r.stderr}`);
  return r.stdout.trim();
}

/* ------------------------------------- ce que les migrations ouvrent */
// Lu dans le TEXTE des migrations, pas dans le catalogue : comparer la base à
// elle-même ne prouverait rien. Toutes, dans l'ordre, et dans chacune les
// instructions dans l'ordre où elles s'écrivent : un « grant » ouvre, un
// « revoke » referme, un « drop function » emporte ses droits. Une instruction
// fabriquée dans un bloc (format, %s) ne se lit pas ici : elle se voit au
// catalogue, et le contrôle tombe — c'est voulu.
const ouvertes = new Set(), ouvertesAnon = new Set(), lisibles = new Set();
const MIGRATIONS = `${ICI}supabase/migrations/`;
for (const f of readdirSync(MIGRATIONS).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort()) {
  const texte = readFileSync(MIGRATIONS + f, "utf8").replace(/--[^\n]*/g, "");
  const gestes = [
    ...[...texte.matchAll(/(grant|revoke)\s+(?:execute|all)(?:\s+privileges)?\s+on\s+function\s+([^;]*?)\s+(?:to|from)\s+([a-z_,\s]+?);/gi)]
      .map((m) => ({ i: m.index, quoi: "fonction", verbe: m[1].toLowerCase(), noms: [...m[2].matchAll(/(?:public\.)?([a-z_0-9]+)\s*\(/g)].map((x) => x[1]), roles: m[3].split(",").map((x) => x.trim()) })),
    ...[...texte.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_0-9]+)\s*\(/gi)]
      .map((m) => ({ i: m.index, quoi: "fonction", verbe: "drop", noms: [m[1]], roles: ["public"] })),
    ...[...texte.matchAll(/(grant|revoke)\s+(?:select|all)(?:\s+privileges)?\s+on\s+(?!function|all\b|schema|sequence)(?:table\s+)?([^;]*?)\s+(?:to|from)\s+([a-z_,\s]+?);/gi)]
      .map((m) => ({ i: m.index, quoi: "table", verbe: m[1].toLowerCase(), noms: m[2].split(",").map((x) => x.trim().replace(/^public\./, "")), roles: m[3].split(",").map((x) => x.trim()) })),
  ].sort((a, b) => a.i - b.i);
  for (const g of gestes) {
    const pour = (role) => g.roles.includes(role) || (g.verbe !== "grant" && g.roles.includes("public"));
    const cibles = g.quoi === "table" ? [lisibles] : [ouvertes, ouvertesAnon];
    const roles = g.quoi === "table" ? ["authenticated"] : ["authenticated", "anon"];
    cibles.forEach((ensemble, k) => {
      if (!pour(roles[k]) && g.verbe !== "drop") return;
      for (const n of g.noms) g.verbe === "grant" ? ensemble.add(n) : ensemble.delete(n);
    });
  }
}

/* ------------------------------------------------- les inscriptions (inscription.mjs) */
const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const lire = (j) => JSON.parse(Buffer.from(j.split(".")[1], "base64url").toString());

/* =================================================================== */

const fonctions = sql(`select p.proname || '|' || coalesce(array_to_string(p.proargnames, ','), '') || '|' || p.pronargs
                         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype
                          and p.prokind = 'f' order by 1`).split("\n").filter(Boolean)
  .map((l) => { const [nom, args, n] = l.split("|"); return { nom, args: args ? args.split(",").slice(0, Number(n)) : [] }; });
const tables = sql(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`).split("\n").filter(Boolean);
// Pour éprouver une écriture, il faut une colonne qu'on POURRAIT écrire (ni générée, ni identité) :
// sinon la base refuse pour une autre raison que les droits, et l'épreuve ne prouve rien.
const colonne = Object.fromEntries(sql(`select distinct on (table_name) table_name || '|' || column_name from information_schema.columns
   where table_schema = 'public' and is_identity = 'NO' and is_generated = 'NEVER' and column_default is null
   order by table_name, ordinal_position`).split("\n").filter(Boolean).map((l) => l.split("|")));

// Une simple DEMANDE de code ne fait naître ni compte ni numéro vérifié : GoTrue crée l'utilisateur
// tout de suite, le déclencheur attend que le téléphone soit prouvé.
{
  const r = await fetch(`${AUTH}/otp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "237699120003" }) });
  const enAuth = Number(sql(`select count(*) from auth.users where phone = '237699120003'`));
  const comptes = Number(sql(`select count(*) from comptes where telephone = '699120003'`));
  exiger(r.ok && enAuth === 1 && comptes === 0, "demander un code ne fait naître aucun compte (GoTrue a créé l'utilisateur, le téléphone n'est pas prouvé)",
    `otp ${r.status} · auth.users ${enAuth} · comptes ${comptes}`);
}
const bob = await inscrireParEmail(AUTH, "bob.essomba@example.com");
const alice = await inscrireParEmail(AUTH, "alice.ngo@example.com");
exiger(lire(bob.jeton).aal === "aal2" && (lire(bob.jeton).amr ?? []).some((m) => m.method === "totp") && lire(bob.faible).aal === "aal1",
  "deux clients s'inscrivent comme dans l'application : e-mail et mot de passe, puis l'application d'authentification vérifiée par GoTrue (aal2)",
  JSON.stringify({ fort: lire(bob.jeton).aal, faible: lire(bob.faible).aal }));
/* la session d'avant le second facteur : le crochet de PostgREST (0035) ne la laisse qu'à l'écran d'entrée */
{
  const r1 = await rpc("mon_etat_d_entree", {}, bob.faible);
  const r2 = await rpc("mes_soldes", {}, bob.faible);
  const r3 = await appel("/comptes?select=id", { jeton: bob.faible });
  exiger(r1.statut === 200 && r2.statut >= 400 && /double authentification requise/.test(r2.json?.message ?? "") && r3.statut >= 400,
    "une session sans second facteur ne lit que son état d'entrée : ni solde, ni table", JSON.stringify({ entree: r1.statut, soldes: r2.json, table: r3.statut }));
}

/* 1 · anon */
{
  const atteintes = [];
  for (const f of fonctions) {
    const r = await rpc(f.nom, Object.fromEntries(f.args.map((a) => [a, null])), ANON);
    if (!refuse(r)) atteintes.push(`${f.nom} (${r.statut} ${r.json?.code ?? ""})`);
  }
  const inattendues = atteintes.filter((x) => !ouvertesAnon.has(x.split(" ")[0]));
  exiger(inattendues.length === 0, `anon n'atteint que ce qui lui est ouvert (${[...ouvertesAnon].sort().join(", ")}), parmi ${fonctions.length} fonctions`, inattendues.join(", "));
  const lues = [];
  for (const t of tables) { const r = await appel(`/${t}?limit=1`); if (!refuse(r)) lues.push(`${t} (${r.statut})`); }
  exiger(lues.length === 0, `anon ne lit aucune des ${tables.length} tables`, lues.join(", "));
}

/* 2 · un client connecté */
{
  const atteintes = new Set();
  for (const f of fonctions) {
    const r = await rpc(f.nom, Object.fromEntries(f.args.map((a) => [a, null])), bob.jeton);
    if (!refuse(r)) atteintes.add(f.nom);
  }
  const deTrop = [...atteintes].filter((n) => !ouvertes.has(n));
  const manquantes = [...ouvertes].filter((n) => !atteintes.has(n));
  exiger(deTrop.length === 0, "un client n'atteint aucune fonction que les migrations ne lui ouvrent pas", `de trop : ${deTrop.join(", ")}`);
  exiger(manquantes.length === 0, `un client atteint les ${ouvertes.size} fonctions que les migrations lui ouvrent (aucun écran cassé)`, `manquantes : ${manquantes.join(", ")}`);
  const lues = tables.filter((t) => !lisibles.has(t));
  const fuites = [];
  for (const t of lues) { const r = await appel(`/${t}?limit=1`, { jeton: bob.jeton }); if (!refuse(r)) fuites.push(`${t} (${r.statut})`); }
  exiger(fuites.length === 0, `un client ne lit aucune des ${lues.length} tables de service`, fuites.join(", "));
  const ecritures = [];
  for (const t of tables) {
    const c = colonne[t];
    if (!c) { ecritures.push(`${t} : aucune colonne à éprouver`); continue; }
    for (const [methode, chemin, corps] of [["POST", `/${t}`, { [c]: null }], ["PATCH", `/${t}?${c}=is.null`, { [c]: null }], ["DELETE", `/${t}?${c}=is.null`, undefined]]) {
      const r = await appel(chemin, { methode, corps, jeton: bob.jeton });
      if (r.json?.code !== "42501") ecritures.push(`${methode} ${t}.${c} → ${r.statut} ${r.json?.code ?? ""}`);
    }
  }
  exiger(ecritures.length === 0, `aucune des ${tables.length} tables ne s'écrit en direct (POST, PATCH, DELETE)`, ecritures.join(", "));
}

/* 4 · la vie d'un client */
{
  let r = await rpc("mon_compte", {}, bob.jeton);
  exiger(r.statut === 200 && r.json === null, "avant d'ouvrir son compte, Bob n'a pas de compte (rien ne naît de l'inscription seule)", JSON.stringify(r.json));
  r = await rpc("ouvrir_mon_compte", { p_prenom: "Bob", p_nom: "Essomba", p_naissance: "1990-05-14", p_telephone: "+237677120001", p_ville: "Douala", p_pays: "CM", p_conditions: "2026-10-29" }, bob.jeton);
  exiger(r.statut >= 400 && /codes de secours à noter/.test(r.json?.message ?? ""), "pas de compte sans codes de secours notés", JSON.stringify(r.json));
  for (const c of [bob, alice]) {
    r = await rpc("generer_codes_de_secours", {}, c.jeton);
    exiger(r.statut === 200 && Array.isArray(r.json?.codes) && r.json.codes.length === 10, `${c.email} reçoit dix codes de secours, montrés une fois`, JSON.stringify(r.json));
    r = await rpc("confirmer_codes_de_secours", {}, c.jeton);
    exiger(r.statut === 200, "…et dit les avoir notés", JSON.stringify(r.json));
  }
  r = await rpc("ouvrir_mon_compte", { p_prenom: "bob", p_nom: "d'essomba", p_naissance: "1990-05-14", p_telephone: "+237 6 77 12 00 01", p_ville: "douala", p_pays: "CM", p_conditions: "2026-10-29" }, bob.jeton);
  exiger(r.statut === 200 && r.json?.nom === "Bob D'Essomba" && r.json?.telephone === "+237677120001", "Bob ouvre son compte : le nom mis en forme sur la vraie base aussi (0046)", JSON.stringify(r.json));
  r = await rpc("ouvrir_mon_compte", { p_prenom: "Alice", p_nom: "Ngo", p_naissance: "1992-02-03", p_telephone: "+237677120001", p_ville: "Yaoundé", p_pays: "CM", p_conditions: "2026-10-29" }, alice.jeton);
  exiger(r.statut >= 400 && /ce numéro est déjà utilisé/.test(r.json?.message ?? ""), "un numéro ne sert qu'à un compte", JSON.stringify(r.json));
  r = await rpc("ouvrir_mon_compte", { p_prenom: "Alice", p_nom: "Ngo", p_naissance: "1992-02-03", p_telephone: "+237677120002", p_ville: "Yaoundé", p_pays: "CM", p_conditions: "2026-10-29" }, alice.jeton);
  exiger(r.statut === 200, "Alice ouvre le sien", JSON.stringify(r.json));
  r = await appel("/comptes?select=*", { jeton: bob.jeton });
  exiger(r.statut === 200 && r.json.length === 1 && r.json[0].id === bob.id && !Object.keys(r.json[0]).some((k) => /hash|empreinte/.test(k)), "Bob lit SA ligne de comptes, et aucune empreinte", JSON.stringify(r.json));

  // TOTEM, avec la clé de service, comme la porte
  sql(`insert into terminaux (id, nom, vu_le) values ('akwa-1', 'Akwa 1', now()) on conflict (id) do update set vu_le = now();
       insert into floats (operateur, numero, terminal) values ('mtn', '677000000', 'akwa-1') on conflict do nothing;`);
  r = await rpc("ouvrir_depot", { p_operateur: "mtn", p_cle: "k-api-1" }, bob.jeton);
  // le moteur choisit le float (le moins chargé d'un boîtier vivant) : Bob paie celui que son dossier lui indique
  const floatsMtn = sql(`select numero || '|' || terminal from floats where operateur = 'mtn' and actif`).split("\n").map((l) => l.split("|"));
  const leFloat = floatsMtn.find(([numero]) => numero === r.json?.float_numero);
  exiger(r.statut === 200 && Boolean(leFloat), "Bob ouvre un dossier de dépôt, qui lui dit quel float payer", JSON.stringify(r.json));
  const [floatNumero, floatTerminal] = leFloat ?? ["677000000", "akwa-1"];
  const ref = r.json.reference;
  // des identifiants à elle : l'épreuve peut passer après les scénarios, sur la même base
  const tx = `2039${String(Date.now()).slice(-7)}`;
  const source = 900_000 + Math.floor(Math.random() * 99_999);
  r = await rpc("declarer_transaction", { p_reference: ref, p_transaction_id: tx }, bob.jeton);
  exiger(r.json?.etat === "attendu", "il tape son transaction ID", JSON.stringify(r.json));
  r = await rpc("totem_sms_recu", { p_terminal: floatTerminal, p_source_id: source, p_operateur: "mtn", p_float_numero: floatNumero, p_numero_payeur: "677120001",
    p_montant: 250000, p_reference: tx, p_texte: "Vous avez recu 250000 FCFA…", p_emis_le: new Date().toISOString() }, bob.jeton);
  exiger(refuse(r), "Bob ne peut pas jouer TOTEM lui-même", JSON.stringify(r.json));
  r = await rpc("totem_sms_recu", { p_terminal: floatTerminal, p_source_id: source, p_operateur: "mtn", p_float_numero: floatNumero, p_numero_payeur: "677120001",
    p_montant: 250000, p_reference: tx, p_texte: "Vous avez recu 250000 FCFA…", p_emis_le: new Date().toISOString() }, SERVICE);
  exiger(r.statut === 200 && r.json?.resultat === "credite", "la clé de service (la porte de TOTEM) crédite", JSON.stringify(r.json));
  r = await rpc("mes_soldes", {}, bob.jeton);
  exiger(Number(r.json?.XAFe?.disponible) === 250000, "Bob voit 250 000 XAFe", JSON.stringify(r.json));

  /* 5 · cloisons */
  r = await appel(`/soldes?compte_id=eq.${bob.id}`, { jeton: alice.jeton });
  exiger(r.statut === 200 && Array.isArray(r.json) && r.json.length === 0, "Alice ne voit pas les soldes de Bob", JSON.stringify(r.json));
  r = await appel(`/depots?select=reference`, { jeton: alice.jeton });
  exiger(r.statut === 200 && r.json.length === 0, "ni ses dépôts", JSON.stringify(r.json));
  r = await rpc("mon_depot", { p_reference: ref }, alice.jeton);
  exiger(r.statut === 200 && r.json === null, "ni un dossier dont elle connaît la référence", JSON.stringify(r.json));
  r = await rpc("admin_tableau", {}, alice.jeton);
  exiger(r.statut >= 400 && /accès non autorisé/.test(r.json?.message ?? ""), "et elle n'administre rien", JSON.stringify(r.json));
  r = await rpc("crediter_crypto", { p_compte: alice.id, p_actif: "USDT", p_reseau: "bep20", p_montant: 1000000, p_tx_hash: "0xvol", p_adresse: "x" }, alice.jeton);
  exiger(refuse(r), "ni ne se frappe des USDT", JSON.stringify(r.json));
}

/* l'administrateur par e-mail : deux inscriptions, aucune ne tombe, aucun « client » */
{
  const statuts = [];
  for (const email of ["nelson@xafe.exchange", "ops@xafe.exchange"]) {
    const r = await fetch(`${AUTH}/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "un-mot-de-passe-long-1" }) });
    statuts.push(r.status);
  }
  const comptes = Number(sql(`select count(*) from comptes c join auth.users u on u.id = c.id where u.email like '%@xafe.exchange'`));
  exiger(statuts.every((s) => s === 200) && comptes === 0, "deux administrateurs s'inscrivent par e-mail ; aucun n'est un compte client", `statuts ${statuts} · comptes ${comptes}`);
}

console.log(echecs ? `✗ ${echecs} exigence(s) non tenue(s)` : "✓ l'API tient, sur une vraie pile Supabase");
process.exitCode = echecs ? 1 : 0;
