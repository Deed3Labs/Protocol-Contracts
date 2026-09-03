import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ScanLine, HandCoins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Card from '@/components/clear/Card';
import ClearCode from '@/components/clear/ClearCode';
import ContactRows from '@/components/clear/ContactRows';
import PartnerRows from '@/components/clear/PartnerRows';
import PendingClaimBanner from '@/components/clear/PendingClaimBanner';
import SendMoneyDialog from '@/components/clear/SendMoneyDialog';
import RequestMoneyDialog from '@/components/clear/RequestMoneyDialog';
import { SEND_DAY_ONE, HOME_DAY_ONE } from '@/data/clearPlaceholder';
import { money } from '@clear/domain';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { searchContacts, type Contact, type SendData } from '@/lib/clearModel';

/**
 * Send — design spec §7.
 *
 * Not a payment form: a directory of who you can pay. The field at the top takes
 * anyone — a member, a phone number, someone who hasn't joined — and the two
 * lists under it are the answer most of the time, which is why they're on the
 * page rather than behind a search.
 *
 * The two layouts are different pages, not one reflowed. On mobile the Clear code
 * leads, because showing a QR is how most payments start there. On desktop the
 * field leads and the code moves into a column beside it — nobody holds a monitor
 * up to a camera.
 */
export default function SendPage({ data = SEND_DAY_ONE }: { data?: SendData }) {
  const [query, setQuery] = useState('');
  const [recipient, setRecipient] = useState<Contact | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const isDesktop = useIsDesktop();
  const searching = query.trim().length > 0;
  const matches = searchContacts(data.contacts, query);
  // Unsearched, these are shortlists — the full lists are on /contacts and
  // /partners. One fewer on a phone, where the rows are twice as tall.
  const shortlist = isDesktop ? 4 : 3;
  const contacts = searching ? matches : data.contacts.slice(0, shortlist);

  const searchField = (
    <Input
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Name, phone, or @handle"
      aria-label="Search people to pay"
      className="h-9 text-xs"
    />
  );

  const contactList = (
    <ContactRows
      onSelect={setRecipient}
      contacts={contacts}
      emptyMessage={
        searching
          ? `No one matching "${query.trim()}". Try a phone number or @handle.`
          : 'No one yet — search for a name, phone number or @handle to send.'
      }
    />
  );

  const claim = data.pendingClaim && (
    <div className="mb-4">
      <PendingClaimBanner claim={data.pendingClaim} />
    </div>
  );

  /** Section heading with a way through to the full list. */
  const heading = (label: string, to: string, action: string) => (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <span className="text-[13px] text-foreground-secondary">{label}</span>
      <Link to={to} className="text-xs text-tier-boost-fg hover:underline">
        {action}
      </Link>
    </div>
  );

  const partners = (
    <PartnerRows
      partners={data.partners.slice(0, shortlist)}
      emptyMessage="No partners near you yet."
    />
  );

  const network = (
    <Card>
      <p className="mb-1 text-xs text-foreground-secondary">Kept in the network</p>
      <p className="font-display text-[26px] font-medium leading-none">
        {money(data.keptInNetwork)}
      </p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        sent to members and partners this cycle. No fees, instant.
      </p>
    </Card>
  );

  return (
    <>
      {/* Mobile: the code leads, then the two ways to start, then the directory */}
      <div className="lg:hidden">
        <ClearCode handle={data.handle} codeUrl={data.codeUrl} />

        <div className="mb-4 mt-3 flex gap-2">
          <Button variant="clear" size="xs" className="flex-1" asChild>
            <Link to="/scan">
              <ScanLine className="h-3.5 w-3.5" strokeWidth={1.75} />
              Scan to pay
            </Link>
          </Button>
          <Button
            variant="clear"
            size="xs"
            className="flex-1"
            onClick={() => setRequestOpen(true)}
          >
            <HandCoins className="h-3.5 w-3.5" strokeWidth={1.75} />
            Request
          </Button>
        </div>

        <div className="mb-4">{searchField}</div>
        {claim}

        {heading('Contacts', '/contacts', 'Manage')}
        {contactList}

        <div className="mt-5">
          {heading('Clear Partners', '/partners', `See all ${data.partnerCount}`)}
          {partners}
        </div>

        <div className="mt-5">{network}</div>
      </div>

      {/* Desktop: the directory on the left, getting paid on the right */}
      <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-6">
        <div>
          <div className="mb-4 flex items-center gap-2">
            <div className="min-w-0 flex-1">{searchField}</div>
            <Button variant="clear" size="xs" onClick={() => setRequestOpen(true)}>
              <HandCoins className="h-3.5 w-3.5" strokeWidth={1.75} />
              Request
            </Button>
          </div>

          {claim}

          {heading('Contacts', '/contacts', 'Manage')}
          {contactList}

          <div className="mt-5">
            {heading('Clear Partners near you', '/partners', `See all ${data.partnerCount}`)}
            {partners}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <ClearCode handle={data.handle} codeUrl={data.codeUrl} variant="titled" />
          <Button variant="clear" size="sm" className="w-full text-xs" asChild>
            <Link to="/scan">
              <ScanLine className="h-3.5 w-3.5" strokeWidth={1.75} />
              Scan to pay
            </Link>
          </Button>
          {network}
        </div>
      </div>

      <RequestMoneyDialog
        contacts={data.contacts}
        open={requestOpen}
        onOpenChange={setRequestOpen}
      />

      {recipient && (
        <SendMoneyDialog
          contact={recipient}
          credit={HOME_DAY_ONE.credit}
          cash={HOME_DAY_ONE.cash}
          open={recipient !== null}
          onOpenChange={(o) => !o && setRecipient(null)}
        />
      )}
    </>
  );
}
