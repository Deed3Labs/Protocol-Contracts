// @ts-nocheck: reads the section data the API fills, which is untyped, as the sections are.
import { vars } from './data';

/*
 * Community's datasets, live (community2.tsx reads these in place of the reference's when REAL). The API
 * has no community section yet: no forum (threads, posts, flags), no events or requests to host, no
 * channel (Dial's schedule, library and viewers) and no count of who takes part. So every list is empty
 * and every figure is left out, never the reference's (docs/ui-redesign-plan.md, gaps). The one real
 * figure is how many members there are, from Home's member summary when it has loaded.
 */

const DAY = 864e5;
const initials = (n) =>
  (n || '?')
    .split(/[ @.,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

export function communityLive() {
  const NOW = Date.now();
  const TODAY = Math.floor(NOW / DAY) * DAY;
  const me = vars.me;
  /** Community reads Governance's level until it has its own (shell.tsx vLevel); the empty preview has no one signed in. */
  const can = () => !me || Number(me.levels?.governance ?? 0) >= 3;
  const active = vars.memberSummary?.active;
  return {
    NOW,
    TODAY,
    me: 'me',
    can,
    PPL: { me: me ? { n: me.name || me.email, ini: initials(me.name || me.email), role: 'You', staff: true } : { n: 'You', ini: 'ME', role: 'You', staff: true } },
    /** Active members, or null when Home's summary hasn't loaded. */
    MEMBERS: active != null && Number.isFinite(Number(active)) ? Number(active) : null,
  };
}
