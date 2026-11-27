import { useEffect, useState } from 'react';
import Modal from '../Modal';
import { Btn } from '../brand/anatomy';
import ChipGroup from './ChipGroup';

type Format = 'csv' | 'pdf';
type Range = 'cycle' | 'year' | 'all';

/**
 * Export — says what a row contains, because an export whose columns are a surprise is one you
 * have to do twice. It goes to the member's email, and the consequences say where.
 */
export default function ExportDialog({
  cycleRows,
  allRows,
  email,
  open,
  onOpenChange,
  onExport,
}: {
  cycleRows: number;
  /** Rows on the account in all. This year is not counted separately yet, so it uses this too. */
  allRows: number;
  email?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport?: (choice: { format: Format; range: Range }) => void;
}) {
  const [format, setFormat] = useState<Format>('csv');
  const [range, setRange] = useState<Range>('year');
  useEffect(() => {
    if (!open) return;
    setFormat('csv');
    setRange('year');
  }, [open]);

  const count = range === 'cycle' ? cycleRows : allRows;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Export"
      description="Export your activity as CSV or PDF."
      footer={
        <>
          <div className="c-conseq">
            <div className="c-earn">
              <span>Rows</span>
              <span>{count}</span>
            </div>
            <div>
              <span>Includes</span>
              <span>Merchant, date, tier, rate, carry</span>
            </div>
            <div>
              <span>Sent to</span>
              <span>{email || 'Your email'}</span>
            </div>
            <div className="c-limit">
              <span>Pending rows are marked, not dropped</span>
              <span>Always</span>
            </div>
          </div>
          <Btn primary lg className="mt-s2" disabled={count === 0} onClick={() => onExport?.({ format, range })}>
            Export {count} {count === 1 ? 'row' : 'rows'}
          </Btn>
          <p className="c-det mt-s1 text-center">Arrives in a minute or two. Nothing leaves Clear until you open it.</p>
        </>
      }
    >
      <ChipGroup
        first
        label="Format"
        options={[
          { id: 'csv', label: 'CSV' },
          { id: 'pdf', label: 'PDF' },
        ]}
        value={format}
        onChange={setFormat}
      />
      <ChipGroup
        label="Range"
        options={[
          { id: 'cycle', label: 'This cycle' },
          { id: 'year', label: 'This year' },
          { id: 'all', label: 'All time' },
        ]}
        value={range}
        onChange={setRange}
      />
    </Modal>
  );
}
