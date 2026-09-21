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
 */
import 'dotenv/config';
import { ethers } from 'ethers';

const APPLY = process.argv.includes('--apply');
const CHAIN = Number(process.env.SAVINGS_DEFAULT_CHAIN_ID || 84532);

const ADDRESSES = {
  84532: {
    payoutPool: process.env.PAYOUT_POOL_84532 || '0xe9d1bb0cbDFf7e1Ef8Ff30104C21318c3Bca7D66',
    termIssuer: process.env.TERM_ISSUER_84532 || '0xe467d87756FDF9645D751485CDB72A1E14683721',
    revolvingIssuer: process.env.REVOLVING_ISSUER_84532 || '0x7f15E45aB5eAF0307200274211a90FcbD6716070',
    rpc: process.env.RPC_URL_84532 || 'https://sepolia.base.org',
  },
};

const ISSUER_ABI = [
  'function carryTreasury() view returns (address)',
  'function setCarryTreasury(address treasury) external',
];
const FEE_ABI = [
  'function feeRecipient() view returns (address)',
  'function setFeeRecipient(address recipient) external',
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
 * Step 1, and only TermIssuer has a fee to move. Done first so that step 2 cannot take it along.
 */
const term = new ethers.Contract(where.termIssuer, FEE_ABI, provider);
const fee = await term.feeRecipient().catch(() => null);
if (fee === null) {
  console.error('TermIssuer has no feeRecipient: it has not been upgraded. Nothing is safe to point yet.');
  process.exit(1);
}
const coop = where.coopTreasury || (await new ethers.Contract(where.termIssuer, ISSUER_ABI, provider).carryTreasury());
if (fee === ethers.ZeroAddress) {
  console.log(`TermIssuer feeRecipient: unset -> ${coop}`);
  if (APPLY) {
    const tx = await term.connect(signer).setFeeRecipient(coop);
    await tx.wait(1);
    console.log(`  done (${tx.hash})`);
  }
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
