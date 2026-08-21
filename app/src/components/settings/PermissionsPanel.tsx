import { useState } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Card from '@/components/clear/Card';
import type { Permission } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * What Clear can do without asking each time.
 *
 * These are granted in one signature at onboarding rather than one at a time, which spares the
 * member an approval prompt mid-task. What that costs is memory: permissions granted out of sight
 * are permissions nobody recalls agreeing to. This page is the other half of that bargain.
 *
 * Two lines a row and no more. Underneath each is an allowance with a grant date and a cap, and
 * showing those would be answering an auditor's question rather than the member's. The one figure
 * kept is the held amount.
 *
 * "Turn off", not "revoke" — revoke is the protocol's word and sounds more permanent than the
 * thing actually is. Nothing closes; Clear just asks next time.
 */
export default function PermissionsPanel({ permissions }: { permissions: Permission[] }) {
  const [off, setOff] = useState<Set<string>>(new Set());

  const granted = permissions.filter((p) => !p.held);
  const held = permissions.filter((p) => p.held);

  return (
    <>
      <p className="mb-[18px] text-xs leading-relaxed text-foreground-secondary">
        What Clear can do without asking each time.
      </p>

      {granted.length > 0 && (
        <>
          <GroupLabel>On</GroupLabel>
          <Card className="px-[15px] py-0">
            {granted.map((permission, i) => (
              <Row key={permission.id} permission={permission} last={i === granted.length - 1}>
                {off.has(permission.id) ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground">Off</span>
                ) : (
                  <Button
                    variant="clear"
                    size="xs"
                    className="shrink-0"
                    onClick={() => setOff((previous) => new Set(previous).add(permission.id))}
                  >
                    Turn off
                  </Button>
                )}
              </Row>
            ))}
          </Card>
        </>
      )}

      {held.length > 0 && (
        <>
          {/* The label answers "why can't I turn this off" before it is asked, which is why it
              carries the condition rather than just naming the group. */}
          <GroupLabel className="mt-[18px]">Held while you carry credit</GroupLabel>
          <Card className="px-[15px] py-0">
            {held.map((permission, i) => (
              <Row key={permission.id} permission={permission} last={i === held.length - 1}>
                <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border-[0.5px] border-tier-boost/30 bg-tier-boost/10 px-[9px] py-0.5 text-[10.5px] text-tier-boost-fg">
                  <Lock className="h-[11px] w-[11px]" strokeWidth={2} aria-hidden />
                  Held
                </span>
              </Row>
            ))}
          </Card>
        </>
      )}

      <div className="mt-[18px] border-t-[0.5px] border-border pt-[11px]">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Turning one off closes nothing &mdash; Clear just asks next time.
        </p>
      </div>
    </>
  );
}

/**
 * Group labels sit above their cards, never inside them — crammed against a card's top edge one
 * reads as a stray row rather than a heading.
 */
function GroupLabel({ children, className }: { children: string; className?: string }) {
  return (
    <p
      className={cn(
        'mb-[7px] text-[10px] uppercase tracking-[0.5px] text-muted-foreground',
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Every row is built the same; only what sits on the right changes. */
function Row({
  permission,
  last,
  children,
}: {
  permission: Permission;
  last: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 py-3',
        !last && 'border-b-[0.5px] border-border',
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-[13px]">{permission.label}</p>
        <p className="mt-[3px] text-[11px] leading-[1.5] text-muted-foreground">
          {permission.detail}
        </p>
      </div>
      {children}
    </div>
  );
}
