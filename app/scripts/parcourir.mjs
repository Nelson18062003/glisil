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
  etape("Bienvenue → code par e-mail → Accueil");
  await page.goto(`${BASE}/`);
  await page.waitForURL(/\/bienvenue$/);
  await capturer("bienvenue");
  await page.getByLabel("Adresse e-mail").fill("demo@glisil.com");
  await page.getByRole("button", { name: "Recevoir mon code" }).click();
  await page.waitForURL(/\/bienvenue\/code$/);
  await capturer("bienvenue-code");
  await page.getByLabel("Code reçu par e-mail").fill("123456");
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
  /* les deux façons de payer du document remis aux clients : le numéro et son titulaire, puis le code de retrait, montant compris */
  await voir("GLISIL DÉMONSTRATION");
  await voir("Ne confirmez pas");
  await voir("*126*14*677000000*250000#");
  exiger((await page.getByRole("link", { name: "Composer le code" }).getAttribute("href")) === "tel:*126*14*677000000*250000%23", "le code se compose d'un toucher, # écrit %23");
  await capturer("entrer-payer");
  await page.getByRole("button", { name: "J'ai payé" }).click();
  await page.waitForURL(new RegExp(`/entrer/transaction/${refDepot}$`));
  await capturer("entrer-transaction-vide");
  /* le numéro vérifié, le nom du compte et le montant tapé avant sont déjà là : il reste l'ID du SMS */
  exiger((await page.getByLabel("Numéro qui a payé").inputValue()).replace(/\D/g, "") === "677123456", "le numéro MTN vérifié du compte est proposé");
  exiger((await page.getByLabel("Montant exact envoyé").inputValue()).replace(/\D/g, "") === "250000", "le montant tapé avant est proposé");
  exiger((await page.getByLabel("Nom exact du compte qui a payé").inputValue()) === "Nelson Soh", "le nom du compte est proposé");
  await page.getByLabel("Transaction ID").fill("20394817250");
  await page.getByRole("button", { name: "Valider ce paiement" }).click();
  await voir("On cherche votre paiement");
  await capturer("entrer-transaction-attente");
  await voir("+250 000 XAFe", 10_000);
  exiger(await page.getByText("Crédité", { exact: true }).count() >= 1, "le transaction ID trouvé doit être marqué Crédité");
  await capturer("entrer-transaction-credite");
  await page.getByRole("button", { name: /^Terminer/ }).click();
  await page.waitForURL(new RegExp(`/entrer/credite/${refDepot}$`));
  await voir("XAFe crédités");
  await voir("20394817250");
  /* le XAFe est un jeton : le crédit se double d'une frappe sur la blockchain, montrée tout de suite */
  await voir("Sur la blockchain");
  await voir("En route vers la blockchain");
  exiger(await page.locator('[data-chaine="envoye"]').count() === 1, "une frappe qui part n'est pas dite confirmée");
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
  /* le prix est un VRAI prix, pré-rempli (le meilleur en face), pas un exemple gris dans une case vide */
  const prixPose = await page.getByLabel("Prix (XAFe)").inputValue();
  exiger(/^\d{3},\d{2}$/.test(prixPose), `le prix est pré-rempli : « ${prixPose} »`);
  /* le bouton gris dit pourquoi, la règle et sa borne : 1 USDT (≈ 600 XAFe) est sous le minimum de 1 500 XAFe */
  await page.getByLabel("Quantité (USDT)").fill("1");
  await voir("Au moins 1 500 XAFe par ordre");
  exiger(await page.getByRole("button", { name: "Acheter USDT" }).isDisabled(), "sous le minimum, le bouton ne part pas");
  await capturer("marche-raison");
  /* le total d'abord : 61 840 XAFe au prix posé donnent la quantité, au centime inférieur */
  await page.getByLabel("Total (XAFe)").fill("61840");
  const qDuTotal = Number((await page.getByLabel("Quantité (USDT)").inputValue()).replace(",", "."));
  exiger(qDuTotal > 0 && Math.abs(qDuTotal * Number(prixPose.replace(",", ".")) - 61840) < Number(prixPose.replace(",", ".")), `le total donne la quantité : ${qDuTotal}`);
  /* un prix loin du marché : la bande le dit avant l'envoi */
  await page.getByLabel("Prix (XAFe)").fill("900");
  await voir("se place entre");
  await page.getByRole("button", { name: "Meilleur prix en face" }).click();
  /* la démonstration fait vivre son carnet : le meilleur prix a pu bouger d'un pas depuis, mais il revient près du marché */
  const prixBbo = await page.getByLabel("Prix (XAFe)").inputValue();
  exiger(/^\d{3},\d{2}$/.test(prixBbo) && Math.abs(Number(prixBbo.replace(",", ".")) - Number(prixPose.replace(",", "."))) < 5, `BBO remet le meilleur prix en face : ${prixBbo}`);
  exiger(await page.getByText("se place entre").count() === 0, "revenu dans la bande, plus de raison affichée");
  await page.getByLabel("Quantité (USDT)").fill("");
  await page.getByRole("link", { name: "Règles du marché" }).click();
  await page.waitForURL(/\/marche\/regles$/);
  for (const t of ["Comment un échange se fait", "Prix de référence", "Bande d'un achat", "Protection d'un ordre au marché", "Ordres ouverts, au plus"]) await voir(t);
  await capturer("marche-regles");
  await page.goBack();
  await page.waitForURL(/\/marche$/);
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
  /* le graphique façon TradingView : un vrai tracé, une légende datée, des années d'historique */
  await page.locator("[data-graphique-bourse] canvas").first().waitFor();
  await page.locator("[data-legende]").getByText(/\d{4}/).first().waitFor();
  await page.waitForTimeout(500);
  await capturer("marche-graphique");
  await page.getByRole("button", { name: "Montrer tout l'historique" }).click();
  await page.locator('[aria-label="Intervalle 1 mois"][aria-pressed="true"]').waitFor();
  const boite = await page.locator("[data-graphique-bourse] canvas").first().boundingBox();
  await page.mouse.move(boite.x + boite.width * 0.15, boite.y + boite.height * 0.5);
  await page.locator("[data-legende]").getByText("cours de référence BCE", { exact: false }).waitFor();
  exiger(/20(1[6-9]|2[0-3])/.test(await page.locator("[data-legende]").innerText()), "« Tout » remonte des années en arrière, avant l'ouverture de Glisil");
  await capturer("marche-graphique-historique");
  await page.getByRole("button", { name: "Type de graphique : Bougies" }).click();
  await page.getByRole("menuitem", { name: "Ligne" }).click();
  await page.getByRole("button", { name: "Type de graphique : Ligne" }).waitFor();
  await page.getByRole("button", { name: "Type de graphique : Ligne" }).click();
  await page.getByRole("menuitem", { name: "Bougies" }).click();
  await page.getByRole("tab", { name: "Profondeur" }).click();
  await page.locator("[data-profondeur] svg").waitFor();
  exiger((await page.locator("[data-profondeur]").innerText()).includes("Achats"), "la profondeur dit ce qu'il y a à l'achat et à la vente");
  await capturer("marche-profondeur");
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
  await voir("Sur la blockchain");
  exiger(await page.getByRole("link", { name: /Voir sur BscScan/ }).count() === 1, "la transaction s'ouvre dans l'explorateur");
  const lienTx = await page.getByRole("link", { name: /Voir sur BscScan/ }).getAttribute("href");
  exiger(/^https:\/\/testnet\.bscscan\.com\/tx\/0x[0-9a-f]{64}$/.test(lienTx ?? ""), `le lien vise une transaction : ${lienTx}`);
  /* le reçu se télécharge comme un fichier PDF, qui porte la transaction */
  const [fichier] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Télécharger le reçu/ }).click()]);
  exiger(/^Recu-XAFe-DP-.*\.pdf$/.test(fichier.suggestedFilename()), `le reçu est un PDF qui porte sa référence : ${fichier.suggestedFilename()}`);
  {
    const { readFileSync } = await import("node:fs");
    const octets = readFileSync(await fichier.path());
    exiger(octets.subarray(0, 5).toString() === "%PDF-" && octets.length > 4000, "le reçu est un vrai PDF, pas un fichier vide");
  }

  etape("La preuve de réserve : publique, sans compte — floats, registre, blockchain, chaque transaction");
  {
    const p3 = await navigateur.newPage({ viewport: { width: 390, height: 844 } });
    p3.on("pageerror", (e) => erreurs.push(`preuve : ${e.message}`));
    await p3.goto(`${BASE}/preuve`);
    await p3.getByText("Preuve de réserve").first().waitFor();
    for (const t of ["1 · Les floats", "2 · Le registre", "3 · La blockchain", "Écart avec le registre", "Le vérifier vous-même", "XAFe-DP-000401"]) await p3.getByText(t).first().waitFor();
    exiger(await p3.locator("[data-statut]").count() === 1, "l'état de la parité est dit en tête");
    exiger(await p3.locator('[data-ligne="en_route"]').count() >= 1 && await p3.locator('[data-ligne="concorde"]').count() >= 1, "chaque transaction a son verdict");
    exiger(!/677 ?12|NUMERO|@/.test(await p3.locator("body").innerText()), "aucun numéro ni adresse e-mail de client sur la page publique");
    await p3.screenshot({ path: `${OUT}preuve.png`, fullPage: true });
    await p3.close();
  }

  /* --------------------------------------------------------- crypto */
  etape("Crypto : l'adresse de dépôt et son code QR");
  await page.goto(`${BASE}/crypto`);
  await capturer("crypto");
  await page.getByText("Déposer des USDT").click();
  await page.waitForURL(/\/crypto\/deposer\/USDT$/);
  await page.locator("img[alt^='Code QR']").waitFor();
  await capturer("crypto-deposer");

  etape("Les réseaux viennent du moteur : Base ouvert, il s'ajoute au dépôt ; une adresse 0x se CHOISIT (BSC ou Base), une adresse T se reconnaît");
  await page.addInitScript(() => {
    if (sessionStorage.getItem("xafe-base-ouvert")) globalThis.__xafeEpreuve = { parametres: { crypto: { retraits_ouverts: true, depots_ouverts: true, reseaux: [
      { id: "bep20", nom: "BNB Smart Chain", norme: "BEP20", famille: "evm", natif: "BNB", confirmations: 15, maison: true, contrat_xafe: "0x750E774368240063BD5CF52b30b91183Efa4dAf3" },
      { id: "trc20", nom: "Tron", norme: "TRC20", famille: "tron", natif: "TRX", confirmations: 20, maison: false },
      { id: "base", nom: "Base", norme: "Base", famille: "evm", natif: "ETH", confirmations: 30, maison: false }] } } };
  });
  await page.evaluate(() => sessionStorage.setItem("xafe-base-ouvert", "1"));
  await page.goto(`${BASE}/crypto/deposer/USDT`);
  await page.getByRole("button", { name: "Base", exact: true }).click();
  await voir("USDT sur Base uniquement");
  await voir("30 confirmations");
  const adresseBase = await page.locator("img[alt^='Code QR']").getAttribute("alt");
  exiger(/Base$/.test(adresseBase ?? ""), `le code QR est celui de Base (${adresseBase})`);
  await capturer("crypto-deposer-base");
  await page.goto(`${BASE}/crypto/retirer/USDT/adresse`);
  await page.getByLabel("Adresse du wallet").fill("0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21");
  await voir("Sur quel réseau votre wallet attend-il les USDT ?");
  exiger(await page.getByRole("button", { name: "Continuer" }).isDisabled(), "une adresse 0x avec deux réseaux EVM ouverts : rien n'est choisi d'office");
  exiger(await page.getByRole("button", { name: "TRC20", exact: true }).count() === 0, "Tron n'est pas proposé pour une adresse 0x");
  await page.getByRole("button", { name: "Base", exact: true }).click();
  exiger(!(await page.getByRole("button", { name: "Continuer" }).isDisabled()), "Base choisi : on continue");
  await voir("attend bien des USDT sur Base");
  await capturer("crypto-retirer-choisir-reseau");
  // une autre adresse efface le choix : un choix fait pour une adresse ne vaut pas pour la suivante
  await page.getByLabel("Adresse du wallet").fill("0x7908cf9242fb2018f3487908cf9242fb2018f348");
  exiger(await page.getByRole("button", { name: "Continuer" }).isDisabled(), "une adresse neuve redemande le réseau");
  await page.getByLabel("Adresse du wallet").fill("TPL66VK2gCXNCD7EJg9pgJRfqcRazjhUZY");
  await voir("TRC20 · Tron");
  exiger(await page.getByText("Sur quel réseau").count() === 0, "une adresse T : Tron seul, pas de question");
  exiger(!(await page.getByRole("button", { name: "Continuer" }).isDisabled()), "Tron reconnu : on continue");
  etape("Sans code SMS (réglage « numeros », 0020) : le numéro se tape dans la sortie, il est retenu et choisi tout de suite, sans délai");
  await page.addInitScript(() => {
    if (sessionStorage.getItem("xafe-sans-sms")) globalThis.__xafeEpreuve = { parametres: { numeros: { verification_sms: false, delai_heures: 0 } } };
  });
  await page.evaluate(() => sessionStorage.setItem("xafe-sans-sms", "1"));
  await page.goto(`${BASE}/sortir/montant`);
  await taper(["1", "000"]);
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.waitForURL(/\/sortir\/destination$/);
  exiger(await page.getByText("Ajouter un numéro", { exact: true }).count() === 0, "pas de détour par l'écran du code SMS");
  await page.getByLabel("Numéro MoMo ou Orange Money").fill("699887766");
  await voir("Orange Money");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await voir("6 99 88 77 66");
  exiger(!(await page.getByRole("button", { name: "Continuer" }).isDisabled()), "le numéro tapé est choisi et actif : on continue");
  await capturer("sortir-numero-sans-code");
  await page.goto(`${BASE}/compte/numeros/ajouter`);
  await page.getByLabel("Numéro MoMo").fill("677445566");
  await page.getByRole("button", { name: "Ajouter ce numéro" }).click();
  await voir("Numéro ajouté");
  await voir("tout de suite");
  exiger(await page.getByText("Code reçu sur ce numéro").count() === 0, "aucun écran de code");
  await page.evaluate(() => { sessionStorage.removeItem("xafe-sans-sms"); globalThis.__xafeEpreuve = {}; });

  etape("Recevoir des XAFe depuis son wallet : l'entrée existe, l'adresse ne reçoit que des XAFe, le contrat se copie pour l'ajouter au wallet");
  await page.goto(`${BASE}/crypto`);
  await page.getByText("Recevoir des XAFe").click();
  await page.waitForURL(/\/crypto\/deposer\/XAFe$/);
  await page.locator('img[alt^="Code QR de l\'adresse XAFe"]').waitFor();
  await voir("Cette adresse ne reçoit que des XAFe");
  await voir("0x750E774368240063BD5CF52b30b91183Efa4dAf3");
  exiger(await page.getByRole("button", { name: "Copier le contrat XAFe" }).count() === 1, "le contrat XAFe se copie");
  await capturer("crypto-recevoir-xafe");
  await page.getByRole("button", { name: "TRC20", exact: true }).click();
  exiger(await page.getByRole("button", { name: "Copier le contrat XAFe" }).count() === 0, "un réseau dont le contrat n'est pas dit ne montre pas de contrat inventé");
  await page.evaluate(() => { sessionStorage.removeItem("xafe-base-ouvert"); globalThis.__xafeEpreuve = {}; });

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
  await page.getByRole("button", { name: "Valider ce paiement" }).click();
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
  exiger(await page.getByText("1 · TRANSFERT VERS NOTRE NUMÉRO").count() === 0 && await page.getByRole("link", { name: "Composer le code" }).count() === 0, "un float retiré ne se propose plus, ni en transfert ni en retrait");
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

  /* ------------------------------------------- une cliente toute neuve */
  etape("Une cliente neuve : inscription, conditions acceptées, premiers pas, rien à sortir — puis elle ferme son compte");
  {
    const ctx = await navigateur.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: "fr-FR" });
    const p2 = await ctx.newPage();
    p2.on("pageerror", (e) => erreurs.push(`pageerror: ${e.message}`));
    p2.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts.googleapis|net::ERR/.test(m.text())) erreurs.push(`console: ${m.text()}`); });
    const shot = async (nom) => { numero += 1; await p2.waitForTimeout(400); await p2.screenshot({ path: `${OUT}${String(numero).padStart(2, "0")}-${nom}.png`, fullPage: true }); };
    const pave = async (chiffres) => { for (const t of chiffres) await p2.getByRole("button", { name: t, exact: true }).click(); };
    /* les conditions se lisent sans compte */
    await p2.goto(`${BASE}/conditions`);
    await p2.getByRole("heading", { name: "1. Glisil et le XAFe" }).waitFor();
    await p2.goto(`${BASE}/confidentialite`);
    await p2.getByText("Ce que nous recueillons").waitFor();
    await p2.goto(`${BASE}/bienvenue`);
    await p2.getByLabel("Adresse e-mail").fill("awa@exemple.com");
    await p2.getByRole("button", { name: "Recevoir mon code" }).click();
    await p2.getByLabel("Code reçu par e-mail").fill("123456");
    await p2.waitForURL(/\/bienvenue\/inscription$/);
    await p2.getByLabel("Prénom").fill("awa");
    await p2.getByLabel("Nom de famille").fill("ngono");
    await p2.getByRole("button", { name: "Continuer" }).click();
    await p2.getByLabel("Jour").fill("12"); await p2.getByLabel("Mois").fill("03"); await p2.getByLabel("Année").fill("1994");
    await p2.getByRole("button", { name: "Continuer" }).click();
    await p2.getByLabel("Numéro de téléphone").fill("677998877");
    await p2.getByRole("button", { name: "Continuer" }).click();
    await p2.getByLabel("Ville").fill("Douala"); await p2.keyboard.press("Escape");
    await p2.getByRole("button", { name: "Continuer" }).click();
    await p2.getByText("Je certifie").click();
    const ouvrir = p2.getByRole("button", { name: "Ouvrir mon compte" });
    exiger(await ouvrir.isDisabled(), "sans les conditions acceptées, le compte ne s'ouvre pas");
    /* lire les conditions dans la feuille ne fait pas perdre l'inscription */
    await p2.getByRole("button", { name: "conditions d'utilisation" }).click();
    await p2.getByRole("button", { name: "J'ai lu" }).click();
    await p2.getByRole("checkbox", { name: /J'accepte les/ }).check();
    await shot("inscription-conditions");
    await ouvrir.click();
    await p2.waitForURL(/\/bienvenue\/profil$/);
    await pave(["2", "5", "8", "0"]); await p2.waitForTimeout(300); await pave(["2", "5", "8", "0"]);
    await p2.getByRole("button", { name: "Découvrir mon compte" }).click();
    await p2.waitForURL(`${BASE}/`);
    await p2.getByText("POUR BIEN DÉMARRER").waitFor();
    await p2.getByText("Entrez vos premiers XAF").waitFor();
    exiger(await p2.getByRole("link", { name: "Acheter des USDT" }).count() === 0, "un compte vide n'a rien à acheter ni à vendre");
    await shot("accueil-compte-neuf");
    await p2.getByRole("link", { name: "Sortir des XAF" }).click();
    await p2.getByText("Rien à sortir pour l'instant").waitFor();
    await shot("sortir-rien");
    await p2.getByRole("link", { name: "Entrer des XAF" }).click();
    await p2.waitForURL(/\/entrer\/operateur$/);
    await p2.getByRole("link", { name: "Historique" }).count();
    await p2.goto(`${BASE}/historique`);
    if (await p2.getByText("Votre code secret pour continuer").count()) await pave(["2", "5", "8", "0"]);
    await p2.getByText("Aucune opération pour l'instant").waitFor();
    await shot("historique-vide");
    await p2.getByRole("link", { name: "Compte" }).click();
    await p2.getByText("Mes informations").click();
    await p2.waitForURL(/\/compte\/informations$/);
    await p2.getByText("12 mars 1994").waitFor();
    await shot("compte-informations");
    await p2.getByRole("link", { name: "Fermer mon compte" }).click();
    await p2.getByText("Votre solde est à zéro").waitFor();
    await shot("compte-fermer");
    await p2.getByRole("button", { name: "Fermer mon compte" }).click();
    await pave(["0", "0", "0", "0"]);
    await p2.getByText("Ce code n'est pas le bon").or(p2.getByText("Code secret incorrect")).first().waitFor();
    await p2.getByRole("button", { name: "Compris" }).click();
    await p2.getByRole("button", { name: "Fermer mon compte" }).click();
    await pave(["2", "5", "8", "0"]);
    await p2.getByText("Votre compte est fermé").waitFor();
    await shot("compte-ferme");
    await ctx.close();
  }

  /* ------------------------- une référence qui n'est pas sur ce compte */
  etape("Une référence inconnue dit « Introuvable » au lieu de rester grise pour toujours");
  for (const adresse of ["/entrer/payer/XAFe-DP-999999", "/entrer/transaction/XAFe-DP-999999", "/sortir/envoye/XAFe-WD-999999", "/marche/ordres/inexistant", "/crypto/envoye/XAFe-CW-999999"]) {
    await page.goto(`${BASE}${adresse}`);
    await page.locator("[data-attente-erreur]").waitFor({ timeout: 10_000 });
    exiger(await page.getByText("Introuvable", { exact: true }).count() >= 1, `${adresse} : « Introuvable »`);
    exiger(await page.locator("[data-squelette]").count() === 0, `${adresse} : plus de formes grises`);
  }
  await capturer("reference-introuvable");

  /* --------------------------- rembourser en XAF, payé à la main (0014) */
  etape("Sortir en XAF quand l'équipe paie à la main : le nom du compte demandé, trois étapes qui avancent, le transaction ID rendu ; un refus rend les XAFe avec son motif");
  await page.addInitScript(() => {
    if (sessionStorage.getItem("xafe-sortie-manuelle")) globalThis.__xafeEpreuve = { parametres: { sortie: { ouvertes: true, mode: "manuel" } } };
  });
  await page.evaluate(() => sessionStorage.setItem("xafe-sortie-manuelle", "1"));
  const ouvrirEnManuel = async (adresse) => {
    await page.goto(`${BASE}${adresse}`);
    await page.waitForTimeout(300);
    if (await page.getByText("Votre code secret pour continuer").count()) await taper(["1", "2", "3", "4"]);
  };
  const demanderEnManuel = async (nom) => {
    await ouvrirEnManuel("/sortir/montant");
    await taper(["5", "0", "000"]);
    await page.getByRole("button", { name: "Continuer" }).click();
    await page.getByText("6 77 12 34 56").click();
    await page.getByRole("button", { name: "Continuer" }).click();
    const champ = page.getByLabel(/Nom exact du compte/);
    await champ.waitFor();
    exiger((await champ.inputValue()).trim().length >= 2, "le nom du compte Glisil est proposé d'avance");
    exiger(await page.getByText("l'équipe Glisil", { exact: false }).count() >= 1, "l'écran dit qui paie");
    if (nom !== null) await champ.fill(nom);
  };
  await demanderEnManuel(null);
  await capturer("sortir-manuel-verifier");
  await page.getByLabel(/Nom exact du compte/).fill(" ");
  exiger(await page.getByRole("button", { name: "Confirmer avec mon code" }).isDisabled(), "sans nom, on ne confirme pas");
  await page.getByLabel(/Nom exact du compte/).fill("Nelson Soh");
  await page.getByRole("button", { name: "Confirmer avec mon code" }).click();
  await taper(["1", "2", "3", "4"]);
  await page.waitForURL(/\/sortir\/envoye\/XAFe-WD-\d+$/);
  await voir("Demande reçue");
  await voir("vos XAFe sont mis de côté");
  await capturer("sortir-manuel-en-cours");
  await voir("XAF envoyés", 25_000);
  await voir("Transaction ID", 5_000);
  await capturer("sortir-manuel-payee");
  await demanderEnManuel("Nelson refus");
  await page.getByRole("button", { name: "Confirmer avec mon code" }).click();
  await taper(["1", "2", "3", "4"]);
  await voir("Demande refusée", 25_000);
  await voir("ne correspond pas");
  await capturer("sortir-manuel-refusee");
  await page.evaluate(() => sessionStorage.removeItem("xafe-sortie-manuelle"));

  /* ---------------------------------------- ouvrir par les dépôts seuls */
  etape("Ouvrir par les dépôts seuls : sorties, marché, achat rapide et crypto disent « bientôt » AVANT un montant tapé ; l'entrée reste ouverte");
  /* les paramètres que l'équipe poserait, lus par le guichet de démonstration dès le chargement */
  await page.addInitScript(() => {
    if (sessionStorage.getItem("xafe-depots-seuls")) globalThis.__xafeEpreuve = { parametres: { sortie: { ouvertes: false }, marche: { ouvert: false }, rapide: { ouvert: false }, crypto: { depots_ouverts: false, retraits_ouverts: false } } };
  });
  await page.evaluate(() => sessionStorage.setItem("xafe-depots-seuls", "1"));
  const allerA = async (adresse) => {
    await page.goto(`${BASE}${adresse}`);
    await page.waitForTimeout(300);
    if (await page.getByText("Votre code secret pour continuer").count()) await taper(["1", "2", "3", "4"]);
  };
  await allerA("/");
  await voir("Le marché ouvre bientôt");
  exiger(await page.getByRole("link", { name: "Acheter des USDT" }).count() === 0, "l'achat rapide fermé ne se propose pas sur l'accueil");
  exiger(await page.getByText("Bientôt", { exact: true }).count() >= 2, "les tuiles Sortir et Crypto disent « Bientôt »");
  await capturer("accueil-depots-seuls");
  for (const [adresse, titre, nom] of [
    ["/sortir/montant", "Les sorties vers Mobile Money arrivent bientôt", "sortir-bientot"],
    ["/marche", "Le marché ouvre bientôt", null],
    ["/rapide?sens=achat", "L'achat et la vente d'USDT arrivent bientôt", null],
    ["/crypto", "La crypto arrive bientôt", null],
    ["/crypto/deposer/USDT", "Les dépôts crypto arrivent bientôt", null],
    ["/crypto/retirer/XAFe/adresse", "Les retraits crypto arrivent bientôt", null],
  ]) {
    await allerA(adresse);
    await voir(titre);
    exiger(await page.getByRole("button", { name: "Continuer" }).count() === 0, `${adresse} : rien à remplir sur un chemin fermé`);
    if (nom) await capturer(nom);
  }
  /* ce qui existe déjà reste lisible : une sortie passée se suit encore */
  await allerA("/historique");
  await voir("Sortie MTN MoMo");
  await page.getByText("Sortie MTN MoMo").first().click();
  await page.waitForURL(/\/historique\/XAFe-WD-\d+$/);
  await allerA("/entrer/operateur");
  await voir("MTN MoMo");
  await ouvrirUnDepot();
  await voir("1 · TRANSFERT VERS NOTRE NUMÉRO");
  await page.evaluate(() => sessionStorage.removeItem("xafe-depots-seuls"));

  etape("La bêta : le bandeau le dit, les dépôts réels et les sorties sont fermés « pendant la bêta », et l'on est renvoyé vers le marché");
  await page.addInitScript(() => {
    if (sessionStorage.getItem("xafe-beta")) globalThis.__xafeEpreuve = { parametres: {
      sortie: { ouvertes: false }, crypto: { retraits_ouverts: false, depots_ouverts: true },
      beta: { actif: true, message: "Glisil est en bêta : tout l'argent ici est de l'argent de test.", dotation: { XAFe: 1000000, USDT: 2000 }, depots_reels: false } } };
  });
  await page.evaluate(() => sessionStorage.setItem("xafe-beta", "1"));
  await allerA("/");
  await page.locator("[data-bandeau-beta]").waitFor();
  await voir("tout l'argent ici est de l'argent de test");
  await capturer("beta-accueil");
  await allerA("/entrer/operateur");
  await voir("Pas de vrai paiement pendant la bêta");
  await voir("1 000 000 XAFe");
  exiger(await page.getByRole("link", { name: "Essayer le marché" }).count() === 1, "la bêta renvoie vers le marché, pas vers un dépôt");
  await capturer("beta-entrer-ferme");
  await allerA("/sortir/montant");
  await voir("Les sorties sont fermées pendant la bêta");
  await allerA("/crypto/retirer/XAFe/adresse");
  await voir("Les retraits sont fermés pendant la bêta");
  // le testeur signale un problème depuis le bandeau : il part à l'équipe, une référence revient
  await allerA("/");
  await page.locator("[data-bandeau-beta]").getByRole("link", { name: "Signaler un problème" }).click();
  await page.waitForURL(/\/compte\/aide\?depuis=/);
  exiger(await page.getByRole("button", { name: "Envoyer à l'équipe Glisil" }).isDisabled(), "un texte vide ne part pas");
  await page.getByLabel("Ce qui s'est passé").fill("Le graphique du marché ne bouge pas sur mon téléphone");
  await page.getByRole("button", { name: "Envoyer à l'équipe Glisil" }).click();
  await page.locator("[data-signalement-recu]").getByText("SIG-000001").waitFor();
  await capturer("beta-signaler");
  await page.evaluate(() => { sessionStorage.removeItem("xafe-beta"); globalThis.__xafeEpreuve = {}; });

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
