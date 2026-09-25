import { useState, type ReactNode } from 'react';
import {
  CheckEmailScreen,
  CheckEmailSheet,
  EnrollCodeScreen,
  EnrollConfirmScreen,
  FirstPinSheet,
  IdleLockScreen,
  OwnerNeededSheet,
  OwnerSignInScreen,
  OwnerSignInSheet,
  PasskeyScreen,
  PinScreen,
  RemoveTabletSheet,
  ResetPinSheet,
  SignedInScreen,
  TabletRemovedScreen,
  WhoIsOnScreen,
  type ShiftPerson,
} from '@/auth/screens';
import { Chip, MethodMark, Segmented, SearchField, StepStrip, Stepper, StockDot, TickBox, Toggle } from '@/brand/controls';
import { CodeBoxes, PinDots, PinKeys } from '@/brand/ui';
import {
  FlowTop,
  PhoneNav,
  PhoneTop,
  PinSheet,
  PlusSheet,
  ProfileSheet,
  TopBar,
  WhoIsOnSheet,
} from '@/shell/chrome';
import { useLayout } from '@/lib/useBreakpoint';

/**
 * Every component in every state, on static props from the reference scenario (Mike's Tire,
 * Tue, Sep 22). Development only — App.tsx routes /_gallery here, and a production build drops it.
 *
 * Widths are the browser's own: resize to 1180, 820 or 390, or open /_gallery/widths for the
 * three side by side. Nothing here calls the API.
 */

const SHOP = 'Mike’s Tire';
const PEOPLE: ShiftPerson[] = [
  { id: 'jen', name: 'Jen R.', role: 'counter', hours: 'Until 4:00pm today', span: '8:00am – 4:00pm' },
  { id: 'luis', name: 'Luis M.', role: 'manager', hours: 'Until 6:00pm today' },
  { id: 'mike', name: 'Mike R.', role: 'owner', hours: 'No hours set' },
  { id: 'ana', name: 'Ana Ruiz', role: 'counter', first: true },
];
const jen = PEOPLE[0];

const css = `
.g-page{padding:var(--s4) var(--s3);max-width:1240px;margin:0 auto}
.g-page h1{font-family:var(--font-display);font-weight:800;font-size:32px;letter-spacing:-.035em;margin:0 0 var(--s1)}
.g-sec{margin-top:var(--s5)}
.g-sec > h2{font-family:var(--font-display);font-weight:700;font-size:22px;letter-spacing:-.03em;margin:0 0 var(--s2);padding-bottom:var(--s1);border-bottom:1px solid var(--ink-13)}
.g-item{margin-top:var(--s3)}
.g-item > .c-label{margin-bottom:var(--s1)}
.g-frame{border:1px solid var(--ink-28);background:var(--paper);position:relative;overflow:hidden}
.g-frame > .c-mc-tablet{height:auto;min-height:560px}
.g-pad{padding:var(--s3)}
.g-row{display:flex;flex-wrap:wrap;gap:var(--s3);align-items:flex-start}
.g-phone{position:relative;height:150px}
.g-phone .c-navwrap{position:absolute!important;bottom:var(--s2)!important}
.g-plus{position:relative;height:420px;overflow:hidden}
.g-plus .c-ps-scrim,.g-plus .c-ps-sheet{position:absolute!important}
.g-page .c-sheet{max-width:100%}
.g-row > .g-item{max-width:100%;min-width:0}
@media (max-width:519.98px){.g-page{padding:var(--s3) var(--s2)}}
.g-widths{display:flex;gap:var(--s3);align-items:flex-start;padding:var(--s3);overflow-x:auto}
.g-widths iframe{border:1px solid var(--ink-28);background:var(--paper);flex-shrink:0}
`;

function Item({ label, children, frame, pad }: { label: string; children: ReactNode; frame?: boolean; pad?: boolean }) {
  return (
    <div className="g-item">
      <p className="c-label">{label}</p>
      {frame ? <div className={pad ? 'g-frame g-pad' : 'g-frame'}>{children}</div> : children}
    </div>
  );
}

