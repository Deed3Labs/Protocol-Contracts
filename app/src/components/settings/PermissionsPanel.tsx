import { useState } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import InfoBlock from '@/components/clear/InfoBlock';
import type { Permission } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * What Clear can do without asking again — and how to stop it.
 *
 * These are granted in one signature at onboarding rather than one at a time,
 * which is the right trade for the member (no approval prompt in the middle of
 * their first redemption) and the wrong one for their memory of what they
 * agreed to. This page is the other half of that bargain: if the grants are
 * bundled out of sight, the list of them has to be somewhere in plain sight.
 *
 * Revoke sits on the row rather than behind a menu, because a permission you
 * cannot find the off switch for is not really revocable. Where a permission
 * cannot be revoked, the row says why in place of the button instead of
 * offering one that fails — a disabled control with no explanation reads as a
 * bug, and the reason here is not a technicality but the deal: the savings are
 * what the credit is secured by.
 */
export default function PermissionsPanel({ permissions }: { permissions: Permission[] }) {
  const [revoked, setRevoked] = useState<Set<string>>(new Set());

  const revoke = (id: string) =>
    setRevoked((previous) => new Set(previous).add(id));

  return (
    <>
      <div className="text-[13px]">
        {permissions.map((permission, i) => {
          const isRevoked = revoked.has(permission.id);
          const isLocked = Boolean(permission.lockedReason);

          return (
            <div
              key={permission.id}
              className={cn(
                'py-3',
                i < permissions.length - 1 && 'border-b-[0.5px] border-border',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={cn('truncate', isRevoked && 'text-muted-foreground line-through')}>
                    {permission.label}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {permission.detail}
                  </p>
                </div>

                {isRevoked ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground">Revoked</span>
                ) : isLocked ? (
                  <Lock
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                ) : (
                  <Button
                    variant="clear"
                    size="xs"
                    className="shrink-0"
                    onClick={() => revoke(permission.id)}
                  >
                    Revoke
                  </Button>
                )}
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                <span>Granted {permission.granted}</span>
                <span aria-hidden>·</span>
                <span>{permission.limit}</span>
              </div>

              {isLocked && !isRevoked && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-foreground-secondary">
                  {permission.lockedReason}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <InfoBlock tone="neutral" className="mt-3.5 text-[11px]">
        Revoking one of these doesn&rsquo;t close anything — it just means Clear asks you again
        the next time it needs to.
      </InfoBlock>
    </>
  );
}
