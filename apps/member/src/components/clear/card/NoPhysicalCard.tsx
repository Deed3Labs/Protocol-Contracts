import { Btn, CFoot, CHead, CMain, Cell, Chip, SecHead } from '../brand/anatomy';

/**
 * No physical card is a state, not a step somebody has not taken yet.
 *
 * A member holding only virtual cards has never been posted anything, so an activation flow would
 * be a screen about a card nobody sent. This says what a physical card would add over what they
 * already hold, and offers to order one.
 *
 * Day one is the other half of it: no cards at all, where the first card is virtual and live the
 * moment it exists. Nothing is shipped and nothing is activated, so nothing here pretends to be.
 */
export default function NoPhysicalCard({
  /** True when the member holds nothing at all — no virtual cards either. */
  dayOne,
  busy,
  notice,
  onOrder,
}: {
  dayOne?: boolean;
  busy?: boolean;
  notice?: string | null;
  onOrder?: () => void;
}) {
  return (
    <div className="lg:mx-auto lg:max-w-[420px]">
      <div className="mb-s3">
        <p className="c-label">{dayOne ? 'Your card' : 'Physical card'}</p>
        <p className="c-fig text-hero-m mt-[6px] leading-[1.05] lg:text-hero">
          {dayOne ? 'None yet' : 'Not ordered'}
        </p>
        <p className="c-det mt-[4px]">
          {dayOne
            ? 'Your first card is virtual and works the moment it exists.'
            : 'Your virtual cards already spend from the same limit.'}
        </p>
      </div>
      <div className="c-slab c-one">
        <Cell>
          <CHead>
            <SecHead label={dayOne ? 'Your card' : 'Physical card'}>
              <Chip tone="neutral">{dayOne ? 'None' : 'Not ordered'}</Chip>
            </SecHead>
          </CHead>
          <CMain>
            <p className="text-sec">{dayOne ? 'A card to spend with' : 'No physical card'}</p>
            <p className="c-det mt-[3px]">
              {dayOne
                ? 'It spends from your limit in the same order everything else does: your own money first, then the cheapest credit you have.'
                : 'Your virtual cards already spend from the same limit. A physical one adds tap, chip and ATMs.'}
            </p>
            {!dayOne && (
              <p className="c-det mt-s2">
                Posted to the address on your account. It arrives frozen and you activate it here.
              </p>
            )}
          </CMain>
          <CFoot>
            <Btn primary lg disabled={busy} onClick={onOrder}>
              {busy ? 'One moment…' : dayOne ? 'Create my card' : 'Order a card'}
            </Btn>
            {notice && (
              <p role="status" className="c-det mt-s1">
                {notice}
              </p>
            )}
          </CFoot>
        </Cell>
      </div>
    </div>
  );
}
