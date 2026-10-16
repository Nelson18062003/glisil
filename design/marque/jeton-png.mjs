// Les PNG du jeton XAFe, rendus par Chromium depuis le SVG (fond transparent hors du disque).
// Les tailles sont celles que demandent les registres : 32 et 64 (BscScan),
// 100 (Tronscan, 200 Ko au plus), 256 (Trust Wallet), 512 et 1024 (CoinGecko, réseaux).
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

/* playwright n'est pas une dépendance du dépôt : on le prend où l'environnement le range (NODE_PATH) */
const { chromium } = createRequire(`${process.cwd()}/`)("playwright");
const dossier = process.argv[2];
const svg = await readFile(`${dossier}/xafe-jeton.svg`, "utf8");
const navigateur = await chromium.launch();
for (const t of [32, 64, 100, 256, 512, 1024]) {
  const page = await navigateur.newPage({ viewport: { width: t, height: t }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="100" height="100"', `width="${t}" height="${t}"`)}</body></html>`);
  await page.screenshot({ path: `${dossier}/xafe-${t}.png`, omitBackground: true, clip: { x: 0, y: 0, width: t, height: t } });
  await page.close();
}
await navigateur.close();
console.log("PNG écrits");
