// CHAQUE ÉCRAN, SUR CHAQUE APPAREIL QUE NOS CLIENTS ONT VRAIMENT EN MAIN.
//
//   npm run build && node scripts/ecrans.mjs                tous les appareils
//   node scripts/ecrans.mjs android-360 pc-1366              quelques-uns
//
// La grille d'appareils vient des statistiques du Cameroun (StatCounter,
// septembre 2026), pas d'une liste de modèles à la mode :
//   · 71 % des visites viennent d'un téléphone, 28 % d'un ORDINATEUR, 0,6 %
//     d'une tablette ; le téléphone est Android à 83 %, iPhone à 17 % ;
//   · les largeurs de téléphone les plus vues : 360 (360×800, 360×806,
//     360×820 : 37 % à elles trois), 414×896, 412×915, 384×832 ;
//   · l'ordinateur est sous Windows à 87 %, et son écran le plus courant fait
//     1366×768 — soit à peine 650 points de haut une fois retirées les barres
//     du navigateur et des tâches. C'est ce chiffre-là qu'il faut tenir.
// Les hauteurs ci-dessous sont celles de la FENÊTRE (ce que la page voit),
// pas de l'écran.
//
// Sur chaque écran et chaque appareil, il exige :
//   · rien ne déborde à droite, pas de défilement horizontal ;
//   · aucun texte coupé sans points de suspension (un montant coupé est un faux) ;
//   · chaque bouton se touche : 24 points au moins (WCAG 2.2, AA) — et il
//     COMPTE ceux sous 44 (la taille d'un doigt, selon Apple et Google) ;
//   · rien de cliquable n'est caché sous autre chose (la barre d'onglets…) ;
//   · aucun champ sous 16 px : l'iPhone zoome alors toute la page au toucher ;
//   · axe-core ne trouve aucune faute grave d'accessibilité ;
//   · sur un grand écran, aucune ligne de texte n'est trop longue pour se lire.
// Ce qu'il ne voit PAS : le moteur de l'iPhone. Ici, seul Chromium est installé ;
// les iPhone de la grille ont la taille et l'identité d'un iPhone, pas son
// moteur (WebKit). Ce qui ne dépend que de la mise en page est donc vérifié ;
// une différence propre à Safari ne se verra que sur un vrai iPhone — c'est
// la raison de l'iPhone dans l'essai avec cinq clients (docs/TEST-UTILISATEURS.md).
// Il commence par un TÉMOIN : une page fabriquée avec chacune de ces fautes.
// S'il n'en voit pas une, c'est lui qui est faux, et il s'arrête.
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createConnection } from "node:net";

