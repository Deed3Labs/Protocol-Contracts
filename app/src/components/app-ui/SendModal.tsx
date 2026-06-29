import { useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { ACTIVE_CHAIN_ID } from '@/lib/clearNetwork';
import {
  ArrowLeft, Check, ChevronDown, Copy, CreditCard, Landmark, Loader2, Mail, Search,
  ShieldCheck, TriangleAlert, UserPlus, Wallet, Zap,
} from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useContacts, contactInitials } from '@/context/ContactsContext';
import { useExternalAccounts } from '@/context/ExternalAccountsContext';
import { useClearBalances } from '@/hooks/useClearBalances';
import { prepareSendTransfer, confirmSendTransferLock } from '@/utils/apiClient';
import { gaslessSendLock } from '@/lib/gaslessMoney';
import { isAaEnabled, aaSendLock } from '@/lib/aa';
import { cn } from '@/lib/utils';

/*
 * "Send" — Cash App-style money send, crypto fully abstracted. Pick a contact (or add one),
 * enter an amount from your balance, review, send. A recipient with a wallet gets it instantly;
 * one with only email/phone gets a link to claim.
 *
 * SEAMS (current backend = components/portfolio/SendFundsModal.tsx):
 *   wallet recipient  → direct USDC transfer to contact.wallet
 *   email/phone only  → lock USDC in the claim escrow + share the returned claim link
 *   funding !== balance → onramp/convert to USDC before sending (card/bank)
 */

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const QUICK = [25, 50, 100, 250];

