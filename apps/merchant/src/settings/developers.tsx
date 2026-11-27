import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ROLLED_KEY_HOURS, TEST_CARD, TEST_MEMBER, type AllowedSite, type ApiKey, type MerchantWebhookEndpoint, type NewSecretKey, type NewWebhookEndpoint } from '@clear/merchant-contracts';
import { Chip, Segmented, TickBox } from '@/brand/controls';
import { clickOnKey, Sheet } from '@/brand/ui';
import { mockControls, useMerchantApi } from '@/data/merchantApi';
import { errorSentence, useApi } from '@/data/useApi';
import { Btn, Cell, FootLine, Kv, Main, Pair, R2, Rows } from '@/settings/views';
import {
  DEFAULT_EVENTS,
  deliveryRow,
  endpointCheck,
  endpointsHead,
  EVENT_CHOICES,
  EVENT_DET,
  forMode,
  HEALTH,
  publishableDet,
  rolledDet,
  secretDet,
  siteCheck,
  siteRow,
  sitesHead,
  untilLabel,
} from '@/settings/developersModel';

/**
 * Settings › Developers (pay spec §6): keys for test and live, the websites allowed to use them,
 * webhooks with their deliveries, the test member, and what an AI needs to add Pay with Clear.
 * Owners and managers (pay DECISIONS, Phase 1); the counter never sees it. The Test/Live switch is
 * the pane's own and isn't saved: it chooses which keys, endpoints and deliveries show.
 */

type EventType = MerchantWebhookEndpoint['events'][number];

type Open =
  | { kind: 'secret'; made: NewSecretKey; rolled: boolean }
  | { kind: 'roll'; key: ApiKey }
  | { kind: 'add-site' }
  | { kind: 'remove-site'; site: AllowedSite }
  | { kind: 'add-endpoint'; made?: NewWebhookEndpoint }
  | { kind: 'remove-endpoint'; endpoint: MerchantWebhookEndpoint }
  | null;

/** The preview's states that change the mock before it's read (`&screen=…`). */
const MOCK_STATES = ['no-keys', 'no-endpoints', 'no-deliveries'] as const;
const TEST_REFERENCE_HOST = 'order.micasatacos.com';

/** A Copy button's "Copied", for a moment. */
function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (which: string, text: string) =>
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(which);
      window.setTimeout(() => setCopied((c) => (c === which ? null : c)), 1600);
    });
  return { copied, copy, label: (which: string, word = 'Copy') => (copied === which ? 'Copied' : word) };
}

const Gap = () => <div style={{ height: 'var(--s3)' }} />;

