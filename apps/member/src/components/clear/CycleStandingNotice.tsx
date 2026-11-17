import { Chip, CMain } from '@/components/clear/brand/anatomy';
import { Pane } from '@/components/settings/SettingsKit';
import { boostCapLine, standingNotice, type CycleStanding } from '@/lib/cycleStanding';

/**
 * A missed cycle or a cure notice, said where the member will see it (Phase 2b, 12.5), with the
 * Boost cap they have (12.4). Nothing at all for a member in good standing with no Boost cap set.
 */
export default function CycleStandingNotice({ standing }: { standing: CycleStanding | null | undefined }) {
  const notice = standingNotice(standing);
  const boost = boostCapLine(standing);
  if (!notice && !boost) return null;
  return (
    <div className="w-full px-5 pt-s2 lg:mx-auto lg:max-w-[720px]">
      <Pane>
        <CMain>
          {notice && (
            <div className="mb-s1">
              <p className="text-sec">
                <Chip tone="underway">{notice.title}</Chip>
              </p>
              <p className="c-det mt-[3px]">{notice.body}</p>
            </div>
          )}
          {boost && <p className="c-det">{boost}</p>}
        </CMain>
      </Pane>
    </div>
  );
}
