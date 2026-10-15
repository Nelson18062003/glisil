/*
 * NOS WALLETS, ÉPROUVÉS : une vraie chaîne EVM (Hardhat, le même code
 * machine que la BNB Smart Chain), le vrai contrat XAFe, un USDT d'essai à
 * 18 décimales comme le BSC-USD, le VRAI moteur sur la pile Supabase
 * d'épreuve, des clients inscrits par OTP chez GoTrue — et le veilleur tel
 * qu'il tournera.
 *
 *   sh supabase/epreuve/eprouver.sh      (lance ceci après la chaîne réelle)
 *
 * Ce qu'on exige :
 *   · une adresse de dépôt est la dérivée de la graine que la base dit ;
 *   · un dépôt n'est crédité qu'après ses confirmations, au centime, une fois ;
 *   · les USDT des dépôts rejoignent le wallet chaud (le gaz est avancé) ;
 *   · un retrait coupé entre la signature et la diffusion repart UNE fois ;
 *   · des XAFe sortis puis rendus sont frappés, puis détruits là où ils
 *     reviennent, et recrédités une fois ;
 *   · à la fin, les USDT du grand livre SONT sur nos adresses, et les XAFe
 *     que la base dit « sur la chaîne » sont l'offre totale du contrat ;
 *   · un dépôt sur une adresse jamais attribuée ne crédite personne.
 */
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { Contract, ContractFactory, JsonRpcProvider, parseEther, parseUnits, Wallet } from "ethers";
import { ChaineBep20 } from "../src/bep20.ts";
import { deriver } from "../src/cles.ts";
import { moteur } from "../src/moteur.ts";
import { inscrire } from "../src/inscrire.ts";

const env = process.env;
const REST = `http://127.0.0.1:${env.PORT_REST ?? 53000}`;
const AUTH = `http://127.0.0.1:${env.PORT_AUTH ?? 59999}`;
const RPC_CHAINE = env.RPC_CHAINE ?? "http://127.0.0.1:58545";
const CONTRATS = new URL("../../contracts/artifacts/contracts/", import.meta.url).pathname;
const SECRET = env.SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long";

