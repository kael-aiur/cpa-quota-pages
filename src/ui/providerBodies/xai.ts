import type { XaiQuotaData } from '../../providers/xai/parser';
import { h, textOf } from '../dom';
import { emptyWindowsNotice, renderMeter } from '../renderProviderBody';

const PERIOD_LABELS: Record<string, string> = {
  weekly: '每周',
  monthly: '每月',
  unknown: '当前周期',
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

function cents(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return `$${(value / 100).toFixed(2)}`;
}

export function buildXaiBody(data: XaiQuotaData, nowMs: number): HTMLElement {
  const body = h('div', { class: 'providerBody', data: { provider: 'xai' } });

  const billing = data.billing;
  const planItems: HTMLElement[] = [];
  if (billing) {
    planItems.push(metaValue('周期', PERIOD_LABELS[billing.periodType] ?? '当前周期'));
    const limit = cents(billing.monthlyLimitCents);
    const used = cents(billing.usedCents);
    if (limit) planItems.push(metaValue('月度上限', limit));
    if (used) planItems.push(metaValue('本月已用', used));
  }
  if (planItems.length) {
    body.append(h('div', { class: 'planRow', children: planItems }));
  }

  if (billing && billing.productUsage.length) {
    body.append(h('div', {
      class: 'productList',
      children: billing.productUsage.map((item) => h('div', {
        class: 'productItem',
        children: [
          h('span', { class: 'productName', text: textOf(item.product) || 'Product' }),
          h('span', {
            class: 'productPercent',
            text: item.usagePercent === null || !Number.isFinite(item.usagePercent)
              ? '--%'
              : `${Math.round(item.usagePercent)}%`,
          }),
        ],
      })),
    }));
  }

  if (data.windows.length === 0) {
    body.append(emptyWindowsNotice());
    return body;
  }

  for (const window of data.windows) {
    body.append(renderMeter({
      id: window.id,
      label: textOf(window.label) || 'xAI',
      remainingPercent: window.remainingPercent,
      resetAtMs: window.resetAtMs,
    }, nowMs));
  }
  return body;
}
