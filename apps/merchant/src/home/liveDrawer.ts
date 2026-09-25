import type { CountsView, DrawerSession, OwnCount } from '@clear/merchant-contracts';
import { clockTime, firstName, type DrawerPrompt } from './model';

/**
 * A live shop's drawer on Home (UI Phase 6, step 6): what the panel says and which sheet its button
 * opens, from the drawer session and the counts as this person may see them. Blind: no figure is
 * named until both counts are in (the server's CountsView holds that line; this only words it).
 */

export type DrawerStep =
  | { kind: 'open' }
  | { kind: 'count'; which: 'first' | 'second' }
  /** This person counted; the second count is someone else's. */
  | { kind: 'wait' }
  | { kind: 'result'; view: Extract<CountsView, { state: 'disagree' | 'compared' }> }
  | { kind: 'close' };

export function drawerStep(session: DrawerSession | null, view: CountsView | null, viewer: string): DrawerStep {
  if (!session) return { kind: 'open' };
  if (!view || view.state === 'awaiting_first') return { kind: 'count', which: 'first' };
  if (view.state === 'awaiting_second') return view.mine?.counter === viewer ? { kind: 'wait' } : { kind: 'count', which: 'second' };
  if (view.state === 'disagree' || view.signoffNeeded) return { kind: 'result', view };
  return { kind: 'close' };
}

const counterName = (c: OwnCount | null | undefined, names: Map<string, string>) => (c ? firstName(names.get(c.counter) ?? 'Someone') : 'Someone');

export function drawerPrompt(session: DrawerSession | null, view: CountsView | null, viewer: string, names: Map<string, string>): DrawerPrompt {
  const step = drawerStep(session, view, viewer);
  if (step.kind === 'open' || !session) return { t: 'Not open yet', det: 'Open it with the starting cash before the first cash sale.', cta: 'Open the drawer' };
  const t = `Open since ${clockTime(session.openedAt)}`;
  switch (step.kind) {
    case 'count':
      return step.which === 'first'
        ? { t, det: 'Two blind counts at close: neither sees the other’s, or what it should hold.', cta: 'Count the drawer' }
        : { t, det: 'One count is in, hidden. The second is yours.', cta: 'Count the drawer' };
    case 'wait':
      return { t, det: 'You’ve counted. The second count is someone else’s.' };
    case 'result':
      return step.view.state === 'disagree'
        ? { t, det: 'The two counts disagree. One of you counts again.', cta: 'See the counts' }
        : { t, det: `${counterName(step.view.counts[0], names)} and ${counterName(step.view.counts[1] ?? step.view.counts[0], names)} agree; it doesn’t match. A manager signs it off.`, cta: 'See the counts' };
    case 'close':
      return { t, det: 'Counted and settled. Close the day to lock it.', cta: 'Close the day' };
  }
}
