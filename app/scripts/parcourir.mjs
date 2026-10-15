// LE PARCOURS, JOUÉ EN ENTIER DANS UN VRAI CHROMIUM.
//
//   npm run build && node scripts/parcourir.mjs
//
// Lance le serveur de prévisualisation sur son propre port, ouvre l'application
// en démonstration et FAIT ce que le client fait : se connecter, entrer des XAF
// par transaction ID jusqu'au crédit, sortir des XAF jusqu'à « envoyés », passer
// un ordre au marché, poser un ordre limite et l'annuler, relire l'historique,
// retrouver le verrou dans un nouvel onglet. Il exige les soldes au franc près,
// échoue à la première erreur de console, et laisse une capture de chaque écran
// dans app/captures/. « Ça compile » ne dit rien d'un parcours.
import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createConnection } from "node:net";

const PORT = 4180;
const BASE = `http://localhost:${PORT}`;
const OUT = new URL("../captures/", import.meta.url).pathname;
const ROOT = process.env.PLAYWRIGHT_ROOT || "/opt/node-tools/node_modules";
const { chromium } = createRequire(`${ROOT}/`)("playwright");

/* ------------------------------------------------------------ le serveur */

const portPris = () =>
  new Promise((resoudre) => {
    const s = createConnection({ port: PORT, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resoudre(true); });
    s.once("error", () => resoudre(false));
  });

if (await portPris()) {
  console.error(`✗ Le port ${PORT} est déjà pris : le harnais mesurerait un autre serveur, peut-être du vieux code.`);
  process.exit(1);
}

const serveur = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: new URL("..", import.meta.url).pathname, stdio: "ignore", detached: true });
const arreter = () => { try { process.kill(-serveur.pid, "SIGTERM"); } catch { /* déjà parti */ } };
process.on("exit", arreter);
for (let i = 0; i < 60 && !(await portPris()); i++) await new Promise((r) => setTimeout(r, 250));
if (!(await portPris())) { console.error("✗ Le serveur ne démarre pas."); process.exit(1); }

/* ---------------------------------------------------------- le navigateur */

await mkdir(OUT, { recursive: true });
/* les captures d'un parcours précédent ne restent pas à côté de celles-ci : des numéros décalés trompent l'œil */
for (const f of await readdir(OUT)) if (f.endsWith(".png")) await rm(`${OUT}${f}`);
process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK ??= "1";
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;
const navigateur = await chromium.launch({ proxy });
const contexte = await navigateur.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: "fr-FR", permissions: ["clipboard-read", "clipboard-write"] });
const page = await contexte.newPage();

const erreurs = [];
page.on("pageerror", (e) => erreurs.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts.googleapis|net::ERR/.test(m.text())) erreurs.push(`console: ${m.text()}`); });

