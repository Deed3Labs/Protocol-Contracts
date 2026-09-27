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
            {/* A tighter gap than a Line's: the detail stays one line beside Review on a phone
                (430px, an iPhone Pro Max, with room to spare). How many more is its own line. */}
            <Line className="items-center! gap-s1!">
              <div className="min-w-0">
                <p className="text-sec">
                  {charge.merchantName} is charging {money(charge.amountCents / 100, { cents: true })}
                </p>
                <p className="c-det mt-[3px]">Sent {at} · nothing taken until you approve</p>
                {more > 0 && <p className="c-det">{more} more waiting in Shop charges</p>}
              </div>
              {/* Remind's size beside it (a plain button's 36px and padding), in black: the one to answer. */}
              <Btn primary className="h-[36px]! px-s2!" onClick={() => navigate(`/c/${encodeURIComponent(charge.code)}`)}>
                Review
              </Btn>
            </Line>
          </div>
        </Rows>
      </CMain>
    </Panel>
  );
}
