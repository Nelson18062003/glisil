// Déploie le jeton XAFe et donne l'administration à l'adresse ADMIN (ou au déployeur).
//   npm run deployer:testnet      (BNB Smart Chain testnet, chainId 97)
//   npm run deployer:bsc          (BNB Smart Chain, chainId 56)
const { ethers, network } = require("hardhat");

async function main() {
  const [deployeur] = await ethers.getSigners();
  // Sur une vraie chaîne, l'admin est un wallet matériel désigné, JAMAIS la clé chaude qui déploie.
  const local = ["hardhat", "localhost"].includes(network.name);
  if (!process.env.ADMIN && !local) throw new Error("ADMIN obligatoire hors réseau local : l'adresse du wallet matériel qui administrera le jeton");
  const admin = process.env.ADMIN || deployeur.address;
  console.log(`réseau ${network.name} · déployeur ${deployeur.address} · admin ${admin}`);
  // Le plafond de frappe par jour, en XAF : une clé de frappe volée ne frappe pas au-delà.
  const plafondXaf = BigInt(process.env.PLAFOND_JOUR_XAF || "50000000");
  console.log(`plafond de frappe : ${plafondXaf} XAF par jour (PLAFOND_JOUR_XAF)`);
  const Jeton = await ethers.getContractFactory("XAFe");
  const jeton = await Jeton.deploy(admin, plafondXaf * 1_000_000n);
  await jeton.waitForDeployment();
  console.log(`XAFe déployé à ${await jeton.getAddress()}`);
  console.log("Ensuite, DEPUIS LE WALLET ADMIN (le déployeur n'a aucun rôle) :");
  console.log("  grantRole(FRAPPEUR_ROLE, <signataire de la plateforme>), grantRole(DESTRUCTEUR_ROLE, <idem>),");
  console.log("  grantRole(GELEUR_ROLE, <conformité>), grantRole(PAUSEUR_ROLE, <astreinte>),");
  console.log("  inscrireAdressesDeDepot([...], true) pour chaque lot d'adresses préparé par le moteur.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
