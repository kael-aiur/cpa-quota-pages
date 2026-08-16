import type { ClaudeQuotaData } from '../../providers/claude/types';
import { h, textOf } from '../dom';
import { emptyWindowsNotice, renderMeter } from '../renderProviderBody';

const PLAN_LABELS: Record<string, string> = {
  plan_free: 'Free',
  plan_pro: 'Pro',
  plan_max: 'Max',
  plan_team: 'Team',
};

function planLabel(planType: string | null): string | null {
  if (!planType) return null;
  return PLAN_LABELS[planType] ?? planType;
}

function metaValue(label: string, value: string): HTMLElement {
  return h('span', {
    class: 'planItem',
    children: [
      h('span', { class: 'planLabel', text: label }),
      h('span', { class: 'planValue', text: value }),
    ],
  });
}

export function buildClaudeBody(data: ClaudeQuotaData, nowMs: number, urgentWindowId: string | null = null): HTMLElement {
  const body = h('div', { class: 'providerBody', data: { provider: 'claude' } });

  const planItems: HTMLElement[] = [];
  const plan = planLabel(data.planType);
  if (plan) planItems.push(metaValue('计划', plan));

  const extra = data.extraUsage;
  const extraEnabled = extra && extra.is_enabled === true;
  if (extraEnabled) {
    const limit = typeof extra.monthly_limit === 'number' && Number.isFinite(extra.monthly_limit)
      ? String(extra.monthly_limit)
      : null;
    const used = typeof extra.used_credits === 'number' && Number.isFinite(extra.used_credits)
      ? String(extra.used_credits)
      : null;
    if (limit) planItems.push(metaValue('额外额度上限', limit));
    if (used) planItems.push(metaValue('额外已用', used));
  }

  if (planItems.length) {
    body.append(h('div', { class: 'planRow', children: planItems }));
  }

  if (data.windows.length === 0) {
    body.append(emptyWindowsNotice());
    return body;
  }

  for (const window of data.windows) {
    body.append(renderMeter({
      id: window.id,
      label: textOf(window.label) || 'Claude',
      remainingPercent: window.remainingPercent,
      resetAtMs: window.resetAtMs,
    }, nowMs, window.id === urgentWindowId));
  }
  return body;
}
