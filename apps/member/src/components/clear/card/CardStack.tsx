import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The wallet: the selected card in front, the rest behind it and a little below, faded back.
 *
 * The stack is swiped, so the cards behind only have to say that they exist — showing more of them
 * costs height and buys nothing. Two behind is the whole depth the guide draws; a wallet of six
 * looks the same as a wallet of three, and the marker underneath is what says how many there are.
 *
 * That marker stretches to the card you are on rather than filling in, so it reads as a position
 * rather than as progress through something.
 */
export default function CardStack({
  count,
  index,
  onIndexChange,
  children,
  label = 'Your cards',
}: {
  count: number;
  index: number;
  onIndexChange: (index: number) => void;
  /** The faces, front first. Only the first three are drawn; the rest are behind those. */
  children: ReactNode[];
  label?: string;
}) {
  const [drag, setDrag] = useState(0);
  /** Where the finger went down, and whether this gesture has been claimed as a swipe. */
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiping = useRef(false);
  /*
   * How far it has travelled, kept beside the state rather than read from it.
   *
   * A flick can put the move and the up in one frame, and state read at the end of that frame is
   * still zero — the card springs back and the swipe does nothing, which reads as an unreliable
   * gesture rather than a fast one.
   */
  const travelled = useRef(0);

  const go = (delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= count) return;
    onIndexChange(next);
  };

  const end = () => {
    // Forty pixels is far enough to mean it; less springs back.
    if (swiping.current) {
      if (travelled.current < -40) go(1);
      else if (travelled.current > 40) go(-1);
    }
    start.current = null;
    swiping.current = false;
    travelled.current = 0;
    setDrag(0);
  };

  return (
    <div>
      <div
        className="c-cardstack"
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return;
          start.current = { x: e.clientX, y: e.clientY };
          swiping.current = false;
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const dx = e.clientX - start.current.x;
          const dy = e.clientY - start.current.y;
          /*
           * A gesture belongs to one axis. Until it is clear which, the card does not move: a
           * finger heading down the page is scrolling, and a stack that grabbed it left the card
           * translated with nothing to put it back — which is what "the swiping is broken" looked
           * like. Sideways claims the pointer, so the up always arrives here.
           */
          if (!swiping.current) {
            if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
            swiping.current = true;
            try {
              // Best effort: a browser that will not hand over the pointer still gets a swipe, it
              // just relies on the up landing here rather than being guaranteed it.
              e.currentTarget.setPointerCapture?.(e.pointerId);
            } catch {
              /* not capturable */
            }
          }
          travelled.current = dx;
          setDrag(dx);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      >
        {/* Front and one behind. The marker under the stack is what says how many there are, so
            more layers cost height and say nothing the dots have not already said. */}
        {children.slice(0, 2).map((face, i) => (
          <div
            key={i}
            className={cn(i === 0 ? 'c-sel' : 'c-b1')}
            style={
              // Only the card in front follows the finger: the one behind it is not being moved,
              // it is being revealed.
              i === 0 && drag !== 0
                ? { transform: `translateX(${drag}px)`, transition: 'none' }
                : undefined
            }
          >
            {face}
          </div>
        ))}
      </div>
      {count > 1 && (
        <div className="c-stackdots" role="tablist" aria-label={label}>
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Card ${i + 1} of ${count}`}
              className={cn(i === index && 'c-on')}
              onClick={() => onIndexChange(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
