// L'ADMINISTRATION, PARCOURUE DANS UN VRAI CHROMIUM.
//
//   npm run build && node scripts/parcourir.mjs
//
// Se connecte en super admin, lit le tableau, rapproche un SMS retenu et
// vérifie que le client est crédité, rembourse un autre, crée un terminal et
// voit sa clé une fois, valide des pièces et voit le palier monter, ferme le
// marché, relit le journal — puis se connecte en support et exige de ne PAS
// voir les boutons qui ne sont pas à lui. Échoue à la première erreur de
// console. Captures dans admin/captures/.
import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createConnection } from "node:net";

const PORT = 4190;
const BASE = `http://localhost:${PORT}`;
const OUT = new URL("../captures/", import.meta.url).pathname;
const { chromium } = createRequire(`${process.env.PLAYWRIGHT_ROOT || "/opt/node-tools/node_modules"}/`)("playwright");

const portPris = () => new Promise((r) => { const s = createConnection({ port: PORT, host: "127.0.0.1" }); s.once("connect", () => { s.destroy(); r(true); }); s.once("error", () => r(false)); });
if (await portPris()) { console.error(`✗ Le port ${PORT} est déjà pris.`); process.exit(1); }
const serveur = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: new URL("..", import.meta.url).pathname, stdio: "ignore", detached: true });
const arreter = () => { try { process.kill(-serveur.pid, "SIGTERM"); } catch { /* déjà parti */ } };
process.on("exit", arreter);
for (let i = 0; i < 60 && !(await portPris()); i++) await new Promise((r) => setTimeout(r, 250));

await mkdir(OUT, { recursive: true });
/* les captures d'un parcours précédent ne restent pas à côté de celles-ci : des numéros décalés trompent l'œil */
for (const f of await readdir(OUT)) if (f.endsWith(".png")) await rm(`${OUT}${f}`);
process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK ??= "1";
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;
const navigateur = await chromium.launch({ proxy });
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
const page = await contexte.newPage();
const erreurs = [];
page.on("pageerror", (e) => erreurs.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts.googleapis|net::ERR/.test(m.text())) erreurs.push(`console: ${m.text()}`); });
let n = 0;
const capturer = (nom) => page.screenshot({ path: `${OUT}${String(++n).padStart(2, "0")}-${nom}.png`, fullPage: true });
const voir = (t, delai = 15_000) => (t instanceof RegExp ? page.getByText(t) : page.getByText(t, { exact: false })).first().waitFor({ timeout: delai });
const exiger = (c, m) => { if (!c) throw new Error(`✗ ${m}`); };
const etape = (t) => console.log(`· ${t}`);

