import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';
import { savingsIntentService } from '../savingsIntentService.js';
import { savingsRelayerService } from '../savingsRelayerService.js';
import { websocketService } from '../websocketService.js';
import { chainProvider } from './provider.js';
import { invalidate } from './readCache.js';

/*
 * Making savings back a credit line.
 *
 * Depositing mints CLRUSD, and that is where it stopped: the registry reads `pledgedOf`, not a
 * member's balance, so five dollars of savings sat there backing nothing and the savings tier
 * stayed at zero. Two calls close it.
 *
 *   pledge(member, SAVINGS, amount)   records the collateral. Operator-only.
 *   pushCapacities(member)            derives the tier ceilings and writes them onto the issuer.
 *
 * Pledging costs a member nothing. Encumbrance is computed from what is *drawn*, not from what is
 * pledged -- `_requiredUnits` returns zero when nothing is drawn -- so savings pledged against an
 * untouched line remain entirely withdrawable. That is what makes pledging on deposit the right
 * default rather than a decision to put in front of somebody: at 100% haircut it is the whole
 * product promise, "borrow against your own money at no cost", and it takes nothing away.
 *
 * Best-effort, and deliberately so. The deposit has already landed on chain by the time this runs;
 * failing the member's deposit because a follow-up write did not go through would be the wrong
 * trade. A pledge that fails leaves the savings real and the line unmoved, which is exactly the
 * state we are already in, and the next deposit or a manual sync repairs it.
 *
 * ## One sync per wallet at a time
 *
 * Both `/gasless/submit` and `/gasless/record` call this, because a deposit takes one route or the
 * other depending on the member's wallet. When one deposit reached both, two syncs ran
 * concurrently on the same operator key: they read the same state, built identical transactions,
 * and collided on the same nonce -- so the two became one transaction, which then ran out of gas
 * because the pledge landed between its gas estimate and its execution. The pledge stuck and the
 * capacity push did not, which is the worst of the three possible outcomes: a member whose
 * collateral is recorded and whose limit does not know about it.
 *
 * Coalesced rather than queued. A second caller for the same wallet joins the first call's promise
 * instead of starting another, which is correct rather than merely safe: both were asking the same
 * question -- "make the pledge match the balance" -- and one answer serves both.
 */

const REGISTRY_ABI = [
  'function pledge(address member, bytes32 kind, uint256 amount)',
  'function release(address member, bytes32 kind, uint256 amount)',
  'function pledgedOf(address, bytes32) view returns (uint256)',
  'function freeCollateralOf(address member, bytes32 kind) view returns (uint256)',
];

const CALCULATOR_ABI = ['function pushCapacities(address member) returns (uint256)'];

/** Kinds as the deploy script writes them — `encodeBytes32String`, not a hash. */
export const SAVINGS_KIND = ethers.encodeBytes32String('SAVINGS');
export const POOL_SHARE_KIND = ethers.encodeBytes32String('POOL_SHARE');
export const BOND_KIND = ethers.encodeBytes32String('BOND');

