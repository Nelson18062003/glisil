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
const chemin = fileURLToPath(new URL("../glisil-graine.html", import.meta.url));
writeFileSync(chemin, sortie);
console.log(`✓ ${chemin} (${Math.round(sortie.length / 1024)} Ko, sha256 ${createHash("sha256").update(sortie).digest("hex").slice(0, 16)}…)`);
