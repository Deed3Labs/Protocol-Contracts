import * as fs from "fs";
import * as path from "path";
import { requireMainnetConfirmation } from "../deploy/helpers";

/*
 * Decision 55: the 30-cent card credit fee (docs/audit/specs/card-credit-fee.md). RevolvingIssuer gains
 * `settleCardSpendWithFee`, `returnCardCreditFee`, `maxCardCreditFee` / `setMaxCardCreditFee` and
 * `cardCreditFeeOf`, with the fee given back on a full refund by `reverseCardSpend`. The code is in
 * `RevolvingIssuerExtension` ("RevolvingIssuerExtension.v5": the settlement, the refund, the credit back) and
 * `RevolvingIssuerWorkouts` ("RevolvingIssuerWorkouts.v2": the fee's settlement entry, its bound and the views),
 * with `setCreditTerms` and `setDepositSource` moved back to `RevolvingIssuerCycles` ("RevolvingIssuerCycles.v4")
 * for room. The new state is in its own ERC-7201 namespace (clear.storage.RevolvingIssuer.CardFee): nothing in
 * the layout moves. The fee is on by default (owner, Nov 18, 2026): the upgrade is one
 * `upgradeToAndCall(impl, setMaxCardCreditFee(CARD_CREDIT_FEE_CAP_USDC))`, so the bound is set in the same
 * transaction. One credit settings signer can set it back to zero (the off switch).
 *
 * RevolvingIssuer's owner is the CreditTimelock (`_authorizeUpgrade` is `onlyOwner`), whose proposer and
 * executor is the Clear Treasury Safe. So the upgrade is a CreditTimelock proposal (signing plan steps
 * CF-upgrade-schedule, then CFx-upgrade-execute 7 days later). The call inside it runs as the timelock, which
 * passes `onlyCreditRole(CREDIT_SETTINGS_ROLE)` because it holds the AccessManager's admin role (`hasCreditRole`;
 * the signing plan checks it). This script only prepares it:
 *
 * 1. OpenZeppelin's `validateUpgrade` against the network's manifest (`.openzeppelin/<network>.json`) and the
 *    implementation the proxy runs: the layout must be append-only. Nothing is deployed before it passes.
 * 2. With CARD_FEE_PREPARE=1: the four modules, then the RevolvingIssuer implementation with their addresses
 *    (`upgrades.prepareUpgrade`, which records it in the manifest), and the record
 *    `deployments/<network>/RevolvingIssuerCardFee.json`: the implementation's address and ABI, the modules,
 *    the implementation it replaces and the transaction hashes. The signing plan reads it.
 *
 * It never upgrades the proxy, never schedules anything and sends nothing else. Without CARD_FEE_PREPARE=1
 * it validates and prints what it would do.
 *
 *   npx hardhat run scripts/upgrade_card_credit_fee.ts --network base-sepolia                      # validate only
 *   CARD_FEE_PREPARE=1 npx hardhat run scripts/upgrade_card_credit_fee.ts --network base-sepolia
 */

export const CARD_FEE_RECORD = "RevolvingIssuerCardFee";
export const CARD_FEE_MODULES = ["RevolvingIssuerExtension", "RevolvingIssuerCycles", "RevolvingIssuerTerms", "RevolvingIssuerWorkouts"] as const;
/** What the new implementation's constructor checks each module for. */
export const CARD_FEE_MODULE_KINDS: Record<(typeof CARD_FEE_MODULES)[number], string> = {
  RevolvingIssuerExtension: "RevolvingIssuerExtension.v5",
  RevolvingIssuerCycles: "RevolvingIssuerCycles.v4",
  RevolvingIssuerTerms: "RevolvingIssuerTerms.v2",
  RevolvingIssuerWorkouts: "RevolvingIssuerWorkouts.v2",
};
/** The chain each network must answer as. Any other network is refused. */
const NETWORK_CHAINS: Record<string, number> = { "base-sepolia": 84532, "base-sepolia-fork": 84532, base: 8453, hardhat: 31337 };
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export interface CardFeeRecord {
  address: string;
  abi: any[];
  network: string;
  chainId: number;
  proxy: string;
  /** The implementation the proxy ran when this was prepared: the one the upgrade replaces. */
  replaces: string;
  modules: Record<string, string>;
  txHashes: Record<string, string | null>;
  preparedAt: string;
}

export interface CardFeeUpgradeOptions {
  /** The RevolvingIssuer proxy. */
  proxy: string;
  /** Deploy the modules and the implementation, and write the record (else validate and print only). */
  prepare?: boolean;
  /** The network name: its expected chain is checked, and the record goes to deployments/<network>. */
  network: string;
  /** Where to write the record (default deployments/<network>). */
  recordsDir?: string;
  log?: (m: string) => void;
}

