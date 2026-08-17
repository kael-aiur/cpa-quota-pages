import { describe, expect, it } from 'vitest';
import { renderProviderBody, renderRecentRequests } from '../../src/ui/renderProviderBody';
import type { ClaudeQuotaData } from '../../src/providers/claude/types';
import type { AntigravityQuotaData } from '../../src/providers/antigravity/parser';
import type { CodexQuotaData } from '../../src/providers/codex/parser';
import type { KimiQuotaData } from '../../src/providers/kimi/parser';
import type { XaiQuotaData } from '../../src/providers/xai/parser';

const NOW = Date.UTC(2026, 7, 13, 12, 0, 0); // 2026-08-13T12:00:00Z
const HOUR = 60 * 60 * 1000;

function fillTier(row: Element): string {
  const fill = row.querySelector('.quotaBarFill');
  if (!fill) throw new Error('missing fill');
  const classes = ['high', 'medium', 'low', 'unknown'];
  return classes.find((name) => fill.classList.contains(name)) ?? '';
}

function progressbar(row: Element): HTMLElement {
  const bar = row.querySelector('[role="progressbar"]');
  if (!bar) throw new Error('missing progressbar');
  return bar as HTMLElement;
}

describe('renderProviderBody meter semantics', () => {
  it('applies 70/30 status tiers to remaining quota and labels them in text', () => {
    const data: ClaudeQuotaData = {
      windows: [
        { id: 'w-high', label: 'Five-hour', usedPercent: 20, remainingPercent: 80, resetAtMs: NOW + 3 * HOUR, periodHours: 5 },
        { id: 'w-mid', label: 'Seven-day', usedPercent: 50, remainingPercent: 50, resetAtMs: NOW + 24 * HOUR, periodHours: 168 },
        { id: 'w-low', label: 'Opus', usedPercent: 85, remainingPercent: 15, resetAtMs: NOW + 48 * HOUR, periodHours: 168 },
        { id: 'w-unknown', label: 'Cowork', usedPercent: null, remainingPercent: null, resetAtMs: null, periodHours: null },
      ],
      extraUsage: null,
      planType: null,
    };

    const body = renderProviderBody('claude', data, NOW);
    const rows = body.querySelectorAll('.quotaRow');
    expect(rows).toHaveLength(4);

    expect(fillTier(rows[0])).toBe('high');
    expect(fillTier(rows[1])).toBe('medium');
    expect(fillTier(rows[2])).toBe('low');
    expect(fillTier(rows[3])).toBe('unknown');

    const healthy = progressbar(rows[0]);
    expect(healthy.getAttribute('aria-valuenow')).toBe('80');
    expect(healthy.getAttribute('aria-valuemin')).toBe('0');
    expect(healthy.getAttribute('aria-valuemax')).toBe('100');
    expect(healthy.getAttribute('aria-valuetext')).toContain('80');
    expect(healthy.getAttribute('aria-valuetext')).toContain('充足');
    expect(rows[0].textContent).toContain('充足');
    expect(rows[0].textContent).toContain('剩余 80%');

    const unknown = progressbar(rows[3]);
    expect(unknown.hasAttribute('aria-valuenow')).toBe(false);
    expect(rows[3].textContent).toContain('未知');
    const unknownFill = rows[3].querySelector('.quotaBarFill') as HTMLElement;
    expect(unknownFill.style.width).toBe('');
  });

  it('renders dynamic upstream text as inert text, never executable markup', () => {
    const markup = '<img src=x onerror="window.__pwnedBody=1">';
    const data: ClaudeQuotaData = {
      windows: [
        { id: 'w', label: markup, usedPercent: 10, remainingPercent: 90, resetAtMs: NOW + HOUR, periodHours: 5 },
      ],
      extraUsage: null,
      planType: null,
    };

    const body = renderProviderBody('claude', data, NOW);

    expect(body.querySelectorAll('img').length).toBe(0);
    expect(body.textContent).toContain(markup);
    expect((window as unknown as { __pwnedBody?: number }).__pwnedBody).toBeUndefined();
  });
});

