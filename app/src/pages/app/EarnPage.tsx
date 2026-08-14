import { useState } from 'react';
import PageHeader from '@/components/clear/PageHeader';
import YieldPoolCard from '@/components/clear/YieldPoolCard';
import BurnerBondsCard from '@/components/clear/BurnerBondsCard';
import HeldBondsCard from '@/components/clear/HeldBondsCard';
import BuyBondDialog from '@/components/clear/BuyBondDialog';
import PoolDepositDialog from '@/components/clear/PoolDepositDialog';
import { EARN_IN_USE } from '@/data/clearPlaceholder';
import { money, signedMoney } from '@/lib/money';
import { bondsTotal, earningTotal, type EarnData } from '@/lib/clearModel';

/**
 * Earn — design spec §6. Two products with deliberately different visual
 * languages: a variable pool you can leave at any time, and fixed-term bonds
 * that lock until maturity.
 *
 * The header adds them up, because from the member's side it's one pile of money
 * that's working; the split line underneath is what says the two halves behave
 * differently.
 */
export default function EarnPage({ data = EARN_IN_USE }: { data?: EarnData }) {
  const [buyOpen, setBuyOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const inBonds = bondsTotal(data.bonds);

  return (
    <>
      <PageHeader
        label="Earning"
        value={money(earningTotal(data))}
        sub={
          <>
            {money(data.pool.position)} in the pool
            <span className="px-1.5">+</span>
            {money(inBonds)} in bonds
          </>
        }
        trailingInline
        trailing={
          <div className="text-right">
            <p className="mb-1 text-xs text-foreground-secondary">Earned to date</p>
            <p className="font-display text-xl font-medium leading-none text-tier-savings-fg">
              {signedMoney(data.earnedToDate)}
            </p>
          </div>
        }
      />

      {/* Bonds get the wider column — the ladder has three values per row. The
          cards stretch to a common height, with the pool's actions pinned to the
          bottom, so the two products read as a matched pair rather than a list. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <YieldPoolCard pool={data.pool} onDeposit={() => setDepositOpen(true)} />
        <BurnerBondsCard terms={data.terms} bonds={data.bonds} onBuy={() => setBuyOpen(true)} />
        <HeldBondsCard bonds={data.bonds} className="lg:hidden" />
      </div>

      <BuyBondDialog data={data} open={buyOpen} onOpenChange={setBuyOpen} />
      <PoolDepositDialog data={data} open={depositOpen} onOpenChange={setDepositOpen} />
    </>
  );
}
