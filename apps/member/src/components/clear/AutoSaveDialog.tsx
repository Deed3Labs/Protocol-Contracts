import { useEffect, useState } from 'react';
import Modal from './Modal';
import { Btn } from './brand/anatomy';
import { money, count } from '@clear/domain';
import {
  AUTO_SAVE_RUNS,
  DEPOSIT_MATCH_MONTHLY_CAP,
  firstAutoSaveRun,
  monthlyAutoSave,
  monthlyAutoSaveCredits,
  onTrackFor,
  type AutoSaveCadence,
  type SavingsData,
} from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/*
 * Monthly and weekly only: these are the autopay rule's two cadences. "Every payday" is the sweep
 * rule's (/api/sweeps/auto-save), which today books an intent on each deposit and moves nothing, so
 * it is not offered until it does.
 */
const CADENCES: { id: AutoSaveCadence; label: string }[] = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'weekly', label: 'Weekly' },
];

const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/**
 * Auto-save — two states, because the screen a member opens the first time and the one they open a
 * year later are asking different questions: one is **should I**, the other is **is this still
 * right**.
 *
 * Main is what you choose — how much and when. The footer is what follows: the first time, what it is
 * matched with and the date it produces; once it is running, what it would take to move that date,
 * and what it has already done. Auto-save is the one lever that moves the Clear Deed date, so the
 * surface shows the date rather than talking about discipline.
 */
export default function AutoSaveDialog({
  data,
  open,
  onOpenChange,
  onTurnOn,
  onTurnOff,
  busy = false,
  error = null,
}: {
  data: SavingsData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Turn it on, or save a change to one already running. */
  onTurnOn?: (amount: number, cadence: AutoSaveCadence) => void;
  onTurnOff?: () => void;
  /** A change is out for signature or on its way to the server. */
  busy?: boolean;
  error?: string | null;
}) {
  const running = data.autoSave;
  const startAmount = running?.amount ?? data.projection.perPayday;
  const [amount, setAmount] = useState(startAmount);
  const [custom, setCustom] = useState(false);
  const [cadence, setCadence] = useState<AutoSaveCadence>(running?.cadence ?? 'monthly');
  const presets = [data.projection.extraMonthly, data.projection.perPayday];
  const { credits, creditsGoal } = data.savings;
  // The date this choice produces, worked out as it is edited — the same rule the page's "On track
  // for" uses, applied to what is on the screen rather than what is saved.
  const projected = onTrackFor(credits, creditsGoal, monthlyAutoSaveCredits({ amount, cadence }));
  // And what a little more a month would do, if it would do anything: past the match cap it would not.
  const extra = data.projection.extraMonthly;
  const withExtra = onTrackFor(
    credits,
    creditsGoal,
    Math.min(DEPOSIT_MATCH_MONTHLY_CAP, monthlyAutoSave({ amount, cadence }) + extra),
  );
  const extraMoves = projected !== undefined && withExtra !== undefined && withExtra !== projected;

  // Reopening shows what is actually set, not what was auditioned last time — and so does the rule
  // arriving while it is open, which is how it opens from outside Savings before the first read lands.
  useEffect(() => {
    if (!open) return;
    setAmount(startAmount);
    setCustom(!presets.includes(startAmount));
    setCadence(running?.cadence ?? 'monthly');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, running?.amount, running?.cadence]);

  const unchanged = running !== undefined && amount === running.amount && cadence === running.cadence;
  // The running rule's own next run while its cadence stands; a new one starts a period from now.
  const nextRun =
    running?.nextRunAt && running.cadence === cadence
      ? shortDate(new Date(running.nextRunAt))
      : shortDate(firstAutoSaveRun(cadence));

  const footer = running ? (
    <>
      <div className="c-conseq">
        {extraMoves && (
          <div className="c-earn">
            <span>Moving to {withExtra} needs</span>
            <span>+{money(extra, { cents: true })} a month</span>
          </div>
        )}
        {running.savedThisYear !== undefined && (
          <div>
            <span>Saved so far this year</span>
            <span>{money(running.savedThisYear, { cents: true })}</span>
          </div>
        )}
        <div>
          <span>Next run</span>
          <span>{nextRun}</span>
        </div>
        {running.runsLeft != null && (
          <div>
            <span>Runs left</span>
            <span>{count(running.runsLeft)}</span>
          </div>
        )}
        {projected && (
          <div className="c-limit">
            <span>On track for</span>
            <span>{projected}</span>
          </div>
        )}
      </div>
      {error && <p className="c-det c-errline mt-s2">{error}</p>}
      <div className="c-pair mt-s2">
        <Btn primary disabled={busy || amount <= 0 || unchanged} onClick={() => onTurnOn?.(amount, cadence)}>
          {busy ? 'Waiting…' : 'Save changes'}
        </Btn>
        <Btn disabled={busy} onClick={onTurnOff}>
          Turn off
        </Btn>
      </div>
    </>
  ) : (
    <>
      <div className="c-conseq">
        <div className="c-earn">
          <span>Matched in credits</span>
          <span>+{money(amount, { cents: true })} each time</span>
        </div>
        <div>
          <span>First run</span>
          <span>{nextRun}</span>
        </div>
        <div>
          <span>Comes from</span>
          <span>Ready to allocate</span>
        </div>
        {projected && (
          <div className="c-limit">
            <span>At this rate, {count(creditsGoal)} credits by</span>
            <span>{projected}</span>
          </div>
        )}
      </div>
      <div className="c-footnote">
        <p>
          Auto-save moves money already inside Clear. You confirm it once, it runs {AUTO_SAVE_RUNS} times, and
          you can change it or stop it any time.
        </p>
      </div>
      {error && <p className="c-det c-errline mt-s2">{error}</p>}
      <Btn primary lg className="mt-s2" disabled={busy || amount <= 0} onClick={() => onTurnOn?.(amount, cadence)}>
        {busy ? 'Waiting for your confirmation…' : 'Turn on auto-save'}
      </Btn>
    </>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={running ? 'Adjust auto-save' : 'Auto-save'}
      description="Choose how much to save automatically and how often."
      footer={footer}
    >
      <p className="c-label">How much</p>
      <div className="c-qc">
        {presets.map((preset) => (
          <Btn
            key={preset}
            aria-pressed={!custom && amount === preset}
            onClick={() => {
              setCustom(false);
              setAmount(preset);
            }}
            className={cn('c-chip-q', !custom && amount === preset && 'c-on')}
          >
            {money(preset, { cents: true })}
          </Btn>
        ))}
        <Btn aria-pressed={custom} onClick={() => setCustom(true)} className={cn('c-chip-q', custom && 'c-on')}>
          Custom
        </Btn>
      </div>
      {custom && (
        <input
          autoFocus
          value={amount ? String(amount) : ''}
          onChange={(e) => setAmount(Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
          inputMode="decimal"
          aria-label="Custom amount"
          placeholder="Amount"
          className="c-field mt-s1 w-full"
        />
      )}

      <p className="c-label mt-s3">When</p>
      <div className="c-qc">
        {CADENCES.map((c) => (
          <Btn
            key={c.id}
            aria-pressed={cadence === c.id}
            onClick={() => setCadence(c.id)}
            className={cn('c-chip-q', cadence === c.id && 'c-on')}
          >
            {c.label}
          </Btn>
        ))}
      </div>
    </Modal>
  );
}
