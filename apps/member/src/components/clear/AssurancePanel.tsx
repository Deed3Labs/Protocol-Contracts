import { CFoot, CHead, CMain, Cell, Rows, SecHead } from './brand/anatomy';
import { ChevronIcon, LockIcon, ShieldCheckIcon } from './brand/icons';
import { assuranceStatus, isAssuranceActive, type AssuranceItem } from '@/lib/clearModel';

/**
 * What each protection covers and where it stands — the Assurance pane's cell.
 *
 * The summary on Savings answers "how many do I have"; this answers "what are they", so every row
 * carries its description and either the credits it took or the credits still to go. Locked ones
 * stay legible at 60% rather than greyed to nothing — they're the reason to keep saving. The footer
 * is the way through to what the reserve covers.
 */
export default function AssurancePanel({
  items,
  credits,
  onExplainReserve,
}: {
  items: AssuranceItem[];
  credits: number;
  onExplainReserve?: () => void;
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
                <div className="flex gap-[11px]" style={active ? undefined : { opacity: 0.6 }}>
                  <span className={active ? 'c-t-ast shrink-0 leading-[1.4]' : 'c-muted shrink-0 leading-[1.4]'}>
                    {active ? <ShieldCheckIcon /> : <LockIcon />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sec">{item.name}</p>
                    <p className="c-det mt-[3px]">{item.description}</p>
                    <p className={active ? 'c-det c-pos mt-[5px]' : 'c-det mt-[5px]'}>{assuranceStatus(item, credits)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </Rows>
      </CMain>
      <CFoot>
        <button type="button" className="c-line w-full items-center! text-left" onClick={onExplainReserve}>
          <span className="text-sec">What the assurance reserve covers</span>
          <ChevronIcon size={14} strokeWidth={2} className="shrink-0 text-ink-50" />
        </button>
      </CFoot>
    </Cell>
  );
}
