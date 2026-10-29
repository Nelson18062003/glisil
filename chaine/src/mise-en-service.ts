/*
 * LA MISE EN SERVICE DES WALLETS — les gestes à faire une fois, dans l'ordre.
 *
 *   npm run mise-en-service -- graine
 *       Sur VOTRE machine, hors ligne si possible, jamais sur le serveur :
 *       crée la graine (24 mots) et montre les deux wallets chauds qui en
 *       découlent. Les mots s'écrivent sur papier, en deux exemplaires, dans
 *       deux lieux différents. Rien n'est écrit sur le disque.
 *
 *   npm run mise-en-service -- adresses             (XAFE_GRAINE)
 *       Les wallets chauds d'une graine existante (indice 0), un par réseau.
 *
 *   npm run mise-en-service -- deployer --reseau bep20|trc20|… --chaud <adresse> [--admin <a>] [--pauseur <a>] [--geleur <a>]
 *                                       [--plafond <XAF>] [--usdt <contrat> | --usdt-essai] [--natif 0.05] [--production]
 *       Déploie le contrat XAFe : le constructeur pose TOUS les rôles d'un coup
 *       — admin, frappeur et destructeur (le chaud), pauseur, geleur, et
 *       l'inscripteur (la clé qui déploie, qui inscrira le stock d'adresses puis
 *       y renoncera). Plafond par défaut : 1 000 000 000 XAF par jour.
 *       Réseau d'ESSAI : la clé ADMIN_CLE, admin par défaut, un USDT d'essai si
 *       demandé, des frais pour le chaud.
 *       --production : la clé CLE_DE_MISE_EN_SERVICE (jetable, jamais admin),
 *       --admin, --pauseur et --geleur exigés (le wallet matériel du
 *       propriétaire), l'USDT officiel du réseau, jamais d'USDT d'essai.
 *       Un réseau PRINCIPAL (lu au nœud : BSC 56, Ethereum, Base, Polygon, le
 *       nœud Tron de production) ne se déploie qu'en --production
 *       (options-de-deploiement.ts, éprouvé seul).
 *       Écrit le bloc du paramètre « chaine » (noeud, xafe, usdt, depart).
 *
 *   npm run mise-en-service -- preinscrire --reseau … --xafe <contrat> --de 1 --a 2000 [--lot N] [--renoncer]
 *       (XAFE_GRAINE, et la clé qui tient INSCRIPTEUR) Inscrit d'avance au
 *       contrat les adresses de dépôt dérivées de la graine, de l'indice --de à
 *       --a. --renoncer : la clé renonce ensuite au rôle (vérifié).
 *
 *   npm run mise-en-service -- plafond --reseau … --xafe <contrat> [--xaf N]
 *       Le plafond de frappe du jour et ce qu'il en reste ; avec --xaf, le
 *       chiffre EXACT à coller dans BscScan / Tronscan → Write contract →
 *       fixerPlafondJour, depuis le wallet admin. Ne signe lui-même que sur un
 *       réseau d'essai, quand ADMIN_CLE est l'admin du contrat.
 *
 *   npm run mise-en-service -- roles --reseau … --xafe <contrat> --chaud <adresse>
 *       Les rôles d'un contrat d'AVANT le correctif de la réserve (réseau
 *       d'essai). Un contrat neuf naît avec ses rôles.
 *
 *   npm run mise-en-service -- inscrire --reseau … --xafe <contrat> [adresses… | --toutes-attribuees]
 *       L'ADMIN inscrit au contrat des adresses de dépôt XAFe. Sans adresse :
 *       celles que le veilleur a publiées comme « à inscrire » ; avec
 *       --toutes-attribuees : toutes celles que le moteur a déjà données à des
 *       clients (le passage de la bêta sur un nouveau contrat).
 *
 *   npm run mise-en-service -- verifier [--production]
 *       Avec la configuration du veilleur : la graine, le moteur, chaque
 *       réseau (nœud, contrats, décimales, la réserve dans le contrat, les
 *       rôles — le chaud n'a QUE frappeur et destructeur —, le plafond, le
 *       stock d'adresses, les frais, le froid). Rien n'est envoyé. À relancer
 *       avant d'ouvrir les retraits.
 *
 * En PRODUCTION, l'admin du contrat est le wallet matériel du propriétaire dès
 * le bloc 0 (le constructeur le pose) : le plafond, la reprise après une pause,
 * les inscriptions de l'admin s'y signent (BscScan / TronScan, « Write
 * contract »). La clé de mise en service ne sert qu'au déploiement et au
 * stock d'adresses, puis se jette : elle ne tient plus aucun rôle.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { formatUnits, JsonRpcProvider, Mnemonic, parseUnits } from "ethers";
import type { Actif, Chaine } from "./chaine.ts";
import { CHAUD, deriver, estReseau, fiche, graineValide, prefixe, RESEAUX, variableDuNoeud, type Reseau } from "./cles.ts";
import { ChaineEvm } from "./evm.ts";
import { moteur } from "./moteur.ts";
import { aLeRole, donnerLesRoles, INSCRIPTEUR, inscrire, preinscrire, renoncer, ROLES, ROLES_DE_GARDE, signataireEvm, signataireTron, type Artefact, type Signataire } from "./signataire.ts";
import { estReseauPrincipal, USDT_OFFICIEL, verifierLesOptions } from "./options-de-deploiement.ts";
import { noeudsDesCles } from "./service.ts";
import { ChaineTron, vingtOctets } from "./tron.ts";

// EVM_RPC_KEY et TRONGRID_KEY (Infisical) donnent les nœuds des réseaux principaux (service.ts, noeudsDesCles)
const env: NodeJS.ProcessEnv = { ...process.env, ...noeudsDesCles(process.env) };
const NATIF = (r: Reseau) => {
  const f = fiche(r);
  return { nom: f.natif, decimales: f.decimalesNatif, defaut: f.natifEssai, minimum: String(f.natifMinimum) };
};
const PREFIXE = prefixe;
const TOUS = Object.keys(RESEAUX) as Reseau[];

function options(args: string[]) {
  const o: Record<string, string | true> = {};
  const libres: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const suivant = args[i + 1];
      if (suivant === undefined || suivant.startsWith("--")) o[a.slice(2)] = true; else { o[a.slice(2)] = suivant; i++; }
    } else libres.push(a);
  }
  return { o, libres };
}
const arreter = (texte: string): never => { console.error(`✗ ${texte}`); process.exit(1); };
const reseauDe = (o: Record<string, string | true>): Reseau => {
  const r = o.reseau;
  if (!estReseau(r)) arreter(`--reseau ${TOUS.join(" | ")}`);
  return r as Reseau;
};
const valable = (r: Reseau, a: string) => fiche(r).famille === "evm" ? /^0x[0-9a-fA-F]{40}$/.test(a) : vingtOctets(a) !== null;

/** l'USDT officiel de chaque réseau principal (à revérifier sur tether.to avant usage) */
const memeAdresse = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function signataire(r: Reseau, production = false): Signataire {
  const cle = production
    ? env.CLE_DE_MISE_EN_SERVICE ?? arreter("CLE_DE_MISE_EN_SERVICE manque (une clé jetable, financée pour le déploiement : jamais l'admin)")
    : env.ADMIN_CLE ?? env.CLE_DE_MISE_EN_SERVICE ?? arreter("ADMIN_CLE manque (la clé de l'admin d'ESSAI — en production, un wallet matériel)");
  const noeud = env[variableDuNoeud(r)] ?? arreter(`${variableDuNoeud(r)} manque${ESSAIS[r] ? ` (réseau d'essai : ${ESSAIS[r]})` : ""}`);
  if (fiche(r).famille === "evm") return signataireEvm(noeud, cle, r);
  return signataireTron(noeud, cle, env.TRC20_CLE_API);
}
/** un nœud public du réseau d'ESSAI, pour commencer */
const ESSAIS: Partial<Record<Reseau, string>> = {
  bep20: "https://bsc-testnet-rpc.publicnode.com", trc20: "https://nile.trongrid.io",
  erc20: "https://ethereum-sepolia-rpc.publicnode.com", base: "https://sepolia.base.org", polygon: "https://rpc-amoy.polygon.technology",
};
function artefact(chemin: string): Artefact {
  const f = new URL(`../../contracts/artifacts/contracts/${chemin}`, import.meta.url);
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return arreter(`contrat non compilé (${chemin}) : cd contracts && npx hardhat compile`); }
}

/* ---------------------------------------------------------------- graine */
function graine() {
  // la graine ne passe ni par un tuyau ni par un fichier : seulement par un écran, devant vous
  if (!process.stdout.isTTY) arreter("la graine ne s'affiche que dans un terminal, devant vous — pas dans un fichier, pas dans un journal");
  const mots = Mnemonic.fromEntropy(randomBytes(32)).phrase;  // 256 bits : 24 mots
  const liste = mots.split(" ");
  console.log("\n  VOTRE GRAINE — 24 mots. Écrivez-les sur papier, dans l'ordre, en DEUX exemplaires,");
  console.log("  rangés dans DEUX lieux différents. Ne la photographiez pas, ne la tapez nulle part ailleurs");
  console.log("  que dans la configuration du veilleur. Qui a ces mots peut vider tous les wallets.\n");
  for (let i = 0; i < 24; i += 4) console.log("  " + liste.slice(i, i + 4).map((m, j) => `${String(i + j + 1).padStart(2)}. ${m.padEnd(10)}`).join("  "));
  console.log("\n  Les wallets chauds de cette graine (à donner pour les rôles et les frais) :");
  for (const r of TOUS) console.log(`    ${PREFIXE(r).padEnd(7)} : ${deriver(mots, r, CHAUD).adresse}`);
  console.log("\n  Effacez ensuite l'écran (clear) et l'historique du terminal.\n");
}

function adresses() {
  const g = env.XAFE_GRAINE ?? "";
  if (!graineValide(g)) arreter("XAFE_GRAINE manque ou n'est pas une graine valide");
  for (const r of TOUS) console.log(`${PREFIXE(r).padEnd(7)} chaud : ${deriver(g, r, CHAUD).adresse}`);
}

/* -------------------------------------------------------------- deployer */
async function deployer(o: Record<string, string | true>) {
  const r = reseauDe(o);
  const production = o.production === true;
  const chaud = String(o.chaud ?? "");
  if (!valable(r, chaud)) arreter(`--chaud : l'adresse du wallet chaud ${PREFIXE(r)} (donnée par « graine » ou « adresses »)`);
  const texte = (k: string) => (o[k] && o[k] !== true ? String(o[k]) : "");
  // le réseau, lu AU NŒUD avant toute signature : un réseau principal ne se déploie qu'en --production
  const noeud = env[variableDuNoeud(r)] ?? "";
  const chainId = fiche(r).famille === "evm" && noeud
    ? (await new JsonRpcProvider(noeud, undefined, { staticNetwork: false }).getNetwork()).chainId : null;
  const { refus, plafondXaf } = verifierLesOptions({
    reseau: r, principal: estReseauPrincipal(r, noeud, chainId), production,
    admin: texte("admin") || undefined, pauseur: texte("pauseur") || undefined, geleur: texte("geleur") || undefined,
    usdt: texte("usdt") || undefined, usdtEssai: Boolean(o["usdt-essai"]), plafond: texte("plafond") || undefined,
  });
  if (refus) arreter(refus);
  const s = signataire(r, production);
  if (production) {
    for (const k of ["admin", "pauseur", "geleur"]) if (!valable(r, texte(k))) arreter(`--production : --${k} <adresse ${PREFIXE(r)}> (le wallet matériel du propriétaire)`);
  }
  const admin = texte("admin") || s.adresse;
  if (!valable(r, admin)) arreter("--admin : une adresse du réseau");
  // l'admin n'est jamais une clé de serveur, et jamais la clé de mise en service (qui se jette)
  if (memeAdresse(admin, chaud)) arreter("l'admin ne peut pas être le wallet chaud : une clé de serveur volée prendrait tout");
  if (production && memeAdresse(admin, s.adresse)) arreter("l'admin ne peut pas être la clé de mise en service : elle se jette après le déploiement");
  const pauseur = texte("pauseur") || admin, geleur = texte("geleur") || admin;
  const n = NATIF(r);
  const natif = o.natif === undefined ? (production ? 0n : parseUnits(n.defaut, n.decimales)) : parseUnits(String(o.natif === true ? n.defaut : o.natif), n.decimales);
  const solde = await s.soldeNatif();
  console.log(`· clé de déploiement ${s.adresse} : ${formatUnits(solde, n.decimales)} ${n.nom}`);
  if (solde < natif) arreter(`la clé n'a pas assez de ${n.nom} (il en faut au moins ${formatUnits(natif, n.decimales)} pour le chaud, plus les frais)`);

  const plafond = plafondXaf * 1_000_000n;
  const depart = await s.bloc();
  const args = [admin, plafond, chaud, chaud, pauseur, geleur, s.adresse];
  const xafe = await s.deployer(artefact("XAFe.sol/XAFe.json"), ["address", "uint256", "address", "address", "address", "address", "address"], args);
  console.log(`✓ contrat XAFe déployé : ${xafe} — la réserve est le contrat lui-même`);
  console.log(`  admin ${admin} · frappeur et destructeur ${chaud} · pauseur ${pauseur} · geleur ${geleur} · inscripteur ${s.adresse} (à renoncer après le stock)`);
  console.log(`  plafond de frappe du jour : ${plafondXaf} XAF`);
  let usdt = texte("usdt");
  if (o["usdt-essai"]) {
    usdt = await s.deployer(artefact("essai/UsdtEssai.sol/UsdtEssai.json"), ["uint8"], [Math.max(...fiche(r).decimalesUsdt)]);
    console.log(`✓ USDT d'essai déployé : ${usdt} (${Math.max(...fiche(r).decimalesUsdt)} décimales ; « frapper(adresse, montant) » en donne à qui veut)`);
  }
  if (natif > 0n) {
    await s.envoyerNatif(chaud, natif);
    console.log(`✓ ${formatUnits(natif, n.decimales)} ${n.nom} envoyés au chaud pour les frais`);
  }
  if (fiche(r).famille === "evm") console.log(`\nVérifier sur l'explorateur (0.8.28, optimiseur 200, EVM paris) : npx hardhat verify --network <réseau> ${xafe} ${args.map(String).join(" ")}`);
  console.log(`\nLe paramètre « chaine » de la base reçoit :\n  "${r}": ${JSON.stringify({ noeud: env[variableDuNoeud(r)], xafe, usdt: usdt || "<le contrat USDT du réseau>", depart, confirmations: fiche(r).confirmations })}`);
  console.log(`\nEnsuite : npm run mise-en-service -- preinscrire --reseau ${r} --xafe ${xafe} --de 1 --a ${r === "trc20" ? 600 : 2000} --renoncer`);
  console.log(`Le réseau reste FERMÉ aux clients jusqu'à ce que l'équipe l'ouvre (admin_activer_reseau('${r}', true)).`);
}

async function preinscrireCmd(o: Record<string, string | true>) {
  const r = reseauDe(o);
  const xafe = String(o.xafe ?? "");
  if (!valable(r, xafe)) arreter("--xafe <contrat>");
  const g = env.XAFE_GRAINE ?? "";
  if (!graineValide(g)) arreter("XAFE_GRAINE manque ou n'est pas une graine valide (les adresses se dérivent d'elle)");
  const de = Number(o.de ?? 1), a = Number(o.a ?? 0);
  if (!Number.isInteger(de) || !Number.isInteger(a) || de < 1 || a < de) arreter("--de 1 --a 2000 : les indices à inscrire (l'indice 0 est le chaud)");
  const s = signataire(r, Boolean(env.CLE_DE_MISE_EN_SERVICE));
  if (!(await aLeRole(s, xafe, INSCRIPTEUR, s.adresse))) arreter(`la clé ${s.adresse} n'a pas le rôle ${INSCRIPTEUR} : l'admin doit le lui donner (grantRole)`);
  const adresses = Array.from({ length: a - de + 1 }, (_, i) => deriver(g, r, de + i).adresse);
  const n = await preinscrire(s, xafe, adresses, o.lot && o.lot !== true ? Number(o.lot) : undefined);
  console.log(`✓ ${n} adresse(s) de dépôt inscrites d'avance (indices ${de} à ${a}, ${adresses.length - n} l'étaient déjà)`);
  if (o.renoncer) {
    await renoncer(s, xafe, INSCRIPTEUR);
    const encore = await aLeRole(s, xafe, INSCRIPTEUR, s.adresse);
    if (encore) arreter(`la clé ${s.adresse} tient encore ${INSCRIPTEUR}`);
    console.log(`✓ la clé ${s.adresse} a renoncé à ${INSCRIPTEUR} : elle ne tient plus aucun rôle, elle peut se jeter`);
  }
}

async function plafondCmd(o: Record<string, string | true>) {
  const r = reseauDe(o);
  const xafe = String(o.xafe ?? "");
  if (!valable(r, xafe)) arreter("--xafe <contrat>");
  const noeud = env[variableDuNoeud(r)] ?? arreter(`${variableDuNoeud(r)} manque`);
  // lire n'a besoin d'aucune clé : une jetable
  const lecteur = fiche(r).famille === "evm" ? signataireEvm(noeud, "0x" + "11".repeat(32), r) : signataireTron(noeud, "11".repeat(32), env.TRC20_CLE_API);
  const lire = async (sig: string) => BigInt(await lecteur.lire(xafe, sig, [], []));
  console.log(`· plafond de frappe du jour : ${formatUnits(await lire("plafondJour()"), 6)} XAF · reste aujourd'hui ${formatUnits(await lire("resteDuJour()"), 6)} (remis à zéro à 00:00 UTC)`);
  if (!o.xaf || o.xaf === true) return;
  const voulu = BigInt(String(o.xaf)) * 1_000_000n;
  console.log(`· pour ${o.xaf} XAF : fixerPlafondJour(${voulu})  ← le chiffre exact à coller dans BscScan / Tronscan → Write contract, depuis le wallet admin`);
  if (env.ADMIN_CLE) {
    const s = signataire(r);
    const admin = await s.lire(xafe, "defaultAdmin()", [], []);
    if (BigInt(admin) === BigInt(s.pourAbi(s.adresse))) {
      await s.ecrire(xafe, "fixerPlafondJour(uint256)", ["uint256"], [voulu]);
      console.log(`✓ plafond écrit par la clé admin d'essai ${s.adresse}`);
    }
  }
}

async function roles(o: Record<string, string | true>) {
  const r = reseauDe(o);
  const xafe = String(o.xafe ?? ""), chaud = String(o.chaud ?? "");
  if (!valable(r, xafe) || !valable(r, chaud)) arreter("--xafe <contrat> --chaud <adresse>");
  const donnes = await donnerLesRoles(signataire(r), xafe, chaud);
  console.log(`✓ ${chaud} : ${donnes.join(" et ") || "rôles déjà donnés"}`);
}

async function inscrireCmd(o: Record<string, string | true>, libres: string[]) {
  const r = reseauDe(o);
  const xafe = String(o.xafe ?? "");
  if (!valable(r, xafe)) arreter("--xafe <contrat>");
  let liste = libres;
  if (!liste.length && o["toutes-attribuees"]) {
    if (!env.MOTEUR_URL || !env.MOTEUR_CLE) arreter("--toutes-attribuees : MOTEUR_URL et MOTEUR_CLE");
    const etat = await moteur(env.MOTEUR_URL!, env.MOTEUR_CLE!)("chaine_adresses", { p_reseau: r });
    liste = ((etat?.attribuees ?? []) as { adresse: string; actif: string }[]).filter((x) => x.actif === "XAFe").map((x) => x.adresse);
  } else if (!liste.length) {
    if (!env.MOTEUR_URL || !env.MOTEUR_CLE) arreter("des adresses, ou MOTEUR_URL et MOTEUR_CLE pour prendre celles que le veilleur a publiées");
    const etat = await moteur(env.MOTEUR_URL!, env.MOTEUR_CLE!)("chaine_etat", { p_reseau: r }).catch(() => null);
    liste = (etat?.a_inscrire ?? []) as string[];
  }
  const fautives = liste.filter((a) => !valable(r, a));
  if (fautives.length) arreter(`adresses invalides : ${fautives.join(", ")}`);
  if (!liste.length) { console.log("· rien à inscrire"); return; }
  await inscrire(signataire(r), xafe, liste);
  console.log(`✓ ${liste.length} adresse(s) de dépôt XAFe inscrites au contrat`);
}

/* -------------------------------------------------------------- verifier */
async function verifier(o: Record<string, string | true> = {}) {
  const production = o.production === true;
  let echecs = 0;
  const v = (ok: unknown, texte: string, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${texte}${ok || !detail ? "" : ` — ${detail}`}`); if (!ok) echecs += 1; };
  const g = env.XAFE_GRAINE ?? "";
  v(graineValide(g), "XAFE_GRAINE est une graine valide");
  if (env.MOTEUR_URL && env.MOTEUR_CLE) {
    const rpc = moteur(env.MOTEUR_URL, env.MOTEUR_CLE);
    const r = await rpc("chaine_adresses", { p_reseau: "bep20" }).then(() => true, (e) => (e as Error).message);
    v(r === true, "le moteur répond avec la clé de service (chaine_adresses)", String(r));
  } else v(false, "MOTEUR_URL et MOTEUR_CLE");
  if (!graineValide(g)) { console.log(`✗ ${echecs} point(s) à reprendre`); process.exit(1); }

  const reseaux: { r: Reseau; ch: () => Chaine; s: () => Signataire }[] = [];
  for (const r of TOUS) {
    const noeud = env[variableDuNoeud(r)], P = PREFIXE(r), f = fiche(r);
    if (!noeud) continue;
    const c = { reseau: r, usdt: env[`${P}_USDT`] ?? "", xafe: env[`${P}_XAFE`] ?? "", graine: g, confirmations: Number(env[`${P}_CONFIRMATIONS`] ?? f.confirmations) };
    reseaux.push(f.famille === "evm"
      // une clé jetable : on ne fait que LIRE (rôles), rien n'est signé
      ? { r, ch: () => new ChaineEvm({ ...c, rpcUrl: noeud }), s: () => signataireEvm(noeud, "0x" + "11".repeat(32), r) }
      : { r, ch: () => new ChaineTron({ ...c, noeud, cleApi: env.TRC20_CLE_API }), s: () => signataireTron(noeud, "11".repeat(32), env.TRC20_CLE_API) });
  }
  v(reseaux.length > 0, `au moins un réseau configuré (${TOUS.map(variableDuNoeud).join(", ")})`);

  for (const { r, ch, s } of reseaux) {
    const P = PREFIXE(r), n = NATIF(r);
    console.log(`· ${P}`);
    const contrats = [env[`${P}_USDT`] ?? "", env[`${P}_XAFE`] ?? ""];
    v(contrats.every((c) => valable(r, c)), `${P}_USDT et ${P}_XAFE sont des adresses ${P}`, contrats.join(" "));
    if (!contrats.every((c) => valable(r, c))) continue;
    const chaine = ch();
    const tete = await chaine.tete().then((x) => x, (e) => (e as Error).message);
    v(typeof tete === "number", `le nœud répond (bloc ${tete})`, String(tete));
    if (typeof tete !== "number") continue;
    const dem = await chaine.demarrer().then(() => true, (e) => (e as Error).message);
    v(dem === true, `les contrats répondent : USDT ${chaine.decimales.USDT} décimales, XAFe ${chaine.decimales.XAFe}`, String(dem));
    if (dem !== true) continue;
    v(chaine.decimales.XAFe === 6, "XAFe a 6 décimales");
    v(fiche(r).decimalesUsdt.includes(chaine.decimales.USDT), `l'USDT a les décimales du réseau (${fiche(r).decimalesUsdt.join(" ou ")})`);
    const lecteur = s();
    // le contrat d'après le correctif : la réserve vit DANS le contrat
    const etatJ = await chaine.etatDuJeton().then((x) => x, () => null);
    v(etatJ !== null, "le contrat tient la réserve (reserve(), resteDuJour())", "contrat d'avant le correctif de la réserve : redéployer");
    if (etatJ) {
      console.log(`· plafond de frappe du jour ${formatUnits(etatJ.plafondJour, 6)} XAF · reste ${formatUnits(etatJ.resteDuJour, 6)} · réserve ${formatUnits(etatJ.reserve, 6)} XAFe${etatJ.enPause ? " · EN PAUSE" : ""}`);
      v(!etatJ.enPause, "le contrat n'est pas en pause");
    }
    v((await chaine.solde("XAFe" as Actif, chaine.chaud)) === 0n, "le wallet chaud ne tient aucun XAFe (rien ne doit y dormir)");
    for (const role of Object.values(ROLES)) {
      const a = await aLeRole(lecteur, contrats[1], role, chaine.chaud).catch(() => false);
      v(a, `le wallet chaud ${chaine.chaud} a le rôle ${role}`, "l'admin doit le donner");
    }
    for (const role of ["DEFAULT_ADMIN_ROLE", ...Object.values(ROLES_DE_GARDE), INSCRIPTEUR]) {
      const a = await aLeRole(lecteur, contrats[1], role, chaine.chaud).catch(() => true);
      v(!a, `le wallet chaud n'a PAS le rôle ${role}`, "une clé de serveur ne doit tenir que frapper et détruire");
    }
    for (const [nom, role] of Object.entries(ROLES_DE_GARDE)) {
      const qui = env[`${P}_${nom}`];
      if (qui) v(await aLeRole(lecteur, contrats[1], role, qui).catch(() => false), `${P}_${nom} ${qui} tient ${role}`);
      else if (production) v(false, `${P}_${nom} : l'adresse qui doit tenir ${role}`);
    }
    const adminAttendu = env[`${P}_ADMIN`];
    if (adminAttendu) v(BigInt(await lecteur.lire(contrats[1], "defaultAdmin()", [], [])) === BigInt(lecteur.pourAbi(adminAttendu)), `l'admin du contrat est ${adminAttendu}`);
    else if (production) v(false, `${P}_ADMIN : l'adresse du wallet admin attendu`);
    if (env.MOTEUR_URL && env.MOTEUR_CLE) {
      const etat = await moteur(env.MOTEUR_URL, env.MOTEUR_CLE)("chaine_adresses", { p_reseau: r }).catch(() => null);
      const im = Number(etat?.indice_max ?? 0), stock = Number(env[`${P}_STOCK_XAFE`] ?? 200);
      const proche = await chaine.estAdresseDeDepot(deriver(g, r, im + 1).adresse).catch(() => false);
      const loin = await chaine.estAdresseDeDepot(deriver(g, r, im + stock).adresse).catch(() => false);
      v(proche && loin, `le stock d'adresses XAFe inscrites d'avance tient (indices ${im + 1} et ${im + stock})`, "npm run mise-en-service -- preinscrire …");
    }
    if (production) v(Boolean(USDT_OFFICIEL[r]) && memeAdresse(contrats[0], USDT_OFFICIEL[r]!), `${P}_USDT est l'USDT officiel (${USDT_OFFICIEL[r] ?? "?"})`);
    const natif = await chaine.solde("natif", chaine.chaud);
    const minimum = parseUnits(env[`${P}_NATIF_MINIMUM`] ?? n.minimum, n.decimales);
    v(natif >= minimum, `le chaud a de quoi payer les frais : ${formatUnits(natif, n.decimales)} ${n.nom} (minimum ${formatUnits(minimum, n.decimales)})`, `envoyez-lui des ${n.nom}`);
    const froid = env[`${P}_FROID`];
    if (froid) {
      v(chaine.adresseValable(froid) !== null && froid.toLowerCase() !== chaine.chaud.toLowerCase(), `le wallet froid ${froid} est une adresse ${P}, distincte du chaud`);
      const plafond = Number(env[`${P}_PLAFOND_CHAUD_USDT`] ?? 20000), garder = Number(env[`${P}_GARDER_CHAUD_USDT`] ?? 10000);
      v(garder > 0 && garder < plafond, `au-delà de ${plafond} USDT au chaud, le surplus part au froid en gardant ${garder}`);
    } else console.log(`· ${P}_FROID non donné : rien ne part au froid automatiquement`);
    const usdt = await chaine.solde("USDT" as Actif, chaine.chaud);
    console.log(`· le chaud tient ${formatUnits(usdt, chaine.decimales.USDT)} USDT ; ${formatUnits(await chaine.offreXafe(), 6)} XAFe circulent sur ${P}`);
  }
  console.log(echecs ? `✗ ${echecs} point(s) à reprendre avant d'ouvrir les retraits` : "✓ tout est en place : le veilleur peut tourner");
  process.exit(echecs ? 1 : 0);
}

/* ------------------------------------------------------------------ main */
const [commande, ...reste] = process.argv.slice(2);
const { o, libres } = options(reste);
switch (commande) {
  case "graine": graine(); break;
  case "adresses": adresses(); break;
  case "deployer": await deployer(o); break;
  case "preinscrire": await preinscrireCmd(o); break;
  case "plafond": await plafondCmd(o); break;
  case "roles": await roles(o); break;
  case "inscrire": await inscrireCmd(o, libres); break;
  case "verifier": await verifier(o); break;
  default:
    console.log("npm run mise-en-service -- graine | adresses | deployer | preinscrire | plafond | roles | inscrire | verifier   (voir l'en-tête de src/mise-en-service.ts)");
    process.exit(commande ? 1 : 0);
}
