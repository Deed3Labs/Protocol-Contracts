import Card from '@/components/clear/Card';
import SettingRows from '@/components/clear/SettingRows';
import { money } from '@/lib/money';
import type { Patronage } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Patronage — the co-op's surplus coming back to members.
 *
 * The first line does the work, because the intuition is wrong: this is
 * proportional to how much you *used* the co-op, not how much you saved in it.
 * Saving raises your limit and your progress toward a home; it doesn't raise your
 * patronage. Two mechanisms that people otherwise assume are one.
 */
export default function PatronagePanel({
  patronage,
  onExplain,
}: {
  patronage: Patronage;
  onExplain?: () => void;
}) {
  return (
    <>
      <p className="mb-3.5 text-xs leading-relaxed text-foreground-secondary">
        Surplus the co-op doesn&rsquo;t reinvest is returned to members in proportion to how much
        they used it — not how much they saved.
      </p>

      <Card className="mb-4">
        <div className="text-xs leading-[2]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-foreground-secondary">{patronage.fiscalYear}</span>
            <span className="text-muted-foreground">{patronage.status}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-foreground-secondary">Your patronage basis</span>
            <span className="tabular-nums">{money(patronage.basis)} of activity</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-foreground-secondary">Declared to date</span>
            <span className="tabular-nums">
              {patronage.declared === undefined ? '—' : money(patronage.declared)}
            </span>
          </div>
        </div>
      </Card>

      <p className="mb-1.5 text-[11px] text-foreground-secondary">History</p>
      {patronage.history.length === 0 ? (
        <Card>
          <p className="text-xs leading-relaxed text-muted-foreground">
            No distributions yet. The first would follow the {patronage.fiscalYear} close.
          </p>
        </Card>
      ) : (
        <div className="text-[13px]">
          {patronage.history.map((row, i) => (
            <div
              key={row.id}
              className={cn(
                'flex items-baseline justify-between gap-3 py-2.5',
                i < patronage.history.length - 1 && 'border-b-[0.5px] border-border',
              )}
            >
              <span>{row.year}</span>
              <span className="tabular-nums text-tier-savings-fg">{money(row.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <SettingRows
        className="mt-3.5 border-t-[0.5px] border-border pt-1"
        rows={[{ label: 'How patronage is calculated', onSelect: onExplain }]}
      />
    </>
  );
}