try {
  etape("Connexion en super admin : mot de passe, puis le code de l'application (un code faux refusé) ; tableau");
  await page.goto(`${BASE}/`);
  await page.waitForURL(/\/connexion$/);
  await capturer("connexion");
  await page.getByLabel("Mot de passe", { exact: true }).fill("pas-le-bon-1");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await voir("adresse ou mot de passe incorrect");
  await page.getByLabel("Mot de passe", { exact: true }).fill("Glisil-2026");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByLabel("Code de l'application d'authentification").waitFor();
  await capturer("connexion-code-application");
  await page.getByLabel("Code de l'application d'authentification").fill("000000");
  await voir("code de l'application incorrect ou expiré");
  exiger(new URL(page.url()).pathname === "/connexion", "un code faux n'ouvre rien");
  await page.getByLabel("Code de l'application d'authentification").fill("123456");
  await page.waitForURL(`${BASE}/`);
  await voir("XAFe en circulation");
  await voir("SMS retenus");
  await capturer("tableau");

  etape("Entrées : rapprocher un SMS retenu, le client est crédité ; rembourser un autre");
  await page.goto(`${BASE}/clients/c2`);
  await voir("Jean Kamdem");
  const xafeAvant = await page.locator('[data-tuile="XAFe"] h4').innerText();
  await page.goto(`${BASE}/entrees?onglet=retenues`);
  await voir("PP2610121402A20394817501");
  await capturer("entrees-retenues");
  const ligne = page.getByRole("row").filter({ hasText: "PP2610121402A20394817501" });
  await ligne.getByRole("button", { name: "Rapprocher" }).click();
  await voir("Rapprocher PP2610121402A20394817501");
  await page.getByRole("combobox").click();
  await page.getByRole("option").filter({ hasText: "Jean Kamdem" }).first().click();
  await capturer("entrees-rapprocher");
  await page.getByRole("button", { name: "Créditer le client" }).click();
  await voir("150 000 XAFe crédités");
  exiger((await page.getByRole("row").filter({ hasText: "PP2610121402A20394817501" }).count()) === 0, "le SMS rapproché a quitté la liste des retenus");
  await page.goto(`${BASE}/clients/c2`);
  await voir("Jean Kamdem");
  const xafeApres = await page.locator('[data-tuile="XAFe"] h4').innerText();
  exiger(xafeAvant !== xafeApres, `le solde XAFe de Jean a changé (${xafeAvant} → ${xafeApres})`);
  await capturer("client-detail");
  // la bêta : l'équipe donne de l'argent de test, le solde bouge, la dotation se journalise
  const avantDotation = await page.locator('[data-tuile="XAFe"] h4').innerText();
  await page.getByRole("button", { name: "Donner de l'argent de test" }).click();
  await page.getByLabel("XAFe").fill("500000");
  await page.getByRole("button", { name: "Donner", exact: true }).click();
  await page.locator('[data-tuile="XAFe"] h4').filter({ hasNotText: avantDotation }).waitFor();
  await page.goto(`${BASE}/entrees?onglet=retenues`);
  await page.getByRole("row").filter({ hasText: "20394817502" }).getByRole("button", { name: "Rembourser" }).click();
  await page.getByLabel("Pourquoi").fill("payeur inconnu, aucun dossier");
  await page.getByRole("button", { name: "Rembourser par TOTEM" }).click();
  await voir("48 000 XAF à rembourser");
  await page.getByText("Remboursés").click();
  await voir("20394817502");

  etape("Sorties : libérer le transfert coincé");
  await page.goto(`${BASE}/sorties`);
  await voir("XAFe-WD-");
  await capturer("sorties");
  await page.getByRole("button", { name: /XAFe-WD-/ }).first().click();
  await page.getByRole("button", { name: "Libérer" }).click();
  await voir("en attente");

  etape("Remboursements à la main (0038) : rien n'est détruit sans le SMS de la puce");
  await page.goto(`${BASE}/sorties`);
  await voir("À payer · 1 · en preuve · 2");
  await voir("SMS de la puce : concorde");
  await voir(/le SMS dit 95.000 XAF, ce paiement 99.500 XAF/);
  exiger(await page.getByRole("button", { name: "Forcer" }).count() === 0, "le forçage est fermé par défaut : pas de bouton");
  exiger(await page.locator('[data-etat="en_preuve"]').getByRole("button", { name: "Refuser" }).count() === 0, "payée, une sortie ne se refuse plus");
  await capturer("sorties-a-payer");
  const carte = (texte) => page.locator("[data-demande]").filter({ hasText: texte });

  etape("· au-delà du seuil, prouvée par la puce : une autre personne confirme, et la sortie se clôt");
  await carte("à confirmer").getByRole("button", { name: "Confirmer le paiement" }).click();
  await voir(/envoyée : le SMS de la puce concorde, les XAFe sont détruits/);

  etape("· l'écart : Revérifier ne clôt rien ; l'ID mal tapé se corrige ; le reste se paie, et la puce le prouve");
  await carte("écart").getByRole("button", { name: "Revérifier" }).click();
  await voir(/reste ouverte : le SMS dit 95.000 XAF/);
  exiger(await carte("écart").count() === 1, "un écart reste ouvert");
  await carte("écart").getByRole("button", { name: "Corriger l'ID" }).click();
  await page.getByLabel("Le bon transaction ID").fill("MP261029.0812.A31207");
  await page.getByLabel("Le bon montant (XAF, facultatif)").fill("95000");
  await page.getByLabel("Ce qui était mal tapé").fill("le montant envoyé était 95 000");
  await page.waitForFunction(() => { const c = document.querySelector(".MuiDialog-container"); return c && getComputedStyle(c).opacity === "1"; });
  await capturer("sorties-corriger");
  await page.getByRole("dialog").getByRole("button", { name: "Remplacer" }).click();
  await voir(/payée en partie : il reste 4.500 XAF/);
  await carte("payée en partie").getByRole("button", { name: "Payer le reste" }).click();
  exiger((await page.getByLabel("Montant de ce paiement (XAF)").inputValue()) === "4500", "le reste est proposé");
  await page.getByLabel("Transaction ID (du SMS de l'opérateur)").fill("MP261029.1015.A31299");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer le paiement" }).click();
  await voir(/en preuve : elle se clôt toute seule dès que TOTEM relève le SMS de la puce/);
  await voir("payée · attend le SMS de la puce");
  await capturer("sorties-en-preuve");
  /* TOTEM « relève » le SMS quelques secondes après : la sortie se clôt seule */
  await page.locator('[data-etat="en_preuve"]').waitFor({ state: "detached", timeout: 20_000 });

  etape("· à payer : le SMS déjà relevé s'offre en candidat ; il remplit l'ID et le montant ; la sortie se clôt aussitôt");
  await carte("à payer").getByRole("button", { name: "J'ai payé" }).click();
  await page.locator('[data-candidat="MP261029.1003.D55120"]').click();
  exiger((await page.getByLabel("Transaction ID (du SMS de l'opérateur)").inputValue()) === "MP261029.1003.D55120", "le candidat remplit l'ID");
  exiger((await page.getByLabel("Montant de ce paiement (XAF)").inputValue()) === "248750", "…et le montant");
  /* une vraie image, pas un nom : le contrôle lit le type et la taille */
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  await page.locator('input[type="file"]').setInputFiles({ name: "capture-momo.png", mimeType: "image/png", buffer: png });
  await voir("capture-momo.png");
  await page.waitForFunction(() => { const c = document.querySelector(".MuiDialog-container"); return c && getComputedStyle(c).opacity === "1"; });
  await capturer("sorties-payer");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer le paiement" }).click();
  await voir(/envoyée : le SMS de la puce concorde/);
  exiger(await page.locator("[data-demande]").count() === 0, "plus rien à payer");
  await voir("Sorti du float, sans sortie en face");
  const sansSortie = page.getByText("Sorti du float, sans sortie en face").locator("xpath=ancestor::*[.//table][1]//table");
  exiger(await sansSortie.getByText("MP261016.0912.B09311").count() === 1, "le SMS que rien n'explique y reste");
  exiger(await sansSortie.getByText("MP261029.1003.D55120").count() === 0, "le SMS qui prouve une sortie n'est plus « sans sortie en face »");

  etape("Terminaux : créer un boîtier, voir sa clé une fois");
  await page.goto(`${BASE}/terminaux`);
  await voir("Akwa 1");
  await capturer("terminaux");
  await page.getByRole("button", { name: "Nouveau terminal" }).click();
  await page.getByLabel("Identifiant").fill("kribi-1");
  await page.getByLabel("Nom").fill("Kribi plage");
  await page.getByLabel("Lieu").fill("Kribi");
  await page.getByRole("button", { name: "Créer et montrer la clé" }).click();
  await voir("La clé de kribi-1");
  const cle = await page.locator("[data-cle]").innerText();
  exiger(/^[0-9a-f]{64}$/.test(cle), `la clé fait 64 hexadécimaux (${cle.length})`);
  await capturer("terminaux-cle");
  await page.getByRole("button", { name: "Fermer" }).click();
  await voir("Kribi plage");
  /* renouveler une clé coupe le boîtier : on le demande, et « Annuler » ne touche à rien */
  await page.getByRole("button", { name: "Renouveler la clé" }).first().click();
  await voir("cesse de marcher");
  await page.getByRole("dialog").getByRole("button", { name: "Annuler" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  exiger(await page.locator("[data-cle]").count() === 0, "annuler ne renouvelle rien");
  await page.getByRole("button", { name: "Renouveler la clé" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Renouveler la clé" }).click();
  await page.locator("[data-cle]").waitFor();
  await page.getByRole("button", { name: "Fermer" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });

  /* retirer un float que des dossiers ouverts donnent à payer : on dit combien, et « Annuler » ne touche à rien */
  const interrupteur = page.getByRole("checkbox", { name: "float 677000000 actif" });
  await interrupteur.click();
  await voir("1 dossier ouvert");
  await page.waitForFunction(() => { const c = document.querySelector(".MuiDialog-container"); return c && getComputedStyle(c).opacity === "1"; });
  await capturer("terminaux-retirer-float");
  await page.getByRole("dialog").getByRole("button", { name: "Annuler" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  exiger(await interrupteur.isChecked(), "annuler laisse le float actif");
  await interrupteur.click();
  await page.getByRole("dialog").getByRole("button", { name: "Retirer le float" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  exiger(!(await interrupteur.isChecked()), "le float est retiré");
  await interrupteur.click();
  exiger(await page.getByRole("dialog").count() === 0 && (await interrupteur.isChecked()), "le remettre ne demande rien");
  /* un float qu'aucun dossier ne vise se retire sans question */
  const libre = page.getByRole("checkbox", { name: "float 699000000 actif" });
  await libre.click();
  exiger(await page.getByRole("dialog").count() === 0 && !(await libre.isChecked()), "un float sans dossier ouvert se retire d'un geste");
  await libre.click();

  etape("Clients : valider des pièces, le palier monte");
  await page.goto(`${BASE}/clients?filtre=verifications`);
  await voir("Paul Biya Mbarga");
  await capturer("clients-verifications");
  await page.goto(`${BASE}/clients/c5`);
  await voir("Identité à vérifier");
  await page.getByRole("button", { name: "Examiner les pièces" }).click();
  await page.getByRole("button", { name: /Valider → palier 1/ }).click();
  await page.getByText("Palier 1 · identité vérifiée").waitFor();
  exiger((await page.getByRole("button", { name: "Examiner les pièces" }).count()) === 0, "plus rien à examiner");

  etape("Sécurité d'un client : sa double authentification, ses codes ; le super admin la réinitialise, motif obligatoire");
  await voir("Double authentification");
  await voir("active");
  await voir("non vérifié");
  exiger(await page.getByText("Code secret").count() === 0, "plus de code secret sur la fiche");
  await page.getByRole("button", { name: "Réinitialiser la double authentification" }).click();
  await page.getByLabel("Comment l'identité a été vérifiée").fill("appel");
  exiger(await page.getByRole("button", { name: "Retirer son application" }).isDisabled(), "sans un vrai motif, rien ne se retire");
  await page.getByLabel("Comment l'identité a été vérifiée").fill("Appel vidéo, CNI comparée au selfie du dossier");
  await capturer("client-reinitialiser-2fa");
  await page.getByRole("button", { name: "Retirer son application" }).click();
  await voir("absente — le client l'ajoutera à sa prochaine connexion");
  await voir("Réinitialisation autorisée par l'équipe");
  await voir("Appel vidéo, CNI comparée au selfie du dossier");
  await capturer("client-securite");

  etape("Marché : fermer puis rouvrir");
  await page.goto(`${BASE}/marche`);
  await voir("Dernières transactions");
  await capturer("marche");
  await page.getByLabel("marché ouvert").click();
  await voir("Marché fermé");
  await page.getByLabel("marché ouvert").click();
  await voir("Marché ouvert");

  etape("Bêta : les testeurs, l'argent de test, les robots, le vrai dollar, les signalements");
  await page.goto(`${BASE}/beta`);
  await voir("Les robots du marché");
  await voir("Robot · teneur de marché");
  await voir("Robot · trader 14");
  await voir("Le vrai dollar");
  exiger(await page.locator('[data-tuile="1 USD"]').count() === 1, "le vrai dollar est dit");
  await voir("Le bandeau bêta cache le bouton Retour");
  await capturer("beta");
  await page.getByLabel("robots en marche").click();
  await voir("Robots arrêtés");
  await page.getByLabel("robots en marche").click();
  await voir("Robots en marche");
  // traiter un signalement : il passe « réglé », la note reste
  await page.getByRole("row", { name: /Après avoir acheté 200 USDT/ }).getByRole("button", { name: "Traiter" }).click();
  await page.getByLabel("Note de l'équipe").fill("le solde se relit maintenant tout de suite");
  await page.getByRole("button", { name: "Réglé" }).click();
  await voir("Note : le solde se relit maintenant tout de suite");
  await page.getByRole("row", { name: /Après avoir acheté 200 USDT/ }).getByText("réglé", { exact: true }).waitFor();
  // un cours posé à la main devient la référence
  await page.getByRole("button", { name: "Poser un cours" }).click();
  await page.getByRole("textbox", { name: "EUR/USD" }).fill("1,10");
  await voir("1 USD = 596");
  await page.getByRole("button", { name: "Poser", exact: true }).click();
  await page.locator('[data-tuile="Prix de référence posé"]').getByText("596,30").waitFor();

  etape("Équipe : inviter une personne, l'invitation attend sa première connexion, on la retire");
  await page.goto(`${BASE}/equipe`);
  await voir("Invitations en attente");
  await page.getByRole("button", { name: "Inviter quelqu'un" }).click();
  await page.getByLabel("Adresse e-mail").fill("fatou@glisil.com");
  await page.getByLabel("Nom", { exact: true }).fill("Fatou Bello");
  await page.getByRole("button", { name: "Inviter", exact: true }).click();
  await voir("fatou@glisil.com");
  await capturer("equipe");
  exiger((await page.getByLabel("Rôle de Nelson Soh").count()) === 0, "on ne change pas son propre rôle");
  await page.getByRole("row", { name: /fatou@glisil.com/ }).getByRole("button", { name: "Retirer" }).click();
  await page.getByText("fatou@glisil.com").waitFor({ state: "detached" });

  etape("Paramètres et journal");
  await page.goto(`${BASE}/parametres`);
  await voir("MTN MoMo");
  await capturer("parametres");
  /* un brouillon en cours survit à l'enregistrement d'un AUTRE bloc (la relecture réécrivait tous les blocs) */
  const brouillon = '{\n  "validite_minutes": 45,\n  "grace_minutes": 120\n}';
  await page.getByLabel("paramètre depot").fill(brouillon);
  await page.getByLabel("paramètre sortie").fill('{\n  "reprises_max": 4\n}');
  await page.getByLabel("paramètre sortie").locator("xpath=ancestor::div[contains(@class,'MuiPaper-root')][1]").getByRole("button", { name: "Enregistrer" }).click();
  await voir("Enregistré");
  await page.waitForTimeout(500);
  exiger((await page.getByLabel("paramètre depot").inputValue()) === brouillon, "le brouillon des dépôts, pas encore enregistré, est encore là");
  await page.goto(`${BASE}/journal`);
  await voir("a rapproché un SMS retenu");
  await voir("a remboursé un SMS retenu");
  await voir("a créé un terminal");
  await voir("a validé des pièces");
  await capturer("journal");

  etape("Sorties : un transfert cloué à un boîtier muet se réaffecte ; la sortie s'annule, ses XAFe reviennent");
  await page.goto(`${BASE}/sorties`);
  await page.getByRole("button", { name: /XAFe-WD-/ }).last().click();
  await page.getByRole("button", { name: "Réaffecter" }).first().click();
  await voir("Vers le boîtier");
  await page.getByLabel("Vers le boîtier").click();
  await page.getByRole("option").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Réaffecter" }).click();
  await voir("donné à");
  await page.getByRole("button", { name: "Annuler ce qui n'est pas parti" }).first().click();
  await page.getByLabel("Pourquoi (le journal le garde)").fill("boîtier de Yaoundé en panne");
  // un état, pas une durée : le dialogue a fini d'apparaître
  await page.waitForFunction(() => { const c = document.querySelector(".MuiDialog-container"); return c && getComputedStyle(c).opacity === "1"; });
  await capturer("sorties-annuler");
  await page.getByRole("dialog").getByRole("button", { name: "Annuler et rendre les XAFe" }).click();
  await voir("XAFe revenus au client");

  etape("Une lecture qui échoue se dit : pas d'état vide rassurant, pas de « Chargement… » sans fin");
  await page.goto(`${BASE}/entrees`);
  await page.evaluate(() => { globalThis.__xafeEpreuve = { desactive: true }; });
  await page.getByRole("tab", { name: "SMS retenus" }).click().catch(() => {});
  await voir("Une lecture a échoué");
  await voir("Rien à montrer : la lecture a échoué");
  exiger(await page.getByText("tout ce qui est arrivé a trouvé son dossier").count() === 0, "une lecture ratée ne se fait pas passer pour une liste vide");
  await capturer("lecture-en-panne");
  await page.evaluate(() => { globalThis.__xafeEpreuve = {}; });
  await page.getByRole("button", { name: "Réessayer" }).click();
  await page.locator("[data-lecture-en-panne]").waitFor({ state: "detached" });

  etape("Le support ne voit que ce qui est à lui");

  etape("Wallets : le chaud, le froid, ce qui réclame quelqu'un, ce qu'on doit");
  await page.goto(`${BASE}/wallets`);
  await voir("BNB Smart Chain · BEP20");
  await voir("Tron · TRC20");
  await voir("attendent leur inscription au contrat");
  await voir("manque de TRX");
  await voir("jamais attribuée à un client");
  exiger(await page.locator('[data-tuile="Couverture"]').count() === 1, "la couverture des USDT dus est dite");
  await capturer("wallets");

  etape("Réseaux : BSC maison ne se ferme pas, Solana ne s'ouvre pas, Base (contrat posé) s'ouvre après confirmation");
  await voir("maison · la réserve");
  await voir("pas encore de veilleur");
  const ligneReseau = (nom) => page.locator("tr", { has: page.getByText(nom, { exact: true }) });
  exiger(await ligneReseau("BNB Smart Chain").getByRole("button", { name: /^(Ouvrir|Fermer)$/ }).count() === 0, "le réseau maison n'a pas de bouton « Fermer »");
  exiger(await ligneReseau("Solana").getByRole("button", { name: /^(Ouvrir|Fermer)$/ }).count() === 0, "Solana n'a pas de bouton « Ouvrir »");
  exiger(await ligneReseau("Ethereum").getByRole("button", { name: /^(Ouvrir|Fermer)$/ }).count() === 0, "Ethereum, sans contrat, n'a pas de bouton « Ouvrir »");
  await ligneReseau("Base").getByRole("button", { name: "Ouvrir" }).click();
  await voir("Ouvrir Base aux clients ?");
  await capturer("reseaux-ouvrir");
  await page.getByRole("button", { name: "Ouvrir le réseau" }).click();
  await ligneReseau("Base").getByRole("button", { name: "Fermer" }).waitFor();
  await voir("ouvert aux clients");
  await ligneReseau("Base").getByRole("button", { name: "Fermer" }).click();
  await page.getByRole("button", { name: "Fermer le réseau" }).click();
  await ligneReseau("Base").getByRole("button", { name: "Ouvrir" }).waitFor();

  etape("Parité : floats, registre, chaîne — et un relevé d'opérateur saisi");
  await page.goto(`${BASE}/parite`);
  await voir("La parité tient");
  await voir("1 · Les floats");
  await voir("2 · Le registre");
  await voir("3 · La chaîne");
  await voir("XAFe-DP-000512");
  exiger(await page.locator("[data-statut]").count() === 1, "le bandeau dit l'état de la parité");
  exiger(await page.getByText("en route", { exact: true }).count() >= 1, "une frappe en route se montre comme telle");
  await capturer("parite");
  await page.getByRole("button", { name: "Saisir un relevé" }).first().click();
  await page.getByLabel("solde du relevé").fill("4 250 000");
  exiger(await page.getByRole("button", { name: "Enregistrer le relevé" }).isDisabled(), "sans le fichier du relevé, rien ne s'enregistre");
  await page.locator('input[type="file"]').setInputFiles({ name: "releve-mtn.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 releve") });
  await page.getByRole("button", { name: "Enregistrer le relevé" }).click();
  await voir("relevé officiel");
  await voir("4 250 000 XAF");
  await capturer("parite-releve");
  await page.goto(`${BASE}/`);
  exiger(await page.locator("[data-parite]").count() === 1, "le tableau de bord dit la parité");

  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL(/\/connexion$/);
  await page.getByLabel("Adresse e-mail").fill("support@glisil.com");
  await page.getByLabel("Mot de passe", { exact: true }).fill("Glisil-2026");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByLabel("Code de l'application d'authentification").fill("123456");
  await page.waitForURL(`${BASE}/`);
  await voir("Serge Kamga");
  await page.goto(`${BASE}/entrees?onglet=retenues`);
  await voir("PP2610120912B77410");
  exiger((await page.getByRole("button", { name: "Rapprocher" }).count()) === 0, "le support n'a pas le bouton Rapprocher");
  exiger((await page.getByRole("button", { name: "Rembourser" }).count()) === 0, "le support n'a pas le bouton Rembourser");
  await page.goto(`${BASE}/terminaux`);
  await voir("Akwa 1");
  exiger((await page.getByRole("button", { name: "Nouveau terminal" }).count()) === 0, "le support ne crée pas de terminal");
  await capturer("support-terminaux");
  await page.goto(`${BASE}/parite`);
  await voir("1 · Les floats");
  exiger((await page.getByRole("button", { name: "Saisir un relevé" }).count()) === 0, "le support ne saisit pas de relevé");
  await page.goto(`${BASE}/beta`);
  await voir("Ce que les testeurs signalent");
  exiger((await page.getByLabel("robots en marche").count()) === 0, "le support n'arrête pas les robots");
  exiger((await page.getByRole("button", { name: "Poser un cours" }).count()) === 0, "le support ne pose pas de cours");
  await page.goto(`${BASE}/clients/c5`);
  await voir("Double authentification");
  exiger((await page.getByRole("button", { name: "Réinitialiser la double authentification" }).count()) === 0, "le support ne réinitialise pas la double authentification");
  exiger(await page.getByText("Appel vidéo, CNI comparée au selfie du dossier").count() === 0, "le motif d'une réinitialisation est réservé au super admin");

  etape("Première connexion d'une adresse qui n'est pas invitée : mot de passe, code e-mail, application, codes de secours — puis refusée");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL(/\/connexion$/);
  await page.getByRole("button", { name: "Première connexion" }).click();
  await page.getByLabel("Adresse e-mail").fill("curieux@exemple.com");
  await page.getByLabel("Nouveau mot de passe").fill("court1");
  exiger(await page.getByRole("button", { name: "Choisir ce mot de passe" }).isDisabled(), "un mot de passe trop faible ne se choisit pas");
  await page.getByLabel("Nouveau mot de passe").fill("Curieux-2026");
  await page.getByRole("button", { name: "Choisir ce mot de passe" }).click();
  await page.getByLabel("Code reçu par e-mail").fill("123456");
  await page.locator("[data-cle-totp]").waitFor();
  await capturer("premiere-connexion-application");
  await page.getByLabel("Code de l'application d'authentification").fill("123456");
  await page.locator("[data-codes-de-secours]").waitFor();
  exiger(await page.getByRole("button", { name: "Continuer" }).isDisabled(), "les codes se notent avant de continuer");
  await capturer("premiere-connexion-codes");
  await page.getByText("J'ai noté ou enregistré mes codes").click();
  await page.getByRole("button", { name: "Continuer" }).click();
  await voir("cette adresse n'administre pas Glisil");
  exiger(new URL(page.url()).pathname === "/connexion", "une adresse qui n'est pas invitée n'entre pas");
  await page.goto(`${BASE}/`);
  await page.waitForURL(/\/connexion$/);

  exiger(erreurs.length === 0, `des erreurs ont été vues dans le navigateur :\n  ${erreurs.join("\n  ")}`);
  console.log(`✓ l'administration tient (${n} captures dans admin/captures/)`);
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
