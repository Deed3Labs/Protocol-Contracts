import { useEffect, useState } from 'react';
import { ArrowLeft, Mail, MessageCircle, Phone, Plus, Search, ShieldCheck, Trash2, Wallet, Zap } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useContacts, contactInitials, type Contact } from '@/context/ContactsContext';
import { useGlobalModals } from '@/context/GlobalModalsContext';
import { cn } from '@/lib/utils';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Draft = { name: string; email: string; phone: string; wallet: string };
const empty: Draft = { name: '', email: '', phone: '', wallet: '' };

/**
 * Manage contacts: add manually (Name + Email required; Phone + Wallet optional), edit, or
 * remove. A contact with a wallet can be paid instantly and messaged; without one, sends go
 * out as a claim link. Feeds the Send recipient picker (and, later, new-message recipients).
 */
export default function ContactsModal({
  open,
  onOpenChange,
  startInAdd = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  startInAdd?: boolean;
}) {
  const { contacts, addContact, updateContact, removeContact, lookupWallet } = useContacts();
  const { openXmtpModal } = useGlobalModals();
  const [view, setView] = useState<'list' | 'form'>('list');
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [query, setQuery] = useState('');
  const [touched, setTouched] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);

  // When the user enters a known email/phone, auto-fill the wallet from the member directory
  // (only if they haven't typed one). Triggered on blur of the email/phone fields.
  const tryAutofill = async () => {
    if (draft.wallet.trim()) return;
    const email = draft.email.trim();
    const phone = draft.phone.trim();
    if (!email && !phone) return;
    const found = await lookupWallet({ email: email || undefined, phone: phone || undefined });
    if (found) {
      setDraft((d) => (d.wallet.trim() ? d : { ...d, wallet: found }));
      setAutoFilled(true);
    }
  };

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setTouched(false);
    setAutoFilled(false);
    if (startInAdd) {
      setView('form');
      setEditId(null);
      setDraft(empty);
    } else {
      setView('list');
    }
  }, [open, startInAdd]);

  const startAdd = () => {
    setEditId(null);
    setDraft(empty);
    setTouched(false);
    setAutoFilled(false);
    setView('form');
  };
  const startEdit = (c: Contact) => {
    setEditId(c.id);
    setDraft({ name: c.name, email: c.email, phone: c.phone ?? '', wallet: c.wallet ?? '' });
    setTouched(false);
    setAutoFilled(false);
    setView('form');
  };

  const nameOk = draft.name.trim().length > 0;
  const emailOk = EMAIL_RE.test(draft.email.trim());
  const canSave = nameOk && emailOk;

  const save = () => {
    setTouched(true);
    if (!canSave) return;
    const payload = {
      name: draft.name.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim() || undefined,
      wallet: draft.wallet.trim() || undefined,
    };
    if (editId) updateContact(editId, payload);
    else addContact(payload);
    setView('list');
  };

  const filtered = contacts.filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[440px]">
        {view === 'list' ? (
          <>
            <DialogHeader className="px-5 pb-0 pt-5">
              <DialogTitle>Contacts</DialogTitle>
            </DialogHeader>
            <div className="px-5 pb-5 pt-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search contacts"
                  className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
                />
              </div>

              <div className="mt-3 max-h-[42vh] space-y-1.5 overflow-y-auto">
                {filtered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => startEdit(c)}
                    className="group flex w-full items-center gap-3 rounded-xl border border-border p-2.5 text-left transition-colors hover:bg-secondary/50"
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
                    {c.wallet && (
                      <MessageCircle
                        aria-label={`Message ${c.name}`}
                        className="h-4 w-4 shrink-0 cursor-pointer text-muted-foreground transition-colors hover:text-info"
                        onClick={(e) => {
                          e.stopPropagation();
                          openXmtpModal(undefined, c.wallet);
                          onOpenChange(false);
                        }}
                      />
                    )}
                    <Trash2
                      className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-negative group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeContact(c.id);
                      }}
                    />
                  </button>
                ))}
                {filtered.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">{query ? 'No matches.' : 'No contacts yet.'}</div>
                )}
              </div>

              <button
                type="button"
                onClick={startAdd}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
              >
                <Plus className="h-4 w-4" /> Add contact
              </button>
            </div>
          </>
        ) : (
          <div className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setView('list')}
                aria-label="Back"
                className="-ml-1 rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <span className="text-base font-semibold text-foreground">{editId ? 'Edit contact' : 'New contact'}</span>
            </div>

            <div className="space-y-3">
              <Field label="Name" required invalid={touched && !nameOk}>
                <input
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Jordan Avery"
                  className={inputCls}
                />
              </Field>
              <Field label="Email" required invalid={touched && !emailOk} icon={Mail} hint={touched && draft.email && !emailOk ? 'Enter a valid email' : undefined}>
                <input
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                  onBlur={tryAutofill}
                  placeholder="jordan@email.com"
                  className={cn(inputCls, 'pl-9')}
                />
              </Field>
              <Field label="Phone" icon={Phone}>
                <input
                  type="tel"
                  value={draft.phone}
                  onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                  onBlur={tryAutofill}
                  placeholder="+1 555 000 0000"
                  className={cn(inputCls, 'pl-9')}
                />
              </Field>
              <Field
                label="Wallet address"
                icon={Wallet}
                hint={autoFilled ? '✓ Auto-filled from a Clear member' : 'For instant transfers & messaging'}
              >
                <input
                  value={draft.wallet}
                  onChange={(e) => {
                    setAutoFilled(false);
                    setDraft((d) => ({ ...d, wallet: e.target.value }));
                  }}
                  placeholder="0x… or name.eth"
                  className={cn(inputCls, 'pl-9 font-mono text-[13px]')}
                />
              </Field>
            </div>

            <div className="mt-5 flex items-center gap-2">
              {editId && (
                <button
                  type="button"
                  onClick={() => {
                    removeContact(editId);
                    setView('list');
                  }}
                  className="rounded-xl border border-border p-3 text-muted-foreground transition-colors hover:border-negative/40 hover:text-negative"
                  aria-label="Delete contact"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              )}
              <button
                type="button"
                onClick={save}
                disabled={!canSave}
                className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
              >
                {editId ? 'Save changes' : 'Add contact'}
              </button>
            </div>
            <p className="mt-3 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Name and email are required. Add a wallet to send instantly.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const inputCls =
  'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none';

function Field({
  label,
  required,
  invalid,
  icon: Icon,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  invalid?: boolean;
  icon?: typeof Mail;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-negative">*</span>}
      </span>
      <span className={cn('relative block', invalid && '[&_input]:border-negative')}>
        {Icon && <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />}
        {children}
      </span>
      {hint && <span className={cn('mt-1 block text-[11px]', invalid ? 'text-negative' : 'text-muted-foreground')}>{hint}</span>}
    </label>
  );
}
