import { Button } from '@/components/ui/button';
import type { SetupTask } from '@/lib/clearModel';

/**
 * Setup nudge under the balance — design spec §4. Renders the first outstanding
 * task and disappears once everything is done.
 */
export default function TaskStrip({ tasks, onAction }: { tasks: SetupTask[]; onAction?: (id: string) => void }) {
  const next = tasks.find((t) => !t.done);
  if (!next) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-tier-boost/10 px-3.5 py-2.5">
      <span className="text-[13px] text-tier-boost-fg">{next.label}</span>
      {/* Button border: the default hairline disappears against the tint, so it
          borrows the accent's own edge. */}
      {next.cta && (
        <Button variant="clear" size="xs" className="border-tier-boost/30" onClick={() => onAction?.(next.id)}>
          {next.cta}
        </Button>
      )}
    </div>
  );
}
