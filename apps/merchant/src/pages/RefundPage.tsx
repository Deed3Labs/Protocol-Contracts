import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronLeft } from 'lucide-react';
import { dollars, refundQuote } from '@clear/domain';
import { Button, Cap, Inset, PrimaryButton } from '@/shell/ui';
import { Chip, RoleChip } from '@/auth/RoleChip';
import { useAuth } from '@/auth/authContext';
import { api } from '@/data/apiClient';
import { useApi } from '@/data/useApi';
import { STUB_MERCHANT } from '@/data/stubs';

/**
 * The refund flow — reference section 16.
 *
 * Two people, three steps, and **every screen says whose it is**. The manager-override pattern
 * every retail till already uses, so nobody needs training: it is what they already do.
 *
 * **Nothing is said to the customer until step 3 completes.** A refund a writer promised and an
 * owner declined is the worst possible counter conversation, so the copy at every step before that
 * keeps the promise unmade — "nothing moves yet", "the customer has not been told anything yet",
 * and a decline that tells the writer rather than the customer.
 *
 * **The waiting step persists.** An owner may walk over minutes later and type their code, or
 * approve from their phone in the back office. Step 2 holds either way, so a writer is never stuck
 * at the till.
 *
 * **The two parties see different numbers, deliberately.** The writer sees what the customer gets
 * back; the owner sees what it does to their payout, which is the figure the person authorising
 * actually cares about. Both come from one `refundQuote`, so they cannot drift apart.
 *
 * One deviation from the drawing, taken on purpose. The reference's step 1 is labelled
 * "Jen · counter" and shows "Off your next payout $401.70" — but counter staff never see payout
 * figures. The line is role-gated here rather than shown to everyone; a writer still has
 * everything they need to speak to the customer, and the owner still gets the figure that makes
 * the decision.
 */

type Step = 'review' | 'waiting' | 'authorise' | 'done' | 'declined';

/**
 * A member's display name already ends in a full stop — "Marcus T." — so a sentence that ends on
 * one renders "Marcus T..". Ending the sentence with the name's own stop reads correctly.
 */
const endsSentence = (name: string) => (name.endsWith('.') ? '' : '.');

const timeNow = () =>
  new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');

function StepHeader({ label, chip }: { label: string; chip: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <span className="text-[10px] uppercase tracking-[0.5px] text-[var(--clear-text-muted)]">
        {label}
      </span>
      {chip}
    </div>
  );
}

