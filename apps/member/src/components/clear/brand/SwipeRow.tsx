import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * What a swipe can do to a row.
 *
 * `lead` is what you would actually do, and it takes the ink; `dismiss` stays quiet; `danger` takes
 * the red, which marks irreversible rather than disapproved.
 */
export interface SwipeAction {
  key: string;
  label: string;
  tone?: 'lead' | 'dismiss' | 'danger';
  onSelect?: () => void;
}

/** Two actions are 78px each; three are 62, which is what lets a third fit. */
const WIDTH = { two: 78, three: 62 };

/**
 * A row that slides to show what can be done to it.
 *
 * The content moves with the swipe and the actions follow it in at full row height. The row carries
 * its own padding rather than the section carrying it, so it slides its own ground: nothing shows
 * through at the edges and the actions reach the panel's. A pointer gets the same set on hover,
 * which is the CSS in clear-components; this handles the drag.
 *
 * A drag is not a tap: once the finger has moved, the click that follows is swallowed, so swiping a
 * row never opens whatever tapping it would.
 */
export default function SwipeRow({
  actions,
  children,
  className,
}: {
  actions: SwipeAction[];
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const moved = useRef(false);

  const reveal = actions.length * (actions.length > 2 ? WIDTH.three : WIDTH.two);
  // How far open the row is right now: its resting state, moved by the finger.
  const shown = Math.min(reveal, Math.max(0, (open ? reveal : 0) - drag));
  const dragging = drag !== 0;

  return (
    <div className={cn('c-swiped', open && 'c-open', className)} style={{ ['--reveal' as string]: `${reveal}px` }}>
      <div
        className="c-sbody"
        style={dragging ? { transform: `translateX(${-shown}px)`, transition: 'none' } : undefined}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return;
          start.current = e.clientX;
          moved.current = false;
        }}
        onPointerMove={(e) => {
          if (start.current === null) return;
          const delta = e.clientX - start.current;
          if (Math.abs(delta) > 6) moved.current = true;
          setDrag(delta);
        }}
        onPointerUp={() => {
          if (start.current === null) return;
          // A third of the way is far enough to mean it; less springs back.
          if (drag < -reveal / 3) setOpen(true);
          else if (drag > reveal / 3) setOpen(false);
          start.current = null;
          setDrag(0);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDrag(0);
        }}
        onClickCapture={(e) => {
          // A swipe, or a tap on an open row, belongs to the row rather than to what is inside it.
          if (!moved.current && !open) return;
          e.preventDefault();
          e.stopPropagation();
          moved.current = false;
          setOpen(false);
        }}
      >
        {children}
      </div>
      <div
        className={cn('c-sacts', actions.length > 2 && 'c-three')}
        style={dragging ? { transform: `translateX(${reveal - shown}px)`, transition: 'none' } : undefined}
      >
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            className={cn('c-sact', `c-${action.tone ?? 'dismiss'}`)}
            onClick={() => {
              setOpen(false);
              action.onSelect?.();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