let numero = 0;
const capturer = async (nom) => {
  numero += 1;
  /* les couleurs des boutons glissent sur 250 ms : une photo prise avant montre un état qui n'existe pas */
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}${String(numero).padStart(2, "0")}-${nom}.png`, fullPage: true });
};
const etape = (texte) => console.log(`· ${texte}`);
const exiger = (condition, message) => { if (!condition) throw new Error(`✗ ${message}`); };
const voir = (texte, delai = 15_000) => page.getByText(texte, { exact: false }).first().waitFor({ timeout: delai });
const taper = async (touches) => { for (const t of touches) await page.getByRole("button", { name: t, exact: true }).click(); };
const chemin = () => new URL(page.url()).pathname;
/* l'opérateur, puis le montant (une indication), puis le dossier */
const ouvrirUnDepot = async () => {
  await page.getByText("MTN MoMo", { exact: true }).click();
  await page.waitForURL(/\/entrer\/montant$/);
  await taper(["1", "0", "000"]);
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.waitForURL(/\/entrer\/payer\/XAFe-DP-\d+$/);
};

try {
  /* ---------------------------------------------------------- entrer */
  etape("Bienvenue → code SMS → Accueil");
  await page.goto(`${BASE}/`);
  await page.waitForURL(/\/bienvenue$/);
  await capturer("bienvenue");
  await page.getByLabel("Numéro de téléphone").fill("677123456");
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.waitForURL(/\/bienvenue\/code$/);
  await capturer("bienvenue-code");
  await taper(["1", "2", "3", "4", "5", "6"]);
  await page.waitForURL(`${BASE}/`);
  await voir("Bonjour Nelson");
  await voir("3 250 000");
  await capturer("accueil");

  /* ------------------------------------------------- entrer des XAF */
  etape("Entrer des XAF : opérateur → payer → transaction ID → crédité");
  await page.getByRole("link", { name: "Entrer des XAF" }).click();
  await page.waitForURL(/\/entrer\/operateur$/);
  await capturer("entrer-operateur");
  await page.getByText("MTN MoMo", { exact: true }).click();
  await page.waitForURL(/\/entrer\/montant$/);
  await taper(["2", "5", "0", "000"]);
  await voir("Vous recevez 250 000 XAFe");
  await capturer("entrer-montant");
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.waitForURL(/\/entrer\/payer\/XAFe-DP-\d+$/);
  await voir("250 000 XAF");
  const refDepot = chemin().split("/").pop();
  await voir("6 77 00 00 00");
  await capturer("entrer-payer");
  await page.getByRole("button", { name: "J'ai payé" }).click();
  await page.waitForURL(new RegExp(`/entrer/transaction/${refDepot}$`));
  await capturer("entrer-transaction-vide");
  await page.getByLabel("Transaction ID").fill("20394817250");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await voir("on cherche le SMS");
  await capturer("entrer-transaction-attente");
  await voir("+250 000 XAFe", 10_000);
  exiger(await page.getByText("Crédité", { exact: true }).count() >= 1, "le transaction ID trouvé doit être marqué Crédité");
  await capturer("entrer-transaction-credite");
  await page.getByRole("button", { name: /^Terminer/ }).click();
  await page.waitForURL(new RegExp(`/entrer/credite/${refDepot}$`));
  await voir("XAFe crédités");
  await voir("20394817250");
  await capturer("entrer-credite");
  await page.getByRole("link", { name: "Retour à l'accueil" }).click();
  await page.waitForURL(`${BASE}/`);
  await voir("3 500 000");

  /* ------------------------------------------------- sortir des XAF */
  etape("Sortir des XAF : montant → destination → vérifier → code → envoyé");
  await page.getByRole("link", { name: "Sortir des XAF" }).click();
  await page.waitForURL(/\/sortir\/montant$/);
  await taper(["1", "0", "0", "000"]);
  await voir("100 000");
  await capturer("sortir-montant");
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.waitForURL(/\/sortir\/destination$/);
  await page.getByText("6 77 12 34 56").click();
  await capturer("sortir-destination");
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.waitForURL(/\/sortir\/verifier$/);
  await voir("99 500 XAF");
  await capturer("sortir-verifier");
  await page.getByRole("button", { name: "Confirmer avec mon code" }).click();
  await page.waitForURL(/\/sortir\/code$/);
  await capturer("sortir-code");
  await taper(["1", "2", "3", "4"]);
  await page.waitForURL(/\/sortir\/envoye\/XAFe-WD-\d+$/);
  await voir("En cours");
  await capturer("sortir-en-cours");
  await voir("99 500 XAF envoyés", 20_000);
  await capturer("sortir-envoye");
  await page.getByRole("link", { name: "Retour à l'accueil" }).click();
  await page.waitForURL(`${BASE}/`);
  await voir("3 400 000");

  /* ------------------------------------------------------- marché */
  etape("Marché : un achat au marché exécuté, une limite posée puis annulée");
  await page.getByRole("link", { name: "Marché" }).click();
  await page.waitForURL(/\/marche$/);
  await page.getByText("Prix (XAFe)").first().waitFor();
  await page.waitForTimeout(800);
  await capturer("marche");
  await page.getByText("Limite", { exact: true }).first().click();
  await page.getByText("Marché", { exact: true }).last().click();
  await page.getByLabel("Quantité (USDT)").fill("10");
  await page.getByRole("button", { name: "Acheter USDT" }).click();
  await voir("Acheter 10 USDT");
  await capturer("marche-confirmation");
  await page.getByRole("button", { name: "Confirmer" }).click();
  await page.waitForURL(/\/marche\/execute\//);
  await voir("Ordre exécuté");
  await voir("+9,99 USDT");
  await capturer("marche-execute");
  await page.getByRole("link", { name: "Retour au marché" }).click();
  await page.waitForURL(/\/marche$/);
  await page.getByText("Marché", { exact: true }).first().click();
  await page.getByText("Limite", { exact: true }).last().click();
  await page.getByRole("button", { name: "Vendre", exact: true }).click();
  await page.getByLabel("Prix (XAFe)").fill("700,00");
  await page.getByLabel("Quantité (USDT)").fill("10");
  await page.getByRole("button", { name: "Vendre USDT" }).click();
  await page.getByRole("button", { name: "Confirmer" }).click();
  await voir("Ordre placé au carnet");
  await voir("Ordres ouverts (2)");
  await page.getByRole("link", { name: "Tout voir" }).click();
  await page.waitForURL(/\/marche\/ordres$/);
  await voir("Ouverts (2)");
  await capturer("marche-ordres");
  await page.getByRole("button", { name: "Annuler" }).first().click();
  await voir("Ouverts (1)");
  await page.goto(`${BASE}/marche/graphique`);
  await voir("Haut 24 h");
  await page.waitForTimeout(500);
  await capturer("marche-graphique");
  await page.goto(`${BASE}/marche/carnet`);
  await voir("Carnet d'ordres");
  await voir("Achat (XAFe)");
  await capturer("marche-carnet");
  /* le pas regroupe vraiment : à 1,00, chaque prix affiché est un franc rond */
  await page.getByRole("button", { name: "Pas de prix" }).click();
  await page.getByRole("menuitem", { name: "Pas 1,00" }).click();
  await voir("Pas 1,00");
  const prixAffiches = await page.locator("button >> text=/^\\d{3},\\d{2}$/").allInnerTexts();
  exiger(prixAffiches.length > 0 && prixAffiches.every((p) => p.endsWith(",00")), `au pas de 1,00, les prix sont ronds : ${prixAffiches.slice(0, 6).join(" ")}`);
  await page.getByRole("tab", { name: "Transactions" }).click();
  await voir("Heure");

  /* ----------------------------------------------------- historique */
  etape("Historique : la liste, puis le détail du dépôt avec ses transaction ID");
  await page.goto(`${BASE}/historique`);
  await voir("Entrée MTN MoMo");
  await capturer("historique");
  await page.getByText("Entrée MTN MoMo").first().click();
  await page.waitForURL(/\/historique\/XAFe-DP-/);
  await voir("Référence MTN");
  await voir("20394817250");
  await voir("Lu par TOTEM");
  await capturer("historique-detail");
  /* le reçu se télécharge comme un fichier */
  const [fichier] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Télécharger le reçu" }).click()]);
  exiger(fichier.suggestedFilename().startsWith("Recu-XAFe-DP-"), `le reçu porte sa référence : ${fichier.suggestedFilename()}`);

  /* --------------------------------------------------------- crypto */
  etape("Crypto : l'adresse de dépôt et son code QR");
  await page.goto(`${BASE}/crypto`);
  await capturer("crypto");
  await page.getByText("Déposer des USDT").click();
  await page.waitForURL(/\/crypto\/deposer\/USDT$/);
  await page.locator("img[alt^='Code QR']").waitFor();
  await capturer("crypto-deposer");

  /* --------------------------------------------------------- compte */
  etape("Compte : numéros, paliers, aide");
  await page.goto(`${BASE}/compte`);
  await voir("Nelson Soh");
  await capturer("compte");
  await page.goto(`${BASE}/compte/numeros`);
  await voir("6 99 87 65 43");
  await capturer("compte-numeros");
  await page.goto(`${BASE}/compte/paliers`);
  await voir("Sans plafond plateforme");
  await capturer("compte-paliers");
  await page.goto(`${BASE}/compte/aide`);
  await voir("Pourquoi un transaction ID");
  await capturer("compte-aide");

  /* -------------------------------------------------------- verrou */
  etape("Le verrou : un nouvel onglet redemande le code ; un code faux est refusé");
  const onglet = await contexte.newPage();
  onglet.on("pageerror", (e) => erreurs.push(`pageerror: ${e.message}`));
  await onglet.goto(`${BASE}/historique`);
  await onglet.getByText("Votre code secret pour continuer").waitFor({ timeout: 15_000 });
  await onglet.screenshot({ path: `${OUT}${String(++numero).padStart(2, "0")}-verrouillage.png`, fullPage: true });
  for (const t of ["9", "9", "9", "9"]) await onglet.getByRole("button", { name: t, exact: true }).click();
  await onglet.getByText("Code incorrect").waitFor();
  for (const t of ["1", "2", "3", "4"]) await onglet.getByRole("button", { name: t, exact: true }).click();
  await onglet.waitForURL(/\/historique$/);
  await onglet.getByText("Entrée MTN MoMo").first().waitFor();
  await onglet.close();

  /* ------------------------------------------------- un numéro ajouté */
  etape("Un numéro ajouté : l'opérateur vient du numéro, le code se renvoie, un code faux se dit");
  await page.goto(`${BASE}/compte/numeros/ajouter`);
  await page.getByLabel("Numéro MoMo").fill("677112233");
  await voir("d'après le numéro");
  await capturer("compte-numero-ajouter");
  await page.getByRole("button", { name: "Recevoir le code" }).click();
  await voir("Renvoyer le code");
  await page.getByRole("button", { name: "Renvoyer le code" }).click();
  await voir("Nouveau code envoyé");
  await taper(["0", "0", "0", "0", "0", "0"]);
  await voir("Ce code n'est pas le bon");
  await capturer("compte-numero-code");
  await taper(["1", "2", "3", "4", "5", "6"]);
  await voir("Numéro ajouté");

  /* ---------------------------------------- un ID mal recopié se retire */
  etape("Un transaction ID mal recopié se retire : le dépôt n'attend plus un SMS qui ne viendra jamais");
  await page.goto(`${BASE}/entrer/operateur`);
  await ouvrirUnDepot();
  await page.getByRole("button", { name: "J'ai payé" }).click();
  await page.getByLabel("Transaction ID").waitFor();
  await page.getByLabel("Transaction ID").fill("2039X817999");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await voir("Mal recopié ? Touchez × pour le retirer.");
  await capturer("entrer-retirer");
  await page.getByRole("button", { name: /Retirer l'ID 2039X817999/ }).click();
  await page.getByText("Mal recopié ? Touchez × pour le retirer.").waitFor({ state: "detached" });

  /* -------------------------------------- une réponse perdue en route */
  etape("Une sortie partie dont la réponse se perd : revenir, recommencer — elle ne part pas deux fois");
  await page.goto(`${BASE}/sortir/montant`);
  await taper(["1", "0", "000"]);
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByText("6 77 12 34 56").click();
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("button", { name: "Confirmer avec mon code" }).click();
  await page.waitForURL(/\/sortir\/code$/);
  await page.evaluate(() => { globalThis.__xafeEpreuve = { perdreLaProchaineReponse: true }; });
  await taper(["1", "2", "3", "4"]);
  await voir("Pas de réseau");
  const avant = await page.evaluate(() => globalThis.__xafeEpreuve.sorties);
  await page.getByRole("button", { name: "Compris" }).click();
  // la personne revient en arrière, puis reconfirme : l'écran du code est remonté à neuf
  await page.goBack();
  await page.waitForURL(/\/sortir\/verifier$/);
  await page.getByRole("button", { name: "Confirmer avec mon code" }).click();
  await page.waitForURL(/\/sortir\/code$/);
  await taper(["1", "2", "3", "4"]);
  await page.waitForURL(/\/sortir\/envoye\/XAFe-WD-\d+$/);
  const apres = await page.evaluate(() => globalThis.__xafeEpreuve.sorties);
  exiger(apres === avant, `la sortie rejouée est la même : ${avant} sortie(s) avant le second essai, ${apres} après`);

  /* ------------------------------ un numéro qui ne reçoit plus le dit */
  etape("Le boîtier se tait, puis l'équipe retire le float : le dossier le dit, et ouvre un autre numéro");
  await page.goto(`${BASE}/entrer/operateur`);
  await page.evaluate(() => { globalThis.__xafeEpreuve = { reception: "retardee" }; });
  await ouvrirUnDepot();
  const refMuet = chemin().split("/").pop();
  await voir("Notre boîtier est hors ligne pour l'instant");
  exiger(await page.getByRole("button", { name: "J'ai payé" }).count() === 1, "on peut encore payer quand le boîtier se tait : le SMS sera lu à son retour");
  await capturer("entrer-payer-boitier-muet");
  await page.evaluate(() => { globalThis.__xafeEpreuve.reception = "fermee"; });
  await page.getByRole("button", { name: "J'ai payé" }).click();
  await page.waitForURL(new RegExp(`/entrer/transaction/${refMuet}$`));
  await page.goBack();
  await voir("Ce numéro ne reçoit plus : ne payez pas ici");
  exiger(await page.getByRole("button", { name: /^Ouvrir MTN/ }).count() === 0, "on ne propose plus d'ouvrir MoMo pour payer un float retiré");
  await capturer("entrer-payer-float-retire");
  await page.evaluate(() => { globalThis.__xafeEpreuve = {}; });
  await page.getByRole("button", { name: "Payer à un autre numéro" }).click();
  await page.waitForURL(/\/entrer\/operateur$/);
  await ouvrirUnDepot();
  exiger(chemin().split("/").pop() !== refMuet, "un nouveau dossier est ouvert");
  exiger(await page.getByRole("alert").count() === 0, "le nouveau numéro reçoit : aucun avertissement");

  /* ----------------------------------------------------- l'achat rapide */
  etape("Achat rapide : un montant, un prix ferme, confirmé ; puis une vente dont le prix expire et se renouvelle");
  await page.goto(`${BASE}/`);
  await page.getByRole("link", { name: "Acheter des USDT" }).click();
  await page.waitForURL(/\/rapide\?sens=achat$/);
  await taper(["5", "0", "000"]);
  await voir("Vous recevez");
  await capturer("rapide-montant");
  await page.getByRole("button", { name: "Voir le prix" }).click();
  await page.waitForURL(/\/rapide\/prix$/);
  await voir("Prix garanti encore");
  const recus = (await page.locator("text=Vous recevez").locator("xpath=..").innerText()).match(/([\d\s\u202f,]+) USDT/)?.[1]?.trim();
  exiger(Boolean(recus), "le prix ferme dit combien d'USDT on reçoit");
  await capturer("rapide-prix");
  for (let essai = 0; essai < 3; essai++) {
    await page.getByRole("button", { name: "Confirmer l'achat" }).click();
    const fini = await page.getByText("USDT achetés").waitFor({ timeout: 6_000 }).then(() => true).catch(() => false);
    if (fini) break;
    // le carnet de démonstration bouge : un prix refusé se renouvelle, et l'on reconfirme
    await page.getByRole("button", { name: /Compris|Fermer|OK/ }).first().click().catch(() => {});
    await voir("Prix garanti encore");
  }
  await voir("USDT achetés");
  await capturer("rapide-fait");
  await page.goto(`${BASE}/rapide?sens=vente`);
  await taper(["2", "0"]);
  await voir("Vous recevez");
  await page.getByRole("button", { name: "Voir le prix" }).click();
  await voir("Prix garanti encore");
  await voir("Ce prix a expiré", 30_000);
  exiger(await page.getByRole("button", { name: "Confirmer la vente" }).count() === 0, "un prix expiré ne se confirme pas");
  await capturer("rapide-expire");
  await page.getByRole("button", { name: "Nouveau prix" }).click();
  await voir("Prix garanti encore");
  for (let essai = 0; essai < 3; essai++) {
    await page.getByRole("button", { name: "Confirmer la vente" }).click();
    const fini = await page.getByText("USDT vendus").waitFor({ timeout: 6_000 }).then(() => true).catch(() => false);
    if (fini) break;
    await page.getByRole("button", { name: /Compris|Fermer|OK/ }).first().click().catch(() => {});
    await voir("Prix garanti encore");
  }
  await voir("USDT vendus");

  /* ------------------------- une référence qui n'est pas sur ce compte */
  etape("Une référence inconnue dit « Introuvable » au lieu de rester grise pour toujours");
  for (const adresse of ["/entrer/payer/XAFe-DP-999999", "/entrer/transaction/XAFe-DP-999999", "/sortir/envoye/XAFe-WD-999999", "/marche/ordres/inexistant", "/crypto/envoye/XAFe-CW-999999"]) {
    await page.goto(`${BASE}${adresse}`);
    await page.locator("[data-attente-erreur]").waitFor({ timeout: 10_000 });
    exiger(await page.getByText("Introuvable", { exact: true }).count() >= 1, `${adresse} : « Introuvable »`);
    exiger(await page.locator("[data-squelette]").count() === 0, `${adresse} : plus de formes grises`);
  }
  await capturer("reference-introuvable");

  exiger(erreurs.length === 0, `des erreurs ont été vues dans le navigateur :\n  ${erreurs.join("\n  ")}`);
  console.log(`✓ le parcours tient (${numero} captures dans app/captures/)`);
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
