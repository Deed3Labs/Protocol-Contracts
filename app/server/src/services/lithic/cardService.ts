import { getLithic } from './lithicClient.js';
import { lithicStore } from './lithicStore.js';
import { cardStore, type CardRecord } from './cardStore.js';
import { refreshSnapshot, refreshSnapshotsFor } from './snapshotService.js';

/*
 * Cards — spec step 8.
 *
 * Virtual first, physical behind a product id, and every control the member is promised: freeze,
 * unfreeze, spend limits.
 *
 * Two decisions run through the whole file.
 *
 * FULL CARD DATA NEVER TOUCHES THIS SERVER. Lithic will hand back a PAN and CVV on retrieve, and
 * using that would drag this server into PCI scope and put card numbers in every log and error
 * report along the path. Instead the member's browser calls Lithic directly through an embedded
 * iframe, and we only ever mint the short-lived URL for it. Same reasoning as the Stripe Issuing
 * ephemeral key in clearCardService — the difference is only which processor.
 *
 * A NEW CARD GETS A SNAPSHOT BEFORE IT IS USABLE. The auth stream reads snapshots and never derives
 * them, and it fails closed, so a card without one declines every authorization. A member handed a
 * card that declines at the first checkout has been given a worse experience than no card at all.
 */

export const PAUSED = 'PAUSED';
export const OPEN = 'OPEN';

export interface CardView {
  token: string;
  type: string;
  state: string;
  lastFour: string | null;
  memo: string | null;
  spendLimitCents: number;
  spendLimitDuration: string | null;
  /** True when the member has frozen it — the state the card UI toggles. */
  frozen: boolean;
  createdAt: string;
}

function toView(record: CardRecord): CardView {
  return {
    token: record.cardToken,
    type: record.type,
    state: record.state,
    lastFour: record.lastFour,
    memo: record.memo,
    spendLimitCents: record.spendLimitCents,
    spendLimitDuration: record.spendLimitDuration,
    frozen: record.state === PAUSED,
    createdAt: record.createdAt,
  };
}

/**
 * A view built from Lithic's own response, used when the Pay DB is unavailable.
 *
 * The card genuinely exists at this point — refusing to return it because we could not record it
 * would leave the member with a card they cannot see. The mapping is recovered on the next sync.
 */
