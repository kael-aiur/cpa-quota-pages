/**
 * Provider body rendering.
 *
 * Each body consumes only the standardized, already-parsed quota types — it
 * never inspects raw CPA payloads and never renders account identity (the card
 * header owns identity). The shared meter renders a remaining-quota progressbar
 * whose status is carried by a text label + percent + colored mark, never color
 * alone (dataviz status rule).
 */

import type { Provider, RecentRequest } from '../providers/types';
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

interface RecentRequestBucket {
  time: string;
  success: number | null;
  failed: number | null;
}

function mergeRecentRequests(requests: readonly RecentRequest[]): RecentRequestBucket[] {
  const buckets = new Map<string, RecentRequestBucket>();
  for (const request of requests) {
    const existing = buckets.get(request.time);
    if (!existing) {
      buckets.set(request.time, { ...request });
      continue;
    }
    existing.success = existing.success === null || request.success === null ? null : existing.success + request.success;
    existing.failed = existing.failed === null || request.failed === null ? null : existing.failed + request.failed;
  }
  return Array.from(buckets.values());
}

function requestState(bucket: RecentRequestBucket): 'high' | 'medium' | 'low' | 'idle' | 'unknown' {
  if (bucket.success === null || bucket.failed === null) return 'unknown';
  const total = bucket.success + bucket.failed;
  if (total === 0) return 'idle';
  const rate = (bucket.success / total) * 100;
  if (rate > 80) return 'high';
  if (rate >= 30) return 'medium';
  return 'low';
}

function requestDetail(bucket: RecentRequestBucket, state: ReturnType<typeof requestState>): string {
  if (state === 'unknown') return `${bucket.time}：请求数据不完整，无法计算总请求数和成功率`;
  const total = (bucket.success ?? 0) + (bucket.failed ?? 0);
  if (state === 'idle') return `${bucket.time}：共 0 次请求，无请求，成功率无法计算`;
  const rate = Math.round(((bucket.success ?? 0) / total) * 100);
  const label = state === 'high' ? '成功率高' : state === 'medium' ? '成功率中等' : '成功率低';
  return `${bucket.time}：共 ${total} 次请求，成功 ${bucket.success}，失败 ${bucket.failed}，成功率 ${rate}%（${label}）`;
}

export function renderRecentRequests(requests: readonly RecentRequest[] | undefined): HTMLElement | null {
  if (requests === undefined) return null;
  if (requests.length === 0) {
    return h('section', {
      class: 'recentRequests',
      aria: { label: '近期请求' },
      children: [h('span', { class: 'recentRequestsEmpty', text: '近期请求：暂无记录' })],
    });
  }
  const strip = h('div', { class: 'recentRequestsStrip', attrs: { role: 'list' } });
  for (const bucket of mergeRecentRequests(requests)) {
    const state = requestState(bucket);
    const detail = requestDetail(bucket, state);
    strip.append(h('span', {
      class: `recentRequestCell is-${state}`,
      attrs: { role: 'listitem', tabindex: '0', title: detail },
      aria: { label: detail },
      data: { state },
    }));
  }
  return h('section', {
    class: 'recentRequests',
    aria: { label: '近期请求' },
    children: [
      h('div', {
        class: 'recentRequestsHeader',
        children: [
          h('span', { class: 'recentRequestsTitle', text: '近期请求' }),
          h('span', { class: 'recentRequestsHint', text: '每格 10 分钟' }),
        ],
      }),
      strip,
    ],
  });
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
