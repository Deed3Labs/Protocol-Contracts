import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ClaimGuidePanel from '@/components/clear/ClaimGuidePanel';
import StartClaimDialog from '@/components/clear/StartClaimDialog';
import { BackIcon } from '@/components/clear/brand/icons';
import { CLAIM_RECORD, CLAIM_STEPS, SAVINGS_DAY_ONE } from '@/data/clearPlaceholder';
import type { SavingsData } from '@/lib/clearModel';

/**
 * How to make a claim — and, from its one button, the claim itself.
 *
 * The protections come from the member's own credits rather than a fixture, because this page
 * decides what they are allowed to claim on. Getting that from the wrong place would tell somebody
 * they are covered for something they are not, on the day they are trying to use it.
 *
 * Filing is handed in rather than reached for. The page draws; the route knows who is signed in and
 * where a claim goes. That also keeps this renderable in the preview harness, which has no wallet
 * provider — a page that reaches for a wallet cannot be reviewed as a design.
 */
export default function ClaimPage({
  data = SAVINGS_DAY_ONE,
  onFile,
}: {
  data?: SavingsData;
  /** Files the claim. Absent in the preview harness, where there is nobody to file for. */
  onFile?: (input: { protectionId: string; protectionName: string; detail: string }) => Promise<string | null>;
}) {
  const navigate = useNavigate();
  const [claiming, setClaiming] = useState(false);

  return (
    <div className="max-w-[560px]">
      <div className="c-paneback mb-s2! hidden lg:flex">
        <button type="button" aria-label="Back" onClick={() => navigate(-1)} className="c-mclose">
          <BackIcon />
        </button>
        <h1 className="c-panetitle text-body!">How to make a claim</h1>
      </div>
      <p className="c-det mb-s3">
        Claims are rare. This is what to do if you need one, and what happens after you send it.
      </p>
      <div className="c-slab c-one">
        <ClaimGuidePanel
          items={data.assurance}
          credits={data.savings.credits}
          steps={CLAIM_STEPS}
          record={CLAIM_RECORD}
          onStart={() => setClaiming(true)}
        />
      </div>

      <StartClaimDialog
        open={claiming}
        onOpenChange={setClaiming}
        items={data.assurance}
        credits={data.savings.credits}
        onFile={onFile ?? (async () => 'Sign in to file a claim — nothing was sent.')}
      />
    </div>
  );
}
