import { Btn, CMain, Line, Panel, Rows } from './brand/anatomy';
import { money } from '@clear/domain';
import type { PendingClaim } from '@/lib/clearModel';

/**
 * Money waiting to be claimed — a temporary slot, like Activate your card on Home. It appears when
 * money has been sent to someone who isn't a member yet and leaves when they claim it.
 */
export default function PendingClaimBanner({
  claim,
  onRemind,
  showSent,
}: {
  claim: PendingClaim;
  onRemind?: () => void;
  /** Activity dates the send; Send says why it is waiting. */
  showSent?: boolean;
}) {
  return (
    <Panel>
      <CMain>
        <Rows>
          <div>
            <Line className="items-center!">
              <div>
                <p className="text-sec">
                  {money(claim.amount, { cents: true })} waiting for {claim.recipient} to claim
                </p>
                <p className="c-det mt-[3px]">
                  {showSent
                    ? claim.sentOn
                      ? `Sent ${claim.sentOn} · expires in ${claim.expiresInDays} days`
                      : `Expires in ${claim.expiresInDays} days`
                    : `Not a member yet · expires in ${claim.expiresInDays} days`}
                </p>
              </div>
              <Btn onClick={onRemind}>Remind</Btn>
            </Line>
          </div>
        </Rows>
      </CMain>
    </Panel>
  );
}