let echecs = 0;
const verifier = (cond: unknown, texte: string, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${texte}${cond || !detail ? "" : `\n    ${detail}`}`);
  if (!cond) echecs += 1;
};

/* ------------------------------------------------------------ le moteur */
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const tete = b64({ alg: "HS256", typ: "JWT" });
const charge = b64({ role: "service_role", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 });
const SERVICE = `${tete}.${charge}.${createHmac("sha256", SECRET).update(`${tete}.${charge}`).digest("base64url")}`;
const rpc = moteur(REST, SERVICE);
/* TEMOIN=1 : un veilleur qui NE NOTE PAS sa transaction avant de la diffuser (il re-signe après une coupure).
   Le moteur l'en empêcherait (« un autre envoi est déjà signé ») : le témoin ne lui montre donc jamais le hash. */
const TEMOIN = env.TEMOIN === "1";
const rpcVeilleur: typeof rpc = TEMOIN
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

/* ------------------------------------------------------------ la chaîne */
const fournisseur = new JsonRpcProvider(RPC_CHAINE, undefined, { staticNetwork: true, pollingInterval: 200 });
const miner = async (n: number) => { for (let i = 0; i < n; i++) await fournisseur.send("evm_mine", []); };
const artefact = (chemin: string) => JSON.parse(readFileSync(`${CONTRATS}${chemin}`, "utf8"));
const comptesHardhat = (await fournisseur.listAccounts());
const admin = comptesHardhat[0];
const externe = comptesHardhat[1];    // un wallet du monde extérieur, qui a des USDT
const destUsdt = Wallet.createRandom().address;
const destXafe = new Wallet(Wallet.createRandom().privateKey, fournisseur);

const graine = Wallet.createRandom().mnemonic!.phrase;  // une graine neuve à chaque épreuve
const A = artefact("XAFe.sol/XAFe.json");
const U = artefact("essai/UsdtEssai.sol/UsdtEssai.json");
const xafe = await new ContractFactory(A.abi, A.bytecode, admin).deploy(await admin.getAddress(), parseUnits("50000000", 6)) as unknown as Contract;
const usdt = await new ContractFactory(U.abi, U.bytecode, admin).deploy() as unknown as Contract;
await xafe.waitForDeployment(); await usdt.waitForDeployment();
const chaudAdresse = deriver(graine, "bep20", 0).adresse;
await (await xafe.grantRole(await xafe.FRAPPEUR_ROLE(), chaudAdresse)).wait();
await (await xafe.grantRole(await xafe.DESTRUCTEUR_ROLE(), chaudAdresse)).wait();
await (await admin.sendTransaction({ to: chaudAdresse, value: parseEther("10") })).wait();
await (await usdt.frapper(await externe.getAddress(), parseUnits("10000", 18))).wait();
await (await admin.sendTransaction({ to: destXafe.address, value: parseEther("1") })).wait();

sql(`update parametres set valeur = jsonb_set(valeur, '{retraits_ouverts}', 'true') where cle = 'crypto'`);
// la réserve d'adresses des scénarios précédents est faite d'adresses inventées : on part d'une réserve vide ;
// leurs retraits restés en route sont rendus à leurs clients, comme le ferait un échec
sql(`delete from adresses_libres where reseau = 'bep20'`);
sql(`select count(chaine_resultat_retrait(reference, false, null, 'rendu avant l''épreuve des wallets')) from retraits_crypto where reseau = 'bep20' and etat in ('en_attente', 'en_cours')`);
const maisonUsdt0 = Number(sql(`select coalesce(sum(disponible + bloque), 0) from soldes where actif = 'USDT' and compte_id = compte_maison()`));
const surChaine0 = Number(sql(`select circulation_chaine()`));
const journal: string[] = [];
const coupure = { active: false };
const chaine = new ChaineBep20({
  rpcUrl: RPC_CHAINE, usdt: await usdt.getAddress(), xafe: await xafe.getAddress(), graine, confirmations: 3, reserve: 3, seuilBalayage: 10,
  journal: (l) => journal.push(l),
  apresSignature: () => { if (coupure.active) { coupure.active = false; throw new Error("coupure de courant"); } },
});
await chaine.demarrer();
const tour = async () => ({
  ...(await chaine.preparerAdresses(rpcVeilleur)), credites: await chaine.crediterDepots(rpcVeilleur), balayees: await chaine.balayer(rpcVeilleur), ...(await chaine.envoyerRetraits(rpcVeilleur)),
});

/* ---------------------------------------------------------- 1 · adresses */
const t1 = await tour();
verifier(t1.aInscrire.length === 3, "les adresses XAFe attendent leur inscription au contrat par l'admin", JSON.stringify(t1));
await inscrire(RPC_CHAINE, await xafe.getAddress(), (admin as unknown as { privateKey?: string }).privateKey ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", t1.aInscrire);
await tour();
const etat = await rpc("chaine_adresses", { p_reseau: "bep20" });
verifier(etat.libres.USDT >= 3 && etat.libres.XAFe >= 3, "une réserve d'adresses de dépôt est prête, USDT et XAFe", JSON.stringify(etat.libres));

const ama = await client(TEMOIN ? "237677130002" : "237677130001");
sql(`update comptes set palier = 2 where id = '${ama.id}'`);  // le palier a ses scénarios ; ici, les wallets
const adresseUsdt = await ama.appel("adresse_depot", { p_actif: "USDT", p_reseau: "bep20" }) as string;
const indice = Number(sql(`select indice from adresses_crypto where compte_id = '${ama.id}' and actif = 'USDT'`));
verifier(deriver(graine, "bep20", indice).adresse === adresseUsdt, "l'adresse donnée au client est la dérivée de la graine que la base dit — la base ne garde aucune clé", `${adresseUsdt} ≠ dérivée ${indice}`);
verifier(Number(sql(`select count(*) from information_schema.columns where table_schema = 'public' and column_name ilike '%cle_privee%'`)) === 0, "aucune colonne de clé privée dans la base");

/* ------------------------------------------------------------ 2 · dépôt */
const soldeUsdt = async (c: { appel: (n: string, a: Record<string, unknown>) => Promise<any> }) => Number((await c.appel("mes_soldes", {}))?.USDT?.disponible ?? 0);
await (await (usdt.connect(externe) as Contract).transfer(adresseUsdt, parseUnits("125.5", 18))).wait();
await tour();
verifier(await soldeUsdt(ama) === 0, "un dépôt pas encore confirmé n'est pas crédité");
await miner(3);
const t2 = await tour();
verifier(await soldeUsdt(ama) === 125.5 && t2.credites === 1, "après ses confirmations, le dépôt est crédité au centime : 125,50 USDT", `solde ${await soldeUsdt(ama)}`);
await miner(3); await tour(); await tour();
verifier(await soldeUsdt(ama) === 125.5, "relu tour après tour, il ne crédite pas deux fois");
verifier(Number(sql(`select count(*) from transferts_crypto where adresse ilike '${adresseUsdt}'`)) === 1, "un seul transfert au grand livre");

/* ---------------------------------------------------------- 3 · balayage */
verifier(await usdt.balanceOf(adresseUsdt) === 0n && await usdt.balanceOf(chaudAdresse) === parseUnits("125.5", 18), "les USDT du dépôt ont rejoint le wallet chaud, gaz avancé par lui");

/* ----------------------------------------- 4 · un retrait coupé en route */
// d'abord un retrait vers une adresse à la somme de contrôle fausse (une faute de frappe) : il passe devant
const fautive = "0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21";
const rFaux = await ama.appel("demander_retrait_crypto", { p_actif: "USDT", p_reseau: "bep20", p_adresse: fautive, p_montant: 5, p_cle: "w-0", p_code: "2580" });
const r = await ama.appel("demander_retrait_crypto", { p_actif: "USDT", p_reseau: "bep20", p_adresse: destUsdt, p_montant: 50, p_cle: "w-1", p_code: "2580" });
coupure.active = true;
await tour().catch(() => null);  // le veilleur tombe entre la signature notée et la diffusion
const signe = sql(`select tx_hash from retraits_crypto where reference = '${r.reference}'`);
verifier(sql(`select etat from retraits_crypto where reference = '${rFaux.reference}'`) === "echoue" && await soldeUsdt(ama) === 125.5 - 51,
  "une adresse à la somme de contrôle fausse est refusée, les 6 USDT reviennent — et le retrait suivant n'est pas bloqué derrière elle", `solde ${await soldeUsdt(ama)}`);
verifier(signe.startsWith("0x") && await usdt.balanceOf(destUsdt) === 0n, "la transaction est signée et notée, mais n'est pas partie (coupure)");
await tour(); await miner(3); await tour(); await miner(3); await tour();
verifier(await usdt.balanceOf(destUsdt) === parseUnits("50", 18), "relancé, le veilleur rediffuse LA MÊME transaction : 50 USDT arrivent, une fois", `reçu ${await usdt.balanceOf(destUsdt)}`);
const final = sql(`select etat || ' ' || tx_hash from retraits_crypto where reference = '${r.reference}'`);
if (final !== `envoye ${signe}`) console.log(journal.filter((l) => l.includes(r.reference)).join("\n"));
verifier(final === `envoye ${signe}`, "le retrait est « envoyé », sous le hash signé avant la coupure", `${final} (signé : ${signe})`);

/* --------------------------------------------- 5 · XAFe sortis puis rendus */
sql(`select _mouvement('${ama.id}', 'XAFe', 200000, 0, 'essai_wallets', 'essai', 'w'); insert into emissions (sens, montant, source_table, source_id) values ('emission', 200000, 'essai', 'w')`);
const rx = await ama.appel("demander_retrait_crypto", { p_actif: "XAFe", p_reseau: "bep20", p_adresse: destXafe.address, p_montant: 150000, p_cle: "w-2", p_code: "2580" });
await tour(); await miner(3); await tour();
verifier(await xafe.balanceOf(destXafe.address) === parseUnits("150000", 6), "150 000 XAFe frappés vers le wallet du client, par le wallet chaud");
verifier(sql(`select etat from retraits_crypto where reference = '${rx.reference}'`) === "envoye", "et le retrait XAFe est « envoyé »");
const adresseXafe = await ama.appel("adresse_depot", { p_actif: "XAFe", p_reseau: "bep20" }) as string;
const xafeAvant = Number((await ama.appel("mes_soldes", {})).XAFe.disponible);
await (await (xafe.connect(destXafe) as Contract).transfer(adresseXafe, parseUnits("100000", 6))).wait();
await miner(3); await tour(); await miner(3); await tour();
const xafeApres = Number((await ama.appel("mes_soldes", {})).XAFe.disponible);
verifier(xafeApres === xafeAvant + 100000, "100 000 XAFe rendus sur l'adresse de dépôt : détruits là, recrédités une fois", `${xafeAvant} → ${xafeApres}`);
verifier(await xafe.balanceOf(adresseXafe) === 0n && await xafe.totalSupply() === parseUnits("50000", 6), "sur la chaîne, ils n'existent plus : l'offre totale est de 50 000");

/* -------------------------------------- 6 · une adresse jamais attribuée */
const libre = sql(`select adresse from adresses_libres where reseau = 'bep20' and actif = 'USDT' limit 1`);
await (await (usdt.connect(externe) as Contract).transfer(libre, parseUnits("7", 18))).wait();
await miner(3); await tour();
verifier(journal.some((l) => l.startsWith("ALERTE") && l.includes(libre.slice(2, 10))) && Number(sql(`select count(*) from transferts_crypto where adresse ilike '${libre}'`)) === 0,
  "un dépôt sur une adresse jamais montrée à un client ne crédite personne, et le veilleur le dit");

/* ------------------------------------------------------- 7 · le rapprochement */
const avoirs = await chaine.avoirs(rpc);
// ce client, plus ce que la maison a gagné PENDANT l'épreuve (les scénarios d'avant ont rempli la maison sans chaîne)
const usdtLivre = Number(sql(`select sum(disponible + bloque) from soldes where actif = 'USDT' and compte_id = '${ama.id}'`))
  + Number(sql(`select coalesce(sum(disponible + bloque), 0) from soldes where actif = 'USDT' and compte_id = compte_maison()`)) - maisonUsdt0;
const usdtChaine = Number(avoirs.usdt / 10n ** 16n) / 100;  // le chaud et les adresses attribuées (pas la réserve)
verifier(Math.abs(usdtLivre - usdtChaine) < 0.005, "les USDT du grand livre (ce client et la maison) SONT sur nos adresses", `grand livre ${usdtLivre}, chaîne ${usdtChaine}`);
const surChaine = Number(sql(`select circulation_chaine()`)) - surChaine0;
verifier(surChaine === Number(avoirs.xafeEnCirculation / 1_000_000n), "les XAFe que la base dit « sur la chaîne » sont l'offre totale du contrat", `base ${surChaine}, contrat ${avoirs.xafeEnCirculation}`);

console.log(echecs ? `✗ ${echecs} exigence(s) non tenue(s)` : "✓ nos wallets tiennent : dérivés, crédités, balayés, envoyés une fois, rapprochés au centime");
process.exit(echecs ? 1 : 0);