const PORT = 4182;
const BASE = `http://localhost:${PORT}`;
const OUT = new URL("../captures/ecrans/", import.meta.url).pathname;
const ROOT = process.env.PLAYWRIGHT_ROOT || "/opt/node-tools/node_modules";
const { chromium } = createRequire(`${ROOT}/`)("playwright");
const AXE = await readFile(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");

/* ------------------------------------------------------------ les appareils */

const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const t = (nom, w, h, ua = ANDROID) => ({ nom, w, h, mobile: true, ua, classe: "téléphone" });
export const APPAREILS = [
  t("petit-android-320", 320, 640),   // le plus étroit encore en service (Android Go, anciens modèles)
  t("android-360", 360, 720),         // 360×800 dans Chrome, la barre d'adresse ouverte : LE plus courant
  t("android-360-appli", 360, 780),   // le même dans l'application (pas de barre d'adresse)
  t("iphone-se", 375, 667, IOS),      // le plus petit iPhone vendu
  t("android-384", 384, 832),
  t("iphone-15", 390, 844, IOS),
  t("android-412", 412, 915),
  t("iphone-xr-11", 414, 896, IOS),   // le 3e plus vu au Cameroun
  t("iphone-pro-max", 430, 932, IOS),
  { nom: "telephone-couche", w: 780, h: 360, mobile: true, ua: ANDROID, classe: "téléphone" }, // tenu à l'horizontale
  { nom: "tablette-601", w: 601, h: 962, mobile: true, ua: ANDROID, classe: "tablette" },
  { nom: "ipad", w: 768, h: 1024, mobile: true, ua: IOS, classe: "tablette" },
  { nom: "tablette-800", w: 800, h: 1280, mobile: true, ua: ANDROID, classe: "tablette" }, // la tablette la plus vue
  { nom: "ipad-couche", w: 1024, h: 768, mobile: true, ua: IOS, classe: "tablette" },
  { nom: "pc-1280", w: 1280, h: 600, classe: "ordinateur" },
  { nom: "pc-1366", w: 1366, h: 657, classe: "ordinateur" },  // L'écran d'ordinateur le plus courant
  { nom: "pc-1536", w: 1536, h: 730, classe: "ordinateur" },  // un 1920 réglé à 125 %, très fréquent sur les portables
  { nom: "pc-1920", w: 1920, h: 960, classe: "ordinateur" },
  { nom: "pc-2560", w: 2560, h: 1300, classe: "ordinateur" },
];

/* ------------------------------------------------------------ les écrans */

const CODE = "1234";
// la langue de l'écran mesuré (LANGUE=en : l'application en anglais) — les libellés que le harnais cherche suivent
const EN = process.env.LANGUE === "en";
const L = (fr, en) => (EN ? en : fr);
const pave = async (p, chiffres) => { for (const c of chiffres) await p.getByRole("button", { name: c, exact: true }).first().click(); };
const ADRESSE_BEP20 = "0x7908cf9242fb2018f3487908cf9242fb2018f348";

/** chaque écran : comment y aller (une adresse, ou des gestes depuis une adresse) */
const ECRANS = [
  { nom: "accueil", aller: "/" },
  { nom: "notifications", aller: "/notifications" },
  { nom: "entrer-operateur", aller: "/entrer/operateur" },
  { nom: "entrer-montant", aller: "/entrer/operateur", puis: async (p) => { await p.getByText("MTN MoMo", { exact: true }).click(); await p.waitForURL(/montant$/); await pave(p, ["2", "5", "0", "000"]); } },
  { nom: "entrer-payer", aller: "/entrer/operateur", puis: async (p) => { await p.getByText("MTN MoMo", { exact: true }).click(); await p.waitForURL(/montant$/); await pave(p, ["1", "0", "000"]); await p.getByRole("button", { name: L("Continuer", "Continue") }).click(); await p.waitForURL(/payer/); } },
  { nom: "sortir-montant", aller: "/sortir/montant", puis: async (p) => pave(p, ["1", "0", "0", "000"]) },
  { nom: "sortir-destination", aller: "/sortir/montant", puis: async (p) => { await pave(p, ["1", "0", "000"]); await p.getByRole("button", { name: L("Continuer", "Continue") }).click(); await p.waitForURL(/destination$/); await p.getByText("6 77 12 34 56").click(); } },
  { nom: "sortir-verifier", aller: "/sortir/montant", puis: async (p) => { await pave(p, ["1", "0", "000"]); await p.getByRole("button", { name: L("Continuer", "Continue") }).click(); await p.getByText("6 77 12 34 56").click(); await p.getByRole("button", { name: L("Continuer", "Continue") }).click(); await p.waitForURL(/verifier$/); } },
  { nom: "marche", aller: "/marche" },
  { nom: "marche-graphique", aller: "/marche/graphique" },
  { nom: "marche-carnet", aller: "/marche/carnet" },
  { nom: "marche-ordres", aller: "/marche/ordres" },
  { nom: "rapide", aller: "/rapide", puis: async (p) => pave(p, ["5", "0", "000"]) },
  { nom: "crypto", aller: "/crypto" },
  { nom: "crypto-deposer", aller: "/crypto/deposer/USDT" },
  { nom: "crypto-retirer-adresse", aller: "/crypto/retirer/USDT/adresse", puis: async (p) => p.getByLabel(L("Adresse du wallet", "Wallet address")).fill(ADRESSE_BEP20) },
  { nom: "historique", aller: "/historique" },
  { nom: "historique-detail", aller: "/historique", puis: async (p) => { await p.getByText(L("Entrée MTN MoMo", "MTN MoMo deposit")).first().click(); await p.waitForURL(/historique\/XAFe-/); } },
  { nom: "compte", aller: "/compte" },
  { nom: "compte-informations", aller: "/compte/informations" },
  { nom: "compte-numeros", aller: "/compte/numeros" },
  { nom: "compte-numero-ajouter", aller: "/compte/numeros/ajouter" },
  { nom: "compte-paliers", aller: "/compte/paliers" },
  { nom: "compte-identite", aller: "/compte/paliers/identite" },
  { nom: "compte-securite", aller: "/compte/securite" },
  { nom: "compte-aide", aller: "/compte/aide" },
  { nom: "compte-fermer", aller: "/compte/fermer" },
  { nom: "conditions", aller: "/conditions" },
  { nom: "preuve", aller: "/preuve" },
];
/* sans session : à jouer dans une fenêtre neuve */
const ECRANS_ANONYMES = [
  { nom: "bienvenue", aller: "/bienvenue" },
  { nom: "bienvenue-code", aller: "/bienvenue", puis: async (p) => { await p.getByLabel(L("Adresse e-mail", "Email address")).fill("awa@exemple.com"); await p.getByRole("button", { name: L("Recevoir mon code", "Get my code") }).click(); await p.waitForURL(/code$/); } },
  { nom: "inscription-verifier", aller: "/bienvenue", puis: async (p) => {
    await p.getByLabel(L("Adresse e-mail", "Email address")).fill("grille@exemple.com"); await p.getByRole("button", { name: L("Recevoir mon code", "Get my code") }).click();
    await p.getByLabel(L("Code reçu par e-mail", "Code received by email")).fill("123456"); await p.waitForURL(/inscription$/);
    await p.getByLabel(L("Prénom", "First name")).fill("Awa"); await p.getByLabel(L("Nom de famille", "Last name")).fill("Ngono-Mballa"); await p.getByRole("button", { name: L("Continuer", "Continue") }).click();
    await p.getByLabel(L("Jour", "Day")).fill("12"); await p.getByLabel(L("Mois", "Month")).fill("03"); await p.getByLabel(L("Année", "Year")).fill("1994"); await p.getByRole("button", { name: L("Continuer", "Continue") }).click();
    await p.getByLabel(L("Numéro de téléphone", "Phone number"), { exact: true }).fill("677998811"); await p.getByRole("button", { name: L("Continuer", "Continue") }).click();
    await p.getByLabel(L("Ville", "City")).fill("Douala"); await p.keyboard.press("Escape"); await p.getByRole("button", { name: L("Continuer", "Continue") }).click();
  } },
];

/* ------------------------------------------------------------ le contrôle, dans la page */

/* Une fonction autonome : elle part telle quelle dans la page (page.evaluate). */
function controlerLaPage(options) {
  const fautes = [];
  const petits = [];
  const W = document.documentElement.clientWidth;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    }
    return true;
  };
  const nom = (el) => {
    const t = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `<${el.tagName.toLowerCase()}${t ? ` « ${t} »` : ""}>`;
  };
  /* dans un conteneur qui défile, ou qui ROGNE (une onde de toucher qui grandit dans son bouton) :
     ce qui dépasse ne se voit pas ; si le conteneur déborde lui-même, il est pris pour lui */
  const dansUnDefilant = (el) => {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (/(auto|scroll)/.test(s.overflowX) && e.scrollWidth > e.clientWidth) return true;
      if (/(hidden|clip)/.test(s.overflowX)) return true;
    }
    return false;
  };

  /* 1 · rien ne déborde à droite */
  if (document.documentElement.scrollWidth > W + 1) fautes.push(`défilement horizontal : la page fait ${document.documentElement.scrollWidth} px pour ${W}`);
  for (const el of document.body.querySelectorAll("*")) {
    if (!visible(el) || dansUnDefilant(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > W + 1 || r.left < -1) { fautes.push(`déborde : ${nom(el)} va de ${Math.round(r.left)} à ${Math.round(r.right)} px (fenêtre ${W})`); break; }
  }

  /* 2 · aucun texte coupé sans points de suspension */
  for (const el of document.body.querySelectorAll("*")) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (!visible(el) || el.closest("input,textarea,select,[aria-hidden=true]")) continue;
    const s = getComputedStyle(el);
    const coupeX = /(hidden|clip)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1 && s.textOverflow !== "ellipsis";
    const coupeY = /(hidden|clip)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 2 && !s.webkitLineClamp?.match(/\d/);
    if (coupeX || coupeY) fautes.push(`texte coupé : ${nom(el)}`);
  }

  /* 3 · chaque cible se touche ; 4 · rien de cliquable n'est caché dessous */
  const cibles = [...document.querySelectorAll("button, a[href], [role=button], [role=tab], [role=checkbox], [role=switch], input:not([type=hidden]), select, textarea")]
    .filter((el) => visible(el) && !el.disabled && !el.closest("[aria-hidden=true]"));
  for (const el of cibles) {
    const r = el.getBoundingClientRect();
    /* un lien DANS une phrase est exempté par WCAG ; il se touche par la ligne */
    const dansUnePhrase = (el.tagName === "A" || el.tagName === "BUTTON") && getComputedStyle(el).display === "inline" ;
    const cote = Math.min(r.width, r.height);
    if (!dansUnePhrase && cote < 24) fautes.push(`trop petit pour un doigt : ${nom(el)} fait ${Math.round(r.width)}×${Math.round(r.height)} (24 au moins)`);
    else if (!dansUnePhrase && cote < 44) petits.push(`${nom(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    /* ce que le doigt toucherait au centre de la cible est-il bien la cible ? (seulement dans la fenêtre) */
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (y > 0 && y < window.innerHeight && x > 0 && x < W) {
      const dessus = document.elementFromPoint(x, y);
      const meme = (a, b) => a && b && a === b;
      if (dessus && dessus !== el && !el.contains(dessus) && !dessus.contains(el) && !(el.tagName === "INPUT" && meme(dessus.closest("label,.MuiInputBase-root,.MuiCheckbox-root,.MuiSwitch-root,.MuiSlider-root"), el.closest("label,.MuiInputBase-root,.MuiCheckbox-root,.MuiSwitch-root,.MuiSlider-root")))) {
        /* sous une barre collée (onglets) : en haut de page, défiler la découvre — ce n'est une faute que si elle reste cachée tout en bas */
        let colle = false;
        for (let e = dessus; e && e !== document.body; e = e.parentElement) if (/(fixed|sticky)/.test(getComputedStyle(e).position)) { colle = true; break; }
        if (!colle || options.passe === "bas") fautes.push(`caché : ${nom(el)} est sous ${nom(dessus)}`);
      }
    }
    /* 5 · un champ sous 16 px fait zoomer l'iPhone sur toute la page */
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !/^(checkbox|radio|range)$/.test(el.type) && parseFloat(getComputedStyle(el).fontSize) < 16) {
      fautes.push(`l'iPhone zoomera : ${nom(el)} est en ${getComputedStyle(el).fontSize}`);
    }
  }

  /* 6 · une ligne de texte trop longue ne se lit plus (au-delà de ~ 80 signes) */
  if (options.largeur >= 840) {
    for (const el of document.body.querySelectorAll("p, .MuiTypography-body1, .MuiTypography-body2")) {
      if (!visible(el) || (el.textContent ?? "").length < 120) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (el.getBoundingClientRect().width > fs * 48) { fautes.push(`ligne trop longue : ${nom(el)} s'étale sur ${Math.round(el.getBoundingClientRect().width)} px`); break; }
    }
  }
  return { fautes: [...new Set(fautes)], petits };
}

