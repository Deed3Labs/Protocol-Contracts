/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as dotenv from "dotenv";
dotenv.config();
import { HardhatUserConfig, extendEnvironment } from "hardhat/config";
import fs from "fs";
import "hardhat-deploy/dist/src/type-extensions";
import "hardhat-deploy";
import "solidity-coverage";
import "@openzeppelin/hardhat-upgrades";
import "@nomicfoundation/hardhat-verify";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "@nomicfoundation/hardhat-ethers";
import "hardhat-preprocessor";

// If not set, it uses ours Alchemy's default API key.
// You can get your own at https://dashboard.alchemyapi.io
// Stripping revert strings saves gas, but makes every `revertedWith("...")` assertion
// unverifiable. Keep them whenever we are running tests.
const keepRevertStrings =
  process.env.KEEP_REVERT_STRINGS === "true" ||
  process.argv.includes("test") ||
  process.argv.includes("coverage");

const providerApiKey = process.env.ALCHEMY_API_KEY || "oKxs-03sij-U_N0iOlrSsZFr29-IqbuF";
const baseSepoliaRpcUrl =
  process.env.BASE_SEPOLIA_RPC_URL ||
  process.env.VITE_ALCHEMY_BASE_SEPOLIA ||
  "https://sepolia.base.org";
const baseMainnetRpcUrl =
  process.env.BASE_MAINNET_RPC_URL ||
  process.env.VITE_ALCHEMY_BASE_MAINNET ||
  "https://mainnet.base.org";
// Rehearsing against a live deployment: set FORK_RPC_URL (and optionally FORK_BLOCK) and the
// in-process `hardhat` network becomes a fork of it. Deliberately opt-in — the test suite must
// keep running with no network at all.
const forkRpcUrl = process.env.FORK_RPC_URL?.trim();

// The Base Sepolia rehearsal (docs/audit/SEPOLIA-REHEARSAL.md): `npx hardhat node` forked as above,
// then every script run against it with `--network base-sepolia-fork`. Its records are a scratch copy
// in deployments/base-sepolia-fork/ (never committed). It holds no key: the node signs for
// impersonated accounts, and FORK_SIGNER (default the Base Sepolia deployer) is the scripts' signer.
// Inert unless a script names this network.
const REHEARSAL_NETWORK = "base-sepolia-fork";
const REHEARSAL_DEFAULT_SIGNER = "0x895d44d10d1b7B4F5f38E2ae2322539Cf93F7AAA";
extendEnvironment((hre) => {
  if (hre.network.name !== REHEARSAL_NETWORK) return;
  const signerAddress = process.env.FORK_SIGNER?.trim() || REHEARSAL_DEFAULT_SIGNER;
  const ethers = (hre as any).ethers;
  ethers.getSigners = async () => {
    await hre.network.provider.send("hardhat_impersonateAccount", [signerAddress]);
    return [await ethers.getSigner(signerAddress)];
  };
});
// If not set, it uses the hardhat account 0 private key.
function normalizePrivateKey(rawValue: string | undefined): string {
  const trimmed = (rawValue || "").trim();
  if (!trimmed) {
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }

  if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) {
    return trimmed;
  }

  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    return `0x${trimmed}`;
  }

  return trimmed;
}

const deployerPrivateKey = normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY);
// If not set, it uses ours Etherscan default API key.
const etherscanApiKey = process.env.ETHERSCAN_API_KEY || "DNXJA8RX2Q3VZ4URQIWP7Z68CJXQZSC6AW";
const polygonscanApiKey = process.env.POLYGONSCAN_API_KEY || "DNXJA8RX2Q3VZ4URQIWP7Z68CJXQZSC6AW";
const arbiscanApiKey = process.env.ARBISCAN_API_KEY || "DNXJA8RX2Q3VZ4URQIWP7Z68CJXQZSC6AW";
const deployerAccount = process.env.DEPLOYER_ACCOUNT || "0x0000000000000000000000000000000000000000";

function getRemappings(): [string, string][] {
  const remappingsFile = "node_modules/@chainlink/contracts-ccip/remappings.txt";
  if (!fs.existsSync(remappingsFile)) {
    return [];
  }

  return fs
    .readFileSync(remappingsFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#"))
    .map((line) => line.split("=") as [string, string]);
}

const remappings = getRemappings();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.29",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1,
        details: {
          yul: true,
          deduplicate: true,
          cse: true,
          constantOptimizer: true
        }
      },
      viaIR: true,
      // Revert strings are stripped in production builds to save gas and bytecode size.
      // They are kept under `hardhat test`/`coverage` so assertions on require() reasons
      // work; set KEEP_REVERT_STRINGS=true to keep them in any other task.
      // New code should prefer custom errors, which survive stripping either way.
      debug: {
        revertStrings: keepRevertStrings ? "default" : "strip"
      },
      outputSelection: {
        "*": {
          "": ["ast"],
          "*": [
            "abi",
            "metadata",
            "devdoc",
            "userdoc",
            "storageLayout",
            "evm.legacyAssembly",
            "evm.bytecode",
            "evm.deployedBytecode",
            "evm.methodIdentifiers",
            "evm.gasEstimates",
            "evm.assembly"
          ]
        },
      }
    },
  },
  preprocess: {
    eachLine: () => ({
      transform: (line: string) => {
        for (const [from, to] of remappings) {
          if (line.includes(from)) {
            return line.replace(from, to);
          }
        }
        return line;
      },
    }),
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
    hardhat: {
      // Keeping revert strings inflates bytecode past EIP-170 for a few of the
      // larger contracts (DeedNFT et al). Lift the limit only in that mode, so
      // production builds are still held to the real deployable size.
      allowUnlimitedContractSize: keepRevertStrings,
      ...(forkRpcUrl
        ? {
            forking: {
              url: forkRpcUrl,
              ...(process.env.FORK_BLOCK ? { blockNumber: Number(process.env.FORK_BLOCK) } : {}),
            },
            // FORK_CHAIN_ID=84532 makes the fork answer as Base Sepolia, so chain-keyed settings
            // (`*_84532` variables, Safe batch files, decision 50's testnet rule) read as on the real run.
            // (The node answers no call at the fork block itself, chain 84532 having no hardfork
            // history it knows: mine one block first. scripts/rehearse_sepolia_fork.ts does.)
            ...(process.env.FORK_CHAIN_ID ? { chainId: Number(process.env.FORK_CHAIN_ID) } : {}),
          }
        : {}),
    },
    // The rehearsal: a local `npx hardhat node` forked from Base Sepolia (see REHEARSAL_NETWORK above).
    [REHEARSAL_NETWORK]: {
      url: process.env.FORK_NODE_URL || "http://127.0.0.1:8545",
      accounts: "remote",
      timeout: 600000,
    },
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
      url: baseSepoliaRpcUrl,
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
      url: baseMainnetRpcUrl,
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
  coverage: {
    solcoverjs: {
      skipFiles: [
        "contracts/libraries/**/*.sol",
        "contracts/mocks/**/*.sol",
        "contracts/extensions/**/*.sol"
      ],
      skipFilesWithNoCoverage: true
    }
  }
} as HardhatUserConfig;

export default config;
