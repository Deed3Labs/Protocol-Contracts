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
  const start = useRef<number | null>(null);

  const go = (delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= count) return;
    onIndexChange(next);
  };

  return (
    <div>
      <div
        className="c-cardstack"
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return;
          start.current = e.clientX;
        }}
        onPointerMove={(e) => {
          if (start.current === null) return;
          setDrag(e.clientX - start.current);
        }}
        onPointerUp={() => {
          if (start.current === null) return;
          // A third of the card's width is far enough to mean it; less springs back.
          if (drag < -40) go(1);
          else if (drag > 40) go(-1);
          start.current = null;
          setDrag(0);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDrag(0);
        }}
      >
        {children.slice(0, 3).map((face, i) => (
          <div
            key={i}
            className={cn(i === 0 && 'c-sel', i === 1 && 'c-b1', i === 2 && 'c-b2')}
            style={
              // Only the card in front follows the finger: the ones behind it are not being moved,
              // they are being revealed.
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
