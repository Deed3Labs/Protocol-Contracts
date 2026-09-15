import { useEffect, useState } from 'react';
import Modal from '../Modal';
import { Btn } from '../brand/anatomy';
import ChipGroup from './ChipGroup';
import { money } from '@clear/domain';
import {
  DIRECTIONS,
  PAID_FROM,
  WHEN,
  filterRows,
  type ActivityFilters,
} from '@/lib/activityView';
import type { ActivityRow } from '@/lib/clearModel';

/**
 * Filters — counts as you choose, so you know what you are about to see before you commit to it.
 * The choices are a draft until Show; nothing is saved, and the consequences say so.
 */
export default function FiltersDialog({
  rows,
  query,
  filters,
  open,
  onOpenChange,
  onApply,
}: {
  rows: ActivityRow[];
  query: string;
  filters: ActivityFilters;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (filters: ActivityFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  const matching = filterRows(rows, draft, query);
  const out = matching.reduce((sum, r) => sum + (r.amount < 0 ? -r.amount : 0), 0);
  const pending = matching.some((r) => r.pending);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Filters"
      description="Narrow the activity list by direction, source and date."
      footer={
        <>
          <div className="c-conseq">
            <div className="c-earn">
              <span>Matching now</span>
              <span>
                {matching.length} of {rows.length}
              </span>
            </div>
            <div>
              <span>Total shown</span>
              <span>{money(out, { cents: true })}</span>
            </div>
            <div>
              <span>Pending included</span>
              <span>{pending ? 'Yes' : 'None'}</span>
            </div>
            <div className="c-limit">
              <span>Filters are not saved</span>
              <span>They reset when you leave</span>
            </div>
          </div>
          <Btn primary lg className="mt-s2" onClick={() => onApply(draft)}>
            Show {matching.length} {matching.length === 1 ? 'result' : 'results'}
          </Btn>
        </>
      }
    >
      <ChipGroup first label="Direction" options={DIRECTIONS} value={draft.direction} onChange={(direction) => setDraft((d) => ({ ...d, direction }))} />
      <ChipGroup label="Paid from" options={PAID_FROM} value={draft.paidFrom} onChange={(paidFrom) => setDraft((d) => ({ ...d, paidFrom }))} />
      <ChipGroup label="When" options={WHEN} value={draft.when} onChange={(when) => setDraft((d) => ({ ...d, when }))} />
    </Modal>
  );
}
