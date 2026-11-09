'use client';
import { useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  ArrowUp,
  ArrowDown,
  Upload,
  ShieldCheck,
  Moon,
  Sun,
} from 'lucide-react';
import { useWorkspace } from '@/lib/use-workspace';
import { adapters } from '@/lib/integrations/adapters';
import { parseMoney } from '@/lib/finance';
import { Button } from './ui/button';
import { Badge } from './shared';
export function Settings({ onImport }: { onImport: () => void }) {
  const { w, dispatch, demo, resetDemo, notify } = useWorkspace();
  const [error, setError] = useState('');
  return (
    <div className="settings-grid">
      <section className="card padded">
        <span className="eyebrow">MAKE YOURSELF AT HOME</span>
        <h2>Preferences</h2>
        <form
          className="editor-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const f = new FormData(e.currentTarget);
              if (
                await dispatch({
                  type: 'settings',
                  value: {
                    ...w.settings,
                    timezone: String(f.get('timezone')),
                    monthlyGoal: parseMoney(String(f.get('goal'))),
                    estimatedSellingExpenses:
                      String(f.get('sellingEstimate') || '').trim() === ''
                        ? null
                        : parseMoney(String(f.get('sellingEstimate'))),
                  },
                })
              )
                notify('Preferences saved.');
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Invalid preferences');
            }
          }}
        >
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <label className="field">
            <span>Currency</span>
            <input value="USD · US Dollar" readOnly />
          </label>
          <label className="field">
            <span>Reporting timezone</span>
            <input name="timezone" defaultValue={w.settings.timezone} required />
          </label>
          <label className="field">
            <span>Monthly profit goal ($)</span>
            <input
              name="goal"
              type="number"
              step="0.01"
              min="0"
              defaultValue={w.settings.monthlyGoal / 100}
              required
            />
          </label>
          <label className="field">
            <span>Estimated selling expenses per item ($)</span>
            <input
              name="sellingEstimate"
              type="number"
              min="0"
              step="0.01"
              placeholder="Unknown"
              defaultValue={
                w.settings.estimatedSellingExpenses === null
                  ? ''
                  : w.settings.estimatedSellingExpenses / 100
              }
            />
          </label>
          <p className="hint">
            Used only for potential profit in the pipeline. Include expected fees, seller shipping
            and direct costs. Blank means unknown; enter 0 only when no selling expenses are
            expected.
          </p>
          <div className="actions">
            <Button type="submit">Save preferences</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void dispatch({
                  type: 'settings',
                  value: { ...w.settings, theme: w.settings.theme === 'light' ? 'dark' : 'light' },
                })
              }
            >
              {w.settings.theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}Toggle theme
            </Button>
          </div>
        </form>
        <h3>Dashboard widgets</h3>
        <div className="detail-row">
          <label className="grow">
            <input
              type="checkbox"
              checked={w.settings.pipelineVisible}
              onChange={(e) =>
                void dispatch({
                  type: 'settings',
                  value: { ...w.settings, pipelineVisible: e.target.checked },
                })
              }
            />{' '}
            Inventory Pipeline
          </label>
          <small>Below financial KPIs</small>
        </div>
        {(['chart', 'sales', 'shows', 'activity'] as const).map((key) => {
          const index = w.settings.widgets.indexOf(key);
          return (
            <div className="detail-row" key={key}>
              <label className="grow">
                <input
                  type="checkbox"
                  checked={index >= 0}
                  onChange={(e) =>
                    void dispatch({
                      type: 'settings',
                      value: {
                        ...w.settings,
                        widgets: e.target.checked
                          ? [...w.settings.widgets, key]
                          : w.settings.widgets.filter((v) => v !== key),
                      },
                    })
                  }
                />{' '}
                {
                  {
                    chart: 'Earnings trend',
                    sales: 'Recent sales',
                    shows: 'Next show',
                    activity: 'Marketplace revenue',
                  }[key]
                }
              </label>
              {index > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${key} up`}
                  onClick={() => {
                    const widgets = [...w.settings.widgets];
                    [widgets[index - 1], widgets[index]] = [widgets[index], widgets[index - 1]];
                    void dispatch({ type: 'settings', value: { ...w.settings, widgets } });
                  }}
                >
                  <ArrowUp size={15} />
                </Button>
              )}
              {index >= 0 && index < w.settings.widgets.length - 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${key} down`}
                  onClick={() => {
                    const widgets = [...w.settings.widgets];
                    [widgets[index], widgets[index + 1]] = [widgets[index + 1], widgets[index]];
                    void dispatch({ type: 'settings', value: { ...w.settings, widgets } });
                  }}
                >
                  <ArrowDown size={15} />
                </Button>
              )}
            </div>
          );
        })}
      </section>
      <div className="stack">
        <section className="card padded">
          <div className="card-heading">
            <h2>Marketplace connections</h2>
            <ShieldCheck size={20} />
          </div>
          <p className="subtitle">
            Manual and CSV workflows are available. No account is connected.
          </p>
          {adapters.map((a) => (
            <div className="connection" key={a.name}>
              <div className="card-heading">
                <strong>{a.name}</strong>
                <Badge tone={a.status === 'Manual / CSV' ? 'green' : 'amber'}>{a.status}</Badge>
              </div>
              <p>{a.note}</p>
              <a
                href={a.documentation}
                target="_blank"
                rel="noopener noreferrer"
                className="text-link"
              >
                Official documentation <ExternalLink size={12} />
              </a>
            </div>
          ))}
          <p className="hint">
            API tokens are never entered into the browser or demo storage. API connection controls
            will be added only after the official authentication requirements are verified.
          </p>
        </section>
        <section className="card padded">
          <h2>Your data</h2>
          <p>
            {demo
              ? 'Fictional demo records are saved only in this browser, completely separate from private records.'
              : 'Private data is saved to Supabase after your session is authenticated. Writes require an online connection.'}
          </p>
          <Button variant="outline" onClick={onImport}>
            <Upload size={16} />
            Import CSV
          </Button>
          {demo && (
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm('Reset all demo changes to the original fictional sample?'))
                  resetDemo();
              }}
            >
              Reset demo workspace
            </Button>
          )}
          <p className="hint">
            <CheckCircle2 size={14} /> Exports are available in Inventory, Sales, Activity, and
            Insights. Exported text is guarded against spreadsheet formula injection.
          </p>
        </section>
      </div>
    </div>
  );
}
