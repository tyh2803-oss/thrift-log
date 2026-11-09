'use client';
/* Native images support authenticated private-storage URLs and locally uploaded demo photos. */
/* eslint-disable @next/next/no-img-element */
import { Package, ArrowUpRight, Check, Shirt } from 'lucide-react';
import { money } from '@/lib/finance';
import type { Item } from '@/lib/model';
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'green' | 'amber' | 'red' | 'purple';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Status({ value }: { value: string }) {
  return (
    <Badge
      tone={
        ['Sold', 'Completed', 'Paid', 'Delivered', 'Ended', 'Listed', 'Active'].includes(value)
          ? 'green'
          : ['Reserved', 'Needs delisting', 'Pending', 'Unfulfilled', 'Paused'].includes(value)
            ? 'amber'
            : ['Cancelled', 'Returned'].includes(value)
              ? 'red'
              : 'neutral'
      }
    >
      {value}
    </Badge>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Package size={25} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ItemPhoto({ item, large = false }: { item: Item; large?: boolean }) {
  const src = item.photos[0];
  return (
    <div className={`item-photo ${large ? 'photo-large' : ''} color-${item.category.length % 5}`}>
      {src ? (
        <img
          src={src.startsWith('data:') ? src : `/api/photos?path=${encodeURIComponent(src)}`}
          alt={item.title}
        />
      ) : (
        <Shirt strokeWidth={1} size={large ? 80 : 28} />
      )}
    </div>
  );
}
export function Metric({
  label,
  value,
  note,
  positive = false,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  positive?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="metric">
      <div className="metric-top">
        <span>{label}</span>
        {icon}
      </div>
      <strong className={positive ? 'positive' : ''}>{value}</strong>
      <div className="metric-note">
        {positive && <ArrowUpRight size={13} />} {note}
      </div>
    </div>
  );
}
export function CheckButton({
  checked,
  onClick,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className="check-row" onClick={onClick}>
      <span className={`checkbox ${checked ? 'checked' : ''}`}>
        {checked && <Check size={12} />}
      </span>
      <span>{children}</span>
    </button>
  );
}
export const dollars = (value: number) => money(value);
