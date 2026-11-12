'use client';
import { useId } from 'react';
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';
export function TrendChart({
  data,
  metric = 'profit',
}: {
  data: { label: string; revenue: number; profit: number }[];
  metric?: 'revenue' | 'profit';
}) {
  const gradient = useId().replaceAll(':', '');
  return (
    <div className="chart-wrap" data-metric={metric} role="img" aria-label={`${metric} over time`}>
      <ResponsiveContainer width="100%" height={235}>
        <AreaChart data={data} margin={{ top: 15, right: 8, left: -22, bottom: 0 }}>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--metric-color)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--metric-color)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            minTickGap={35}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${v}`}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
          />
          <Tooltip
            formatter={(v) => [
              `$${Number(v).toFixed(2)}`,
              metric === 'profit' ? 'Realized profit' : 'Revenue',
            ]}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--text)',
            }}
          />
          <Area
            type="monotone"
            dataKey={metric}
            stroke="var(--metric-color)"
            strokeWidth={2.5}
            fill={`url(#${gradient})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function BreakdownChart({ data }: { data: { name: string; value: number }[] }) {
  return (
    <div className="chart-wrap" data-metric="profit">
      <ResponsiveContainer width="100%" height={235}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
          />
          <YAxis
            tickFormatter={(v) => `$${v}`}
            axisLine={false}
            tickLine={false}
            width={45}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
          />
          <Tooltip
            formatter={(v) => `$${Number(v).toFixed(2)}`}
            contentStyle={{
              background: 'var(--card)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 12,
            }}
          />
          <Bar
            dataKey="value"
            fill="var(--metric-color)"
            isAnimationActive={false}
            radius={[5, 5, 0, 0]}
            maxBarSize={48}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
