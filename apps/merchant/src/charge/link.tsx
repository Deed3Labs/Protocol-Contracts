import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { CatalogItem, MerchantPaymentLink } from '@clear/merchant-contracts';
import { BLANK_LINK, EXPIRES_DET, linkable, linkLabel, linkRequest, type LinkDraft } from './linkModel';

export { BLANK_LINK, type LinkDraft } from './linkModel';
import { Segmented, Toggle } from '@/brand/controls';
import { Sheet } from '@/brand/ui';
import { usd } from '@/charge/model';

/**
 * New charge › Send a link (pay spec §5): an amount, or a price from Inventory with how many; a note
 * to the customer; when it expires; and whether members may pay over time. Owners and managers.
 *
 * The drawing shows the link's address before Create link; the address is made by the server, so it
 * appears, with Copy and the QR, once the link exists (pay DECISIONS, Phase 3).
 */

export function SendLinkSheet({
  items,
  draft: initial = BLANK_LINK,
  created: shown = null,
  busy,
  error,
  onCreate,
  onClose,
}: {
  items: CatalogItem[];
  draft?: LinkDraft;
  /** The link once made: its address, Copy and the QR. */
  created?: MerchantPaymentLink | null;
  busy?: boolean;
  error?: string | null;
  onCreate: (request: Extract<ReturnType<typeof linkRequest>, { ok: true }>['request']) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<LinkDraft>(initial);
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState(false);
  const set = (patch: Partial<LinkDraft>) => setD((cur) => ({ ...cur, ...patch }));
  const choices = linkable(items);
  const item = choices.find((i) => i.id === d.itemId) ?? null;
  const ready = linkRequest(d);
  const locked = Boolean(shown);

  const copy = () => {
    if (!shown) return;
    void navigator.clipboard?.writeText(shown.url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-pay-link"
      title="Send a link"
      onClose={onClose}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">Also as a QR for flyers and receipts.</p>
          {shown ? (
            <button type="button" className="c-btn c-btn-primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <button type="button" className="c-btn c-btn-primary" disabled={!ready.ok || busy} onClick={() => ready.ok && onCreate(ready.request)}>
              Create link
            </button>
          )}
        </div>
      }
    >
      <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
        For
      </p>
      <Segmented
        kind="sheet"
        className="c-tm-seg"
        label="For"
        value={d.for}
        onChange={(v) => !locked && set({ for: v })}
        options={[
          { value: 'amount', label: 'An amount' },
          { value: 'item', label: 'A price' },
        ]}
      />
      <div className="c-rows" style={{ marginTop: 'var(--s2)' }}>
        {d.for === 'item' ? (
          <div>
            <div className="c-r2">
              <button type="button" className="c-pay-pick" disabled={locked} onClick={() => setPicking((p) => !p)} aria-expanded={picking}>
                <p className="c-t">{item ? item.name : 'Choose a price'}</p>
                <p className="c-det">{item ? `${usd(item.priceCents)} · from Inventory` : 'From Inventory'}</p>
              </button>
              <span className="c-end">
                <span className="c-sa-inl">
                  <input
                    className="c-sa-box c-pay-qty"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={99}
                    aria-label="How many"
                    disabled={locked}
                    value={d.quantity}
                    onChange={(e) => set({ quantity: Math.max(1, Math.min(99, Math.floor(Number(e.target.value) || 1))) })}
                  />
                </span>
              </span>
            </div>
            {picking && !locked ? (
              <div className="c-rows c-pay-picker" role="listbox" aria-label="Prices from Inventory">
                {choices.map((i) => (
                  <div key={i.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={i.id === d.itemId}
                      className="c-r2 c-pay-option"
                      onClick={() => {
                        set({ itemId: i.id });
                        setPicking(false);
                      }}
                    >
                      <p className="c-t">{i.name}</p>
                      <span className="c-end c-det">{usd(i.priceCents)}</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div>
            <div className="c-r2">
              <div>
                <p className="c-t">Amount</p>
                <p className="c-det">What they pay. No tax is added.</p>
              </div>
              <span className="c-end">
                <input
                  className="c-sa-box c-pay-amount"
                  inputMode="decimal"
                  aria-label="Amount"
                  placeholder="$0.00"
                  disabled={locked}
                  value={d.amount}
                  onChange={(e) => set({ amount: e.target.value })}
                />
              </span>
            </div>
          </div>
        )}
        <div>
          <div className="c-r2">
            <label style={{ flex: 1, minWidth: 0 }}>
              <p className="c-t">Note to the customer</p>
              <input className="c-det c-pay-note" maxLength={200} placeholder="Optional" disabled={locked} value={d.note} onChange={(e) => set({ note: e.target.value })} />
            </label>
            <span className="c-end" />
          </div>
        </div>
        <div>
          <div className="c-r2">
            <div>
              <p className="c-t">Expires</p>
              <p className="c-det">{EXPIRES_DET[d.expires]}</p>
            </div>
            <span className="c-end">
              <Segmented
                kind="sheet"
                className="c-tm-seg"
                label="Expires"
                value={d.expires}
                onChange={(v) => !locked && set({ expires: v })}
                options={[
                  { value: 'never', label: 'Never' },
                  { value: '7d', label: '7 days' },
                  { value: '30d', label: '30 days' },
                ]}
              />
            </span>
          </div>
        </div>
        <div>
          <div className="c-r2">
            <div>
              <p className="c-t">Allow paying over time</p>
              <p className="c-det">Members choose the split on their side</p>
            </div>
            <span className="c-end">
              <Toggle on={d.allowOverTime} onChange={(on) => !locked && set({ allowOverTime: on })} label="Allow paying over time" />
            </span>
          </div>
        </div>
      </div>
      {shown ? (
        <>
          <div className="c-tm-onpoint">
            <span>{linkLabel(shown.url)}</span>
            <button type="button" className="c-ci-link" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="c-pay-qr">
            <QRCodeSVG value={shown.url} size={152} level="M" marginSize={2} bgColor="var(--qr-paper, #ffffff)" fgColor="var(--ink)" title={`QR for ${linkLabel(shown.url)}`} />
          </div>
        </>
      ) : null}
      {error ? (
        <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginTop: 8 }}>
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
