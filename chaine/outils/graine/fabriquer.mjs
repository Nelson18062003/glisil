// Fabrique outils/glisil-graine.html : la page de la graine, en UN fichier autonome.
//
//   node outils/graine/fabriquer.mjs       (depuis chaine/)
//
// entree.ts (avec src/cles.ts et ethers) est mis en paquet par esbuild, puis posé dans page.html à la
// place de /*BUNDLE*/. Le fichier se télécharge et s'ouvre hors ligne : rien n'est chargé d'ailleurs.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ICI = fileURLToPath(new URL(".", import.meta.url));
const esbuild = process.env.ESBUILD ?? fileURLToPath(new URL("../../../app/node_modules/.bin/esbuild", import.meta.url));
const paquet = execFileSync(esbuild, [`${ICI}entree.ts`, "--bundle", "--format=iife", "--global-name=Graine", "--minify", "--target=es2020", "--platform=browser", "--legal-comments=none"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (paquet.includes("</script")) throw new Error("le paquet contient « </script » : il fermerait la balise");
const page = readFileSync(`${ICI}page.html`, "utf8");
if (!page.includes("/*BUNDLE*/")) throw new Error("page.html : la place du paquet (/*BUNDLE*/) manque");
const sortie = page.replace("/*BUNDLE*/", () => paquet);
// deux sorties, un seul contenu : le fichier à ouvrir hors ligne (avec son doctype), et la page publiée en
// lien (la publication pose elle-même l'enveloppe)
for (const [nom, texte] of [["glisil-graine.html", `<!doctype html>\n${sortie}`], ["glisil-graine-lien.html", sortie]]) {
  const chemin = fileURLToPath(new URL(`../${nom}`, import.meta.url));
  writeFileSync(chemin, texte);
  console.log(`✓ ${chemin} (${Math.round(texte.length / 1024)} Ko, sha256 ${createHash("sha256").update(texte).digest("hex").slice(0, 16)}…)`);
}
