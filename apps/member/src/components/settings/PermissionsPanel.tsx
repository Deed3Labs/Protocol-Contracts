import { useState } from 'react';
import { Chip, CMain, Rows } from '@/components/clear/brand/anatomy';
import { Pane, RowBtn, TwoLineRow } from './SettingsKit';
import Switch from '@/components/clear/brand/Switch';
import type { Permission } from '@/lib/clearModel';

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
 *
 * Group labels sit above their cards, never inside them. Held is underway amber: it is held while
 * something is in progress, which is what that colour means elsewhere.
 */
export default function PermissionsPanel({
  permissions,
  autoRepay,
}: {
  permissions: Permission[];
  /**
   * Automatic repayment from USDC deposits, for real: the switch moves the on-chain mandate. Absent in
   * the preview harness, where the row shows but the switch is local.
   */
  autoRepay?: { enabled: boolean; busy: boolean; error: string | null; onChange: (enabled: boolean) => void };
}) {
  const [localAuto, setLocalAuto] = useState(false);
  const [off, setOff] = useState<Set<string>>(new Set());

  const granted = permissions.filter((p) => !p.held);
  const held = permissions.filter((p) => p.held);

  return (
    <>
      <p className="c-det mb-s3 lg:hidden">What Clear can do without asking each time.</p>

      <p className="c-grouplabel">Repayment</p>
      <Pane className="mb-s3">
        <CMain>
          <TwoLineRow
            title={<label htmlFor="autorepay">Repay from USDC deposits</label>}
            detail={
              autoRepay?.error ? (
                <span className="c-errline">{autoRepay.error}</span>
              ) : autoRepay?.busy ? (
                'Confirming in your wallet…'
              ) : (
                'What you owe is repaid first, the rest is yours'
              )
            }
            trailing={
              <Switch
                id="autorepay"
                checked={autoRepay ? autoRepay.enabled : localAuto}
                disabled={autoRepay?.busy}
                onCheckedChange={(v) => (autoRepay ? autoRepay.onChange(v) : setLocalAuto(v))}
              />
            }
          />
        </CMain>
      </Pane>

      {granted.length > 0 && (
        <>
          <p className="c-grouplabel">On</p>
          <Pane>
            <CMain>
              <Rows>
                {granted.map((permission) => (
                  <div key={permission.id}>
                    <TwoLineRow
                      title={permission.label}
                      detail={permission.detail}
                      trailing={
                        off.has(permission.id) ? (
                          <span className="c-det shrink-0">Off</span>
                        ) : (
                          <RowBtn onClick={() => setOff((previous) => new Set(previous).add(permission.id))}>
                            Turn off
                          </RowBtn>
                        )
                      }
                    />
                  </div>
                ))}
              </Rows>
            </CMain>
          </Pane>
        </>
      )}

      {held.length > 0 && (
        <>
          <p className="c-grouplabel mt-s3">Held while you carry credit</p>
          <Pane>
            <CMain>
              <Rows>
                {held.map((permission) => (
                  <div key={permission.id}>
                    <TwoLineRow
                      title={permission.label}
                      detail={permission.detail}
                      trailing={<Chip tone="underway">Held</Chip>}
                    />
                  </div>
                ))}
              </Rows>
            </CMain>
          </Pane>
        </>
      )}

      <Pane className="mt-s3">
        <CMain>
          <p className="c-det">Turning one off closes nothing. Clear just asks next time.</p>
        </CMain>
      </Pane>
    </>
  );
}