interface Source {
  id: string;
  name: string;
  detail: string;
  icon: typeof Wallet;
}
export default function SendModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { contacts, getContact, openManager } = useContacts();
  const { accounts } = useExternalAccounts();
  const { address } = useAccount();
  const chainId = ACTIVE_CHAIN_ID; // mainnet on app.useclear.org, Base Sepolia on the demo
  const bal = useClearBalances();
  const BALANCE = bal.cash;
  const sources: Source[] = [
    { id: 'balance', name: 'Clear balance', detail: fmt(BALANCE), icon: Wallet },
    ...accounts.map((a) => ({ id: a.id, name: `${a.name} ••${a.mask}`, detail: a.type, icon: Landmark })),
    { id: 'card', name: 'Visa ••7705', detail: 'Debit card', icon: CreditCard },
  ];
  const [step, setStep] = useState<'compose' | 'review' | 'status'>('compose');
  const [picking, setPicking] = useState(false);
  const [contactId, setContactId] = useState<string | null>(null);
  const [amountStr, setAmountStr] = useState('');
  const [note, setNote] = useState('');
  const [sourceId, setSourceId] = useState('balance');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimUrl, setClaimUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('compose');
    setPicking(false);
    setContactId(null);
    setAmountStr('');
    setNote('');
    setSourceId('balance');
    setSourceOpen(false);
    setQuery('');
    setCopied(false);
    setError(null);
    setClaimUrl(null);
  }, [open]);

  useEffect(() => {
    if (step !== 'status') return;
    setDone(false);
    setError(null);
    setClaimUrl(null);

    let cancelled = false;
    (async () => {
      try {
        if (!address) throw new Error('Connect your wallet to send.');
        const rcpt = contactId ? getContact(contactId) : undefined;
        const recipientId = rcpt?.email || rcpt?.phone || rcpt?.wallet;
        if (!recipientId) throw new Error('Recipient has no email, phone, or wallet on file.');

        // Create the transfer record, then lock funds gaslessly (sender signs EIP-3009; relayer pays gas).
        const prepared = await prepareSendTransfer({
          recipient: recipientId,
          amount: amountStr,
          fundingSource: 'WALLET_USDC',
          memo: note || undefined,
          chainId,
        });
        if (!prepared?.transfer?.id) throw new Error('Could not prepare the transfer.');
        const t = prepared.transfer;

        let claim: string | null = null;
        if (isAaEnabled(chainId)) {
          // AA: lock USDC in the escrow in one sponsored op (approve + createTransfer), then the
          // server verifies the on-chain event and issues the claim link.
          const txHash = await aaSendLock({
            chainId,
            transferId: t.transferId as `0x${string}`,
            principalUsdcMicros: t.principalUsdc,
            sponsorFeeUsdcMicros: t.sponsorFeeUsdc,
            totalLockedUsdcMicros: t.totalLockedUsdc,
            recipientHintHash: t.recipientHintHash as `0x${string}`,
            expiresAt: t.expiresAt,
          });
          const confirmed = await confirmSendTransferLock(t.id, {
            transferId: t.transferId,
            escrowTxHash: txHash,
            aa: true,
          });
          claim = confirmed?.claimUrl ?? null;
        } else {
          // Fallback: EIP-3009 relayer locks funds (sender signs off-chain; relayer pays gas).
          const result = await gaslessSendLock({ transferRowId: t.id, ownerWallet: address });
          claim = result.claimUrl ?? null;
        }
        if (cancelled) return;
        setClaimUrl(claim);
        setDone(true);
        // Optimistic: the sent amount leaves Cash now; reconciles when the lock indexes.
        if (fromBalance) bal.applyOptimistic(-(Number(amountStr) || 0), 0);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Send failed.');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const amount = Number(amountStr) || 0;
  const recipient = contactId ? getContact(contactId) : undefined;
  const source = sources.find((s) => s.id === sourceId) ?? sources[0];
  const fromBalance = sourceId === 'balance';
  const overBalance = fromBalance && amount > BALANCE;
  const amountValid = amount >= 1 && !overBalance;
  const instant = Boolean(recipient?.wallet);
  const channel = recipient?.phone ? 'text' : 'email';

  const filtered = useMemo(
    () => contacts.filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(query.trim().toLowerCase())),
    [contacts, query],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[480px]">
        {/* ---- COMPOSE ---- */}
        {step === 'compose' && !picking && (
          <div className="p-5">
            <div className="mb-5 text-base font-semibold text-foreground">Send money</div>

            {/* recipient */}
            <label className="mb-2 block text-xs font-medium text-muted-foreground">To</label>
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
            >
              {recipient ? (
                <>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                    {contactInitials(recipient.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{recipient.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{recipient.email}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">Change</span>
                </>
              ) : (
                <>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                    <Search className="h-[18px] w-[18px]" />
                  </span>
                  <span className="flex-1 text-sm text-muted-foreground">Choose a contact</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </>
              )}
            </button>

            {/* amount */}
            <label className="mb-2 mt-5 block text-xs font-medium text-muted-foreground">Amount</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-display text-2xl text-muted-foreground">$</span>
              <input
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0"
                className="w-full rounded-xl border border-border bg-background py-3 pl-9 pr-4 font-display text-3xl tabular-nums text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/30 focus:outline-none"
              />
            </div>
            <div className="mt-2 flex gap-2">
              {QUICK.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setAmountStr(String(q))}
                  className={cn(
                    'flex-1 rounded-lg border py-1.5 text-sm font-medium transition-colors',
                    amount === q ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-secondary',
                  )}
                >
                  ${q}
                </button>
              ))}
            </div>

            {/* note */}
            <label className="mb-2 mt-5 block text-xs font-medium text-muted-foreground">Note <span className="font-normal">(optional)</span></label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What's it for?"
              maxLength={100}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
            />

            <button
              type="button"
              disabled={!recipient || !amountValid}
              onClick={() => setStep('review')}
              className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
            >
              Review
            </button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {overBalance ? 'Amount exceeds your balance' : fromBalance ? `${fmt(BALANCE)} available` : 'Sends are free'}
            </p>
          </div>
        )}

        {/* ---- RECIPIENT PICKER ---- */}
        {step === 'compose' && picking && (
          <div className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <button type="button" onClick={() => setPicking(false)} aria-label="Back" className="-ml-1 rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <span className="text-base font-semibold text-foreground">Choose recipient</span>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or email"
                className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
              />
            </div>
            <div className="mt-3 max-h-[44vh] space-y-1.5 overflow-y-auto">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setContactId(c.id);
                    setPicking(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-border p-2.5 text-left transition-colors hover:bg-secondary/50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                    {contactInitials(c.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{c.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{c.email}</span>
                  </span>
                  {c.wallet ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-positive/10 px-1.5 py-0.5 text-[10px] font-medium text-positive">
                      <Zap className="h-3 w-3" /> Instant
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Link</span>
                  )}
                </button>
              ))}
              {filtered.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">No matches.</div>}
            </div>
            <button
              type="button"
              onClick={() => openManager({ add: true })}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              <UserPlus className="h-4 w-4" /> Add a new contact
            </button>
          </div>
        )}

        {/* ---- REVIEW ---- */}
        {step === 'review' && recipient && (
          <div className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <button type="button" onClick={() => setStep('compose')} aria-label="Back" className="-ml-1 rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <span className="text-base font-semibold text-foreground">Review</span>
            </div>

            <div className="text-center">
              <div className="text-xs text-muted-foreground">You're sending</div>
              <div className="mt-0.5 font-display text-4xl tracking-tight text-foreground tabular-nums">{fmt(amount)}</div>
            </div>

            <div className="mt-5 space-y-2">
              {/* recipient */}
              <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                  {contactInitials(recipient.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] text-muted-foreground">To</span>
                  <span className="block truncate text-sm font-medium text-foreground">{recipient.name}</span>
                </span>
                <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', instant ? 'bg-positive/10 text-positive' : 'bg-secondary text-muted-foreground')}>
                  {instant ? <><Zap className="h-3 w-3" /> Instant</> : <><Mail className="h-3 w-3" /> Claim link</>}
                </span>
              </div>

              {/* funding source */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSourceOpen((o) => !o)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                    <source.icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] text-muted-foreground">From</span>
                    <span className="block truncate text-sm font-medium text-foreground">{source.name}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="hidden text-xs text-muted-foreground sm:inline">{source.detail}</span>
                    <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', sourceOpen && 'rotate-180')} />
                  </span>
                </button>
                {sourceOpen && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-md">
                    {sources.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSourceId(s.id);
                          setSourceOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-secondary"
                      >
                        <s.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground">{s.name}</span>
                          <span className="block text-xs text-muted-foreground">{s.detail}</span>
                        </span>
                        {s.id === sourceId && <Check className="h-4 w-4 shrink-0 text-foreground" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* breakdown */}
            <div className="mt-4 space-y-1.5 rounded-xl bg-secondary/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="tabular-nums text-foreground">{fmt(amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fee</span>
                <span className="font-medium text-positive">Free</span>
              </div>
              {note && (
                <div className="flex justify-between gap-4">
                  <span className="shrink-0 text-muted-foreground">Note</span>
                  <span className="truncate text-foreground">{note}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-1.5 font-medium">
                <span className="text-foreground">Total</span>
                <span className="tabular-nums text-foreground">{fmt(amount)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setStep('status')}
              className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
            >
              Send {fmt(amount)}
            </button>
            <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />
              {instant ? 'Arrives instantly · sent as USDC on Base' : `We'll ${channel} ${recipient.name.split(' ')[0]} a secure link to claim it`}
            </p>
          </div>
        )}

        {/* ---- STATUS ---- */}
        {step === 'status' && recipient && (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            {error ? (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-negative/10">
                  <TriangleAlert className="h-7 w-7 text-negative" />
                </div>
                <div className="mt-4 text-base font-semibold text-foreground">Send failed</div>
                <div className="mt-1 max-w-[280px] text-sm text-muted-foreground">{error}</div>
                <button
                  type="button"
                  onClick={() => setStep('review')}
                  className="mt-6 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
                >
                  Try again
                </button>
              </>
            ) : !done ? (
              <>
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                <div className="mt-4 text-base font-semibold text-foreground">Sending…</div>
                <div className="mt-1 text-sm text-muted-foreground">Sending {fmt(amount)} to {recipient.name}.</div>
              </>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-positive/10">
                  <Check className="h-7 w-7 text-positive" strokeWidth={3} />
                </div>
                <div className="mt-4 text-base font-semibold text-foreground">{instant ? 'Money sent' : 'Link sent'}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {instant ? (
                    <><span className="font-medium text-foreground">{fmt(amount)}</span> was sent to {recipient.name}.</>
                  ) : (
                    <>We sent {recipient.name} a link to claim <span className="font-medium text-foreground">{fmt(amount)}</span> via {channel === 'text' ? 'text' : 'email'}.</>
                  )}
                </div>

                {claimUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(claimUrl).catch(() => {});
                      setCopied(true);
                    }}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
                  >
                    {copied ? <><Check className="h-4 w-4 text-positive" /> Link copied</> : <><Copy className="h-4 w-4" /> Copy claim link</>}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="mt-3 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
                >
                  Done
                </button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