describe('renderProviderBody recent requests', () => {
  it('renders 10-minute request blocks with totals and success-rate labels', () => {
    const data: ClaudeQuotaData = {
      windows: [],
      extraUsage: null,
      planType: null,
      recentRequests: [
        { time: '20:00-20:10', success: 8, failed: 1 },
        { time: '20:10-20:20', success: 2, failed: 8 },
        { time: '20:20-20:30', success: 0, failed: 0 },
      ],
    };
    const body = renderRecentRequests(data.recentRequests);
    if (!body) throw new Error('missing recent request body');
    const cells = body.querySelectorAll('.recentRequestCell');
    expect(cells).toHaveLength(3);
    expect(cells[0].getAttribute('data-state')).toBe('high');
    expect(cells[1].getAttribute('data-state')).toBe('low');
    expect(cells[2].getAttribute('data-state')).toBe('idle');
    expect(cells[0].getAttribute('title')).toContain('共 9 次请求');
    expect(cells[0].getAttribute('title')).toContain('成功率 89%');
    expect(cells[2].getAttribute('title')).toContain('无请求');
  });

  it('keeps incomplete request counts explicitly uncomputable', () => {
    const data: KimiQuotaData = {
      windows: [],
      recentRequests: [{ time: '22:00-22:10', success: null, failed: 2 }],
    };
    const body = renderRecentRequests(data.recentRequests);
    if (!body) throw new Error('missing recent request body');
    const cell = body.querySelector('.recentRequestCell');
    expect(cell?.getAttribute('data-state')).toBe('unknown');
    expect(cell?.getAttribute('aria-label')).toContain('无法计算');
  });

  it('does not render the strip when the provider omits recent requests', () => {
    const body = renderProviderBody('codex', {
      windows: [], accountId: null, planType: null, subscriptionActiveUntil: null,
      credits: [], availableCreditCount: 0, applicableAvailableCreditCount: 0,
    }, NOW);
    expect(body.querySelector('.recentRequests')).toBeNull();
  });
});

