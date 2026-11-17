import { useState } from 'react';
import { Chip, CMain, Rows } from '@/components/clear/brand/anatomy';
import { Pane, RowBtn, TwoLineRow } from './SettingsKit';
import Switch from '@/components/clear/brand/Switch';
import type { Permission } from '@/lib/clearModel';
import type { AutoRepay } from '@/hooks/useAutoRepay';

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
   * Auto-clear, for real: the switch and the scope move the on-chain setting. Absent in the preview
   * harness, where the row shows but the switch is local.
   */
  autoRepay?: AutoRepay;
}) {
  const [localAuto, setLocalAuto] = useState(false);
  const [allowanceInput, setAllowanceInput] = useState('');
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
            title={<label htmlFor="autorepay">Auto-clear from deposits</label>}
            detail={
              autoRepay?.error ? (
                <span className="c-errline">{autoRepay.error}</span>
              ) : autoRepay?.busy ? (
                'Confirming in your wallet…'
              ) : autoRepay?.pausedForEveryone ? (
                'Paused across Clear for now. Nothing is cleared automatically.'
              ) : (
                'What you owe is cleared first from bank deposits to Spendable, the rest is yours to spend. USDC deposits are never touched'
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
          {autoRepay?.onScopeChange && (
            <TwoLineRow
              title="What it clears"
              detail={autoRepay.scope === 1 ? 'Everything you owe, dearest first' : 'Income-backed credit and Boost only'}
              trailing={
                <RowBtn disabled={autoRepay.busy} onClick={() => autoRepay.onScopeChange?.(autoRepay.scope === 1 ? 0 : 1)}>
                  {autoRepay.scope === 1 ? 'Unsecured only' : 'Everything'}
                </RowBtn>
              }
            />
          )}
          {autoRepay?.clearNow && (
            <TwoLineRow
              title={autoRepay.clearNow.done ?? `Clear $${autoRepay.clearNow.amount.toFixed(2)} now?`}
              detail={
                autoRepay.clearNow.done
                  ? 'From your cash. Your card limit is free again.'
                  : autoRepay.enabled
                    ? 'Auto-clear waits for a bank deposit to Spendable. USDC deposits stay yours: one tap clears from them.'
                    : 'Auto-clear is off, so this waits for you. One tap, from your cash.'
              }
              trailing={
                autoRepay.clearNow.done ? null : (
                  <RowBtn disabled={autoRepay.busy} onClick={autoRepay.clearNow.onClear}>
                    Clear now
                  </RowBtn>
                )
              }
            />
          )}
        </CMain>
      </Pane>

      {autoRepay?.savingsAllowance && (
        <>
          <p className="c-grouplabel">Card spending from Savings</p>
          <Pane className="mb-s3">
            <CMain>
              <TwoLineRow
                title={
                  autoRepay.savingsAllowance.unlimited
                    ? 'No limit set'
                    : autoRepay.savingsAllowance.amount
                      ? `Up to $${autoRepay.savingsAllowance.amount.toFixed(2)} more`
                      : 'Off'
                }
                detail="Your card draws on Savings only as far as you allow. You can lower it or turn it off at any time."
                trailing={
                  autoRepay.savingsAllowance.amount || autoRepay.savingsAllowance.unlimited ? (
                    <RowBtn disabled={autoRepay.savingsAllowance.busy} onClick={() => autoRepay.savingsAllowance?.onSet(0)}>
                      Turn off
                    </RowBtn>
                  ) : null
                }
              />
              <TwoLineRow
                title={
                  <input
                    aria-label="Allow card spending from Savings, in dollars"
                    inputMode="decimal"
                    className="c-field w-[120px]"
                    placeholder="$0.00"
                    value={allowanceInput}
                    onChange={(e) => setAllowanceInput(e.target.value.replace(/[^0-9.]/g, ''))}
                  />
                }
                detail="Set how much your card may draw against Savings"
                trailing={
                  <RowBtn
                    disabled={autoRepay.savingsAllowance.busy || !(Number(allowanceInput) >= 0) || allowanceInput === ''}
                    onClick={() => {
                      autoRepay.savingsAllowance?.onSet(Number(allowanceInput));
                      setAllowanceInput('');
                    }}
                  >
                    {autoRepay.savingsAllowance.busy ? 'Confirming…' : 'Allow'}
                  </RowBtn>
                }
              />
            </CMain>
          </Pane>
        </>
      )}

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
