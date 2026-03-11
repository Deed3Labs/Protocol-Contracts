import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppKitAccount } from '@reown/appkit/react';
import { ArrowLeft, CheckCircle2, Link2, Shield, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import {
  completeMemberWalletLinkHandoff,
  prepareMemberWalletLinkHandoff,
} from '@/utils/apiClient';
import {
  clearPendingWalletLinkHandoff,
  loadPendingWalletLinkHandoff,
} from '@/utils/walletLinkHandoff';

type WalletKind = 'Hardware' | 'Smart' | 'Embedded';

const WALLET_KIND_OPTIONS: WalletKind[] = ['Hardware', 'Smart', 'Embedded'];

const walletKindToApi = (kind: WalletKind): 'HARDWARE' | 'SMART' | 'EMBEDDED' => {
  switch (kind) {
    case 'Hardware':
      return 'HARDWARE';
    case 'Embedded':
      return 'EMBEDDED';
    case 'Smart':
    default:
      return 'SMART';
  }
};

const shortAddress = (value: string) =>
  value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;

export default function WalletLinkPage() {
  const navigate = useNavigate();
  const { address } = useAppKitAccount();
  const { openModal, signMessage, isAuthenticated } = useAppKitAuth();
  const [pending, setPending] = useState(() => loadPendingWalletLinkHandoff());
  const [walletKind, setWalletKind] = useState<WalletKind>('Smart');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    setPending(loadPendingWalletLinkHandoff());
  }, []);

  const expiresLabel = useMemo(() => {
    if (!pending?.expiresAt) return null;
    const date = new Date(pending.expiresAt);
    return Number.isNaN(date.valueOf()) ? null : date.toLocaleString();
  }, [pending?.expiresAt]);

  const handleConnectWallet = async () => {
    await openModal('Connect');
  };

  const handleCompleteLink = async () => {
    if (!pending) {
      setStatusMessage('No wallet-link handoff is waiting to be completed.');
      return;
    }
    if (!address) {
      setStatusMessage('Connect or switch to the wallet you want to link first.');
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const prepared = await prepareMemberWalletLinkHandoff({
        token: pending.token,
        walletAddress: address,
      });
      if (!prepared) {
        throw new Error('We could not prepare the wallet-link handoff.');
      }

      const signature = await signMessage(prepared.message);
      const wallets = await completeMemberWalletLinkHandoff({
        token: pending.token,
        walletAddress: address,
        signature,
        kind: walletKindToApi(walletKind),
      });
      if (!wallets) {
        throw new Error('We could not complete the wallet-link handoff.');
      }

      clearPendingWalletLinkHandoff();
      setPending(null);
      setIsComplete(true);
      setStatusMessage(`Wallet ${shortAddress(address)} is now linked to your Clear account.`);
    } catch (error) {
      console.error('Wallet-link handoff failed:', error);
      setStatusMessage(
        error instanceof Error ? error.message : 'Wallet linking failed.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0e0e0e] text-white">
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-10 sm:px-6">
        <div className="mb-8 flex items-center justify-between">
          <Button
            variant="outline"
            className="rounded-full border-white/10 bg-white/5 text-white hover:bg-white/10"
            onClick={() => navigate(isAuthenticated ? '/account?tab=connections' : '/login')}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-zinc-300">
            Wallet Link
          </div>
        </div>

        <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] sm:p-8">
          <div className="mb-8 max-w-2xl">
            <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-400">Clear account handoff</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Finish linking your next wallet
            </h1>
            <p className="mt-4 text-sm leading-6 text-zinc-300">
              This flow links another wallet to your existing Clear account without signing that wallet into a separate Clear profile.
            </p>
          </div>

          {!pending && !isComplete ? (
            <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-5 text-sm leading-6 text-amber-100">
              No pending wallet-link handoff was found in this browser session. Start from the Connections tab in your account, then return here.
            </div>
          ) : null}

          {pending ? (
            <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-5">
                <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                  <div className="flex items-start gap-3">
                    <div className="mt-1 rounded-2xl border border-sky-500/20 bg-sky-500/10 p-2 text-sky-300">
                      <Link2 className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{pending.label}</p>
                      <p className="mt-2 text-sm leading-6 text-zinc-300">
                        {pending.description || 'No description added for this wallet link.'}
                      </p>
                      {expiresLabel ? (
                        <p className="mt-3 text-[12px] uppercase tracking-[0.16em] text-zinc-400">
                          Expires {expiresLabel}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="connectedWallet" className="text-zinc-300">Connected wallet</Label>
                  <Input
                    id="connectedWallet"
                    readOnly
                    value={address ?? ''}
                    placeholder="Connect or switch to the wallet you want to link"
                    className="border-white/10 bg-white/5 text-white placeholder:text-zinc-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-zinc-300">Wallet type</Label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {WALLET_KIND_OPTIONS.map((kind) => (
                      <Button
                        key={kind}
                        type="button"
                        variant="outline"
                        className={walletKind === kind
                          ? 'rounded-2xl border-white bg-white text-black hover:bg-white/90'
                          : 'rounded-2xl border-white/10 bg-white/5 text-white hover:bg-white/10'}
                        onClick={() => setWalletKind(kind)}
                      >
                        {kind}
                      </Button>
                    ))}
                  </div>
                </div>

                {statusMessage ? (
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-zinc-200">
                    {statusMessage}
                  </div>
                ) : null}
              </div>

              <div className="space-y-4">
                <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-400">How this works</p>
                  <ul className="mt-4 space-y-3 text-sm leading-6 text-zinc-300">
                    <li className="flex gap-3"><Wallet className="mt-1 h-4 w-4 shrink-0 text-zinc-400" /><span>Connect or switch AppKit to the wallet you want to link.</span></li>
                    <li className="flex gap-3"><Shield className="mt-1 h-4 w-4 shrink-0 text-zinc-400" /><span>Do not complete a new Clear sign-in for this wallet. This page uses a separate link handoff.</span></li>
                    <li className="flex gap-3"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-zinc-400" /><span>Sign one dedicated wallet-link message to attach the wallet to your existing account.</span></li>
                  </ul>
                </div>

                <Button
                  variant="outline"
                  className="h-11 w-full rounded-2xl border-white/10 bg-white/5 text-white hover:bg-white/10"
                  onClick={() => void handleConnectWallet()}
                >
                  <Wallet className="h-4 w-4" />
                  Connect or switch wallet
                </Button>
                <Button
                  variant="outline"
                  className="h-11 w-full rounded-2xl border-white bg-white text-black hover:bg-white/90"
                  disabled={!pending || !address || isSubmitting}
                  onClick={() => void handleCompleteLink()}
                >
                  <Link2 className="h-4 w-4" />
                  {isSubmitting ? 'Signing and linking...' : 'Sign and finish linking'}
                </Button>
              </div>
            </div>
          ) : null}

          {isComplete ? (
            <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-6">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-300">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-lg font-medium text-white">Wallet linked</p>
                  <p className="mt-2 text-sm leading-6 text-emerald-50/90">
                    The wallet is now attached to your Clear account as a sign-in alias.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      className="rounded-2xl border-white bg-white text-black hover:bg-white/90"
                      onClick={() => navigate('/login')}
                    >
                      Continue to Clear
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-2xl border-white/10 bg-white/5 text-white hover:bg-white/10"
                      onClick={() => navigate('/account?tab=connections')}
                    >
                      Back to connections
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
