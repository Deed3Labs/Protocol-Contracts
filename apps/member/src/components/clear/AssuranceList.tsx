import { CFoot, CHead, CMain, Cell, Line, Rows, SecHead } from './brand/anatomy';
import { ChevronIcon, LockIcon, ShieldCheckIcon } from './brand/icons';
import { isAssuranceActive, type AssuranceItem } from '@/lib/clearModel';

/**
 * Assurance on Savings — the protections saving unlocks, and how many are on.
 *
 * Locked rows say Locked rather than counting down credits: the countdown lives on the path, and
 * repeating it here made the cell read as a second progress tracker. The 2 of 5 counter is quiet —
 * the cobalt on this page belongs to the current milestone. The footer says who backs it and is the
 * way through to the Assurance pane, where each protection is explained.
 */
export default function AssuranceList({
  items,
  credits,
  onOpen,
}: {
  items: AssuranceItem[];
  credits: number;
  onOpen?: () => void;
}) {
  const activeCount = items.filter((i) => isAssuranceActive(i, credits)).length;

  return (
    <Cell>
      <CHead>
        <SecHead label="Assurance">
          <span className="c-det">
            {activeCount} of {items.length} active
          </span>
        </SecHead>
      </CHead>
      <CMain>
        <Rows>
          {items.map((item) => {
            const active = isAssuranceActive(item, credits);
            return (
              <div key={item.id}>
                <Line className="items-center!" style={active ? undefined : { opacity: 0.6 }}>
                  <span className="flex items-center gap-[9px] text-detail">
                    <span className={active ? 'c-t-ast' : 'c-muted'}>{active ? <ShieldCheckIcon /> : <LockIcon />}</span>
                    {item.name}
                  </span>
                  <span className={active ? 'c-det c-pos' : 'c-det'}>{active ? 'Active' : 'Locked'}</span>
                </Line>
              </div>
            );
          })}
        </Rows>
      </CMain>
      <CFoot>
        <Line className="items-center!">
          <span className="c-det">Backed by the assurance reserve</span>
          <button type="button" className="c-det flex items-center gap-1 hover:text-ink" onClick={onOpen}>
            See all
            <ChevronIcon />
          </button>
        </Line>
      </CFoot>
    </Cell>
  );
}
