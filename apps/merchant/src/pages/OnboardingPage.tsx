import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { OwnerSignIn } from '@/auth/OwnerSignIn';
import { ClearMark } from '@/brand/icons';
import { cx, initials } from '@/brand/ui';
import { api } from '@/data/apiClient';
import { useLayout } from '@/lib/useBreakpoint';
import { usePage } from '@/lib/usePage';
import { Chip, Chips, Drop, Field, Foot, Frame, Kvs, ObCell, PhoneFrame, StepHead, STEPS, Tick } from '@/onboarding/views';

/**
 * Onboarding — docs/merchant-reference/clear-merchant-onboarding.html.
 *
 * Only what a Clear charge needs: who you are, your shop, your team, your terms, verifying, where
 * payouts go, and training the counter. Cards, readers, items, the drawer, tips and discounts are
 * not in signup; they are a checklist on Home afterwards. The step list sits on the left of a
 * tablet; on a phone it becomes a line and a bar at the top.
 *
 * **What creates the shop.** The API makes the shop and its wallet from a verified owner sign-in,
 * the owner's name and a four-digit counter PIN, so on a live signup the Verify step is that
 * sign-in: nothing is written to Clear until then, and an owner who stops halfway leaves nothing
 * behind. Bridge's business check, codes, bank linking and the team have no backend here yet; the
 * preview shows them as drawn: `?preview=1&step=1..7`, `&done=1`, `&team=solo`, `&code=warn|bad`,
 * `&verify=needs|verified`, `&bank=waiting`.
 */

interface Form {
  shopName: string;
  ownerName: string;
  email: string;
  mobile: string;
  street: string;
  city: string;
  stateZip: string;
  sell: string;
  typical: string;
  people: string;
  code: string;
}

const EMPTY: Form = { shopName: '', ownerName: '', email: '', mobile: '', street: '', city: '', stateZip: '', sell: '', typical: '', people: '' , code: '' };

const REFERENCE_FORM: Form = {
  shopName: 'Mike’s Tire',
  ownerName: 'Mike R.',
  email: 'mike@mikestire.com',
  mobile: '(909) 555-0118',
  street: '412 Colton Ave',
  city: 'Redlands',
  stateZip: 'CA 92374',
  sell: 'Auto and tires',
  typical: 'Over $500',
  people: '2 to 5',
  code: 'KAI-1104',
};

const KEY = 'clear.merchant.onboarding';

/** "Save and finish later" keeps the form on this device, and nothing else. */
function remembered(): Form {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return EMPTY;
  }
}

const TERMS: [string, string, string, boolean][] = [
  ['Paid now', '1.5%', '1.25%', true],
  ['Paid over time', '2.5%', '2.0%', true],
  ['Card processing', '2.7% + 35¢ a sale', 'Same', false],
  ['Monthly fee', 'None', 'None', false],
  ['Payouts', 'On the 14th, sooner when the pool allows', 'Same', false],
  ['Approval cap', '$1,500.00', 'Same', false],
];

const CODE_MSG = {
  ok: ['settled', 'Founding partner · 2 of 5 left', 'Lowers both Clear rates for as long as you are a partner.'],
  warn: ['underway', 'All 5 founding places are taken', 'Standard terms apply. Nothing about your setup changes.'],
  bad: ['absent', 'Not a code we know', 'Check the letters and numbers, or carry on without one.'],
} as const;

const TRAINING = [
  ['What the customer sees', 'A minute, on your own phone: the text, the approval, pay now or over time.'],
  ['Take a practice charge', '$1.00 in practice mode. Nobody is charged, and it never reaches your payouts.'],
  ['The one sentence to say', '“Nothing is charged until you approve it on your phone.” Everything else is detail.'],
] as const;

