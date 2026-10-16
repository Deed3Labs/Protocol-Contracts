import { useSearchParams } from 'react-router-dom';
import { ClearSteps } from '@/clear/Steps';
import { LinkView, NoLink } from '@/link/LinkView';
import { MI_CASA_LINK, MI_CASA_SESSION, previewModalApi, previewStep } from '@/lib/preview';
import { ModalShell } from '@/modal/Shell';

/**
 * Every state side by side (`/_frames?preview=1`, dev only): the link page's, and with `&modal=1` the
 * modal's, on a computer and as the phone's sheet.
 */
export function Frames() {
  const [search] = useSearchParams();
  if (search.get('modal')) return <ModalFrames sheet={search.get('modal') === 'sheet'} />;
  const frames = [
    { label: 'The link page (§5)', node: <LinkView link={MI_CASA_LINK} step="start" /> },
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

const MODAL_STEPS = [
  ['enter', 'Pay with Clear (§2)'],
  ['check', 'Check your phone (approved over §2, §3)'],
  ['check-email', 'Check your email'],
  ['member', 'Hi Sofia (§2)'],
  ['done', 'You’re all set (§2)'],
  ['new', 'You’re new to Clear (§3)'],
  ['window', 'Approve in Clear (not drawn)'],
  ['start', 'The phone’s sheet (§4)'],
] as const;

function ModalFrames({ sheet }: { sheet: boolean }) {
  const api = previewModalApi();
  return (
    <div className={sheet ? 'pay-frames pay-frames-sheet' : 'pay-frames pay-frames-modal'}>
      {MODAL_STEPS.filter(([k]) => (sheet ? true : k !== 'start')).map(([k, label]) => (
        <figure key={k}>
          <ModalShell session={MI_CASA_SESSION} sheet={sheet} onClose={() => undefined}>
            <ClearSteps api={api} session={MI_CASA_SESSION} layout={sheet ? 'sheet' : 'modal'} initial={previewStep(k)} onBack={() => undefined} />
          </ModalShell>
          <figcaption>{label}</figcaption>
        </figure>
      ))}
    </div>
  );
}
