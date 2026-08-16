import type { CodexQuotaData } from '../../providers/codex/parser';
import { h, textOf } from '../dom';
import { emptyWindowsNotice, renderMeter } from '../renderProviderBody';

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  team: 'Team',
  prolite: 'Pro Lite',
  'pro-lite': 'Pro Lite',
  pro_lite: 'Pro Lite',
};

function planLabel(planType: string | null): string | null {
  if (!planType) return null;
  return PLAN_LABELS[planType.toLowerCase()] ?? planType;
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

export function buildCodexBody(data: CodexQuotaData, nowMs: number, urgentWindowId: string | null = null): HTMLElement {
  const body = h('div', { class: 'providerBody', data: { provider: 'codex' } });

  // Identity (accountId) is intentionally not rendered here — the card header
  // owns identity disclosure and masks it in user mode.
  const planItems: HTMLElement[] = [];
  const plan = planLabel(data.planType);
  if (plan) planItems.push(metaValue('计划', plan));

  if (data.subscriptionActiveUntil !== null && Number.isFinite(data.subscriptionActiveUntil)) {
    const date = new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(data.subscriptionActiveUntil));
    planItems.push(metaValue('订阅至', date));
  }

  if (data.availableCreditCount > 0 || data.applicableAvailableCreditCount > 0) {
    planItems.push(metaValue('可用重置额度', String(data.availableCreditCount)));
  }

  if (planItems.length) {
    body.append(h('div', { class: 'planRow', children: planItems }));
  }

  if (data.creditDetailsError) {
    body.append(h('div', { class: 'quotaNotice', text: textOf(data.creditDetailsError) }));
  }

  if (data.windows.length === 0) {
    body.append(emptyWindowsNotice());
    return body;
  }

  for (const window of data.windows) {
    body.append(renderMeter({
      id: window.id,
      label: textOf(window.label) || 'Codex',
      remainingPercent: window.remainingPercent,
      resetAtMs: window.resetAtMs,
    }, nowMs, window.id === urgentWindowId));
  }
  return body;
}
