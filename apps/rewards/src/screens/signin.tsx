import type { PublicShopApp } from '@clear/merchant-contracts';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth, type Provider } from '../auth/auth';
import { useData, useRead } from '../data/context';
import { CLEAR_LOOK } from '../lib/brand';
import { HubTop, Screen, ShopTop, shopLook } from '../shell/ui';
import { shortName } from './parts';

/**
 * Signing in and signing up (sections 5 and 7). A phone and its code; or the way they sign in to
 * Clear, so a member lands in their own account. A number on no account is asked Already have
 * Clear? after its code, never before. Someone new gives a first name, and nothing else.
 */

type Step = 'phone' | 'code' | 'already' | 'welcome';

const LABEL: Record<Provider, string> = { email: 'Email', google: 'Google', apple: 'Apple' };

function Alt({ onPick, stack }: { onPick: (p: Provider) => void; stack?: boolean }) {
  const { providers } = useAuth();
  return (
    <div className={`sa-alt${stack ? ' sa-stack1' : ''}`}>
      {providers.map((p) => (
        <button key={p} className={stack ? 'sa-btn' : 'sa-btn sm'} onClick={() => onPick(p)}>
          {LABEL[p]}
        </button>
      ))}
    </div>
  );
}

/** Where a sign-in step was asked to start, in the preview: `?step=code` and so on. */
function useStep(): [Step, (s: Step) => void] {
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>((params.get('step') as Step) || 'phone');
  return [step, setStep];
}

function useSignIn(onDone: (firstName: string | null) => Promise<void> | void, firstName?: string) {
  const auth = useAuth();
  const [step, setStep] = useStep();
  const [phone, setPhone] = useState(auth.phone ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return {
    step,
    setStep,
    phone,
    setPhone,
    code,
    setCode,
    busy,
    error,
    send: run(async () => {
      if (phone.replace(/\D/g, '').length < 10) throw new Error('That isn’t a phone number');
      await auth.sendCode(phone);
      setStep('code');
    }),
    submit: run(async () => {
      const r = await auth.submitCode(code.replace(/\D/g, ''));
      if (r === 'no_account') setStep('already');
      else await onDone(null);
    }),
    isNew: run(async () => {
      await auth.createFromCode();
      if (firstName?.trim()) await onDone(firstName.trim());
      else setStep('welcome');
    }),
    other: (p: Provider, thenLinkPhone = false) => void run(() => auth.signInWith(p, { thenLinkPhone }))(),
  };
}

function Field({ label, children, first }: { label: string; children: ReactNode; first?: boolean }) {
  return (
    <>
      <p className="label" style={first ? undefined : { marginTop: 12 }}>
        {label}
      </p>
      {children}
    </>
  );
}

/** Already have Clear? (section 7): one question, only after the code, before anything is made. */
function Already({ s }: { s: ReturnType<typeof useSignIn> }) {
  return (
    <Screen look={CLEAR_LOOK}>
      <HubTop />
      <div className="sa-body">
        <div className="sa-m">
          <p className="sa-big2" style={{ textAlign: 'left', fontFamily: 'var(--font-display)' }}>
            Already have Clear?
          </p>
          <p className="det">Your number is confirmed, but it isn’t on a Clear account. If you have one, sign in to it and we’ll add this number, so you don’t end up with two.</p>
        </div>
        <div className="sa-m">
          <p className="label">Yes, sign in to my account</p>
          <Alt stack onPick={(p) => s.other(p, true)} />
        </div>
        <div className="sa-m" style={{ borderTop: '1px solid var(--seam)' }}>
          <button className="sa-btn k wide" disabled={s.busy} onClick={s.isNew}>
            No, I’m new
          </button>
          <p className="sa-sub">You can link a Clear account later from You.</p>
          {s.error ? <p className="r-err">{s.error}</p> : null}
        </div>
      </div>
    </Screen>
  );
}

/** Welcome: a first name, and the rewards start. Nothing to verify. */
export function Welcome({ onDone }: { onDone: () => void }) {
  const data = useData();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Screen look={CLEAR_LOOK}>
      <HubTop />
      <div className="sa-body">
        <div className="sa-m">
          <p className="sa-big2" style={{ textAlign: 'left', fontFamily: 'var(--font-display)' }}>
            Welcome
          </p>
          <p className="det">Your first name, and your rewards start.</p>
        </div>
        <div className="sa-m">
          <Field label="First name" first>
            <input className="sa-in" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" aria-label="First name" />
          </Field>
        </div>
        <div className="sa-m">
          <button
            className="sa-btn k wide"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await data.createPerson(name.trim());
                onDone();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'That didn’t work. Try again.');
                setBusy(false);
              }
            }}
          >
            Continue
          </button>
          <p className="sa-sub">Nothing to verify. Rewards need only your number.</p>
          {error ? <p className="r-err">{error}</p> : null}
        </div>
      </div>
    </Screen>
  );
}

