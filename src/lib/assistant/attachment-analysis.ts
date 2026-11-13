import 'server-only';
import { createHash } from 'node:crypto';
import { readChatFile, type StoredChatFile } from './chat-files';
import { prepareDocument } from './documents';
import { readDocumentCsv, decodeSpreadsheet, safeCsvColumns } from './document-csv';
import { parseMoney } from '../money';
import { extractDocument, extractScreenshot, AssistantError } from './openai';
import { historyCsvSources, historyMapping, isDepopReport } from './csv-history';
import { marketplaceContextFromText } from './vision';
import { documentContext, contextSaleDate } from './document-context';
import type { Screenshot } from './schema';

export async function readAttachment(owner: string, id: string, part: number) {
  const { file, bytes } = await readChatFile(owner, id);
  const metadata = {
    id: file.id,
    name: file.name,
    mime: file.mime,
    source: 'Untrusted private attachment, not saved business records.',
  };
  if (file.mime === 'application/pdf') {
    if (part !== 0) throw new Error('PDF is supplied as one native document.');
    return [
      { type: 'input_text', text: JSON.stringify(metadata) },
      {
        type: 'input_file',
        filename: file.name,
        file_data: `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`,
      },
    ];
  }
  if (file.mime.startsWith('image/')) {
    if (part !== 0) throw new Error('Image has one part.');
    return [
      { type: 'input_text', text: JSON.stringify(metadata) },
      {
        type: 'input_image',
        image_url: `data:${file.mime};base64,${Buffer.from(bytes).toString('base64')}`,
        detail: 'high',
      },
    ];
  }
  const chunks = prepareDocument(bytes, 'csv', {
    groupOrders: false,
    maxRows: 5000,
    preserveSummaries: true,
  });
  if (!chunks[part]) throw new Error('Choose a CSV part within its reported range.');
  return [
    {
      type: 'input_text',
      text: JSON.stringify({
        ...metadata,
        part,
        parts: chunks.length,
        totalRows: chunks.reduce((sum, c) => sum + (c.rows || 0), 0),
        preamble:
          part === 0
            ? readDocumentCsv(decodeSpreadsheet(bytes), { maxRows: 5000, preserveSummaries: true })
                .preamble
            : undefined,
        data: new TextDecoder().decode(chunks[part].bytes),
        meaning:
          'Data rows in this part only; read remaining parts or use search/statistics before making a full-file claim.',
      }),
    },
  ];
}
export async function attachmentRows(owner: string, id: string, query: string, offset: number) {
  const { file, bytes } = await readChatFile(owner, id);
  if (file.mime !== 'text/csv')
    throw new Error('Row search is for CSV files; read the PDF/image natively.');
  const parsed = readDocumentCsv(decodeSpreadsheet(bytes), {
      maxRows: 5000,
      preserveSummaries: true,
    }),
    columns = safeCsvColumns(parsed.columns);
  const rows = parsed.rows
    .map((r, index) => ({
      row: index + 1,
      values: Object.fromEntries(columns.map((c) => [c, r[c]])),
    }))
    .filter(
      (r) =>
        !query ||
        Object.values(r.values).some((v) => v.toLowerCase().includes(query.toLowerCase())),
    );
  return {
    source: 'Attachment data only',
    fileId: id,
    totalRows: parsed.rows.length,
    matches: rows.length,
    hasMore: offset + 30 < rows.length,
    columns,
    rows: rows.slice(offset, offset + 30),
  };
}
export async function attachmentColumnSummary(owner: string, id: string, column: string) {
  const { file, bytes } = await readChatFile(owner, id);
  if (file.mime !== 'text/csv') throw new Error('Column statistics are for CSV files.');
  const parsed = readDocumentCsv(decodeSpreadsheet(bytes), { maxRows: 5000 });
  if (!safeCsvColumns(parsed.columns).includes(column))
    throw new Error('Choose a readable, non-contact CSV column by its exact name.');
  let sum = 0,
    known = 0,
    missing = 0,
    invalid = 0,
    zeros = 0;
  for (const row of parsed.rows) {
    let value = row[column]?.trim();
    if (!value) {
      missing++;
      continue;
    }
    value = value.replace(/^\$/, '').replace(/,/g, '');
    if (/^\(\d+(?:\.\d{1,2})?\)$/.test(value)) value = '-' + value.slice(1, -1);
    try {
      const cents = parseMoney(value);
      sum += cents;
      known++;
      if (cents === 0) zeros++;
    } catch {
      invalid++;
    }
  }
  return {
    source:
      'Attachment literal values only; not workspace financials. No formulas executed or currency conversion.',
    column,
    rows: parsed.rows.length,
    known,
    missing,
    invalid,
    confirmedZeros: zeros,
    sumOfKnownCents: known ? sum : null,
    complete: missing === 0 && invalid === 0,
    note: 'Clearly labeled footer totals are excluded to avoid double counting. A partly populated summary column is not a per-item total.',
  };
}
export async function prepareAttachmentImport(
  owner: string,
  files: StoredChatFile[],
  context: string,
  timezone: string,
  fetcher: typeof fetch = fetch,
): Promise<Screenshot[]> {
  const sources: Screenshot[] = [];
  const clock = documentContext(timezone);
  for (const file of files) {
    const { bytes } = await readChatFile(owner, file.id);
    let extracted: Screenshot[] = [];
    if (file.mime === 'text/csv') {
      const parsed = readDocumentCsv(decodeSpreadsheet(bytes)),
        mapping = historyMapping(parsed.columns),
        depop = isDepopReport(parsed.columns);
      const describesSales =
        /\b(?:sold|sales|completed orders)\b/i.test(context) ||
        /\b(?:sale|sold|selling)\b/i.test(mapping.price || '');
      if (!depop && !describesSales && /\b(?:unsold|unlisted|stock|inventory)\b/i.test(context))
        throw new AssistantError(
          'This appears to be unsold inventory. Use Inventory → Import CSV so it is not recorded as completed sales.',
          422,
        );
      if (depop || (mapping.title && mapping.price && describesSales)) {
        extracted = await historyCsvSources(parsed.text, file.name, {
          mapping,
          marketplace: depop
            ? 'Depop'
            : mapping.marketplace
              ? ''
              : marketplaceContextFromText(context) || '',
          dateFormat: 'auto',
          depop,
          allowIncomplete: !depop,
        });
        const supplied = contextSaleDate(context, clock);
        extracted = extracted.map((s) => ({
          ...s,
          extraction: {
            ...s.extraction,
            records: s.extraction.records.map((r) => ({
              ...r,
              date: r.date || (!mapping.date ? supplied : null),
            })),
            message: [
              s.extraction.message,
              parsed.note,
              !mapping.fees
                ? 'Seller fees are unknown; review and enter them before approval.'
                : '',
              supplied && !mapping.date
                ? `Missing sale dates use ${supplied} from your request (${timezone}); review before approval.`
                : '',
            ]
              .filter(Boolean)
              .join(' ')
              .slice(0, 1000),
          },
        }));
      }
    }
    if (!extracted.length) {
      if (file.mime.startsWith('image/'))
        extracted = [
          {
            ...(await extractScreenshot(owner, bytes, file.mime, fetcher)),
            name: file.name,
            sourceType: 'image',
          },
        ];
      else {
        const kind = file.mime === 'text/csv' ? 'csv' : 'pdf',
          parts = prepareDocument(bytes, kind);
        if (sources.length + parts.length > 10)
          throw new AssistantError(
            'Prepare at most ten analysis parts per import; choose fewer files.',
            422,
          );
        for (let index = 0; index < parts.length; index++) {
          const result = await extractDocument(owner, parts[index], context, fetcher, clock);
          extracted.push({
            ...result,
            name: file.name,
            sourceType: kind,
            part: index + 1,
            parts: parts.length,
          });
        }
      }
    }
    sources.push(
      ...extracted.map((s, index) => ({
        ...s,
        hash: file.mime.startsWith('image/')
          ? s.hash
          : createHash('sha256').update(`${file.id}:${file.hash}:${index}:${s.hash}`).digest('hex'),
        chatFileId: file.id,
        originalHash: file.hash,
      })),
    );
    if (sources.length > 10)
      throw new AssistantError(
        'Prepare at most ten analysis parts per import; choose fewer files.',
        422,
      );
  }
  return sources;
}
