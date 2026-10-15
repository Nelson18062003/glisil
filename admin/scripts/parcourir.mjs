// L'ADMINISTRATION, PARCOURUE DANS UN VRAI CHROMIUM.
//
//   npm run build && node scripts/parcourir.mjs
//
// Se connecte en super admin, lit le tableau, rapproche un SMS retenu et
// vérifie que le client est crédité, rembourse un autre, crée un terminal et
// voit sa clé une fois, valide des pièces et voit le palier monter, ferme le
// marché, relit le journal — puis se connecte en support et exige de ne PAS
// voir les boutons qui ne sont pas à lui. Échoue à la première erreur de
// console. Captures dans admin/captures/.
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createConnection } from "node:net";

const PORT = 4190;
const BASE = `http://localhost:${PORT}`;
const OUT = new URL("../captures/", import.meta.url).pathname;
const { chromium } = createRequire(`${process.env.PLAYWRIGHT_ROOT || "/opt/node-tools/node_modules"}/`)("playwright");

const portPris = () => new Promise((r) => { const s = createConnection({ port: PORT, host: "127.0.0.1" }); s.once("connect", () => { s.destroy(); r(true); }); s.once("error", () => r(false)); });
if (await portPris()) { console.error(`✗ Le port ${PORT} est déjà pris.`); process.exit(1); }
const serveur = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: new URL("..", import.meta.url).pathname, stdio: "ignore", detached: true });
const arreter = () => { try { process.kill(-serveur.pid, "SIGTERM"); } catch { /* déjà parti */ } };
process.on("exit", arreter);
for (let i = 0; i < 60 && !(await portPris()); i++) await new Promise((r) => setTimeout(r, 250));

await mkdir(OUT, { recursive: true });
process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK ??= "1";
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;
const navigateur = await chromium.launch({ proxy });
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
const page = await contexte.newPage();
const erreurs = [];
page.on("pageerror", (e) => erreurs.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts.googleapis|net::ERR/.test(m.text())) erreurs.push(`console: ${m.text()}`); });
let n = 0;
const capturer = (nom) => page.screenshot({ path: `${OUT}${String(++n).padStart(2, "0")}-${nom}.png`, fullPage: true });
const voir = (t, delai = 15_000) => page.getByText(t, { exact: false }).first().waitFor({ timeout: delai });
const exiger = (c, m) => { if (!c) throw new Error(`✗ ${m}`); };
const etape = (t) => console.log(`· ${t}`);

