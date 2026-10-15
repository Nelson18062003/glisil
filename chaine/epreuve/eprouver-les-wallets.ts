/*
 * NOS WALLETS, ÉPROUVÉS — sur les DEUX réseaux, par le même scénario :
 *
 *   RESEAU=bep20 : une vraie chaîne EVM (Hardhat, le même code machine que la
 *                  BNB Smart Chain), un USDT d'essai à 18 décimales comme le BSC-USD ;
 *   RESEAU=trc20 : un vrai nœud Tron (java-tron, image tronbox/tre), un USDT
 *                  d'essai à 6 décimales comme l'USDT de Tron ;
 *
 * chaque fois le vrai contrat XAFe, le VRAI moteur sur la pile Supabase
 * d'épreuve, des clients inscrits par OTP chez GoTrue — et le veilleur tel
 * qu'il tournera.
 *
 *   sh supabase/epreuve/eprouver.sh      (lance ceci après la chaîne réelle)
 *
 * Ce qu'on exige :
 *   · une adresse de dépôt est la dérivée de la graine que la base dit ;
 *   · un dépôt n'est crédité qu'après ses confirmations, au centime, une fois ;
 *   · les USDT des dépôts rejoignent le wallet chaud (les frais sont avancés) ;
 *   · un retrait coupé entre la signature et la diffusion repart UNE fois ;
 *   · une transaction notée qui ne pourra plus JAMAIS entrer dans un bloc
 *     (Tron : échue ; EVM : son nonce pris) est remplacée, et le retrait part
 *     une fois — pas zéro, pas deux ;
 *   · (EVM) une transaction diffusée qui tarde n'est PAS remplacée ;
 *   · au-delà du plafond, le surplus du chaud part au froid, sauf ce que les
 *     retraits en attente demandent ;
 *   · des XAFe sortis puis rendus sont frappés, puis détruits là où ils
 *     reviennent, et recrédités une fois ;
 *   · un dépôt sur une adresse jamais attribuée ne crédite personne, et reste
 *     visible pour l'équipe ;
 *   · à la fin, les USDT du grand livre SONT sur nos adresses (chaud, froid,
 *     dépôts), et les XAFe que la base dit « sur la chaîne » sont l'offre du
 *     contrat ; l'état publié pour l'administration dit les mêmes chiffres.
 */
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { JsonRpcProvider, parseUnits, Transaction, Wallet } from "ethers";
import type { Chaine } from "../src/chaine.ts";
import { adresseTron, deriver, type Reseau } from "../src/cles.ts";
import { ChaineEvm } from "../src/evm.ts";
import { moteur, type Rpc } from "../src/moteur.ts";
import { donnerLesRoles, inscrire, signataireEvm, signataireTron, type Artefact, type Signataire } from "../src/signataire.ts";
import { ChaineTron } from "../src/tron.ts";
import { Veilleur } from "../src/veilleur.ts";

const env = process.env;
const RESEAU = (env.RESEAU ?? "bep20") as Reseau;
const REST = `http://127.0.0.1:${env.PORT_REST ?? 53000}`;
const AUTH = `http://127.0.0.1:${env.PORT_AUTH ?? 59999}`;
const CONTRATS = new URL("../../contracts/artifacts/contracts/", import.meta.url).pathname;
const SECRET = env.SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long";
/* Les témoins : trois veilleurs fautifs, chacun doit faire tomber SA vérification.
 *   TEMOIN=1 : il NE NOTE PAS sa transaction avant de la diffuser (il re-signe après une coupure)
 *              → « rediffuse LA MÊME transaction » échoue : le retrait part deux fois ;
 *   TEMOIN=2 : il remplace une transaction dès qu'elle n'a pas de reçu, sans demander à la chaîne
 *              si elle peut encore passer → « qui tarde » échoue (EVM seulement : ce nœud Tron mine
 *              tout de suite, une transaction n'y tarde jamais) ;
 *   TEMOIN=3 : il ne remplace JAMAIS (le veilleur d'avant) → « est remplacée » échoue : le retrait reste bloqué. */
const TEMOIN = ["1", "2", "3"].includes(env.TEMOIN ?? "") ? Number(env.TEMOIN) : 0;
const CONFIRMATIONS = 3;
const ECHEANCE_TRON = 15;  // secondes : assez pour un tour, assez court pour que l'épreuve attende l'échéance

