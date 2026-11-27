import { useState } from 'react';
import { Btn, CFoot, CHead, CMain, Cell, Line, Rows, SecHead } from './brand/anatomy';
import Switch from './brand/Switch';
import { money } from '@clear/domain';
import type { CardControl } from '@/lib/clearModel';

/**
 * Controls — switches rather than a freeze: freezing stops everything, and most of what people want
 * is narrower ("never let this card work abroad"). The two limits are the footer, because they are
 * facts about the controls above them, read far more often than they are changed.
 */
export default function CardControlsCard({
  controls,
  perTransactionLimit,
  perDayLimit,
  onAdjustLimits,
}: {
  controls: CardControl[];
  perTransactionLimit: number;
  perDayLimit: number;
  onAdjustLimits?: () => void;
}) {
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(controls.map((c) => [c.id, c.on])));
  const onCount = controls.filter((c) => on[c.id]).length;

  return (
    <Cell>
      <CHead>
        <SecHead label="Controls">
          <span className="c-det">
            {onCount} of {controls.length} on
          </span>
        </SecHead>
      </CHead>
      <CMain>
        <Rows>
          {controls.map((control) => (
            <div key={control.id}>
              <Line className="items-center!">
                <label htmlFor={`control-${control.id}`} className="text-sec">
                  {control.label}
                </label>
                <Switch
                  id={`control-${control.id}`}
                  checked={on[control.id] ?? false}
                  onCheckedChange={(v) => setOn((prev) => ({ ...prev, [control.id]: v }))}
                />
              </Line>
            </div>
          ))}
        </Rows>
      </CMain>
      <CFoot>
        <Line>
          <span className="c-sub">Per transaction</span>
          <span className="c-fig c-fig-row">{money(perTransactionLimit, { cents: true })}</span>
        </Line>
        <Line className="mt-[6px]">
          <span className="c-sub">Per day</span>
          <span className="c-fig c-fig-row">{money(perDayLimit, { cents: true })}</span>
        </Line>
        <Btn lg className="mt-s2" onClick={onAdjustLimits}>
          Adjust limits
        </Btn>
      </CFoot>
    </Cell>
  );
}
