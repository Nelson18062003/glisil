// Capture chaque écran des maquettes en PNG, depuis le serveur de prévisualisation.
//   npm run build && (npm run preview &) && npm run captures
// Les fichiers vont dans design/captures/ (client : 390×844 à 2×, admin : 1440×900).
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

// Playwright peut vivre ailleurs que dans ce projet (PLAYWRIGHT_ROOT = dossier
// node_modules qui le contient) ; sinon on le cherche ici.
const requireFrom = createRequire(
  process.env.PLAYWRIGHT_ROOT ? `${process.env.PLAYWRIGHT_ROOT}/` : import.meta.url,
);
const { chromium } = requireFrom("playwright");

const BASE = process.env.CAPTURE_BASE ?? "http://localhost:4173";
const OUT = process.env.CAPTURE_OUT ?? "../captures";

const client = [
  "connexion",
  "portefeuille",
  "entrer-xaf",
  "suivi-depot",
  "sortir-xaf",
  "marche",
  "crypto",
  "historique",
  "compte",
];
const admin = ["reserves", "entrees", "sorties", "terminaux", "marche", "clients"];

await mkdir(OUT, { recursive: true });

// Derrière un proxy (polices Google), le serveur local doit rester en direct :
// Playwright force sinon le trafic local à travers le proxy, et la page
// capturée est celle du proxy, pas la nôtre.
process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK ??= "1";
const proxy = process.env.HTTPS_PROXY
  ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }
  : undefined;
const browser = await chromium.launch({ proxy });

async function shoot(
  path,
  file,
  { width, height, scale },
) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    ignoreHTTPSErrors: true,
    locale: "fr-FR",
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true });
  await ctx.close();
  console.log("✓", file);
}

let i = 1;
for (const s of client) {
  await shoot(`/client/${s}`, `client-${String(i++).padStart(2, "0")}-${s}`, {
    width: 390,
    height: 844,
    scale: 2,
  });
}
i = 1;
for (const s of admin) {
  await shoot(`/admin/${s}`, `admin-${String(i++).padStart(2, "0")}-${s}`, {
    width: 1440,
    height: 900,
    scale: 1,
  });
}
await browser.close();
