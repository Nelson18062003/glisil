// CHAQUE TEXTE DANS LES DEUX LANGUES. Lit le code des écrans (sans le lancer)
// et cherche ce qu'un utilisateur lirait — un texte entre balises, une chaîne
// qui ressemble à une phrase — et qui n'est pas passé par t("…", "…").
//
//   node scripts/langue.mjs            la liste, fichier par fichier ; échoue s'il en reste
//   node scripts/langue.mjs --compte   le nombre seulement, par fichier
//
// C'est une lecture du code, pas un rendu : elle repère ce qui A L'AIR d'un
// texte. Une chaîne technique qui y ressemble (une classe CSS, un nom de
// réseau) se marque « // langue-ok » en fin de ligne. Le harnais porte son
// témoin : un écran fabriqué avec trois textes oubliés doit en montrer trois.
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const RACINE = new URL("../src/", import.meta.url).pathname;
// des données, pas des écrans : le faux guichet des captures, les types, le thème
const EXCLUS = new Set(["guichet/demo.ts", "guichet/types.ts", "theme.ts", "noyau/langue.ts", "noyau/serveur.ts"]); // serveur.ts : la table de traduction des textes de la base
const MARQUES = /^(XAFe|XAF|USDT|USDC|USD Coin|Tether USD|ERC20|Ethereum|USDT\/XAFe|USDC\/XAFe|MTN|MTN MoMo|Orange|Orange Money|Glisil|TOTEM|BNB|BEP20|TRC20|BSC|Tron|MoMo|OM|PDF|ID|OTP|KYC|FCFA|BscScan|TronScan|TradingView|WhatsApp|Binance)$/;
const MOTS = /\b(le|la|les|des|du|de|un|une|et|ou|pour|vos|votre|vous|sur|par|en|au|aux|est|pas|ne|sans|avec|dans|plus|ce|cette|qui|que|il|elle|on|nous|à|son|sa|ses)\b/i;
const ACCENTS = /[àâäçéèêëîïôöùûüÿœæÀÂÇÉÈÊËÎÏÔÙÛÜŒ]/;
// les attributs JSX et les clés d'objet qui ne s'affichent jamais
const TECHNIQUES = new Set(["to", "href", "component", "variant", "color", "size", "key", "id", "type", "sx", "className", "inputMode",
  "autoComplete", "name", "mode", "tone", "badge", "align", "direction", "justifyContent", "alignItems", "fontFamily", "display",
  "position", "src", "rel", "target", "role", "data-chaine", "data-bandeau-beta", "fontWeight", "textAlign", "edge", "anchor",
  "aria-hidden", "kind", "ton", "rightColor", "hintColor", "nature", "etat", "operateur", "reseau", "actif", "icone", "tab",
  "back", "method", "pattern", "format", "lang", "dir", "accept", "capture", "orientation", "placement", "fontSize"]);

export function ressembleATexte(s, jsxTexte = false) {
  const v = s.trim();
  if (!v || !/\p{L}/u.test(v)) return false;
  if (MARQUES.test(v)) return false;
  if (jsxTexte) return true;
  if (/^[a-z0-9_\-./:#?=&%]+$/.test(v)) return false;           // un chemin, une clé, un identifiant
  if (/^[A-Z0-9_\-]+$/.test(v)) return false;                    // un sigle
  if (ACCENTS.test(v)) return true;
  const mots = v.split(/\s+/).filter((m) => /\p{L}/u.test(m));
  if (/^\p{Lu}\p{Ll}+/u.test(v)) return true;                    // « Compte », « Tout voir »
  return mots.length >= 2 && MOTS.test(v);
}

function dansT(n) {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === "t") return true;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isTypeNode(p)) return true;
  }
  return false;
}

function cleTechnique(n) {
  const p = n.parent;
  if (p && ts.isJsxAttribute(p)) return TECHNIQUES.has(p.name.getText());
  if (p && ts.isJsxExpression(p) && p.parent && ts.isJsxAttribute(p.parent)) return TECHNIQUES.has(p.parent.name.getText());
  if (p && ts.isPropertyAssignment(p) && p.initializer === n) return TECHNIQUES.has(p.name.getText().replace(/["']/g, ""));
  if (p && (ts.isBinaryExpression(p) || ts.isCaseClause(p) || ts.isElementAccessExpression(p))) {
    // une comparaison (« etat === "en_attente" »), un case, un index : du code
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(p.operatorToken.kind)) return true;
    if (!ts.isBinaryExpression(p)) return true;
  }
  return false;
}

export function oublis(fichier, source) {
  const sf = ts.createSourceFile(fichier, source, ts.ScriptTarget.Latest, true, fichier.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lignes = source.split("\n");
  const trouve = [];
  const noter = (n, texte) => {
    const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
    if (/langue-ok/.test(lignes[line] ?? "")) return;
    trouve.push({ ligne: line + 1, texte: texte.trim().replace(/\s+/g, " ").slice(0, 90) });
  };
  const visiter = (n) => {
    if (ts.isJsxText(n)) {
      if (ressembleATexte(n.text, true)) noter(n, n.text);
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (!dansT(n) && !cleTechnique(n) && ressembleATexte(n.text)) noter(n, n.text);
    } else if (ts.isTemplateExpression(n)) {
      const brut = n.head.text + n.templateSpans.map((s) => " " + s.literal.text).join("");
      if (!dansT(n) && !cleTechnique(n) && ressembleATexte(brut)) noter(n, n.getText());
      ts.forEachChild(n, visiter);
      return;
    } else if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "t" && n.arguments.length !== 2) {
      noter(n, `t(…) sans sa traduction : ${n.getText().slice(0, 60)}`);
    }
    ts.forEachChild(n, visiter);
  };
  visiter(sf);
  return trouve;
}

function fichiers(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const p = path.join(dossier, nom);
    if (statSync(p).isDirectory()) return fichiers(p);
    return /\.(tsx?|ts)$/.test(nom) && !/\.test\.ts$/.test(nom) ? [p] : [];
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // le témoin : trois textes oubliés, un traduit, un technique
  const temoin = oublis("temoin.tsx", `const a = <p>Bonjour</p>; const b = <X label="Tout voir" />; const c = { titre: "Votre solde" };
    const d = t("Traduit", "Translated"); const e = <Box sx={{ display: "flex" }} variant="contained" />; const f = x === "en_attente";`);
  if (temoin.length !== 3) { console.error(`✗ le témoin devait montrer 3 oublis, il en montre ${temoin.length}`, temoin); process.exit(2); }

  const compte = process.argv.includes("--compte");
  let total = 0;
  for (const f of fichiers(RACINE).sort()) {
    const rel = path.relative(RACINE, f);
    if (EXCLUS.has(rel)) continue;
    const o = oublis(rel, readFileSync(f, "utf8"));
    if (!o.length) continue;
    total += o.length;
    console.log(`${String(o.length).padStart(4)}  ${rel}`);
    if (!compte) for (const x of o) console.log(`        ${rel}:${x.ligne}  ${x.texte}`);
  }
  console.log(total === 0 ? "✓ chaque texte est dans les deux langues (témoin pris)" : `✗ ${total} texte(s) sans leur anglais`);
  process.exit(total === 0 ? 0 : 1);
}