function Line({
  label,
  value,
  strong,
  ruled,
}: {
  label: string;
  value: string;
  strong?: boolean;
  ruled?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-3 text-[12.5px] ${
        ruled ? 'mt-1.5 border-t-[0.5px] border-[var(--clear-border)] pt-2' : 'mt-1.5 first:mt-0'
      }`}
    >
      <span className="text-[var(--clear-text-secondary)]">{label}</span>
      <span className={`tabular-nums ${strong ? 'font-medium' : ''}`}>{value}</span>
    </div>
  );
}

export default function RefundPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { session, canSeeMoney, authoriseWithOwnerCode } = useAuth();

  const [step, setStep] = useState<Step>('review');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [requestedAt, setRequestedAt] = useState('');
  const [approvedAt, setApprovedAt] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  /** The refund record, created when the writer sends it. Everything after acts on this id. */
  const [refundId, setRefundId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Hooks before the guard: the charge may not have arrived yet on a cold open of this URL.
  const { data: charges, loading } = useApi(() => api.charges({ limit: 200 }), []);
  const { data: profile } = useApi(() => api.profile(), []);
  const { data: position } = useApi(() => api.payouts(), []);
  const { data: staff } = useApi(() => api.staff(), []);

  const charge = (charges ?? []).find((c) => c.code === id);

  if (loading && !charge) {
    return <p className="m-0 text-[13px] text-[var(--clear-text-muted)]">Loading…</p>;
  }
  if (!charge) return <Navigate to="/charges" replace />;

  // How many cycles the member has cleared is not on the merchant's feed, so the clawback is
  // quoted against the whole plan. That is the conservative direction — it never understates what
  // a refund costs the shop, which is the number the person authorising is deciding on.
  const plan = { splitInto: charge.splitInto ?? 1, cyclesCleared: 0 };

  const quote = refundQuote({
    amount: charge.amount,
    splitInto: plan.splitInto,
    ratePerCycle: STUB_MERCHANT.ratePerCycle,
    cyclesCleared: plan.cyclesCleared,
    discountRate: profile?.discountRate ?? 0,
    nextPayout: (position?.owedCents ?? 0) / 100,
  });

  const who = charge.memberName ?? 'the customer';
  // Named so the writer can say who it went to. Counter staff cannot read the roster, so this
  // falls back to the role — "an owner" is still something they can say out loud.
  const owner = (staff ?? []).find((st) => st.role === 'owner' && st.active) ?? null;
  const ownerName = owner?.name ?? 'an owner';
  const writer = session?.staff.name ?? '—';

  /**
   * The owner's decision, against the refund record.
   *
   * Two ways in, and the server tells them apart: an owner who typed their code at the counter
   * authorises through `authoriseRefund`, an owner already signed in on their own phone decides
   * through `decideRefund`. Both were buttons that only changed the screen — the customer was
   * told the refund was approved and nothing had happened.
   */
  async function decide(decision: 'approve' | 'decline') {
    if (!refundId) {
      setError('That refund was not recorded. Start it again.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (code.length === 4) await api.authoriseRefund(refundId, code, decision);
      else await api.decideRefund(refundId, decision);
      setApprovedAt(timeNow());
      setStep(decision === 'approve' ? 'done' : 'declined');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be recorded just now.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    setError(null);
    try {
      const approver = await authoriseWithOwnerCode(code);
      setApprovedBy(approver.name);
      setStep('authorise');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code was not recognised.');
    }
  }

  return (
    <div className="mx-auto w-full max-w-[380px]">
      <div className="mb-4 flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => navigate(`/charges/${charge.code}`)}
          aria-label="Back"
          className="text-[var(--clear-text-secondary)]"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="text-[16px] font-medium">{who}</span>
      </div>

      {step === 'review' && (
        <>
          <StepHeader
            label="Step 1 · Review"
            chip={session && <RoleChip name={session.staff.name} role={session.staff.role} />}
          />
          <p className="m-0 mb-3 text-[14px] font-medium">
            Refund {dollars(charge.amount)} to {who}?
          </p>

          <Inset className="mb-3.5 !px-[15px] !py-[13px]">
            <Line label="Their plan closes" value={dollars(quote.amount)} />
            <Line label="They get back" value={dollars(quote.memberReceives)} />
            {/* Carry is not refunded: a refund unwinds the purchase, not the time. */}
            <Line label="Carry they already paid" value={`${dollars(quote.carryKept)} — kept`} />
            {/* Payout figures are owner-only — see the note at the top of this file. */}
            {canSeeMoney && (
              <Line label="Off your next payout" value={dollars(quote.merchantClawback)} strong ruled />
            )}
          </Inset>

          <PrimaryButton
            disabled={busy}
            className="mb-2 !py-[11px] !text-[15px]"
            onClick={async () => {
              // This only moved the screen on. Nothing was recorded, so an owner had nothing to
              // approve and the customer had been told a refund was on its way.
              setBusy(true);
              setError(null);
              try {
                const created = await api.requestRefund({
                  chargeCode: charge.code,
                  splitInto: plan.splitInto,
                  cyclesCleared: plan.cyclesCleared,
                  ratePerCycle: STUB_MERCHANT.ratePerCycle,
                  discountRate: profile?.discountRate ?? 0,
                  nextPayoutCents: position?.owedCents ?? 0,
                });
                setRefundId(created.id);
                setRequestedAt(timeNow());
                setStep('waiting');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'That could not be sent just now.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Sending…' : 'Send to an owner'}
          </PrimaryButton>
          <Button onClick={() => navigate(`/charges/${charge.code}`)} className="w-full">
            Cancel
          </Button>
          <p className="m-0 mt-[11px] text-[11px] leading-[1.55] text-[var(--clear-text-muted)]">
            Nothing moves yet. {ownerName} will get this on their phone, or they can type their
            code here.
          </p>
        </>
      )}

      {step === 'waiting' && (
        <>
          <StepHeader label="Step 2 · Waiting" chip={<Chip tone="accent">Needs an owner</Chip>} />
          <p className="m-0 mb-1 text-[14px] font-medium">Waiting on {ownerName}</p>
          <p className="m-0 mb-4 text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
            {writer} requested a {dollars(charge.amount)} refund for {who} at {requestedAt}.
          </p>

          <Inset className="mb-3.5 !px-[15px] !py-[13px]">
            <Line label={`Sent to ${ownerName}`} value="Delivered" />
            <p className="m-0 mt-2.5 text-[11px] leading-[1.55] text-[var(--clear-text-muted)]">
              They can approve from their phone, or type their code below if they are here.
            </p>
          </Inset>

          {/*
            The second of the two ways to authorise. An owner typing their code here is authorising
            one act — it deliberately does not take over the writer's session.
          */}
          <Inset className="mb-3 !px-[15px] !py-[13px]">
            <Cap>Owner code</Cap>
            <input
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.length === 4) void submitCode();
              }}
              placeholder="••••"
              aria-label="Owner code"
              className="w-full bg-transparent text-[19px] tracking-[6px] text-[var(--clear-text-primary)] outline-none placeholder:text-[var(--clear-text-muted)]"
            />
          </Inset>

          {code.length === 4 && (
            <PrimaryButton className="mb-2 !py-[11px] !text-[15px]" onClick={() => void submitCode()}>
              Authorise
            </PrimaryButton>
          )}
          {error && (
            <p role="alert" className="m-0 mb-2 text-[12.5px]">
              {error}
            </p>
          )}

          <Button onClick={() => navigate(`/charges/${charge.code}`)} className="w-full">
            Cancel the request
          </Button>
          <p className="m-0 mt-[11px] text-[11px] leading-[1.55] text-[var(--clear-text-muted)]">
            The customer has not been told anything yet. Nothing has moved.
          </p>
        </>
      )}

      {step === 'authorise' && (
        <>
          <StepHeader
            label="Step 3 · Authorise"
            chip={<Chip tone="accent">{approvedBy || ownerName} · owner</Chip>}
          />
          <p className="m-0 mb-1 text-[14px] font-medium">Approve this refund?</p>
          <p className="m-0 mb-4 text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
            <strong className="font-medium text-[var(--clear-text-primary)]">{writer}</strong>{' '}
            requested this for {who}
            {endsSentence(who)}
          </p>

          {/* The owner's numbers: what it does to their payout, which is what makes the decision. */}
          <Inset className="mb-3.5 !px-[15px] !py-[13px]">
            <Line label="Refund" value={dollars(quote.amount)} strong />
            <Line label="Off your next payout" value={dollars(quote.merchantClawback)} />
            <Line label="Next payout becomes" value={dollars(quote.payoutAfter)} />
          </Inset>

          <PrimaryButton
            disabled={busy}
            className="mb-2 !py-[11px] !text-[15px]"
            onClick={() => void decide('approve')}
          >
            {busy ? 'Approving…' : 'Approve refund'}
          </PrimaryButton>
          <Button disabled={busy} onClick={() => void decide('decline')} className="w-full">
            Decline
          </Button>
          <p className="m-0 mt-[11px] text-[11px] leading-[1.55] text-[var(--clear-text-muted)]">
            Declining tells {writer}, not the customer.
          </p>
        </>
      )}

      {step === 'done' && (
        <>
          <div className="mb-4 flex items-center gap-3.5">
            <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-[var(--clear-bg-success)]">
              <Check size={22} strokeWidth={2.4} className="text-[var(--clear-text-success)]" aria-hidden />
            </div>
            <div>
              <p className="m-0 text-[26px] font-medium tabular-nums">
                {dollars(quote.amount)} refunded
              </p>
              <p className="m-0 mt-1 text-[12px] text-[var(--clear-text-muted)]">{who} · just now</p>
            </div>
          </div>

          {/* Both names are kept: an owner reviewing the month needs to know who asked as well as
              who approved. */}
          <Inset className="!px-[15px] !py-[13px]">
            <Line label="Requested by" value={`${writer} · ${requestedAt}`} />
            <Line label="Approved by" value={`${approvedBy || ownerName} · ${approvedAt}`} />
            {canSeeMoney && <Line label="Next payout" value={dollars(quote.payoutAfter)} strong ruled />}
          </Inset>

          <p className="m-0 mt-3.5 text-[11.5px] leading-[1.6] text-[var(--clear-text-muted)]">
            {who} is told once, now. Their plan closes and {dollars(quote.memberReceives)} returns to
            the account it cleared from — the same account, so there is nothing for them to choose.
          </p>

          <Button onClick={() => navigate('/charges')} className="mt-3.5 w-full">
            Done
          </Button>
        </>
      )}

      {step === 'declined' && (
        <>
          <StepHeader label="Refund declined" chip={<Chip>{writer} · told</Chip>} />
          <p className="m-0 mb-3 text-[14px] font-medium">
            {approvedBy || owner?.name} declined this refund
          </p>
          <Inset className="mb-3.5">
            <p className="m-0 text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
              The charge stands and nothing has moved. {who} has not been told anything — speak to{' '}
              {approvedBy || owner?.name} before you speak to them.
            </p>
          </Inset>
          <Button onClick={() => navigate(`/charges/${charge.code}`)} className="w-full">
            Back to the charge
          </Button>
        </>
      )}
    </div>
  );
}
