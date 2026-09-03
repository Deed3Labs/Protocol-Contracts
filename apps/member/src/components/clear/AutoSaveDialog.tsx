import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Modal from './Modal';
import DetailRows from './DetailRows';
import InfoBlock from './InfoBlock';
import { money, count } from '@clear/domain';
import type { SavingsData } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

const CADENCES = [
  { id: 'payday', label: 'Every payday', next: 'Nov 1' },
  { id: 'monthly', label: 'Monthly', next: 'Nov 1' },
  { id: 'weekly', label: 'Weekly', next: 'Nov 3' },
] as const;

/**
 * Turn on automatic saving.
 *
 * The three rows in the middle are the argument: what goes in, what it's matched
 * with, and the date that produces. Auto-save is the one lever that moves the
 * Clear Deed date, so the surface shows the date rather than talking about
 * discipline.
 *
 * The skip rule is stated before it's needed. A transfer that overdraws someone
 * to hit a savings target is the kind of "help" people never forgive.
 */
export default function AutoSaveDialog({
  data,
  open,
  onOpenChange,
  onTurnOn,
}: {
  data: SavingsData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTurnOn?: (amount: number, cadence: string) => void;
}) {
  const [amount, setAmount] = useState(data.projection.perPayday);
  const [custom, setCustom] = useState(false);
  const [cadence, setCadence] = useState<(typeof CADENCES)[number]['id']>('payday');
  const presets = [data.projection.extraMonthly, data.projection.perPayday];
  const chosen = CADENCES.find((c) => c.id === cadence) ?? CADENCES[0];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Auto-save"
      description="Choose how much to save automatically and how often."
    >
      <p className="mb-3.5 text-xs text-foreground-secondary">
        The single biggest thing you can do to reach a home sooner.
      </p>

      <p className="mb-2 text-xs text-foreground-secondary">How much</p>
      <div className="mb-3.5 flex gap-1.5">
        {presets.map((preset) => (
          <Button
            key={preset}
            variant="clear"
            size="xs"
            aria-pressed={!custom && amount === preset}
            onClick={() => {
              setCustom(false);
              setAmount(preset);
            }}
            className={cn('flex-1', !custom && amount === preset && 'border-tier-boost text-tier-boost-fg')}
          >
            {money(preset)}
          </Button>
        ))}
        <Button
          variant="clear"
          size="xs"
          aria-pressed={custom}
          onClick={() => setCustom(true)}
          className={cn('flex-1', custom && 'border-tier-boost text-tier-boost-fg')}
        >
          Custom
        </Button>
      </div>

      {custom && (
        <Input
          autoFocus
          value={amount ? String(amount) : ''}
          onChange={(e) => setAmount(Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
          inputMode="decimal"
          aria-label="Custom amount"
          placeholder="Amount"
          className="mb-3.5 h-9 text-xs"
        />
      )}

      <p className="mb-2 text-xs text-foreground-secondary">When</p>
      <div className="mb-3.5 flex gap-1.5">
        {CADENCES.map((c) => (
          <Button
            key={c.id}
            variant="clear"
            size="xs"
            aria-pressed={cadence === c.id}
            onClick={() => setCadence(c.id)}
            className={cn('flex-1 text-[11px]', cadence === c.id && 'border-tier-boost text-tier-boost-fg')}
          >
            {c.label}
          </Button>
        ))}
      </div>

      <DetailRows
        className="mb-3"
        rows={[
          { label: 'Next run', value: chosen.next },
          {
            label: 'Matched in credits',
            value: (
              <span className="text-tier-savings-fg">+{money(amount)} each time</span>
            ),
          },
          {
            label: `At this rate, ${count(data.savings.creditsGoal)} credits by`,
            value: data.savings.onTrackFor ?? '—',
          },
        ]}
      />

      <InfoBlock className="mb-3.5">
        If your balance is short on the day, we skip it rather than overdraw you.
      </InfoBlock>

      <Button size="xs" className="w-full" disabled={amount <= 0} onClick={() => onTurnOn?.(amount, cadence)}>
        Turn on auto-save
      </Button>
      <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
        Pause or change it any time.
      </p>
    </Modal>
  );
}
