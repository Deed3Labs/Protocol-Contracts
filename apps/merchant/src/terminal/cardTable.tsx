import { Chip } from '@/brand/controls';
import { Sheet } from '@/brand/ui';
import { R2, Rows } from '@/settings/views';
import type { TableReaderState } from '@/reader/tables';

/**
 * Card · Table 12 (the Pay case addendum, 13b): taking a card on a table's own reader. Connecting,
 * then ready; and "Table 4 is also paying by card" when another table waits its turn.
 */
export function CardTableSheet({
  table,
  reader,
  amountCents,
  state,
  waiting,
  onClose,
}: {
  table: string;
  reader: string;
  amountCents: number;
  state: TableReaderState;
  waiting: string[];
  onClose: () => void;
}) {
  const connecting = state.phase === 'connecting';
  return (
    <Sheet className="c-st-sheet c-tm-sheet c-w460" title={`Card · ${table}`} onClose={onClose} foot={<p className="c-det">Lets go of the reader when the payment is done.</p>}>
      <div className="c-ci-sum">
        <div className="c-ci-hero">
          <p className="c-label">Card on {table}’s reader</p>
          <p className="c-f">${(amountCents / 100).toFixed(2)}</p>
        </div>
      </div>
      <Rows>
        <R2
          t={connecting ? `Connecting to ${reader}` : `Connected to ${reader}`}
          det={connecting ? 'A few seconds. Started when the bill was sent' : 'Ready for the card'}
          end={
            connecting ? (
              <Chip tone="underway" dot>
                Connecting
              </Chip>
            ) : (
              <Chip tone="settled" dot>
                Ready
              </Chip>
            )
          }
        />
        <R2 t="Then" det={`Tap, insert or swipe on ${table}. The Point shows the amount`} end={null} />
        {waiting.map((w) => (
          <R2 key={w} t={`${w} is also paying by card`} det={`Waits until ${table} is done, or take it on another device`} end={<Chip tone="neutral">Next</Chip>} />
        ))}
      </Rows>
    </Sheet>
  );
}