let echecs = 0;
const verifier = (cond: unknown, texte: string, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} [${RESEAU}] ${texte}${cond || !detail ? "" : `\n    ${detail}`}`);
  if (!cond) echecs += 1;
};
const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/* ------------------------------------------------------------ le moteur */
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const tete = b64({ alg: "HS256", typ: "JWT" });
const charge = b64({ role: "service_role", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 });
const SERVICE = `${tete}.${charge}.${createHmac("sha256", SECRET).update(`${tete}.${charge}`).digest("base64url")}`;
const rpc = moteur(REST, SERVICE);
/* TEMOIN=1 : le moteur l'en empêcherait (« un autre envoi est déjà signé ») : le témoin ne lui montre donc jamais le hash. */
const rpcVeilleur: Rpc = TEMOIN === 1
  ? async (nom, args) => {
      if (nom === "chaine_marquer_envoi") return {};
      const r = await rpc(nom, args);
      return nom === "chaine_retraits_a_envoyer" ? (r as { tx_hash: string | null }[]).map((x) => ({ ...x, tx_hash: null, tx_brut: null })) : r;
    }
  : rpc;
const sql = (q: string) => {
  const r = spawnSync("psql", ["-h", "127.0.0.1", "-p", env.PORT_DB ?? "55432", "-U", "supabase_admin", "-d", "postgres", "-Atc", q], { env: { ...env, PGPASSWORD: env.MDP ?? "essai" }, encoding: "utf8" });
  if (r.status) throw new Error(r.stderr);
  return r.stdout.trim();
};
const http = async (url: string, corps?: unknown, jeton?: string) => {
  const r = await fetch(url, { method: corps === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(jeton ? { apikey: jeton, authorization: `Bearer ${jeton}` } : {}) }, body: corps === undefined ? undefined : JSON.stringify(corps) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${url} ${r.status} ${JSON.stringify(j)}`);
  return j;
};
const client = async (telephone: string) => {
  await http(`${AUTH}/otp`, { phone: telephone });
  const j = await http(`${AUTH}/verify`, { type: "sms", phone: telephone, token: "123456" });
  const jeton = j.access_token as string;
  await http(`${REST}/rpc/completer_profil`, { p_nom: "Client des wallets", p_code: "2580" }, jeton).catch(() => null);
  return { jeton, id: j.user.id as string, appel: (nom: string, args: Record<string, unknown>) => http(`${REST}/rpc/${nom}`, args, jeton) };
};

/* -------------------------------------------------------------- le banc
 * Ce qui diffère d'un réseau à l'autre, et rien d'autre : qui a des fonds,
 * comment faire avancer la chaîne, comment rendre une transaction notée à
 * jamais impossible. Le scénario, lui, est le même. */
type Banc = {
  admin: Signataire;          // l'admin du contrat
  externe: Signataire;        // le monde extérieur, qui a des USDT
  decimalesUsdt: number;
  natifPourLeChaud: bigint;
  miner(n: number): Promise<void>;
  nouveauWallet(): Promise<Signataire>;
  adresseAuHasard(): string;
  adresseFautive(): string;
  chaine(graine: string, usdt: string, xafe: string): Chaine;
  /** la transaction notée ne pourra plus jamais entrer dans un bloc */
  rendreImpossible(graine: string, brut: string): Promise<void>;
  /** EVM : retenir les transactions hors des blocs, le temps qu'on veut (null : ce nœud ne sait pas) */
  retenir: ((oui: boolean) => Promise<void>) | null;
};