describe('renderProviderBody provider details', () => {
  it('renders Claude plan, extra usage and windows', () => {
    const data: ClaudeQuotaData = {
      windows: [
        { id: 'five-hour', label: 'Five-hour', usedPercent: 25, remainingPercent: 75, resetAtMs: NOW + 3 * HOUR, periodHours: 5 },
      ],
      extraUsage: { is_enabled: true, monthly_limit: 200, used_credits: 25, utilization: 12.5 },
      planType: 'plan_pro',
    };

    const body = renderProviderBody('claude', data, NOW);

    expect(body.getAttribute('data-provider')).toBe('claude');
    expect(body.querySelectorAll('.quotaBar').length).toBe(1);
    expect(body.textContent).toContain('200');
    expect(body.textContent).toContain('25');
    expect(body.textContent).toContain('Pro');
  });

  it('renders Antigravity groups and subscription without leaking the project id', () => {
    const data: AntigravityQuotaData = {
      groups: [
        {
          id: 'core',
          label: 'Core',
          buckets: [
            { id: 'core-5h', label: '5h', window: '5h', remainingFraction: 0.8, resetTime: null, resetAtMs: NOW + 3 * HOUR, periodHours: 5 },
            { id: 'core-week', label: 'Weekly', window: 'weekly', remainingFraction: 0.1, resetTime: null, resetAtMs: NOW + 24 * HOUR, periodHours: 168 },
          ],
        },
      ],
      subscription: { plan: 'pro', tierId: 'g1-pro-tier', tierName: 'Pro' },
      serverTimeOffsetMs: 1234,
    };

    const body = renderProviderBody('antigravity', data, NOW);

    expect(body.getAttribute('data-provider')).toBe('antigravity');
    expect(body.querySelectorAll('.quotaBar').length).toBe(2);
    const rows = body.querySelectorAll('.quotaRow');
    expect(fillTier(rows[0])).toBe('high');
    expect(fillTier(rows[1])).toBe('low');
    expect(body.textContent).toContain('Core');
    expect(body.textContent).toContain('Pro');
  });

  it('renders Codex credits and plan but never the account id', () => {
    const data: CodexQuotaData = {
      windows: [
        { id: 'rate-limit-5h-primary', label: 'Five-hour', usedPercent: 40, remainingPercent: 60, resetAtMs: NOW + 2 * HOUR, periodHours: 5 },
      ],
      accountId: 'acct-secret-123',
      planType: 'pro',
      subscriptionActiveUntil: NOW + 30 * 24 * HOUR,
      credits: [
        { id: 'c1', resetType: 'codex_rate_limits', status: 'available', grantedAtMs: NOW, expiresAtMs: NOW + 24 * HOUR },
      ],
      availableCreditCount: 1,
      applicableAvailableCreditCount: 1,
    };

    const body = renderProviderBody('codex', data, NOW);

    expect(body.getAttribute('data-provider')).toBe('codex');
    expect(body.textContent).toContain('Pro');
    expect(body.textContent).toContain('1');
    expect(body.textContent).not.toContain('acct-secret-123');
  });

  it('surfaces Codex credit-detail errors as inert text', () => {
    const data: CodexQuotaData = {
      windows: [],
      accountId: null,
      planType: null,
      subscriptionActiveUntil: null,
      credits: [],
      availableCreditCount: 0,
      applicableAvailableCreditCount: 0,
      creditDetailsError: '<b>upstream</b> failed',
    };

    const body = renderProviderBody('codex', data, NOW);

    expect(body.textContent).toContain('<b>upstream</b> failed');
    expect(body.querySelectorAll('b').length).toBe(0);
  });

  it('renders Kimi used/limit figures alongside the meter', () => {
    const data: KimiQuotaData = {
      windows: [
        { id: 'limit-0', label: 'Daily', used: 40, limit: 100, usedPercent: 40, remainingPercent: 60, resetAtMs: NOW + 12 * HOUR, periodHours: 24 },
      ],
    };

    const body = renderProviderBody('kimi', data, NOW);

    expect(body.getAttribute('data-provider')).toBe('kimi');
    expect(body.querySelectorAll('.quotaBar').length).toBe(1);
    expect(body.textContent).toContain('40');
    expect(body.textContent).toContain('100');
  });

  it('renders xAI billing period and product usage', () => {
    const data: XaiQuotaData = {
      windows: [
        { id: 'xai-weekly', label: 'Weekly', usedPercent: 30, remainingPercent: 70, resetAtMs: NOW + 24 * HOUR, periodHours: 168 },
      ],
      billing: {
        mode: 'billing',
        periodType: 'weekly',
        usagePercent: 30,
        productUsage: [{ product: 'Grok', usagePercent: 30 }],
        monthlyLimitCents: null,
        usedCents: null,
        includedUsedCents: null,
        onDemandCapCents: null,
        onDemandUsedCents: null,
        onDemandUsedPercent: null,
        usedPercent: 30,
        resetAtMs: NOW + 24 * HOUR,
        periodHours: 168,
      },
    };

    const body = renderProviderBody('xai', data, NOW);

    expect(body.getAttribute('data-provider')).toBe('xai');
    expect(body.querySelectorAll('.quotaBar').length).toBe(1);
    expect(body.textContent).toContain('Grok');
  });

  it('renders a graceful empty state when a provider has no windows', () => {
    const data: KimiQuotaData = { windows: [] };
    const body = renderProviderBody('kimi', data, NOW);
    expect(body.textContent).toContain('暂无');
    expect(body.querySelectorAll('.quotaBar').length).toBe(0);
  });
});
