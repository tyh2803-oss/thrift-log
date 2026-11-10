'use client';
/* Private source blobs and authenticated source routes never become public image URLs. */
/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import type { ExtractedLine, Screenshot } from '@/lib/assistant/schema';
import { vintageClassifications, type Clothing } from '@/lib/assistant/clothing';
import { emptyClothing } from '@/lib/assistant/vision';

export function ClothingPreview({
  line,
  source,
  url,
}: {
  line: ExtractedLine;
  source?: Screenshot;
  url?: string;
}) {
  const [aspect, setAspect] = useState(1);
  const c = line.clothing;
  const src =
    url ||
    (source?.reference ? `/api/photos?path=${encodeURIComponent(source.reference)}` : undefined);
  const box = c?.region;
  const valid = box && box.right > box.left && box.bottom > box.top;
  const width = valid ? (box.right - box.left) / 1000 : 1;
  const height = valid ? (box.bottom - box.top) / 1000 : 1;
  return (
    <div className="assistant-garment">
      {src && (
        <div className="assistant-product-image" style={{ aspectRatio: (aspect * width) / height }}>
          <img
            src={src}
            alt={`Screenshot evidence for ${line.title || 'clothing item'}`}
            onLoad={(e) => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
            style={{
              width: `${100 / width}%`,
              maxWidth: 'none',
              position: 'absolute',
              left: valid ? `${-box.left / 10 / width}%` : 0,
              top: valid ? `${-box.top / 10 / height}%` : 0,
            }}
          />
        </div>
      )}
      <div>
        <p>
          {[
            line.brand,
            c?.garmentType || line.category,
            line.size && `Size ${line.size}`,
            line.condition,
          ]
            .filter(Boolean)
            .join(' · ') || 'Garment details unknown'}
        </p>
        <p>{[line.color, c?.design, c?.fit].filter(Boolean).join(' · ')}</p>
        {c && (
          <>
            <strong>
              {c.vintage.classification === 'Vintage confirmed' &&
              (!c.vintage.confirmedByUser || !c.vintage.ageEvidence?.trim())
                ? 'Potentially vintage'
                : c.vintage.classification}
            </strong>
            <small>
              {c.vintage.classification === 'Vintage confirmed' &&
              c.vintage.confirmedByUser &&
              !!c.vintage.ageEvidence?.trim()
                ? c.vintage.ageEvidence
                : 'Age unverified'}
            </small>
            {c.partial && (
              <p className="hint">Partly visible card — confirm the associated details.</p>
            )}
            <details>
              <summary>Visual evidence and original text</summary>
              <p>Marketplace title: {c.originalTitle || 'Not visible'}</p>
              <p>Visible lettering: {c.visibleText || 'Not determined'}</p>
              <p>
                Material: {c.material || 'Not determined'} · Style: {c.style || 'Not determined'}
              </p>
              {c.evidence.map((e, i) => (
                <p key={i}>
                  <strong>{e.field}</strong> · {e.source.replaceAll('_', ' ')}: {e.note}
                </p>
              ))}
              {c.vintage.evidence.map((e, i) => (
                <p key={i}>Vintage evidence: {e}</p>
              ))}
              {c.vintage.followUp && <p className="hint">{c.vintage.followUp}</p>}
            </details>
          </>
        )}
      </div>
    </div>
  );
}
export function ClothingEditor({
  line,
  onChange,
}: {
  line: ExtractedLine;
  onChange: (line: ExtractedLine) => void;
}) {
  const c = line.clothing || emptyClothing();
  function update(value: Partial<Clothing>) {
    onChange({ ...line, clothing: { ...c, ...value } });
  }
  return (
    <details>
      <summary>Clothing observations and vintage assessment</summary>
      <div className="form-grid">
        {(
          [
            'garmentType',
            'design',
            'material',
            'fit',
            'style',
            'originalTitle',
            'visibleText',
          ] as const
        ).map((key) => (
          <label className="field" key={key}>
            <span>
              {
                {
                  garmentType: 'Garment type',
                  design: 'Logos / graphics / lettering',
                  material: 'Material (only if supported)',
                  fit: 'Fit / silhouette',
                  style: 'Style characteristics',
                  originalTitle: 'Original marketplace title',
                  visibleText: 'Original visible text',
                }[key]
              }
            </span>
            <textarea
              maxLength={key === 'visibleText' ? 2000 : 500}
              value={c[key] || ''}
              onChange={(e) => update({ [key]: e.target.value || null })}
            />
          </label>
        ))}
        <label className="field">
          <span>Vintage assessment</span>
          <select
            value={c.vintage.classification}
            onChange={(e) =>
              update({
                vintage: {
                  ...c.vintage,
                  classification: e.target.value as Clothing['vintage']['classification'],
                  confirmedByUser: false,
                },
              })
            }
          >
            {vintageClassifications.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Vintage evidence (one observation per line)</span>
          <textarea
            maxLength={2000}
            value={c.vintage.evidence.join('\n')}
            onChange={(e) =>
              update({
                vintage: {
                  ...c.vintage,
                  evidence: e.target.value
                    .split('\n')
                    .slice(0, 8)
                    .map((s) => s.slice(0, 300)),
                  confirmedByUser: false,
                },
              })
            }
          />
        </label>
        <label className="field">
          <span>Verified age evidence</span>
          <textarea
            maxLength={500}
            value={c.vintage.ageEvidence || ''}
            onChange={(e) =>
              update({
                vintage: {
                  ...c.vintage,
                  ageEvidence: e.target.value || null,
                  confirmedByUser: false,
                },
              })
            }
          />
        </label>
      </div>
      {c.vintage.classification === 'Vintage confirmed' && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={!!c.vintage.confirmedByUser}
            onChange={(e) =>
              update({ vintage: { ...c.vintage, confirmedByUser: e.target.checked } })
            }
          />
          I verified the garment’s age using the evidence above.
        </label>
      )}
      <small>
        Appearance alone does not confirm age. Original extraction remains in the source audit.
      </small>
    </details>
  );
}
