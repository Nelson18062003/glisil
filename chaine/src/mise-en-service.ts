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
 *       Les wallets chauds d'une graine existante (indice 0), BEP20 et TRC20.
 *
 *   npm run mise-en-service -- deployer --reseau bep20|trc20 --chaud <adresse> [--usdt-essai] [--natif 0.05]
 *       (ADMIN_CLE, BEP20_RPC ou TRC20_NOEUD) Sur un réseau d'ESSAI : déploie
 *       le contrat XAFe (l'admin est la clé ADMIN_CLE), un USDT d'essai si
 *       demandé, donne au wallet chaud les rôles FRAPPEUR et DESTRUCTEUR, lui
 *       envoie de quoi payer les frais, et écrit la configuration du veilleur.
 *
 *   npm run mise-en-service -- roles --reseau … --xafe <contrat> --chaud <adresse>
 *       Les rôles seulement (un contrat déjà déployé). Ne redonne pas ce qui est donné.
 *
 *   npm run mise-en-service -- inscrire --reseau … --xafe <contrat> [adresses…]
 *       Inscrit au contrat les adresses de dépôt XAFe. Sans adresse : celles
 *       que le veilleur a publiées comme « à inscrire » (MOTEUR_URL, MOTEUR_CLE).
 *
 *   npm run mise-en-service -- verifier
 *       Avec la configuration du veilleur : la graine, le moteur, chaque
 *       réseau (nœud, contrats, décimales, rôles du chaud, frais, froid).
 *       Rien n'est envoyé. À relancer avant d'ouvrir les retraits.
 *
 * En PRODUCTION, l'admin du contrat est un wallet matériel : le déploiement et
 * les rôles s'y signent (BscScan / TronScan, « Write contract »), pas avec une
 * clé tapée ici. ADMIN_CLE n'est fait que pour les réseaux d'essai.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { formatUnits, Mnemonic, parseUnits } from "ethers";
import type { Actif, Chaine } from "./chaine.ts";
import { CHAUD, deriver, graineValide, type Reseau } from "./cles.ts";
import { ChaineEvm } from "./evm.ts";
import { moteur } from "./moteur.ts";
import { aLeRole, donnerLesRoles, inscrire, ROLES, signataireEvm, signataireTron, type Artefact, type Signataire } from "./signataire.ts";
import { ChaineTron, vingtOctets } from "./tron.ts";

const env = process.env;
const NATIF: Record<Reseau, { nom: string; decimales: number; defaut: string; minimum: string }> = {
  bep20: { nom: "BNB", decimales: 18, defaut: "0.05", minimum: "0.01" },
  trc20: { nom: "TRX", decimales: 6, defaut: "200", minimum: "50" },
};
const PREFIXE: Record<Reseau, string> = { bep20: "BEP20", trc20: "TRC20" };

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
  if (r !== "bep20" && r !== "trc20") arreter("--reseau bep20 ou --reseau trc20");
  return r as Reseau;
};
const valable = (r: Reseau, a: string) => r === "bep20" ? /^0x[0-9a-fA-F]{40}$/.test(a) : vingtOctets(a) !== null;

function signataire(r: Reseau): Signataire {
  const cle = env.ADMIN_CLE ?? arreter("ADMIN_CLE manque (la clé de l'admin d'ESSAI — en production, un wallet matériel)");
  if (r === "bep20") return signataireEvm(env.BEP20_RPC ?? arreter("BEP20_RPC manque (BSC testnet : https://bsc-testnet-rpc.publicnode.com)"), cle);
  return signataireTron(env.TRC20_NOEUD ?? arreter("TRC20_NOEUD manque (Nile : https://nile.trongrid.io)"), cle, env.TRC20_CLE_API);
}
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
  console.log(`    BEP20 : ${deriver(mots, "bep20", CHAUD).adresse}`);
  console.log(`    TRC20 : ${deriver(mots, "trc20", CHAUD).adresse}`);
  console.log("\n  Effacez ensuite l'écran (clear) et l'historique du terminal.\n");
}

function adresses() {
  const g = env.XAFE_GRAINE ?? "";
  if (!graineValide(g)) arreter("XAFE_GRAINE manque ou n'est pas une graine valide");
  console.log(`BEP20 chaud : ${deriver(g, "bep20", CHAUD).adresse}`);
  console.log(`TRC20 chaud : ${deriver(g, "trc20", CHAUD).adresse}`);
}

