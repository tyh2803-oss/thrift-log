'use client';
import { CircleMinus, BadgeDollarSign, TrendingUp } from 'lucide-react';
import type { PipelineMetric } from '@/lib/pipeline';
export type FinancialTone = 'cost' | 'revenue' | 'profit';
export const financialTone = (metric: PipelineMetric): FinancialTone =>
  metric === 'sale' ? 'revenue' : metric;
export function FinancialMetricToggle({
  metric,
  onChange,
  label,
  saleLabel = 'Sale Value',
  showCost = true,
}: {
  metric: PipelineMetric;
  onChange: (value: PipelineMetric) => void;
  label: string;
  saleLabel?: string;
  showCost?: boolean;
}) {
  const options = [
    { value: 'cost', label: 'Cost', Icon: CircleMinus },
    { value: 'sale', label: saleLabel, Icon: BadgeDollarSign },
    { value: 'profit', label: 'Profit', Icon: TrendingUp },
  ] as const;
  return (
    <div className="segmented financial-toggle" role="group" aria-label={label}>
      {options
        .filter((o) => showCost || o.value !== 'cost')
        .map(({ value, label, Icon }) => (
          <button
            type="button"
            key={value}
            data-metric={financialTone(value)}
            aria-pressed={metric === value}
            className={metric === value ? 'active' : ''}
            onClick={() => onChange(value)}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
    </div>
  );
}
