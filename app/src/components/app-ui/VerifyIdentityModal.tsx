import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAppKitAccount } from '@/lib/walletCompat';
import { useIdentity } from '@/context/IdentityContext';
import { openWhileWaiting, type IdentityState } from '@/lib/identityStatus';
import { toIsoDob, toFormattedSsn } from '@/lib/identityFields';
import { getBankIdentity, submitIdentity, type BankIdentity } from '@/utils/apiClient';

/*
 * Verifying identity — one modal, several entry points.
 *
 * Reached from Settings, card activation, and (when they exist) counter onboarding and the first
 * term plan. Same screens each time; only where the member came from differs, which is why this
 * takes no "flow" prop — the closing screen is chosen by the status Lithic returns, not by the
 * caller's opinion of what should happen next.
 *
 * ## What is deliberately on screen
 *
 * "This is not a credit check" — because a member asked for an SSN two screens after being told
 * there is no credit check will assume they were lied to. Naming the difference is the whole
 * reason the sentence exists.
 *
 * "Clear never keeps it" — a real architectural claim, not reassurance: the values below go to the
 * card issuer and are never persisted, logged or echoed back. Said where the field is, rather than
 * in a privacy policy.
 *
 * ## What is NOT here
 *
 * The ID-photo upload for PENDING_DOCUMENT. That screen explains the state and stops, because the
 * upload should go straight from the browser to the issuer rather than through us — routing a
 * passport photo through our server makes us responsible for it in exactly the way we are avoiding.
 * Building it half-way, as a button that looks like it works, would be worse than saying so.
 */

type Step = 'form' | 'checking' | 'result';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[13px] text-foreground-secondary">{label}</span>
      <span className="text-[13px] text-foreground">{value}</span>
    </div>
  );
}

function Outcome({ state, onClose }: { state: IdentityState; onClose: () => void }) {
  const { open, waiting } = openWhileWaiting(state);

  if (state === 'verified') {
    return (
      <div className="space-y-4 text-center">
        <p className="text-lg text-foreground">You&rsquo;re verified</p>
        <p className="text-[13px] text-foreground-secondary">Nothing else to do</p>
        <div className="rounded-xl border border-border px-3 py-2 text-left">
          <Row label="Credit" value="Ready to use" />
          <Row label="Term plans" value="Unlocked" />
          <Row label="Your card" value="Ships in 5–7 days" />
        </div>
        <Button variant="clear" className="w-full" onClick={onClose}>Continue</Button>
      </div>
    );
  }

  if (state === 'rejected') {
    /*
     * The screen the design did not have, and the hardest copy in the flow.
     *
     * No retry button: re-submitting the same details produces the same answer, and a button that
     * implies otherwise sends someone round a loop that cannot end. No reason either — a rejection
     * reason is rarely something the member can act on and guessing at it invites an argument the
     * app cannot settle. What it does say is what still works, because that is true and it is the
     * part they need.
     */
    return (
      <div className="space-y-4 text-center">
        <p className="text-lg text-foreground">We couldn&rsquo;t verify you</p>
        <p className="text-[13px] leading-relaxed text-foreground-secondary">
          We&rsquo;re not able to open credit or a card on this account. Support can look at it with
          you — they can see things this screen can&rsquo;t.
        </p>
        <div className="rounded-xl border border-border px-3 py-2 text-left">
          {open.map((name) => <Row key={name} label={name} value="Open now" />)}
          {waiting.length > 0 && <Row label={waiting.join(' and ')} value="Not available" />}
        </div>
        <Button variant="clear" className="w-full" onClick={onClose}>Done</Button>
      </div>
    );
  }

  const heading =
    state === 'needs_document'
      ? 'One more thing'
      : state === 'needs_resubmit'
        ? 'Something didn’t match'
        : 'Under review';
  const detail =
    state === 'needs_document'
      ? 'We couldn’t match your details automatically. A photo of your ID sorts it out — we’ll send you a secure link to add one.'
      : state === 'needs_resubmit'
        ? 'One of the details didn’t match your records. We’ll be in touch about which one so you can correct it.'
        : 'Usually within a day.';

  return (
    <div className="space-y-4 text-center">
      <p className="text-lg text-foreground">{heading}</p>
      <p className="text-[13px] leading-relaxed text-foreground-secondary">{detail}</p>
      {/*
        * What still works has to be here.
        *
        * A member who has just handed over a social security number and been told to wait assumes
        * everything is frozen. Savings and Earn need no verification — that is their own money — so
        * saying they are open turns a dead end into a waiting room.
        */}
      <div className="rounded-xl border border-border px-3 py-2 text-left">
        {open.map((name) => <Row key={name} label={name} value="Open now" />)}
        <Row label={waiting.join(' and ')} value="When this clears" />
      </div>
      <Button variant="clear" className="w-full" onClick={onClose}>Done</Button>
    </div>
  );
}

