import { useRef, useState } from 'react';
import type { CatalogItem, ImportResult } from '@clear/merchant-contracts';
import { IconUpload } from '@/brand/chargeIcons';
import { Sheet } from '@/brand/ui';
import { FIELD_LABEL, guessFields, itemKey, parseCsv, rowsFor, type Field, type ImportRowInput } from '@/inventory/importCsv';

const FIELDS = Object.keys(FIELD_LABEL) as Field[];

/**
 * Inventory › Import a spreadsheet, on a live shop: pick a CSV, check how its columns map (each one
 * can be changed), then import. Rows that match an item the shop has add to its stock, as the
 * reference says; the server decides that too, so what the sheet counts is only a preview of it.
 */
export function ImportLiveSheet({
  existing,
  onImport,
  onDone,
  onClose,
}: {
  existing: CatalogItem[];
  onImport: (rows: ImportRowInput[]) => Promise<ImportResult>;
  /** After a successful import: re-read the catalogue. */
  onDone: () => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<{ name: string; header: string[]; data: string[][] } | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const read = async (f: File) => {
    setError(null);
    setResult(null);
    const rows = parseCsv(await f.text());
    if (rows.length < 2) {
      setFile(null);
      setError('That file has no rows under its header. Save the spreadsheet as CSV and try again.');
      return;
    }
    const [header, ...data] = rows;
    setFile({ name: f.name, header: header!, data });
    setFields(guessFields(header!));
  };

  const rows = file ? rowsFor(file.data, fields) : [];
  const have = new Set(existing.filter((i) => !i.archivedAt).map((i) => itemKey(i.name, i.detail)));
  const matches = rows.filter((r) => have.has(itemKey(r.name, r.detail))).length;
  const named = fields.includes('name');

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await onImport(rows);
      setResult(r);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t import. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const foot = result ? (
    <button type="button" className="c-btn c-btn-primary c-btn-lg" onClick={onClose}>
      Done
    </button>
  ) : (
    <>
      {error && (
        <p className="c-det" role="alert" style={{ color: 'var(--absent)', margin: '0 0 var(--s1)' }}>
          {error}
        </p>
      )}
      <button type="button" className="c-btn c-btn-primary c-btn-lg" disabled={!file || !named || !rows.length || busy} onClick={() => void go()}>
        {busy ? 'Importing…' : `Import ${rows.length} ${rows.length === 1 ? 'item' : 'items'}`}
      </button>
    </>
  );

  return (
    <Sheet title="Import a spreadsheet" closeSize="lg" onClose={onClose} foot={foot}>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        hidden
        aria-label="Spreadsheet file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void read(f);
          e.target.value = '';
        }}
      />
      <button type="button" className="c-iv-drop" style={{ width: '100%', cursor: 'pointer', background: 'transparent', font: 'inherit' }} onClick={() => input.current?.click()}>
        <IconUpload />
        <p style={{ margin: '6px 0 0', fontSize: 'var(--t-sec)' }}>{file ? file.name : 'Choose a CSV file'}</p>
        <p className="c-det">
          {file ? `${file.data.length} rows · ${file.header.length} columns · choose another` : 'From your supplier or your old system. A spreadsheet saved as CSV.'}
        </p>
      </button>

      {result ? (
        <div style={{ marginTop: 'var(--s2)' }} role="status">
          <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>
            {result.created} new {result.created === 1 ? 'item' : 'items'}
            {result.addedTo ? `, and stock added to ${result.addedTo} you had` : ''}.
          </p>
          {result.skipped.length > 0 && (
            <>
              <p className="c-label" style={{ margin: 'var(--s2) 0 6px' }}>
                Left out
              </p>
              <div className="c-rows">
                {result.skipped.map((s) => (
                  <div key={s.row}>
                    <div className="c-kv">
                      <span>Row {s.row}</span>
                      <span className="c-v">{s.reason}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        file && (
          <>
            <p className="c-label" style={{ margin: 'var(--s2) 0 6px' }}>
              How the columns map
            </p>
            <div className="c-rows">
              {file.header.map((h, i) => (
                <div key={i}>
                  <div className="c-kv">
                    <span>{h || `Column ${i + 1}`}</span>
                    <select
                      className="c-v"
                      aria-label={`${h || `Column ${i + 1}`} is`}
                      value={fields[i]}
                      style={{ font: 'inherit', background: 'transparent', border: 0, textAlign: 'right', cursor: 'pointer' }}
                      onChange={(e) => {
                        const f = e.target.value as Field;
                        // A field is one column: choosing it here takes it off any other.
                        setFields(fields.map((x, k) => (k === i ? f : x === f && f !== 'skip' ? 'skip' : x)));
                      }}
                    >
                      {FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {FIELD_LABEL[f]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
            {!named && <p className="c-det" style={{ marginTop: 'var(--s2)' }}>Choose which column is the name.</p>}
            {matches > 0 && (
              <div className="c-iv-flag">
                <span className="c-dot" />
                <p className="c-det">
                  {matches} {matches === 1 ? 'row matches an item' : 'rows match items'} you have. Their stock is added to, not replaced.
                </p>
              </div>
            )}
          </>
        )
      )}
    </Sheet>
  );
}
