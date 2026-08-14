import { useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Card from '@/components/clear/Card';
import Modal from '@/components/clear/Modal';
import InfoBlock from '@/components/clear/InfoBlock';
import type { SettingsData } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Acceleration — paying to reach benefits sooner.
 *
 * The comparison table is the honest version of the pitch: every accelerated
 * value sits next to the standard one you'd reach anyway, so it reads as a
 * shortcut rather than a gate. The note underneath says how close you already
 * are, which is the fact most likely to talk someone out of it — and belongs
 * here for exactly that reason.
 */
export default function AccelerationDialog({
  data,
  open,
  onOpenChange,
}: {
  data: SettingsData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [plan, setPlan] = useState(data.accelerationPlans[1]?.id ?? data.accelerationPlans[0]?.id);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Acceleration"
      description="Compare standard and accelerated membership before turning it on."
    >
      <p className="mb-3.5 text-xs text-foreground-secondary">
        Benefits you&rsquo;d earn through saving and clean cycles — available now instead.
      </p>

      <Card className="mb-3 overflow-hidden p-0">
        <div className="grid grid-cols-[1fr_74px_74px] border-b-[0.5px] border-border px-3.5 py-2.5 text-[11px] text-muted-foreground">
          <span />
          <span className="text-right">Standard</span>
          <span className="text-right text-tier-boost-fg">Accelerated</span>
        </div>

        <div className="text-xs">
          {data.accelerationBenefits.map((benefit, i) => (
            <div
              key={benefit.label}
              className={cn(
                'grid grid-cols-[1fr_74px_74px] items-center px-3.5 py-2.5',
                i < data.accelerationBenefits.length - 1 && 'border-b-[0.5px] border-border',
              )}
            >
              <span>{benefit.label}</span>
              <span className="text-right text-muted-foreground">{benefit.standard}</span>
              <span className="flex justify-end text-right">
                {benefit.acceleratedOnly ? (
                  <CircleCheck className="h-[15px] w-[15px] text-tier-savings-fg" strokeWidth={1.75} />
                ) : (
                  benefit.accelerated
                )}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <div className="mb-3 flex gap-2">
        {data.accelerationPlans.map((option) => (
          <Button
            key={option.id}
            variant="clear"
            size="xs"
            aria-pressed={plan === option.id}
            onClick={() => setPlan(option.id)}
            className={cn('h-8 flex-1', plan === option.id && 'border-tier-boost text-tier-boost-fg')}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <InfoBlock className="mb-3.5">
        You&rsquo;re {data.accelerationCyclesToBoost} clean cycles from the Boost increase anyway.
        Acceleration is a shortcut, not the only route.
      </InfoBlock>

      <Button size="xs" className="w-full">
        Turn on acceleration
      </Button>
      <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
        Cancel any time. Your vote is unaffected either way.
      </p>
    </Modal>
  );
}
