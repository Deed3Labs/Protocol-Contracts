import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  CreditCard, Eye, EyeOff, Fingerprint, KeyRound, LifeBuoy, MessageCircle,
  Mail, Shield, ShieldCheck, Snowflake, Sparkles, Smartphone, Receipt, Home, TrendingUp, Bell,
  Megaphone, FileText, AlertTriangle, ChevronRight, type LucideIcon,
} from 'lucide-react';
import { useKyc } from '@/context/KycContext';
import DepositInstructions from '@/components/app-ui/DepositInstructions';
import { cn } from '@/lib/utils';

/*
 * Settings modals — Account, Cards (incl. Bridge virtual account + Colossus credit), Security,
 * Notifications, Support. Designed UI + mock data.
 *
 * SEAMS: card + virtual account (routing/account #) ← Bridge issuing/accounts; credit card ←
 * colossus.credit issuance; security toggles ← AppKit/auth + biometrics; notifications ← prefs API.
 */

const inputCls =
  'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none';

type ModalProps = { open: boolean; onOpenChange: (o: boolean) => void };

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', on ? 'bg-positive' : 'bg-muted')}
    >
      <span
        className="absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: on ? 'translateX(18px)' : 'translateX(2px)' }}
      />
    </button>
  );
}

function ToggleList({ rows }: { rows: { id: string; icon: LucideIcon; title: string; desc: string; default: boolean }[] }) {
  const [state, setState] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.id, r.default])));
  return (
    <div className="divide-y divide-border">
      {rows.map((r) => {
        const Icon = r.icon;
        return (
          <div key={r.id} className="flex items-center gap-3 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">{r.title}</div>
              <div className="text-xs text-muted-foreground">{r.desc}</div>
            </div>
            <Toggle on={state[r.id]} onToggle={() => setState((s) => ({ ...s, [r.id]: !s[r.id] }))} />
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------------- Account ----------------------------------- */
export function AccountModal({ open, onOpenChange }: ModalProps) {
  const { verified, openKyc } = useKyc();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-secondary text-base font-medium text-secondary-foreground">SS</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">Steven Spark</div>
            <div className="truncate text-xs text-muted-foreground">steven@useclear.org</div>
          </div>
          {verified ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-positive/10 px-2 py-0.5 text-[11px] font-medium text-positive">
              <ShieldCheck className="h-3 w-3" /> KYC verified
            </span>
          ) : (
            <button
              type="button"
              onClick={() => openKyc()}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info transition-colors hover:bg-info/15"
            >
              <ShieldCheck className="h-3 w-3" /> Verify
            </button>
          )}
        </div>

        <div className="mt-1 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Full name</span>
            <input defaultValue="Steven Spark" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Email</span>
            <input type="email" defaultValue="steven@useclear.org" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Phone</span>
            <input type="tel" placeholder="+1 555 000 0000" className={inputCls} />
          </label>
        </div>

        <div className="mt-1 grid grid-cols-3 gap-3 border-t border-border pt-4 text-center">
          <div>
            <div className="text-sm font-semibold text-foreground">Mar 2025</div>
            <div className="text-[11px] text-muted-foreground">Member since</div>
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">Clear+</div>
            <div className="text-[11px] text-muted-foreground">Plan</div>
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">Level 4</div>
            <div className="text-[11px] text-muted-foreground">Standing</div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
        >
          Save changes
        </button>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------ Cards ------------------------------------ */
export function CardsModal({ open, onOpenChange }: ModalProps) {
  const { verified, openKyc } = useKyc();
  const [revealed, setRevealed] = useState(false);
  const [frozen, setFrozen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Cards &amp; accounts</DialogTitle>
        </DialogHeader>

        {/* debit card */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-medium text-muted-foreground">Clear debit card</h4>
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {revealed ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className={cn('rounded-xl border border-border', frozen && 'opacity-60')}>
            <CardLine label="Card number" value={revealed ? '5231 7252 1769 8152' : '•••• •••• •••• 8152'} />
            <div className="grid grid-cols-2 divide-x divide-border border-t border-border">
              <CardLine label="Expires" value={revealed ? '08/29' : '••/••'} />
              <CardLine label="CVV" value={revealed ? '412' : '•••'} />
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Virtual & physical · issued via Bridge</span>
            <button
              type="button"
              onClick={() => setFrozen((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                frozen ? 'border-info/40 text-info hover:bg-info/10' : 'border-border text-foreground hover:bg-secondary',
              )}
            >
              <Snowflake className="h-3.5 w-3.5" /> {frozen ? 'Unfreeze' : 'Freeze'}
            </button>
          </div>
        </div>

        {/* virtual account (Bridge) */}
        <div className="mt-2">
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">Virtual account</h4>
          <DepositInstructions />
        </div>

        {/* credit card */}
        <div className="mt-2 flex items-start gap-3 rounded-xl border border-border p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
            <CreditCard className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">Clear Credit Card</span>
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Available</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">Build credit with every on-time payment — issued on Colossus.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!verified) openKyc();
            }}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            Apply
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CardLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 p-3">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/* ----------------------------------- Security ---------------------------------- */
export function SecurityModal({ open, onOpenChange }: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Security</DialogTitle>
        </DialogHeader>

        <ToggleList
          rows={[
            { id: 'biometric', icon: Fingerprint, title: 'Face ID / biometrics', desc: 'Unlock and approve with biometrics', default: true },
            { id: '2fa', icon: Shield, title: 'Two-factor authentication', desc: 'Extra step when signing in', default: true },
            { id: 'alerts', icon: Bell, title: 'Transfer alerts', desc: 'Notify me of money movement', default: true },
            { id: 'signing', icon: KeyRound, title: 'Signature lock', desc: 'Require a signature for large transfers', default: false },
          ]}
        />

        <div className="space-y-2 border-t border-border pt-3">
          <button type="button" className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-secondary/50">
            <KeyRound className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
            <span className="flex-1 text-sm font-medium text-foreground">Change passcode</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
          <button type="button" className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-secondary/50">
            <Smartphone className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">Devices &amp; sessions</span>
              <span className="block text-xs text-muted-foreground">This device · 2 others active</span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <button type="button" className="mt-1 w-full rounded-xl border border-destructive/30 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/5">
          Sign out other devices
        </button>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- Notifications -------------------------------- */
export function NotificationsModal({ open, onOpenChange }: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Notifications</DialogTitle>
        </DialogHeader>
        <ToggleList
          rows={[
            { id: 'money', icon: TrendingUp, title: 'Money movement', desc: 'Received, sent, and low balance', default: true },
            { id: 'rent', icon: Home, title: 'Rent & bills', desc: 'Due reminders and autopay', default: true },
            { id: 'credits', icon: Sparkles, title: 'Credits & milestones', desc: 'Equity credits and Clear Deed progress', default: true },
            { id: 'card', icon: Receipt, title: 'Card activity', desc: 'Purchases and declines', default: true },
            { id: 'security', icon: ShieldCheck, title: 'Security', desc: 'Logins and new devices', default: true },
            { id: 'news', icon: Megaphone, title: 'Product news', desc: 'New features and offers', default: false },
          ]}
        />
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------------- Support ----------------------------------- */
export function SupportModal({ open, onOpenChange }: ModalProps) {
  const items: { icon: LucideIcon; title: string; desc: string }[] = [
    { icon: MessageCircle, title: 'Chat with support', desc: 'Typical reply in a few minutes' },
    { icon: Mail, title: 'Email us', desc: 'support@useclear.org' },
    { icon: LifeBuoy, title: 'Help center', desc: 'Guides and FAQs' },
    { icon: FileText, title: 'Account review', desc: 'Report activity or request a review' },
    { icon: AlertTriangle, title: 'Privacy request', desc: 'Export or delete your data' },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Help &amp; support</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <button key={it.title} type="button" className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-secondary/50">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{it.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{it.desc}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
