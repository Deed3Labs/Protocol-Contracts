import { CMain, Rows } from '@/components/clear/brand/anatomy';
import { KvRow, Pane } from './SettingsKit';
import { money } from '@clear/domain';
import { patronageBasis, type Patronage } from '@/lib/clearModel';

/**
 * Patronage — the co-op's surplus coming back to members.
 *
 * The first line does the work, because the intuition is wrong: this is proportional to how much
 * you *used* the co-op, not how much you saved in it.
 */
export default function PatronagePanel({ patronage, onExplain }: { patronage: Patronage; onExplain?: () => void }) {
  return (
    <>
      <Pane label={patronage.fiscalYear} aside={<span className="c-det">{patronage.status}</span>}>
        <CMain>
          <p className="c-det">
            Surplus the co-op doesn&rsquo;t reinvest is returned to members in proportion to how much they used it,
            not how much they saved.
          </p>
        </CMain>
        <CMain>
          <Rows>
            <div>
              <KvRow
                label="Your patronage basis"
                value={<span className="text-ink">{money(patronageBasis(patronage.basisRows), { cents: true })} of activity</span>}
              />
            </div>
            <div>
              <KvRow
                label="Declared to date"
                value={<span className="text-ink">{patronage.declared === undefined ? '—' : money(patronage.declared)}</span>}
              />
            </div>
          </Rows>
        </CMain>
      </Pane>

      <Pane label="History" className="mt-s3" foot={<KvRow label="How patronage is calculated" onSelect={onExplain} />}>
        <CMain>
          {patronage.history.length === 0 ? (
            <p className="c-det">No distributions yet. The first would follow the {patronage.fiscalYear} close.</p>
          ) : (
            <Rows>
              {patronage.history.map((row) => (
                <div key={row.id}>
                  <KvRow label={row.year} value={<span className="c-fig c-fig-row c-pos">{money(row.amount)}</span>} />
                </div>
              ))}
            </Rows>
          )}
        </CMain>
      </Pane>
    </>
  );
}
