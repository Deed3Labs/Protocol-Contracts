import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppKit, useAppKitAccount } from '@/lib/walletCompat';
import {
  claimPayoutBank,
  claimPayoutDebit,
  claimPayoutWallet,
  resendClaimOtp,
  startClaim,
  verifyClaimOtp,
} from '@/utils/apiClient';
import type { ClaimPayoutMethod, ClaimPayoutResponse, ClaimSession, VerifyClaimOtpResponse } from '@/types/send';
import { AlertCircle, Building2, CheckCircle2, CreditCard, Loader2, RefreshCcw, Wallet } from 'lucide-react';
import Wordmark from '@/components/app-ui/Wordmark';

/** Display USDC stored as 6-decimal micros (the ledger format) as a dollar amount. */
function fmtUsd(value: string | number | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value ?? 0;
  if (!Number.isFinite(n)) return '$0.00';
  const dollars = n >= 100000 ? n / 1_000_000 : n; // tolerate both micros and already-dollar values
  return `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type ClaimStep = 'connect' | 'loading' | 'otp' | 'method' | 'processing' | 'success' | 'error';

function storageKey(prefix: string, token: string): string {
  return `send_claim_${prefix}_${token}`;
}

function safeStorageGet(key: string): string | null {
  try {
    const local = window.localStorage.getItem(key);
    if (local !== null) return local;
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // no-op
  }
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // no-op
  }
}

function safeStorageRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // no-op
  }
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // no-op
  }
}

export default function ClaimFunds() {
  const { token = '' } = useParams();
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const requireAppKitForClaim =
    (import.meta.env.VITE_SEND_CLAIM_REQUIRE_APPKIT || 'true').trim().toLowerCase() === 'true';

  const [step, setStep] = useState<ClaimStep>('loading');
  const [error, setError] = useState<string | null>(null);
  const [claimSession, setClaimSession] = useState<ClaimSession | null>(null);
  const [verifiedClaim, setVerifiedClaim] = useState<VerifyClaimOtpResponse | null>(null);
  const [otp, setOtp] = useState('');
  const [otpCooldownUntil, setOtpCooldownUntil] = useState<number>(0);
  const [selectedMethod, setSelectedMethod] = useState<ClaimPayoutMethod | null>(null);
  const [walletInput, setWalletInput] = useState('');
  const [bridgeFullName, setBridgeFullName] = useState('');
  const [bridgeEmail, setBridgeEmail] = useState('');
  const [payoutResult, setPayoutResult] = useState<ClaimPayoutResponse | null>(null);

  const bootstrapClaim = useCallback(async () => {
    if (!token) return;

    setStep('loading');
    setError(null);

    const started = await startClaim(token);
    if (!started) {
      setError('Could not start claim session. Reconnect and retry. If it still fails, the link may be expired.');
      setStep('error');
      return;
    }

    setClaimSession(started);
    setOtpCooldownUntil(Date.now() + started.resendCooldownSeconds * 1000);
    safeStorageSet(storageKey('session', token), JSON.stringify(started));
    setStep('otp');
  }, [token]);

  const retryAfterSeconds = useMemo(() => {
    const remainingMs = otpCooldownUntil - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }, [otpCooldownUntil]);

  useEffect(() => {
    if (!token) {
      setError('Invalid claim link.');
      setStep('error');
      return;
    }

    if (requireAppKitForClaim && !isConnected) {
      setError(null);
      setStep('connect');
      return;
    }

    const savedVerifiedRaw = safeStorageGet(storageKey('verified', token));
    if (savedVerifiedRaw) {
      try {
        const parsed = JSON.parse(savedVerifiedRaw) as VerifyClaimOtpResponse;
        setVerifiedClaim(parsed);
        setWalletInput('');
        setStep('method');
        return;
      } catch {
        safeStorageRemove(storageKey('verified', token));
      }
    }

    const savedSessionRaw = safeStorageGet(storageKey('session', token));
    if (savedSessionRaw) {
      try {
        const parsed = JSON.parse(savedSessionRaw) as ClaimSession;
        setClaimSession(parsed);
        setOtpCooldownUntil(Date.now());
        setStep('otp');
        return;
      } catch {
        safeStorageRemove(storageKey('session', token));
      }
    }

    bootstrapClaim().catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to initialize claim flow');
      setStep('error');
    });
  }, [token, isConnected, requireAppKitForClaim, bootstrapClaim]);

  useEffect(() => {
    if (isConnected && address) {
      setWalletInput((current) => (current.trim() ? current : address));
    }
  }, [isConnected, address]);

  const handleVerifyOtp = async () => {
    if (!claimSession) {
      setError('Claim session is missing.');
      setStep('error');
      return;
    }

    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Enter the 6-digit OTP code.');
      return;
    }

    setError(null);
    setStep('processing');

    const verified = await verifyClaimOtp(claimSession.claimSessionId, otp.trim());
    if (!verified) {
      setError('OTP verification failed. Check the code and try again.');
      setStep('otp');
      return;
    }

    setVerifiedClaim(verified);
    safeStorageSet(storageKey('verified', token), JSON.stringify(verified));
    safeStorageRemove(storageKey('session', token));
    setStep('method');
  };

  const handleResendOtp = async () => {
    if (!claimSession) return;
    if (retryAfterSeconds > 0) return;

    setError(null);
    const resent = await resendClaimOtp(claimSession.claimSessionId);
    if (!resent) {
      setError('Could not resend OTP. Please try again shortly.');
      return;
    }

    setOtp('');
    setOtpCooldownUntil(Date.now() + resent.resendCooldownSeconds * 1000);
  };

  const executePayout = async (method: ClaimPayoutMethod) => {
    if (!verifiedClaim) {
      setError('Claim session is not verified.');
      return;
    }

    setSelectedMethod(method);
    setError(null);
    setStep('processing');

    let response: ClaimPayoutResponse | null = null;

    if (method === 'DEBIT') {
      response = await claimPayoutDebit(verifiedClaim.claimSessionToken, {
        bridgeFullName: bridgeFullName.trim() || undefined,
        bridgeEmail: bridgeEmail.trim().toLowerCase() || undefined,
      });
      if (response && response.success === false && response.fallbackMethod === 'BANK') {
        setPayoutResult(response);
        setError('Debit payout unavailable for this recipient. You can continue with bank payout.');
        setStep('method');
        return;
      }
    }

    if (method === 'BANK') {
      response = await claimPayoutBank(verifiedClaim.claimSessionToken, {
        bridgeFullName: bridgeFullName.trim() || undefined,
        bridgeEmail: bridgeEmail.trim().toLowerCase() || undefined,
      });
    }

    if (method === 'WALLET') {
      const walletAddress = walletInput.trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        setError('Enter a valid EVM wallet address.');
        setStep('method');
        return;
      }
      response = await claimPayoutWallet(verifiedClaim.claimSessionToken, walletAddress);
    }

    if (!response) {
      setError('Payout failed. Please retry.');
      setStep('method');
      return;
    }

    if (!response.success) {
      setError(response.reason || 'Payout failed.');
      setPayoutResult(response);
      setStep('method');
      return;
    }

    setPayoutResult(response);
    safeStorageRemove(storageKey('verified', token));
    safeStorageRemove(storageKey('session', token));
    setStep('success');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <Wordmark className="h-7" />
          <h1 className="mt-5 font-display text-2xl tracking-tight text-foreground">Claim your money</h1>
          <p className="mt-1 text-sm text-muted-foreground">Someone sent you money on Clear — choose how to receive it.</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          {step === 'loading' && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">Loading your claim…</p>
            </div>
          )}

          {step === 'connect' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-secondary/40 p-3 text-xs">
                <p className="font-medium text-foreground">Create an account or connect a wallet</p>
                <p className="mt-1 text-muted-foreground">
                  To keep your money safe, sign in first. You can use email, a social login, or a wallet.
                </p>
              </div>
              <button
                type="button"
                onClick={() => open({ view: isConnected ? 'Account' : 'Connect' })}
                className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
              >
                {isConnected ? 'Open account' : 'Get started'}
              </button>
            </div>
          )}

          {step === 'otp' && claimSession && (
            <div className="space-y-4">
              <div className="rounded-xl bg-secondary/40 p-4 text-center">
                <div className="text-xs text-muted-foreground">You're claiming</div>
                <div className="mt-0.5 font-display text-4xl tracking-tight text-foreground tabular-nums">{fmtUsd(claimSession.transfer.principalUsdc)}</div>
                <div className="mt-1 text-xs text-muted-foreground">Sent to {claimSession.recipientMasked}</div>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Enter the 6-digit code we sent you</span>
                <input
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="• • • • • •"
                  className="w-full rounded-xl border border-border bg-background px-3 py-3 text-center font-display text-xl tracking-[0.4em] tabular-nums text-foreground placeholder:tracking-normal placeholder:text-muted-foreground/50 focus:border-foreground/30 focus:outline-none"
                />
              </label>

              <button
                type="button"
                onClick={handleVerifyOtp}
                className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
              >
                Verify
              </button>
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={retryAfterSeconds > 0}
                className="flex w-full items-center justify-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                {retryAfterSeconds > 0 ? `Resend in ${retryAfterSeconds}s` : 'Resend code'}
              </button>
            </div>
          )}

          {step === 'method' && verifiedClaim && (
            <div className="space-y-4">
              <div className="rounded-xl bg-secondary/40 p-4 text-center">
                <div className="text-xs text-muted-foreground">Ready to claim</div>
                <div className="mt-0.5 font-display text-4xl tracking-tight text-foreground tabular-nums">{fmtUsd(verifiedClaim.transfer.principalUsdc)}</div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">How do you want it?</div>
                {verifiedClaim.payoutMethods.includes('DEBIT') && (
                  <button
                    type="button"
                    onClick={() => executePayout('DEBIT')}
                    className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-secondary/50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground"><CreditCard className="h-[18px] w-[18px]" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">Debit card</span>
                      <span className="block text-xs text-muted-foreground">Instant when eligible (bank fallback)</span>
                    </span>
                  </button>
                )}

                {verifiedClaim.payoutMethods.includes('BANK') && (
                  <button
                    type="button"
                    onClick={() => executePayout('BANK')}
                    className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-secondary/50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground"><Building2 className="h-[18px] w-[18px]" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">Bank account</span>
                      <span className="block text-xs text-muted-foreground">ACH transfer · arrives in 1–3 days</span>
                    </span>
                  </button>
                )}

                {verifiedClaim.payoutMethods.includes('WALLET') && (
                  <div className="rounded-xl border border-border p-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground"><Wallet className="h-[18px] w-[18px]" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">Crypto wallet</span>
                        <span className="block text-xs text-muted-foreground">Connected, embedded, or paste an address</span>
                      </span>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <input
                        value={walletInput}
                        onChange={(event) => setWalletInput(event.target.value)}
                        placeholder="0x…"
                        className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => executePayout('WALLET')}
                        className="shrink-0 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-transform active:scale-[0.97]"
                      >
                        Claim
                      </button>
                    </div>
                    {!isConnected && (
                      <button
                        type="button"
                        onClick={() => open({ view: 'Connect' })}
                        className="mt-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        Connect a wallet
                      </button>
                    )}
                  </div>
                )}
              </div>

              {(verifiedClaim.payoutMethods.includes('DEBIT') || verifiedClaim.payoutMethods.includes('BANK')) && (
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs font-medium text-foreground">Payout details</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Only needed if your bank/card payout requires verification.</p>
                  <div className="mt-3 grid gap-2">
                    <input
                      value={bridgeFullName}
                      onChange={(event) => setBridgeFullName(event.target.value)}
                      placeholder="Full legal name"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
                    />
                    <input
                      value={bridgeEmail}
                      onChange={(event) => setBridgeEmail(event.target.value)}
                      type="email"
                      placeholder="Email"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {payoutResult?.status === 'DEBIT_FALLBACK_REQUIRED' && verifiedClaim.payoutMethods.includes('BANK') && (
                <button
                  type="button"
                  onClick={() => executePayout('BANK')}
                  className="w-full rounded-xl border border-border py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
                >
                  Continue with bank payout
                </button>
              )}

              {payoutResult?.status === 'ACTION_REQUIRED' && payoutResult.onboardingUrl && (
                <a
                  href={payoutResult.onboardingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block w-full rounded-xl border border-border py-2.5 text-center text-sm font-medium text-foreground transition-colors hover:bg-secondary"
                >
                  Continue verification
                </a>
              )}
            </div>
          )}

          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                {selectedMethod ? `Processing your ${selectedMethod.toLowerCase()} payout…` : 'Processing…'}
              </p>
            </div>
          )}

          {step === 'success' && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-positive/10">
                <CheckCircle2 className="h-7 w-7 text-positive" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">You've got your money</p>
                <p className="mt-1 text-sm text-muted-foreground">Your claim is complete.</p>
              </div>
              <div className="space-y-1.5 rounded-xl bg-secondary/40 p-3 text-left text-xs">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Method</span>
                  <span className="font-medium text-foreground">{payoutResult?.method || selectedMethod}</span>
                </div>
                {payoutResult?.providerReference && (
                  <div className="flex justify-between gap-4">
                    <span className="shrink-0 text-muted-foreground">Reference</span>
                    <span className="truncate text-foreground">{payoutResult.providerReference}</span>
                  </div>
                )}
                {payoutResult?.walletTxHash && (
                  <div className="flex justify-between gap-4">
                    <span className="shrink-0 text-muted-foreground">Tx hash</span>
                    <span className="truncate text-foreground">{payoutResult.walletTxHash}</span>
                  </div>
                )}
                {payoutResult?.eta && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Arrives</span>
                    <span className="text-foreground">{payoutResult.eta}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'error' && (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-negative/10">
                <AlertCircle className="h-7 w-7 text-negative" />
              </div>
              <p className="mt-4 max-w-[300px] text-sm text-muted-foreground">{error || 'Something went wrong with this claim.'}</p>
              <button
                type="button"
                onClick={() => {
                  if (requireAppKitForClaim && !isConnected) {
                    setStep('connect');
                    return;
                  }
                  bootstrapClaim().catch((err) => {
                    setError(err instanceof Error ? err.message : 'Failed to restart claim flow');
                    setStep('error');
                  });
                }}
                className="mt-5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
              >
                Try again
              </button>
            </div>
          )}

          {error && step !== 'error' && (
            <div className="mt-4 rounded-xl border border-negative/30 bg-negative/10 p-2.5 text-xs text-negative">
              {error}
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-[11px] text-muted-foreground">Secured by Clear · your money is held safely until you claim it</p>
      </div>
    </div>
  );
}
