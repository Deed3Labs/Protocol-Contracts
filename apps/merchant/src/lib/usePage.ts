import { useEffect } from 'react';

/** The ten reference files, by name. */
export type ReferencePage =
  | 'home'
  | 'new-charge'
  | 'inventory'
  | 'staff'
  | 'charges'
  | 'settings'
  | 'payouts'
  | 'overview'
  | 'onboarding'
  | 'sign-in';

/**
 * Marks which reference page is on screen, as `c-page-<name>` on <html>.
 *
 * Some reference rules belong to one page but are written against shared classes (Inventory's
 * equal slab columns, Home's footers), and the stylesheet scopes them under this class
 * (scripts/reference-css.mjs). On <html>, so sheets opened in a portal get them too.
 */
export function usePage(page: ReferencePage | null) {
  useEffect(() => {
    // The gallery shows several pages at once and scopes each section itself.
    if (!page || document.documentElement.dataset.gallery) return;
    const cls = `c-page-${page}`;
    document.documentElement.classList.add(cls);
    return () => document.documentElement.classList.remove(cls);
  }, [page]);
}
