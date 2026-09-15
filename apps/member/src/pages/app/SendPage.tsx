import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Btn, CFoot, CHead, CMain, Cell, Line, SecHead } from '@/components/clear/brand/anatomy';
import { ChevronIcon, PlusIcon, ScanIcon } from '@/components/clear/brand/icons';
import ClearCode from '@/components/clear/ClearCode';
import CodeFoot from '@/components/clear/CodeFoot';
import ContactRows from '@/components/clear/ContactRows';
import PartnerRows from '@/components/clear/PartnerRows';
import PendingClaimBanner from '@/components/clear/PendingClaimBanner';
import SendMoneyDialog from '@/components/clear/SendMoneyDialog';
import RequestMoneyDialog from '@/components/clear/RequestMoneyDialog';
import PartnerSheet from '@/components/clear/PartnerSheet';
import { useSetMobileAction } from '@/components/shell/MobileAction';
import { SEND_DAY_ONE } from '@/data/clearPlaceholder';
import { money } from '@clear/domain';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { searchContacts, type Contact, type Partner, type SendData } from '@/lib/clearModel';

/** A header or footer link: detail text with a chevron, never a Unicode arrow. */
function MoreLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="c-det inline-flex! items-center gap-1 hover:text-ink">
      {children}
      <ChevronIcon />
    </Link>
  );
}

/**
 * Send — the page with no balance at the top. What it leads with is your identity, not your money.
 *
 * Search sits above everything as page chrome, then the same three-block shape as Home: money
 * waiting to be claimed is the temporary slot, and the standing lists are the slab. Both columns
 * have two cells, so they go straight into the shared grid — nesting only when cell counts differ.
 *
 * The phone puts Your code first, because the phone is the thing you hold up at a counter, and the
 * nav's action button reads Scan.
 */
export default function SendPage({ data = SEND_DAY_ONE }: { data?: SendData }) {
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const [query, setQuery] = useState('');
  const [recipient, setRecipient] = useState<Contact | null>(null);
  const [request, setRequest] = useState<{ contact?: Contact } | null>(null);
  const [partner, setPartner] = useState<Partner | null>(null);

  useSetMobileAction({ label: 'Scan', icon: PlusIcon, onSelect: () => navigate('/scan') });

  const searching = query.trim().length > 0;
  const contacts = searching ? searchContacts(data.contacts, query) : data.contacts.slice(0, 4);
  const available = data.available ?? 0;
  const atPartners = data.atPartners ?? 0;
  const sentTo = data.contacts.length;

  const contactsCell = (
    <Cell>
      <CHead>
        <SecHead label="Contacts">
          <MoreLink to="/settings/contacts">Manage</MoreLink>
        </SecHead>
      </CHead>
      <CMain>
        <ContactRows
          contacts={contacts}
          onSelect={setRecipient}
          emptyMessage={
            searching
              ? `No one matching "${query.trim()}". Try a phone number or @handle.`
              : 'No one yet. Search for a name, phone number or @handle to send.'
          }
        />
      </CMain>
      <CFoot>
        <Line className="items-center!">
          <span className="c-det">
            {sentTo} {sentTo === 1 ? 'person' : 'people'} you have sent to
          </span>
          <MoreLink to="/settings/contacts">See all</MoreLink>
        </Line>
      </CFoot>
    </Cell>
  );

  const codeCell = (
    <Cell>
      <CHead>
        <SecHead label="Your code">
          <MoreLink to="/code">Full screen</MoreLink>
        </SecHead>
      </CHead>
      <CMain>
        <ClearCode handle={data.handle} codeUrl={data.codeUrl} width={desktop ? 150 : 170} />
        <p className="mt-s2 text-center text-sec">Your Clear code</p>
        <p className="c-det mt-[3px] text-center">{data.handle}</p>
        <p className="c-det mt-s2 leading-[1.6]!">
          Says who you are, not an amount. The shop enters the figure and{' '}
          <strong className="font-medium text-ink">you approve it here</strong>.
        </p>
      </CMain>
      <CFoot>
        <CodeFoot available={available} atPartners={atPartners} />
      </CFoot>
    </Cell>
  );

  const partnersCell = (
    <Cell>
      <CHead>
        <SecHead label="Partners near you">
          <span className="c-det">{data.partnerCount} nearby</span>
        </SecHead>
      </CHead>
      <CMain>
        <PartnerRows partners={data.partners.slice(0, 4)} onSelect={setPartner} emptyMessage="No partners near you yet." />
      </CMain>
      <CFoot>
        <Line className="items-center!">
          <span className="c-det">Credit means you can split there</span>
          <MoreLink to="/partners">See all</MoreLink>
        </Line>
      </CFoot>
    </Cell>
  );

  const payments = data.networkPayments ?? 0;
  const networkCell = (
    <Cell>
      <CHead>
        <SecHead label="Kept in the network">
          <p className="c-fig c-fig-sec">{money(data.keptInNetwork, { cents: true })}</p>
        </SecHead>
      </CHead>
      <CMain>
        <p className="c-det">Sent to members and partners this cycle. No fees, and it arrives instantly.</p>
      </CMain>
      <CFoot>
        <Line className="items-center!">
          <span className="c-det">
            {payments} {payments === 1 ? 'payment' : 'payments'} this cycle
          </span>
          <MoreLink to="/activity">See in Activity</MoreLink>
        </Line>
      </CFoot>
    </Cell>
  );

  return (
    <>
      <div className="mb-s3">
        <div className="c-searchrow">
          <input
            className="c-field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, phone, or @handle"
            aria-label="Search people to pay"
          />
          <Link to="/scan" className="c-btn c-iconsq" aria-label="Scan to pay">
            <ScanIcon />
          </Link>
          <Btn onClick={() => setRequest({})}>Request</Btn>
        </div>
      </div>

      <div className="c-home">
        {data.pendingClaim && <PendingClaimBanner claim={data.pendingClaim} />}

        {desktop ? (
          <div className="c-slab">
            {contactsCell}
            {codeCell}
            {partnersCell}
            {networkCell}
          </div>
        ) : (
          <div className="c-slab c-one">
            {codeCell}
            {contactsCell}
            {partnersCell}
            {networkCell}
          </div>
        )}
      </div>

      <RequestMoneyDialog
        key={request?.contact?.id ?? 'pick'}
        contact={request?.contact}
        contacts={data.contacts}
        open={request !== null}
        onOpenChange={(o) => !o && setRequest(null)}
      />

      {partner && (
        <PartnerSheet
          partner={partner}
          open={partner !== null}
          onOpenChange={(o) => !o && setPartner(null)}
          onPay={() => navigate('/scan')}
        />
      )}

      {recipient && (
        <SendMoneyDialog
          contact={recipient}
          available={available}
          open={recipient !== null}
          onOpenChange={(o) => !o && setRecipient(null)}
          onSwap={() => {
            setRequest({ contact: recipient });
            setRecipient(null);
          }}
        />
      )}
    </>
  );
}