function viewFromCreated(created: {
  token: string;
  type: string;
  state: string;
  last_four?: string | null;
  memo?: string | null;
  spend_limit?: number | null;
  spend_limit_duration?: string | null;
}): CardView {
  return {
    token: created.token,
    type: created.type,
    state: created.state,
    lastFour: created.last_four ?? null,
    memo: created.memo ?? null,
    spendLimitCents: created.spend_limit ?? 0,
    spendLimitDuration: created.spend_limit_duration ?? null,
    frozen: created.state === PAUSED,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Issue a virtual card.
 *
 * The spend limit is optional and defaults to none, because the tier waterfall is what actually
 * bounds spending. A card-level limit is a member's own guardrail on top of it, not the mechanism —
 * setting a default here would silently cap people below their real availability.
 */
export async function createVirtualCard(
  wallet: string,
  options: { memo?: string; spendLimitCents?: number; spendLimitDuration?: string } = {},
): Promise<CardView> {
  const lithic = getLithic();
  if (!lithic) throw new Error('Lithic not configured');

  const account = await lithicStore.get(wallet);
  if (!account?.accountToken) {
    // Cards belong to an account holder who has passed KYC. Issuing to an unprovisioned member
    // would create a card no compliance record stands behind.
    throw new Error('Member is not provisioned');
  }

  const created = await lithic.cards.create({
    type: 'VIRTUAL',
    account_token: account.accountToken,
    memo: options.memo || 'Clear card',
    ...(options.spendLimitCents
      ? {
          spend_limit: Math.round(options.spendLimitCents),
          spend_limit_duration: (options.spendLimitDuration || 'MONTHLY') as 'MONTHLY',
        }
      : {}),
  });

  const record = await cardStore.upsert({
    cardToken: created.token,
    wallet,
    accountToken: account.accountToken,
    type: created.type,
    state: created.state,
    lastFour: created.last_four ?? null,
    memo: created.memo ?? null,
    spendLimitCents: created.spend_limit ?? 0,
    spendLimitDuration: created.spend_limit_duration ?? null,
  });

  // Before the card can be used, not after: the auth stream fails closed, so a card with no
  // snapshot declines everything. Targeted at this token rather than going through
  // refreshSnapshotsFor, because this card's row is the one that does not exist yet.
  try {
    await refreshSnapshot(wallet, created.token);
  } catch (error) {
    console.error('[cards] snapshot write failed for new card', created.token, error);
  }

  return record ? toView(record) : viewFromCreated(created);
}

/**
 * Order a physical card.
 *
 * Requires `LITHIC_CARD_PRODUCT_ID` — Lithic issues one per program and per card design, and
 * sandbox rejects the request without it. Left unset rather than guessed: a product id controls
 * what is physically printed and mailed to a member's home, which is not a value to invent.
 */
export async function createPhysicalCard(
  wallet: string,
  shipping: {
    firstName: string;
    lastName: string;
    address1: string;
    address2?: string;
    city: string;
    state: string;
    postalCode: string;
    country?: string;
  },
  options: { memo?: string } = {},
): Promise<CardView> {
  const lithic = getLithic();
  if (!lithic) throw new Error('Lithic not configured');

  const productId = (process.env.LITHIC_CARD_PRODUCT_ID || '').trim();
  if (!productId) throw new Error('No card product configured for physical cards');

  const account = await lithicStore.get(wallet);
  if (!account?.accountToken) throw new Error('Member is not provisioned');

  const created = await lithic.cards.create({
    type: 'PHYSICAL',
    account_token: account.accountToken,
    product_id: productId,
    memo: options.memo || 'Clear card',
    shipping_address: {
      first_name: shipping.firstName,
      last_name: shipping.lastName,
      address1: shipping.address1,
      ...(shipping.address2 ? { address2: shipping.address2 } : {}),
      city: shipping.city,
      state: shipping.state,
      postal_code: shipping.postalCode,
      country: shipping.country || 'USA',
    },
  });

  const record = await cardStore.upsert({
    cardToken: created.token,
    wallet,
    accountToken: account.accountToken,
    type: created.type,
    state: created.state,
    lastFour: created.last_four ?? null,
    memo: created.memo ?? null,
  });

  try {
    await refreshSnapshot(wallet, created.token);
  } catch (error) {
    console.error('[cards] snapshot write failed for new card', created.token, error);
  }

  return record ? toView(record) : viewFromCreated(created);
}

export async function listCards(wallet: string): Promise<CardView[]> {
  const records = await cardStore.listFor(wallet);
  return records.map(toView);
}

/**
 * Freeze or unfreeze.
 *
 * The freeze is written to Lithic first and mirrored locally second. If the mirror fails the card
 * is still frozen at the network, which is the direction to be wrong in — a member who froze a card
 * they think is compromised needs it dead at the network, not consistent in our database.
 */
export async function setFrozen(cardToken: string, frozen: boolean): Promise<CardView | null> {
  const lithic = getLithic();
  if (!lithic) throw new Error('Lithic not configured');

  const existing = await cardStore.get(cardToken);
  if (!existing) return null;

  const updated = await lithic.cards.update(cardToken, { state: frozen ? PAUSED : OPEN });
  const record = await cardStore.upsert({
    cardToken,
    wallet: existing.wallet,
    accountToken: existing.accountToken,
    type: existing.type,
    state: updated.state,
    lastFour: existing.lastFour,
    memo: existing.memo,
    spendLimitCents: existing.spendLimitCents,
    spendLimitDuration: existing.spendLimitDuration,
  });

  // The waterfall checks `card_paused` on the snapshot, and it is the snapshot the auth stream
  // reads — a freeze that never reaches it is a freeze that does not stop a charge.
  try {
    await refreshSnapshotsFor(existing.wallet);
  } catch (error) {
    console.error('[cards] snapshot refresh failed after freeze', cardToken, error);
  }

  return record ? toView(record) : null;
}

/**
 * Set or clear the member's own spend limit. Zero clears it.
 *
 * Clearing has to switch the duration to TRANSACTION, because Lithic rejects a zero limit on a
 * MONTHLY or ANNUALLY window outright: "the spend_limit cannot be zero when the
 * spend_limit_duration is MONTHLY or ANNUALLY". Zero on a per-transaction window is how the API
 * spells "no cap", so a member turning their limit off gets that rather than a 422.
 */
export async function setSpendLimit(
  cardToken: string,
  spendLimitCents: number,
  duration: string = 'MONTHLY',
): Promise<CardView | null> {
  const lithic = getLithic();
  if (!lithic) throw new Error('Lithic not configured');

  const existing = await cardStore.get(cardToken);
  if (!existing) return null;

  const limit = Math.max(0, Math.round(spendLimitCents));
  const effectiveDuration = limit === 0 ? 'TRANSACTION' : duration;
  const updated = await lithic.cards.update(cardToken, {
    spend_limit: limit,
    spend_limit_duration: effectiveDuration as 'MONTHLY',
  });

  const record = await cardStore.upsert({
    cardToken,
    wallet: existing.wallet,
    accountToken: existing.accountToken,
    type: existing.type,
    state: updated.state,
    lastFour: existing.lastFour,
    memo: existing.memo,
    spendLimitCents: updated.spend_limit ?? limit,
    spendLimitDuration: updated.spend_limit_duration ?? effectiveDuration,
  });

  return record ? toView(record) : null;
}

/**
 * A short-lived URL that renders the PAN and CVV in Lithic's iframe.
 *
 * The member's browser fetches this URL directly from Lithic. Nothing sensitive passes through this
 * server, which is the entire point — a card number that never arrives here cannot be logged,
 * cached, or leaked from here.
 *
 * `targetOrigin` must be our own app origin so the embedded page will not render inside someone
 * else's site.
 */
export async function getCardEmbedUrl(cardToken: string, expirationSeconds = 60): Promise<string> {
  const lithic = getLithic();
  if (!lithic) throw new Error('Lithic not configured');

  const targetOrigin = (process.env.APP_ORIGIN || process.env.FRONTEND_URL || '').trim();
  if (!targetOrigin) throw new Error('APP_ORIGIN must be set to embed card details');

  return lithic.cards.getEmbedURL({
    token: cardToken,
    expiration: new Date(Date.now() + expirationSeconds * 1000).toISOString(),
    target_origin: targetOrigin,
  });
}

export const cardService = {
  createVirtualCard,
  createPhysicalCard,
  listCards,
  setFrozen,
  setSpendLimit,
  getCardEmbedUrl,
};
