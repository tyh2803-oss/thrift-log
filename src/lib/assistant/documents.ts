import Papa from 'papaparse';
import { readCsv } from '../csv';
import { IMAGE_LIMIT } from './schema';
export type DocumentType = 'pdf' | 'csv';
export const CSV_ROWS_PER_PART = 30;
export const MAX_CSV_ROWS = 300;
export const DOCUMENT_PART_BYTES = 100_000;
export function documentType(file: Pick<File, 'name' | 'type'>): DocumentType | null {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (file.type === 'text/csv' || /\.csv$/i.test(file.name)) return 'csv';
  return null;
}
export type DocumentPart = { kind: DocumentType; bytes: Uint8Array; rows?: number };
/** Bounded data only: never execute PDF content or spreadsheet formulas. */
export function prepareDocument(bytes: Uint8Array, kind: DocumentType): DocumentPart[] {
  if (!bytes.length || bytes.length > IMAGE_LIMIT)
    throw new Error('Each PDF or CSV must be smaller than 5 MB.');
  if (kind === 'pdf') {
    const header = new TextDecoder().decode(bytes.slice(0, 8));
    const end = new TextDecoder().decode(bytes.slice(-2048));
    if (!/^%PDF-\d\.\d/.test(header) || !/%%EOF\s*$/.test(end))
      throw new Error('This PDF is incomplete or invalid. Export a readable PDF and try again.');
    if (/\/Encrypt\b/.test(new TextDecoder().decode(bytes)))
      throw new Error('Password-protected PDFs are unsupported. Export an unlocked copy.');
    return [{ kind, bytes }];
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Save the CSV as UTF-8 and attach it again.');
  }
  if (text.includes('\0')) throw new Error('Use a UTF-8 CSV, not a binary spreadsheet.');
  const parsed = readCsv(text);
  const sensitive = new Set([
    'buyer',
    'buyername',
    'buyeremail',
    'email',
    'address',
    'addressline1',
    'addressline2',
    'city',
    'state',
    'postcode',
    'zipcode',
    'phone',
    'phonenumber',
  ]);
  const columns = parsed.columns.filter(
    (c) => !sensitive.has(c.toLowerCase().replace(/[^a-z0-9]/g, '')),
  );
  const rows = parsed.rows;
  if (!rows.length) throw new Error('This CSV has no data rows.');
  if (rows.length > MAX_CSV_ROWS)
    throw new Error(`Use at most ${MAX_CSV_ROWS} CSV rows per batch; split larger reports.`);
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const orderColumn = columns.find((c) =>
    ['orderid', 'ordernumber', 'transactionid'].includes(clean(c)),
  );
  // Keep every supplied order together, including non-adjacent lines. No IDs means independent rows.
  const groups = new Map<string, Record<string, string>[]>();
  rows.forEach((row, i) => {
    const external = orderColumn ? row[orderColumn]?.trim() : '';
    const key = external ? `order:${external}` : `row:${i}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  });
  const parts: DocumentPart[] = [];
  let pending: Record<string, string>[] = [];
  const encode = (data: Record<string, string>[]) =>
    new TextEncoder().encode(
      Papa.unparse({ fields: columns, data: data.map((row) => columns.map((c) => row[c])) }),
    );
  const flush = () => {
    if (pending.length) parts.push({ kind, bytes: encode(pending), rows: pending.length });
    pending = [];
  };
  for (const group of groups.values()) {
    if (group.length > CSV_ROWS_PER_PART || encode(group).length > DOCUMENT_PART_BYTES)
      throw new Error(
        'One CSV order is too large. Use at most 30 item rows per order and remove unnecessary large columns.',
      );
    if (
      pending.length &&
      (pending.length + group.length > CSV_ROWS_PER_PART ||
        encode([...pending, ...group]).length > DOCUMENT_PART_BYTES)
    )
      flush();
    pending.push(...group);
  }
  flush();
  return parts;
}
