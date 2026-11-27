#!/usr/bin/env node
/*
 * Point carry at the payout pool, so it can be split by who bore the float.
 *
 *   node scripts/configure-carry-recipients.mjs                 # report only
 *   node scripts/configure-carry-recipients.mjs --apply
 *
 * THE ORDER MATTERS, and this script enforces it.
 *
 * `carryTreasury` used to be two things at once: `TermIssuer.openPlan` mints the CO-OP'S FEE to it
 * as well -- `originatePurchase(member, purchase, merchant, payout, carryTreasury, discount)`. This
 * was run on Base Sepolia on 2026-09-21 and reverted the same day, because pointing it at the pool
 * sent every new purchase's 2.5% there too, where `distributeCarry` would have split the co-op's
 * own income among funders. Nothing was lost: no purchase happened in the window.
 *
 * TermIssuer now has `feeRecipient`, unset meaning the carry treasury. So:
 *
 *   1. name the co-op as feeRecipient      the fee stops depending on where carry goes
 *   2. point carryTreasury at the pool     carry alone, to be split by who bore the float
 *
 * Never the other way round, and never the second without the first: in between, the fee would be
 * minted wherever carry had gone. The script refuses to do step 2 for an issuer that has not had
 * step 1, and TermIssuer is the only issuer with a fee -- RevolvingIssuer uses `carryTreasury` as
 * the fallback for carry alone.
 *
 * Run it after the upgrade, not before: carry reaching a pool that cannot split it just piles up.
 *
 * What it changes, and what it deliberately does not:
 *
 *   TermIssuer.carryTreasury     -> the payout pool. Carry on term plans is charged to members and
 *                                   owed to whoever funded the payouts they are carrying.
 *   RevolvingIssuer.carryTreasury -> the payout pool, as the backstop for tiers that name nobody.
 *   tierCarryRecipient            -> UNTOUCHED. A tier funded by the LendingPool already names it,
 *                                   and that carry belongs to its depositors, not to this split.
 *
 * Nothing about the co-op's share changes: what no funder bore still reaches the co-op, through
 * `distributeCarry` rather than directly.
 *
 * The addresses (decision 48): read from the current deployment records, `deployments/<network>/`
 * `PayoutPool.json`, `TermIssuer.json` and `RevolvingIssuer.json`, so after the fresh Base Sepolia
 * credit stack (decision 47) it names the fresh contracts, never the retired `*PreAudit` ones. An
 * environment override (PAYOUT_POOL_<chain>, TERM_ISSUER_<chain>, REVOLVING_ISSUER_<chain>) still
 * wins, but the script refuses any address that is a retired `*PreAudit` record. Base mainnet
 * (8453) with --apply needs CONFIRM_MAINNET=1.
 */
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ethers } from 'ethers';

const APPLY = process.argv.includes('--apply');
const CHAIN = Number(process.env.SAVINGS_DEFAULT_CHAIN_ID || 84532);
const ROOT = new URL('../', import.meta.url).pathname;

const NETWORKS = {
  84532: { dir: 'base-sepolia', rpc: process.env.RPC_URL_84532 || 'https://sepolia.base.org' },
  8453: { dir: 'base', rpc: process.env.RPC_URL_8453 || 'https://mainnet.base.org' },
};

const net = NETWORKS[CHAIN];
if (!net) {
  console.error(`No deployment records for chain ${CHAIN}.`);
  process.exit(1);
}
if (CHAIN === 8453 && APPLY && process.env.CONFIRM_MAINNET !== '1') {
  console.error('This would act on Base mainnet. Set CONFIRM_MAINNET=1 to confirm that is meant.');
  process.exit(1);
}

