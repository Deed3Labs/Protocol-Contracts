import { useEffect, useState } from 'react';
import Modal from './Modal';
import { Btn } from './brand/anatomy';
import { money, count } from '@clear/domain';
import type { AutoSaveCadence, SavingsData } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

const CADENCES: { id: AutoSaveCadence; label: string; next: string }[] = [
  { id: 'payday', label: 'Every payday', next: 'Nov 1' },
  { id: 'monthly', label: 'Monthly', next: 'Nov 1' },
  { id: 'weekly', label: 'Weekly', next: 'Nov 3' },
];

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
}: {
  data: SavingsData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Turn it on, or save a change to one already running. */
  onTurnOn?: (amount: number, cadence: AutoSaveCadence) => void;
  onTurnOff?: () => void;
}) {
  const running = data.autoSave;
  const startAmount = running?.amount ?? data.projection.perPayday;
  const [amount, setAmount] = useState(startAmount);
  const [custom, setCustom] = useState(false);
  const [cadence, setCadence] = useState<AutoSaveCadence>(running?.cadence ?? 'payday');
  const presets = [data.projection.extraMonthly, data.projection.perPayday];
  const chosen = CADENCES.find((c) => c.id === cadence) ?? CADENCES[0];

  // Reopening shows what is actually set, not what was auditioned last time.
  useEffect(() => {
    if (!open) return;
    setAmount(startAmount);
    setCustom(!presets.includes(startAmount));
    setCadence(running?.cadence ?? 'payday');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const unchanged = running !== undefined && amount === running.amount && cadence === running.cadence;

  const footer = running ? (
    <>
      <div className="c-conseq">
        <div className="c-earn">
          <span>Moving to {data.projection.withExtra} needs</span>
          <span>+{money(data.projection.extraMonthly, { cents: true })} a month</span>
        </div>
        <div>
          <span>Saved so far this year</span>
          <span>{money(running.savedThisYear, { cents: true })}</span>
        </div>
        <div>
          <span>Next run</span>
          <span>{chosen.next}</span>
        </div>
        <div className="c-limit">
          <span>On track for</span>
          <span>{data.savings.onTrackFor ?? '—'}</span>
        </div>
      </div>
      <div className="c-pair mt-s2">
        <Btn primary disabled={amount <= 0 || unchanged} onClick={() => onTurnOn?.(amount, cadence)}>
          Save changes
        </Btn>
        <Btn onClick={onTurnOff}>Turn off</Btn>
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
          <span>Next run</span>
          <span>{chosen.next}</span>
        </div>
        <div>
          <span>Comes from</span>
          <span>Ready to allocate</span>
        </div>
        <div className="c-limit">
          <span>At this rate, {count(data.savings.creditsGoal)} credits by</span>
          <span>{data.savings.onTrackFor ?? '—'}</span>
        </div>
      </div>
      <div className="c-footnote">
        <p>Auto-save moves money already inside Clear. You can change it or stop it any time.</p>
      </div>
      <Btn primary lg className="mt-s2" disabled={amount <= 0} onClick={() => onTurnOn?.(amount, cadence)}>
        Turn on auto-save
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