async function controler(page, appareil) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const haut = await page.evaluate(controlerLaPage, { largeur: appareil.w, passe: "haut" });
  /* une seconde fois tout en bas : c'est là que la barre d'onglets peut recouvrir un bouton */
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(120);
  const bas = await page.evaluate(controlerLaPage, { largeur: appareil.w, passe: "bas" });
  /* axe regarde la page là où elle est : tout en bas, aucune barre collée ne recouvre le contenu */
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.addScriptTag({ content: AXE });
  const axe = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"], resultTypes: ["violations"] });
    return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `accessibilité (${v.id}) : ${v.help} — ${v.nodes.slice(0, 2).map((n) => {
        const d = n.any?.[0]?.data;
        const texte = (n.html.match(/>([^<]{1,40})</) ?? [])[1] ?? "";
        return `${texte ? `« ${texte.trim()} » ` : ""}${n.target.join(" ")}${d?.contrastRatio ? ` (${d.fgColor} sur ${d.bgColor} : ${d.contrastRatio}, il faut ${d.expectedContrastRatio})` : ""}`;
      }).join(" ; ")}`);
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  return { fautes: [...new Set([...haut.fautes, ...bas.fautes, ...axe])], petits: [...new Set([...haut.petits, ...bas.petits])] };
}

/* ------------------------------------------------------------ le témoin */

