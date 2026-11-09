'use client';
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
  return (
    <div className="chart-wrap" role="img" aria-label={`${metric} over time`}>
      <ResponsiveContainer width="100%" height={235}>
        <AreaChart data={data} margin={{ top: 15, right: 8, left: -22, bottom: 0 }}>
          <defs>
            <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6a8367" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#6a8367" stopOpacity={0} />
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
            stroke="#52784d"
            strokeWidth={2.5}
            fill="url(#profitGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function BreakdownChart({ data }: { data: { name: string; value: number }[] }) {
  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={235}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={(v) => `$${v}`} axisLine={false} tickLine={false} width={45} />
          <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
          <Bar dataKey="value" fill="#789471" radius={[5, 5, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
