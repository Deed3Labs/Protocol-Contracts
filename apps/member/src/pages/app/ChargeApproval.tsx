import { ArrowLeft } from 'lucide-react';
import { SplitConsequences, SplitControl } from '@/components/clear/SplitChooser';
import BigAmount from '@/components/clear/brand/BigAmount';
import { Btn, CFoot, CHead, CMain, Line } from '@/components/clear/brand/anatomy';
import { ChevronIcon, CloseIcon } from '@/components/clear/brand/icons';
import { Tick } from '@/components/clear/MoveProgress';
import { splitQuote } from '@/lib/clearModel';
import { money } from '@clear/domain';

/**
 * A charge arrives — split pay's first state, the member side.
 *
 * What a member sees after scanning the shop's code, before any plan exists. The same shell and split
 * control as changing a split later, with three differences because nothing has happened yet: **the
 * amount is the hero**, **the limit and clears-from row appears** — this is the moment a member most
 * wants to check both — and the button approves rather than saves. The two footnote lines answer the
 * only two questions at a counter: have I been charged, and how long do I have.
 *
 * **The split is chosen here, on the member's phone, and nowhere else.** A service writer must not be
 * picking somebody's repayment terms, which is why the merchant's request carries an amount and a
 * member and nothing about repayment.
 *
 * Presentational, like the onboarding flows. `ChargeApprovalRoute` fetches, approves and declines.
 */

export interface ChargeApprovalProps {
  merchantName: string;
  /** Whole units, not cents — `money` and the split control both work in units. */
  amount: number;
  splitInto: number;
  onSplitChange: (splitInto: number) => void;
  splitOptions?: number[];
  ratePerCycle?: number;
  rate?: string;
  /** Null while unread — the cell says so rather than inventing a figure. */
  perCycleLimit?: number | null;
  clearsFromLabel?: string;
  firstPaymentOn?: string;
  doneBy: (splitInto: number) => string;
  busy?: boolean;
  error?: string | null;
  onApprove: () => void;
  /** The sheet's close. Closing a charge at the counter is declining it for now. */
  onDecline: () => void;
  onBack?: () => void;
  /** Set once approved — the screen becomes the confirmation rather than navigating away. */
  approved?: boolean;
  /**
   * The charge's code, shown as a way into the installed app — set only where the platform will
   * not open it for us. Null everywhere else, including inside the app itself, where the line
   * would be telling somebody to go where they already are.
   */
  appHandoffCode?: string | null;
}

export default function ChargeApproval({
  merchantName,
  amount,
  splitInto,
  onSplitChange,
  splitOptions = [1, 2, 4, 12],
  ratePerCycle = 0.02,
  perCycleLimit = null,
  clearsFromLabel = 'Balance only',
  firstPaymentOn,
  doneBy,
  busy = false,
  error = null,
  onApprove,
  onDecline,
  onBack,
  approved = false,
  appHandoffCode = null,
}: ChargeApprovalProps) {
  /*
   * Full width on a phone, capped only where a phone-shaped column stops making sense. This route
   * renders outside AppShell, so it carries the page colour and gutter itself.
   */
  return (
    <div className="c-text min-h-screen bg-paper">
      <div className="w-full px-5 py-8 lg:mx-auto lg:max-w-[420px]">
        <div className="c-sheet c-modal">
          {approved ? (
            <>
              <CMain>
                <div className="c-mhero">
                  <Tick />
                  <p className="c-fig mt-s2 text-fig">{money(amount, { cents: true })}</p>
                  <p className="c-sub mt-s1">
                    {merchantName} &middot; {splitInto === 1 ? 'in full' : `split in ${splitInto}`}
                  </p>
                </div>
              </CMain>
              <CFoot>
                <div className="c-conseq">
                  <div>
                    <span>First payment</span>
                    <span>
                      {/* The same figure the split control quoted a moment ago, from the same function.
                          Dividing the amount by the split would drop the carry and tell a member their
                          first payment is smaller than the one that will actually be taken. */}
                      {money(splitQuote(amount, splitInto, ratePerCycle).perCycle, { cents: true })}
                      {firstPaymentOn ? ` on ${firstPaymentOn}` : ''}
                    </span>
                  </div>
                  <div>
                    <span>Clears from</span>
                    <span>{clearsFromLabel}</span>
                  </div>
                </div>
                {/* The one moment a member is most receptive to the point of the whole co-op: they
                    have just agreed to pay carry, and the way not to is one sentence long. */}
                <div className="c-footnote">
                  <p className="c-label mb-1">MAKE THE NEXT ONE FREE</p>
                  <p>Save anything at all and you borrow against your own money instead — at no cost.</p>
                </div>
              </CFoot>
            </>
          ) : (
            <>
              <CHead>
                <Line className="items-center!">
                  <span className="flex min-w-0 items-center gap-2.5">
                    {onBack && (
                      <button type="button" onClick={onBack} aria-label="Back" className="c-mclose">
                        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    )}
                    <span className="c-mtitle truncate">{merchantName}</span>
                  </span>
                  <button type="button" onClick={onDecline} disabled={busy} aria-label="Not now" className="c-mclose">
                    <CloseIcon />
                  </button>
                </Line>
              </CHead>
              <CMain>
                <p className="c-label">Amount</p>
                <BigAmount amount={amount} />
                <p className="c-det mt-[6px]">Pick how to clear it, then approve.</p>
                <SplitControl
                  amount={amount}
                  options={splitOptions}
                  ratePerCycle={ratePerCycle}
                  splitInto={splitInto}
                  onChange={onSplitChange}
                />
              </CMain>
              <CFoot>
                <SplitConsequences amount={amount} ratePerCycle={ratePerCycle} splitInto={splitInto} doneBy={doneBy} />
                <div className="c-foot2 mt-s2 border-t border-ink-13 pt-s2 [--fp:12px]">
                  <div>
                    <p className="c-det">
                      <span className="c-muted">Limit</span>{' '}
                      <span className="text-ink">
                        {perCycleLimit == null ? 'Not set' : `${money(perCycleLimit, { cents: true })}/cycle`}
                      </span>
                    </p>
                    <ChevronIcon className="shrink-0 text-ink-50" />
                  </div>
                  <div>
                    <p className="c-det">
                      <span className="c-muted">Clears from</span> <span className="text-ink">{clearsFromLabel}</span>
                    </p>
                    <ChevronIcon className="shrink-0 text-ink-50" />
                  </div>
                </div>
                <div className="c-footnote">
                  <p>You have not been charged yet.</p>
                  <p>Expires in 24 hours.</p>
                  {/*
                    iOS will not open an installed home screen app for a scanned link, so a member who
                    has Clear on their home screen lands here in Safari, signed out. Nothing routes
                    around that, so the way across is the code itself — already on the merchant's
                    screen, and the in-app scanner takes a typed one.
                  */}
                  {appHandoffCode && (
                    <p className="mt-s1">
                      Have the Clear app? Open it and enter <span className="c-mono text-ink">{appHandoffCode}</span>{' '}
                      on the Scan screen.
                    </p>
                  )}
                </div>
                {error && <p className="c-det mt-s2 text-ink">{error}</p>}
                <Btn primary lg className="mt-s2" onClick={onApprove} disabled={busy}>
                  {busy ? 'One moment…' : 'Approve'}
                </Btn>
              </CFoot>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
