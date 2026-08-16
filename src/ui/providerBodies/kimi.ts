import type { KimiQuotaData } from '../../providers/kimi/parser';
import { h, textOf } from '../dom';
import { emptyWindowsNotice, renderMeter } from '../renderProviderBody';

function metaValue(label: string, value: string): HTMLElement {
  return h('span', {
    class: 'planItem',
    children: [
      h('span', { class: 'planLabel', text: label }),
      h('span', { class: 'planValue', text: value }),
    ],
  });
}

export function buildKimiBody(data: KimiQuotaData, nowMs: number, urgentWindowId: string | null = null): HTMLElement {
  const body = h('div', { class: 'providerBody', data: { provider: 'kimi' } });

  if (data.windows.length === 0) {
    body.append(emptyWindowsNotice());
    return body;
  }

  for (const window of data.windows) {
    body.append(renderMeter({
      id: window.id,
      label: textOf(window.label) || 'Kimi',
      remainingPercent: window.remainingPercent,
      resetAtMs: window.resetAtMs,
    }, nowMs, window.id === urgentWindowId));

    const limit = window.limit;
    const used = window.used;
    if (typeof limit === 'number' && Number.isFinite(limit) && typeof used === 'number' && Number.isFinite(used)) {
      body.append(h('div', {
        class: 'quotaFigures',
        children: [metaValue('已用 / 上限', `${used} / ${limit}`)],
      }));
    }
  }
  return body;
}
