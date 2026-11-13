import { localDay } from '../dates';

export function documentContext(timeZone = 'UTC', now = new Date()) {
  try {
    return { timeZone, currentDate: localDay(now, timeZone) };
  } catch {
    return { timeZone: 'UTC', currentDate: localDay(now, 'UTC') };
  }
}
export type DocumentContext = ReturnType<typeof documentContext>;

/** Narrow explicit date defaults only; source dates always take precedence. */
export function contextSaleDate(message: string, context: DocumentContext): string | null {
  if (/\b(?:not|except|different|between|unsold|unlisted)\b/i.test(message)) return null;
  const dates = [...new Set(message.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [])];
  const today = /\btoday\b/i.test(message);
  const yesterday = /\b(?:yesterday|last night)\b/i.test(message);
  if (dates.length + Number(today) + Number(yesterday) !== 1) return null;
  if (dates.length) return dates[0];
  const date = new Date(`${context.currentDate}T12:00:00Z`);
  if (yesterday) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
