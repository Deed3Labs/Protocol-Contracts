import type { HardwareOrder, HardwareOrderLine } from '@clear/merchant-contracts';
import type { ChipTone } from '@/brand/controls';

/* What On order says (onOrder.tsx draws it): kept free of components so it can be tested on its own. */

/** "$1,040.00" */
export const usd = (cents: number) => {
  const [whole, part] = (cents / 100).toFixed(2).split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${part}`;
};

/** "4 × Clear Point, Table" */
export const lineName = (l: HardwareOrderLine) => `${l.qty > 1 ? `${l.qty} × ` : ''}${l.name}`;

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function statusChip(l: HardwareOrderLine): { tone: ChipTone; dot?: boolean; text: string } {
  switch (l.status) {
    case 'reserved':
      return { tone: 'neutral', text: 'Reserved' };
    case 'building':
      return { tone: 'underway', dot: true, text: 'Building' };
    case 'awaiting-payment':
      return { tone: 'underway', text: 'Invoice sent' };
    case 'shipped':
      return { tone: 'settled', dot: true, text: 'Shipped' };
    case 'refunded':
      return { tone: 'neutral', text: 'Cancelled' };
  }
}

export const lineDet = (l: HardwareOrderLine) =>
  l.status === 'refunded'
    ? `Deposit ${usd(l.depositCents)} refunded`
    : l.status === 'shipped'
      ? `Paid in full · ${usd(l.depositCents + l.balanceCents)}`
      : l.status === 'building' && l.startsOn && l.cancellable
        ? `Deposit ${usd(l.depositCents)} paid · ${usd(l.balanceCents)} when it ships · building starts ${day(l.startsOn)}`
        : `Deposit ${usd(l.depositCents)} paid · ${usd(l.balanceCents)} when it ships · ${l.ships}, estimated`;

/** Still to come: everything not shipped or cancelled. */
export const openLines = (orders: HardwareOrder[]) => orders.flatMap((o) => o.lines.filter((l) => l.status !== 'shipped' && l.status !== 'refunded'));
