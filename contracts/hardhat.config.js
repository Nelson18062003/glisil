require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { CLE_PRIVEE, RPC_BSC_TESTNET, RPC_BSC, RPC_ETH, RPC_ETH_SEPOLIA, CLE_ETHERSCAN, CLE_BSCSCAN } = process.env;

module.exports = {
  solidity: {
    version: "0.8.28",
    // « paris » épinglé : le même code va sur Tron (TVM), qui ne connaît pas PUSH0 ni MCOPY (cancun) ;
    // un défaut de Hardhat qui changerait ne doit pas changer le code déployé sans le dire.
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
  },
  networks: {
    bsctestnet: {
      url: RPC_BSC_TESTNET || "https://data-seed-prebsc-1-s1.binance.org:8545/",
      accounts: CLE_PRIVEE ? [CLE_PRIVEE] : [],
      chainId: 97,
    },
    bsc: {
      url: RPC_BSC || "https://bsc-dataseed.binance.org/",
      accounts: CLE_PRIVEE ? [CLE_PRIVEE] : [],
      chainId: 56,
    },
    // Ethereum (livraison 2) : le déploiement passe par `mise-en-service` ; ici, la vérification sur Etherscan.
    mainnet: {
      url: RPC_ETH || "https://ethereum-rpc.publicnode.com",
      accounts: CLE_PRIVEE ? [CLE_PRIVEE] : [],
      chainId: 1,
    },
    sepolia: {
      url: RPC_ETH_SEPOLIA || "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: CLE_PRIVEE ? [CLE_PRIVEE] : [],
      chainId: 11155111,
    },
  },
  // Une clé Etherscan (API V2) vérifie sur Etherscan ET BscScan ; l'ancienne clé BscScan reste comprise.
  etherscan: { apiKey: CLE_ETHERSCAN || CLE_BSCSCAN || "" },
};
