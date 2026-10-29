// LA PAGE DE LA GRAINE, ÉPROUVÉE dans un vrai Chromium — comme le propriétaire s'en servira.
//
//   node --experimental-strip-types outils/graine/verifier.mjs     (depuis chaine/, après fabriquer.mjs)
//
// Exige : en ligne, le bouton reste verrouillé ; hors ligne, 24 mots ; un mot faux est refusé ;
// les wallets chauds montrés sont EXACTEMENT ceux que src/cles.ts (le veilleur) dérive de ces mots ;
// la page ne fait aucune requête et n'écrit rien dans le navigateur ; ce qu'on copie ne porte que les
// adresses ; deux passages donnent deux graines.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { CHAUD, deriver } from "../../src/cles.ts";

const { chromium } = createRequire(`${process.env.PLAYWRIGHT_ROOT || "/opt/node-tools/node_modules"}/`)("playwright");
const PAGE = new URL("../glisil-graine.html", import.meta.url).href;
let echecs = 0;
const verifier = (cond, texte, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${texte}${cond || !detail ? "" : `\n    ${detail}`}`); if (!cond) echecs++; };

const navigateur = await chromium.launch();
const passage = async () => {
  const ctx = await navigateur.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const requetes = [];
  page.on("request", (r) => { if (!r.url().startsWith("file:")) requetes.push(r.url()); });
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(e.message));
  await page.goto(PAGE);
  const verrouEnLigne = await page.locator("#creer").isDisabled();
  await ctx.setOffline(true);
  await page.locator("#creer:not([disabled])").waitFor({ timeout: 5000 });
  await page.click("#creer");
  const mots = await page.locator("#mots .mot span").allTextContents();
  await page.click("#ecrits");
  const labels = await page.locator("#questions label").allTextContents();
  const positions = labels.map((l) => Number(l.match(/\d+/)[0]) - 1);
  // un mot faux d'abord : refusé, on reste sur l'écran
  await page.fill(`#q${positions[0]}`, mots[(positions[0] + 1) % 24] === mots[positions[0]] ? "zzz" : mots[(positions[0] + 1) % 24]);
  for (const p of positions.slice(1)) await page.fill(`#q${p}`, mots[p]);
  await page.click("#verifier");
  const refuse = !(await page.locator("#ecran-fin").isVisible()) && (await page.locator(".aide.faux").count()) === 1;
  for (const p of positions) await page.fill(`#q${p}`, ` ${mots[p].toUpperCase()} `);
  await page.click("#verifier");
  await page.locator("#ecran-fin").waitFor({ state: "visible", timeout: 5000 });
  const montrees = await page.locator("#adresses code").allTextContents();
  await page.click("#copier");
  const copie = await page.evaluate(() => navigator.clipboard.readText());
  const stockage = await page.evaluate(() => localStorage.length + sessionStorage.length);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  await ctx.close();
  return { verrouEnLigne, mots, positions, refuse, montrees, copie, stockage, requetes, erreurs, csp };
};

const a = await passage();
const b = await passage();
await navigateur.close();

verifier(a.verrouEnLigne, "en ligne, le bouton « Create the 24 words » reste verrouillé");
verifier(a.mots.length === 24 && new Set(a.mots).size > 12, `hors ligne, 24 mots (${a.mots.length})`);
const graine = a.mots.join(" ");
const attendues = ["bep20", "trc20", "erc20"].map((r) => deriver(graine, r, CHAUD).adresse);
verifier(JSON.stringify(a.montrees) === JSON.stringify(attendues), "les wallets chauds montrés sont ceux que le veilleur dérive (src/cles.ts) : BNB Chain, Tron, Ethereum",
  `page ${JSON.stringify(a.montrees)} ≠ cles.ts ${JSON.stringify(attendues)}`);
verifier(/^0x[0-9a-fA-F]{40}$/.test(a.montrees[0]) && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a.montrees[1]) && a.montrees[0] !== a.montrees[2],
  "une adresse BNB Chain, une adresse Tron, et Ethereum distincte de BNB Chain (compte 1)");
verifier(a.refuse, "un mot faux est refusé : on reste sur la vérification");
verifier(a.copie.split("\n").length === 3 && !a.mots.some((m) => new RegExp(`\\b${m}\\b`).test(a.copie.replace(/0x[0-9a-fA-F]+|T[1-9A-Za-z]{33}/g, ""))),
  "ce qu'on copie ne porte que les trois adresses, aucun mot", a.copie);
verifier(a.requetes.length === 0 && b.requetes.length === 0, "la page ne fait aucune requête", a.requetes.join(", "));
verifier(/default-src 'none'/.test(a.csp ?? ""), "la politique de contenu interdit toute connexion");
verifier(a.stockage === 0, "rien n'est écrit dans le navigateur (ni localStorage, ni sessionStorage)");
verifier(a.erreurs.length === 0 && b.erreurs.length === 0, "aucune erreur dans la page", [...a.erreurs, ...b.erreurs].join(" | "));
verifier(a.mots.join(" ") !== b.mots.join(" "), "deux passages, deux graines différentes");
console.log(echecs ? `✗ ${echecs} exigence(s) non tenue(s)` : "✓ la page de la graine tient");
process.exit(echecs ? 1 : 0);