try {
  etape("Connexion en super admin, tableau");
  await page.goto(`${BASE}/`);
  await page.waitForURL(/\/connexion$/);
  await capturer("connexion");
  await page.getByRole("button", { name: "Entrer" }).click();
  await page.waitForURL(`${BASE}/`);
  await voir("XAFe en circulation");
  await voir("SMS retenus");
  await capturer("tableau");

  etape("Entrées : rapprocher un SMS retenu, le client est crédité ; rembourser un autre");
  await page.goto(`${BASE}/clients/c2`);
  await voir("Jean Kamdem");
  const xafeAvant = await page.locator('[data-tuile="XAFe"] h4').innerText();
  await page.goto(`${BASE}/entrees?onglet=retenues`);
  await voir("PP2610121402A20394817501");
  await capturer("entrees-retenues");
  const ligne = page.getByRole("row").filter({ hasText: "PP2610121402A20394817501" });
  await ligne.getByRole("button", { name: "Rapprocher" }).click();
  await voir("Rapprocher PP2610121402A20394817501");
  await page.getByRole("combobox").click();
  await page.getByRole("option").filter({ hasText: "Jean Kamdem" }).first().click();
  await capturer("entrees-rapprocher");
  await page.getByRole("button", { name: "Créditer le client" }).click();
  await voir("150 000 XAFe crédités");
  exiger((await page.getByRole("row").filter({ hasText: "PP2610121402A20394817501" }).count()) === 0, "le SMS rapproché a quitté la liste des retenus");
  await page.goto(`${BASE}/clients/c2`);
  await voir("Jean Kamdem");
  const xafeApres = await page.locator('[data-tuile="XAFe"] h4').innerText();
  exiger(xafeAvant !== xafeApres, `le solde XAFe de Jean a changé (${xafeAvant} → ${xafeApres})`);
  await capturer("client-detail");
  await page.goto(`${BASE}/entrees?onglet=retenues`);
  await page.getByRole("row").filter({ hasText: "20394817502" }).getByRole("button", { name: "Rembourser" }).click();
  await page.getByLabel("Pourquoi").fill("payeur inconnu, aucun dossier");
  await page.getByRole("button", { name: "Rembourser par TOTEM" }).click();
  await voir("48 000 XAF à rembourser");
  await page.getByText("Remboursés").click();
  await voir("20394817502");

  etape("Sorties : libérer le transfert coincé");
  await page.goto(`${BASE}/sorties`);
  await voir("XAFe-WD-");
  await capturer("sorties");
  await page.getByRole("button", { name: /XAFe-WD-/ }).first().click();
  await page.getByRole("button", { name: "Libérer" }).click();
  await voir("en attente");

  etape("Terminaux : créer un boîtier, voir sa clé une fois");
  await page.goto(`${BASE}/terminaux`);
  await voir("Akwa 1");
  await capturer("terminaux");
  await page.getByRole("button", { name: "Nouveau terminal" }).click();
  await page.getByLabel("Identifiant").fill("kribi-1");
  await page.getByLabel("Nom").fill("Kribi plage");
  await page.getByLabel("Lieu").fill("Kribi");
  await page.getByRole("button", { name: "Créer et montrer la clé" }).click();
  await voir("La clé de kribi-1");
  const cle = await page.locator("[data-cle]").innerText();
  exiger(/^[0-9a-f]{64}$/.test(cle), `la clé fait 64 hexadécimaux (${cle.length})`);
  await capturer("terminaux-cle");
  await page.getByRole("button", { name: "Fermer" }).click();
  await voir("Kribi plage");
  /* renouveler une clé coupe le boîtier : on le demande, et « Annuler » ne touche à rien */
  await page.getByRole("button", { name: "Renouveler la clé" }).first().click();
  await voir("cesse de marcher");
  await page.getByRole("dialog").getByRole("button", { name: "Annuler" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  exiger(await page.locator("[data-cle]").count() === 0, "annuler ne renouvelle rien");
  await page.getByRole("button", { name: "Renouveler la clé" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Renouveler la clé" }).click();
  await page.locator("[data-cle]").waitFor();
  await page.getByRole("button", { name: "Fermer" }).click();

  etape("Clients : valider des pièces, le palier monte");
  await page.goto(`${BASE}/clients?filtre=verifications`);
  await voir("Paul Biya Mbarga");
  await capturer("clients-verifications");
  await page.goto(`${BASE}/clients/c5`);
  await voir("Identité à vérifier");
  await page.getByRole("button", { name: "Examiner les pièces" }).click();
  await page.getByRole("button", { name: /Valider → palier 1/ }).click();
  await page.getByText("Palier 1 · identité vérifiée").waitFor();
  exiger((await page.getByRole("button", { name: "Examiner les pièces" }).count()) === 0, "plus rien à examiner");

  etape("Marché : fermer puis rouvrir");
  await page.goto(`${BASE}/marche`);
  await voir("Dernières transactions");
  await capturer("marche");
  await page.getByLabel("marché ouvert").click();
  await voir("Marché fermé");
  await page.getByLabel("marché ouvert").click();
  await voir("Marché ouvert");

  etape("Paramètres et journal");
  await page.goto(`${BASE}/parametres`);
  await voir("MTN MoMo");
  await capturer("parametres");
  await page.goto(`${BASE}/journal`);
  await voir("a rapproché un SMS retenu");
  await voir("a remboursé un SMS retenu");
  await voir("a créé un terminal");
  await voir("a validé des pièces");
  await capturer("journal");

  etape("Le support ne voit que ce qui est à lui");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL(/\/connexion$/);
  await page.getByLabel("E-mail").fill("support@xafe.exchange");
  await page.getByLabel("Mot de passe").fill("demo");
  await page.getByRole("button", { name: "Entrer" }).click();
  await page.waitForURL(`${BASE}/`);
  await voir("Serge Kamga");
  await page.goto(`${BASE}/entrees?onglet=retenues`);
  await voir("PP2610120912B77410");
  exiger((await page.getByRole("button", { name: "Rapprocher" }).count()) === 0, "le support n'a pas le bouton Rapprocher");
  exiger((await page.getByRole("button", { name: "Rembourser" }).count()) === 0, "le support n'a pas le bouton Rembourser");
  await page.goto(`${BASE}/terminaux`);
  await voir("Akwa 1");
  exiger((await page.getByRole("button", { name: "Nouveau terminal" }).count()) === 0, "le support ne crée pas de terminal");
  await capturer("support-terminaux");

  exiger(erreurs.length === 0, `des erreurs ont été vues dans le navigateur :\n  ${erreurs.join("\n  ")}`);
  console.log(`✓ l'administration tient (${n} captures dans admin/captures/)`);
} catch (e) {
  await page.screenshot({ path: `${OUT}echec.png`, fullPage: true }).catch(() => {});
  console.error(e instanceof Error ? e.message : e);
  console.error(`  à ${page.url()}`);
  if (erreurs.length) console.error(`  erreurs du navigateur :\n  ${erreurs.join("\n  ")}`);
  process.exitCode = 1;
} finally {
  await navigateur.close();
  arreter();
}
