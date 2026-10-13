import AutoSaveDialog from './AutoSaveDialog';
import { useAutoSave } from '@/hooks/useAutoSave';
import type { SavingsData } from '@/lib/clearModel';

/**
 * The auto-save dialog wired to the member's autopay rule. The dialog stays presentational; this is
 * where turning it on or off actually happens, and it closes only once the change is in place.
 */
export default function ConnectedAutoSave({
  data,
  open,
  onOpenChange,
}: {
  data: SavingsData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { busy, error, turnOn, turnOff, clearError } = useAutoSave();

  return (
    <AutoSaveDialog
      data={data}
      open={open}
      onOpenChange={(next) => {
        if (busy) return; // a signature is out; closing would hide where it lands
        if (!next) clearError();
        onOpenChange(next);
      }}
      busy={busy}
      error={error}
      onTurnOn={async (amount, cadence) => {
        if (cadence === 'payday') return; // not offered: see AutoSaveDialog
        if (await turnOn(amount, cadence)) onOpenChange(false);
      }}
      onTurnOff={async () => {
        if (await turnOff()) onOpenChange(false);
      }}
    />
  );
}
