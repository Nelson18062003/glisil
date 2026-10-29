// Déploie le jeton XAFe : tous les rôles posés par le constructeur, d'un coup.
//   ADMIN=0x… CHAUD=0x… npm run deployer:testnet   (BNB Smart Chain testnet, chainId 97)
//   ADMIN=0x… CHAUD=0x… npm run deployer:bsc       (BNB Smart Chain, chainId 56)
// Le chemin recommandé en production est `mise-en-service deployer --production`
// (chaine/), qui couvre aussi Tron ; ce script reste pour BSC seul.
const { ethers, network } = require("hardhat");

async function main() {
  const [deployeur] = await ethers.getSigners();
  // Sur une vraie chaîne, l'admin est un wallet matériel désigné, JAMAIS la clé chaude, JAMAIS la clé qui déploie.
  const local = ["hardhat", "localhost"].includes(network.name);
  if (!process.env.ADMIN && !local) throw new Error("ADMIN obligatoire hors réseau local : l'adresse du wallet matériel qui administrera le jeton");
  if (!process.env.CHAUD && !local) throw new Error("CHAUD obligatoire hors réseau local : l'adresse du wallet chaud (indice 0 de la graine), frappeur et destructeur");
  const admin = process.env.ADMIN || deployeur.address;
  const chaud = process.env.CHAUD || deployeur.address;
  if (!local && admin.toLowerCase() === chaud.toLowerCase()) throw new Error("l'admin ne peut pas être le wallet chaud : une clé de serveur volée prendrait tout");
  const frappeur = process.env.FRAPPEUR || chaud;
  const destructeur = process.env.DESTRUCTEUR || chaud;
  const pauseur = process.env.PAUSEUR || admin;
  const geleur = process.env.GELEUR || admin;
  // l'inscripteur : la clé de mise en service inscrit d'avance un stock d'adresses de dépôt neuves, puis renonce
  const inscripteur = process.env.INSCRIPTEUR || deployeur.address;
  // Le plafond de frappe par jour VERS L'EXTÉRIEUR, en XAF (la réserve n'y compte pas). L'admin le change à tout moment.
  const plafondXaf = BigInt(process.env.PLAFOND_JOUR_XAF || "1000000000");
  const args = [admin, plafondXaf * 1_000_000n, frappeur, destructeur, pauseur, geleur, inscripteur];
  console.log(`réseau ${network.name} · déployeur ${deployeur.address}`);
  console.log(`admin ${admin} · frappeur ${frappeur} · destructeur ${destructeur} · pauseur ${pauseur} · geleur ${geleur} · inscripteur ${inscripteur}`);
  console.log(`plafond de frappe : ${plafondXaf} XAF par jour (PLAFOND_JOUR_XAF)`);
  const jeton = await (await ethers.getContractFactory("XAFe")).deploy(...args);
  await jeton.waitForDeployment();
  const adresse = await jeton.getAddress();
  console.log(`XAFe déployé à ${adresse} — la réserve est le contrat lui-même`);
  console.log(`Vérifier : npx hardhat verify --network ${network.name} ${adresse} ${args.map(String).join(" ")}`);
  console.log("Ensuite : mise-en-service preinscrire --renoncer (l'inscripteur inscrit le stock d'adresses, puis renonce).");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