/** Settings › Developers, with its sheets. `screen` opens one of them in the preview. */
export function DevelopersSection({ head, screen }: { head: ReactNode; screen?: string }) {
  const merchant = useMerchantApi();
  // The preview's empty states are the mock's, set before its first read.
  useState(() => {
    const state = MOCK_STATES.find((s) => s === screen);
    if (state) mockControls()?.developers(state);
  });
  const view = useApi(() => merchant.developers(), []);
  const shop = useApi(() => merchant.shop(), []);
  const [livemode, setLivemode] = useState(screen !== 'test');
  const [open, setOpen] = useState<Open>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { copy, label } = useCopy();
  const opened = useRef(false);
  const timeZone = shop.data?.timezone ?? 'America/Los_Angeles';
  const now = new Date().toISOString();

  const run = async <T,>(fn: () => Promise<T>, after?: (out: T) => void) => {
    setBusy(true);
    setError(null);
    try {
      const out = await fn();
      after?.(out);
      view.reload();
      return true;
    } catch (e) {
      setError(errorSentence(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // The preview's sheets: `&screen=secret|roll|add-site|remove-site|add-endpoint|endpoint-secret|remove-endpoint`.
  const v = view.data;
  useEffect(() => {
    if (opened.current || !v || !screen) return;
    opened.current = true;
    const m = forMode(v, true, now);
    if (screen === 'secret' && m.secret) {
      void merchant.rollSecretKey(m.secret.id).then((made) => (setOpen({ kind: 'secret', made, rolled: true }), view.reload()));
    }
    if (screen === 'roll' && m.secret) setOpen({ kind: 'roll', key: m.secret });
    if (screen === 'add-site') setOpen({ kind: 'add-site' });
    if (screen === 'remove-site' && v.sites[0]) setOpen({ kind: 'remove-site', site: v.sites[0] });
    if (screen === 'add-endpoint') setOpen({ kind: 'add-endpoint' });
    if (screen === 'endpoint-secret') {
      void merchant
        .addWebhookEndpoint({ url: `https://${TEST_REFERENCE_HOST}/clear/webhook`, events: DEFAULT_EVENTS, livemode: true })
        .then((made) => (setOpen({ kind: 'add-endpoint', made }), view.reload()));
    }
    if (screen === 'remove-endpoint' && m.endpoints[0]) setOpen({ kind: 'remove-endpoint', endpoint: m.endpoints[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, screen]);

  if (!v) {
    return (
      <>
        {head}
        <div className="c-panebody">{view.error ? <p className="c-det">{view.error}</p> : null}</div>
      </>
    );
  }

  const m = forMode(v, livemode, now);
  const mode = livemode ? 'Live' : 'Test';
  const close = () => {
    setOpen(null);
    setError(null);
  };

  return (
    <>
      {head}
      <div className="c-panebody">
        {error && !open && (
          <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginBottom: 'var(--s2)' }}>
            {error}
          </p>
        )}

        {/* ---- Keys */}
        <Cell
          label="Keys"
          det={
            <Chip tone={livemode ? 'settled' : 'underway'} dot>
              {mode}
            </Chip>
          }
        >
          <Main>
            <Rows>
              <R2
                t="Mode"
                det="Test payments never move money"
                end={
                  <Segmented
                    kind="sheet"
                    className="c-tm-seg"
                    label="Mode"
                    value={livemode ? 'live' : 'test'}
                    onChange={(x) => setLivemode(x === 'live')}
                    options={[
                      { value: 'test', label: 'Test' },
                      { value: 'live', label: 'Live' },
                    ]}
                  />
                }
              />
              {m.publishable || m.secret ? (
                <>
                  <R2
                    t="Publishable key"
                    det={m.publishable ? publishableDet(m.publishable) : '—'}
                    end={
                      m.publishable?.token ? (
                        <Btn sm onClick={() => copy('pk', m.publishable!.token!)}>
                          {label('pk')}
                        </Btn>
                      ) : null
                    }
                  />
                  <R2
                    t="Secret key"
                    det={m.secret ? secretDet(m.secret) : '—'}
                    end={
                      m.secret ? (
                        <Pair>
                          <Btn sm onClick={() => setOpen({ kind: 'roll', key: m.secret! })}>
                            Roll
                          </Btn>
                        </Pair>
                      ) : null
                    }
                  />
                  {m.rolled.map((k) => (
                    <R2 key={k.id} t="Old secret key" det={rolledDet(k, timeZone)} end={null} />
                  ))}
                </>
              ) : (
                <R2
                  t={`No ${mode.toLowerCase()} keys yet`}
                  det={livemode ? 'Make them when the website is ready to take payments' : 'Make them to try Pay with Clear with the test member'}
                  end={
                    <Btn sm primary disabled={busy} onClick={() => void run(() => merchant.createKeys(livemode), (made) => setOpen({ kind: 'secret', made, rolled: false }))}>
                      Make keys
                    </Btn>
                  }
                />
              )}
            </Rows>
          </Main>
        </Cell>
        <Gap />

        {/* ---- Allowed websites */}
        <Cell
          label="Allowed websites"
          det={sitesHead(v.sites.length)}
          foot={
            <FootLine det="Add the sites that use Pay with Clear.">
              <Btn onClick={() => (setError(null), setOpen({ kind: 'add-site' }))}>Add a site</Btn>
            </FootLine>
          }
        >
          <Main>
            {v.sites.length > 0 && (
              <Rows>
                {v.sites.map((s) => {
                  const row = siteRow(s, timeZone);
                  return (
                    <R2
                      key={s.origin}
                      t={row.t}
                      det={row.det}
                      end={
                        <Btn sm onClick={() => (setError(null), setOpen({ kind: 'remove-site', site: s }))}>
                          Remove
                        </Btn>
                      }
                    />
                  );
                })}
              </Rows>
            )}
            <p className="c-det" style={{ marginTop: v.sites.length > 0 ? 8 : 0 }}>
              The script only opens on these sites, so a copied key is useless anywhere else.
            </p>
          </Main>
        </Cell>
        <Gap />

        {/* ---- Webhooks */}
        <Cell
          label="Webhooks"
          det={endpointsHead(m.endpoints.length)}
          foot={
            <FootLine det="Signed with your webhook secret. Retried for 3 days.">
              <Btn onClick={() => (setError(null), setOpen({ kind: 'add-endpoint' }))}>Add an endpoint</Btn>
            </FootLine>
          }
        >
          <Main>
            {m.endpoints.length > 0 ? (
              <>
                <Rows>
                  {m.endpoints.map((e) => (
                    <div key={e.id}>
                      <div
                        className="c-r2 c-dev-endpoint"
                        role="button"
                        tabIndex={0}
                        aria-label={`${e.url}: remove`}
                        onKeyDown={clickOnKey}
                        onClick={() => (setError(null), setOpen({ kind: 'remove-endpoint', endpoint: e }))}
                      >
                        <div>
                          <p className="c-t">{e.url}</p>
                          <p className="c-det">{e.events.join(', ')}</p>
                        </div>
                        <span className="c-end">
                          <Chip tone={HEALTH[e.health].tone} dot>
                            {HEALTH[e.health].label}
                          </Chip>
                        </span>
                      </div>
                    </div>
                  ))}
                </Rows>
                <p className="c-label c-st-fl">Recent deliveries</p>
                <Rows>
                  {m.deliveries.length > 0 ? (
                    m.deliveries.map((d) => {
                      const row = deliveryRow(d, now, timeZone);
                      return <Kv key={d.id} k={row.k} v={<span className={row.ok ? 'c-pw-ok' : 'c-pw-bad'}>{row.v}</span>} />;
                    })
                  ) : (
                    <Kv k="—" />
                  )}
                </Rows>
              </>
            ) : (
              <p className="c-det" style={{ margin: 0 }}>
                Add an endpoint so the server hears about {mode.toLowerCase()} payments, and fulfil orders from payment.succeeded.
              </p>
            )}
          </Main>
        </Cell>
        <Gap />

        {/* ---- Testing */}
        <Cell label="Testing" det="Test mode only">
          <Main>
            <Rows>
              <R2 t="Test member" det={`${TEST_MEMBER.phone} · code ${TEST_MEMBER.code} · always approves`} end={null} />
              <R2 t="Test card" det={v.cardsConnected ? `Stripe’s ${TEST_CARD}` : `Stripe’s ${TEST_CARD} · once cards are connected in Payments`} end={null} />
            </Rows>
          </Main>
        </Cell>
        <Gap />

        {/* ---- Build with AI */}
        <Cell label="Build with AI">
          <Main>
            <Rows>
              <R2
                t="Docs for your AI"
                det="useclear.org/llms.txt and the full docs as plain text"
                end={
                  <Btn sm onClick={() => copy('llms', v.ai.llmsUrl)}>
                    {label('llms', 'Copy link')}
                  </Btn>
                }
              />
              <R2
                t="Paste-in prompt"
                det="Tells any coding AI how to add Pay with Clear to this site, with your keys filled in"
                end={
                  <Btn sm onClick={() => copy('prompt', v.ai.prompt)}>
                    {label('prompt', 'Copy prompt')}
                  </Btn>
                }
              />
              <R2
                t="MCP server"
                det="For Claude, Cursor and others: create links, look up payments, issue refunds"
                end={
                  <Btn sm onClick={() => window.open(v.ai.mcpUrl, '_blank', 'noopener,noreferrer')}>
                    Set up
                  </Btn>
                }
              />
            </Rows>
          </Main>
        </Cell>
      </div>

      {open?.kind === 'secret' && (
        // A rolled key's predecessor stops working 24 hours after the new one was made.
        <SecretSheet made={open.made} until={open.rolled ? untilLabel(new Date(Date.parse(open.made.key.createdAt) + ROLLED_KEY_HOURS * 3600_000).toISOString(), timeZone) : null} onClose={close} />
      )}
      {open?.kind === 'roll' && (
        <Confirm
          title="Roll the secret key"
          action="Roll key"
          busy={busy}
          error={error}
          onCancel={close}
          onConfirm={() => void run(() => merchant.rollSecretKey(open.key.id), (made) => setOpen({ kind: 'secret', made, rolled: true }))}
        >
          A new {open.key.livemode ? 'live' : 'test'} secret key is made and shown once. The old one keeps working for 24 hours, while the server changes over.
        </Confirm>
      )}
      {open?.kind === 'add-site' && (
        <AddSiteSheet livemode={livemode} busy={busy} error={error} onClose={close} onAdd={(site) => void run(() => merchant.addSite({ site }), close)} />
      )}
      {open?.kind === 'remove-site' && (
        <Confirm title="Remove a site" action="Remove" busy={busy} error={error} onCancel={close} onConfirm={() => void run(() => merchant.removeSite(open.site.origin), close)}>
          Pay with Clear stops opening on {siteRow(open.site, timeZone).t} straight away. Payments already made stay as they are.
        </Confirm>
      )}
      {open?.kind === 'add-endpoint' && (
        <AddEndpointSheet
          livemode={open.made ? open.made.endpoint.livemode : livemode}
          made={open.made ?? null}
          busy={busy}
          error={error}
          onClose={close}
          onAdd={(request) => void run(() => merchant.addWebhookEndpoint(request), (made) => setOpen({ kind: 'add-endpoint', made }))}
        />
      )}
      {open?.kind === 'remove-endpoint' && (
        <Confirm title="Remove this endpoint" action="Remove" busy={busy} error={error} onCancel={close} onConfirm={() => void run(() => merchant.removeWebhookEndpoint(open.endpoint.id), close)}>
          {open.endpoint.url} stops getting events straight away, and its deliveries leave the list.
        </Confirm>
      )}
    </>
  );
}

// ---- Sheets ------------------------------------------------------------------------------------------

const Alert = ({ error }: { error?: string | null }) =>
  error ? (
    <p className="c-det" role="alert" style={{ color: 'var(--absent)', margin: '0 0 var(--s1)' }}>
      {error}
    </p>
  ) : null;

/** Roll, Remove a site, Remove this endpoint: a sentence, then Cancel and the action. */
function Confirm({ title, action, busy, error, onCancel, onConfirm, children }: { title: string; action: string; busy?: boolean; error?: string | null; onCancel: () => void; onConfirm: () => void; children: ReactNode }) {
  return (
    <Sheet
      className="c-st-sheet"
      title={title}
      onClose={onCancel}
      foot={
        <>
          <Alert error={error} />
          <div className="c-pair">
            <button type="button" className="c-btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="c-btn c-btn-primary" disabled={busy} onClick={onConfirm}>
              {action}
            </button>
          </div>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>{children}</p>
    </Sheet>
  );
}

/** A secret shown once: the full secret, Copy, and that it won't be shown again. */
function SecretBox({ secret }: { secret: string }) {
  const { copy, label } = useCopy();
  return (
    <div className="c-dev-secret">
      <code>{secret}</code>
      <Btn sm onClick={() => copy('secret', secret)}>
        {label('secret')}
      </Btn>
    </div>
  );
}

/** After Make keys or Roll: the secret key, the only time it's shown. */
function SecretSheet({ made, until, onClose }: { made: NewSecretKey; until: string | null; onClose: () => void }) {
  return (
    <Sheet
      className="c-st-sheet c-dev-sheet"
      title={`${made.key.livemode ? 'Live' : 'Test'} secret key`}
      onClose={onClose}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">It won’t be shown again.</p>
          <button type="button" className="c-btn c-btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>Copy it to the server now, as CLEAR_SECRET_KEY. It never goes in a web page.</p>
      <SecretBox secret={made.secret} />
      {until && <p className="c-det">The old key keeps working until {until}.</p>}
    </Sheet>
  );
}

function AddSiteSheet({ livemode, busy, error, onAdd, onClose }: { livemode: boolean; busy?: boolean; error?: string | null; onAdd: (site: string) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const check = siteCheck(text);
  return (
    <Sheet
      className="c-st-sheet c-dev-sheet"
      title="Add a site"
      onClose={onClose}
      foot={
        <>
          <Alert error={error} />
          <div className="c-line" style={{ alignItems: 'center' }}>
            <p className="c-det">Its address only. A path is dropped.</p>
            <button type="button" className="c-btn c-btn-primary" disabled={!check.ok || busy} onClick={() => check.ok && onAdd(check.origin)}>
              Add site
            </button>
          </div>
        </>
      }
    >
      <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
        Website
      </p>
      <input
        className="c-field c-st-in"
        aria-label="Website"
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="yourshop.com"
        maxLength={253}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && check.ok && !busy && onAdd(check.origin)}
      />
      {check.ok ? (
        <p className="c-det">
          Adds {check.origin}
          {check.note ? `. ${check.note}` : ''}
        </p>
      ) : check.reason ? (
        <p className="c-det" role="alert" style={{ color: 'var(--absent)' }}>
          {check.reason}
        </p>
      ) : null}
      {!livemode && <p className="c-det">In test mode, http://localhost works too, with test keys only.</p>}
    </Sheet>
  );
}

function AddEndpointSheet({
  livemode,
  made,
  busy,
  error,
  onAdd,
  onClose,
}: {
  livemode: boolean;
  made: NewWebhookEndpoint | null;
  busy?: boolean;
  error?: string | null;
  onAdd: (request: { url: string; events: EventType[]; livemode: boolean }) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(made?.endpoint.url ?? '');
  const [events, setEvents] = useState<EventType[]>(made?.endpoint.events ?? DEFAULT_EVENTS);
  const check = endpointCheck(url, events, livemode);
  const locked = Boolean(made);
  return (
    <Sheet
      className="c-st-sheet c-dev-sheet"
      title="Add an endpoint"
      onClose={onClose}
      foot={
        made ? (
          <div className="c-line" style={{ alignItems: 'center' }}>
            <p className="c-det">It won’t be shown again.</p>
            <button type="button" className="c-btn c-btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <Alert error={error} />
            <div className="c-line" style={{ alignItems: 'center' }}>
              <p className="c-det">{livemode ? 'Gets live events.' : 'Gets test events.'}</p>
              <button type="button" className="c-btn c-btn-primary" disabled={!check.ok || busy} onClick={() => check.ok && onAdd(check.request)}>
                Add endpoint
              </button>
            </div>
          </>
        )
      }
    >
      <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
        URL
      </p>
      <input
        className="c-field c-st-in"
        aria-label="URL"
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="https://yourshop.com/clear/webhook"
        maxLength={2048}
        autoFocus={!locked}
        disabled={locked}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      {!check.ok && check.reason && !locked && (
        <p className="c-det" role="alert" style={{ color: 'var(--absent)' }}>
          {check.reason}
        </p>
      )}
      <p className="c-label c-st-fl">Events</p>
      <Rows>
        {EVENT_CHOICES.map((e) => (
          <R2
            key={e}
            t={e}
            det={EVENT_DET[e]}
            end={<TickBox on={events.includes(e)} label={e} onChange={locked ? undefined : (on) => setEvents((cur) => (on ? [...cur, e] : cur.filter((x) => x !== e)))} />}
          />
        ))}
      </Rows>
      {made && (
        <>
          <p className="c-label c-st-fl">Signing secret</p>
          <p className="c-det" style={{ marginTop: 0 }}>
            Check each event’s Clear-Signature with it. Copy it to the server now.
          </p>
          <SecretBox secret={made.secret} />
        </>
      )}
    </Sheet>
  );
}

