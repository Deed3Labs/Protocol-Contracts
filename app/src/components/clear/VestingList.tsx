import Card from './Card';
import { count } from '@/lib/money';
import type { VestingRow } from '@/lib/clearModel';

/** Credits vesting — design spec §5. Dated future rows, nothing retrospective. */
export default function VestingList({ rows }: { rows: VestingRow[] }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="mb-2 text-[13px] text-foreground-secondary">Credits vesting</p>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing vesting yet — credits start vesting after your first deposit.
        </p>
      ) : (
        <div className="text-xs leading-[1.95]">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{row.date}</span>
              <span className="tabular-nums">{count(row.credits)} credits</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
