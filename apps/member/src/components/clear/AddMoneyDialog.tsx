import { useEffect, useState } from 'react';
import Modal from './Modal';
import Keypad from './Keypad';
import { Btn } from './brand/anatomy';
import { SwapIcon } from './brand/icons';
import { applyKey } from '@/lib/amountEntry';
import { money } from '@clear/domain';
import type { LinkedAccount } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

type Direction = 'in' | 'out';

const PRESETS = [100, 500, 1000];

/**
 * Add money — the move-money modal with its one leg outside Clear.
 *
 * Because the money comes from a bank, its consequences are about timing rather than credits: when it
 * arrives, how long a slow bank can take, where it lands, and what it raises. Swapping the route sends
 * money back to the bank. The first deposit is the same modal with the deferred identity check folded
 * into its consequence lines — asked once, at the moment it is actually required.
 *
 * The From leg is the account picker: tapping it opens Clears from.
 */
export default function AddMoneyDialog({
  open,
  onOpenChange,
  account,
  readyToAllocate,
  firstDeposit,
  onPickAccount,
  onAdd,
  onSendBack,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The linked account money moves from. Absent until one is linked. */
  account?: LinkedAccount;
  /** What is already in Ready to allocate, for the To leg. */
  readyToAllocate: number;
  /** Nothing has been deposited yet, so identity is asked for here. */
  firstDeposit?: boolean;
  onPickAccount?: () => void;
  onAdd?: (amount: number) => void;
  onSendBack?: (amount: number) => void;
}) {
  const [direction, setDirection] = useState<Direction>('in');
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open) return;
    setDirection('in');
    setTyped('');
  }, [open]);

  const amount = Number(typed) || 0;
  const into = direction === 'in';
  // Sending back is capped by what is sitting in Ready to allocate; adding has no balance to cap it.
  const over = !into && amount > readyToAllocate;

  const accountLeg = (label: string) => (
    <button type="button" className="c-leg text-left" onClick={onPickAccount}>
      <p className="c-label">{label}</p>
      <p className="c-nm">{account?.name ?? 'Link an account'}</p>
      <p className="c-bal">{account ? 'Linked account' : 'Needed to add money'}</p>
    </button>
  );
  const clearLeg = (label: string) => (
    <div className="c-leg">
      <p className="c-label">{label}</p>
      <p className="c-nm">Ready to allocate</p>
      <p className="c-bal">{money(readyToAllocate, { cents: true })}</p>
    </div>
  );

  const footer = into ? (
    <>
      <div className="c-conseq">
        {firstDeposit ? (
          <>
            <div className="c-earn">
              <span>First deposit</span>
              <span>Two identity details, asked once</span>
            </div>
            <div>
              <span>Arrives</span>
              <span>Usually instantly</span>
            </div>
          </>
        ) : (
          <>
            <div className="c-earn">
              <span>Arrives</span>
              <span>Usually instantly</span>
            </div>
            <div>
              <span>If your bank is slow</span>
              <span>Up to 3 business days</span>
            </div>
          </>
        )}
        <div>
          <span>Lands in</span>
          <span>Ready to allocate</span>
        </div>
        <div className="c-limit">
          <span>Raises what you can spend by</span>
          <span>+{money(amount, { cents: true })}</span>
        </div>
      </div>
      <Btn primary lg className="mt-s2" disabled={!account || amount <= 0} onClick={() => onAdd?.(amount)}>
        {firstDeposit ? `Verify and add ${money(amount, { cents: true })}` : `Add ${money(amount, { cents: true })}`}
      </Btn>
      <p className="c-det mt-s1 text-center">
        {firstDeposit ? 'Not a credit check. Nothing here touches your score.' : 'Free. Swap the direction to send it back to your bank.'}
      </p>
    </>
  ) : (
    <>
      {/* Not drawn in the reference: the same lines with the route turned round. */}
      <div className="c-conseq">
        <div className="c-earn">
          <span>Arrives</span>
          <span>Up to 3 business days</span>
        </div>
        <div>
          <span>Goes to</span>
          <span>{account?.name ?? 'Your bank'}</span>
        </div>
        <div className="c-limit c-down">
          <span>Lowers what you can spend by</span>
          <span>−{money(amount, { cents: true })}</span>
        </div>
      </div>
      {over && (
        <p className="c-det mt-s2">
          {money(amount - readyToAllocate, { cents: true })} more than is in Ready to allocate.
        </p>
      )}
      <Btn primary lg className="mt-s2" disabled={!account || amount <= 0 || over} onClick={() => onSendBack?.(amount)}>
        Send {money(amount, { cents: true })} to your bank
      </Btn>
    </>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add money"
      description="Move money in from a linked bank account, or send it back."
      className="sm:w-[640px] sm:max-w-[640px]"
      footer={footer}
    >
      <div className="sm:grid sm:grid-cols-[minmax(0,1fr)_216px] sm:items-start sm:gap-s3">
        <div>
          <p className="c-label">Amount</p>
          <p className="c-bigamt">
            ${Number(typed.split('.')[0] || 0).toLocaleString('en-US')}
            <span className="c-dec">.{(typed.split('.')[1] ?? '').padEnd(2, '0').slice(0, 2)}</span>
          </p>
          <div className="c-qc">
            {PRESETS.map((preset) => (
              <Btn
                key={preset}
                className={cn('c-chip-q', amount === preset && 'c-on')}
                aria-pressed={amount === preset}
                onClick={() => setTyped(String(preset))}
              >
                {money(preset)}
              </Btn>
            ))}
            {/* The keypad is the input; Custom clears the figure so it is ready to type into. */}
            <Btn
              className={cn('c-chip-q', amount > 0 && !PRESETS.includes(amount) && 'c-on')}
              onClick={() => setTyped('')}
            >
              Custom
            </Btn>
          </div>
          <div className="c-route">
            {into ? accountLeg('From') : clearLeg('From')}
            {into ? clearLeg('To') : accountLeg('To')}
            <button
              type="button"
              aria-label="Swap direction"
              className="c-swap"
              onClick={() => {
                setDirection(into ? 'out' : 'in');
                setTyped('');
              }}
            >
              <SwapIcon className="text-ink-70" />
            </button>
          </div>
          <div className="sm:hidden">
            <Keypad onKey={(key) => setTyped((current) => applyKey(current, key))} />
          </div>
        </div>
        <div className="hidden sm:block">
          <Keypad onKey={(key) => setTyped((current) => applyKey(current, key))} />
        </div>
      </div>
    </Modal>
  );
}
