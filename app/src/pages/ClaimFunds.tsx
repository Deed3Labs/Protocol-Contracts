import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppKit, useAppKitAccount } from '@reown/appkit/react';
import {
  claimPayoutBank,
  claimPayoutDebit,
  claimPayoutWallet,
  resendClaimOtp,
  startClaim,
  verifyClaimOtp,
} from '@/utils/apiClient';
import type { ClaimPayoutMethod, ClaimPayoutResponse, ClaimSession, VerifyClaimOtpResponse } from '@/types/send';
import { AlertCircle, CheckCircle2, Loader2, RefreshCcw, Wallet } from 'lucide-react';

type ClaimStep = 'connect' | 'loading' | 'otp' | 'method' | 'processing' | 'success' | 'error';

function storageKey(prefix: string, token: string): string {
  return `send_claim_${prefix}_${token}`;
}

function safeSessionGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // no-op
  }
}

function safeSessionRemove(key: string): void {
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
    safeSessionSet(storageKey('session_id', token), String(started.claimSessionId));
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

    const savedVerifiedRaw = safeSessionGet(storageKey('verified', token));
    if (savedVerifiedRaw) {
      try {
        const parsed = JSON.parse(savedVerifiedRaw) as VerifyClaimOtpResponse;
        setVerifiedClaim(parsed);
        setWalletInput('');
        setStep('method');
        return;
      } catch {
        safeSessionRemove(storageKey('verified', token));
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
    safeSessionSet(storageKey('verified', token), JSON.stringify(verified));
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
    safeSessionRemove(storageKey('verified', token));
    safeSessionRemove(storageKey('session_id', token));
    setStep('success');
  };

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-10 text-zinc-900 dark:bg-black dark:text-zinc-100">
      <div className="mx-auto w-full max-w-lg rounded-sm border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#0e0e0e]">
        <h1 className="text-2xl font-light tracking-tight">Claim Funds</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Choose how you want to receive this transfer.</p>

        {step === 'loading' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">Loading claim details...</p>
          </div>
        )}

        {step === 'connect' && (
          <div className="mt-5 space-y-4">
            <div className="rounded-sm border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/50">
              <p className="font-medium text-zinc-900 dark:text-zinc-100">Create account / connect wallet to claim</p>
              <p className="mt-1 text-zinc-500">
                To protect claim access, connect with AppKit first. If prompted, complete the sign-in step.
              </p>
              <p className="mt-1 text-zinc-500">
                On iOS Safari, use this button and finish the in-modal flow for email/social embedded wallet login.
              </p>
            </div>

            <button
              type="button"
              onClick={() => open({ view: isConnected ? 'Account' : 'Connect' })}
              className="w-full rounded-sm bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {isConnected ? 'Open Account' : 'Connect / Create Account'}
            </button>
          </div>
        )}

        {step === 'otp' && claimSession && (
          <div className="mt-5 space-y-4">
            <div className="rounded-sm border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/50">
              <p className="text-zinc-500">Amount</p>
              <p className="mt-1 text-base font-medium text-zinc-900 dark:text-zinc-100">${claimSession.transfer.principalUsdc}</p>
              <p className="mt-2 text-zinc-500">Recipient</p>
              <p className="mt-1 text-zinc-900 dark:text-zinc-100">{claimSession.recipientMasked}</p>
            </div>

            <label className="block space-y-1">
              <span className="text-sm font-medium">Enter OTP</span>
              <input
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                inputMode="numeric"
                maxLength={6}
                placeholder="6-digit code"
                className="w-full rounded-sm border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleVerifyOtp}
                className="flex-1 rounded-sm bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Verify OTP
              </button>
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={retryAfterSeconds > 0}
                className="inline-flex items-center gap-2 rounded-sm border border-zinc-200 px-3 py-2 text-sm text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
              >
                <RefreshCcw className="h-4 w-4" />
                {retryAfterSeconds > 0 ? `${retryAfterSeconds}s` : 'Resend'}
              </button>
            </div>
          </div>
        )}

        {step === 'method' && verifiedClaim && (
          <div className="mt-5 space-y-4">
            <div className="rounded-sm border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/50">
              <p className="text-zinc-500">Claim Amount</p>
              <p className="mt-1 text-base font-medium text-zinc-900 dark:text-zinc-100">${verifiedClaim.transfer.principalUsdc}</p>
              <p className="mt-2 text-zinc-500">Available methods</p>
              <p className="mt-1 text-zinc-900 dark:text-zinc-100">{verifiedClaim.payoutMethods.join(' • ')}</p>
            </div>

            <div className="space-y-2">
              {verifiedClaim.payoutMethods.includes('DEBIT') && (
                <button
                  type="button"
                  onClick={() => executePayout('DEBIT')}
                  className="w-full rounded-sm border border-zinc-200 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  <p className="font-medium">Debit Card</p>
                  <p className="text-xs text-zinc-500">Instant payout when eligible (bank fallback if not)</p>
                </button>
              )}

              {verifiedClaim.payoutMethods.includes('BANK') && (
                <button
                  type="button"
                  onClick={() => executePayout('BANK')}
                  className="w-full rounded-sm border border-zinc-200 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  <p className="font-medium">Bank Account</p>
                  <p className="text-xs text-zinc-500">ACH payout with ETA shown on success</p>
                </button>
              )}

              {verifiedClaim.payoutMethods.includes('WALLET') && (
                <div className="rounded-sm border border-zinc-200 p-3 dark:border-zinc-700">
                  <p className="text-sm font-medium">Crypto Wallet</p>
                  <p className="mt-1 text-xs text-zinc-500">Use connected wallet, embedded wallet, or paste an external address.</p>

                  <div className="mt-3 flex gap-2">
                    <input
                      value={walletInput}
                      onChange={(event) => setWalletInput(event.target.value)}
                      placeholder="0x..."
                      className="flex-1 rounded-sm border border-zinc-200 bg-white px-3 py-2 text-xs outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <button
                      type="button"
                      onClick={() => executePayout('WALLET')}
                      className="inline-flex items-center gap-1 rounded-sm bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      <Wallet className="h-3.5 w-3.5" />
                      Claim
                    </button>
                  </div>

                  {!isConnected && (
                    <button
                      type="button"
                      onClick={() => open({ view: 'Connect' })}
                      className="mt-2 rounded-sm border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      Connect with AppKit
                    </button>
                  )}
                </div>
              )}
            </div>

            {(verifiedClaim.payoutMethods.includes('DEBIT') || verifiedClaim.payoutMethods.includes('BANK')) && (
              <div className="rounded-sm border border-zinc-200 p-3 dark:border-zinc-700">
                <p className="text-sm font-medium">Fiat Onboarding Details</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Required only if your payout provider requests Bridge onboarding.
                </p>

                <div className="mt-3 grid gap-2">
                  <input
                    value={bridgeFullName}
                    onChange={(event) => setBridgeFullName(event.target.value)}
                    placeholder="Full legal name"
                    className="w-full rounded-sm border border-zinc-200 bg-white px-3 py-2 text-xs outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <input
                    value={bridgeEmail}
                    onChange={(event) => setBridgeEmail(event.target.value)}
                    type="email"
                    placeholder="Email for onboarding"
                    className="w-full rounded-sm border border-zinc-200 bg-white px-3 py-2 text-xs outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
              </div>
            )}

            {payoutResult?.status === 'DEBIT_FALLBACK_REQUIRED' && verifiedClaim.payoutMethods.includes('BANK') && (
              <button
                type="button"
                onClick={() => executePayout('BANK')}
                className="w-full rounded-sm border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Continue with Bank Payout
              </button>
            )}

            {payoutResult?.status === 'ACTION_REQUIRED' && payoutResult.onboardingUrl && (
              <a
                href={payoutResult.onboardingUrl}
                target="_blank"
                rel="noreferrer"
                className="block w-full rounded-sm border border-zinc-200 px-3 py-2 text-center text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Continue Onboarding
              </a>
            )}
          </div>
        )}

        {step === 'processing' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
              {selectedMethod ? `Processing ${selectedMethod.toLowerCase()} payout...` : 'Processing...'}
            </p>
          </div>
        )}

        {step === 'success' && (
          <div className="mt-6 space-y-4 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="text-sm font-medium">Funds claimed successfully.</p>
            <div className="rounded-sm border border-zinc-200 bg-zinc-50 p-3 text-left text-xs dark:border-zinc-800 dark:bg-zinc-900/50">
              <p className="text-zinc-500">Method</p>
              <p className="mt-1 text-zinc-900 dark:text-zinc-100">{payoutResult?.method || selectedMethod}</p>
              {payoutResult?.providerReference && (
                <>
                  <p className="mt-2 text-zinc-500">Reference</p>
                  <p className="mt-1 break-all text-zinc-900 dark:text-zinc-100">{payoutResult.providerReference}</p>
                </>
              )}
              {payoutResult?.walletTxHash && (
                <>
                  <p className="mt-2 text-zinc-500">Tx Hash</p>
                  <p className="mt-1 break-all text-zinc-900 dark:text-zinc-100">{payoutResult.walletTxHash}</p>
                </>
              )}
              {payoutResult?.eta && (
                <>
                  <p className="mt-2 text-zinc-500">ETA</p>
                  <p className="mt-1 text-zinc-900 dark:text-zinc-100">{payoutResult.eta}</p>
                </>
              )}
            </div>
          </div>
        )}

        {step === 'error' && (
          <div className="mt-6 flex flex-col items-center text-center">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">{error || 'Claim flow failed.'}</p>
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
              className="mt-3 rounded-sm border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Retry Claim
            </button>
          </div>
        )}

        {error && step !== 'error' && (
          <div className="mt-4 rounded-sm border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
