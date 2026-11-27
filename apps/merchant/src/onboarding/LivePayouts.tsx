import { type ReactNode, useCallback, useEffect, useState } from 'react';
import type { BankAccount, KybStatus } from '@clear/merchant-contracts';
import { useMerchantApi } from '@/data/merchantApi';
import { errorSentence } from '@/data/useApi';
import { runPlaidLink } from '@/lib/plaidLink';
import { KYB } from '@/settings/panes';
import { Chip, Field, Kvs, ObCell } from './views';

/** Where money that's free early lands: the shop's own wallet, held as USDC. */
export function CashAccountCell({ chip }: { chip: ReactNode }) {
  return (
    <ObCell label="Your Clear cash account" right={chip}>
      <p className="c-det" style={{ lineHeight: 1.5 }}>
        Money that is free before the 14th lands here, in your business’s name. It is held as USDC, digital dollars, in your shop’s own wallet, and Bridge moves it to your bank whenever you withdraw, at no cost. It is not a bank account and is not FDIC-insured.
      </p>
    </ObCell>
  );
}

const TONE: Record<KybStatus['state'], 'settled' | 'underway' | 'absent' | 'neutral'> = {
  not_started: 'neutral',
  needs_info: 'underway',
  in_review: 'underway',
  verified: 'settled',
  rejected: 'absent',
  paused: 'underway',
};

/**
 * Onboarding › Where payouts go, on a live signup: the business verified by Bridge (in a new tab,
 * so signup stays where it is), then the bank linked with Plaid once Bridge has verified it. The
 * owner was signed in when the shop was made, so this is Settings' own flow, one step at a time.
 * Everything here can wait: Continue is always there, and Settings has the same.
 */
export function LivePayouts({ signedIn, shopName, email }: { signedIn: boolean; shopName: string; email: string }) {
  const m = useMerchantApi();
  const [kyb, setKyb] = useState<KybStatus | null>(null);
  const [banks, setBanks] = useState<BankAccount[] | null>(null);
  const [legalName, setLegalName] = useState(shopName);
  const [bizEmail, setBizEmail] = useState(email);
  const [busy, setBusy] = useState<'verify' | 'check' | 'link' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    const k = await m.kyb();
    setKyb(k);
    setBanks(k.state === 'verified' ? await m.bankAccounts() : null);
  }, [m]);
  useEffect(() => {
    if (signedIn) read().catch((e: unknown) => setError(errorSentence(e)));
  }, [signedIn, read]);

  const run = async (what: 'verify' | 'check' | 'link', fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorSentence(e));
    } finally {
      setBusy(null);
    }
  };
  const verify = () =>
    run('verify', async () => {
      const { url } = await m.startKyb({ legalName: legalName.trim(), email: (kyb?.email ?? bizEmail).trim() });
      // Bridge's pages in their own tab: signup stays here, and Check again reads where it got to.
      window.open(url, '_blank', 'noopener');
      await read();
    });
  const link = () =>
    run('link', async () => {
      const { linkToken } = await m.bankLinkToken();
      const chosen = await runPlaidLink(linkToken);
      if (chosen) {
        await m.addBank(chosen);
        setBanks(await m.bankAccounts());
      }
    });

  const alert = error && (
    <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginTop: 'var(--s1)' }}>
      {error}
    </p>
  );

  const cash = <CashAccountCell chip={kyb?.state === 'verified' ? <Chip tone="settled">Ready</Chip> : <Chip tone="neutral">After verification</Chip>} />;
  if (!signedIn || (kyb && !kyb.available))
    return (
      <>
        <ObCell label="Business bank account" right={<Chip tone="neutral">Not linked yet</Chip>}>
          <p className="c-det" style={{ lineHeight: 1.5 }}>
            Link it in Settings before your first payout, through your bank’s own sign-in. Nobody at Clear sees it.
          </p>
        </ObCell>
        {cash}
      </>
    );
  if (!kyb)
    return (
      <>
        <ObCell label="Business verification" right={<Chip tone="neutral">Checking</Chip>}>
          <p className="c-det">{error ? '' : 'Reading where it stands…'}</p>
          {alert}
        </ObCell>
        {cash}
      </>
    );

  const v = KYB[kyb.state];
  const started = kyb.state !== 'not_started';
  return (
    <>
      <ObCell
        label="Business verification"
        right={<Chip tone={TONE[kyb.state]}>{v.chip}</Chip>}
        foot={
          kyb.state === 'verified' ? undefined : (
            <div className="c-line" style={{ alignItems: 'center', gap: 'var(--s1)' }}>
              <p className="c-det">{started && kyb.email ? `Under ${kyb.email}. ` : ''}Bridge’s pages open in a new tab.</p>
              <span style={{ display: 'flex', gap: 'var(--s1)', flex: 'none' }}>
                {started && (
                  <button type="button" className="c-btn" disabled={busy !== null} onClick={() => run('check', read)}>
                    {busy === 'check' ? 'Checking…' : 'Check again'}
                  </button>
                )}
                {v.cta && (
                  <button
                    type="button"
                    className="c-btn c-btn-primary"
                    disabled={busy !== null || (!started && (!legalName.trim() || !bizEmail.trim()))}
                    onClick={() => void verify()}
                  >
                    {busy === 'verify' ? 'Opening Bridge…' : v.cta}
                  </button>
                )}
              </span>
            </div>
          )
        }
      >
        <p className="c-det" style={{ lineHeight: 1.5 }}>
          {v.t}
          {kyb.state === 'rejected' && kyb.reason ? ` Bridge says: ${kyb.reason}.` : ''}
        </p>
        {!started && (
          <div className="c-ob-fields" style={{ marginTop: 'var(--s2)' }}>
            <Field label="Legal business name" value={legalName} onChange={setLegalName} hint="As it appears on the business’s registration" />
            <Field label="Business email" value={bizEmail} onChange={setBizEmail} inputMode="email" hint="One that belongs to the business, not the one you use yourself" />
          </div>
        )}
        {alert}
      </ObCell>
      {kyb.state === 'verified' ? (
        <ObCell
          label="Business bank account"
          right={<Chip tone={banks?.length ? 'settled' : 'neutral'}>{banks?.length ? 'Linked' : 'Not linked yet'}</Chip>}
          foot={
            <div className="c-line" style={{ alignItems: 'center', gap: 'var(--s1)' }}>
              <p className="c-det">Linked with Plaid, through your bank’s own sign-in. Nobody at Clear sees it.</p>
              <button type="button" className={banks?.length ? 'c-btn' : 'c-btn c-btn-primary'} disabled={busy !== null} onClick={() => void link()} style={{ flex: 'none' }}>
                {busy === 'link' ? 'Linking…' : banks?.length ? 'Add another' : 'Link a bank account'}
              </button>
            </div>
          }
        >
          {banks?.length ? (
            <Kvs rows={banks.map((b) => [b.bankName, `••${b.mask} · ${b.subtype}`] as [string, string])} />
          ) : (
            <p className="c-det" style={{ lineHeight: 1.5 }}>
              One business account, in the same name as the business Bridge verified.
            </p>
          )}
        </ObCell>
      ) : (
        <ObCell label="Business bank account" right={<Chip tone="neutral">After verification</Chip>}>
          <p className="c-det" style={{ lineHeight: 1.5 }}>
            Bridge pays out only to a verified business. Link the bank here or in Settings once it has.
          </p>
        </ObCell>
      )}
      {cash}
    </>
  );
}