const PAGE_TEMOIN = `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width"><title>témoin</title></head>
<body style="margin:0;font:16px sans-serif">
  <main>
  <div style="width:2000px;height:10px;background:#eee">large</div>
  <button style="width:16px;height:16px;padding:0">x</button>
  <span style="display:block;width:60px;white-space:nowrap;overflow:hidden">1 250 000 XAF envoyés</span>
  <input aria-label="montant" style="font-size:12px;height:48px">
  <button style="display:block;margin-top:20px;height:48px;width:120px">Payer</button>
  <div style="position:fixed;left:0;top:96px;width:200px;height:80px;background:#fff">voile</div>
  <p style="color:#bbb;background:#fff">texte trop pâle pour se lire</p>
  </main>
</body></html>`;

async function temoin(navigateur) {
  const page = await navigateur.newPage({ viewport: { width: 360, height: 640 } });
  await page.setContent(PAGE_TEMOIN);
  const { fautes } = await controler(page, { w: 360 });
  await page.close();
  const attendues = [/défilement horizontal/, /trop petit pour un doigt/, /texte coupé/, /l'iPhone zoomera/, /caché : <button « Payer »>/, /accessibilité \(color-contrast\)/];
  const ratees = attendues.filter((re) => !fautes.some((f) => re.test(f)));
  if (ratees.length) {
    console.error(`✗ le TÉMOIN n'a pas été pris (${ratees.join(", ")}) : c'est le harnais qui est faux.\n  vu : ${fautes.join("\n  vu : ")}`);
    process.exit(2);
  }
}

/* ------------------------------------------------------------ le serveur */

const portPris = () => new Promise((ok) => { const s = createConnection({ port: PORT, host: "127.0.0.1" }); s.once("connect", () => { s.destroy(); ok(true); }); s.once("error", () => ok(false)); });
if (await portPris()) { console.error(`✗ Le port ${PORT} est déjà pris : le harnais mesurerait un autre serveur, peut-être du vieux code.`); process.exit(1); }
const serveur = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: new URL("..", import.meta.url).pathname, stdio: "ignore", detached: true });
const arreter = () => { try { process.kill(-serveur.pid, "SIGTERM"); } catch { /* déjà parti */ } };
process.on("exit", arreter);
for (let i = 0; i < 60 && !(await portPris()); i++) await new Promise((r) => setTimeout(r, 250));

