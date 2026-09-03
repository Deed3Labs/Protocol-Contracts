import { Landmark, Zap } from 'lucide-react';
import Modal from './Modal';
import InfoBlock from './InfoBlock';

/**
 * Link a bank account.
 *
 * Two routes, both offered plainly with what they cost in time — instant sign-in
 * or routing and account numbers. The manual option isn't hidden behind "having
 * trouble?": plenty of people won't hand over bank credentials to an app, and
 * that's a reasonable position, not a failure state.
 */
export default function LinkAccountDialog({
  open,
  onOpenChange,
  onConnect,
  onManual,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect?: () => void;
  onManual?: () => void;
}) {
  const options = [
    {
      id: 'instant',
      icon: Zap,
      label: 'Connect instantly',
      detail: 'Sign in to your bank · takes a minute',
      onSelect: onConnect,
    },
    {
      id: 'manual',
      icon: Landmark,
      label: 'Enter details manually',
      detail: 'Routing and account number · 1–2 days',
      onSelect: onManual,
    },
  ];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Link an account"
      description="Connect a bank account instantly or enter the details by hand."
    >
      <p className="mb-3.5 text-xs text-foreground-secondary">
        We use your bank to verify income and pull scheduled savings.
      </p>

      <div className="mb-3.5 flex flex-col gap-2">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={option.onSelect}
            className="flex items-center gap-3 rounded-[10px] border-[0.5px] border-border px-3.5 py-3 text-left transition-colors hover:bg-secondary/60"
          >
            <option.icon
              aria-hidden
              className="h-4 w-4 shrink-0 text-foreground-secondary"
              strokeWidth={1.75}
            />
            <span className="min-w-0">
              <span className="block truncate text-[13px]">{option.label}</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {option.detail}
              </span>
            </span>
          </button>
        ))}
      </div>

      <InfoBlock tone="neutral" className="text-[11px]">
        We never store your bank password, and we never move money without you asking.
      </InfoBlock>
    </Modal>
  );
}