const recordsDir = join(ROOT, 'deployments', net.dir);
const recordAddress = (name) => {
  const file = join(recordsDir, `${name}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).address : undefined;
};
// Decision 47: the retired credit stack keeps its records as `<Name>PreAudit`.
const retired = new Map(
  ['PayoutPool', 'TermIssuer', 'RevolvingIssuer']
    .map((name) => [recordAddress(`${name}PreAudit`)?.toLowerCase(), `${name}PreAudit`])
    .filter(([address]) => address),
);
const pick = (name, envName) => {
  const address = process.env[envName] || recordAddress(name);
  if (!address || !ethers.isAddress(address)) {
    console.error(`No ${name} record in deployments/${net.dir}/ and no ${envName}: deploy it first.`);
    process.exit(1);
  }
  const old = retired.get(address.toLowerCase());
  if (old) {
    console.error(`${name} ${address} is the retired ${old}: point carry at the fresh ${name} record instead.`);
    process.exit(1);
  }
  return address;
};

const ADDRESSES = {
  [CHAIN]: {
    payoutPool: pick('PayoutPool', `PAYOUT_POOL_${CHAIN}`),
    termIssuer: pick('TermIssuer', `TERM_ISSUER_${CHAIN}`),
    revolvingIssuer: pick('RevolvingIssuer', `REVOLVING_ISSUER_${CHAIN}`),
    rpc: net.rpc,
  },
};

const ISSUER_ABI = [
  'function carryTreasury() view returns (address)',
  'function setCarryTreasury(address treasury) external',
];
const FEE_ABI = [
  'function feeRecipient() view returns (address)',
];

const where = ADDRESSES[CHAIN];
if (!where) {
  console.error(`No addresses for chain ${CHAIN}.`);
  process.exit(1);
}

const key = (process.env.CREDIT_OPERATOR_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
if (APPLY && !key) {
  console.error('Needs CREDIT_OPERATOR_PRIVATE_KEY to apply. Run without --apply to report.');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(where.rpc);
const signer = key ? new ethers.Wallet(key, provider) : null;

/*
 * Step 1, report only. Since Addendum 2 (12.16, Phase 2e) the origination fee is Clear Lending's,
 * never the co-op's: `feeRecipient` is changed only by two CREDIT_SETTINGS_ROLE holders
 * (`proposeFeeRecipient` then `approveFeeRecipient`, with a reason code), and the co-op's treasury
 * is refused. An unset recipient no longer falls back to the carry treasury; a plan with a fee
 * simply cannot open, so step 2 cannot take the fee along.
 */
const term = new ethers.Contract(where.termIssuer, FEE_ABI, provider);
const fee = await term.feeRecipient().catch(() => null);
if (fee === null) {
  console.error('TermIssuer has no feeRecipient: it has not been upgraded. Nothing is safe to point yet.');
  process.exit(1);
}
const coop = where.coopTreasury || (await new ethers.Contract(where.termIssuer, ISSUER_ABI, provider).carryTreasury());
if (fee === ethers.ZeroAddress) {
  console.log(`TermIssuer feeRecipient: unset. Clear Lending's recipient is named by two signers (never the co-op, ${coop}).`);
} else {
  console.log(`TermIssuer feeRecipient: already ${fee}`);
}
if (!APPLY) console.log('');

for (const [name, address] of [
  ['TermIssuer', where.termIssuer],
  ['RevolvingIssuer', where.revolvingIssuer],
]) {
  const issuer = new ethers.Contract(address, ISSUER_ABI, provider);
  const current = await issuer.carryTreasury().catch(() => null);
  if (current === null) {
    console.log(`${name}: no carryTreasury on this deployment — skipped.`);
    continue;
  }
  if (current.toLowerCase() === where.payoutPool.toLowerCase()) {
    console.log(`${name}: already pointing at the payout pool.`);
    continue;
  }
  console.log(`${name}: ${current} -> ${where.payoutPool}`);
  if (!APPLY) continue;

  const tx = await issuer.connect(signer).setCarryTreasury(where.payoutPool);
  await tx.wait(1);
  console.log(`  done (${tx.hash})`);
}

if (!APPLY) console.log('\nNothing changed. Add --apply once the upgraded pool is deployed.');
