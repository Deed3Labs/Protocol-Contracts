import { dollars, money } from './format';

/** One line of a bill or a receipt: "4 Al pastor   18.00". */
export function Row({ label, cents, mute, minus }: { label: string; cents: number; mute?: boolean; minus?: boolean }) {
  return (
    <div className={`tm-prow${mute ? ' mute' : ''}`}>
      <span>{label}</span>
      <span>{minus ? `−${money(cents)}` : money(cents)}</span>
    </div>
  );
}

/** The lines, then a discount, tax and tip when there are any. The reference draws tax; the others follow it. */
export function Lines({ lines, discountCents, taxCents, tipCents }: { lines: { name: string; quantity: number; lineCents: number }[]; discountCents: number; taxCents: number; tipCents: number }) {
  return (
    <>
      {lines.map((l, i) => (
        <Row key={i} label={`${l.quantity} ${l.name}`} cents={l.lineCents} />
      ))}
      {discountCents > 0 && <Row label="Discount" cents={discountCents} mute minus />}
      <Row label="Tax" cents={taxCents} mute />
      {tipCents > 0 && <Row label="Tip" cents={tipCents} mute />}
    </>
  );
}

export function Total({ cents }: { cents: number }) {
  return (
    <div className="tm-ptotal">
      <span>Total</span>
      <b>{dollars(cents)}</b>
    </div>
  );
}
