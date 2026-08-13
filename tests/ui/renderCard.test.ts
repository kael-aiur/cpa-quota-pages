import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderQuotaCard } from '../../src/ui/renderCard';
import type { CardHandlers, RenderOptions } from '../../src/ui/renderCard';
import type { AccountEntry } from '../../src/quota/types';
import type { CodexQuotaData } from '../../src/providers/codex/parser';
import type { QuotaLoadState } from '../../src/app/state';
import { buildAnonymousAccountLabel } from '../../src/quota/identity';

const NOW = Date.UTC(2026, 7, 13, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function secretEntry(provider: AccountEntry['provider'] = 'codex'): AccountEntry {
  return {
    id: 'secret-file.json',
    provider,
    file: {
      name: 'secret-file.json',
      provider,
      email: 'secret@example.com',
      account: 'secret@example.com',
      authIndex: 'idx-SECRET',
      id: 'acct-SECRET-123',
      projectId: 'proj-SECRET-456',
    },
  };
}

function userOptions(anonymousLabel: string, overrides: Partial<RenderOptions> = {}): RenderOptions {
  return {
    mode: 'user',
    revealAccountIdentity: false,
    canConsumeCodexReset: false,
    anonymousLabel,
    nowMs: NOW,
    ...overrides,
  };
}

function adminOptions(anonymousLabel: string, overrides: Partial<RenderOptions> = {}): RenderOptions {
  return {
    mode: 'admin',
    revealAccountIdentity: true,
    canConsumeCodexReset: true,
    anonymousLabel,
    nowMs: NOW,
    ...overrides,
  };
}

const idle: QuotaLoadState = { status: 'idle' };
const loading: QuotaLoadState = { status: 'loading' };

const successData: CodexQuotaData = {
  windows: [
    { id: 'rate-limit-5h-primary', label: 'Five-hour', usedPercent: 30, remainingPercent: 70, resetAtMs: NOW + 3 * HOUR, periodHours: 5 },
  ],
  accountId: 'acct-SECRET-123',
  planType: 'pro',
  subscriptionActiveUntil: NOW + 30 * 24 * HOUR,
  credits: [],
  availableCreditCount: 0,
  applicableAvailableCreditCount: 0,
};

function handlers(): CardHandlers {
  return { onQuery: vi.fn(), onReset: vi.fn() };
}

beforeEach(() => {
  delete (window as unknown as { __pwnedCard?: number }).__pwnedCard;
});

describe('renderQuotaCard load states', () => {
  it('renders an idle card that is not busy and offers a query action', async () => {
    const label = await buildAnonymousAccountLabel('codex', 'secret-file.json');
    const card = renderQuotaCard(secretEntry(), idle, userOptions(label), handlers());

    expect(card.getAttribute('data-state')).toBe('idle');
    expect(card.getAttribute('aria-busy')).toBe('false');
    expect(card.querySelector('[data-action="query"]')).not.toBeNull();
    expect(card.querySelector('.skeleton')).toBeNull();
  });

  it('marks the card aria-busy and shows a skeleton while loading', async () => {
    const label = await buildAnonymousAccountLabel('codex', 'secret-file.json');
    const card = renderQuotaCard(secretEntry(), loading, userOptions(label), handlers());

    expect(card.getAttribute('data-state')).toBe('loading');
    expect(card.getAttribute('aria-busy')).toBe('true');
    expect(card.querySelector('.skeleton')).not.toBeNull();
    const queryBtn = card.querySelector('[data-action="query"]') as HTMLButtonElement;
    expect(queryBtn.disabled).toBe(true);
  });

  it('renders provider meters on success and clears the busy state', async () => {
    const label = await buildAnonymousAccountLabel('codex', 'secret-file.json');
    const success: QuotaLoadState = { status: 'success', data: successData };
    const card = renderQuotaCard(secretEntry(), success, userOptions(label), handlers());

    expect(card.getAttribute('data-state')).toBe('success');
    expect(card.getAttribute('aria-busy')).toBe('false');
    expect(card.querySelectorAll('.quotaBar').length).toBe(1);
    const bar = card.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe('70');
  });

  it('renders error detail as inert text', async () => {
    const label = await buildAnonymousAccountLabel('codex', 'secret-file.json');
    const errored: QuotaLoadState = {
      status: 'error',
      error: { name: 'Error', message: '<img src=x onerror="window.__pwnedCard=1">' },
    };
    const card = renderQuotaCard(secretEntry(), errored, userOptions(label), handlers());

    expect(card.getAttribute('data-state')).toBe('error');
    expect(card.getAttribute('aria-busy')).toBe('false');
    expect(card.querySelectorAll('img').length).toBe(0);
    expect(card.textContent).toContain('<img src=x onerror="window.__pwnedCard=1">');
    expect((window as unknown as { __pwnedCard?: number }).__pwnedCard).toBeUndefined();
  });
});

describe('renderQuotaCard identity masking', () => {
  it('never leaks filename/email/authIndex/account/project id in user mode', async () => {
    const label = await buildAnonymousAccountLabel('codex', 'secret-file.json');
    const success: QuotaLoadState = { status: 'success', data: successData };
    const card = renderQuotaCard(secretEntry(), success, userOptions(label), handlers());

    const html = card.outerHTML;
    const text = card.textContent ?? '';
    for (const secret of ['secret-file.json', 'secret@example.com', 'idx-SECRET', 'acct-SECRET-123', 'proj-SECRET-456']) {
      expect(html, `leaked ${secret}`).not.toContain(secret);
      expect(text, `leaked ${secret}`).not.toContain(secret);
    }
    expect(text).toContain(label);
  });

  it('shows no reset button and wires no reset handler in user mode', async () => {
    const label = await buildAnonymousAccountLabel('codex', 'secret-file.json');
    const h = handlers();
    const card = renderQuotaCard(secretEntry(), idle, userOptions(label, { canConsumeCodexReset: true }), h);

    expect(card.querySelector('[data-action="reset"]')).toBeNull();
    card.querySelector('[data-action="query"]')?.dispatchEvent(new Event('click', { bubbles: true }));
    expect(h.onQuery).toHaveBeenCalledWith('secret-file.json');
    expect(h.onReset).not.toHaveBeenCalled();
  });

  it('reveals identity metadata in admin mode', async () => {
    const label = await buildAnonymousAccountLabel('codex', 'secret-file.json');
    const card = renderQuotaCard(secretEntry(), idle, adminOptions(label), handlers());

    const text = card.textContent ?? '';
    expect(text).toContain('secret@example.com');
    expect(text).toContain('idx-SECRET');
  });

  it('shows a reset action for Codex in admin mode and dispatches the handler', async () => {
    const label = await buildAnonymousAccountLabel('codex', 'secret-file.json');
    const h = handlers();
    const card = renderQuotaCard(secretEntry(), idle, adminOptions(label), h);

    const resetBtn = card.querySelector('[data-action="reset"]');
    expect(resetBtn).not.toBeNull();
    resetBtn?.dispatchEvent(new Event('click', { bubbles: true }));
    expect(h.onReset).toHaveBeenCalledWith('secret-file.json');
  });

  it('omits the reset action for non-Codex providers even as an admin', async () => {
    const label = await buildAnonymousAccountLabel('claude', 'secret-file.json');
    const card = renderQuotaCard(secretEntry('claude'), idle, adminOptions(label), handlers());
    expect(card.querySelector('[data-action="reset"]')).toBeNull();
  });
});

describe('renderQuotaCard admin meta status row', () => {
  it('reveals the auth-file status in admin mode when file.status is set', async () => {
    const label = await buildAnonymousAccountLabel('codex', 'secret-file.json');
    const entry: AccountEntry = {
      ...secretEntry(),
      file: { ...secretEntry().file, status: 'active' },
    };
    const card = renderQuotaCard(entry, idle, adminOptions(label), handlers());

    const meta = card.querySelector('.cardMeta');
    expect(meta).not.toBeNull();
    expect(meta?.textContent ?? '').toContain('active');
    // The status row should carry its own label/value pair, not just appear in the header.
    const rows = meta?.querySelectorAll('.cardMetaRow') ?? [];
    const statusRow = Array.from(rows).find((row) => (row.textContent ?? '').includes('active'));
    expect(statusRow, 'expected a dedicated status meta row').toBeDefined();
  });

  it('omits the status row when file.status is missing', async () => {
    const label = await buildAnonymousAccountLabel('codex', 'secret-file.json');
    const entry: AccountEntry = { ...secretEntry(), file: { ...secretEntry().file } };
    delete entry.file.status;
    const card = renderQuotaCard(entry, idle, adminOptions(label), handlers());

    const rows = card.querySelectorAll('.cardMetaRow');
    const statusRow = Array.from(rows).find((row) => (row.textContent ?? '').toLowerCase().includes('状态'));
    expect(statusRow, 'no status row should render when status is absent').toBeUndefined();
  });

  it('does not leak the status row into user mode', async () => {
    const label = await buildAnonymousAccountLabel('codex', 'secret-file.json');
    const entry: AccountEntry = {
      ...secretEntry(),
      file: { ...secretEntry().file, status: 'active' },
    };
    const card = renderQuotaCard(entry, idle, userOptions(label), handlers());

    expect(card.querySelector('.cardMeta')).toBeNull();
    expect(card.textContent ?? '').not.toContain('active');
  });
});
