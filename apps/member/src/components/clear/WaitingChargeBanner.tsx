import { useNavigate } from 'react-router-dom';
import { Btn, CMain, Line, Panel, Rows } from './brand/anatomy';
import { money } from '@clear/domain';
import type { MemberCharge } from '@/utils/apiClient';

/**
 * A shop's charge waiting on the member: the temporary slot, like money waiting to be claimed. The
 * latest one, and how many more; Review opens it to approve or decline. It leaves when it's answered,
 * so it's there after the alert is gone or the app was closed.
 */
export default function WaitingChargeBanner({ charge, more = 0 }: { charge: MemberCharge; more?: number }) {
  const navigate = useNavigate();
  const raised = new Date(charge.createdAt);
  const at = raised.toDateString() === new Date().toDateString()
    ? raised.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '')
    : raised.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <Panel>
      <CMain>
        <Rows>
          <div>
            <Line className="items-center!">
              <div className="min-w-0">
                <p className="text-sec">
                  {charge.merchantName} is charging {money(charge.amountCents / 100, { cents: true })}
                </p>
                <p className="c-det mt-[3px]">
                  Sent {at} · nothing is taken until you approve
                  {more > 0 && ` · ${more} more waiting`}
                </p>
              </div>
              <Btn primary onClick={() => navigate(`/c/${encodeURIComponent(charge.code)}`)}>
                Review
              </Btn>
            </Line>
          </div>
        </Rows>
      </CMain>
    </Panel>
  );
}
