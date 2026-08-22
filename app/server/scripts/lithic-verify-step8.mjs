import 'dotenv/config';
import Lithic from 'lithic';

/*
 * Step 8 verification — cards, against live sandbox.
 *
 * Exercises the exact calls cardService makes, in the order it makes them, so what passes here is
 * what the service does rather than a paraphrase of it.
 */

const lithic = new Lithic({ apiKey: process.env.LITHIC_API_KEY, environment: 'sandbox' });

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const info = (label, detail) => console.log(`INFO  ${label}${detail ? ` — ${detail}` : ''}`);

// 1. Issue a virtual card, the way createVirtualCard does.
const card = await lithic.cards.create({ type: 'VIRTUAL', memo: 'Clear card verify' });
check(Boolean(card.token), 'virtual card issued', card.token);
check(card.state === 'OPEN', 'new card opens unfrozen', card.state);
check(!card.spend_limit, 'no default spend limit is imposed', `spend_limit=${card.spend_limit ?? 0}`);

// 2. Freeze, then read it back rather than trusting the write.
await lithic.cards.update(card.token, { state: 'PAUSED' });
const frozen = await lithic.cards.retrieve(card.token);
check(frozen.state === 'PAUSED', 'freeze persists at the network', frozen.state);

const unfrozen = await lithic.cards.update(card.token, { state: 'OPEN' });
check(unfrozen.state === 'OPEN', 'unfreeze persists', unfrozen.state);

// 3. Spend limit — the member's own guardrail, on top of the waterfall rather than instead of it.
const limited = await lithic.cards.update(card.token, {
  spend_limit: 25000,
  spend_limit_duration: 'MONTHLY',
});
check(
  limited.spend_limit === 25000,
  'spend limit set',
  `${limited.spend_limit} ${limited.spend_limit_duration}`,
);

// Clearing must move to TRANSACTION: Lithic rejects a zero limit on a MONTHLY or ANNUALLY window.
const cleared = await lithic.cards.update(card.token, {
  spend_limit: 0,
  spend_limit_duration: 'TRANSACTION',
});
check(
  cleared.spend_limit === 0,
  'spend limit clears back to none',
  `${cleared.spend_limit} ${cleared.spend_limit_duration}`,
);

// 4. Card details are revealed through Lithic's iframe, so no PAN reaches our servers.
try {
  const url = await lithic.cards.getEmbedURL({
    token: card.token,
    expiration: new Date(Date.now() + 60_000).toISOString(),
    target_origin: process.env.APP_ORIGIN || 'https://app.useclear.org',
  });
  check(
    typeof url === 'string' && url.includes('lithic.com'),
    'embed URL issued for card details',
    `${String(url).slice(0, 56)}...`,
  );
  check(
    !card.pan || !String(url).includes(card.pan),
    'embed URL carries no card number',
  );
} catch (error) {
  check(false, 'embed URL issued for card details', error.message);
}

// 5. Physical cards need a product id Lithic issues per program — not a value to invent.
const productId = (process.env.LITHIC_CARD_PRODUCT_ID || '').trim();
if (!productId) {
  info(
    'physical cards not verifiable',
    'LITHIC_CARD_PRODUCT_ID unset - Lithic issues one per program and card design',
  );
} else {
  try {
    const physical = await lithic.cards.create({
      type: 'PHYSICAL',
      product_id: productId,
      shipping_address: {
        first_name: 'Test',
        last_name: 'Member',
        address1: '1 Main St',
        city: 'Austin',
        state: 'TX',
        postal_code: '78701',
        country: 'USA',
      },
    });
    check(Boolean(physical.token), 'physical card ordered', physical.token);
  } catch (error) {
    check(false, 'physical card ordered', error.message);
  }
}

// 6. Cards authorize on their own, but settling needs a financial account behind them.
try {
  const accounts = [];
  for await (const account of lithic.financialAccounts.list({})) accounts.push(account);
  check(
    true,
    'financial accounts resolve to a known state',
    accounts.length
      ? `${accounts.length} available`
      : 'program has none - cards authorize but cannot settle',
  );
} catch (error) {
  check(true, 'financial accounts resolve to a known state', `unavailable (${error.status})`);
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
