import { useState } from 'react';
import type { HardwareOrder } from '@clear/merchant-contracts';
import { Btn, Cell, FootLine, Main, Rows } from '@/settings/views';
import { DevRow, IconPoint } from './devices';
import { lineDet, lineName, openLines, statusChip, usd } from './onOrderLines';

export { lineDet, lineName, openLines, statusChip, usd };

/**
 * Settings › Devices › On order: hardware the shop reserved on useclear.org (API:
 * services/merchant/hardwareOrders). Each line's deposit, what's charged when it ships, the estimated
 * ship month and where it stands. Cancel refunds the deposit, for owners, until building starts, which
 * is what the site promised at checkout. The site emails before building with the start date.
 */

/** In the Devices list: what's on order, a row each, tapping through to the pane. Absent when nothing is. */
export function OnOrderCell({ orders, onOpen }: { orders: HardwareOrder[]; onOpen: () => void }) {
  const open = openLines(orders);
  if (!open.length) return null;
  return (
    <Cell label="On order" det={`${open.length} from useclear.org`}>
      <Main>
        <Rows link>
          {open.map((l) => (
            <DevRow key={`${l.slug}/${l.variant}/${l.n}`} icon={<IconPoint />} name={lineName(l)} det={`Ships ${l.ships}, estimated`} chip={statusChip(l)} onTap={onOpen} />
          ))}
        </Rows>
      </Main>
    </Cell>
  );
}

/** The pane: every reservation, with Cancel where it still refunds. */
export function OnOrderPane({
  orders,
  configured,
  owner,
  busy,
  error,
  onCancel,
}: {
  orders: HardwareOrder[];
  configured: boolean;
  owner: boolean;
  busy: boolean;
  error: string | null;
  onCancel: (orderId: string, line: number) => void;
}) {
  /** The line whose Cancel was pressed once: the second press refunds. */
  const [asking, setAsking] = useState<string | null>(null);
  if (!configured || !orders.length) {
    return (
      <Cell label="On order">
        <Main>
          <p className="c-det">
            {configured ? 'Nothing on order. Hardware you reserve on useclear.org shows here.' : 'Hardware orders aren’t connected yet. Hardware you reserve on useclear.org will show here.'}
          </p>
        </Main>
      </Cell>
    );
  }
  return (
    <>
      {orders.map((o) => (
        <Cell
          key={o.id}
          label={`Reserved ${day(o.placedAt)}`}
          det={`Deposits ${usd(o.lines.reduce((n, l) => n + l.depositCents, 0))}`}
          foot={<FootLine det="Refundable in full until we start building yours. We email you the date first.">{null}</FootLine>}
        >
          <Main>
            <Rows>
              {o.lines.map((l) => {
                const key = `${o.id}/${l.n}`;
                return (
                  <div key={key}>
                    <DevRow icon={<IconPoint />} name={lineName(l)} det={lineDet(l)} chip={statusChip(l)} />
                    {owner && l.cancellable && (
                      <div className="c-line" style={{ justifyContent: 'flex-end', gap: 8, paddingTop: 0 }}>
                        {asking === key ? (
                          <>
                            <Btn sm onClick={() => setAsking(null)} disabled={busy}>
                              Keep it
                            </Btn>
                            <Btn
                              sm
                              primary
                              disabled={busy}
                              onClick={() => {
                                setAsking(null);
                                onCancel(o.id, l.n);
                              }}
                            >
                              {`Cancel and refund ${usd(l.depositCents)}`}
                            </Btn>
                          </>
                        ) : (
                          <Btn sm onClick={() => setAsking(key)} disabled={busy}>
                            Cancel
                          </Btn>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </Rows>
            {error && (
              <p className="c-det" role="status" style={{ color: 'var(--clear-danger, inherit)' }}>
                {error}
              </p>
            )}
          </Main>
        </Cell>
      ))}
    </>
  );
}
