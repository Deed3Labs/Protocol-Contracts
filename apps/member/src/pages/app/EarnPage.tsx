import { useState } from 'react';
import { useSetMobileAction } from '@/components/shell/MobileAction';
import { Bar, CHead, Cell } from '@/components/clear/brand/anatomy';
import { PlusIcon } from '@/components/clear/brand/icons';
import YieldPoolCard from '@/components/clear/YieldPoolCard';
import HeldBondsCard from '@/components/clear/HeldBondsCard';
import BondLadder from '@/components/clear/BondLadder';
import ConnectedBuyBond from '@/components/clear/ConnectedBuyBond';
import ConnectedPoolMove from '@/components/clear/ConnectedPoolMove';
import type { MoveDirection } from '@/components/clear/MoveMoneyDialog';
import { EARN_DAY_ONE } from '@/data/clearPlaceholder';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { money, signedMoney } from '@clear/domain';
import { assetBackedLimit, bondsTotal, earningTotal, type EarnData } from '@/lib/clearModel';

/** A stat tile: a label and a figure, which is exactly a header — so it has no main and no footer. */
function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <Cell className="c-stat">
      <CHead>
        <p className="c-label">{label}</p>
        <p className={positive ? 'c-fig c-fig-sec c-pos' : 'c-fig c-fig-sec'}>{value}</p>
      </CHead>
    </Cell>
  );
}

/**
 * Earn — a variable pool you can leave any time, and fixed-term bonds that lock until maturity.
 *
 * Hero on paper: what is earning, its bar (pool underway because it is variable, bonds settled
 * because they are fixed), the key, and a rule and a line on the page's whole argument — locked does
 * not mean unavailable.
 *
 * Then the slab, pool first, then buying a bond, then the bonds you own. Each column opens with a
 * stat tile; owned bonds are the only thing here that grows, so they take the full width at the
 * bottom. The phone keeps the same cells and order, the two stats side by side, and puts Buy on the
 * nav's action button.
 */
export default function EarnPage({ data = EARN_DAY_ONE }: { data?: EarnData }) {
  const desktop = useIsDesktop();
  const [buyOpen, setBuyOpen] = useState(false);
  const [poolOpen, setPoolOpen] = useState<MoveDirection | null>(null);
  const total = earningTotal(data);
  const inBonds = bondsTotal(data.bonds);
  const share = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  useSetMobileAction({ label: 'Buy', icon: PlusIcon, onSelect: () => setBuyOpen(true) });

  const earned = <Stat label={desktop ? 'Earned to date' : 'Earned'} value={signedMoney(data.earnedToDate)} positive />;
  const backs = (
    <Stat label={desktop ? 'Backs your limit' : 'Backs limit'} value={money(assetBackedLimit(data), { cents: true })} />
  );
  const pool = (
    <YieldPoolCard data={data} onDeposit={() => setPoolOpen('deposit')} onWithdraw={() => setPoolOpen('withdraw')} />
  );
  const ladder = <BondLadder terms={data.terms} ltv={data.bondLtv} onBuy={() => setBuyOpen(true)} />;
  const bonds = <HeldBondsCard data={data} />;

  return (
    <>
      <div className="mb-s3">
        <p className="c-label mb-s1">Earning</p>
        <p className="c-fig text-hero-m leading-[1.05] lg:text-hero">{money(total, { cents: true })}</p>
        <Bar
          className="mt-s2"
          label="Earning by product: yield pool, bonds"
          segments={[
            { label: 'Yield pool', pct: share(data.pool.position), color: 'var(--tier-income)' },
            { label: 'BurnerBonds', pct: share(inBonds), color: 'var(--tier-savings)' },
          ]}
        />
        <p className="c-keyline">
          <span className="c-t-inc">{desktop ? 'Yield pool' : 'Pool'}</span>{' '}
          <strong>{money(data.pool.position, { cents: true })}</strong>
          <span className="c-sep">&middot;</span>
          <span className="c-t-sav">{desktop ? 'BurnerBonds' : 'Bonds'}</span> <strong>{money(inBonds, { cents: true })}</strong>
        </p>
        <p className="c-det mt-s2 border-t border-ink-13 pt-s2">
          Locked does not mean unavailable. Both products back your credit line at under 1% a cycle.
        </p>
      </div>

      {desktop ? (
        <div className="c-slab c-earn">
          <div className="c-col">
            {earned}
            {pool}
          </div>
          <div className="c-col">
            {backs}
            {ladder}
          </div>
          {bonds}
        </div>
      ) : (
        <div className="c-slab">
          {earned}
          {backs}
          {pool}
          {ladder}
          {bonds}
        </div>
      )}

      <ConnectedBuyBond open={buyOpen} onOpenChange={setBuyOpen} />
      <ConnectedPoolMove
        open={poolOpen !== null}
        initialDirection={poolOpen ?? 'deposit'}
        onOpenChange={(o) => !o && setPoolOpen(null)}
      />
    </>
  );
}
