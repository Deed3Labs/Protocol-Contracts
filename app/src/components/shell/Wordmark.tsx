import { NavLink } from 'react-router-dom';

/**
 * The wordmark and mark, as one link home.
 *
 * Shared by the desktop bar and the mobile header so the lockup can't drift between them.
 *
 * The mark's corners are a superellipse, not a circular arc: `border-radius` alone gives four
 * quarter-circles that meet the straight edges at a visible break, which is what makes a rounded
 * square look tacked-on next to type. `corner-shape` smooths that junction. Browsers without it fall
 * back to the plain 22.37% rounding, which is the same silhouette a fraction less refined.
 *
 * The hairline is what keeps the mark from dissolving into a light page — the artwork's own
 * background is nearly white.
 */
export default function Wordmark({ className }: { className?: string }) {
  return (
    <NavLink
      to="/"
      className={`flex items-center gap-2 text-[15px] font-medium leading-none text-foreground ${className ?? ''}`}
    >
      {/* Mark first, wordmark second — the lockup reads left to right like any app bar. */}
      <img
        src="/ClearPath-Logo.png"
        alt=""
        aria-hidden
        className="h-7 w-7 shrink-0 rounded-[22.37%] border border-black/10 object-cover [corner-shape:squircle]"
      />
      Clear
    </NavLink>
  );
}
