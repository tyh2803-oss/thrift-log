export const periods = [
  'Today',
  'Yesterday',
  'Last 7 days',
  'Last 30 days',
  'This month',
  'Last month',
  'This year',
  'All time',
  'Custom',
] as const;
export type Period = (typeof periods)[number];
export function localDay(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
export function zoneMidnight(day: string, zone: string) {
  const [y, m, d] = day.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d);
  let candidate = utc;
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(candidate));
    const get = (s: string) => Number(parts.find((p) => p.type === s)?.value);
    const represented = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    candidate += utc - represented;
  }
  return candidate;
}
export function periodRange(
  period: Period,
  zone: string,
  customStart = '',
  customEnd = '',
  now = new Date(),
): [number, number] {
  const today = localDay(now, zone);
  const [y, m, d] = today.split('-').map(Number);
  const shift = (days: number) => new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  const next = (day: string) => {
    const x = new Date(`${day}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + 1);
    return x.toISOString().slice(0, 10);
  };
  let start = today,
    end = shift(1);
  switch (period) {
    case 'Yesterday':
      start = shift(-1);
      end = today;
      break;
    case 'Last 7 days':
      start = shift(-6);
      break;
    case 'Last 30 days':
      start = shift(-29);
      break;
    case 'This month':
      start = `${y}-${String(m).padStart(2, '0')}-01`;
      break;
    case 'Last month':
      start = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
      end = `${y}-${String(m).padStart(2, '0')}-01`;
      break;
    case 'This year':
      start = `${y}-01-01`;
      break;
    case 'All time':
      return [0, +now];
    case 'Custom':
      if (!customStart || !customEnd) return [0, +now];
      start = customStart;
      end = next(customEnd);
  }
  return [zoneMidnight(start, zone), zoneMidnight(end, zone) - 1];
}