/* -------------------------------------------------------------- deployer */
async function deployer(o: Record<string, string | true>) {
  const r = reseauDe(o);
  const chaud = String(o.chaud ?? "");
  if (!valable(r, chaud)) arreter(`--chaud : l'adresse du wallet chaud ${PREFIXE[r]} (donnée par « graine » ou « adresses »)`);
  const s = signataire(r);
  const n = NATIF[r];
  const natif = parseUnits(String(o.natif === undefined || o.natif === true ? n.defaut : o.natif), n.decimales);
  const solde = await s.soldeNatif();
  console.log(`· admin ${s.adresse} : ${formatUnits(solde, n.decimales)} ${n.nom}`);
  if (solde < natif) arreter(`l'admin n'a pas assez de ${n.nom} (il en faut au moins ${formatUnits(natif, n.decimales)} pour le chaud, plus les frais) — robinet du réseau d'essai`);

  const plafond = parseUnits(String(o.plafond && o.plafond !== true ? o.plafond : "50000000"), 6);
  const xafe = await s.deployer(artefact("XAFe.sol/XAFe.json"), ["address", "uint256"], [s.adresse, plafond]);
  console.log(`✓ contrat XAFe déployé : ${xafe} (admin ${s.adresse}, plafond ${formatUnits(plafond, 6)} XAFe)`);
  let usdt = String(o.usdt ?? "");
  if (o["usdt-essai"]) {
    usdt = await s.deployer(artefact("essai/UsdtEssai.sol/UsdtEssai.json"), ["uint8"], [r === "bep20" ? 18 : 6]);
    console.log(`✓ USDT d'essai déployé : ${usdt} (${r === "bep20" ? 18 : 6} décimales ; « frapper(adresse, montant) » en donne à qui veut)`);
  }
  const donnes = await donnerLesRoles(s, xafe, chaud);
  console.log(`✓ wallet chaud ${chaud} : rôles ${donnes.join(" et ") || "déjà donnés"}`);
  await s.envoyerNatif(chaud, natif);
  console.log(`✓ ${formatUnits(natif, n.decimales)} ${n.nom} envoyés au chaud pour les frais`);
  console.log(`\nConfiguration du veilleur :\n  ${PREFIXE[r]}_${r === "bep20" ? "RPC" : "NOEUD"}=${r === "bep20" ? env.BEP20_RPC : env.TRC20_NOEUD}\n  ${PREFIXE[r]}_XAFE=${xafe}\n  ${PREFIXE[r]}_USDT=${usdt || "<le contrat USDT du réseau>"}`);
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
  if (!liste.length) {
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
async function verifier() {
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
  if (env.BEP20_RPC) reseaux.push({
    r: "bep20",
    ch: () => new ChaineEvm({ rpcUrl: env.BEP20_RPC!, usdt: env.BEP20_USDT ?? "", xafe: env.BEP20_XAFE ?? "", graine: g, confirmations: Number(env.BEP20_CONFIRMATIONS ?? 15) }),
    // une clé jetable : on ne fait que LIRE (rôles), rien n'est signé
    s: () => signataireEvm(env.BEP20_RPC!, "0x" + "11".repeat(32)),
  });
  if (env.TRC20_NOEUD) reseaux.push({
    r: "trc20",
    ch: () => new ChaineTron({ noeud: env.TRC20_NOEUD!, usdt: env.TRC20_USDT ?? "", xafe: env.TRC20_XAFE ?? "", graine: g, confirmations: Number(env.TRC20_CONFIRMATIONS ?? 20), cleApi: env.TRC20_CLE_API }),
    s: () => signataireTron(env.TRC20_NOEUD!, "11".repeat(32), env.TRC20_CLE_API),
  });
  v(reseaux.length > 0, "au moins un réseau configuré (BEP20_RPC, TRC20_NOEUD)");

  for (const { r, ch, s } of reseaux) {
    const P = PREFIXE[r], n = NATIF[r];
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
    v(r === "trc20" ? chaine.decimales.USDT === 6 : [6, 18].includes(chaine.decimales.USDT), `l'USDT a les décimales du réseau (${r === "trc20" ? "6" : "18 pour le BSC-USD"})`);
    const lecteur = s();
    for (const role of Object.values(ROLES)) {
      const a = await aLeRole(lecteur, contrats[1], role, chaine.chaud).catch(() => false);
      v(a, `le wallet chaud ${chaine.chaud} a le rôle ${role}`, "l'admin doit le donner : npm run mise-en-service -- roles …");
    }
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
  case "roles": await roles(o); break;
  case "inscrire": await inscrireCmd(o, libres); break;
  case "verifier": await verifier(); break;
  default:
    console.log("npm run mise-en-service -- graine | adresses | deployer | roles | inscrire | verifier   (voir l'en-tête de src/mise-en-service.ts)");
    process.exit(commande ? 1 : 0);
}