/* ------------------------------------------------------------ allons-y */

process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK ??= "1";
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;
const navigateur = await chromium.launch({ proxy });
await temoin(navigateur);

const demandes = process.argv.slice(2);
const appareils = demandes.length ? APPAREILS.filter((a) => demandes.includes(a.nom)) : APPAREILS;
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const rapport = [];
let total = 0, petitsTotal = 0;

const pret = async (page) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  for (let i = 0; i < 40 && (await page.locator("[data-squelette]").count()) > 0; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(350);
};
const deverrouiller = async (page) => {
  if (await page.getByText(L("Votre code secret pour continuer", "Enter your PIN to continue")).count()) { await pave(page, CODE.split("")); await page.waitForTimeout(400); }
};

try {
  for (const a of appareils) {
    const ctx = await navigateur.newContext({ viewport: { width: a.w, height: a.h }, deviceScaleFactor: 1, isMobile: Boolean(a.mobile), hasTouch: Boolean(a.mobile), userAgent: a.ua, locale: process.env.LANGUE === "en" ? "en-US" : "fr-FR", permissions: ["clipboard-read", "clipboard-write"] });
    const fautesAppareil = [];
    /* d'abord sans session */
    for (const e of ECRANS_ANONYMES) {
      const page = await ctx.newPage();
      try {
        await page.goto(`${BASE}${e.aller}`); await pret(page);
        if (e.puis) { await e.puis(page); await pret(page); }
        const r = await controler(page, a);
        if (r.fautes.length) { fautesAppareil.push(...r.fautes.map((f) => `${e.nom} · ${f}`)); await page.screenshot({ path: `${OUT}${a.nom}--${e.nom}.png`, fullPage: true }); }
        petitsTotal += r.petits.length;
        rapport.push({ appareil: a.nom, ecran: e.nom, ...r });
      } catch (err) { fautesAppareil.push(`${e.nom} · l'écran ne s'atteint pas : ${String(err.message).split("\n")[0]}`); }
      await page.close();
      await ctx.clearCookies();
      await ctx.newPage().then(async (p) => { await p.goto(`${BASE}/bienvenue`); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.close(); });
    }
    /* puis la vitrine connectée */
    const page = await ctx.newPage();
    await page.goto(`${BASE}/bienvenue`);
    await page.getByLabel(L("Adresse e-mail", "Email address")).fill("demo@glisil.com");
    await page.getByRole("button", { name: L("Recevoir mon code", "Get my code") }).click();
    await page.getByLabel(L("Code reçu par e-mail", "Code received by email")).fill("123456");
    await page.waitForURL(`${BASE}/`);
    for (const e of ECRANS) {
      try {
        await page.goto(`${BASE}${e.aller}`); await pret(page); await deverrouiller(page); await pret(page);
        if (e.puis) { await e.puis(page); await pret(page); }
        const r = await controler(page, a);
        if (r.fautes.length) { fautesAppareil.push(...r.fautes.map((f) => `${e.nom} · ${f}`)); await page.screenshot({ path: `${OUT}${a.nom}--${e.nom}.png`, fullPage: true }); }
        petitsTotal += r.petits.length;
        rapport.push({ appareil: a.nom, ecran: e.nom, ...r });
      } catch (err) { fautesAppareil.push(`${e.nom} · l'écran ne s'atteint pas : ${String(err.message).split("\n")[0]}`); await page.screenshot({ path: `${OUT}${a.nom}--${e.nom}--inatteint.png` }).catch(() => {}); }
    }
    /* quelques écrans gardés en image pour l'œil, même quand tout va bien */
    for (const [nom, aller] of [["accueil", "/"], ["marche", "/marche"], ["sortir-montant", "/sortir/montant"]]) {
      await page.goto(`${BASE}${aller}`); await pret(page); await deverrouiller(page); await pret(page);
      await page.screenshot({ path: `${OUT}vue--${a.nom}--${nom}.png` });
    }
    await ctx.close();
    total += fautesAppareil.length;
    console.log(`${fautesAppareil.length ? "✗" : "✓"} ${a.nom.padEnd(20)} ${a.w}×${a.h}  ${fautesAppareil.length ? `${fautesAppareil.length} faute(s)` : "rien à redire"}`);
    for (const f of fautesAppareil.slice(0, 12)) console.log(`    ${f}`);
    if (fautesAppareil.length > 12) console.log(`    … et ${fautesAppareil.length - 12} de plus (captures/ecrans/rapport.json)`);
  }
  await writeFile(`${OUT}rapport.json`, JSON.stringify(rapport, null, 1));
  console.log(`\n${total ? "✗" : "✓"} ${appareils.length} appareils × ${ECRANS.length + ECRANS_ANONYMES.length} écrans : ${total} faute(s) ; ${petitsTotal} cible(s) entre 24 et 44 points (à surveiller, pas bloquant) ; témoin pris`);
  process.exitCode = total ? 1 : 0;
} finally {
  await navigateur.close();
  arreter();
}
