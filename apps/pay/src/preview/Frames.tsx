import { LinkView, NoLink } from '@/link/LinkView';
import { MI_CASA_LINK } from '@/lib/preview';

/** Every state the link page draws, side by side (`/_frames?preview=1`, dev only). */
export function Frames() {
  const frames = [
    { label: 'The link page (§5)', node: <LinkView link={MI_CASA_LINK} step="start" /> },
    { label: 'Waiting for Clear', node: <LinkView link={MI_CASA_LINK} step="waiting" waitingOn="clear" clearUrl="#" /> },
    { label: 'Back from card', node: <LinkView link={MI_CASA_LINK} step="waiting" waitingOn="card" /> },
    { label: 'Paid', node: <LinkView link={MI_CASA_LINK} step="paid" /> },
    { label: 'Expired', node: <LinkView link={{ ...MI_CASA_LINK, state: 'expired' }} step="expired" /> },
    { label: 'Turned off', node: <LinkView link={{ ...MI_CASA_LINK, state: 'inactive' }} step="inactive" /> },
    { label: 'No such link', node: <NoLink /> },
    { label: 'A shop without card', node: <LinkView link={{ ...MI_CASA_LINK, methods: { clear: true, card: false }, shop: { ...MI_CASA_LINK.shop, accent: null } }} step="start" /> },
  ];
  return (
    <div className="pay-frames">
      {frames.map((f) => (
        <figure key={f.label}>
          {f.node}
          <figcaption>{f.label}</figcaption>
        </figure>
      ))}
    </div>
  );
}