export default function VerifyIdentityModal() {
  const { address } = useAppKitAccount();
  const { open, closeVerification, status, refresh } = useIdentity();
  const [step, setStep] = useState<Step>('form');
  const [bank, setBank] = useState<BankIdentity>({ legalName: null, address: null });
  const [dob, setDob] = useState('');
  const [ssn, setSsn] = useState('');
  const [editingDetails, setEditingDetails] = useState(false);
  const [name, setName] = useState('');
  const [address1, setAddress1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postal, setPostal] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Prefill from the bank. Nulls leave the fields empty and `editingDetails` on, which is the
  // difference between a member at an institution with Plaid Identity and one without.
  useEffect(() => {
    if (!open || !address) return;
    void getBankIdentity(address).then((result) => {
      setBank(result);
      setName(result.legalName ?? '');
      setAddress1(result.address?.address1 ?? '');
      setCity(result.address?.city ?? '');
      setState(result.address?.state ?? '');
      setPostal(result.address?.postalCode ?? '');
      setEditingDetails(!result.legalName || !result.address?.address1);
    });
  }, [open, address]);

  const reset = () => {
    // The SSN does not outlive the modal. It is in memory while the form is open and nowhere else:
    // no draft in localStorage, no analytics event, nothing kept for a retry.
    setSsn('');
    setDob('');
    setStep('form');
    setError(null);
  };

  const close = () => {
    reset();
    closeVerification();
    void refresh();
  };

  const submit = async () => {
    setError(null);
    const isoDob = toIsoDob(dob);
    if (!isoDob) return setError('Enter your date of birth as MM/DD/YYYY. You must be 18 or over.');
    const formattedSsn = toFormattedSsn(ssn);
    if (!formattedSsn) return setError('A social security number is nine digits.');
    const [firstName, ...rest] = name.trim().split(/\s+/);
    if (!firstName || rest.length === 0) return setError('Enter your first and last name as they appear on your bank account.');
    if (!phone.trim()) return setError('We need a phone number for your card issuer.');
    if (!email.trim()) return setError('We need an email address for your card issuer.');
    if (!address1.trim() || !city.trim() || !state.trim() || !postal.trim()) {
      return setError('We need your full home address, including street.');
    }

    setBusy(true);
    setStep('checking');
    const result = await submitIdentity({
      firstName,
      lastName: rest.join(' '),
      email: email.trim(),
      // E.164. Lithic rejects anything else, and a member types a number the way they say it.
      phoneNumber: phone.trim().startsWith('+') ? phone.replace(/\s/g, '') : `+1${phone.replace(/\D/g, '')}`,
      dob: isoDob,
      governmentId: formattedSsn,
      address: { address1: address1.trim(), city: city.trim(), state: state.trim(), postal_code: postal.trim() },
    });
    setBusy(false);
    // Clear the sensitive fields the moment they have been sent, whatever the answer.
    setSsn('');
    setDob('');

    if (!result.ok) {
      setError(result.error ?? "That didn't go through. Please try again.");
      setStep('form');
      return;
    }
    await refresh();
    setStep('result');
  };

  const field = 'w-full rounded-lg border border-border bg-transparent px-3 py-2 text-[15px] text-foreground placeholder:text-foreground-secondary';

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-w-sm">
        {step === 'form' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-lg text-foreground">Verify your identity</p>
              <p className="text-[12px] leading-relaxed text-foreground-secondary">
                The law requires us to know who our members are before we can lend. This is not a
                credit check — nothing here touches your score.
              </p>
            </div>

            <label className="block space-y-1">
              <span className="text-[12px] text-foreground-secondary">Date of birth</span>
              <input className={field} inputMode="numeric" autoComplete="off" placeholder="MM / DD / YYYY"
                value={dob} onChange={(e) => setDob(e.target.value)} />
            </label>

            <label className="block space-y-1">
              <span className="text-[12px] text-foreground-secondary">Social security number</span>
              {/* type=password so it is not shoulder-read; autoComplete off so it is never saved. */}
              <input className={field} type="password" inputMode="numeric" autoComplete="off"
                placeholder="••• •• ••••" value={ssn} onChange={(e) => setSsn(e.target.value)} />
            </label>

            {!editingDetails ? (
              <div className="rounded-xl border border-border px-3 py-2">
                <p className="text-[11px] text-foreground-secondary">From your linked bank</p>
                <p className="mt-1 text-[13px] text-foreground">{bank.legalName}</p>
                <p className="text-[12px] text-foreground-secondary">
                  {[bank.address?.address1, bank.address?.city, bank.address?.state].filter(Boolean).join(', ')}
                </p>
                <button type="button" className="mt-1.5 text-[12px] underline text-foreground-secondary"
                  onClick={() => setEditingDetails(true)}>
                  Not right? Change it
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input className={field} placeholder="Full legal name" value={name} onChange={(e) => setName(e.target.value)} />
                <input className={field} placeholder="Street address" value={address1} onChange={(e) => setAddress1(e.target.value)} />
                <div className="grid grid-cols-3 gap-2">
                  <input className={field} placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
                  <input className={field} placeholder="State" value={state} onChange={(e) => setState(e.target.value)} />
                  <input className={field} placeholder="ZIP" value={postal} onChange={(e) => setPostal(e.target.value)} />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <input className={field} placeholder="Phone number" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <input className={field} placeholder="Email address" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            {error && <p role="status" className="text-[12px] text-foreground">{error}</p>}

            <Button variant="clear" className="w-full" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Sending…' : 'Continue'}
            </Button>
            <p className="text-center text-[11px] leading-relaxed text-foreground-secondary">
              Encrypted and sent straight to our card issuer. Clear never keeps it.
            </p>
          </div>
        )}

        {step === 'checking' && (
          <div className="space-y-3 py-6 text-center">
            <p className="text-lg text-foreground">Checking</p>
            <p className="text-[13px] text-foreground-secondary">Details received · Matching your records</p>
            <p className="text-[12px] leading-relaxed text-foreground-secondary">
              Usually a few seconds. You can close this — we&rsquo;ll tell you either way.
            </p>
          </div>
        )}

        {step === 'result' && <Outcome state={status.state} onClose={close} />}
      </DialogContent>
    </Dialog>
  );
}
