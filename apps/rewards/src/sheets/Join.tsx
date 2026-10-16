import type { PublicShopApp } from '@clear/merchant-contracts';
import { useState } from 'react';
import { useData } from '../data/context';
import { tileStyle, fontFamily } from '../lib/brand';
import { Sheet } from '../shell/ui';
import { Row, word } from '../screens/parts';

/**
 * Join (section 7): one tap when signed in. What the shop will see and what joining gives; the
 * shop's look starts after.
 */
export function JoinSheet({ shop, onClose, onJoined, orderId }: { shop: PublicShopApp; onClose: () => void; onJoined: () => void; orderId?: string | null }) {
  const data = useData();
  const [offers, setOffers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bonus = shop.earn.joinBonus;
  return (
    <Sheet onClose={onClose}>
      <div className="sa-m sa-center">
        <span className="sa-logo big" style={tileStyle(shop.brand, fontFamily(shop.brand.headingFont, shop.fonts, 'var(--font-display)'))}>
          {shop.brand.monogram}
        </span>
        <p className="sa-big2" style={{ fontFamily: 'var(--font-display)' }}>
          Join {shop.name} Rewards
        </p>
        <p className="det">{shop.pitch}</p>
      </div>
      <div className="sa-m sa-lines" style={{ paddingTop: 0 }}>
        {bonus > 0 ? <Row t="For joining" v={`+${bonus} ${word(shop.pointsName, bonus)}`} /> : null}
        <Row t="They’ll see" det="Your first name, number and what you buy there. Nothing from other shops" v={null} />
        <Row
          t="Texts"
          det={offers ? 'Codes and offers, at most one a week' : 'Codes only, unless you turn offers on'}
          v={<button className={`tg${offers ? ' on' : ''}`} role="switch" aria-checked={offers} aria-label="Offers by text" onClick={() => setOffers(!offers)} />}
        />
      </div>
      <div className="sa-m">
        <button
          className="sa-btn k wide"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await data.join(shop.slug, { texts: offers ? 'codes_and_offers' : 'codes', orderId: orderId ?? null });
              onJoined();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'That didn’t work. Try again.');
              setBusy(false);
            }
          }}
        >
          Join
        </button>
        {error ? <p className="r-err">{error}</p> : null}
      </div>
    </Sheet>
  );
}