function bancEvm(): Banc {
  const url = env.RPC_CHAINE ?? "http://127.0.0.1:58545";
  const fournisseur = new JsonRpcProvider(url, undefined, { staticNetwork: true, pollingInterval: 200 });
  // les clés PUBLIQUES de Hardhat (graine « test test … junk ») : jamais pour de l'argent
  const admin = signataireEvm(url, "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const externe = signataireEvm(url, "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const miner = async (n: number) => { for (let i = 0; i < n; i++) await fournisseur.send("evm_mine", []); };
  return {
    admin, externe, decimalesUsdt: 18, natifPourLeChaud: parseUnits("10", 18), miner,
    async nouveauWallet() {
      const w = signataireEvm(url, Wallet.createRandom().privateKey);
      await admin.envoyerNatif(w.adresse, parseUnits("1", 18));
      return w;
    },
    adresseAuHasard: () => Wallet.createRandom().address,
    adresseFautive: () => "0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21",
    chaine: (graine, usdt, xafe) => new ChaineEvm({ rpcUrl: url, usdt, xafe, graine, confirmations: CONFIRMATIONS }),
    async rendreImpossible(graine, brut) {
      // le wallet chaud envoie AUTRE CHOSE sous le même nonce (ce que ferait l'avance de gaz d'un balayage) ; c'est miné
      const nonce = Transaction.from(brut).nonce;
      const chaud = deriver(graine, "bep20", 0).portefeuille.connect(fournisseur);
      await (await chaud.sendTransaction({ to: chaud.address, value: 0n, nonce })).wait(1);
      await miner(CONFIRMATIONS);
    },
    async retenir(oui) { await fournisseur.send("evm_setAutomine", [!oui]); },
  };
}

async function bancTron(): Promise<Banc> {
  const url = env.NOEUD_TRON ?? "http://127.0.0.1:59090";
  // l'image tronbox/tre tire une graine NEUVE à chaque conteneur : on lui demande ses clés d'essai (jamais pour de l'argent),
  // puis on attend que ses comptes soient crédités — ils le sont un peu après que la liste existe
  const cles: string[] = (await (await fetch(`${url}/admin/accounts-json`)).json()).privateKeys;
  if (!cles || cles.length < 4) throw new Error("le nœud Tron d'essai n'a pas ses quatre comptes (accounts=5)");
  const [admin, externe, ...meuniers] = cles.slice(0, 4).map((k) => signataireTron(url, k));
  for (let i = 0; i < 120 && (await admin.soldeNatif()) === 0n; i++) await dormir(1000);
  if ((await admin.soldeNatif()) === 0n) throw new Error("les comptes du nœud Tron d'essai ne sont jamais crédités");
  // ce nœud ne fait un bloc que lorsqu'une transaction arrive : un petit envoi de TRX par bloc voulu
  const miner = async (n: number) => { for (let i = 0; i < n; i++) await meuniers[i % 2].envoyerNatif(meuniers[(i + 1) % 2].adresse, 1n); };
  return {
    admin, externe, decimalesUsdt: 6, natifPourLeChaud: 2_000_000_000n, miner,
    async nouveauWallet() {
      const w = signataireTron(url, Wallet.createRandom().privateKey);
      await admin.envoyerNatif(w.adresse, 200_000_000n);
      return w;
    },
    adresseAuHasard: () => adresseTron(Wallet.createRandom().address),
    adresseFautive: () => {
      const bonne = adresseTron(Wallet.createRandom().address);
      const c = bonne[20];
      return bonne.slice(0, 20) + (c === "a" ? "b" : "a") + bonne.slice(21);  // une lettre de travers : la somme de contrôle ne suit pas
    },
    chaine: (graine, usdt, xafe) => new ChaineTron({ noeud: url, usdt, xafe, graine, confirmations: CONFIRMATIONS, echeanceSecondes: ECHEANCE_TRON }),
    async rendreImpossible() {
      // on laisse passer l'échéance, et des blocs datés après elle se confirment
      await dormir((ECHEANCE_TRON + 2) * 1000);
      await miner(CONFIRMATIONS + 1);
    },
    retenir: null,
  };
}

const banc = RESEAU === "trc20" ? await bancTron() : bancEvm();
const dec = banc.decimalesUsdt;
const U = (x: string | number) => parseUnits(String(x), dec);

/* ------------------------------------------------- les contrats, la clé */
const artefact = (chemin: string): Artefact => JSON.parse(readFileSync(`${CONTRATS}${chemin}`, "utf8"));
const graine = Wallet.createRandom().mnemonic!.phrase;  // une graine neuve à chaque épreuve
const chaudAdresse = deriver(graine, RESEAU, 0).adresse;
const usdtAdresse = await banc.admin.deployer(artefact("essai/UsdtEssai.sol/UsdtEssai.json"), ["uint8"], [dec]);
const xafeAdresse = await banc.admin.deployer(artefact("XAFe.sol/XAFe.json"), ["address", "uint256"], [banc.admin.adresse, parseUnits("50000000", 6)]);
const roles = await donnerLesRoles(banc.admin, xafeAdresse, chaudAdresse);
verifier(roles.length === 2 && (await donnerLesRoles(banc.admin, xafeAdresse, chaudAdresse)).length === 0, "le wallet chaud reçoit FRAPPEUR et DESTRUCTEUR, une fois (redonner ne refait rien)", JSON.stringify(roles));
await banc.admin.envoyerNatif(chaudAdresse, banc.natifPourLeChaud);
await banc.externe.ecrire(usdtAdresse, "frapper(address,uint256)", ["address", "uint256"], [banc.externe.adresse, U(10000)]);
const versUsdt = (vers: string, montant: string | number) => banc.externe.ecrire(usdtAdresse, "transfer(address,uint256)", ["address", "uint256"], [vers, U(montant)]);

const chaine = banc.chaine(graine, usdtAdresse, xafeAdresse);
await chaine.demarrer();
verifier(chaine.decimales.USDT === dec && chaine.decimales.XAFe === 6, `le veilleur lit les décimales sur la chaîne : USDT ${dec}, XAFe 6`);
const soldeChaine = (actif: "USDT" | "XAFe", adresse: string) => chaine.solde(actif, adresse);
if (TEMOIN === 2) chaine.perimee = async (hash: string) => (await chaine.recu(hash)) === null;
if (TEMOIN === 3) chaine.perimee = async () => false;

sql(`update parametres set valeur = jsonb_set(valeur, '{retraits_ouverts}', 'true') where cle = 'crypto'`);
// la réserve d'adresses des scénarios précédents est faite d'adresses inventées : on part d'une réserve vide ;
// leurs retraits restés en route sont rendus à leurs clients, comme le ferait un échec
sql(`delete from adresses_libres where reseau = '${RESEAU}'`);
sql(`delete from chaine_curseurs where reseau = '${RESEAU}'`);
sql(`select count(chaine_resultat_retrait(reference, false, null, 'rendu avant l''épreuve des wallets')) from retraits_crypto where reseau = '${RESEAU}' and etat in ('en_attente', 'en_cours')`);
const maisonUsdt0 = Number(sql(`select coalesce(sum(disponible + bloque), 0) from soldes where actif = 'USDT' and compte_id = compte_maison()`));
const surChaine0 = Number(sql(`select circulation_chaine()`));

const journal: string[] = [];
const coupure = { active: false };
const froid = banc.adresseAuHasard();
const veilleur = new Veilleur(chaine, {
  graine, reserve: 3, seuilBalayage: 10, attenteMs: 60_000,
  // le plafond ne s'abaisse qu'au scénario du froid : avant, rien n'y part
  froid: { adresse: froid, plafondChaud: 1_000_000, garderChaud: 60 },
  journal: (l) => journal.push(l),
  apresSignature: () => { if (coupure.active) { coupure.active = false; throw new Error("coupure de courant"); } },
});
const tour = () => veilleur.tour(rpcVeilleur);

/* ---------------------------------------------------------- 1 · adresses */
const t1 = await tour();
verifier(t1.aInscrire.length === 3, "les adresses XAFe attendent leur inscription au contrat par l'admin", JSON.stringify(t1));
await inscrire(banc.admin, xafeAdresse, t1.aInscrire);
await tour();
const etat = await rpc("chaine_adresses", { p_reseau: RESEAU });
verifier(etat.libres.USDT >= 3 && etat.libres.XAFe >= 3, "une réserve d'adresses de dépôt est prête, USDT et XAFe", JSON.stringify(etat.libres));

// chaque passe a son client : un témoin ne rejoue pas sur les soldes d'un autre
const telephone = { bep20: ["237677130001", "237677130002", "237677130005", "237677130006"], trc20: ["237677130003", "237677130004", "237677130007", "237677130008"] }[RESEAU][TEMOIN];
const ama = await client(telephone);
sql(`update comptes set palier = 2 where id = '${ama.id}'`);  // le palier a ses scénarios ; ici, les wallets
const adresseUsdt = await ama.appel("adresse_depot", { p_actif: "USDT", p_reseau: RESEAU }) as string;
const indice = Number(sql(`select indice from adresses_crypto where compte_id = '${ama.id}' and actif = 'USDT' and reseau = '${RESEAU}'`));
verifier(deriver(graine, RESEAU, indice).adresse === adresseUsdt, "l'adresse donnée au client est la dérivée de la graine que la base dit — la base ne garde aucune clé", `${adresseUsdt} ≠ dérivée ${indice}`);
verifier(Number(sql(`select count(*) from information_schema.columns where table_schema = 'public' and column_name ilike '%cle_privee%'`)) === 0, "aucune colonne de clé privée dans la base");

/* ------------------------------------------------------------ 2 · dépôt */
const soldeUsdt = async () => Number((await ama.appel("mes_soldes", {}))?.USDT?.disponible ?? 0);
await versUsdt(adresseUsdt, "125.5");
await tour();
verifier(await soldeUsdt() === 0, "un dépôt pas encore confirmé n'est pas crédité");
await banc.miner(CONFIRMATIONS);
const t2 = await tour();
verifier(await soldeUsdt() === 125.5 && t2.credites === 1, "après ses confirmations, le dépôt est crédité au centime : 125,50 USDT", `solde ${await soldeUsdt()} ${JSON.stringify(t2)}`);
await banc.miner(CONFIRMATIONS); await tour(); await tour();
verifier(await soldeUsdt() === 125.5, "relu tour après tour, il ne crédite pas deux fois");
verifier(Number(sql(`select count(*) from transferts_crypto where adresse = '${adresseUsdt}'`)) === 1, "un seul transfert au grand livre");

/* ---------------------------------------------------------- 3 · balayage */
verifier(await soldeChaine("USDT", adresseUsdt) === 0n && await soldeChaine("USDT", chaudAdresse) === U("125.5"), "les USDT du dépôt ont rejoint le wallet chaud, frais avancés par lui",
  `dépôt ${await soldeChaine("USDT", adresseUsdt)}, chaud ${await soldeChaine("USDT", chaudAdresse)} — ${journal.filter((l) => l.startsWith("ALERTE")).join(" | ")}`);

/* ----------------------------------------- 4 · un retrait coupé en route */
const retrait = (adresse: string, montant: number, cle: string) =>
  ama.appel("demander_retrait_crypto", { p_actif: "USDT", p_reseau: RESEAU, p_adresse: adresse, p_montant: montant, p_cle: `${RESEAU}-${cle}`, p_code: "2580" });
const ligne = (reference: string) => sql(`select etat || ' ' || coalesce(tx_hash, '-') || ' ' || cardinality(tx_remplacees) from retraits_crypto where reference = '${reference}'`).split(" ");
const jusquA = async (reference: string, n = 6) => {
  for (let i = 0; i < n && ligne(reference)[0] !== "envoye"; i++) { await tour(); await banc.miner(CONFIRMATIONS); }
  await tour();
};
// d'abord un retrait vers une adresse à la somme de contrôle fausse (une faute de frappe) : il passe devant
const rFaux = await retrait(banc.adresseFautive(), 5, "w-0");
const dest1 = banc.adresseAuHasard();
const r1 = await retrait(dest1, 50, "w-1");
coupure.active = true;
await tour();  // le veilleur tombe entre la signature notée et la diffusion
const signe1 = ligne(r1.reference)[1];
verifier(ligne(rFaux.reference)[0] === "echoue" && await soldeUsdt() === 125.5 - 51,
  "une adresse à la somme de contrôle fausse est refusée, les 6 USDT reviennent — et le retrait suivant n'est pas bloqué derrière elle", `solde ${await soldeUsdt()}`);
verifier(signe1 !== "-" && await soldeChaine("USDT", dest1) === 0n, "la transaction est signée et notée, mais n'est pas partie (coupure)");
await jusquA(r1.reference);
verifier(await soldeChaine("USDT", dest1) === U(50), "relancé, le veilleur rediffuse LA MÊME transaction : 50 USDT arrivent, une fois", `reçu ${await soldeChaine("USDT", dest1)}`);
const f1 = ligne(r1.reference);
if (f1[0] !== "envoye" || f1[1] !== signe1) console.log(journal.filter((l) => l.includes(r1.reference)).join("\n"));
verifier(f1[0] === "envoye" && f1[1] === signe1 && f1[2] === "0", "le retrait est « envoyé », sous le hash signé avant la coupure", `${f1.join(" ")} (signé : ${signe1})`);

/* ------------------------- 5 · une transaction notée qui ne passera jamais */
const dest2 = banc.adresseAuHasard();
const r2 = await retrait(dest2, 30, "w-2");
coupure.active = true;
await tour();
const signe2 = ligne(r2.reference)[1];
const brut2 = sql(`select tx_brut from retraits_crypto where reference = '${r2.reference}'`);
if (TEMOIN !== 1) await banc.rendreImpossible(graine, brut2);
await jusquA(r2.reference);
const f2 = ligne(r2.reference);
if (f2[0] !== "envoye") console.log(journal.filter((l) => l.includes(r2.reference)).join("\n"));
verifier(await soldeChaine("USDT", dest2) === U(30) && f2[0] === "envoye",
  RESEAU === "trc20" ? "échue sans être partie, la transaction est remplacée : 30 USDT arrivent, une fois" : "son nonce pris par une autre, la transaction est remplacée : 30 USDT arrivent, une fois",
  `reçu ${await soldeChaine("USDT", dest2)}, ${f2.join(" ")}`);
verifier(TEMOIN === 1 || (f2[1] !== signe2 && f2[2] === "1" && sql(`select tx_remplacees[1] from retraits_crypto where reference = '${r2.reference}'`) === signe2),
  "la base garde la transaction remplacée à côté de la nouvelle", f2.join(" "));

/* ------------------------- 6 · (EVM) une transaction diffusée qui tarde */
if (banc.retenir) {
  const dest3 = banc.adresseAuHasard();
  const r3 = await retrait(dest3, 20, "w-3");
  await banc.retenir(true);
  await tour(); await tour(); await tour();  // diffusée, pas encore dans un bloc : le veilleur ne doit pas en signer une autre
  await banc.retenir(false);
  await banc.miner(1);
  await jusquA(r3.reference);
  verifier(await soldeChaine("USDT", dest3) === U(20), "une transaction diffusée qui tarde n'est pas remplacée : 20 USDT arrivent, une fois", `reçu ${await soldeChaine("USDT", dest3)}`);
}

/* -------------------------------------------------------------- 7 · le froid */
await versUsdt(adresseUsdt, 400);
await banc.miner(CONFIRMATIONS); await tour();
const chaudAvant = await soldeChaine("USDT", chaudAdresse);
const enAttente = await retrait(banc.adresseAuHasard(), 100, "w-4");  // demandé, pas encore pris par le veilleur
veilleur.c.froid!.plafondChaud = 300;
const mis = await veilleur.mettreAuFroid(rpc);
// le plafond est dépassé : on garde 60 au chaud, PLUS les 100 promis au retrait qui attend
verifier(chaudAvant > U(300) && await soldeChaine("USDT", froid) === chaudAvant - U(160) && await soldeChaine("USDT", chaudAdresse) === U(160),
  "au-delà du plafond, le surplus part au froid — sauf ce que le retrait en attente demande", `chaud avant ${chaudAvant}, mis ${mis}, froid ${await soldeChaine("USDT", froid)}, chaud ${await soldeChaine("USDT", chaudAdresse)}`);
await jusquA(enAttente.reference);
verifier(ligne(enAttente.reference)[0] === "envoye", "et ce retrait part ensuite du chaud, sans attendre le froid");
const pauvre = new Veilleur(chaine, { graine, natifMinimum: 1_000_000, journal: () => null });
await pauvre.mettreAuFroid(rpc);
verifier(pauvre.alertes.some((a) => a.includes("manque de")), `un chaud sans assez de ${RESEAU === "trc20" ? "TRX" : "BNB"} pour les frais le crie`, JSON.stringify(pauvre.alertes));

/* --------------------------------------------- 8 · XAFe sortis puis rendus */
const destXafe = await banc.nouveauWallet();
sql(`select _mouvement('${ama.id}', 'XAFe', 200000, 0, 'essai_wallets', 'essai', 'w-${RESEAU}'); insert into emissions (sens, montant, source_table, source_id) values ('emission', 200000, 'essai', 'w-${RESEAU}')`);
const rx = await ama.appel("demander_retrait_crypto", { p_actif: "XAFe", p_reseau: RESEAU, p_adresse: destXafe.adresse, p_montant: 150000, p_cle: `${RESEAU}-w-5`, p_code: "2580" });
await jusquA(rx.reference);
verifier(await soldeChaine("XAFe", destXafe.adresse) === parseUnits("150000", 6), "150 000 XAFe frappés vers le wallet du client, par le wallet chaud");
verifier(ligne(rx.reference)[0] === "envoye", "et le retrait XAFe est « envoyé »");
const adresseXafe = await ama.appel("adresse_depot", { p_actif: "XAFe", p_reseau: RESEAU }) as string;
const xafeAvant = Number((await ama.appel("mes_soldes", {})).XAFe.disponible);
await destXafe.ecrire(xafeAdresse, "transfer(address,uint256)", ["address", "uint256"], [adresseXafe, parseUnits("100000", 6)]);
await banc.miner(CONFIRMATIONS); await tour(); await banc.miner(CONFIRMATIONS); await tour();
const xafeApres = Number((await ama.appel("mes_soldes", {})).XAFe.disponible);
verifier(xafeApres === xafeAvant + 100000, "100 000 XAFe rendus sur l'adresse de dépôt : détruits là, recrédités une fois", `${xafeAvant} → ${xafeApres}`);
verifier(await soldeChaine("XAFe", adresseXafe) === 0n && await chaine.offreXafe() === parseUnits("50000", 6), "sur la chaîne, ils n'existent plus : l'offre totale est de 50 000", `offre ${await chaine.offreXafe()}`);

/* -------------------------------------- 9 · une adresse jamais attribuée */
const libre = sql(`select adresse from adresses_libres where reseau = '${RESEAU}' and actif = 'USDT' limit 1`);
await versUsdt(libre, 7);
await banc.miner(CONFIRMATIONS); await tour(); await tour();
verifier(journal.some((l) => l.startsWith("ALERTE") && l.includes(libre)) && Number(sql(`select count(*) from transferts_crypto where adresse = '${libre}'`)) === 0,
  "un dépôt sur une adresse jamais montrée à un client ne crédite personne, et le veilleur le dit");
verifier(sql(`select montant from chaine_orphelins where adresse = '${libre}'`) === "7.00", "il reste visible pour l'équipe, une fois, après que l'alerte du tour s'est effacée");

/* ------------------------------------------------------- 10 · le rapprochement */
const avoirs = await veilleur.avoirs(rpc);
// ce client, plus ce que la maison a gagné PENDANT l'épreuve (les scénarios d'avant ont rempli la maison sans chaîne)
const usdtLivre = Number(sql(`select sum(disponible + bloque) from soldes where actif = 'USDT' and compte_id = '${ama.id}'`))
  + Number(sql(`select coalesce(sum(disponible + bloque), 0) from soldes where actif = 'USDT' and compte_id = compte_maison()`)) - maisonUsdt0;
const usdtChaine = Number(avoirs.usdt / 10n ** BigInt(dec - 2)) / 100;  // le chaud, le froid et les adresses attribuées (pas la réserve)
verifier(Math.abs(usdtLivre - usdtChaine) < 0.005, "les USDT du grand livre (ce client et la maison) SONT sur nos adresses : chaud, froid, dépôts", `grand livre ${usdtLivre}, chaîne ${usdtChaine}`);
const surChaine = Number(sql(`select circulation_chaine()`)) - surChaine0;
verifier(surChaine === Number(avoirs.xafeEnCirculation / 1_000_000n), "les XAFe que la base dit « sur la chaîne » sont l'offre totale du contrat", `base ${surChaine}, contrat ${avoirs.xafeEnCirculation}`);

/* ----------------------------------------------- 11 · ce que voit l'équipe */
const publie = JSON.parse(sql(`select etat from chaine_etats where reseau = '${RESEAU}'`) || "{}");
const chaudCentimes = Number((await soldeChaine("USDT", chaudAdresse)) / 10n ** BigInt(dec - 2)) / 100;
const froidCentimes = Number((await soldeChaine("USDT", froid)) / 10n ** BigInt(dec - 2)) / 100;
verifier(publie.chaud === chaudAdresse && Math.abs(publie.usdt_chaud - chaudCentimes) < 0.005 && publie.froid === froid && Math.abs(publie.usdt_froid - froidCentimes) < 0.005,
  "l'état publié pour la page « Wallets » dit le chaud, le froid et leurs soldes", JSON.stringify(publie).slice(0, 400));

console.log(echecs ? `✗ [${RESEAU}] ${echecs} exigence(s) non tenue(s)` : `✓ [${RESEAU}] nos wallets tiennent : dérivés, crédités, balayés, envoyés une fois, remplacés à bon droit, mis au froid, rapprochés au centime`);
process.exit(echecs ? 1 : 0);
