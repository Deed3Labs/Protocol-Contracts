// @ts-nocheck: the shell's helpers are untyped, as the sections are.
import { pageModFor } from './pageHost';
import { S } from './data';
import { go, vLevel, vScrub } from './shell';

/**
 * The bridge between the redesign's page modules and the shell (the reference's CC): going to a page
 * (and a tab on it), which page is shown, the viewer's level on a page, whether they're previewing a
 * view, and the Totals scrub.
 */
export const CC = {
  go(r: string, p?: string) {
    if (p) pageModFor(r === 'contracts' ? 'build' : r)?.setTab(r === 'contracts' ? 'build' : r, p);
    go(r);
  },
  route: () => S.route,
  level: (page: string) => vLevel(page),
  viewing: () => !!S.view,
  scrub: (root) => vScrub(root),
};
