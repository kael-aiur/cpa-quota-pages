import type { AntigravityQuotaData } from '../../providers/antigravity/parser';
import { h, textOf } from '../dom';
import { emptyWindowsNotice, renderMeter } from '../renderProviderBody';

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  ultra: 'Ultra',
  'ultra-lite': 'Ultra Lite',
  unknown: 'Unknown',
};

function metaValue(label: string, value: string): HTMLElement {
  return h('span', {
    class: 'planItem',
    children: [
      h('span', { class: 'planLabel', text: label }),
      h('span', { class: 'planValue', text: value }),
    ],
  });
}

export function buildAntigravityBody(data: AntigravityQuotaData, nowMs: number): HTMLElement {
  const body = h('div', { class: 'providerBody', data: { provider: 'antigravity' } });

  const planItems: HTMLElement[] = [];
  const sub = data.subscription;
  if (sub) {
    const planText = sub.tierName ?? PLAN_LABELS[sub.plan] ?? 'Unknown';
    planItems.push(metaValue('订阅', planText));
  }
  if (planItems.length) {
    body.append(h('div', { class: 'planRow', children: planItems }));
  }

  const totalBuckets = data.groups.reduce((sum, group) => sum + group.buckets.length, 0);
  if (totalBuckets === 0) {
    body.append(emptyWindowsNotice());
    return body;
  }

  for (const group of data.groups) {
    body.append(h('div', { class: 'quotaGroupLabel', text: textOf(group.label) || 'Quota' }));
    for (const bucket of group.buckets) {
      const remaining = typeof bucket.remainingFraction === 'number' && Number.isFinite(bucket.remainingFraction)
        ? Math.round(bucket.remainingFraction * 10000) / 100
        : null;
      body.append(renderMeter({
        id: bucket.id,
        label: textOf(bucket.label) || bucket.id,
        remainingPercent: remaining,
        resetAtMs: bucket.resetAtMs,
      }, nowMs));
    }
  }
  return body;
}
