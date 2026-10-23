// @ts-nocheck: writes into the sections' untyped data (src/sections/data.tsx).
import { BATCH_DATE, B_ACT, B_OPEN, MEMBERS, vars } from '../sections/data';
import { api } from './api';
import { LIVE } from './env';
import { setFigures } from './figures';

/*
 * Sections whose rows and figures come from the API (Phase 3). Each one loads the first time it's
 * opened; until then the page shows the prototype's loading state. Sections not listed here still
 * draw the prototype's demo data.
 */
export const SERVED = new Set(['members']);
const ready = new Set<string>();

export const needsData = (route: string) => LIVE && SERVED.has(route) && !ready.has(route);

const replace = (arr, rows) => arr.splice(0, arr.length, ...rows);

const apply = {
  members(d) {
    replace(MEMBERS, d.MEMBERS);
    replace(BATCH_DATE, d.BATCH_DATE);
    replace(B_ACT, d.B_ACT);
    replace(B_OPEN, d.B_OPEN);
    vars.NEXT_BATCH = d.NEXT_BATCH;
    vars.namesShown = d.names === 'shown';
  },
};

export async function loadSection(route: string, opts: { reveal?: boolean } = {}) {
  const d = await api('GET', `/sections/${route}${opts.reveal ? '?reveal=1' : ''}`);
  apply[route](d);
  setFigures(d.figures);
  vars.asOf = d.asOf;
  ready.add(route);
}

/** Signing out forgets what was loaded, so the next person's view loads their own. */
export const forgetSections = () => ready.clear();
