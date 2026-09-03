import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Delete } from 'lucide-react';
import { dollars, merchantFee, merchantPayout } from '@clear/domain';
import { Big, Inset, Lbl, PrimaryButton } from '@/shell/ui';
import { STUB_MERCHANT } from '@/data/stubs';
import { ChargeCode } from '@/charge/ChargeCode';
import { ChargeWaiting } from '@/charge/ChargeWaiting';
import { ChargeConfirmed } from '@/charge/ChargeConfirmed';
import { ChargeFailed } from '@/charge/ChargeFailed';

/**
 * Raising a charge — reference sections 02, 03, 05 and 17.
 *
 * **Two taps: amount, continue.** Entering the amount goes straight to the code; there is no "how
 * are they paying" step and there must not be one. Most customers at a counter are new, and a
 * writer who taps "scan their code" at somebody without the app has hit a dead end with a queue
 * behind them. Showing a code never dead-ends: a new customer installs from it, an existing member
 * just approves. The two shortcuts live *under a rule below it*, not as a fork in front of it.
 *
 * The whole flow is one component's state because it is one continuous act at a counter. A writer
 * who backs out of the code screen is still holding the amount they typed.
 */

type Stage = 'amount' | 'code' | 'waiting' | 'confirmed' | 'declined' | 'expired' | 'offline';

/** A number pad, never a keyboard — this is a till, and the input is always a figure. */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const;

function AmountEntry({
  amount,
  onKey,
  onContinue,
  onBack,
}: {
  amount: string;
  onKey: (k: string) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const value = Number(amount || '0');
  return (
    <>
      <div className="mb-5 flex items-center gap-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="text-[var(--clear-text-secondary)]"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="text-[16px] font-medium">New charge</span>
      </div>

      <div className="grid grid-cols-1 gap-3.5 @[900px]:grid-cols-2">
        <div>
          <Lbl>Amount</Lbl>
          <div className="mb-5">
            <Big>{dollars(value)}</Big>
          </div>

          {/*
            The fee is shown before the charge is raised, not only at confirmation. A merchant
            deciding whether to offer this deserves the real number while it is still a decision.
          */}
          <Inset>
            <p className="m-0 mb-1 text-[12px] text-[var(--clear-text-secondary)]">This charge</p>
            <div className="mt-1.5 flex justify-between text-[12.5px]">
              <span className="text-[var(--clear-text-muted)]">You receive</span>
              <span className="tabular-nums">
                {dollars(merchantPayout(value, STUB_MERCHANT.discountRate))}
              </span>
            </div>
            <div className="mt-[5px] flex justify-between text-[12.5px]">
              <span className="text-[var(--clear-text-muted)]">
                Fee · {Math.round(STUB_MERCHANT.discountRate * 1000) / 10}%
              </span>
              <span className="tabular-nums">
                {dollars(merchantFee(value, STUB_MERCHANT.discountRate))}
              </span>
            </div>
          </Inset>
        </div>

        <div>
          <div className="grid grid-cols-3 gap-2">
            {KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onKey(k)}
                aria-label={k === 'del' ? 'Delete' : k}
                className="flex items-center justify-center rounded-[10px] bg-[var(--clear-surface-1)] py-4 text-[21px]"
              >
                {/* The reference draws this glyph as ⌫; an SVG icon says the same thing without
                    resting on a Unicode symbol rendering differently on every device. */}
                {k === 'del' ? <Delete size={21} aria-hidden /> : k}
              </button>
            ))}
          </div>

          <PrimaryButton
            onClick={onContinue}
            disabled={value <= 0}
            className="mt-3.5 !py-3.5 !text-[15px]"
          >
            Continue
          </PrimaryButton>
          <p className="m-0 mt-[11px] text-center text-[11.5px] text-[var(--clear-text-muted)]">
            Goes straight to the code — no extra step.
          </p>
        </div>
      </div>

      {/* Not a point of sale: no tip line, no split, no item entry. It settles one number the
          shop's own system already produced. */}
      <p className="mx-auto mt-5 max-w-[560px] text-center text-[11.5px] leading-[1.6] text-[var(--clear-text-muted)]">
        No tips, no splits, no item entry — this settles one number your own system produced.
      </p>
    </>
  );
}

export default function NewChargePage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('amount');
  const [amount, setAmount] = useState('');
  const [raisedAt, setRaisedAt] = useState<number>(() => Date.now());

  const value = Number(amount || '0');

  function press(k: string) {
    setAmount((a) => {
      if (k === 'del') return a.slice(0, -1);
      if (k === '.' && a.includes('.')) return a;
      // Cents only go two deep: a till cannot bill a third decimal place.
      if (a.includes('.') && a.split('.')[1].length >= 2) return a;
      return (a + k).replace(/^0(?=\d)/, '');
    });
  }

  if (stage === 'amount') {
    return (
      <AmountEntry
        amount={amount}
        onKey={press}
        onContinue={() => {
          setRaisedAt(Date.now());
          setStage('code');
        }}
        onBack={() => navigate('/')}
      />
    );
  }

  if (stage === 'code') {
    return (
      <ChargeCode
        amount={value}
        merchantName={STUB_MERCHANT.name}
        onBack={() => setStage('amount')}
        // Stubbed: the customer scanning is what really moves this on.
        onSent={() => {
          setRaisedAt(Date.now());
          setStage('waiting');
        }}
      />
    );
  }

  if (stage === 'waiting') {
    return (
      <ChargeWaiting
        amount={value}
        memberName="Dana R."
        raisedAt={raisedAt}
        onSendAgain={() => setRaisedAt(Date.now())}
        onCancel={() => navigate('/')}
        onApproved={() => setStage('confirmed')}
        onDeclined={() => setStage('declined')}
        onExpired={() => setStage('expired')}
      />
    );
  }

  if (stage === 'confirmed') {
    return (
      <ChargeConfirmed
        amount={value}
        memberName="Dana R."
        discountRate={STUB_MERCHANT.discountRate}
        paidOut="2026-12-14"
        onDone={() => navigate('/')}
      />
    );
  }

  return (
    <ChargeFailed
      kind={stage}
      amount={value}
      memberName="Dana R."
      onRetry={() => setStage(stage === 'expired' ? 'waiting' : 'amount')}
      onDone={() => navigate('/')}
    />
  );
}
