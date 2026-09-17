import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  const box = useRef<HTMLDivElement>(null);
  /*
   * A readout for a phone, behind ?swipe=debug.
   *
   * This has now been fixed twice from a laptop and reported broken twice from a phone, which means
   * the thing to do is stop guessing and let the device say what it saw. Off unless asked for, and
   * it comes out once the answer is known.
   */
  const [log, setLog] = useState<string[]>([]);
  const debug = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('swipe') === 'debug';
  const note = (line: string) => {
    if (debug) setLog((prev) => [...prev.slice(-5), line]);
  };

  /*
   * Hold the gesture once it is ours.
   *
   * touch-action says a sideways drag is not a scroll, and on a mouse that is the end of it — which
   * is why this worked on a desktop and not on a phone. A touch browser still decides for itself
   * partway through, and the moment it decides to scroll it takes the pointer back: the drag ends
   * mid-swipe and the card springs home. Saying no to the default on a claimed swipe is what stops
   * that, and it has to be a listener we attach ourselves, because React's are passive and cannot.
   */
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const hold = (e: TouchEvent) => {
      if (swiping.current && e.cancelable) e.preventDefault();
      if (swiping.current && !e.cancelable) note('touchmove not cancelable');
    };
    el.addEventListener('touchmove', hold, { passive: false });
    return () => el.removeEventListener('touchmove', hold);
    // `note` only writes to the debug readout, and rebinding this listener per render would be a
    // real cost for a line of text nobody sees unless they asked for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        ref={box}
        className="c-cardstack"
        onPointerDown={(e) => {
          // A mouse drags it too: the stack has no hover affordance the way a swiped row does, so
          // ignoring pointer devices left a desktop member with only the dots.
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          start.current = { x: e.clientX, y: e.clientY };
          swiping.current = false;
          note(`down ${e.pointerType}`);
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
            note(`move ${Math.round(dx)},${Math.round(dy)}`);
            // Four pixels rather than eight: a browser decides which way a gesture is going early,
            // and the later this claims it the more chances there are to lose it.
            if (Math.abs(dx) < 4 || Math.abs(dx) < Math.abs(dy)) return;
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
        onPointerUp={() => {
          note('up');
          end();
        }}
        onPointerCancel={() => {
          note('CANCEL');
          end();
        }}
        onLostPointerCapture={() => {
          note('lost capture');
          end();
        }}
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
      {debug && (
        <pre className="c-det mt-s1 whitespace-pre-wrap text-[10px]">
          {`claim ≥4px · ${getComputedStyle(box.current ?? document.body).touchAction}\n${log.join('\n')}`}
        </pre>
      )}
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
