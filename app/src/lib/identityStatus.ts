/**
 * One identity state for the member, derived from Lithic.
 *
 * ## Why Lithic and not Bridge
 *
 * There were two "verify your identity" flows in the app — Bridge's KycModal, reachable from
 * Settings and the transfer sheet, and now Lithic's provisioning. A member could be verified in one
 * sense and not the other, and Settings would have shown two verification rows meaning different
 * things, which is a question no member can be expected to answer.
 *
 * Lithic is the one that gates what a member actually notices: lending and the card. It is also the
 * one whose sponsor bank runs the KYC we are relying on (KYC_BASIC — Program Managed). Bridge's own
 * status stays where it is and keeps gating Bridge operations; it just stops being a second answer
 * to "am I verified".
 *
 * ## The states
 *
 * Lithic returns five, three of them asynchronous. The design covers the happy path, review, and
 * the document fallback; `needs_resubmit` and `rejected` are added here because a status that can
 * come back needs somewhere to land, and a rejection is the one a member cannot fix by trying the
 * same thing again.
 */
export type IdentityState =
  | 'unavailable'
  | 'unverified'
  | 'verified'
  | 'in_review'
  | 'needs_document'
  | 'needs_resubmit'
  | 'rejected';

export interface IdentityStatus {
  state: IdentityState;
  /** What the Settings row reads. Short, because it sits at the end of a line. */
  label: string;
  /** Whether opening the verification flow can achieve anything from here. */
  actionable: boolean;
  /** The row's call to action, when there is one. */
  action?: string;
}

const BY_STATE: Record<IdentityState, Omit<IdentityStatus, 'state'>> = {
  // The integration is off. Not the member's business and not a failure of theirs, so the row says
  // nothing rather than "unverified", which would read as something they had neglected.
  unavailable: { label: '—', actionable: false },
  unverified: { label: 'Not verified', actionable: true, action: 'Verify' },
  verified: { label: 'Verified', actionable: false },
  in_review: { label: 'Under review', actionable: true, action: 'See status' },
  needs_document: { label: 'Photo needed', actionable: true, action: 'Add photo' },
  // Distinct from needs_document: something typed did not match, and a photo is not what is being
  // asked for. Re-opening the form with the fields is the only useful move.
  needs_resubmit: { label: 'Needs a correction', actionable: true, action: 'Fix details' },
  // Deliberately not actionable. Re-submitting the same details produces the same answer, and a
  // button that promises otherwise is worse than no button.
  rejected: { label: "Couldn't verify", actionable: false },
};

/**
 * Map what the server knows into what the member is shown.
 *
 * `provisioned: false` with `configured: true` is the ordinary starting state for everybody today —
 * nothing provisions a member yet — so it must read as "not started", never as an error.
 */
export function toIdentityStatus(account: {
  configured: boolean;
  provisioned: boolean;
  status?: string;
} | null): IdentityStatus {
  if (!account || !account.configured) return { state: 'unavailable', ...BY_STATE.unavailable };
  if (!account.provisioned) return { state: 'unverified', ...BY_STATE.unverified };

  const state = ((): IdentityState => {
    switch ((account.status || '').toUpperCase()) {
      case 'ACCEPTED':
        return 'verified';
      case 'PENDING_REVIEW':
        return 'in_review';
      case 'PENDING_DOCUMENT':
        return 'needs_document';
      case 'PENDING_RESUBMIT':
        return 'needs_resubmit';
      case 'REJECTED':
        return 'rejected';
      default:
        // A status we have not seen. Treated as in review rather than verified: the failure of
        // guessing wrong here is a member being told to wait, and the other way round is a member
        // being told they can borrow when nobody has said so.
        return 'in_review';
    }
  })();

  return { state, ...BY_STATE[state] };
}

/**
 * What a member can still do while verification is outstanding.
 *
 * The design is firm about this and it is the sentence that matters most on the review screen: a
 * member who has just handed over an SSN and been told to wait assumes everything is frozen.
 * Savings and Earn are their own money and need no verification, so they open immediately — which
 * turns a dead end into a waiting room.
 */
export function openWhileWaiting(state: IdentityState): { open: string[]; waiting: string[] } {
  if (state === 'verified') return { open: [], waiting: [] };
  return { open: ['Savings', 'Earn'], waiting: ['Credit', 'Card'] };
}
