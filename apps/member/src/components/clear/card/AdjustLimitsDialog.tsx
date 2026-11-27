import { useEffect, useState } from 'react';
import Modal from '../Modal';
import { Btn } from '../brand/anatomy';
import { money } from '@clear/domain';
import { cn } from '@/lib/utils';

const PER_TRANSACTION = [500, 1000, 2000];
const PER_DAY = [1000, 3000, 5000];

/**
 * Adjust limits — per transaction and per day, on this card only.
 *
 * Presets rather than a keypad: these are ceilings a member picks, not amounts they type. Max is the
 * co-op's daily ceiling. The consequences say what does not change — the credit limit — because a
 * spending cap on a card is easy to confuse with the limit itself.
 */
export default function AdjustLimitsDialog({
  perTransaction,
  perDay,
  creditLimit,
  ceiling,
  open,
  onOpenChange,
  onSave,
}: {
  perTransaction: number;
  perDay: number;
  /** The member's whole limit, which these do not change. */
  creditLimit: number;
  /** The co-op's daily ceiling, and what Max means. */
  ceiling: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (limits: { perTransaction: number; perDay: number }) => void;
}) {
  const [tx, setTx] = useState(perTransaction);
  const [day, setDay] = useState(perDay);

  useEffect(() => {
    if (!open) return;
    setTx(perTransaction);
    setDay(perDay);
  }, [open, perTransaction, perDay]);

  const chips = (presets: number[], value: number, set: (v: number) => void) => (
    <div className="c-qc">
      {[...presets, ceiling].map((preset, i) => {
        const isMax = i === presets.length;
        const on = value === preset && (isMax ? !presets.includes(value) : true);
        return (
          <Btn key={isMax ? 'max' : preset} className={cn('c-chip-q', on && 'c-on')} aria-pressed={on} onClick={() => set(preset)}>
            {isMax ? 'Max' : money(preset)}
          </Btn>
        );
      })}
    </div>
  );

  const [whole] = money(tx, { cents: true }).split('.');

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Adjust limits"
      description="Set how much this card can spend per transaction and per day."
      footer={
        <>
          <div className="c-conseq">
            <div className="c-earn">
              <span>Applies to</span>
              <span>This card only</span>
            </div>
            <div>
              <span>Takes effect</span>
              <span>Immediately</span>
            </div>
            <div>
              <span>Your limit is</span>
              <span>{money(creditLimit, { cents: true })}, unchanged</span>
            </div>
            <div className="c-limit">
              <span>Ceiling set by the co-op</span>
              <span>{money(ceiling, { cents: true })} a day</span>
            </div>
          </div>
          <Btn primary lg className="mt-s2" onClick={() => onSave?.({ perTransaction: tx, perDay: day })}>
            Save limits
          </Btn>
          <p className="c-det mt-s1 text-center">Lower is safer. You can raise it again any time.</p>
        </>
      }
    >
      <p className="c-label">Per transaction</p>
      <p className="c-bigamt">
        {whole}
        <span className="c-dec">.{money(tx, { cents: true }).split('.')[1]}</span>
      </p>
      {chips(PER_TRANSACTION, tx, setTx)}
      <p className="c-label mt-s3">Per day</p>
      {chips(PER_DAY, day, setDay)}
    </Modal>
  );
}