export function readCardFeeRecord(recordsDir: string): CardFeeRecord | undefined {
  const file = path.join(recordsDir, `${CARD_FEE_RECORD}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : undefined;
}

export async function prepareCardFeeUpgrade(o: CardFeeUpgradeOptions) {
  const { ethers, upgrades } = require("hardhat");
  const log = o.log ?? console.log;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const wanted = NETWORK_CHAINS[o.network];
  if (wanted === undefined) throw new Error(`Refusing: ${o.network} is not a network this script knows (${Object.keys(NETWORK_CHAINS).join(", ")}).`);
  if (chainId !== wanted) throw new Error(`Refusing: ${o.network} must be chain ${wanted}, and this node answers as chain ${chainId}.`);
  if (!ethers.isAddress(o.proxy) || (await ethers.provider.getCode(o.proxy)) === "0x") throw new Error(`Refusing: RevolvingIssuer ${o.proxy} has no code on ${o.network}.`);

  const [signer] = await ethers.getSigners();
  const RevolvingIssuer = await ethers.getContractFactory("RevolvingIssuer", signer);
  const proxy = new ethers.Contract(o.proxy, ["function owner() view returns (address)", "function maxCardCreditFee() view returns (uint256)"], ethers.provider);
  const replaces: string = ethers.getAddress("0x" + (await ethers.provider.getStorage(o.proxy, IMPL_SLOT)).slice(-40));
  const owner: string = await proxy.owner();

  // The module addresses do not affect the layout check: placeholders stand in for them.
  await upgrades.validateUpgrade(o.proxy, RevolvingIssuer, { kind: "uups", constructorArgs: CARD_FEE_MODULES.map(() => ethers.ZeroAddress) });
  log(`RevolvingIssuer ${o.proxy} (implementation ${replaces}, owner ${owner}): the new implementation validates as an upgrade of what the manifest records`);
  if (await proxy.maxCardCreditFee().then(() => true, () => false)) log("! The proxy already answers maxCardCreditFee(): it may run the card fee implementation already.");
  if (!o.prepare) {
    log("Validated only: nothing deployed. CARD_FEE_PREPARE=1 would deploy, from " + signer.address + ":");
    for (const m of CARD_FEE_MODULES) log(`  ${m} ("${CARD_FEE_MODULE_KINDS[m]}")`);
    log("  the RevolvingIssuer implementation with those four modules (upgrades.prepareUpgrade)");
    log(`  and write deployments/${o.network}/${CARD_FEE_RECORD}.json. It would not upgrade the proxy or send anything else.`);
    return { implementation: undefined as string | undefined, replaces, owner };
  }

  const modules: Record<string, string> = {};
  const txHashes: Record<string, string | null> = {};
  for (const m of CARD_FEE_MODULES) {
    const c = await (await ethers.getContractFactory(m, signer)).deploy();
    await c.waitForDeployment();
    modules[m] = await c.getAddress();
    txHashes[m] = c.deploymentTransaction()?.hash ?? null;
    log(`+ ${m.padEnd(26)} ${modules[m]}`);
  }
  const prepared = await upgrades.prepareUpgrade(o.proxy, RevolvingIssuer, {
    kind: "uups", constructorArgs: CARD_FEE_MODULES.map((m) => modules[m]), getTxResponse: true,
  });
  let implementation: string;
  if (typeof prepared === "string") {
    implementation = prepared;
    txHashes.RevolvingIssuer = null; // the manifest already had this exact implementation
  } else {
    const rc = await prepared.wait();
    implementation = ethers.getAddress(rc.contractAddress);
    txHashes.RevolvingIssuer = prepared.hash;
  }
  log(`+ RevolvingIssuer impl         ${implementation}`);

  const record: CardFeeRecord = {
    address: implementation,
    abi: JSON.parse(RevolvingIssuer.interface.formatJson()),
    network: o.network,
    chainId,
    proxy: ethers.getAddress(o.proxy),
    replaces,
    modules,
    txHashes,
    preparedAt: new Date().toISOString(),
  };
  const dir = o.recordsDir ?? path.join("deployments", o.network);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${CARD_FEE_RECORD}.json`), JSON.stringify(record, null, 2) + "\n");
  log(`  recorded as ${path.join(dir, `${CARD_FEE_RECORD}.json`)}`);
  log("\nNothing is upgraded. The Clear Treasury Safe schedules upgradeToAndCall(impl, setMaxCardCreditFee(fee)) on the CreditTimelock:");
  log(`  npx hardhat run scripts/signing_plan.ts --network ${o.network}   (steps CF-upgrade-schedule, CFx-upgrade-execute)`);
  return { implementation, replaces, owner, modules, txHashes };
}

async function main() {
  const hre = require("hardhat");
  const network: string = hre.network.name;
  requireMainnetConfirmation(network, "scripts/upgrade_card_credit_fee.ts");
  const file = path.join("deployments", network, "RevolvingIssuer.json");
  if (!fs.existsSync(file)) throw new Error(`No RevolvingIssuer recorded for ${network}.`);
  const proxy = JSON.parse(fs.readFileSync(file, "utf8")).address;
  await prepareCardFeeUpgrade({ proxy, prepare: process.env.CARD_FEE_PREPARE === "1", network });
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
