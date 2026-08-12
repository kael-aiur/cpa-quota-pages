const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function relativeParts(targetMs: number, nowMs: number): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const delta = targetMs - nowMs;
  const sign = delta < 0 ? -1 : 1;
  const absolute = Math.abs(delta);
  if (absolute >= DAY_MS) return { value: sign * Math.floor(absolute / DAY_MS), unit: 'day' };
  if (absolute >= HOUR_MS) return { value: sign * Math.floor(absolute / HOUR_MS), unit: 'hour' };
  return { value: sign * Math.max(1, Math.floor(absolute / MINUTE_MS)), unit: 'minute' };
}

function formatter(locale?: string): Intl.RelativeTimeFormat {
  try { return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }); }
  catch { return new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }); }
}

export function formatResetLabel(resetAtMs: number, nowMs: number, locale?: string): string {
  if (!Number.isFinite(resetAtMs)) return '-';
  const absolute = (() => {
    try {
      return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(resetAtMs));
    } catch {
      return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(resetAtMs));
    }
  })();
  const { value, unit } = relativeParts(resetAtMs, nowMs);
  return `${absolute} (${formatter(locale).format(value, unit)})`;
}
