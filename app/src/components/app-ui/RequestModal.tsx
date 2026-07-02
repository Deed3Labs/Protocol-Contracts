import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Copy, Loader2, Mail, Search, ShieldCheck, UserPlus, Zap } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useContacts, contactInitials } from '@/context/ContactsContext';
import { useAppKitAccount } from '@/lib/walletCompat';
import { createPaymentRequest } from '@/utils/apiClient';
import { cn } from '@/lib/utils';

/*
 * "Request" — ask a contact to pay you. Same shape as Send (compose → review → status), minus
 * the funding source. A contact with a wallet gets an in-app request; email/phone-only gets a
 * payment link to settle.
 *
 * SEAM: mock for now. Wire to a request/invoice record + notify (XMTP message for wallet peers,
 * email/SMS payment link otherwise); on pay it settles into the requester's balance.
 */

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const QUICK = [25, 50, 100, 250];

export default function RequestModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { contacts, getContact, openManager } = useContacts();
  const { address } = useAppKitAccount();
  const [tab, setTab] = useState<'request' | 'receive'>('request');
  const [step, setStep] = useState<'compose' | 'review' | 'status'>('compose');
  const [picking, setPicking] = useState(false);
  const [contactId, setContactId] = useState<string | null>(null);
  const [amountStr, setAmountStr] = useState('');
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab('request');
    setStep('compose');
    setPicking(false);
    setContactId(null);
    setAmountStr('');
    setNote('');
    setQuery('');
    setCopied(false);
    setAddrCopied(false);
  }, [open]);

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setAddrCopied(true);
      setTimeout(() => setAddrCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  useEffect(() => {
    if (step !== 'status') return;
    setDone(false);
    const t = setTimeout(() => setDone(true), 1400);
    return () => clearTimeout(t);
  }, [step]);

  const amount = Number(amountStr) || 0;
  const recipient = contactId ? getContact(contactId) : undefined;
  const amountValid = amount >= 1;
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
            <div className="mb-4 text-base font-semibold text-foreground">Get paid</div>

            <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-secondary/50 p-1">
              <button
                type="button"
                onClick={() => setTab('request')}
                className={cn('rounded-lg py-1.5 text-sm font-medium transition-colors', tab === 'request' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                Request
              </button>
              <button
                type="button"
                onClick={() => setTab('receive')}
                className={cn('rounded-lg py-1.5 text-sm font-medium transition-colors', tab === 'receive' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                Receive
              </button>
            </div>

            {tab === 'receive' ? (
              address ? (
                <div>
                  <p className="mb-4 text-xs text-muted-foreground">
                    Send <span className="font-medium text-foreground">USDC on Base</span> to this address — it lands in your account.
                  </p>
                  <div className="mx-auto mb-4 w-fit rounded-2xl bg-white p-3 shadow-sm">
                    <QRCodeSVG value={address} size={176} bgColor="#ffffff" fgColor="#000000" level="M" />
                  </div>
                  <div className="rounded-xl border border-border bg-secondary/40 p-3">
                    <div className="mb-1 text-[11px] font-medium text-muted-foreground">Your deposit address</div>
                    <div className="break-all font-mono text-xs leading-relaxed text-foreground">{address}</div>
                  </div>
                  <button
                    type="button"
                    onClick={copyAddress}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
                  >
                    {addrCopied ? (
                      <>
                        <Check className="h-4 w-4" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" /> Copy address
                      </>
                    )}
                  </button>
                  <p className="mt-3 text-center text-[11px] text-muted-foreground">
                    Only send assets on <span className="font-medium text-foreground">Base</span> to this address.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-secondary/40 p-4 text-center text-sm text-muted-foreground">
                  Setting up your wallet… check back in a moment.
                </div>
              )
            ) : (
              <>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">From</label>
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
              </>
            )}
          </div>
        )}

        {/* ---- RECIPIENT PICKER ---- */}
        {step === 'compose' && picking && (
          <div className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <button type="button" onClick={() => setPicking(false)} aria-label="Back" className="-ml-1 rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <span className="text-base font-semibold text-foreground">Request from</span>
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
              <div className="text-xs text-muted-foreground">You're requesting</div>
              <div className="mt-0.5 font-display text-4xl tracking-tight text-foreground tabular-nums">{fmt(amount)}</div>
            </div>

            <div className="mt-5 flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                {contactInitials(recipient.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] text-muted-foreground">From</span>
                <span className="block truncate text-sm font-medium text-foreground">{recipient.name}</span>
              </span>
              <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', instant ? 'bg-positive/10 text-positive' : 'bg-secondary text-muted-foreground')}>
                {instant ? <><Zap className="h-3 w-3" /> In-app</> : <><Mail className="h-3 w-3" /> Pay link</>}
              </span>
            </div>

            {note && (
              <div className="mt-2 flex justify-between gap-4 rounded-xl bg-secondary/40 p-3 text-sm">
                <span className="shrink-0 text-muted-foreground">Note</span>
                <span className="truncate text-foreground">{note}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                // Always attempt a real request when we have an email/phone — the server resolves the
                // recipient to a member and notifies them (even if we don't have their wallet locally).
                // If they're not a member, it no-ops and the copy-link flow below is the fallback.
                if (recipient?.email || recipient?.phone) {
                  void createPaymentRequest({ recipientEmail: recipient.email || undefined, recipientPhone: recipient.phone || undefined, amount, note: note || undefined });
                }
                setStep('status');
              }}
              className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
            >
              Request {fmt(amount)}
            </button>
            <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />
              {instant ? `${recipient.name.split(' ')[0]} gets a request in Clear` : `We'll ${channel} ${recipient.name.split(' ')[0]} a secure link to pay you`}
            </p>
          </div>
        )}

        {/* ---- STATUS ---- */}
        {step === 'status' && recipient && (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            {!done ? (
              <>
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                <div className="mt-4 text-base font-semibold text-foreground">Sending request…</div>
              </>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-positive/10">
                  <Check className="h-7 w-7 text-positive" strokeWidth={3} />
                </div>
                <div className="mt-4 text-base font-semibold text-foreground">Request sent</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  We asked {recipient.name} for <span className="font-medium text-foreground">{fmt(amount)}</span>. You'll be notified when they pay.
                </div>

                {!instant && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText('https://useclear.org/pay/demo-request').catch(() => {});
                      setCopied(true);
                    }}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
                  >
                    {copied ? <><Check className="h-4 w-4 text-positive" /> Link copied</> : <><Copy className="h-4 w-4" /> Copy payment link</>}
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
