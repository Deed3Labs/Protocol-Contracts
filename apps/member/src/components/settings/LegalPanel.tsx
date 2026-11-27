import { CMain, Rows } from '@/components/clear/brand/anatomy';
import { Btn } from '@/components/clear/brand/anatomy';
import { Pane, RowChevron, TwoLineRow } from './SettingsKit';
import type { LegalDoc } from '@/lib/clearModel';

/**
 * Every document the member is bound by, in one place.
 *
 * Versions are shown because they change: an agreement someone accepted at v2.1 isn't the same
 * agreement as today's, and a co-op that amends its own bylaws by member vote has to be able to say
 * which version you agreed to. Download all is the point of the page for anyone who wants a copy.
 */
export default function LegalPanel({ docs, onOpen }: { docs: LegalDoc[]; onOpen?: (doc: LegalDoc) => void }) {
  return (
    <Pane
      label="Documents"
      aside={<span className="c-det">{docs.length}</span>}
      foot={<Btn lg>Download all as PDF</Btn>}
    >
      <CMain>
        <Rows>
          {docs.map((doc) => (
            <div key={doc.id}>
              <TwoLineRow
                title={doc.label}
                detail={doc.detail}
                onSelect={() => onOpen?.(doc)}
                trailing={
                  <span className="c-v flex shrink-0 items-center gap-s1 text-detail text-ink-50">
                    {doc.version}
                    <RowChevron />
                  </span>
                }
              />
            </div>
          ))}
        </Rows>
      </CMain>
    </Pane>
  );
}
