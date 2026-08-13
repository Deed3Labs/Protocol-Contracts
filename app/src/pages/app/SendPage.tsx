import { useState } from 'react';
import { ScanLine, HandCoins, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Card from '@/components/clear/Card';
import ClearCode from '@/components/clear/ClearCode';
import ContactRows from '@/components/clear/ContactRows';
import SendMoneyDialog from '@/components/clear/SendMoneyDialog';
import { SEND_IN_USE, HOME_IN_USE } from '@/data/clearPlaceholder';
import { searchContacts, type Contact, type SendData } from '@/lib/clearModel';

/**
 * Send — design spec §7.
 *
 * The two layouts are different pages, not one reflowed. On mobile the Clear code
 * leads, because showing a QR is how most payments start there. On desktop the
 * search leads and the code moves into a column beside it — nobody holds a
 * monitor up to a camera — so the actions get their own card with room for the
 * fuller "Request money" label.
 */
export default function SendPage({ data = SEND_IN_USE }: { data?: SendData }) {
  const [query, setQuery] = useState('');
  const [recipient, setRecipient] = useState<Contact | null>(null);
  const matches = searchContacts(data.recent, query);
  const searching = query.trim().length > 0;

  const searchField = (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.75}
        aria-hidden
      />
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name, phone or @handle"
        aria-label="Search people to pay"
        className="pl-9"
      />
    </div>
  );

  const contacts = (
    <ContactRows
      onSelect={setRecipient}
      contacts={matches}
      emptyMessage={
        searching
          ? `No one matching "${query.trim()}". Try a phone number or @handle.`
          : 'No one yet — search for a name, phone number or @handle to send.'
      }
    />
  );

  const recentLabel = (
    <p className="mb-2 text-xs text-foreground-secondary">{searching ? 'Results' : 'Recent'}</p>
  );

  return (
    <>
      {/* Mobile: the code leads, then actions, then search */}
      <div className="lg:hidden">
        <div className="flex flex-col gap-3">
          <ClearCode handle={data.handle} codeUrl={data.codeUrl} />
          <div className="flex gap-2">
            <Button variant="clear" size="xs" className="flex-1">
              <ScanLine className="h-3.5 w-3.5" strokeWidth={1.75} />
              Scan to pay
            </Button>
            <Button variant="clear" size="xs" className="flex-1">
              <HandCoins className="h-3.5 w-3.5" strokeWidth={1.75} />
              Request
            </Button>
          </div>
        </div>
        <div className="mt-6">
          <div className="mb-4">{searchField}</div>
          {recentLabel}
          {contacts}
        </div>
      </div>

      {/* Desktop: even split — sending on the left, getting paid on the right */}
      <div className="hidden gap-3 lg:grid lg:grid-cols-2 lg:items-start">
        <Card>
          <p className="mb-3 text-[13px] text-foreground-secondary">Send money</p>
          <div className="mb-3.5">{searchField}</div>
          {recentLabel}
          {contacts}
        </Card>

        <div className="flex flex-col gap-3">
          <ClearCode handle={data.handle} codeUrl={data.codeUrl} variant="titled" />
          <Card>
            <Button variant="clear" size="xs" className="mb-2.5 w-full">
              <ScanLine className="h-3.5 w-3.5" strokeWidth={1.75} />
              Scan to pay
            </Button>
            <Button variant="clear" size="xs" className="w-full">
              <HandCoins className="h-3.5 w-3.5" strokeWidth={1.75} />
              Request money
            </Button>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Sending to members and Clear Partners is free and instant.
            </p>
          </Card>
        </div>
      </div>

      {recipient && (
        <SendMoneyDialog
          contact={recipient}
          credit={HOME_IN_USE.credit}
          cash={HOME_IN_USE.cash}
          open={recipient !== null}
          onOpenChange={(o) => !o && setRecipient(null)}
        />
      )}
    </>
  );
}
