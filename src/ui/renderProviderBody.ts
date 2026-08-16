/**
 * Provider body rendering.
 *
 * Each body consumes only the standardized, already-parsed quota types — it
 * never inspects raw CPA payloads and never renders account identity (the card
 * header owns identity). The shared meter renders a remaining-quota progressbar
 * whose status is carried by a text label + percent + colored mark, never color
 * alone (dataviz status rule).
 */

import type { Provider } from '../providers/types';
import type { ProviderQuotaResult } from '../app/state';
import type { ClaudeQuotaData } from '../providers/claude/types';
import type { AntigravityQuotaData } from '../providers/antigravity/parser';
import type { CodexQuotaData } from '../providers/codex/parser';
import type { KimiQuotaData } from '../providers/kimi/parser';
import type { XaiQuotaData } from '../providers/xai/parser';
import { formatResetLabel } from '../quota/relativeTime';
import {
  TIER_LABEL,
  clampPercent,
  h,
  remainingTier,
  type QuotaTier,
} from './dom';
import { buildClaudeBody } from './providerBodies/claude';
import { buildAntigravityBody } from './providerBodies/antigravity';
import { buildCodexBody } from './providerBodies/codex';
import { buildKimiBody } from './providerBodies/kimi';
import { buildXaiBody } from './providerBodies/xai';

export interface MeterInput {
  id: string;
  label: string;
  remainingPercent: number | null;
  resetAtMs: number | null;
}

export function renderMeter(input: MeterInput, nowMs: number, urgent = false): HTMLElement {
  const remaining = clampPercent(input.remainingPercent);
  const tier: QuotaTier = remainingTier(remaining);
  const known = remaining !== null;
  const percentText = known ? `剩余 ${Math.round(remaining)}%` : '剩余 --';
  const valueText = known
    ? `剩余 ${Math.round(remaining)}%，${TIER_LABEL[tier]}${urgent ? '，即将恢复' : ''}`
    : `剩余未知，${TIER_LABEL[tier]}${urgent ? '，即将恢复' : ''}`;

  const fill = h('div', { class: `quotaBarFill ${tier}` });
  if (known) fill.style.width = `${Math.round(remaining * 100) / 100}%`;

  const bar = h('div', {
    class: 'quotaBar',
    attrs: {
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      ...(known ? { 'aria-valuenow': String(Math.round(remaining)) } : {}),
      'aria-valuetext': valueText,
    },
    children: [fill],
  });

  const status = h('span', {
    class: 'quotaStatus',
    children: [
      h('span', { class: `quotaDot ${tier}`, aria: { hidden: 'true' } }),
      h('span', { class: 'quotaStatusLabel', text: TIER_LABEL[tier] }),
    ],
  });

  const metaChildren: HTMLElement[] = [
    status,
    h('span', { class: 'quotaPercent', text: percentText }),
  ];
  // Spec §7.1 urgent emphasis: the TEXT badge is the primary channel (the
  // emphasis class only reinforces it) so urgency is never color-alone.
  if (urgent) {
    metaChildren.push(h('span', { class: 'urgentBadge', text: '即将恢复' }));
  }
  if (input.resetAtMs !== null && Number.isFinite(input.resetAtMs)) {
    const resetText = formatResetLabel(input.resetAtMs, nowMs);
    metaChildren.push(h('span', { class: 'quotaReset', text: resetText, title: resetText }));
  }

  return h('div', {
    class: urgent ? 'quotaRow urgent' : 'quotaRow',
    data: { windowId: input.id, tier },
    ...(urgent ? { aria: { label: '即将恢复' } } : {}),
    children: [
      h('div', {
        class: 'quotaRowHeader',
        children: [
          h('span', { class: 'quotaModel', text: input.label }),
          h('div', { class: 'quotaMeta', children: metaChildren }),
        ],
      }),
      bar,
    ],
  });
}

/** Build an empty-state notice when a provider exposes no usable windows. */
export function emptyWindowsNotice(): HTMLElement {
  return h('div', { class: 'quotaMessage', text: '暂无用量窗口数据' });
}

export function renderProviderBody(
  provider: Provider,
  data: ProviderQuotaResult,
  nowMs: number,
  urgentWindowId: string | null = null,
): HTMLElement {
  switch (provider) {
    case 'claude':
      return buildClaudeBody(data as ClaudeQuotaData, nowMs, urgentWindowId);
    case 'antigravity':
      return buildAntigravityBody(data as AntigravityQuotaData, nowMs, urgentWindowId);
    case 'codex':
      return buildCodexBody(data as CodexQuotaData, nowMs, urgentWindowId);
    case 'kimi':
      return buildKimiBody(data as KimiQuotaData, nowMs, urgentWindowId);
    case 'xai':
      return buildXaiBody(data as XaiQuotaData, nowMs, urgentWindowId);
  }
}
