import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSetMobileAction } from '@/components/shell/MobileAction';
import { Btn } from '@/components/clear/brand/anatomy';
import { PlusIcon } from '@/components/clear/brand/icons';
import ConnectedMoveMoney from '@/components/clear/ConnectedMoveMoney';
import ConnectedAutoSave from '@/components/clear/ConnectedAutoSave';
import Modal from '@/components/clear/Modal';
import { SAVINGS_DAY_ONE } from '@/data/clearPlaceholder';
import { count, money } from '@clear/domain';
import { cn } from '@/lib/utils';
import {
  isAssuranceActive,
  ladderSteps,
  savingsTotal,
  VEST_DAYS,
  type AutoSave,
  type SavingsData,
} from '@/lib/clearModel';

/** Credits shown as money take the dollar sign and no decimals: "$1,500". */
const credits$ = (n: number) => money(Math.round(n), { cents: false });

/** "Feb 2028" → "February 2028", for the wide header. Anything else passes through. */
function longMonth(date: string): string {
  const parsed = new Date(`1 ${date}`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** "$1,000.00 a month", "$500.00 every payday", "$100.00 a week". */
function autoSaveRate(a: AutoSave): string {
  const per = a.cadence === 'monthly' ? 'a month' : a.cadence === 'weekly' ? 'a week' : 'every payday';
  return `${money(a.amount, { cents: true })} ${per}`;
}

/** Wide and phone copy for one slot. CSS picks one, so the page never paints the wrong one first. */
function Both({ wide, phone }: { wide: ReactNode; phone: ReactNode }) {
  return (
    <>
      <span className="hidden md:inline">{wide}</span>
      <span className="md:hidden">{phone}</span>
    </>
  );
}

/**
 * Savings, with the home path up front — docs/reference/savings-reference.html.
 *
 * The balance, then one slab of two blocks (Your home path, What you hold), then Protections. The
 * page has four states and none of them is a flag; each falls out of the member's own figures:
 *
 * - Day one: nothing saved and no credits. The header offers Add money; auto-save is offered once,
 *   in the path footer.
 * - Saving: the normal case. One step is next, filled in cobalt to its progress.
 * - Paused: savings are standing behind drawn credit (`backingSpending`, the same secured draw the
 *   cycle card's Top off reads), so the vesting clock is stopped and the next-unlock bar offers Top
 *   off.
 * - Path complete: every protection on. The bar hands off to the Clear Deed.
 *
 * The ladder and the protection chips are the same list (`data.assurance`), so a step and its chip
 * cannot disagree. On a phone the buttons under the balance go: Move money is the nav's action
 * button and auto-save sits behind the path footer's Change.
 */
export default function SavingsPage({ data = SAVINGS_DAY_ONE }: { data?: SavingsData }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [addOpen, setAddOpen] = useState(false);
  const [autoSaveOpen, setAutoSaveOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { savings, autoSave } = data;

  // Moving money is the page's whole point, so it's the mobile action — and reachable from
  // anywhere as /savings?do=add.
  useSetMobileAction({ label: 'Move money', icon: PlusIcon, onSelect: () => setAddOpen(true) });

  useEffect(() => {
    if (params.get('do') !== 'add') return;
    setAddOpen(true);
    params.delete('do');
    setParams(params, { replace: true });
  }, [params, setParams]);

  const total = savingsTotal(savings);
  const steps = ladderSteps(data.assurance, savings.credits);
  const next = steps.find((s) => s.state === 'next');
  const dayOne = total === 0 && savings.credits === 0;
  const backing = data.backingSpending ?? 0;
  const complete = !next;
  const paused = !dayOne && !complete && backing > 0;

  const openAdd = () => setAddOpen(true);
  const openAutoSave = () => setAutoSaveOpen(true);

  /* ---------- balance header ---------- */
  const caption = dayOne ? (
    <Both
      wide="Nothing saved yet · every $1 saved is matched $1 in credits"
      phone="Every $1 saved is matched $1 in credits"
    />
  ) : (
    // The phone drops the clause, as the reference's larger accounts do: at 360 it broke mid-word.
    <Both
      wide={`${money(savings.cash, { cents: true })} in cash · ${count(savings.credits)} credits, matched one-for-one`}
      phone={`${money(savings.cash, { cents: true })} in cash · ${count(savings.credits)} credits`}
    />
  );

  /* ---------- home path ---------- */
  let pathCaption: ReactNode;
  if (dayOne) {
    pathCaption = (
      <span className="c-sv-cap">
        <Both wide="Start saving to see a date" phone="No date yet" />
      </span>
    );
  } else if (complete) {
    pathCaption = (
      <span className="c-sv-cap c-ok">
        <Both wide="Path complete" phone="Complete" />
      </span>
    );
  } else if (paused) {
    pathCaption = <span className="c-sv-cap c-warn">Paused</span>;
  } else if (savings.onTrackFor) {
    pathCaption = (
      <span className="c-sv-cap">
        <Both wide={`On track for ${longMonth(savings.onTrackFor)}`} phone={`On track for ${savings.onTrackFor}`} />
      </span>
    );
  } else {
    pathCaption = <span className="c-sv-cap">No date yet</span>;
  }

  let nextBar: ReactNode = null;
  if (complete) {
    nextBar = (
      <div className="c-sv-next c-ok">
        <span>
          Ready &middot; <b>Your Clear Deed</b>
        </span>
        {/* No ELPA flow exists in the app yet: the hand-off is drawn and waits on it. */}
        <Btn primary disabled title="The ELPA flow isn't built yet">
          Start the ELPA
        </Btn>
      </div>
    );
  } else if (paused) {
    nextBar = (
      <div className="c-sv-next c-warn">
        <span>
          Paused &middot;{' '}
          <Both
            wide={<b>{money(backing, { cents: true })} of your savings is backing spending</b>}
            phone={
              <>
                <b>{money(backing, { cents: true })}</b> backing spending
              </>
            }
          />
        </span>
        {/* The cycle card's Top off: put money back into savings. */}
        <Btn onClick={openAdd}>Top off</Btn>
      </div>
    );
  } else if (next) {
    const toGo = count(next.item.unlocksAt - savings.credits);
    nextBar = (
      <div className="c-sv-next">
        <span>
          <Both
            wide={
              <>
                Next unlock &middot; <b>{next.item.step ?? next.item.name}</b>
              </>
            }
            phone={
              <>
                Next &middot; <b>{next.item.name}</b>
              </>
            }
          />
        </span>
        <span className="c-sv-cap">
          <Both wide={`${toGo} credits to go`} phone={`${toGo} to go`} />
        </span>
      </div>
    );
  }

  let pathFooter: ReactNode;
  if (dayOne) {
    pathFooter = (
      <>
        <span>Not saving yet</span>
        <Btn primary onClick={openAutoSave}>
          Set up auto-save
        </Btn>
      </>
    );
  } else if (autoSave) {
    pathFooter = (
      <>
        <span>
          Saving <b>{autoSaveRate(autoSave)}</b>
          {complete && (
            <>
              <span className="hidden md:inline">{' · '}</span>
              <br className="md:hidden" />
              match complete
            </>
          )}
        </span>
        <Btn onClick={openAutoSave}>Change</Btn>
      </>
    );
  } else {
    // Auto-save has no live source on this page yet, so a member with savings and no rule reads as
    // off rather than as "Saving $0.00".
    pathFooter = (
      <>
        <span>{complete ? 'Match complete' : 'Auto-save is off'}</span>
        <Btn onClick={openAutoSave}>Change</Btn>
      </>
    );
  }

  /* ---------- what you hold ---------- */
  const share = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  const segments = [
    { key: 'cash', pct: share(savings.cash), color: 'var(--vest-cash)' },
    { key: 'vested', pct: share(savings.vested), color: 'var(--vest-vested)' },
    // Nothing vesting drops the segment and its row rather than showing "$0".
    ...(savings.vesting > 0 ? [{ key: 'vesting', pct: share(savings.vesting), color: 'var(--vest-vesting)' }] : []),
  ];
  const holdFooter =
    dayOne || data.creditLine === undefined ? (
      <Both wide="Every $1 saved adds $1 to your credit line" phone="Each $1 saved adds $1 to your line" />
    ) : (
      <>
        Adds <b>{money(data.creditLine, { cents: false })}</b> to your credit line
      </>
    );

  return (
    <div className="c-sv">
      <div className="c-sv-top">
        <div>
          <p className="c-label">Savings</p>
          <p className="c-fig c-sv-total">{money(total, { cents: true })}</p>
          <p className="c-sv-cap">{caption}</p>
        </div>
        <div className="c-sv-acts">
          {dayOne ? (
            <Btn primary className="c-lg" onClick={openAdd}>
              Add money
            </Btn>
          ) : (
            <>
              <Btn className="c-lg" onClick={openAutoSave}>
                Auto-save
              </Btn>
              <Btn primary className="c-lg" onClick={openAdd}>
                Move money
              </Btn>
            </>
          )}
        </div>
      </div>

      <div className="c-sv-slab">
        <section className="c-sv-blk" aria-label="Your home path">
          <div className="c-sv-bh">
            <span className="c-label">Your home path</span>
            {pathCaption}
          </div>
          <div className="c-sv-bm">
            <p className="c-sv-count">
              <span className="c-fig">{count(savings.credits)}</span>
              <span className="c-sv-cap">of {count(savings.creditsGoal)} credits</span>
            </p>
            <ol className="c-sv-ladder" aria-label="Protections unlocked by credits">
              {steps.map(({ item, state, fill }) => (
                <li
                  key={item.id}
                  className={cn(
                    state === 'got' && 'c-got',
                    state === 'next' && 'c-next',
                    state === 'next' && paused && 'c-paused',
                  )}
                >
                  <i aria-hidden="true">{fill > 0 && <b style={{ transform: `scaleX(${fill})` }} />}</i>
                  <em>{item.unlocksAt === 0 ? <Both wide="DAY ONE" phone="DAY 1" /> : count(item.unlocksAt)}</em>
                  <span>
                    <Both wide={item.step ?? item.name} phone={item.stepShort ?? item.name} />
                  </span>
                </li>
              ))}
            </ol>
            {nextBar}
          </div>
          <div className="c-sv-bf">{pathFooter}</div>
        </section>

        <section className="c-sv-blk" aria-label="What you hold">
          <div className="c-sv-bh">
            <span className="c-label">What you hold</span>
            <span className="c-fig">{money(total, { cents: true })}</span>
          </div>
          <div className="c-sv-bm">
            <span className="c-sv-comp" aria-hidden="true">
              {!dayOne &&
                segments.map((s) => <i key={s.key} style={{ flexBasis: `${s.pct}%`, background: s.color }} />)}
            </span>
            <div className="c-sv-rows">
              <div>
                <span className="c-fg">Cash (CLRUSD)</span>
                <span className="c-fg">{money(savings.cash, { cents: true })}</span>
              </div>
              {!dayOne && (
                <div>
                  <span className="c-ok">Vested credits</span>
                  <span className="c-fg">{credits$(savings.vested)}</span>
                </div>
              )}
              {savings.vesting > 0 && (
                <div>
                  <span className="c-warn">{paused ? 'Vesting, paused' : `Vesting, about ${VEST_DAYS} days`}</span>
                  <span className="c-fg">{credits$(savings.vesting)}</span>
                </div>
              )}
            </div>
            {dayOne && <p className="c-sv-note">Your first deposit starts your credits.</p>}
          </div>
          <div className="c-sv-bf">
            <span>{holdFooter}</span>
            <Btn onClick={() => setDetailsOpen(true)}>Details</Btn>
          </div>
        </section>
      </div>

      <section className="c-sv-prot" aria-label="Protections">
        <div className="c-sv-bh">
          <span className="c-label">Protections</span>
          <span className="c-sv-cap">
            <Both wide="Nothing on this list is ever paid back" phone="Never paid back" />
          </span>
        </div>
        {/* Each protection opens the Assurance page, which this list is the way into. */}
        <div className="c-sv-prots">
          {data.assurance.map((item) => {
            const on = isAssuranceActive(item, savings.credits);
            return (
              <button key={item.id} type="button" onClick={() => navigate('/assurance')}>
                <b>{item.name}</b>
                <span>{item.line ?? item.description}</span>
                <span className={cn('c-sv-chip', on && 'c-on')}>{on ? 'On' : count(item.unlocksAt)}</span>
              </button>
            );
          })}
        </div>
      </section>

      <ConnectedMoveMoney data={data} open={addOpen} onOpenChange={setAddOpen} onAutoSave={openAutoSave} />
      <ConnectedAutoSave data={data} open={autoSaveOpen} onOpenChange={setAutoSaveOpen} />
      <HoldDetails data={data} open={detailsOpen} onOpenChange={setDetailsOpen} />
    </div>
  );
}

/** What you hold, in full: the split, and the vesting schedule the old page listed in its own cell. */
function HoldDetails({
  data,
  open,
  onOpenChange,
}: {
  data: SavingsData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { savings } = data;
  const sections = [
    <div key="split" className="c-conseq">
      <div>
        <span>Cash (CLRUSD)</span>
        <span>{money(savings.cash, { cents: true })}</span>
      </div>
      <div>
        <span>Vested credits</span>
        <span>{credits$(savings.vested)}</span>
      </div>
      <div>
        <span>Vesting</span>
        <span>{credits$(savings.vesting)}</span>
      </div>
    </div>,
    ...(data.vesting.length > 0
      ? [
          <div key="schedule" className="c-conseq">
            {data.vesting.map((row) => (
              <div key={row.id}>
                <span>Vests {row.date}</span>
                <span>{count(row.credits)} credits</span>
              </div>
            ))}
          </div>,
        ]
      : []),
    <p key="note" className="c-det">
      Cash is yours to move back out at any time. Credits are matched one-for-one as you save, take{' '}
      {VEST_DAYS} days to vest, and go toward your Clear Deed. They can't be withdrawn.
    </p>,
  ];
  return <Modal open={open} onOpenChange={onOpenChange} title="What you hold" sections={sections} />;
}
