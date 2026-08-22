import { useId, useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { getSvgPath } from 'figma-squircle';

/** Apple's icon proportions: the corner runs 22.37% of the side, smoothed 60%. */
const RADIUS_RATIO = 0.2237;
const SMOOTHING = 0.6;
const SIZE = 28;
const STROKE = 1;

/**
 * The wordmark and mark, as one link home.
 *
 * Shared by the desktop bar and the mobile header so the lockup can't drift between them.
 *
 * The mark is masked to a **real squircle**, not a rounded rectangle. `border-radius` draws four
 * quarter-circles that meet the straight edges at a curvature break, and CSS `corner-shape` only
 * gets as far as a superellipse — neither is the shape Apple uses, which blends into the edge over a
 * much longer run than its radius suggests. `figma-squircle` generates the same path Figma's corner
 * smoothing does, which is the construction that reproduces it.
 *
 * The outline is a stroke on that same path rather than a CSS border, because a border would follow
 * the element's box and ignore the mask. It's generated one stroke-width smaller and offset by half
 * of it, so the whole line sits inside the shape instead of straddling its edge.
 */
export default function Wordmark({ className }: { className?: string }) {
  const clipId = useId();

  const { maskPath, strokePath } = useMemo(
    () => ({
      maskPath: getSvgPath({
        width: SIZE,
        height: SIZE,
        cornerRadius: SIZE * RADIUS_RATIO,
        cornerSmoothing: SMOOTHING,
        preserveSmoothing: true,
      }),
      strokePath: getSvgPath({
        width: SIZE - STROKE,
        height: SIZE - STROKE,
        cornerRadius: (SIZE - STROKE) * RADIUS_RATIO,
        cornerSmoothing: SMOOTHING,
        preserveSmoothing: true,
      }),
    }),
    [],
  );

  return (
    <NavLink
      to="/"
      className={`flex items-center gap-2 text-[15px] font-medium leading-none text-foreground ${className ?? ''}`}
    >
      {/* Mark first, wordmark second — the lockup reads left to right like any app bar. */}
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="shrink-0"
        aria-hidden
        focusable="false"
      >
        <defs>
          <clipPath id={clipId}>
            <path d={maskPath} />
          </clipPath>
        </defs>
        <image
          href="/ClearPath-Logo.png"
          width={SIZE}
          height={SIZE}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clipId})`}
        />
        <g transform={`translate(${STROKE / 2} ${STROKE / 2})`}>
          <path d={strokePath} fill="none" stroke="rgb(0 0 0 / 0.1)" strokeWidth={STROKE} />
        </g>
      </svg>
      Clear
    </NavLink>
  );
}
