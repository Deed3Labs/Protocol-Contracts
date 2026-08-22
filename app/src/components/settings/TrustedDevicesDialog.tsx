import { Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Modal from '@/components/clear/Modal';
import { CardRule } from '@/components/clear/Card';
import type { TrustedDevice } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Trusted devices — the ones that skip the code.
 *
 * The device you're on is labelled rather than given a Remove button: signing
 * yourself out from here would be a trap, and "Sign out everywhere else" is the
 * action someone actually wants when they've lost a laptop.
 */
export default function TrustedDevicesDialog({
  devices,
  open,
  onOpenChange,
}: {
  devices: TrustedDevice[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Trusted devices"
      description="Devices that can sign in without a code."
    >
      <p className="mb-3.5 text-xs text-foreground-secondary">
        Devices that can sign in without a code.
      </p>

      <div className="text-[13px]">
        {devices.map((device, i) => (
          <div
            key={device.id}
            className={cn(
              'flex items-center justify-between gap-3 py-2.5',
              i < devices.length - 1 && 'border-b-[0.5px] border-border',
            )}
          >
            <span className="flex min-w-0 gap-2.5">
              <Smartphone
                className="mt-px h-[15px] w-[15px] shrink-0 text-foreground-secondary"
                strokeWidth={1.75}
              />
              <span className="min-w-0">
                <span className="block truncate">{device.name}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {device.detail}
                </span>
              </span>
            </span>

            {device.current ? (
              <span className="shrink-0 text-[11px] text-tier-savings-fg">This device</span>
            ) : (
              <Button variant="clear" size="xs" className="shrink-0">
                Remove
              </Button>
            )}
          </div>
        ))}
      </div>

      <CardRule>
        <Button variant="clear" size="xs" className="w-full">
          Sign out everywhere else
        </Button>
      </CardRule>
    </Modal>
  );
}
