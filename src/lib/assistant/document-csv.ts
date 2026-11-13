import Papa from 'papaparse';
import { historyMapping, isDepopReport } from './csv-history';

/** Spreadsheet exports often contain titles, blank columns and repeated table headings. */
export function decodeSpreadsheet(bytes: Uint8Array) {
  let text: string;
  try {
    const encoding =
      bytes[0] === 255 && bytes[1] === 254
        ? 'utf-16le'
        : bytes[0] === 254 && bytes[1] === 255
          ? 'utf-16be'
          : 'utf-8';
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Export this spreadsheet as a UTF-8 CSV or a PDF and attach it again.');
  }
  if (text.includes('\0')) throw new Error('Use a CSV text export, not a binary spreadsheet.');
  return text;
}

export function safeCsvColumns(columns: string[]) {
  const privateFields = new Set([
    'buyer',
    'buyername',
    'buyeremail',
    'buyeremailaddress',
    'buyerusername',
    'buyeraddress',
    'customername',
    'customeremail',
    'customeraddress',
    'email',
    'emailaddress',
    'address',
    'addressline1',
    'addressline2',
    'shippingaddress',
    'billingaddress',
    'city',
    'state',
    'postcode',
    'zipcode',
    'phone',
    'phonenumber',
  ]);
  return columns.filter((c) => !privateFields.has(c.toLowerCase().replace(/[^a-z0-9]/g, '')));
}
export function readDocumentCsv(
  text: string,
  options: { maxRows?: number; preserveSummaries?: boolean } = {},
) {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  const error = parsed.errors.find((e) => e.code !== 'UndetectableDelimiter');
  if (error) throw new Error(`CSV could not be read: ${error.message}`);
  const table = parsed.data.map((row) => row.map((cell) => cell.trim()));
  if (!table.length) throw new Error('This CSV has no data rows.');
  if (table.length > 5050 || table.some((r) => r.length > 200))
    throw new Error('Use a smaller spreadsheet with at most 200 columns.');
  // Only skip a preamble when a recognisable table header provides strong evidence.
  const header = table.slice(0, 50).findIndex((row) => {
    const map = historyMapping(row);
    return !!map.title && !!(map.price || map.purchase_cost || map.sku);
  });
  const start = header >= 0 ? header : 0;
  const headings = table[start];
  const width = Math.max(...table.slice(start).map((row) => row.length));
  const seen = new Set<string>();
  const columns = Array.from({ length: width }, (_, i) => {
    const title = headings[i]?.replace(/^\uFEFF/, '').trim() || `Column ${i + 1}`;
    let name = title;
    let n = 2;
    while (seen.has(name)) name = `${title} (${n++})`;
    seen.add(name);
    return name;
  });
  let repeated = 0;
  let summaries = 0;
  const mapping = historyMapping(columns);
  const titleIndex = columns.indexOf(mapping.title);
  const skuIndex = columns.indexOf(mapping.sku);
  const data = table.slice(start + 1).filter((row) => {
    if (row.length <= headings.length && headings.every((cell, i) => cell === (row[i] || ''))) {
      repeated++;
      return false;
    }
    if (
      !options.preserveSummaries &&
      !isDepopReport(columns) &&
      titleIndex >= 0 &&
      /^(?:grand\s+total|sub\s*total|totals?|net\s+profit)$/i.test(row[titleIndex] || '') &&
      (skuIndex < 0 || !row[skuIndex])
    ) {
      summaries++;
      return false;
    }
    return true;
  });
  if (!data.length) throw new Error('This CSV has no data rows below its headings.');
  const limit = Math.min(5000, options.maxRows || 300);
  if (data.length > limit)
    throw new Error(`Use at most ${limit} CSV item rows per batch; split larger spreadsheets.`);
  const rows = data.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i] || ''])));
  return {
    columns,
    preamble: table
      .slice(0, start)
      .map((r) => r.filter(Boolean).join(' | '))
      .join('\n')
      .slice(0, 4000),
    rows,
    text: Papa.unparse({
      fields: columns,
      data: data.map((r) => columns.map((_, i) => r[i] || '')),
    }),
    note:
      start || repeated || summaries
        ? `Located the table after ${start} title/heading rows; skipped ${repeated} repeated headings and ${summaries} summary-total rows.`
        : '',
  };
}