/** The hub's first visit (section 7): a phone and its code, or the way they sign in to Clear. */
export function HubSignIn({ onDone }: { onDone: () => void }) {
  const s = useSignIn(() => onDone());
  if (s.step === 'already') return <Already s={s} />;
  if (s.step === 'welcome') return <Welcome onDone={onDone} />;
  return (
    <Screen look={CLEAR_LOOK}>
      <HubTop />
      <div className="sa-body">
        <div className="sa-m">
          <p className="sa-big2" style={{ textAlign: 'left', fontFamily: 'var(--font-display)' }}>
            All your rewards in one place
          </p>
          <p className="det">Points from every Clear shop you join. No card, no app store.</p>
        </div>
        <div className="sa-m">
          <Field label="Phone" first>
            <input className="sa-in" type="tel" inputMode="tel" autoComplete="tel" value={s.phone} onChange={(e) => s.setPhone(e.target.value)} aria-label="Phone" />
          </Field>
          {s.step === 'code' ? (
            <Field label="Code we texted">
              <input className="sa-in sa-code6" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={s.code} onChange={(e) => s.setCode(e.target.value)} aria-label="Code we texted" />
            </Field>
          ) : null}
          <button className="sa-btn k wide" disabled={s.busy} onClick={s.step === 'code' ? s.submit : s.send}>
            Continue
          </button>
          {s.error ? <p className="r-err">{s.error}</p> : null}
          <div className="sa-or">
            <span>Have Clear? Sign in your usual way</span>
          </div>
          <Alt onPick={(p) => s.other(p)} />
        </div>
      </div>
    </Screen>
  );
}

/**
 * Join a shop's rewards from its own link (section 5): a number, a code and an optional name. The
 * consent line is what joining records. A Clear member signs in their usual way instead.
 */
export function ShopJoin({ shop, onDone }: { shop: PublicShopApp; onDone: () => void }) {
  const data = useData();
  const [name, setName] = useState('');
  const join = async (firstName: string | null) => {
    if (firstName) await data.createPerson(firstName).catch(() => null);
    const person = await data.person();
    if (!person) return s.setStep('welcome');
    await data.join(shop.slug, { texts: 'codes' });
    onDone();
  };
  const s = useSignIn(join, name);
  const short = shortName(shop.name);
  if (s.step === 'already') return <Already s={s} />;
  if (s.step === 'welcome')
    return (
      <Welcome
        onDone={async () => {
          await data.join(shop.slug, { texts: 'codes' });
          onDone();
        }}
      />
    );
  return (
    <Screen look={shopLook(shop)}>
      <ShopTop shop={shop} />
      <div className="sa-body">
        <div className="sa-m">
          <p className="sa-big2" style={{ textAlign: 'left' }}>
            Join {short} Rewards
          </p>
          <p className="det">{shop.pitch}</p>
        </div>
        <div className="sa-m">
          <Field label="Phone" first>
            <input className="sa-in" type="tel" inputMode="tel" autoComplete="tel" value={s.phone} onChange={(e) => s.setPhone(e.target.value)} aria-label="Phone" />
          </Field>
          {s.step === 'code' ? (
            <Field label="Code we texted">
              <input className="sa-in sa-code6" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={s.code} onChange={(e) => s.setCode(e.target.value)} aria-label="Code we texted" />
            </Field>
          ) : (
            <Field label="First name">
              <input className="sa-in" placeholder="Optional" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" aria-label="First name, optional" />
            </Field>
          )}
          <p className="det" style={{ marginTop: 12 }}>
            {shop.name} sees your name, number and what you buy here. Nothing from anywhere else. Texts only for your codes; reply STOP to end them.
          </p>
        </div>
        <div className="sa-m">
          <button className="sa-btn b wide" disabled={s.busy} onClick={s.step === 'code' ? s.submit : s.send}>
            {s.step === 'code' ? 'Continue' : 'Send my code'}
          </button>
          {s.error ? <p className="r-err">{s.error}</p> : null}
          <div className="sa-or">
            <span>Have Clear? Sign in your usual way</span>
          </div>
          <Alt onPick={(p) => s.other(p)} />
        </div>
      </div>
    </Screen>
  );
}

/** Signed in, at a shop they haven't joined: the one-tap join, in the shop's look. */
export function ShopJoinTap({ shop, onDone }: { shop: PublicShopApp; onDone: () => void }) {
  const data = useData();
  const [busy, setBusy] = useState(false);
  const short = shortName(shop.name);
  return (
    <Screen look={shopLook(shop)}>
      <ShopTop shop={shop} />
      <div className="sa-body">
        <div className="sa-m">
          <p className="sa-big2" style={{ textAlign: 'left' }}>
            Join {short} Rewards
          </p>
          <p className="det">{shop.pitch}</p>
          <p className="det" style={{ marginTop: 12 }}>
            {shop.name} sees your name, number and what you buy here. Nothing from anywhere else. Texts only for your codes; reply STOP to end them.
          </p>
        </div>
        <div className="sa-m">
          <button
            className="sa-btn b wide"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await data.join(shop.slug, { texts: 'codes' });
              onDone();
            }}
          >
            Join
          </button>
        </div>
      </div>
    </Screen>
  );
}

/** Whether they've joined this shop: decides between its screens and joining. */
export function useJoined(slug: string, key: unknown) {
  return useRead((d) => d.me(slug).then((m) => Boolean(m.membership)), [slug, key]);
}
