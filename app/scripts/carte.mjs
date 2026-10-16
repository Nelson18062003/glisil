// LA CARTE DES ÉCRANS, TIRÉE DU CODE — PAS D'UN DESSIN.
//
//   node scripts/carte.mjs            vérifie, et réécrit design/CARTE.md
//   node scripts/carte.mjs --verifier vérifie seulement (pour la CI)
//
// Lit les chemins de navigation/routes.tsx, puis, écran par écran, chaque
// façon d'en sortir écrite dans le code : un lien (to=, to:), une flèche
// (back=), une croix (fermer=), un navigate(…), la barre d'onglets. Il en fait
// un graphe et exige quatre choses :
//   1. aucun lien ne mène nulle part (un chemin qui n'est pas une route) ;
//   2. chaque écran s'atteint depuis l'Accueil, ou est une porte d'entrée
//      connue (Bienvenue, les textes publics, une notification) ;
//   3. chaque écran a une sortie : on ne se retrouve jamais coincé ;
//   4. aucun écran n'est à plus de PROFONDEUR_MAX touchers de l'Accueil.
// Puis il rejoue les mêmes contrôles sur un graphe ABÎMÉ exprès (un écran
// orphelin, un lien mort, un cul-de-sac) : s'il ne les voit pas, c'est le
// contrôle qui est faux, et il s'arrête. Un contrôle qui ne peut pas échouer
// ne contrôle rien.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RACINE = new URL("..", import.meta.url).pathname;
const SRC = join(RACINE, "src");
/* le plus long : Accueil → Crypto → adresse → montant → vérifier → code → envoyé.
   Un parcours d'argent ne doit pas s'allonger au-delà. */
const PROFONDEUR_MAX = 6;
/* les portes d'entrée : on y arrive de l'extérieur (un lien, une notification, l'ouverture) */
const ENTREES = ["/", "/bienvenue", "/conditions", "/confidentialite"];
/* les écrans qu'une notification ouvre : leur cible vient de la base (n.cible) */
const PAR_NOTIFICATION = ["/historique/:ref", "/compte/paliers", "/marche/ordres/:id"];

/* ------------------------------------------------------------ lecture */

async function fichiers(dossier) {
  const tout = [];
  for (const e of await readdir(dossier, { withFileTypes: true })) {
    const p = join(dossier, e.name);
    if (e.isDirectory()) tout.push(...(await fichiers(p)));
    else if (p.endsWith(".tsx")) tout.push(p);
  }
  return tout;
}

/** route → composant, d'après routes.tsx */
async function lireRoutes() {
  const s = await readFile(join(SRC, "navigation/routes.tsx"), "utf8");
  const routes = [];
  for (const m of s.matchAll(/\{\s*path:\s*"([^"]+)",\s*element:\s*<(\w+)[^}]*\}/g)) {
    if (m[1] === "*" || m[2] === "Navigate") continue;
    routes.push({ chemin: m[1], composant: m[2] });
  }
  return routes;
}

/**
 * Découpe un fichier en fonctions de premier niveau. Les liens d'une fonction
 * interne (non exportée) vont aux écrans du même fichier qui l'emploient.
 */
function decouper(source) {
  const blocs = [];
  const re = /^(export )?(?:function (\w+)|const (\w+) = )/gm;
  const debuts = [...source.matchAll(re)].map((m) => ({ nom: m[2] ?? m[3], exporte: Boolean(m[1]), debut: m.index }));
  debuts.forEach((d, i) => blocs.push({ ...d, texte: source.slice(d.debut, debuts[i + 1]?.debut ?? source.length) }));
  return blocs;
}

/** Les chemins que ce texte ouvre, et de quelle façon. */
function liens(texte) {
  const trouves = [];
  const pousser = (brut, facon) => {
    let c = brut.replace(/\$\{[^}]*\}/g, "*").split("?")[0];
    if (!c.startsWith("/")) return;
    if (c.length > 1) c = c.replace(/\/$/, "");
    trouves.push({ vers: c, facon });
  };
  const chaine = String.raw`(?:"([^"]*)"|\x60([^\x60]*)\x60)`;
  for (const [re, facon] of [
    [new RegExp(String.raw`\bto=\{?` + chaine, "g"), "lien"],
    [new RegExp(String.raw`\bto:\s*` + chaine, "g"), "lien"],
    [new RegExp(String.raw`\bback=\{?` + chaine, "g"), "retour"],
    [new RegExp(String.raw`\bfermer=\{?` + chaine, "g"), "croix"],
    [new RegExp(String.raw`navigate\(\s*` + chaine, "g"), "lien"],
    [new RegExp(String.raw`poserRetour\(\s*` + chaine, "g"), "retour"],
  ]) for (const m of texte.matchAll(re)) pousser(m[1] ?? m[2], facon);
  /* navigate(a ? "/x" : "/y") : les deux branches */
  for (const m of texte.matchAll(/navigate\(([^;]*?)\)/g)) for (const n of m[1].matchAll(/"(\/[^"]*)"/g)) pousser(n[1], "lien");
  return trouves;
}

