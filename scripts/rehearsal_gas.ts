import * as fs from "fs";
import * as path from "path";

/*
 * The gas the Base Sepolia rehearsal used, per step and per sender, and what it would cost on Base
 * Sepolia (docs/audit/SEPOLIA-REHEARSAL.md). Read-only, against the rehearsal node only.
 *
 *   npx hardhat run scripts/rehearsal_gas.ts --network base-sepolia-fork
 *
 * It reads deployments/base-sepolia-fork/rehearsal/ledger.json (scripts/rehearse_sepolia_fork.ts),
 * every transaction in each step's blocks and its receipt. The cost of a transaction on an OP Stack
 * chain is its L2 execution (gas used x the L2 gas price) plus its L1 data fee: the latter is read
 * from the GasPriceOracle predeploy (0x42…0F) on the fork, with the transaction serialized as Base
 * Sepolia would see it. L2_GAS_PRICE_WEI (default: the fork block's base fee plus 0.001 gwei) prices
 * the execution.
 */

const ORACLE = "0x420000000000000000000000000000000000000F";
const OUT = path.join("deployments", "base-sepolia-fork", "rehearsal");

async function main() {
  const hre = require("hardhat");
  const { ethers } = hre;
  if (hre.network.name !== "base-sepolia-fork") throw new Error("Run against --network base-sepolia-fork only.");
  const ledger = JSON.parse(fs.readFileSync(path.join(OUT, "ledger.json"), "utf8"));
  const meta = await hre.network.provider.send("hardhat_metadata", []);
  const forkBlock = await ethers.provider.getBlock(Number(meta.forkedNetwork.forkBlockNumber) + 1);
  const l2Price = process.env.L2_GAS_PRICE_WEI ? BigInt(process.env.L2_GAS_PRICE_WEI) : BigInt(forkBlock.baseFeePerGas ?? 0n) + 1_000_000n;
  const oracle = new ethers.Contract(ORACLE, ["function getL1Fee(bytes) view returns (uint256)"], ethers.provider);
  const fakeSig = { r: "0x" + "11".repeat(32), s: "0x" + "22".repeat(32), v: 27 };

  const rows: any[] = [];
  const bySender = new Map<string, { gas: bigint; l1: bigint; txs: number }>();
  for (const step of ledger) {
    let gas = 0n, l1 = 0n, txs = 0;
    const senders = new Set<string>();
    for (let b = step.fromBlock; b <= step.toBlock; b++) {
      const block = await ethers.provider.getBlock(b, true);
      for (const tx of block?.prefetchedTransactions ?? []) {
        const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
        const serialized = ethers.Transaction.from({
          type: 2, chainId: 84532, nonce: tx.nonce, gasLimit: tx.gasLimit, maxFeePerGas: l2Price * 2n, maxPriorityFeePerGas: 1_000_000n,
          to: tx.to, data: tx.data, value: tx.value, signature: fakeSig,
        }).serialized;
        const fee: bigint = await oracle.getL1Fee(serialized).catch(() => 0n);
        gas += receipt.gasUsed; l1 += fee; txs += 1;
        senders.add(tx.from);
        const s = bySender.get(tx.from) ?? { gas: 0n, l1: 0n, txs: 0 };
        s.gas += receipt.gasUsed; s.l1 += fee; s.txs += 1;
        bySender.set(tx.from, s);
      }
    }
    rows.push({ id: step.id, title: step.title, who: step.who, status: step.status, txs, gas, l1, cost: gas * l2Price + l1, senders: [...senders] });
  }
  const eth = (w: bigint) => ethers.formatEther(w);
  console.log(`L2 gas price ${l2Price} wei (${ethers.formatUnits(l2Price, "gwei")} gwei); L1 data fee from the GasPriceOracle at the fork.\n`);
  console.log("| Step | Txs | Gas used | L1 data fee (ETH) | Cost (ETH) |\n|---|---:|---:|---:|---:|");
  for (const r of rows) console.log(`| ${r.id} | ${r.txs} | ${r.gas.toLocaleString("en-US")} | ${eth(r.l1)} | ${eth(r.cost)} |`);
  const total = rows.reduce((a, r) => ({ txs: a.txs + r.txs, gas: a.gas + r.gas, l1: a.l1 + r.l1, cost: a.cost + r.cost }), { txs: 0, gas: 0n, l1: 0n, cost: 0n });
  console.log(`| **Total** | ${total.txs} | ${total.gas.toLocaleString("en-US")} | ${eth(total.l1)} | ${eth(total.cost)} |`);
  console.log("\n| Sender | Txs | Gas used | Cost (ETH) |\n|---|---:|---:|---:|");
  for (const [who, s] of bySender) console.log(`| ${who} | ${s.txs} | ${s.gas.toLocaleString("en-US")} | ${eth(s.gas * l2Price + s.l1)} |`);
  fs.writeFileSync(path.join(OUT, "gas.json"), JSON.stringify({ l2Price: l2Price.toString(), rows, bySender: Object.fromEntries(bySender) }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
