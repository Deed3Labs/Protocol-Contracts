import { Rows } from '@/components/clear/brand/anatomy';

/**
 * Connecting an account, presented as a step rather than a settings action.
 *
 * The reference calls this required, and in the same breath calls it the likeliest drop-off point.
 * Those pull in opposite directions and the plan left the tension open (§6.4). Resolved here as
 * **required for the plan, not for the membership**:
 *
 * A bank link is the underwriting, the repayment rail and the limit calculation at once, so there
 * is no honest way to extend a term plan without one — the split screen after this step cannot be
 * reached. But it is not what makes somebody a member. Skipping lands them on a savings-first day
 * one with the plan locked and the shop told nothing was approved, which is the true outcome, and
 * leaves them a member who can link an account later instead of a signup we lost at the counter.
 *
 * The step states all three reasons rather than asking for trust, and the connect action itself
 * belongs to the panel's footer, where every other step keeps its action.
 */
const REASONS = [
  { title: 'It sets your limit', body: 'From income landing and what already goes out' },
  { title: 'It is how the plan clears', body: 'Balance first, then this account' },
  {
    title: 'Read-only',
    body: 'Clear cannot move money out of it except to clear a plan',
  },
];

export default function BankLinkStep({
  linked,
  error,
}: {
  linked: boolean;
  busy?: boolean;
  error?: string | null;
  onConnect?: () => void;
}) {
  if (linked) {
    return (
      <p className="text-sec text-settled">Account connected</p>
    );
  }

  return (
    <>
      <Rows>
        {REASONS.map((reason) => (
          <div key={reason.title}>
            <p className="text-sec">{reason.title}</p>
            <p className="c-det mt-[3px]">{reason.body}</p>
          </div>
        ))}
      </Rows>
      {error && <p className="c-det c-errline mt-s2">{error}</p>}
    </>
  );
}

/**
 * The way out, placed after the step's own reassurance rather than before it.
 *
 * Its own export because of where it has to sit. The three reasons are what answer the objection
 * somebody is actually having at this step, and a skip wedged in among them interrupts the answer
 * with an exit — offering the way out before finishing the reason to stay.
 *
 * Quiet and honest about the cost. Not a second button: this is still the step we want them to
 * finish, and the consequence is named here rather than discovered on day one.
 */
export function BankLinkSkip({ busy, onSkip }: { busy: boolean; onSkip: () => void }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      disabled={busy}
      className="c-det mt-s1 block w-full text-center underline underline-offset-2 disabled:opacity-60"
    >
      Skip — join without covering this today
    </button>
  );
}
