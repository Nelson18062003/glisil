require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { CLE_PRIVEE, RPC_BSC_TESTNET, RPC_BSC, CLE_BSCSCAN } = process.env;

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 } },
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
  },
  etherscan: { apiKey: CLE_BSCSCAN || "" },
};
