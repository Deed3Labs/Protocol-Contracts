import { useState } from 'react';
import { Button } from '@/components/ui/button';
import Card, { CardRule } from './Card';
import ToggleRows from './ToggleRows';
import { money } from '@clear/domain';
import type { CardData } from '@/lib/clearModel';

/**
 * Card controls — design spec §9.
 *
 * Switches rather than a freeze: freezing stops everything, and most of what
 * people actually want is narrower ("never let this card work abroad"). The two
 * limits sit under them because they're the same kind of decision, read far more
 * often than they're changed.
 */
export default function CardControlsCard({
  card,
  onAdjustLimits,
}: {
  card: CardData;
  onAdjustLimits?: () => void;
}) {
  const [rows] = useState(() =>
    card.controls.map((c) => ({ id: c.id, label: c.label, defaultOn: c.on })),
  );

  return (
    <Card>
      <p className="mb-0.5 text-xs text-foreground-secondary">Controls</p>

      <ToggleRows rows={rows} />

      <CardRule className="text-xs">
        <div className="flex items-baseline justify-between gap-3 leading-[1.9]">
          <span className="text-foreground-secondary">Per transaction</span>
          <span className="tabular-nums">{money(card.perTransactionLimit)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3 leading-[1.9]">
          <span className="text-foreground-secondary">Per day</span>
          <span className="tabular-nums">{money(card.perDayLimit)}</span>
        </div>
      </CardRule>

      <Button variant="clear" size="xs" className="mt-3 w-full" onClick={onAdjustLimits}>
        Adjust limits
      </Button>
    </Card>
  );
}
