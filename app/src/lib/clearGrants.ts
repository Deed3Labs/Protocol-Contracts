import type { ClearContracts } from '@/lib/clearNetwork';

/**
 * The standing permissions a member grants once, at onboarding, in a single confirmation.
 *
 * Every one of these was previously granted lazily, at the moment it was first needed. That is
 * worse in two ways and only looks safer. It interrupts the member mid-task, and for an external
 * wallet the approve is a real, user-paid transaction -- so the first time somebody moves savings
 * back to cash, an operation the app calls free, they are asked to pay for a transaction they did
 * not ask for. Bundling them removes both.
 *
 * What bundling costs is memory: permissions granted out of sight are permissions nobody recalls
 * agreeing to. That is why this list is data rather than a sequence of calls -- the Permissions
 * page in settings renders the same definitions the grant is built from, so what a member is shown
 * afterwards cannot drift from what they actually gave.
 *
 * All of these are to Clear's own contracts. None of them lets Clear move money on its own: an
 * allowance is permission for a contract to be *told* to move the member's tokens, and every such
 * instruction still originates with the member. The one thing that does hold their money without
 * asking each time -- savings pledged against a drawn credit line -- is not in this list, because
 * it is not an allowance at all. It is enforced by CLRUSD itself, which is why it cannot be
 * revoked and why the panel shows it with a reason instead of a button.
 */
export interface ClearGrant {
  id: string;
  /** What it lets Clear do, in the member's words. */
  label: string;
  /** What breaks without it. */
  detail: string;
  /** Which token's allowance this is. */
  token: keyof Pick<ClearContracts, 'usdc' | 'clrusd'>;
  /** Which contract may be told to move it. */
  spender: keyof Pick<ClearContracts, 'esaVault' | 'claimEscrow'>;
}

export const CLEAR_GRANTS: ClearGrant[] = [
  {
    id: 'savings-in',
    label: 'Move money into savings',
    detail: 'Deposits and automatic saving. Without it, every transfer asks you to approve it first.',
    token: 'usdc',
    spender: 'esaVault',
  },
  {
    id: 'savings-out',
    label: 'Move savings back to cash',
    detail: 'Redeeming savings. Granted up front so the first one costs you nothing.',
    token: 'clrusd',
    spender: 'esaVault',
  },
  {
    id: 'send',
    label: 'Hold money you send until it is claimed',
    detail: 'Money you send sits in escrow until the recipient claims it, or comes back to you.',
    token: 'usdc',
    spender: 'claimEscrow',
  },
];
