/**
 * Inventory › Import a spreadsheet, on the tablet: read the CSV, guess which column is which, and
 * turn its rows into what the API imports. Nothing is saved until the owner has seen the mapping.
 */

export type Field = 'name' | 'detail' | 'category' | 'price' | 'cost' | 'quantity' | 'reorderAt' | 'skip';

export const FIELD_LABEL: Record<Field, string> = {
  name: 'Name',
  detail: 'Size or detail',
  category: 'Category',
  price: 'Price',
  cost: 'You pay',
  quantity: 'On the shelf',
  reorderAt: 'Reorder at',
  skip: 'Leave out',
};

/** RFC 4180-ish: quoted fields, doubled quotes, commas and line breaks inside quotes, CRLF, a BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // Blank lines (a trailing newline, a spacer row) aren't rows.
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const GUESS: [Field, RegExp][] = [
  ['cost', /cost|wholesale|you pay|buy|unit cost/i],
  ['reorderAt', /reorder|min(imum)?\b|par/i],
  ['quantity', /qty|quantity|on hand|in stock|stock|count|shelf/i],
  ['price', /retail|price|sell|msrp/i],
  ['category', /categ|type|dept|department|group/i],
  ['detail', /size|detail|variant|spec|description/i],
  ['name', /item|name|product|title/i],
];

/** Each column's field, guessed from its header; a field is used once, the first column wins. */
export function guessFields(header: string[]): Field[] {
  const used = new Set<Field>();
  return header.map((h) => {
    const hit = GUESS.find(([f, re]) => !used.has(f) && re.test(h.trim()));
    if (!hit) return 'skip';
    used.add(hit[0]);
    return hit[0];
  });
}

/** "$1,234.50" → 123450; null when it isn't money. */
export function cents(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v.replace(/[$,\s]/g, '');
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** "12" → 12; null when it isn't a whole number. */
export function whole(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v.replace(/[,\s]/g, '');
  return /^\d+$/.test(t) ? Number(t) : null;
}

export interface ImportRowInput {
  name: string;
  detail: string | null;
  category: string | null;
  priceCents: number | null;
  costCents: number | null;
  quantity: number | null;
  reorderAt: number | null;
}

/** The data rows, as the API takes them. Rows without a name are left out here. */
export function rowsFor(data: string[][], fields: Field[]): ImportRowInput[] {
  const col = (f: Field) => fields.indexOf(f);
  const at = (r: string[], f: Field) => (col(f) >= 0 ? r[col(f)]?.trim() : undefined);
  return data
    .map((r) => ({
      name: at(r, 'name') ?? '',
      detail: at(r, 'detail') || null,
      category: at(r, 'category') || null,
      priceCents: cents(at(r, 'price')),
      costCents: cents(at(r, 'cost')),
      quantity: whole(at(r, 'quantity')),
      reorderAt: whole(at(r, 'reorderAt')),
    }))
    .filter((r) => r.name !== '');
}

/** How an existing item and a row are the same thing: name and detail, ignoring case and spacing. */
export const itemKey = (name: string, detail: string | null | undefined) => `${name.trim().toLowerCase().replace(/\s+/g, ' ')}|${(detail ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
