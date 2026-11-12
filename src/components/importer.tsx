'use client';
import { useState } from 'react';
import { Upload, Download, CheckCircle2 } from 'lucide-react';
import { useWorkspace } from '@/lib/use-workspace';
import { readCsv, planImport, importColumns, downloadCsv, type ImportKind } from '@/lib/csv';
import { applyCommand } from '@/lib/commands';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { CsvSalesReview } from './csv-sales-review';
export function Importer({ onClose }: { onClose: () => void }) {
  const { w, dispatch, saving, notify, error: workspaceError } = useWorkspace();
  const [kind, setKind] = useState<ImportKind>('Sales');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [filename, setFilename] = useState('');
  const [rawCsv, setRawCsv] = useState('');
  const [result, setResult] = useState('');
  const plan = planImport(kind, rows, mapping, w);
  let validation = '';
  try {
    plan.commands.reduce(applyCommand, w);
  } catch (e) {
    validation = e instanceof Error ? e.message : 'Invalid import';
  }
  async function read(file?: File) {
    if (!file) return;
    try {
      if (file.size > 3_000_000) throw new Error('Use a CSV smaller than 3 MB.');
      const text = await file.text();
      const parsed = readCsv(text);
      setRawCsv(text);
      setRows(parsed.rows);
      setColumns(parsed.columns);
      setFilename(file.name);
      setMapping(
        Object.fromEntries(
          importColumns[kind].map((c) => [
            c,
            parsed.columns.find((p) => p.toLowerCase().replaceAll(' ', '_') === c) || '',
          ]),
        ),
      );
      setError('');
      setResult('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read file.');
    }
  }
  async function commit() {
    if (
      await dispatch([
        ...plan.commands,
        {
          type: 'import',
          value: {
            id: crypto.randomUUID(),
            filename,
            kind,
            importedAt: new Date().toISOString(),
            rawCsv,
            mapping,
            recordIds: plan.commands
              .map((c) => ('id' in c.value ? c.value.id : ''))
              .filter(Boolean),
          },
        },
      ])
    ) {
      setResult(
        `Imported ${plan.commands.length} records. Skipped ${plan.duplicates} existing records.`,
      );
      notify('Import complete.');
      setRows([]);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Bring your records together"
      description="Preview, map columns, and validate before anything is saved."
      wide
    >
      <div className="editor-form">
        <div className="form-grid">
          <label className="field">
            <span>Import type</span>
            <select
              value={kind}
              disabled={saving}
              onChange={(e) => {
                setKind(e.target.value as ImportKind);
                setRows([]);
                setColumns([]);
              }}
            >
              {Object.keys(importColumns).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <div className="align-bottom">
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(`${kind.toLowerCase()}-template`, [
                  Object.fromEntries(
                    (kind === 'Sales'
                      ? ['item_name', 'price', 'date', 'fees', 'purchase_cost']
                      : importColumns[kind]
                    ).map((c) => [c, '']),
                  ),
                ])
              }
            >
              <Download size={16} />
              Get CSV template
            </Button>
          </div>
        </div>
        <label className="drop-zone">
          <Upload size={26} />
          <strong>{filename || 'Choose a CSV file'}</strong>
          <span>Up to 3 MB · Data stays in your workspace</span>
          <input
            type="file"
            disabled={saving}
            accept=".csv,text/csv"
            onChange={(e) => void read(e.target.files?.[0])}
          />
        </label>
        {(error || workspaceError) && (
          <div role="alert" className="error-box">
            {error || workspaceError}
          </div>
        )}
        {result && (
          <div className="success-box">
            <CheckCircle2 size={18} />
            {result}
          </div>
        )}
        {!!rows.length && kind === 'Sales' && (
          <CsvSalesReview
            key={`${filename}:${rawCsv}`}
            text={rawCsv}
            filename={filename}
            rows={rows}
            columns={columns}
            onClose={onClose}
          />
        )}
        {!!rows.length && kind !== 'Sales' && (
          <>
            <h4>Match your columns</h4>
            <div className="form-grid">
              {importColumns[kind].map((c) => (
                <label className="field" key={c}>
                  <span>{c.replaceAll('_', ' ')}</span>
                  <select
                    value={mapping[c] || ''}
                    onChange={(e) => setMapping({ ...mapping, [c]: e.target.value })}
                  >
                    <option value="">Not in this file</option>
                    {columns.map((col) => (
                      <option key={col}>{col}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="hint">
              Fees, shipping, discounts, and refunds must be allocated per row; do not repeat an
              order total on each line. SKU matching is exact. For official marketplace reports, map
              only columns with verified equivalent meanings.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {columns.slice(0, 6).map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 4).map((row, i) => (
                    <tr key={i}>
                      {columns.slice(0, 6).map((c) => (
                        <td key={c}>{row[c]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              {rows.length} rows · {plan.commands.length} new records · {plan.duplicates} duplicates
              skipped
            </p>
            {plan.errors.map((e, i) => (
              <p className="error-text" key={i}>
                {e}
              </p>
            ))}
            {validation && <div className="error-box">{validation}</div>}
            <div className="form-footer">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={
                  saving ||
                  !plan.commands.length ||
                  plan.commands.length > 999 ||
                  !!plan.errors.length ||
                  !!validation
                }
                onClick={() => void commit()}
              >
                {saving ? 'Importing…' : 'Import validated records'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
