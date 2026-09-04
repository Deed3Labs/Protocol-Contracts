/**
 * Set a member's term ceiling — the line a split plan draws on.
 *
 * `TermIssuer.openPlan` measures `totalPrincipalOf(member) + purchase` against
 * `termLimitOf(member)` and reverts with TermIssuerExceedsTermLimit when it does not fit. A member
 * who has never been given one has zero, so every split reverts, which is what sent a raw
 * estimateGas failure to an approval screen.
 *
 * This is an underwriting entry, not a toggle. The contract's own words: "Underwritten off-chain
 * against attested income and entered here as an attestation, not as raw data." So the amount is
 * always an argument, never a default, and the script says what it is about to do and to whom
 * before it does it.
 *
 * On the first allocation it also opens the member's StableCredit line
 * (`createCreditLine(member, limit, 0)`); afterwards it adjusts that line in place. Both are
 * reported below, because "set a number" understates the second one.
 *
 *   railway ssh "npx tsx scripts/set_term_limit.ts <member> <usd>"
 *
 * Add --dry-run to read the current state and stop. Requires CREDIT_OPERATOR_PRIVATE_KEY (or
 * DEPLOYER_PRIVATE_KEY) holding OPERATOR_ROLE on the issuer.
 */
import { ethers } from 'ethers';

/** Credit units are the reserve token's: six decimals. */
const DECIMALS = 6;

const ABI = [
  'function termLimitOf(address) view returns (uint256)',
  'function totalPrincipalOf(address member) view returns (uint256)',
  'function setTermLimit(address member, uint256 limit)',
  'function stableCredit() view returns (address)',
];

// `onlyOperator` is `stableCredit.access().isOperator(caller)` — an AccessManager two hops away,
// not a role on the issuer itself.
const STABLE_CREDIT_ABI = ['function access() view returns (address)'];
const ACCESS_ABI = ['function isOperator(address) view returns (bool)'];

const usd = (units: bigint) =>
  `$${(Number(units) / 10 ** DECIMALS).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
  const dryRun = process.argv.includes('--dry-run');
  const [member, dollars] = args;

  if (!member || !ethers.isAddress(member)) {
    throw new Error('Usage: set_term_limit.ts <member address> <usd> [--dry-run]');
  }
  // Never defaulted. A ceiling nobody typed is a ceiling nobody decided.
  if (!dryRun && (!dollars || !Number.isFinite(Number(dollars)) || Number(dollars) < 0)) {
    throw new Error('Give the ceiling in dollars, e.g. 2000');
  }

  // Read straight from env, the way seed_demo_merchant.ts does. Scripts sit outside the app's
  // tsconfig and its ESM resolution, so reaching into src/ for two constants buys a whole class of
  // runtime import failures that only show up on the machine holding the key.
  const chainId = Number(
    (process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim() || 84532,
  );
  const address = process.env.TERM_ISSUER_84532 || '0xe467d87756FDF9645D751485CDB72A1E14683721';
  if (chainId !== 84532 && !process.env.TERM_ISSUER_84532) {
    throw new Error(`Set TERM_ISSUER_${chainId} — the built-in address is Base Sepolia's`);
  }

  const key = (process.env.CREDIT_OPERATOR_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  if (!key) throw new Error('CREDIT_OPERATOR_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) is required');

  const rpc = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
  const provider = new ethers.JsonRpcProvider(rpc);
  const signer = new ethers.Wallet(key.startsWith('0x') ? key : `0x${key}`, provider);
  const issuer = new ethers.Contract(address, ABI, signer);

  const [current, principal, stableCreditAddress] = await Promise.all([
    issuer.termLimitOf(member) as Promise<bigint>,
    issuer.totalPrincipalOf(member) as Promise<bigint>,
    issuer.stableCredit() as Promise<string>,
  ]);
  const access = await new ethers.Contract(
    stableCreditAddress,
    STABLE_CREDIT_ABI,
    provider,
  ).access();
  const isOperator: boolean = await new ethers.Contract(access, ACCESS_ABI, provider).isOperator(
    signer.address,
  );

  console.log(`chain      ${chainId}`);
  console.log(`issuer     ${address}`);
  console.log(`member     ${member}`);
  console.log(`ceiling    ${usd(current)}${current === 0n ? '  (never set — no split can open)' : ''}`);
  console.log(`drawn      ${usd(principal)}`);

  console.log(`operator   ${signer.address}${isOperator ? '' : '  (NOT an operator)'}`);

  // Asked before sending, so a missing grant is a sentence rather than a revert.
  if (!isOperator) {
    throw new Error(
      `${signer.address} is not an operator on ${access}. ` +
        'Grant it there, or run this with the key that is.',
    );
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing sent.');
    return;
  }

  const limit = ethers.parseUnits(String(dollars), DECIMALS);
  if (limit === current) {
    console.log(`\nAlready ${usd(limit)}. Nothing to do.`);
    return;
  }
  // Not fatal — lowering a ceiling below what is drawn is legitimate, and existing plans run to
  // term regardless. It is only worth saying out loud, because no new plan will open until the
  // drawn amount falls back under it.
  if (limit < principal) {
    console.log(`\nNote: ${usd(limit)} is below the ${usd(principal)} already drawn.`);
  }

  console.log(
    `\nsetTermLimit(${member}, ${usd(limit)}) as ${signer.address}` +
      (current === 0n
        ? '\nFirst allocation: this also opens the member\'s StableCredit line.'
        : '\nAdjusts the existing StableCredit line in place.'),
  );

  const tx = await issuer.setTermLimit(member, limit);
  console.log(`tx         ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`mined      block ${receipt?.blockNumber}, status ${receipt?.status}`);

  // Read back rather than trusting the receipt: the point of the run is the stored number.
  console.log(`ceiling    ${usd(await issuer.termLimitOf(member))}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