export default function OnboardingPage() {
  usePage('onboarding');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const phone = useLayout() === 'phone';

  const preview = import.meta.env.DEV && params.get('preview') === '1';
  const [step, setStep] = useState(() => (preview ? Math.max(0, Math.min(6, Number(params.get('step') ?? 1) - 1)) : 0));
  const [done, setDone] = useState(preview && params.get('done') === '1');
  const [f, setF] = useState<Form>(() => (preview ? REFERENCE_FORM : remembered()));
  const [codeState, setCodeState] = useState<keyof typeof CODE_MSG | null>(preview ? ((params.get('code') as 'warn' | 'bad') ?? 'ok') : null);
  const [agree, setAgree] = useState(preview);
  const [roles, setRoles] = useState<Record<string, 'Counter' | 'Manager'>>({ jen: 'Counter', luis: 'Manager' });
  const [trained, setTrained] = useState([preview, preview, false, false]);
  const [pin, setPin] = useState('');
  const [shop, setShop] = useState<{ merchant: string; signerReady: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof Form) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    if (preview) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(f));
    } catch {
      // A private window: the form simply isn't kept.
    }
  }, [f, preview]);

  const back = step > 0 ? () => setStep(step - 1) : undefined;
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const later = () => navigate('/');
  const solo = f.people === 'Just me' || (preview && params.get('team') === 'solo');

  /**
   * Create the shop, with the token the owner's sign-in just verified. The merchant address comes
   * back rather than being chosen: it is the address of the wallet Privy creates, so the registry,
   * the payout destination and Clear's own record name the same thing by construction.
   */
  async function createShop(privyToken: string) {
    setError(null);
    try {
      const res = await api.onboard({
        privyToken,
        shopName: f.shopName,
        ownerName: f.ownerName,
        ownerPin: pin,
        category: f.sell || null,
        town: f.city || null,
      });
      setShop({ merchant: res.merchant, signerReady: res.signerReady });
      try {
        localStorage.removeItem(KEY);
      } catch {
        // Nothing to forget.
      }
      next();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again in a moment.');
      throw e;
    }
  }

  // ---- The steps ------------------------------------------------------------------------------------
  const pane = (() => {
    switch (step) {
      case 0:
        return (
          <>
            <StepHead
              phone={phone}
              step={0}
              title="Take Clear payments at your counter"
              sub="Customers join in about three minutes and can pay now or over time. You are paid on the 14th, and sooner when the pool allows. Setting up takes about ten."
            />
            <div className="c-ob-fields">
              <Field label="Business name" value={f.shopName} onChange={set('shopName')} />
              {!preview && <Field label="Your name" value={f.ownerName} onChange={set('ownerName')} hint="As it should read on the charges you raise" />}
              <Field label="Your email" value={f.email} onChange={set('email')} inputMode="email" hint="Where your payouts and statements go" />
              <Field label="Your mobile" value={f.mobile} onChange={set('mobile')} inputMode="tel" hint="For sign-in codes. Never shown to customers" />
            </div>
            <p className="c-det c-ob-note">No rep needed. If someone from Clear is with you, they can sit beside you, but every step is yours to do.</p>
            <Foot phone={phone} primary="Start" onPrimary={next} disabled={!f.shopName.trim() || (!preview && !f.ownerName.trim())} />
          </>
        );
      case 1:
        return (
          <>
            <StepHead phone={phone} step={1} title="Your shop" sub="Where it is, and what it sells. This sets up tax and a few defaults you can change any time in Settings." />
            <div className="c-ob-fields">
              <Field label="Street address" value={f.street} onChange={set('street')} />
              <div className="c-ob-two">
                <Field label="City" value={f.city} onChange={set('city')} />
                <Field label="State and ZIP" value={f.stateZip} onChange={set('stateZip')} />
              </div>
            </div>
            {preview && (
              // Stripe Tax works the rate out from the address; until it's connected there is no rate to show.
              <div className="c-ob-result">
                <span className="c-dot" />
                <p className="c-det">
                  <b>Sales tax here is 7.75%.</b> Worked out from your address, so you never type a rate.
                </p>
              </div>
            )}
            <Chips label="What you sell" options={['Auto and tires', 'Retail', 'Food and drink', 'Services', 'Something else']} value={f.sell} onPick={set('sell')} />
            <Chips
              label="A typical sale"
              options={['Under $50', '$50 to $500', 'Over $500']}
              value={f.typical}
              onPick={set('typical')}
              hint="Sets list or tiles at the counter, and tip amounts or percentages"
            />
            <Chips label="People at the counter" options={['Just me', '2 to 5', '6 or more']} value={f.people} onPick={set('people')} />
            <Foot phone={phone} back={back} primary="Continue" onPrimary={next} />
          </>
        );
      case 2:
        return (
          <>
            <StepHead
              phone={phone}
              step={2}
              title="Your team"
              sub="Everyone who will use the counter, so every charge carries the name of whoever raised it. You can add or change people in Staff any time."
            />
            {solo ? (
              <ObCell label="Your team" right={<span className="c-det">You said just me</span>}>
                <p className="c-ob-bt">Just you, for now</p>
                <p className="c-det" style={{ marginTop: 4, lineHeight: 1.5 }}>
                  This step is skipped and the list on the left marks it so. When you hire, add people in Staff and they pick a PIN on their first shift.
                </p>
              </ObCell>
            ) : (
              <ObCell
                label="Who uses the counter"
                right={<span className="c-det">{f.people ? `You said ${f.people}` : ''}</span>}
                foot={<p className="c-det">Each picks a four-digit PIN on their first shift. Counter can charge; a manager can also approve refunds and close the day.</p>}
              >
                <div className="c-ob-person">
                  <span className="c-ob-av">{initials(f.ownerName || 'You')}</span>
                  <div className="c-nm">
                    <p className="c-t">{f.ownerName || 'You'}</p>
                    <p className="c-det">{f.email || '—'}</p>
                  </div>
                  <span className="c-det">Owner · you</span>
                </div>
                {preview &&
                  (
                    [
                      ['jen', 'Jen R.', '(909) 555-0142 · gets a text to join'],
                      ['luis', 'Luis M.', 'No mobile yet'],
                    ] as const
                  ).map(([id, name, det]) => (
                    <div key={id} className="c-ob-person">
                      <span className="c-ob-av">{initials(name)}</span>
                      <div className="c-nm">
                        <p className="c-t">{name}</p>
                        <p className="c-det">{det}</p>
                      </div>
                      <div className="c-st-chips c-ob-roles">
                        {(['Counter', 'Manager'] as const).map((r) => (
                          <button key={r} type="button" className={cx('c-btn', roles[id] === r && 'c-on')} onClick={() => setRoles({ ...roles, [id]: r })}>
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                <div className="c-ob-person c-add">
                  <span className="c-ob-av c-add">+</span>
                  <div className="c-nm">
                    <p className="c-t">Add someone</p>
                    <p className="c-det">{preview ? 'Name and role. Their mobile is optional' : 'After setup, in Staff'}</p>
                  </div>
                </div>
              </ObCell>
            )}
            <Foot phone={phone} back={back} primary="Continue" onPrimary={next} skip={solo ? undefined : next} />
          </>
        );
      case 3: {
        const msg = codeState ? CODE_MSG[codeState] : null;
        const better = codeState === 'ok';
        return (
          <>
            <StepHead
              phone={phone}
              step={3}
              title="Your terms"
              sub="Standard terms are what most shops sign. A code can replace some of them, and you see exactly what it changes before anything is applied."
            />
            <ObCell label="Have a code?" right={phone ? undefined : <span className="c-det">Optional</span>}>
              <div className="c-ob-code">
                <div className="c-ob-codein">
                  <input className="c-field c-ob-in" aria-label="Code" value={f.code} onChange={(e) => set('code')(e.target.value.toUpperCase())} />
                  <button
                    type="button"
                    className="c-btn"
                    disabled={!preview || !f.code}
                    onClick={() => setCodeState(f.code === 'KAI-1104' ? 'ok' : f.code === 'KAI-0932' ? 'warn' : 'bad')}
                  >
                    Apply
                  </button>
                </div>
                {msg && (
                  <div className={cx('c-ob-codemsg', `c-${codeState}`)}>
                    <Chip tone={msg[0]}>{msg[1]}</Chip>
                    <p className="c-det">{msg[2]}</p>
                  </div>
                )}
              </div>
            </ObCell>
            <ObCell label="What you pay" right={phone ? undefined : <span className="c-det">Taken at each sale</span>}>
              <div className="c-ob-terms">
                <div className="c-ob-tr c-th">
                  <span />
                  <span className="c-std c-label">Standard</span>
                  <span className="c-you c-label">With your code</span>
                </div>
                {TERMS.map(([k, std, you, lower]) => (
                  <div key={k} className="c-ob-tr">
                    <span>{k}</span>
                    <span className="c-std">{std}</span>
                    <span className={cx('c-you', better && lower && 'c-better')}>{better ? you : lower ? std : you}</span>
                  </div>
                ))}
              </div>
            </ObCell>
            {!phone && (
              <label className="c-ob-agree">
                <Tick on={agree} onChange={setAgree} />
                <span>
                  I agree to the Clear Partner terms, including the card processing and payout terms above. <span className="c-ob-link">Read them</span>
                </span>
              </label>
            )}
            <Foot phone={phone} back={back} primary={phone ? 'Accept' : 'Accept and continue'} onPrimary={next} disabled={!phone && !agree} />
          </>
        );
      }
      case 4: {
        const verify = params.get('verify');
        if (!preview)
          return (
            <>
              <StepHead
                phone={phone}
                step={4}
                title="Verify it is you"
                sub="This creates your shop and its wallet. Sign in with an emailed code or a passkey, and that account becomes the owner of the shop."
              />
              <div className="c-ob-fields">
                {/* The PIN before the sign-in: a PIN refused after the wallet exists would leave a
                    wallet nobody can reach, so the cheap check comes first. */}
                <Field
                  label="Your PIN for the counter"
                  value={pin}
                  onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))}
                  inputMode="numeric"
                  placeholder="4 digits"
                  hint="Starts your shift and names you on charges. Signing in is what protects the money."
                />
              </div>
              {shop ? (
                <ObCell label="Your shop" right={<Chip tone="settled">Created</Chip>}>
                  <Kvs rows={[['Wallet', `${shop.merchant.slice(0, 6)}…${shop.merchant.slice(-4)}`]]} />
                </ObCell>
              ) : pin.length === 4 && f.shopName && f.ownerName ? (
                <div className="c-ob-cell">
                  <OwnerSignIn
                    embedded
                    blurb="Clear holds no password. Sign in with an emailed code or a passkey, and that account becomes the owner of this shop."
                    onToken={createShop}
                    onDone={() => undefined}
                  />
                </div>
              ) : null}
              {error && (
                <p className="c-det c-ob-note" role="alert">
                  {error}
                </p>
              )}
              <Foot phone={phone} back={back} primary="Continue" onPrimary={next} disabled={!shop} />
            </>
          );
        return (
          <>
            <StepHead
              phone={phone}
              step={4}
              title="Verify the business"
              sub="Bridge, who moves money in and out of your Clear account, checks the business and its owner, as the law requires. It happens in their secure window, and Clear never sees or stores your full Social Security number."
            />
            {verify === 'needs' ? (
              <ObCell label="Your business" right={<Chip tone="underway">Needs one thing</Chip>}>
                <p className="c-ob-bt">They need your EIN letter from the IRS</p>
                <p className="c-det" style={{ marginTop: 4 }}>
                  The CP 575 or 147C with your business name on it. A photo is fine.
                </p>
                <Drop label="Add a photo or PDF" />
              </ObCell>
            ) : verify === 'verified' ? (
              <ObCell label="Your business" right={<Chip tone="settled">Verified</Chip>}>
                <Kvs
                  rows={[
                    ['Legal name', 'Mike’s Tire LLC'],
                    ['Verified', 'Aug 11, 10:42am'],
                  ]}
                />
              </ObCell>
            ) : (
              <ObCell
                label="Your business"
                right={<Chip tone="underway">In review</Chip>}
                foot={<p className="c-det">Usually a few minutes. You can keep going while it finishes; payouts wait for it.</p>}
              >
                <Kvs
                  rows={[
                    ['Legal name', 'Mike’s Tire LLC'],
                    ['EIN', '••-•••4829'],
                    ['Owner', 'Mike R. · identity checked'],
                  ]}
                />
              </ObCell>
            )}
            <Foot phone={phone} back={back} primary="Continue while it finishes" onPrimary={next} />
          </>
        );
      }
      case 5: {
        const waiting = params.get('bank') === 'waiting';
        return (
          <>
            <StepHead phone={phone} step={5} title="Where payouts go" sub="One business account for payouts, in the same name as the business you verified." />
            {!preview ? (
              <ObCell label="Business bank account" right={<Chip tone="neutral">Not linked yet</Chip>}>
                <p className="c-det" style={{ lineHeight: 1.5 }}>
                  Link it in Settings before your first payout, through your bank’s own sign-in. Nobody at Clear sees it.
                </p>
              </ObCell>
            ) : waiting ? (
              <ObCell label="Business bank account" right={<Chip tone="underway">Waiting on deposits</Chip>}>
                <p className="c-det" style={{ lineHeight: 1.5 }}>
                  Two small deposits are on their way to the account ending 4417. When they land, in one or two business days, enter them in Settings to finish.
                </p>
              </ObCell>
            ) : (
              <ObCell
                label="Business bank account"
                right={<Chip tone="settled">Linked</Chip>}
                foot={
                  <div className="c-line" style={{ alignItems: 'center' }}>
                    <p className="c-det">
                      <LockSm /> Linked with Plaid, through your bank’s own sign-in. Nobody at Clear sees it.
                    </p>
                    <span className="c-ob-link">Change</span>
                  </div>
                }
              >
                <Kvs
                  rows={[
                    ['Account', 'Chase ••4417 · checking'],
                    ['In the name of', 'Mike’s Tire LLC'],
                    ['Payouts', 'On the 14th, and sooner when the pool allows'],
                  ]}
                />
              </ObCell>
            )}
            <ObCell label="Your Clear cash account" right={<Chip tone="neutral">Opens with verification</Chip>}>
              <p className="c-det" style={{ lineHeight: 1.5 }}>
                Money that is free before the 14th lands here, in your business’s name. It is held as USDC, digital dollars, in your shop’s own wallet, and Bridge moves it to your bank whenever you withdraw, at no cost. It is not a bank account and is not FDIC-insured.
              </p>
            </ObCell>
            <Foot phone={phone} back={back} primary="Continue" onPrimary={next} />
          </>
        );
      }
      default:
        return (
          <>
            <StepHead phone={phone} step={6} title="The counter" sub="Signing takes four minutes; training the counter is what decides whether the shop actually uses it." />
            <ObCell
              label="Train the counter"
              right={<span className="c-det">About fifteen minutes, together</span>}
              foot={<p className="c-det">This is the step shops skip, so it lives here and not in an email.</p>}
            >
              {TRAINING.map(([t, det], i) => (
                <div key={t} className={cx('c-ob-train', trained[i] && 'c-done')}>
                  <Tick on={trained[i]} onChange={(v) => setTrained(trained.map((x, k) => (k === i ? v : x)))} />
                  <div>
                    <p className="c-t">{t}</p>
                    <p className="c-det">{det}</p>
                    {i === 0 && (
                      <span className="c-ob-link c-ob-play">
                        <PlaySm />
                        Watch
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <div className={cx('c-ob-train', trained[3] && 'c-done')}>
                <Tick on={trained[3]} onChange={(v) => setTrained([...trained.slice(0, 3), v])} />
                <div>
                  <p className="c-t">Their first shift</p>
                  <p className="c-det">
                    {preview ? 'Jen and Luis, from Your team,' : 'Everyone you add in Staff'} each pick a four-digit PIN the first time they start a shift. Nothing to set now.
                  </p>
                </div>
              </div>
            </ObCell>
            <ObCell label="This tablet" right={<span className="c-det">Becomes the counter tablet</span>}>
              <Kvs
                rows={[
                  ['Name', 'Counter tablet'],
                  ['Signed in as', f.shopName || '—'],
                ]}
              />
            </ObCell>
            <Foot phone={phone} back={back} primary="Finish setup" onPrimary={() => setDone(true)} />
          </>
        );
    }
  })();

  const root = phone ? 'c-app c-mc-tablet c-mc-page c-ob-ph' : 'c-app c-mc-tablet c-ob';
  const style = { height: 'auto', minHeight: '100dvh' };

  if (done)
    return (
      <div className={root} style={style}>
        {phone ? null : (
          <div className="c-ob-top">
            <span className="c-mc-who">
              <span className="c-lockup">
                <ClearMark />
                <span className="c-wm">Clear</span>
              </span>
              <span className="c-mc-for">Setting up {f.shopName}</span>
            </span>
            <span className="c-ob-save">Save and finish later</span>
          </div>
        )}
        <div className="c-ob-done">
          <span className="c-ob-live" aria-hidden="true" />
          <p className="c-ob-title">{f.shopName || 'Your shop'} is set up</p>
          <p className="c-det c-ob-sub">
            {preview
              ? 'You can take a Clear charge now. Verification finished while you were training the counter.'
              : `You can take a Clear charge now.${shop && !shop.signerReady ? ' Payouts switch on before your first one.' : ''}`}
          </p>
          <div className="c-ob-next">
            <button type="button" className="c-btn c-btn-primary" onClick={() => navigate(`/new${preview ? '?preview=1' : ''}`)}>
              Take your first charge
            </button>
            <button type="button" className="c-btn" onClick={() => navigate(preview ? '/?preview=1' : '/')}>
              Go to Home
            </button>
          </div>
          <p className="c-det">Cards, items, a reader and the drawer are on a short list on Home, to do at your own pace.</p>
        </div>
      </div>
    );

  return (
    <div className={root} style={style}>
      {phone ? (
        <PhoneFrame step={step} onSave={later}>
          {pane}
        </PhoneFrame>
      ) : (
        <Frame shop={f.shopName} step={step} onSave={later}>
          {pane}
        </Frame>
      )}
    </div>
  );
}

const LockSm = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="1" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

const PlaySm = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="m10 8.5 5 3.5-5 3.5z" />
  </svg>
);