function chainId(): number {
  const raw = (process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}

/*
 * Which signer moves collateral, said out loud.
 *
 * This used to be decided by absence: a raw key was used if one happened to be in the environment,
 * and the relayer only got a turn when none was. That is the wrong way round for the thing we are
 * trying not to do. It also meant a private key appearing in the environment for any reason --
 * copied in for a one-off script, inherited from another service -- silently took over signing, and
 * nothing anywhere said so.
 *
 * So the mode is explicit and the default is the managed wallet, matching SAVINGS_RELAYER_MODE and
 * SEND_RELAYER_MODE, which have worked that way all along. A raw key is now opt-in: set
 * COLLATERAL_SIGNER_MODE=local_key and it is used, deliberately, by someone who meant it.
 */
type CollateralSignerMode = 'local_key' | 'cdp_server_wallet';

function collateralSignerMode(): CollateralSignerMode {
  const raw =
    process.env.COLLATERAL_SIGNER_MODE?.trim().toLowerCase() ||
    process.env.SAVINGS_RELAYER_MODE?.trim().toLowerCase() ||
    'cdp_server_wallet';
  return raw === 'local_key' ? 'local_key' : 'cdp_server_wallet';
}

function operatorKey(): string | null {
  const raw = (process.env.CREDIT_OPERATOR_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  if (!raw) return null;
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

/**
 * Syncs in flight, by wallet. Module-level because two concurrent HTTP handlers in this process are
 * exactly the case being guarded, and a per-request value cannot see the other request.
 */
const inFlight = new Map<string, Promise<CollateralSyncResult>>();

/**
 * Tell every device this member has open that their figures have changed.
 *
 * The app was guessing: a move triggered three refetches at 3, 8 and 15 seconds, on the hope that
 * the pledge and the capacity push would have landed by then. That is a guess in both directions —
 * it refetches when nothing has changed, and it stops before a slow chain finishes.
 *
 * It is also per-tab. A deposit made on a desktop left a phone showing the old figures until it
 * was reopened, because a `window` event does not leave the window it was dispatched in.
 *
 * This is sent after the writes actually complete, over the socket the app already holds open per
 * wallet — so it is exact, and it reaches every device rather than the one that did the moving.
 */
async function announceChainChanged(wallet: string, kind: string): Promise<void> {
  /*
   * Before the broadcast, not after.
   *
   * Reads are coalesced for a second to survive the burst a single move sets off, and this runs at
   * the one moment that window is dangerous: the figures just changed, and the read this broadcast
   * is about to trigger is precisely the one that must not be answered from before them. Dropping
   * the entry first means the settled read goes to chain, which is the entire point of telling
   * anyone.
   */
  for (const scope of ['credit', 'earn']) invalidate(`${scope}:${wallet.toLowerCase()}:`);
  try {
    const delivered = await websocketService.broadcastToAddress(wallet.toLowerCase(), 'chain:changed', {
      wallet: wallet.toLowerCase(),
      at: new Date().toISOString(),
    });
    /*
     * Logged with the delivery count, because "we broadcast it" and "someone heard it" are
     * different claims and only the second one refreshes anybody's screen. A zero here means the
     * member has no connection registered — the app falls back to its 3/8/15s guesses, which is
     * exactly the "I had to change pages" symptom, and this line is how we tell the two apart
     * instead of reading the code again.
     */
    console.log(`[collateral] chain:changed ${kind} → ${delivered} connection(s) for ${wallet.toLowerCase()}`);
  } catch (error) {
    // Best-effort. The app still has its backoff, so a member on a dead socket gets the old
    // behaviour rather than none.
    console.error('[collateral] broadcast failed', error instanceof Error ? error.message : error);
  }
}

export interface CollateralSyncResult {
  ok: boolean;
  reason?: string;
  pledgedUnits?: string;
  txHash?: string;
}

/**
 * Bring a member's pledged savings in line with what they now hold.
 *
 * Synced to a target rather than incremented by a delta, because a delta assumes every movement
 * came through here. Deposits from a sweep, a redeem that raced this call, a direct transfer --
 * any of those leave an incremented figure describing a balance that no longer exists. Reading
 * the current pledge and moving it to where it should be is idempotent, which also means a retry
 * after a failure is safe.
 *
 * Never releases below what is encumbered: `release` reverts past `freeCollateralOf`, so a member
 * whose savings are backing drawn credit keeps the pledge that is holding it up.
 */
export async function syncSavingsCollateral(
  wallet: string,
  targetUnits: bigint,
): Promise<CollateralSyncResult> {
  return syncCollateralKind(wallet, SAVINGS_KIND, targetUnits);
}

/**
 * The same sync, for any pledged kind.
 *
 * Savings and pool shares differ in where the target comes from and in nothing else — both are an
 * amount the registry values at a flat price, both are pledged by the operator, and both need the
 * capacities pushed afterwards. One implementation so the second tier cannot drift from the first,
 * which is the failure this whole area keeps producing.
 *
 * The in-flight guard is per wallet *and* kind: two kinds syncing at once are different rows and
 * must not deduplicate each other, while two syncs of the same kind are the same work twice.
 */
export async function syncCollateralKind(
  wallet: string,
  kind: string,
  targetUnits: bigint,
): Promise<CollateralSyncResult> {
  const key = `${wallet.trim().toLowerCase()}:${kind}`;
  const running = inFlight.get(key);
  if (running) return running;

  const attempt = runSync(wallet, kind, targetUnits).finally(() => inFlight.delete(key));
  inFlight.set(key, attempt);
  return attempt;
}

/*
 * How a collateral write reaches the chain.
 *
 * A raw operator key when one is configured, and otherwise the relayer this server already signs
 * everything else with. That fallback is the whole point: CREDIT_OPERATOR_PRIVATE_KEY and
 * DEPLOYER_PRIVATE_KEY are not set in the deployed environment, so this returned "no key" before
 * touching the chain and no deposit there has ever pledged collateral or pushed a capacity. The
 * relayer's credentials are already configured and already funded.
 *
 * One signer for the server's writes is also one account to keep in gas and one address to hold
 * OPERATOR_ROLE, rather than three that can each be the one that is empty.
 */
async function sendCollateralTx(
  to: string,
  abi: string[],
  method: string,
  args: unknown[],
): Promise<string> {
  const data = new ethers.Interface(abi).encodeFunctionData(method, args);

  if (collateralSignerMode() === 'local_key') {
    const key = operatorKey();
    /*
     * Asked for a raw key and there is not one: stop.
     *
     * Falling back to the relayer here would be the old behaviour wearing a new name. Someone set
     * this mode on purpose, presumably because the managed wallet was not what they wanted, and
     * quietly using it anyway answers a different question than the one they asked.
     */
    if (!key) {
      throw new Error(
        'COLLATERAL_SIGNER_MODE=local_key but no CREDIT_OPERATOR_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY is set.',
      );
    }
    const provider = chainProvider(chainId());
    const signer = new ethers.Wallet(key, provider);
    const tx = await signer.sendTransaction({ to, data });
    return (await tx.wait())?.hash ?? tx.hash;
  }

  return savingsRelayerService.sendAsRelayer(chainId(), to, data);
}

async function runSync(wallet: string, kind: string, targetUnits: bigint): Promise<CollateralSyncResult> {
  const registryAddress = getContractAddress(chainId(), 'CollateralRegistry');
  const calculatorAddress = getContractAddress(chainId(), 'LimitCalculator');
  if (!registryAddress) return { ok: false, reason: 'no collateral registry on this chain' };

  try {
    const provider = chainProvider(chainId());
    const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, provider);
    const member = ethers.getAddress(wallet);

    const current: bigint = await registry.pledgedOf(member, kind);
    let txHash: string | undefined;

    if (targetUnits > current) {
      txHash = await sendCollateralTx(registryAddress, REGISTRY_ABI, 'pledge', [member, kind, targetUnits - current]);
    } else if (targetUnits < current) {
      // Only what is actually free. The rest is holding up drawn credit and the registry will
      // refuse to let it go -- correctly.
      const free: bigint = await registry.freeCollateralOf(member, kind);
      const wanted = current - targetUnits;
      const amount = wanted < free ? wanted : free;
      if (amount > 0n) {
        txHash = await sendCollateralTx(registryAddress, REGISTRY_ABI, 'release', [member, kind, amount]);
      }
    }

    // Always, even when the pledge did not move: capacities are derived from collateral *and*
    // attestations, so this is also how an off-chain underwriting decision reaches the issuer.
    // Permissionless by design -- a member whose collateral just moved should not wait for an
    // operator to notice.
    if (calculatorAddress) {
      /*
       * Estimated with headroom, not taken at face value.
       *
       * The pledge immediately above changes the very state this call reads, so an estimate is a
       * measurement of the world before the write it follows. Executed after it, the same call
       * writes a *changed* capacity rather than an identical one and costs more -- and a limit set
       * exactly to the estimate runs out of gas and reverts with no reason data, which is what
       * happened. The buffer is on the gas limit only; unused gas is not charged.
       */
      /*
       * pushCapacities is permissionless, so this needs gas and not privilege — which is why the
       * relayer can do it even before it holds OPERATOR_ROLE.
       *
       * The gas buffer that used to live here belonged to a locally-signed transaction. The relayer
       * estimates for itself, and a hand-set limit computed against a different sender is worse than
       * none: an estimate is a measurement of the world before the write it follows, and the pledge
       * immediately above changes the very state this call reads.
       */
      await sendCollateralTx(calculatorAddress, CALCULATOR_ABI, 'pushCapacities', [member]);
    }

    // After the writes, not before: the point is that the figures are already new when a device
    // is told to read them again.
    await announceChainChanged(member, kind);
    return { ok: true, pledgedUnits: targetUnits.toString(), txHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[savings] collateral sync failed for', wallet, message);
    return { ok: false, reason: message };
  }
}

/** Read a member's CLRUSD balance, which is the target the pledge is synced to. */
export async function readSavingsUnits(wallet: string): Promise<bigint | null> {
  const clrusd = getContractAddress(chainId(), 'CLRUSD') || getContractAddress(chainId(), 'ClearUSD');
  if (!clrusd) return null;
  try {
    const provider = chainProvider(chainId());
    const token = new ethers.Contract(clrusd, ['function balanceOf(address) view returns (uint256)'], provider);
    return await token.balanceOf(ethers.getAddress(wallet));
  } catch (error) {
    console.error('[savings] balance read failed for', wallet, error instanceof Error ? error.message : error);
    return null;
  }
}

/** Sync a member's pledge to whatever they currently hold. The whole job, in one call. */
export async function syncSavingsCollateralFromBalance(wallet: string): Promise<CollateralSyncResult> {
  const units = await readSavingsUnits(wallet);
  if (units === null) return { ok: false, reason: 'could not read the savings balance' };
  return syncSavingsCollateral(wallet, units);
}


const POOL_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
];

/**
 * Pledge a member's yield-pool position so it backs their credit line.
 *
 * The pool tier had exactly the hole savings had: a member could hold a position worth real money
 * and the POOL_SHARE tier would read zero, because holding is not pledging. Wired from the start
 * here rather than discovered later.
 *
 * Pledged in **assets, not shares**. The registry values an amount-based pledge at a flat unit
 * price, and a pool share is not worth a dollar — it drifts up as the pool earns. Pledging shares
 * would value the position at its share count, which is a different number that happens to start
 * out close and diverges. `convertToAssets` is what makes them comparable.
 *
 * Synced to the current position, so a withdrawal shrinks the pledge on the same path a deposit
 * grows it, and a retry after a failure is safe.
 */
export async function syncPoolCollateral(wallet: string): Promise<CollateralSyncResult> {
  const pool = getContractAddress(chainId(), 'LendingPool');
  if (!pool) return { ok: false, reason: 'no lending pool on this chain' };

  try {
    const rpc = chainProvider(chainId());
    const contract = new ethers.Contract(pool, POOL_ABI, rpc);
    const shares: bigint = await contract.balanceOf(ethers.getAddress(wallet));
    const assets: bigint = shares === 0n ? 0n : await contract.convertToAssets(shares);
    return syncCollateralKind(wallet, POOL_SHARE_KIND, assets);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[pool] position read failed for', wallet, message);
    return { ok: false, reason: message };
  }
}


const BOND_COLLECTION_ABI = [
  'function getBondIdsByCreator(address creator) view returns (uint256[])',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
];

const REGISTRY_ITEM_ABI = [
  'function pledgeItem(address member, bytes32 kind, uint256 itemId)',
  'function releaseItem(address member, bytes32 kind, uint256 itemId)',
  'function pledgedItemsOf(address member, bytes32 kind) view returns (uint256[])',
];

/**
 * Pledge a member's bonds so they back the BOND tier.
 *
 * Bonds pledge differently from savings and pool shares, and the difference is not cosmetic. They
 * have identity — the registry records *which* bond, because refusing to let it move and valuing
 * it both need to know that — so this is `pledgeItem` per bond rather than one amount. Half a bond
 * is not a thing.
 *
 * It follows that there is no figure to sync toward. The reconciliation is set-shaped: pledge what
 * is held and not yet pledged, release what is pledged and no longer held. Both directions matter,
 * because a bond can leave by transfer, redemption or seizure, and a pledge left behind would
 * value a member's line against something they no longer own.
 *
 * The value comes from `BondValuer`, which the registry calls itself — a bond is worth something
 * different every day, so nothing here computes a price. Registering the valuer is what makes that
 * work, and it is already registered against BOND at a 95% haircut.
 */
export async function syncBondCollateral(wallet: string): Promise<CollateralSyncResult> {
  const registryAddress = getContractAddress(chainId(), 'CollateralRegistry');
  const collectionAddress = getContractAddress(chainId(), 'BurnerBond');
  const calculatorAddress = getContractAddress(chainId(), 'LimitCalculator');
  if (!registryAddress) return { ok: false, reason: 'no collateral registry on this chain' };
  if (!collectionAddress) return { ok: false, reason: 'no bond collection on this chain' };

  try {
    const rpc = chainProvider(chainId());
    const member = ethers.getAddress(wallet);

    const collection = new ethers.Contract(collectionAddress, BOND_COLLECTION_ABI, rpc);
    // Reads only. Writes go through sendCollateralTx, so bonds sign the same way savings do rather
    // than keeping a second path that can be configured differently and break on its own.
    const registry = new ethers.Contract(registryAddress, REGISTRY_ITEM_ABI, rpc);

    // Created is not held: a bond can be transferred, redeemed or seized, and one the member no
    // longer holds backs nothing of theirs.
    const created: bigint[] = await collection.getBondIdsByCreator(member);
    const held = new Set<string>();
    for (const id of created) {
      const balance: bigint = await collection.balanceOf(member, id);
      if (balance > 0n) held.add(id.toString());
    }

    const pledgedIds: bigint[] = await registry.pledgedItemsOf(member, BOND_KIND);
    const pledged = new Set(pledgedIds.map((id) => id.toString()));

    for (const id of held) {
      if (pledged.has(id)) continue;
      await sendCollateralTx(registryAddress, REGISTRY_ITEM_ABI, 'pledgeItem', [member, BOND_KIND, id]);
    }
    for (const id of pledged) {
      if (held.has(id)) continue;
      // `releaseItem` refuses while the bond is holding up drawn credit, which is correct — the
      // member cannot have moved it either.
      try {
        await sendCollateralTx(registryAddress, REGISTRY_ITEM_ABI, 'releaseItem', [member, BOND_KIND, id]);
      } catch {
        // Encumbered, or already gone. Left as it is rather than treated as a failure of the sync.
      }
    }

    if (calculatorAddress) {
      await sendCollateralTx(calculatorAddress, CALCULATOR_ABI, 'pushCapacities', [member]);
    }

    await announceChainChanged(member, 'BOND');
    return { ok: true, pledgedUnits: String(held.size) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[bond] collateral sync failed for', wallet, message);
    return { ok: false, reason: message };
  }
}
