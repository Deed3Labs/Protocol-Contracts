import { CFoot, CHead, CMain, Cell, Line, Rows, SecHead } from '@/components/clear/brand/anatomy';
import { KvRow } from './SettingsKit';
import { money } from '@clear/domain';
import { patronageBasis, type Patronage } from '@/lib/clearModel';

const STEPS = [
  { title: 'The co-op totals its surplus', detail: 'After costs and reserves, at the fiscal year close' },
  { title: 'Members vote on the split', detail: 'How much is distributed against how much is reinvested' },
  { title: 'The distributed portion is divided', detail: 'In proportion to each member’s patronage basis' },
  { title: 'Your share lands in cash', detail: 'Not credits, not shares — money you can spend or save' },
];

const DOES_NOT_COUNT = [
  { label: 'Saving more', value: 'Does not raise your basis' },
  { label: 'Paying carry', value: 'Does — it is what the co-op earned from you' },
  { label: 'Buying a bond', value: 'No. That pays you a yield instead' },
  { label: 'Your shares', value: 'Separate. One member, one vote, whatever your basis' },
];

/**
 * How patronage is calculated — where money comes back to members.
 *
 * Three cells: what counts and the basis it builds, how the split is worked out at year close, and
 * what does not count. The last one is the one that was missing, and it says the uncomfortable part
 * plainly: a member who borrows and spends builds more basis than one who only saves. A member who
 * worked that out for themselves after a distribution would trust the next explanation less.
 *
 * Two columns and a full-width row on desktop; one column on a phone.
 */
export default function PatronageCalculationPanel({
  patronage,
  desktop,
}: {
  patronage: Patronage;
  desktop: boolean;
}) {
  const basis = patronageBasis(patronage.basisRows);

  return (
    <>
      {!desktop && (
        <p className="c-det mb-s3">Surplus the co-op does not reinvest is returned in proportion to use.</p>
      )}
      <div className={desktop ? 'c-slab' : 'c-slab c-one'}>
        <Cell>
          <CHead>
            <SecHead label="What counts">
              <span className="c-det">{patronage.year}</span>
            </SecHead>
          </CHead>
          <CMain>
            <Rows>
              {patronage.basisRows.map((row) => (
                <div key={row.label}>
                  <KvRow label={row.label} value={money(row.amount, { cents: true })} />
                </div>
              ))}
            </Rows>
            <Line className="mt-s2 border-t border-ink-28 pt-s2">
              <span className="text-sec">Your patronage basis</span>
              <span className="c-fig c-fig-sec">{money(basis, { cents: true })}</span>
            </Line>
          </CMain>
          <CFoot>
            <p className="c-keyline">
              Patronage is your share of surplus based on <strong>how much you used the co-op</strong>, not how much
              you saved in it.
            </p>
          </CFoot>
        </Cell>

        <Cell>
          <CHead>
            <SecHead label="How it works">
              <span className="c-det">At year close</span>
            </SecHead>
          </CHead>
          <CMain>
            <Rows>
              {STEPS.map((step, i) => (
                <div key={step.title}>
                  <div className="flex gap-3">
                    <span className="c-ord shrink-0">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="text-sec">{step.title}</p>
                      <p className="c-det mt-[3px]">{step.detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </Rows>
          </CMain>
          <CFoot>
            <Rows>
              <div>
                <KvRow label="Declared to date" value={patronage.declared === undefined ? '—' : money(patronage.declared)} />
              </div>
              <div>
                <KvRow label="First possible" value={`After the ${patronage.year} close`} />
              </div>
            </Rows>
          </CFoot>
        </Cell>

        <Cell full>
          <CHead>
            <SecHead label="What does not count">
              <span className="c-det">Common errors</span>
            </SecHead>
          </CHead>
          <CMain>
            <Rows>
              {/*
                * Not KvRow: its value never wraps, and two of these are sentences that clip at phone
                * width (the reference clips them too). Here the label holds and the answer wraps.
                */}
              {DOES_NOT_COUNT.map((row) => (
                <div key={row.label}>
                  <Line>
                    <span className="shrink-0 text-sec">{row.label}</span>
                    <span className="c-det min-w-0 text-right">{row.value}</span>
                  </Line>
                </div>
              ))}
            </Rows>
          </CMain>
          <CFoot>
            <p className="c-det">
              The uncomfortable part, said plainly: a member who borrows and spends builds more basis than one who only
              saves. Patronage returns what the co-op earned from you — it is not a reward for thrift.
            </p>
          </CFoot>
        </Cell>
      </div>
    </>
  );
}
