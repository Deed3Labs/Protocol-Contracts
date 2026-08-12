import { useState } from 'react';
import { ScanLine, HandCoins, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ClearCode from '@/components/clear/ClearCode';
import ContactRows from '@/components/clear/ContactRows';
import { SEND_IN_USE } from '@/data/clearPlaceholder';
import { searchContacts, type SendData } from '@/lib/clearModel';

/**
 * Send — design spec §7.
 *
 * The Clear code leads on mobile, where showing a QR is how most payments start.
 * Desktop moves it into a column beside the search, since nobody holds a monitor
 * up to a camera.
 */
export default function SendPage({ data = SEND_IN_USE }: { data?: SendData }) {
  const [query, setQuery] = useState('');
  const matches = searchContacts(data.recent, query);
  const searching = query.trim().length > 0;

  const actions = (
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
  );

  return (
    <div className="lg:grid lg:grid-cols-[280px_1fr] lg:items-start lg:gap-6">
      <div className="flex flex-col gap-3">
        <ClearCode handle={data.handle} codeUrl={data.codeUrl} />
        {actions}
      </div>

      <div className="mt-6 lg:mt-0">
        <div className="relative mb-4">
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

        <p className="mb-0.5 text-xs text-foreground-secondary">{searching ? 'Results' : 'Recent'}</p>
        <ContactRows
          contacts={matches}
          emptyMessage={
            searching
              ? `No one matching "${query.trim()}". Try a phone number or @handle.`
              : 'No one yet — search for a name, phone number or @handle to send.'
          }
        />
      </div>
    </div>
  );
}