/** Un chemin écrit (avec * pour une variable) correspond-il à une route (avec :param) ? */
function correspond(ecrit, route) {
  const a = ecrit.split("/"), b = route.split("/");
  return a.length === b.length && a.every((x, i) => x === b[i] || x === "*" || b[i].startsWith(":") || (x.includes("*") && b[i].startsWith(":")));
}

async function construire() {
  const routes = await lireRoutes();
  const parComposant = new Map();
  for (const r of routes) parComposant.set(r.composant, [...(parComposant.get(r.composant) ?? []), r.chemin]);
  const aretes = []; /* { de, vers, facon } */
  const sorties = new Map(); /* chemin → raisons d'en sortir */
  const morts = [];
  const resoudre = (ecrit) => routes.find((r) => correspond(ecrit, r.chemin))?.chemin ?? null;

  const ui = await readFile(join(SRC, "ui/index.tsx"), "utf8");
  /* les quatre maisons : la constante ONGLETS, que la barre du bas ET le rail latéral affichent */
  const blocOnglets = ui.slice(ui.indexOf("export const ONGLETS"), ui.indexOf("export const ongletDuChemin"));
  const ongletsDeLaBarre = [...blocOnglets.matchAll(/to:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (ongletsDeLaBarre.length !== 4) { console.error(`✗ les onglets ne se lisent plus dans ui/index.tsx (${ongletsDeLaBarre.length} trouvés)`); process.exit(2); }

  for (const f of await fichiers(join(SRC, "ecrans"))) {
    const blocs = decouper(await readFile(f, "utf8"));
    for (const bloc of blocs) {
      /* qui porte les liens de ce bloc : lui-même s'il est un écran, sinon les écrans du fichier qui l'emploient */
      const porteurs = parComposant.has(bloc.nom) ? [bloc.nom]
        : blocs.filter((b) => b !== bloc && parComposant.has(b.nom) && new RegExp(`<${bloc.nom}\\b|${bloc.nom}\\(`).test(b.texte)).map((b) => b.nom);
      const ls = liens(bloc.texte);
      for (const p of porteurs) for (const de of parComposant.get(p)) {
        for (const l of ls) {
          const vers = resoudre(l.vers);
          if (!vers) { morts.push({ de, ecrit: l.vers, fichier: f.replace(RACINE, "") }); continue; }
          if (vers !== de) aretes.push({ de, vers, facon: l.facon });
        }
        const raisons = sorties.get(de) ?? new Set();
        if (/\btab="/.test(bloc.texte)) { raisons.add("onglets"); for (const o of ongletsDeLaBarre) if (o !== de) aretes.push({ de, vers: o, facon: "onglet" }); }
        if (/\bonBack=/.test(bloc.texte)) raisons.add("flèche");
        if (ls.some((l) => l.facon !== "lien")) raisons.add(ls.find((l) => l.facon !== "lien").facon === "croix" ? "croix" : "flèche");
        if (ls.some((l) => l.facon === "lien")) raisons.add("lien");
        sorties.set(de, raisons);
      }
    }
  }
  /* les écrans de garde (verrou, conditions, compte fermé) ne sont pas des routes : ils se posent par-dessus */
  return { routes: routes.map((r) => r.chemin), aretes: dedoublonner(aretes), sorties, morts, onglets: ongletsDeLaBarre };
}

const dedoublonner = (as) => [...new Map(as.map((a) => [`${a.de}→${a.vers}→${a.facon}`, a])).values()];

/* ------------------------------------------------------------ contrôles */

function controler({ routes, aretes, sorties, morts }) {
  const fautes = [];
  for (const m of morts) fautes.push(`lien mort : ${m.de} mène à « ${m.ecrit} », qui n'est pas un écran (${m.fichier})`);
  /* profondeur : en largeur depuis les entrées ; une notification compte pour un toucher depuis l'Accueil */
  const profondeur = new Map(ENTREES.filter((e) => routes.includes(e)).map((e) => [e, 0]));
  for (const n of PAR_NOTIFICATION) if (routes.includes(n) && !profondeur.has(n)) profondeur.set(n, 2);
  const file = [...profondeur.keys()];
  while (file.length) {
    const de = file.shift();
    for (const a of aretes.filter((x) => x.de === de && x.facon !== "retour")) {
      if (!profondeur.has(a.vers)) { profondeur.set(a.vers, profondeur.get(de) + 1); file.push(a.vers); }
    }
  }
  for (const r of routes) {
    if (!profondeur.has(r)) fautes.push(`inatteignable : ${r} — aucun écran n'y mène`);
    else if (profondeur.get(r) > PROFONDEUR_MAX) fautes.push(`trop profond : ${r} est à ${profondeur.get(r)} touchers de l'Accueil (au plus ${PROFONDEUR_MAX})`);
    const s = sorties.get(r);
    if (!s || s.size === 0) fautes.push(`cul-de-sac : ${r} n'a ni flèche, ni croix, ni onglets, ni lien`);
  }
  return { fautes, profondeur };
}

/* ------------------------------------------------------------ le témoin */

function temoin(graphe) {
  const abime = structuredClone({ ...graphe, sorties: [...graphe.sorties].map(([k, v]) => [k, [...v]]) });
  abime.sorties = new Map(abime.sorties.map(([k, v]) => [k, new Set(v)]));
  abime.routes.push("/orphelin", "/impasse");
  abime.aretes.push({ de: "/", vers: "/impasse", facon: "lien" });
  abime.morts.push({ de: "/", ecrit: "/nulle-part", fichier: "témoin" });
  const { fautes } = controler(abime);
  const attendues = [/inatteignable : \/orphelin/, /cul-de-sac : \/impasse/, /lien mort : \/ mène à « \/nulle-part »/];
  const ratees = attendues.filter((re) => !fautes.some((f) => re.test(f)));
  if (ratees.length) {
    console.error(`✗ le TÉMOIN n'a pas été pris : ${ratees.join(", ")} — c'est le contrôle qui est faux`);
    process.exit(2);
  }
}

/* ------------------------------------------------------------ la carte écrite */

const MODULES = [
  ["Entrer dans l'application", (r) => r.startsWith("/bienvenue") || r === "/conditions" || r === "/confidentialite"],
  ["Accueil", (r) => r === "/" || r === "/notifications"],
  ["Entrer des XAF", (r) => r.startsWith("/entrer")],
  ["Sortir des XAF", (r) => r.startsWith("/sortir")],
  ["Marché", (r) => r.startsWith("/marche")],
  ["Achat rapide", (r) => r.startsWith("/rapide")],
  ["Crypto", (r) => r.startsWith("/crypto")],
  ["Historique", (r) => r.startsWith("/historique")],
  ["Compte", (r) => r.startsWith("/compte")],
];

function ecrireCarte(g, profondeur) {
  const id = (r) => (r === "/" ? "accueil" : r.slice(1).replace(/[/:]/g, "_").replace(/[^\w]/g, ""));
  const lignes = [];
  lignes.push("# La carte des écrans", "",
    "*Tirée du code par `app/scripts/carte.mjs` — ne pas modifier à la main. Relancer `node scripts/carte.mjs` après tout changement de navigation.*", "",
    `${g.routes.length} écrans · ${g.aretes.filter((a) => a.facon !== "onglet").length} passages (sans compter la barre d'onglets, présente sur les quatre écrans racines).`, "",
    "## Les modules et leurs passages", "", "```mermaid", "flowchart LR");
  for (const [nom, dans] of MODULES) {
    const rs = g.routes.filter(dans);
    if (!rs.length) continue;
    lignes.push(`  subgraph m_${nom.normalize("NFD").replace(/[^\w]/g, "")}["${nom}"]`);
    for (const r of rs) lignes.push(`    ${id(r)}["${r}"]`);
    lignes.push("  end");
  }
  for (const a of g.aretes.filter((x) => x.facon === "lien")) lignes.push(`  ${id(a.de)} --> ${id(a.vers)}`);
  lignes.push("```", "", "Les flèches « retour » et les onglets ne sont pas dessinés : chaque écran en a, le tableau ci-dessous le dit.", "",
    "## Écran par écran", "", "| Écran | Touchers depuis l'Accueil | On en sort par | Mène vers |", "|---|---|---|---|");
  for (const [nom, dans] of MODULES) {
    for (const r of g.routes.filter(dans)) {
      const vers = [...new Set(g.aretes.filter((a) => a.de === r && a.facon === "lien").map((a) => a.vers))];
      lignes.push(`| \`${r}\` | ${profondeur.get(r) ?? "—"} | ${[...(g.sorties.get(r) ?? [])].join(", ") || "—"} | ${vers.map((v) => `\`${v}\``).join(" ") || "—"} |`);
    }
  }
  lignes.push("", "## Par-dessus n'importe quel écran", "",
    "Trois écrans de garde se posent par-dessus l'écran demandé, dans cet ordre, puis rendent la main exactement où l'on était :", "",
    "1. **Compte fermé ou suspendu** — rien d'autre n'est possible ; écrire au support, se déconnecter.",
    "2. **Le verrou** — le code secret à chaque ouverture (et après deux minutes en arrière-plan).",
    "3. **Les conditions ont changé** — relire, accepter, continuer.", "");
  return lignes.join("\n");
}

/* ------------------------------------------------------------ allons-y */

const graphe = await construire();
temoin(graphe);
const { fautes, profondeur } = controler(graphe);
if (fautes.length) {
  console.error(`✗ la carte a ${fautes.length} défaut(s) :\n  ${fautes.join("\n  ")}`);
  process.exit(1);
}
if (!process.argv.includes("--verifier")) await writeFile(join(RACINE, "../design/CARTE.md"), ecrireCarte(graphe, profondeur));
const max = Math.max(...profondeur.values());
console.log(`✓ la carte tient : ${graphe.routes.length} écrans, ${graphe.aretes.length} passages, aucun lien mort, aucun orphelin, aucun cul-de-sac ; le plus loin est à ${max} touchers (témoin pris)`);
