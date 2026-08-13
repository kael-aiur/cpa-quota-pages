/**
 * Pure-DOM construction helpers.
 *
 * Every dynamic value flows through `textContent` / `createTextNode` — there is
 * no generic raw-HTML helper here, so upstream strings can never execute as
 * markup. Static SVG marks live in `icons.ts` and are built with the SVG
 * namespace.
 */

export type QuotaTier = 'high' | 'medium' | 'low' | 'unknown';

/** Remaining-percent thresholds (≥70 healthy, ≥30 moderate, <30 low). */
export const HIGH_THRESHOLD = 70;
export const MEDIUM_THRESHOLD = 30;

/** Status word paired with every tier — the dataviz rule: never color alone. */
export const TIER_LABEL: Record<QuotaTier, string> = {
  high: '充足',
  medium: '适中',
  low: '紧张',
  unknown: '未知',
};

export function remainingTier(remaining: number | null): QuotaTier {
  if (remaining === null || !Number.isFinite(remaining)) return 'unknown';
  if (remaining >= HIGH_THRESHOLD) return 'high';
  if (remaining >= MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}

export function clampPercent(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

/** Create an element with optional attributes and children (no innerHTML). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: {
    class?: string;
    text?: string;
    attrs?: Record<string, string>;
    data?: Record<string, string>;
    aria?: Record<string, string | null>;
    style?: Record<string, string>;
    children?: ReadonlyArray<Node | null | undefined>;
    title?: string;
  } = {},
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options.class) el.className = options.class;
  if (options.text !== undefined) el.textContent = options.text;
  if (options.title !== undefined) el.title = options.title;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) el.setAttribute(key, value);
  }
  if (options.data) {
    for (const [key, value] of Object.entries(options.data)) el.dataset[key] = value;
  }
  if (options.aria) {
    for (const [key, value] of Object.entries(options.aria)) {
      if (value === null) el.removeAttribute(`aria-${key}`);
      else el.setAttribute(`aria-${key}`, value);
    }
  }
  if (options.style) {
    for (const [prop, value] of Object.entries(options.style)) el.style.setProperty(prop, value);
  }
  if (options.children) {
    for (const child of options.children) {
      if (child !== null && child !== undefined) el.append(child);
    }
  }
  return el;
}

/** Append a list of children, skipping nullish entries. */
export function appendAll(parent: ParentNode, children: ReadonlyArray<Node | null | undefined>): void {
  for (const child of children) {
    if (child !== null && child !== undefined) parent.append(child);
  }
}

/** Coerce any value to a safe display string. */
export function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return '';
}
