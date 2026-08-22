import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSetMobileAction } from '@/components/shell/MobileAction';
import Card from '@/components/clear/Card';
import SegmentedBar from '@/components/clear/SegmentedBar';
import InfoBlock from '@/components/clear/InfoBlock';
import YieldPoolCard from '@/components/clear/YieldPoolCard';
import HeldBondsCard from '@/components/clear/HeldBondsCard';
import BondLadder from '@/components/clear/BondLadder';
import BuyBondDialog from '@/components/clear/BuyBondDialog';
import PoolDepositDialog from '@/components/clear/PoolDepositDialog';
import PoolWithdrawDialog from '@/components/clear/PoolWithdrawDialog';
import { EARN_DAY_ONE, HOME_DAY_ONE } from '@/data/clearPlaceholder';
import { money, signedMoney } from '@/lib/money';
import { assetBackedLimit, bondsTotal, earningTotal, type EarnData } from '@/lib/clearModel';

/**
 * Earn — design spec §6. Two products with deliberately different visual
 * languages: a variable pool you can leave at any time, and fixed-term bonds
 * that lock until maturity.
 *
 * The page is organised around one claim: locking money up doesn't cost you
 * access to it. So the header pairs what's been earned with what the positions
 * back on the credit line, the note under it says why, and each position card
 * repeats its own backing figure. Buying comes last — you decide whether to lock
 * more money up only after seeing what locking it up actually costs you.
 */
export default function EarnPage({ data = EARN_DAY_ONE }: { data?: EarnData }) {
  const [buyOpen, setBuyOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const total = earningTotal(data);
  const inBonds = bondsTotal(data.bonds);

  useSetMobileAction({ label: 'Buy', icon: Plus, onSelect: () => setBuyOpen(true) });

  const stats = (
    <div className="grid grid-cols-2 gap-3">
      <Card className="px-3.5 py-3">
        <p className="mb-1 text-xs text-foreground-secondary">
          Earned<span className="hidden lg:inline"> to date</span>
        </p>
        <p className="font-display text-xl font-medium leading-none text-tier-savings-fg">
          {signedMoney(data.earnedToDate)}
        </p>
      </Card>
      <Card className="px-3.5 py-3">
        <p className="mb-1 text-xs text-foreground-secondary">
          Backs <span className="hidden lg:inline">your </span>limit
        </p>
        <p className="font-display text-xl font-medium leading-none">
          {money(assetBackedLimit(data), { cents: true })}
        </p>
      </Card>
    </div>
  );

  return (
    <>
      <div className="mb-4 grid items-end gap-4 lg:mb-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
        <div>
          <p className="mb-1 text-xs text-foreground-secondary">Earning</p>
          <p className="font-display mb-2.5 text-[32px] font-medium leading-none tracking-[-0.5px] lg:text-[38px] lg:tracking-[-0.8px]">
            {money(total, { cents: true })}
          </p>

          <SegmentedBar
            className="mb-2"
            total={total}
            label="Earning by product"
            segments={[
              { value: data.pool.position, className: 'bg-tier-boost', label: 'Yield pool' },
              { value: inBonds, className: 'bg-tier-savings', label: 'BurnerBonds' },
            ]}
          />

          <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-tier-boost" />
              Yield pool
              <span aria-hidden className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-tier-savings" />
              BurnerBonds
            </span>
            <span className="tabular-nums">
              {money(data.pool.position, { cents: true })} · {money(inBonds, { cents: true })}
            </span>
          </div>
        </div>

        {stats}
      </div>

      {/* One line, and it's the page's whole argument: locking money up doesn't cost you access to
          it. Everything below is read in its light. */}
      <InfoBlock className="mb-4">
        Locked doesn't mean unavailable — both<span className="hidden lg:inline"> products</span>{' '}
        back your credit line at under 1% a cycle.
      </InfoBlock>

      <p className="mb-2.5 text-[13px] text-foreground-secondary">Your positions</p>
      <div className="mb-5 grid items-start gap-3 lg:grid-cols-2">
        <YieldPoolCard
          data={data}
          onDeposit={() => setDepositOpen(true)}
          onWithdraw={() => setWithdrawOpen(true)}
        />
        <HeldBondsCard data={data} />
      </div>

      <p className="mb-2.5 text-[13px] text-foreground-secondary">Buy a bond</p>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* The ladder carries its own action on mobile; on desktop it belongs with
            the note that explains why the longest term is worth considering. */}
        <BondLadder
          terms={data.terms}
          onBuy={() => setBuyOpen(true)}
          showBuy
          className="lg:hidden"
        />
        <BondLadder terms={data.terms} className="hidden lg:block" />

        <Card className="hidden lg:block">
          <p className="mb-2 text-xs text-foreground-secondary">Longer terms pay more</p>
          <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
            Locked until maturity, but backs {Math.round(data.bondLtv * 100)}% of its value as
            credit.
          </p>
          <Button size="sm" className="w-full text-xs" onClick={() => setBuyOpen(true)}>
            Buy a bond
          </Button>
        </Card>
      </div>

      <BuyBondDialog data={data} open={buyOpen} onOpenChange={setBuyOpen} />
      <PoolDepositDialog data={data} open={depositOpen} onOpenChange={setDepositOpen} />
      {/* The limit it quotes comes from Home's own tiers, so the drop it shows is
          the drop that would actually happen. */}
      <PoolWithdrawDialog
        data={data}
        credit={HOME_DAY_ONE.credit}
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
      />
    </>
  );
}