function Sec({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="g-sec">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** The three review sizes side by side. `?src=/?preview=1` frames the shell instead of the gallery. */
function Widths() {
  const src = new URLSearchParams(window.location.search).get('src') ?? '/_gallery';
  // `?sizes=390x6000` for other sizes, such as a whole page at phone width.
  const sizes = (new URLSearchParams(window.location.search).get('sizes') ?? '1180x820,820x1180,390x844')
    .split(',')
    .map((s) => s.split('x').map(Number));
  return (
    <div className="c-app g-widths">
      {sizes.map(([w, h]) => (
        <div key={w}>
          <p className="c-label" style={{ marginBottom: 8 }}>
            {w} &times; {h}
          </p>
          <iframe title={`${w} wide`} src={src} width={w + 2} height={h + 2} />
        </div>
      ))}
    </div>
  );
}

export default function Gallery() {
  if (window.location.pathname.startsWith('/_gallery/widths')) {
    return (
      <>
        <style>{css}</style>
        <Widths />
      </>
    );
  }
  return (
    <>
      <style>{css}</style>
      <GalleryBody />
    </>
  );
}

function GalleryBody() {
  const layout = useLayout();
  const phone = layout === 'phone';
  const [seg, setSeg] = useState<'pct' | 'amt'>('pct');
  const [mode, setMode] = useState<'amount' | 'items'>('amount');
  const [tick, setTick] = useState(true);
  const [tg, setTg] = useState(true);
  const [qty, setQty] = useState(8);
  const [q, setQ] = useState('');

  const header = (role: 'owner' | 'counter' | 'manager', name: string, extra?: { ownerUntil?: string }) => ({
    shop: SHOP,
    current: 'home' as const,
    role,
    onShift: name,
    avatarName: name,
    static: true,
    ...extra,
  });

  return (
    <div className="c-app g-page">
      <h1>Merchant components</h1>
      <p className="c-det">
        Development only. Drawn from docs/merchant-reference/ on the reference scenario. Current width: {layout}.{' '}
        <a className="c-si-link" href="/_gallery/widths">
          All three widths
        </a>
      </p>

      <Sec title="Header and nav">
        {!phone ? (
          <>
            <Item label="Owner on shift" frame pad>
              <TopBar {...header('owner', 'Mike R.')} />
            </Item>
            <Item label="Counter shift: Payouts and Overview locked" frame pad>
              <TopBar {...header('counter', 'Jen R.')} />
            </Item>
            <Item label="Owner signed in beside Jen's shift" frame pad>
              <TopBar {...header('counter', 'Jen R.', { ownerUntil: '4:52pm' })} avatarName="Mike R." role="owner" />
            </Item>
          </>
        ) : (
          <Item label="Phone header" frame pad>
            <PhoneTop {...header('owner', 'Mike R.')} />
          </Item>
        )}
        <Item label="Phone bar, owner" frame>
          <div className="g-phone">
            <PhoneNav current="home" role="owner" static />
          </div>
        </Item>
        <Item label="Phone bar, counter shift: owner-only icons dimmed" frame>
          <div className="g-phone">
            <PhoneNav current="charges" role="counter" static />
          </div>
        </Item>
        <Item label="The + sheet" frame>
          <div className="g-plus">
            <PlusSheet inline />
          </div>
        </Item>
        <Item label="Flow header: closing a flow, and back inside a section" frame pad>
          <FlowTop title="Close the day · Tue, Sep 22" onShift="Mike R." />
          <FlowTop back title="Goodyear Assurance · 215/55R17" onShift="Jen R." />
          <FlowTop
            title="New charge"
            onShift="Jen R."
            middle={
              <Segmented
                kind="mode"
                label="New charge by"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'amount', label: 'Amount' },
                  { value: 'items', label: 'Items' },
                ]}
              />
            }
          />
        </Item>
      </Sec>

      <Sec title="Sheets from the shell">
        <div className="g-row">
          <Item label="Profile, counter shift">
            <ProfileSheet
              inline
              name="Jen R."
              subtitle="Counter · on shift since 8:04am"
              owner={false}
              appearance="light"
              rows={[{ label: 'This tablet', value: 'Counter tablet · enrolled' }, { label: 'Help' }]}
            />
          </Item>
          <Item label="Profile, owner signed in">
            <ProfileSheet
              inline
              name="Mike R."
              subtitle="Owner · signed in"
              owner
              appearance="light"
              rows={[
                { label: 'Settings' },
                { label: 'Your terms', value: '1.25% now · 2.0% over time' },
                { label: 'Cash account', value: '$612.40' },
                { label: 'Counter materials' },
                { label: 'This tablet', value: 'Counter tablet · enrolled' },
                { label: 'Help' },
              ]}
            />
          </Item>
          <Item label="Changing the shift">
            <WhoIsOnSheet inline people={PEOPLE.slice(0, 3)} />
          </Item>
          <Item label="PIN">
            <PinSheet inline name="Jen R." filled={2} resetters="Luis or Mike" />
          </Item>
          <Item label="Wrong PIN">
            <PinSheet inline name="Jen R." filled={4} error="That is not it. 2 tries left." />
          </Item>
        </div>
      </Sec>

      <Sec title="Signing in: enrolling a device">
        <Item label="Set up this tablet, by code" frame>
          <EnrollCodeScreen code="48271" />
        </Item>
        <Item label="A code that has expired" frame>
          <EnrollCodeScreen code="482719" expired />
        </Item>
        <Item label="Enrolling, after the owner signed in here" frame>
          <EnrollConfirmScreen shop={SHOP} name="Counter tablet" cap="$1,500.00" />
        </Item>
      </Sec>

      <Sec title="Signing in: starting a shift">
        <Item label="Who's on the counter?" frame>
          <WhoIsOnScreen shop={SHOP} deviceLabel="Counter tablet" people={PEOPLE} />
        </Item>
        <Item label="PIN" frame>
          <PinScreen shop={SHOP} person={jen} filled={2} resetters="Luis or Mike" />
        </Item>
        <Item label="Wrong PIN" frame>
          <PinScreen shop={SHOP} person={jen} filled={4} error="That is not it. 2 tries left." resetters="Luis or Mike" />
        </Item>
        <Item label="Locked after five idle minutes" frame>
          <IdleLockScreen shop={SHOP} person={jen} minutes={5} started="8:04am" waiting={2} filled={0} />
        </Item>
        <div className="g-row">
          <Item label="A first shift">
            <FirstPinSheet inline name="Ana Ruiz" role="counter" choose={4} again={1} />
          </Item>
        </div>
      </Sec>

      <Sec title="Signing in: the owner">
        <div className="g-row">
          <Item label="This needs the owner">
            <OwnerNeededSheet
              inline
              owner="Mike"
              what={<>Withdrawing $612.40 to Chase &bull;&bull;4417 moves money, so Mike signs in for it. Jen&rsquo;s shift stays as it is.</>}
            />
          </Item>
          <Item label="Sign in as the owner">
            <OwnerSignInSheet inline email="mike@mikestire.com" />
          </Item>
          <Item label="Check your email">
            <CheckEmailSheet inline email="mike@mikestire.com" code="3905" />
          </Item>
        </div>
        <Item label="Full screen, on another device" frame>
          <OwnerSignInScreen email="mike@mikestire.com" phone={phone} />
        </Item>
        <Item label="Check your email, full screen" frame>
          <CheckEmailScreen email="mike@mikestire.com" code="3905" />
        </Item>
        <Item label="Waiting for a passkey" frame>
          <PasskeyScreen />
        </Item>
        <Item label="Signed in" frame>
          <SignedInScreen name="Mike R." shop={SHOP} />
        </Item>
      </Sec>

      <Sec title="Signing in: a forgotten PIN, and a lost tablet">
        <div className="g-row">
          <Item label="Reset a PIN">
            <ResetPinSheet inline name="Jen R." approver="Luis M." approverRole="manager" filled={3} />
          </Item>
          <Item label="Remove a tablet">
            <RemoveTabletSheet inline label="Counter tablet" enrolled="Aug 14 by Mike" lastUsed="Today, 2:31pm" onShift="Jen R." />
          </Item>
        </div>
        <Item label="The removed tablet" frame>
          <TabletRemovedScreen by="Mike" shop={SHOP} at="2:40pm" />
        </Item>
      </Sec>

      <Sec title="Parts">
        <Item label="Buttons" frame pad>
          <div className="g-row">
            <button type="button" className="c-btn">
              Resend
            </button>
            <button type="button" className="c-btn c-btn-primary">
              New charge
            </button>
            <button type="button" className="c-btn c-btn-danger">
              Cancel charge
            </button>
            <button type="button" className="c-btn c-linkish">
              Not now
            </button>
          </div>
        </Item>
        <Item label="Chips" frame pad>
          <div className="g-row">
            <Chip tone="settled">Confirmed</Chip>
            <Chip tone="underway">2 waiting</Chip>
            <Chip tone="underway" dot>
              On break &middot; 9m
            </Chip>
            <Chip tone="absent">Expired</Chip>
            <Chip tone="live" live>
              Waiting for card
            </Chip>
            <Chip tone="neutral">Voided</Chip>
          </div>
        </Item>
        <Item label="Figures, labels and rows" frame pad>
          <p className="c-label">Today</p>
          <p className="c-fig c-fig-hero" style={{ marginTop: 6 }}>
            $900.00
          </p>
          <p className="c-det" style={{ marginTop: 4 }}>
            3 confirmed &middot; <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>$1,350.00 waiting</strong> on two
            customers
          </p>
          <div className="c-rows" style={{ marginTop: 'var(--s3)', maxWidth: 420 }}>
            <div>
              <div className="c-kv">
                <span>Takes off</span>
                <span className="c-v c-t-sav">&minus;$86.80</span>
              </div>
            </div>
            <div>
              <div className="c-kv">
                <span>New total</span>
                <span className="c-v">$834.77</span>
              </div>
            </div>
            <div>
              <div className="c-line" style={{ alignItems: 'baseline' }}>
                <div>
                  <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>Marcus T.</p>
                  <p className="c-det" style={{ marginTop: 3 }}>
                    11:02am &middot; Jen
                  </p>
                </div>
                <span className="c-fig c-fig-row">$412.00</span>
              </div>
            </div>
          </div>
        </Item>
        <Item label="Segmented: in a sheet (44px), inline (34px), and the mode switch" frame pad>
          <div className="g-row" style={{ alignItems: 'center' }}>
            <Segmented label="Discount by" value={seg} onChange={setSeg} options={[{ value: 'pct', label: '%' }, { value: 'amt', label: '$' }]} />
            <Segmented
              kind="wide"
              label="Discount"
              value={seg}
              onChange={setSeg}
              options={[
                { value: 'pct', label: 'Code' },
                { value: 'amt', label: 'Amount' },
              ]}
            />
            <Segmented
              kind="mode"
              label="View"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'amount', label: 'List' },
                { value: 'items', label: 'Tiles' },
              ]}
            />
          </div>
        </Item>
        <Item label="Tick boxes, toggle, stepper" frame pad>
          <div className="g-row" style={{ alignItems: 'center' }}>
            <TickBox on={tick} onChange={setTick} label="Owed to you" />
            <TickBox on={tick} onChange={setTick} settled label="Owed to you, settled" />
            <TickBox on={!tick} onChange={(v) => setTick(!v)} label="Not ticked" />
            <TickBox kind="check" on={tick} onChange={setTick} label="Nitrogen fill" />
            <TickBox kind="charge" on={tick} onChange={setTick} label="1 × Goodyear Assurance" />
            <TickBox kind="agree" on={tick} onChange={setTick} label="I agree" />
            <Toggle on={tg} onChange={setTg} label="Once per customer" />
            <Toggle on={!tg} onChange={(v) => setTg(!v)} label="Off" />
            <Stepper value={qty} onChange={setQty} />
          </div>
        </Item>
        <Item label="Search, stock and payment method" frame pad>
          <div className="g-row" style={{ alignItems: 'center' }}>
            <SearchField value={q} onChange={setQ} placeholder="Search items" />
            <StockDot level="ok">14 in stock</StockDot>
            <StockDot level="low" held={2}>
              6 left
            </StockDot>
            <StockDot level="out">Out</StockDot>
            <MethodMark method="clear" />
            <MethodMark method="card" />
            <MethodMark method="cash" />
          </div>
        </Item>
        <Item label="Step strip" frame pad>
          <StepStrip
            current={0}
            steps={[
              { t: 'Scan the code', det: 'Now' },
              { t: 'Approve $940.00', det: 'On your phone' },
              { t: 'Choose how to pay', det: 'Also on your phone' },
            ]}
          />
        </Item>
        <Item label="PIN dots, keys and code boxes" frame pad>
          <div className="g-row">
            <div style={{ width: 320 }}>
              <PinDots filled={2} />
              <PinDots filled={4} bad />
              <PinKeys onDigit={() => undefined} onDelete={() => undefined} left="Not me" />
            </div>
            <div>
              <CodeBoxes value="48271" />
              <CodeBoxes value="482719" bad />
              <CodeBoxes value="3905" small />
            </div>
          </div>
        </Item>
      </Sec>
    </div>
  );
}
