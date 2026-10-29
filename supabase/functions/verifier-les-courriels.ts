// LES E-MAILS DE GLISIL, ÉPROUVÉS.
//
//   node --experimental-strip-types supabase/functions/verifier-les-courriels.ts
//
// Fait tourner le VRAI code (_shared/courriel.ts) sous Node, devant une fausse
// base et un faux Resend : chaque e-mail dans les deux langues, le montant et
// la destination écrits, un nom piégé échappé, la boucle qui survit à un
// échec, Resend repris ou abandonné selon sa réponse, rien de secret au
// journal, et la porte qui refuse sans le bon jeton. Chaque exigence a son
// témoin : une variante fautive qui doit échouer.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { echapper, envoyerParResend, GABARITS_CONNUS, heureDeDouala, jetonValide, montant, numero, rendre, traiterLaBoite, type Envoyer } from "./_shared/courriel.ts";

let n = 0;
const ok = (texte: string) => { n++; console.log(`✓ ${texte}`); };

const EXPIRE = "2026-10-29T13:10:00Z"; // 14:10 à Douala
const BASE = { code: "482913", expire_le: EXPIRE, cree_le: "2026-10-29T13:00:00Z", verification_id: "v-1" };
const OPERATIONS = {
  sortie_momo: { ...BASE, operation: "sortie_momo", montant: 1250000, frais: 6250, recu: 1243750, operateur: "mtn", operateur_nom: "MTN MoMo", numero: "677123456", nom: "Awa Ngono" },
  retrait_crypto: { ...BASE, operation: "retrait_crypto", actif: "USDT", montant: 12.5, frais: 1, reseau: "bsc", reseau_nom: "BNB Smart Chain", norme: "BEP20", adresse: "0x7908cf9242fb2018f3487908cf9242fb2018f348" },
  fermer_compte: { ...BASE, operation: "fermer_compte" },
  retirer_numero: { ...BASE, operation: "retirer_numero", operateur: "orange", operateur_nom: "Orange Money", numero: "699876543" },
};

