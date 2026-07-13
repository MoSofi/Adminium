/** Compact numeral formatting for axis/legend labels ("1.2k", "3.4M"). */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}${trim(abs / 1e3)}k`;
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(1)));
}

function trim(scaled: number): string {
  const fixed = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}

/** Short month-day label for time axes ("Mar 4"). Locale-stable (en) for demo/test use. */
export function formatShortDate(date: Date): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MONTHS[date.getUTCMonth()] ?? ''} ${date.getUTCDate()}`;
}
