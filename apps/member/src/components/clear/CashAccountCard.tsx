import { Btn, CFoot, CHead, CMain, Cell, Chip, HeadFig, Line, SecHead } from './brand/anatomy';
import { money } from '@clear/domain';
import { hasUnspendableCash, type CashAccount } from '@/lib/clearModel';

/**
 * Spendable — a cell on Home's slab.
 *
 * Header: Spendable and its figure, the number that answers "what can I do right now". Main: what it
 * is for and the next deposit, then Ready to allocate below a rule — money moved on-chain and not yet
 * placed, which can go to Savings or Earn and never to the card. Footer: the direct-deposit chip and
 * Details. The footer is unconditional: account details are how direct deposit gets set up in the
 * first place, so the way in can't be gated on already having it.
 *
 * There is no combined total. A figure spanning both halves would be the one number a member cannot
 * act on — part of it settles a card and part of it categorically cannot.
 */
export default function CashAccountCard({
  account,
  onDetails,
  onAllocateSavings,
  onAllocateEarn,
  onBackToCash,
}: {
  account: CashAccount;
  onDetails?: () => void;
  onAllocateSavings?: () => void;
  onAllocateEarn?: () => void;
  /** Send it back to spendable fiat — the way out for a member who changed their mind. */
  onBackToCash?: () => void;
}) {
  const parked = hasUnspendableCash(account);

  return (
    <Cell>
      <CHead>
        <SecHead label="Spendable">
          <HeadFig value={money(account.spendable, { cents: true })} />
        </SecHead>
      </CHead>
      <CMain>
        <Line>
          <span className="c-det">Card and payments</span>
          {/* An em dash rather than nothing: a line with one end missing reads as a rendering fault. */}
          <span className="c-det">
            {account.nextDepositOn
              ? `${account.nextDepositOn} · ~${money(account.nextDepositEstimate, { cents: true })}`
              : '—'}
          </span>
        </Line>
        <Line className="mt-s2 border-t border-ink-13 pt-s2">
          <span className="c-sub">Ready to allocate</span>
          <span className="c-fig c-fig-row">{money(account.readyToAllocate, { cents: true })}</span>
        </Line>
        {/* Only when something is actually parked: its three destinations. */}
        {parked && (
          <div className="c-qc">
            <Btn className="c-chip-q" onClick={onAllocateSavings}>
              Savings
            </Btn>
            <Btn className="c-chip-q" onClick={onAllocateEarn}>
              Earn
            </Btn>
            <Btn className="c-chip-q" onClick={onBackToCash}>
              Back to cash
            </Btn>
          </div>
        )}
      </CMain>
      <CFoot>
        <Line className="items-center!">
          {account.directDepositActive ? (
            <Chip tone="settled" core>
              Direct deposit
            </Chip>
          ) : (
            <span className="c-det">Direct deposit not set up</span>
          )}
          <Btn onClick={onDetails}>Details</Btn>
        </Line>
      </CFoot>
    </Cell>
  );
}
