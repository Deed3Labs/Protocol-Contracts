/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as dotenv from "dotenv";
dotenv.config();
import { HardhatUserConfig } from "hardhat/config";
import "hardhat-deploy/dist/src/type-extensions";
import "hardhat-deploy";
import "solidity-coverage";
import "@openzeppelin/hardhat-upgrades";
import "@nomicfoundation/hardhat-verify";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "@nomicfoundation/hardhat-ethers";

// If not set, it uses ours Alchemy's default API key.
// You can get your own at https://dashboard.alchemyapi.io
const providerApiKey = process.env.ALCHEMY_API_KEY || "oKxs-03sij-U_N0iOlrSsZFr29-IqbuF";
// If not set, it uses the hardhat account 0 private key.
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY!;
// If not set, it uses ours Etherscan default API key.
const etherscanApiKey = process.env.ETHERSCAN_API_KEY || "DNXJA8RX2Q3VZ4URQIWP7Z68CJXQZSC6AW";
const polygonscanApiKey = process.env.POLYGONSCAN_API_KEY || "DNXJA8RX2Q3VZ4URQIWP7Z68CJXQZSC6AW";
const arbiscanApiKey = process.env.ARBISCAN_API_KEY || "DNXJA8RX2Q3VZ4URQIWP7Z68CJXQZSC6AW";
const deployerAccount = process.env.DEPLOYER_ACCOUNT!;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.29",
    settings: {
      optimizer: {
        enabled: true,
        runs: 20
      },
      viaIR: true,
      // Disable error strings to save gas
      debug: {
        revertStrings: "strip"
      },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"],
        },
      }
    },
  },
  sourcify: {
    enabled: true,
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  namedAccounts: {
    deployer: {
      // By default, it will take the first Hardhat account as the deployer
      default: 0,
      localhost: deployerAccount,
      sepolia: deployerAccount,
      polygon: deployerAccount,
      arbitrum: deployerAccount,
      "base-sepolia": deployerAccount,
    },
    manager: {
      localhost: deployerAccount ?? "0x91B0d67D3F47A30FBEeB159E67209Ad6cb2cE22E",
      sepolia: "0xD30aee396a54560581a3265Fd2194B0edB787525",
      polygon: "0xD0cC723ED8FEE1eaDFf8CB0883A244b16163361B",
      arbitrum: "0x84F1d8D4B10b1C56e032aE09bCA57f393638cd4E",
      "base-sepolia": deployerAccount,
    },
  },
  networks: {
    // View the networks that are pre-configured.
    // If the network you are looking for is not here you can add new network settings
    localhost: {
      url: "HTTP://127.0.0.1:8545",
      chainId: 1337,
      accounts: [deployerPrivateKey],
      saveDeployments: true,
    },
    mainnet: {
      url: `https://eth-mainnet.alchemyapi.io/v2/${providerApiKey}`,
      accounts: [deployerPrivateKey],
    },
    arbitrum: {
      url: `https://arb-mainnet.g.alchemy.com/v2/${providerApiKey}`,
      accounts: [deployerPrivateKey],
    },
    polygon: {
      url: `https://polygon-mainnet.g.alchemy.com/v2/${providerApiKey}`,
      accounts: [deployerPrivateKey],
    },
    sepolia: {
      url: `https://eth-sepolia.g.alchemy.com/v2/${providerApiKey}`,
      accounts: [deployerPrivateKey],
    },
    "base-sepolia": {
      url: "https://sepolia.base.org",
      accounts: [deployerPrivateKey],
      gasPrice: "auto",
      chainId: 84532,
      verify: {
        etherscan: {
          apiUrl: "https://base-sepolia.blockscout.com/api",
        }
      }
    },
    base: {
      url: "https://mainnet.base.org",
      accounts: [deployerPrivateKey],
      gasPrice: "auto",
      chainId: 8453,
      verify: {
        etherscan: {
          apiUrl: "https://base.blockscout.com/api",
        }
      }
    },
    chiado: {
      url: "https://rpc.chiadochain.net",
      gasPrice: 1000000000,
      accounts: [deployerPrivateKey],
    },
    holesky: {
      url: "https://ethereum-holesky.publicnode.com",
      gasPrice: 1000000000,
      chainId: 17000,
      accounts: [deployerPrivateKey],
    },
    goerli: {
      url: `https://eth-goerli.alchemyapi.io/v2/${providerApiKey}`,
      accounts: [deployerPrivateKey],
    },
    arbitrumGoerli: {
      url: `https://arb-goerli.g.alchemy.com/v2/${providerApiKey}`,
      accounts: [deployerPrivateKey],
    },
    optimism: {
      url: `https://opt-mainnet.g.alchemy.com/v2/${providerApiKey}`,
      accounts: [deployerPrivateKey],
    },
    optimismGoerli: {
      url: `https://opt-goerli.g.alchemy.com/v2/${providerApiKey}`,
      accounts: [deployerPrivateKey],
    },
    polygonMumbai: {
      url: `https://polygon-mumbai.g.alchemy.com/v2/${providerApiKey}`,
      accounts: [deployerPrivateKey],
    },
  },
  etherscan: {
    apiKey: { 
      sepolia: `${etherscanApiKey}`, 
      polygon: `${polygonscanApiKey}`, 
      arbitrumOne: `${arbiscanApiKey}`,
      "base-sepolia": "PLACEHOLDER",
      base: "PLACEHOLDER"
    },
    customChains: [
      {
        network: "base-sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://base-sepolia.blockscout.com/api",
          browserURL: "https://base-sepolia.blockscout.com"
        }
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://base.blockscout.com/api",
          browserURL: "https://base.blockscout.com"
        }
      }
    ]
  },
  mocha: {
    timeout: 100000
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
    outputFile: "gas-report.txt",
    noColors: true,
    // coinmarketcap: process.env.COINMARKETCAP_API_KEY,
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
} as HardhatUserConfig;

export default config;