/* ------------------------------------------------------- les écritures */
{
  assert.equal(montant(1250000, "fr"), "1 250 000");
  assert.equal(montant(1250000, "en"), "1,250,000");
  assert.equal(montant("12.5", "fr"), "12,5");
  assert.equal(montant("12.5", "en"), "12.5");
  assert.equal(montant(999, "en"), "999");
  assert.throws(() => montant("12 500", "en"), "un montant illisible n'est pas deviné");
  assert.equal(numero("677123456"), "6 77 12 34 56");
  assert.equal(heureDeDouala(EXPIRE, "fr"), "14:10");
  assert.equal(heureDeDouala("2026-10-29T23:30:00Z", "fr", true), "30/10/2026 à 00:30", "minuit à Douala change de jour");
  assert.equal(heureDeDouala("2026-10-29T23:30:00Z", "en", true), "Oct 30, 2026, 00:30");
  assert.equal(echapper(`<script>"x"&'y'</script>`), "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
  ok("les montants, les numéros et les heures s'écrivent dans la langue du client, à l'heure de Douala");
}

/* ------------------------------------------- chaque e-mail, deux langues */
{
  for (const [op, d] of Object.entries(OPERATIONS)) {
    const fr = rendre("verification", d, "fr"), en = rendre("verification", d, "en");
    for (const r of [fr, en]) {
      assert.ok(r.html.includes("482913") && r.texte.includes("482913"), `${op} : le code est dans l'e-mail`);
      assert.ok(!r.sujet.includes("482913"), `${op} : jamais le code dans l'objet (il s'affiche sur l'écran verrouillé)`);
      assert.ok(r.html.includes("14:10") && r.texte.includes("14:10"), `${op} : l'heure limite, à Douala`);
    }
    assert.ok(fr.html.includes('lang="fr"') && en.html.includes('lang="en"'), `${op} : une langue par e-mail`);
    assert.ok(fr.sujet.includes("confirmez") && en.sujet.includes("confirm") && !en.sujet.includes("confirmez"), `${op} : l'objet dans la langue`);
    assert.ok(!en.texte.includes("Ce n'est pas vous") && !fr.texte.includes("Not you?"), `${op} : pas de mélange des langues`);
  }
  const m = rendre("verification", OPERATIONS.sortie_momo, "en");
  for (const attendu of ["1,250,000 XAFe", "1,243,750 XAF", "MTN MoMo · 6 77 12 34 56", "Awa Ngono"]) assert.ok(m.html.includes(attendu) && m.texte.includes(attendu), `MoMo : « ${attendu} »`);
  const mf = rendre("verification", OPERATIONS.sortie_momo, "fr");
  assert.ok(mf.texte.includes("1 250 000 XAFe") && mf.texte.includes("Vers : MTN MoMo · 6 77 12 34 56"));
  const c = rendre("verification", OPERATIONS.retrait_crypto, "en");
  for (const attendu of ["12.5 USDT", "BNB Smart Chain (BEP20)", OPERATIONS.retrait_crypto.adresse]) assert.ok(c.html.includes(attendu) && c.texte.includes(attendu), `crypto : « ${attendu} »`);
  assert.ok(rendre("verification", OPERATIONS.fermer_compte, "en").sujet.includes("closing your Glisil account"));
  assert.ok(rendre("verification", OPERATIONS.retirer_numero, "fr").texte.includes("Orange Money · 6 99 87 65 43"));
  ok("le code avant sortie : chaque opération dit son montant et sa destination, dans la langue du client");

  const v = rendre("verification_verrouillee", { verrou_jusqua: "2026-10-29T14:05:00Z" }, "fr");
  assert.ok(v.texte.includes("29/10/2026 à 15:05") && v.sujet.includes("bloqués"));
  assert.ok(rendre("verification_verrouillee", { verrou_jusqua: "2026-10-29T14:05:00Z" }, "en").texte.includes("Oct 29, 2026, 15:05"));
  ok("le verrou après trop d'essais dit jusqu'à quand, dans la langue du client");

  assert.ok(rendre("verification", OPERATIONS.sortie_momo, null).html.includes('lang="en"'), "sans langue : l'anglais");
  assert.ok(rendre("verification", OPERATIONS.sortie_momo, "de").html.includes('lang="en"'), "une langue inconnue : l'anglais");
  ok("l'anglais est la langue par défaut");
}

/* ------------------------------- la double authentification retirée */
{
  const code = rendre("deux_facteurs_retires", { cause: "code_de_secours", quand: "2026-10-29T13:00:00Z" }, "fr");
  assert.ok(code.texte.includes("Un code de secours") && code.texte.includes("29/10/2026 à 14:00") && code.texte.includes("Ce n'est pas vous"));
  const equipe = rendre("deux_facteurs_retires", { cause: "administration", quand: "2026-10-29T13:00:00Z" }, "en");
  assert.ok(equipe.texte.includes("the Glisil team removed") && equipe.texte.includes("Oct 29, 2026, 14:00") && equipe.texte.includes("Not you?"));
  ok("la double authentification retirée : par quel moyen, quand, et quoi faire si ce n'est pas vous");
}

/* ----------------- chaque e-mail que la base met en file a son rendu */
{
  /* Lu dans les migrations : le nom écrit juste après le compte dans un appel à _envoyer_courriel (même
     par execute … using), ou en tête d'un « using ». Sans rendu, l'e-mail partirait en « rendu impossible ». */
  const dossier = new URL("../migrations/", import.meta.url);
  const sql = readdirSync(dossier).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(new URL(f, dossier), "utf8")).join("\n");
  const enFile = new Set<string>();
  for (const m of sql.matchAll(/_envoyer_courriel\(\s*[\w.]+\s*,\s*'([a-z_]+)'/g)) enFile.add(m[1]);
  for (const m of sql.matchAll(/_envoyer_courriel\(\$1[^']*'[\s\S]{0,120}?using\s+[\w.]+\s*,\s*'([a-z_]+)'/g)) enFile.add(m[1]);
  assert.ok(enFile.size >= 3 && enFile.has("deux_facteurs_retires"), `les gabarits lus dans les migrations : ${[...enFile].join(", ")}`);
  for (const g of enFile) assert.ok(GABARITS_CONNUS.includes(g), `la base met en file « ${g} », que la fonction ne sait pas écrire`);
  /* témoin : sans le dernier gabarit ajouté, la vérification le trouve manquant */
  const sansLui = GABARITS_CONNUS.filter((g) => g !== "deux_facteurs_retires");
  assert.ok([...enFile].some((g) => !sansLui.includes(g)), "témoin : un gabarit retiré se voit");
  ok(`chaque e-mail que la base met en file a son rendu (${[...enFile].sort().join(", ")}) — témoin pris`);
}

/* ------------------------------------------------- un nom piégé, échappé */
{
  const piege = "<script>alert(1)</script>";
  const r = rendre("verification", { ...OPERATIONS.sortie_momo, nom: piege, operateur_nom: `<img src=x onerror=alert(2)>` }, "fr");
  assert.ok(!r.html.includes("<script>") && !r.html.includes("<img"), "rien de ce que le client a tapé ne devient du HTML");
  assert.ok(r.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "le nom reste lisible, échappé");
  const a = rendre("verification", { ...OPERATIONS.retrait_crypto, adresse: `0xabc"><a href="https://piege">` }, "en");
  assert.ok(!a.html.includes('<a href="https://piege">'), "une adresse piégée n'ouvre pas de lien");
  /* témoin : un rendu qui n'échappe pas laisse passer la balise */
  const sansEchappement = (s: string) => `<td>${s}</td>`;
  assert.ok(sansEchappement(piege).includes("<script>"), "témoin : sans échappement, la balise passe");
  ok("un nom ou une adresse piégés sont échappés (témoin : sans échappement, la balise passe)");
}

/* --------------------------------------------- jamais d'e-mail incomplet */
{
  assert.throws(() => rendre("bienvenue", {}, "fr"), /gabarit inconnu/);
  assert.throws(() => rendre("constructor", {}, "fr"), /gabarit inconnu/, "un nom hérité d'Object n'est pas un gabarit");
  assert.throws(() => rendre("verification", { ...OPERATIONS.sortie_momo, code: undefined }, "fr"), /code/);
  assert.throws(() => rendre("verification", { ...OPERATIONS.sortie_momo, operation: "virement" }, "fr"), /opération inconnue/);
  assert.throws(() => rendre("verification", { ...OPERATIONS.sortie_momo, montant: null }, "fr"), /montant/);
  assert.throws(() => rendre("verification", { ...OPERATIONS.sortie_momo, expire_le: "demain" }, "fr"), /date/);
  ok("un gabarit inconnu, un code, un montant, une date ou une opération manquants : refusés, jamais un e-mail vide");
}

/* --------------------------------------------------------------- le jeton */
{
  const bon = "a".repeat(40);
  assert.equal(jetonValide(bon, bon), true);
  assert.equal(jetonValide("b".repeat(40), bon), false);
  assert.equal(jetonValide(bon.slice(0, 39), bon), false, "un préfixe ne suffit pas");
  assert.equal(jetonValide(bon + "x", bon), false, "un jeton plus long non plus");
  assert.equal(jetonValide(null, bon), false);
  assert.equal(jetonValide("", ""), false, "sans jeton attendu, personne n'entre — même avec un jeton vide");
  assert.equal(jetonValide("court", "court"), false, "un jeton attendu trop court est une configuration fautive : personne n'entre");
  assert.equal(jetonValide(bon, undefined), false);
  ok("la porte de la fonction : le bon jeton seulement ; sans jeton configuré, personne");
}

/* ------------------------------------------------------- la boîte, vidée */
type Ligne = { id: number; gabarit: string; donnees: Record<string, unknown>; email: string; langue: string; idempotence: string };
function fausseBase(lignes: Ligne[], opts: { prendreLeve?: number } = {}) {
  const resultats: Record<number, Record<string, unknown>> = {};
  const rpc = async (nom: string, args: Record<string, unknown>) => {
    if (nom === "courriels_a_traiter") return lignes.map((l) => l.id);
    if (nom === "courriel_prendre") {
      if (args.p_id === opts.prendreLeve) throw new Error("connexion perdue");
      return lignes.find((l) => l.id === args.p_id) ?? null;
    }
    if (nom === "courriel_resultat") { resultats[args.p_id as number] = args; return null; }
    throw new Error(`rpc inattendue : ${nom}`);
  };
  return { rpc, resultats };
}
const ligne = (id: number, extra: Partial<Ligne> = {}): Ligne => ({
  id, gabarit: "verification", donnees: OPERATIONS.sortie_momo, email: `client${id}@exemple.com`, langue: "fr", idempotence: `glisil-courriel-${id}`, ...extra,
});

{
  const envois: { a: string; idempotence: string; sujet: string }[] = [];
  const reponses: Record<string, Awaited<ReturnType<Envoyer>>> = {
    "client2@exemple.com": { ok: false, reessayer: true, erreur: "HTTP 429 rate_limit_exceeded" },
    "client3@exemple.com": { ok: false, reessayer: false, erreur: "HTTP 422 validation_error" },
  };
  const envoyer: Envoyer = async (m) => { envois.push(m); return reponses[m.a] ?? { ok: true, id: `re_${m.idempotence}` }; };
  const journal: string[] = [];
  const { rpc, resultats } = fausseBase([
    ligne(1),
    ligne(2),
    ligne(3),
    ligne(4, { gabarit: "inconnu" }),
    ligne(5, { langue: "en" }),
    ligne(6),
  ], { prendreLeve: 6 });
  const bilan = await traiterLaBoite({ rpc, envoyer, journal: (m) => journal.push(m) });

  assert.deepEqual(bilan, { vus: 6, envoyes: 2, a_reessayer: 2, echoues: 2 }, JSON.stringify(bilan));
  assert.deepEqual(resultats[1], { p_id: 1, p_ok: true, p_fournisseur_id: "re_glisil-courriel-1" });
  assert.equal(resultats[2].p_ok, false); assert.equal(resultats[2].p_definitif, false, "429 : repris plus tard");
  assert.equal(resultats[3].p_definitif, true, "422 : jamais repris");
  assert.equal(resultats[4].p_definitif, true, "un rendu impossible ne se reprend pas");
  assert.equal(envois.some((e) => e.a === "client4@exemple.com"), false, "un rendu impossible n'envoie rien");
  assert.ok(resultats[5]?.p_ok, "l'échec des précédentes n'a pas arrêté la suivante");
  assert.equal(resultats[6], undefined, "la base injoignable pour une ligne : rien d'écrit, elle redeviendra prenable");
  assert.deepEqual(envois.map((e) => e.idempotence), ["glisil-courriel-1", "glisil-courriel-2", "glisil-courriel-3", "glisil-courriel-5"], "une clé d'idempotence par ligne");
  assert.ok(envois.find((e) => e.a === "client5@exemple.com")!.sujet.includes("confirm "), "chaque e-mail dans la langue de SA ligne");
  const toutLeJournal = journal.join("\n");
  assert.ok(journal.length >= 4, toutLeJournal);
  assert.ok(!toutLeJournal.includes("482913") && !toutLeJournal.includes("@"), `ni code ni adresse au journal : ${toutLeJournal}`);
  ok("la boîte : envoyé, repris (429), abandonné (422, rendu impossible) ; un échec n'arrête pas les autres ; ni code ni adresse au journal");

  /* témoin : une boucle qui s'arrête au premier échec laisse la cinquième en file */
  const resultatsTemoin: Record<number, unknown> = {};
  const boucleFragile = async () => {
    for (const l of [ligne(3), ligne(5)]) {
      const r = await envoyer({ a: l.email, sujet: "", html: "", texte: "", idempotence: l.idempotence });
      if (!r.ok) throw new Error(r.erreur);
      resultatsTemoin[l.id] = r;
    }
  };
  await assert.rejects(boucleFragile);
  assert.equal(resultatsTemoin[5], undefined, "témoin : la boucle fragile n'a pas servi la suivante");
  ok("témoin : une boucle qui s'arrête au premier échec laisse les autres e-mails en file");
}

/* ------------------------------------------------------------ Resend */
{
  const appels: { url: string; init: RequestInit }[] = [];
  const reponse = (statut: number, corps: unknown) => new Response(JSON.stringify(corps), { status: statut });
  const fauxFetch = (statut: number, corps: unknown, leve = false) => (async (url: string, init: RequestInit) => {
    appels.push({ url, init });
    if (leve) throw new Error("ECONNRESET");
    return reponse(statut, corps);
  }) as unknown as typeof fetch;
  const m = { a: "client@exemple.com", sujet: "S", html: "<p>h</p>", texte: "t", idempotence: "glisil-courriel-9" };

  assert.deepEqual(await envoyerParResend("re_cle", "Glisil <code@glisil.com>", fauxFetch(200, { id: "abc" }))(m), { ok: true, id: "abc" });
  const { url, init } = appels[0];
  assert.equal(url, "https://api.resend.com/emails");
  const h = init.headers as Record<string, string>;
  assert.equal(h.authorization, "Bearer re_cle");
  assert.equal(h["idempotency-key"], "glisil-courriel-9", "la même ligne reprise ne part pas deux fois");
  assert.deepEqual(JSON.parse(String(init.body)), { from: "Glisil <code@glisil.com>", to: ["client@exemple.com"], subject: "S", html: "<p>h</p>", text: "t" });

  const r429 = await envoyerParResend("k", "e", fauxFetch(429, { name: "rate_limit_exceeded", message: "Too many requests" }))(m);
  assert.deepEqual(r429, { ok: false, reessayer: true, erreur: "HTTP 429 rate_limit_exceeded Too many requests" });
  assert.equal((await envoyerParResend("k", "e", fauxFetch(503, {}))(m) as { reessayer: boolean }).reessayer, true);
  assert.equal((await envoyerParResend("k", "e", fauxFetch(422, { name: "validation_error" }))(m) as { reessayer: boolean }).reessayer, false);
  assert.equal((await envoyerParResend("k", "e", fauxFetch(403, { name: "invalid_api_key" }))(m) as { reessayer: boolean }).reessayer, false);
  const coupe = await envoyerParResend("k", "e", fauxFetch(0, null, true))(m);
  assert.equal(coupe.ok, false); assert.equal((coupe as { reessayer: boolean }).reessayer, true, "une coupure réseau se reprend");
  assert.deepEqual(await envoyerParResend("k", "e", (async () => new Response("pas du json", { status: 200 })) as unknown as typeof fetch)(m), { ok: true, id: null }, "envoyé, même sans identifiant lisible");
  ok("Resend : la clé d'idempotence par ligne ; 429, 5xx et coupure repris ; les autres refus abandonnés");
}

console.log(`✓ les e-mails tiennent (${n} vérifications)`);
