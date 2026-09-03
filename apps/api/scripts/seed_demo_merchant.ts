/*
 * Creates one merchant end to end, for testing the counter against the demo.
 *
 * There is no self-serve path to a working shop and there should not be: registering a merchant
 * sets its terms — rate, approval cap, payout window — and those come from a signed agreement, so
 * `registerMerchant` is `onlyRole(OPERATOR_ROLE)`. Onboarding creates the organization and Clear's
 * own records; a human with the operator key completes it. This script is that human's half plus
 * the onboarding half, run together, so a shop exists to test with.
 *
 * It reuses the API's own services rather than reimplementing them. A seeding script that writes
 * its own rows is a script that drifts from the product and then lies about it.
 *
 * Run it with the environment the API itself uses:
 *
 *   railway run -- bun apps/api/scripts/seed_demo_merchant.ts
 *
 * The deployer key comes from the local .env (hardhat's DEPLOYER_PRIVATE_KEY); everything else —
 * database, Privy credentials — comes from Railway, so no secret is copied anywhere to run this.
 */
import { ethers } from 'ethers';
import { PrivyClient } from '@privy-io/node';
import { createMerchantOrg, saveMerchantOrg } from '../src/services/merchant/privyOrg.js';
import { merchantProfileStore } from '../src/services/merchant/profileStore.js';
import { staffStore } from '../src/services/merchant/staffStore.js';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL || 'kyngkai909@gmail.com';
const SHOP_NAME = process.env.SEED_SHOP_NAME || 'Clear Demo Shop';
const OWNER_NAME = process.env.SEED_OWNER_NAME || 'Kai M.';
const OWNER_PIN = process.env.SEED_OWNER_PIN || '4821';

const REGISTRY = process.env.MERCHANT_REGISTRY_84532 || '0x4172842Ab5B1675a9E7F65B4eAcb2CC3f6b2f1f5';
const RPC = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
/** 2.5% and a $2,000 ceiling — the terms every figure in the reference is computed from. */
const DISCOUNT_BPS = 250;
const APPROVAL_CAP_UNITS = 2_000_000000n; // 6dp
const PAYOUT_WINDOW = 0; // registry default

const REGISTRY_ABI = [
  'function registerMerchant(address merchant, uint32 payoutWindow, uint256 approvalCap, uint256 discountBps)',
  'function isRegistered(address) view returns (bool)',
  'function isActive(address) view returns (bool)',
];

async function main() {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) throw new Error('PRIVY_APP_ID and PRIVY_APP_SECRET are required');

  // The owner is an EXISTING Privy user. Creating a second identity for somebody who already has
  // one is how a person ends up unable to sign in to their own shop — the org's key quorum names
  // a user id, and it has to be the one they actually authenticate as.
  const privy = new PrivyClient({ appId, appSecret });
  const user = await privy.users().getByEmailAddress({ address: OWNER_EMAIL });
  if (!user?.id) throw new Error(`No Privy user for ${OWNER_EMAIL}. Sign in once, then re-run.`);
  console.log(`owner        ${OWNER_EMAIL}  ->  ${user.id}`);

  /**
   * Resumable, because the expensive half cannot be undone.
   *
   * An organization and its wallet are permanent — a wallet's entity cannot be changed once set
   * and there is no delete — so a run that fails at the database must not create a second one on
   * the next attempt. Pass the three ids back in and it picks up where it stopped.
   */
  const org =
    process.env.SEED_ORG_ID && process.env.SEED_WALLET_ID && process.env.SEED_WALLET_ADDRESS
      ? {
          organizationId: process.env.SEED_ORG_ID,
          walletId: process.env.SEED_WALLET_ID,
          walletAddress: process.env.SEED_WALLET_ADDRESS,
          keyQuorumId: process.env.SEED_QUORUM_ID ?? '',
        }
      : await createMerchantOrg({ displayName: SHOP_NAME, ownerPrivyUserId: user.id });
  if (!org) throw new Error('could not create the organization at Privy');
  const merchant = org.walletAddress.trim().toLowerCase();
  console.log(`organization ${org.organizationId}`);
  console.log(`wallet       ${org.walletAddress}   <- this IS the merchant address`);

  await merchantProfileStore.create({ merchant, name: SHOP_NAME, category: 'Auto & tires', town: 'Redlands, CA' });
  await saveMerchantOrg(merchant, org);

  const owner = await staffStore.add({ merchant, name: OWNER_NAME, role: 'owner', secret: OWNER_PIN });
  if (!owner) throw new Error('could not create the owner staff row — is the merchant database reachable?');
  await staffStore.linkPrivyUser(owner.id, user.id);
  console.log(`owner row    ${owner.id} (PIN ${OWNER_PIN})`);

  // The operator half. Without this the counter raises a charge and the registry says the shop is
  // not active, which is the correct refusal and a confusing one to debug.
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  const provider = new ethers.JsonRpcProvider(RPC);

  // Registration is checked before the key is demanded. Writing Clear's own rows and registering
  // on chain are separate acts, and re-running this to seed a second database should not require
  // an operator key to do work that is already done.
  const readOnly = new ethers.Contract(REGISTRY, REGISTRY_ABI, provider);
  const already = await readOnly.isRegistered(merchant);
  if (!already && !key) {
    throw new Error('DEPLOYER_PRIVATE_KEY is required to register a merchant that is not yet registered');
  }
  const registry = key ? new ethers.Contract(REGISTRY, REGISTRY_ABI, new ethers.Wallet(key, provider)) : readOnly;

  if (already) {
    console.log('registry     already registered');
  } else {
    const tx = await registry.registerMerchant(merchant, PAYOUT_WINDOW, APPROVAL_CAP_UNITS, DISCOUNT_BPS);
    console.log(`registry     registering... ${tx.hash}`);
    await tx.wait();
  }
  // Re-read with retries. The public RPC is load balanced, so a read issued immediately after a
  // confirmed transaction can land on a node that has not caught up and report the shop inactive —
  // which is alarming, wrong, and exactly the sort of thing somebody would spend an hour debugging.
  let active = false;
  for (let i = 0; i < 5 && !active; i += 1) {
    active = await registry.isActive(merchant);
    if (!active) await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`registry     active: ${active}  cap $2,000  rate 2.5%`);
  console.log('\nSign in at /onboarding is not needed — the shop exists. Open the merchant app,');
  console.log('choose "Sign in as the owner", use this email, then enrol the tablet.');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('\nfailed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
