import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHECKOUT = readFileSync(join(import.meta.dir, 'checkout.tsx'), 'utf8');
const PAGE = readFileSync(join(import.meta.dir, '../pages/NewChargePage.tsx'), 'utf8');

/*
 * Cash goes only into an open drawer (the server refuses it otherwise, `drawer_closed`), so the Cash
 * tile waits for today's drawer to be opened on Home, drawn locked the way Card waits for Stripe.
 */
describe('cash waits for the drawer', () => {
  test('the tile is locked, with where to open it', () => {
    expect(CHECKOUT).toContain("cash: ['Cash', locked ? 'Open the drawer on Home to take cash' : 'Enter what they hand over, see the change'");
    expect(CHECKOUT).toContain("locked={(m === 'card' && cardLocked) || (m === 'cash' && cashLocked)}");
  });

  test('locked only when the drawer is known not to be open; unread (offline), cash stays open', () => {
    expect(PAGE).toContain("cashLocked={preview ? params.get('screen') === 'checkout-nodrawer' : !liveDrawer.loading && !liveDrawer.error && liveDrawer.data?.status !== 'open'}");
  });

  test('read again each time checkout opens, so a drawer opened meanwhile counts', () => {
    expect(PAGE).toContain("const liveDrawer = useApi(() => (preview ? Promise.resolve(null) : merchant.drawer()), [preview, f.screen === 'checkout']);");
  });
});
