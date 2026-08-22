import { Loader2, Check } from 'lucide-react';

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
 * Binary would have picked the wrong one of those either way: block, and we lose the member at the
 * step we already know loses the most; wave it through, and we have approved a plan on no
 * underwriting at all.
 */
export default function BankLinkStep({
  linked,
  busy,
  error,
  onConnect,
}: {
  linked: boolean;
  busy: boolean;
  error?: string | null;
  onConnect: () => void;
}) {
  if (linked) {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border-[0.5px] border-positive/40 bg-positive/10 px-3.5 py-[11px] text-[13px] text-positive">
        <Check className="h-3.5 w-3.5 shrink-0" />
        Account connected
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onConnect}
        disabled={busy}
        className="flex w-full items-center gap-2 rounded-[10px] border-[0.5px] border-border px-3.5 py-[11px] text-left text-[13px] disabled:opacity-60"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
        {busy ? 'Opening your bank…' : 'Search your bank'}
      </button>

      {error && <p className="mt-2 text-[11px] leading-relaxed text-negative">{error}</p>}
    </>
  );
}

/**
 * The way out, placed after the step's own reassurance rather than before it.
 *
 * Its own export because of where it has to sit. "Read-only, we never see your login" is what
 * answers the objection somebody is actually having at this step, and a skip wedged between the
 * button and that sentence interrupts the answer with an exit — offering the way out before
 * finishing the reason to stay.
 *
 * Quiet, left-aligned with the copy it follows, and honest about the cost. Not a second primary
 * button: this is still the step we want them to finish, and the consequence is named here rather
 * than discovered on day one.
 */
export function BankLinkSkip({
  busy,
  onSkip,
}: {
  busy: boolean;
  onSkip: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSkip}
      disabled={busy}
      className="mt-2 block text-left text-[11px] leading-relaxed text-muted-foreground underline underline-offset-2 disabled:opacity-60"
    >
      Skip — join without covering this today
    </button>
  );
}
