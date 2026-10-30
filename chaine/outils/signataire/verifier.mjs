// LA PAGE DU SIGNATAIRE, ÉPROUVÉE dans un vrai Chromium — comme le propriétaire s'en servira.
//
//   node --experimental-strip-types outils/signataire/verifier.mjs   (depuis chaine/, après fabriquer.mjs signataire)
//
// Exige : sans appareil choisi, le bouton reste verrouillé (en ligne ou non : décision du 30/10) ; 24 mots ; un mot faux
// est refusé ; l'adresse MetaMask montrée est celle du compte 1 de MetaMask pour ces mots (le chemin témoin :
// la phrase bien connue de Hardhat donne 0xf39F…2266), l'adresse TronLink celle de m/44'/195'/0'/0/0 ; la
// page ne fait aucune requête et n'écrit rien dans le navigateur ; ce qu'on copie ne porte aucun mot ; deux
// passages donnent deux phrases.
import { HDNodeWallet, Wallet } from "ethers";
import { createRequire } from "node:module";
import { adresseTron } from "../../src/cles.ts";
import { adressesDuSignataire, CHEMIN_METAMASK } from "./entree.ts";

const { chromium } = createRequire(`${process.env.PLAYWRIGHT_ROOT || "/opt/node-tools/node_modules"}/`)("playwright");
const PAGE = new URL(`../${process.env.SIGNATAIRE_PAGE ?? "glisil-signataire.html"}`, import.meta.url).href;
let echecs = 0;
const verifier = (cond, texte, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${texte}${cond || !detail ? "" : `\n    ${detail}`}`); if (!cond) echecs++; };

/* le chemin témoin, hors de la page : la phrase de Hardhat, publique, et son compte 1 connu de tous */
const HARDHAT = "test test test test test test test test test test test junk".split(" ");
verifier(adressesDuSignataire(HARDHAT).metamask === "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  `le chemin MetaMask (${CHEMIN_METAMASK}) donne le compte 1 bien connu de la phrase de Hardhat`);

const navigateur = await chromium.launch();
const passage = async (appareil) => {
  const ctx = await navigateur.newContext({ permissions: ["clipboard-read", "clipboard-write"], viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const requetes = [];
  page.on("request", (r) => { if (!r.url().startsWith("file:")) requetes.push(r.url()); });
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(e.message));
  await page.goto(PAGE);
  const verrouSansAppareil = await page.locator("#creer").isDisabled();
  await page.getByLabel(appareil).check();
  await page.locator("#creer:not([disabled])").waitFor({ timeout: 5000 });
  await page.click("#creer");
  const titre = await page.locator("#titre-papier").textContent();
  const mots = await page.locator("#mots .mot span").allTextContents();
  await page.click("#ecrits");
  const labels = await page.locator("#questions label").allTextContents();
  const positions = labels.map((l) => Number(l.match(/\d+/)[0]) - 1);
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
  return { verrouSansAppareil, titre, mots, refuse, montrees, copie, stockage, requetes, erreurs, csp };
};

const a = await passage("Phone 1");
const b = await passage("Computer");
await navigateur.close();

verifier(a.verrouSansAppareil, "sans appareil choisi, le bouton reste verrouillé");
verifier(a.titre === "GLISIL SIGNER — PHONE 1" && b.titre === "GLISIL SIGNER — COMPUTER", `le titre du papier nomme l'appareil (${a.titre})`);
verifier(a.mots.length === 24 && new Set(a.mots).size > 12, `en ligne, 24 mots (${a.mots.length})`);
const phrase = a.mots.join(" ");
/* l'attendu par un autre chemin du code : Wallet.fromPhrase (compte 1 par défaut, celui de MetaMask) */
const attenduMetamask = Wallet.fromPhrase(phrase).address;
const attenduTron = adresseTron(HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/195'/0'/0/0").address);
verifier(JSON.stringify(a.montrees) === JSON.stringify([attenduMetamask, attenduTron]),
  "les adresses montrées sont le compte 1 de MetaMask et le premier compte de TronLink pour ces mots",
  `page ${JSON.stringify(a.montrees)} ≠ ${JSON.stringify([attenduMetamask, attenduTron])}`);
verifier(/^0x[0-9a-fA-F]{40}$/.test(a.montrees[0]) && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a.montrees[1]), "une adresse 0x… et une adresse T…");
verifier(a.refuse, "un mot faux est refusé : on reste sur la vérification");
verifier(!a.mots.some((m) => new RegExp(`\\b${m}\\b`, "i").test(a.copie.replace(/0x[0-9a-fA-F]+|T[1-9A-Za-z]{33}|Glisil signer — Phone 1|MetaMask|TronLink/g, ""))),
  "ce qu'on copie ne porte que les deux adresses, aucun mot", a.copie);
verifier(a.copie.includes(a.montrees[0]) && a.copie.includes(a.montrees[1]) && a.copie.includes("Phone 1"), "la copie nomme l'appareil et porte les deux adresses");
verifier(a.requetes.length === 0 && b.requetes.length === 0, "la page ne fait aucune requête, connexion ouverte", a.requetes.join(", "));
verifier(/default-src 'none'/.test(a.csp ?? ""), "la politique de contenu interdit toute connexion");
verifier(a.stockage === 0, "rien n'est écrit dans le navigateur (ni localStorage, ni sessionStorage)");
verifier(a.erreurs.length === 0 && b.erreurs.length === 0, "aucune erreur dans la page", [...a.erreurs, ...b.erreurs].join(" | "));
verifier(phrase !== b.mots.join(" ") && a.montrees[0] !== b.montrees[0], "deux appareils, deux phrases, deux adresses");
console.log(echecs ? `✗ ${echecs} exigence(s) non tenue(s)` : "✓ la page du signataire tient");
process.exit(echecs ? 1 : 0);
