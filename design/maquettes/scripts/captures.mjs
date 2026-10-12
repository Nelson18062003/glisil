// Capture chaque écran en PNG depuis le serveur de prévisualisation.
//   npm run build && (npm run preview &) && npm run captures
// Android : 412 × 915 à 2×. Les fichiers vont dans design/captures/.
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

const requireFrom = createRequire(
  process.env.PLAYWRIGHT_ROOT ? `${process.env.PLAYWRIGHT_ROOT}/` : import.meta.url,
);
const { chromium } = requireFrom("playwright");

const BASE = process.env.CAPTURE_BASE ?? "http://localhost:4173";
const OUT = process.env.CAPTURE_OUT ?? "../captures";

const screens = [
  "connexion",
  "code",
  "accueil",
  "entrer/operateur",
  "entrer/montant",
  "entrer/payer",
  "entrer/confirme",
  "sortir/montant",
  "sortir/destination",
  "sortir/recap",
  "marche",
  "marche/carnet",
  "marche/acheter",
  "marche/ordre-place",
  "crypto",
  "crypto/deposer",
  "historique",
  "historique/detail",
  "compte",
];

await mkdir(OUT, { recursive: true });

// Derrière un proxy (polices Google), le serveur local doit rester en direct.
process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK ??= "1";
const proxy = process.env.HTTPS_PROXY
  ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }
  : undefined;
const browser = await chromium.launch({ proxy });
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  ignoreHTTPSErrors: true,
  locale: "fr-FR",
});

let i = 1;
for (const s of screens) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  ! erreur sur", s, String(e).slice(0, 200)));
  await page.goto(`${BASE}/client/${s}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const file = `${String(i++).padStart(2, "0")}-${s.replace(/\//g, "-")}`;
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true });
  await page.close();
  console.log("✓", file);
}
await browser.close();
