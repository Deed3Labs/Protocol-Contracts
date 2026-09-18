import { Btn, CBar, CFoot, CHead, CMain, Cell, Chip, Line, Rows, SecHead } from '@/components/clear/brand/anatomy';
import { KvRow } from './SettingsKit';
import { money } from '@clear/domain';
import type { SettingsData } from '@/lib/clearModel';

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
const inWords = (n: number) => WORDS[n] ?? String(n);

/** The two value columns share one width, so every row lines up under the names in the bar. */
const COL = 'w-[74px] text-right';

/**
 * Acceleration — a paid shortcut on things a member would reach anyway.
 *
 * A comparison with its columns named once, in a control bar, so every row lines up beneath them.
 * The accelerated column carries the figures and the standard one stays quiet: the page asks one
 * question.
 *
 * The second cell is the argument against buying it, and it stays. Clean cycles reach the same Boost
 * increase for nothing; a co-op that hid that would be selling rather than serving.
 *
 * `onTurnOn` is absent until acceleration can actually be bought. There is no billing behind it yet,
 * so the button says so rather than taking a tap and doing nothing.
 */
export default function AccelerationPanel({
  data,
  intro,
  onTurnOn,
}: {
  data: SettingsData;
  /** The phone's one-line lede under the header title. */
  intro?: boolean;
  onTurnOn?: () => void;
}) {
  const { accelerationBenefits: benefits, accelerationPlans: plans, accelerationCycles: cycles } = data;
  const monthly = plans.find((p) => p.per === 'month');
  const annual = plans.find((p) => p.per === 'year');
  const remaining = Math.max(cycles.needed - cycles.cleared, 0);
  const price = (p: { price: number; per: string }) => `${money(p.price)} a ${p.per}`;

  return (
    <>
      {intro && <p className="c-det mb-s3">A paid shortcut on things you would reach anyway.</p>}
      <div className="c-slab c-one">
        <Cell>
          <CHead>
            <SecHead label="Acceleration">
              {data.accelerationActive ? <Chip tone="settled" core>On</Chip> : <Chip tone="neutral">Off</Chip>}
            </SecHead>
          </CHead>
          <CBar>
            <Line className="items-center!">
              <span className="c-label">What changes</span>
              <span className="flex gap-s3">
                <span className={`c-det ${COL}`}>Standard</span>
                <span className={`c-det text-ink! ${COL}`}>Accelerated</span>
              </span>
            </Line>
          </CBar>
          <CMain>
            <Rows>
              {benefits.map((b) => (
                <div key={b.label}>
                  <Line>
                    <span className="min-w-0 text-sec">{b.label}</span>
                    <span className="flex shrink-0 items-baseline gap-s3">
                      <span className={`c-det ${COL}`}>{b.standard}</span>
                      <span className={`c-fig c-fig-row ${COL}`}>{b.accelerated}</span>
                    </span>
                  </Line>
                </div>
              ))}
            </Rows>
          </CMain>
          <CFoot>
            {monthly && annual && (
              <Line className="mb-s2">
                <span className="c-det">{price(monthly)}</span>
                <span className="c-det">
                  or <strong className="font-medium text-ink">{price(annual)}</strong>
                </span>
              </Line>
            )}
            <Btn primary lg disabled={!onTurnOn || data.accelerationActive} onClick={onTurnOn}>
              {data.accelerationActive ? 'Acceleration is on' : 'Turn on acceleration'}
            </Btn>
            <p className="c-det mt-s1 text-center">
              {onTurnOn || data.accelerationActive
                ? 'Cancel any time. Your vote is unaffected either way.'
                : 'Not open yet. Nothing is charged.'}
            </p>
          </CFoot>
        </Cell>

        <Cell>
          <CHead>
            <SecHead label="You get there anyway">
              <Chip tone="settled" core figs>
                {remaining === 1 ? '1 cycle' : `${remaining} cycles`}
              </Chip>
            </SecHead>
          </CHead>
          <CMain>
            <p className="c-keyline">
              {remaining > 0
                ? `${inWords(remaining)} clean ${remaining === 1 ? 'cycle reaches' : 'cycles reach'} the same Clear Boost™ increase. `
                : 'Your clean cycles have already reached the Clear Boost™ increase. '}
              <strong>Acceleration is a shortcut, not the only route.</strong>
            </p>
            <Rows className="mt-s3">
              <div>
                <KvRow label="Cycles cleared so far" value={`${cycles.cleared} of ${cycles.needed}`} />
              </div>
              <div>
                <KvRow
                  label="Free route"
                  value={remaining > 0 ? `${inWords(remaining)} more ${remaining === 1 ? 'cycle' : 'cycles'}` : 'Reached'}
                />
              </div>
              {monthly && (
                <div>
                  <KvRow label="Paid route" value={price(monthly)} />
                </div>
              )}
            </Rows>
          </CMain>
          <CFoot>
            <p className="c-det">
              What acceleration buys is time, not access. Nothing here is closed to a member who does not pay for it.
            </p>
          </CFoot>
        </Cell>
      </div>
    </>
  );
}
