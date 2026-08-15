import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AuthenticatedSession } from '../../src/auth/types';
import type { ApiCallResult, AuthFile, CpaApi } from '../../src/api/types';
import { createQuotaApp } from '../../src/app/createQuotaApp';
import { createResetRequestHandler, RESET_BUTTON_LABEL } from '../../src/admin/resetFlow';
import type { CodexResetCapability } from '../../src/app/types';
import type { MinuteClock } from '../../src/quota/minuteClock';
import type { ProviderQuery, ProviderQuotaResult } from '../../src/providers/types';

const NOW = Date.UTC(2026, 7, 13, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function tokenUrl(query = 'token=secret'): URL {
  return new URL(`http://localhost/quota.html?${query}`);
}

function mount(): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  return root;
}

function fakeMedia(): MediaQueryList {
  return { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList;
}

function fakeClock(start = NOW): MinuteClock & { tick(): void; listeners: Set<() => void> } {
  const listeners = new Set<() => void>();
  let snapshot = start;
  return {
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => snapshot,
    destroy: vi.fn(() => listeners.clear()),
    tick: () => {
      snapshot += 60 * 1000;
      listeners.forEach((l) => l());
    },
    listeners,
  } as unknown as MinuteClock & { tick(): void; listeners: Set<() => void> };
}

function fakeSession(overrides: Partial<AuthenticatedSession> = {}): AuthenticatedSession {
  const controller = new AbortController();
  return {
    user: { id: 1, status: 'active' },
    request: vi.fn(async () => okJson({})),
    signal: controller.signal,
    invalidate: vi.fn((reason: string) => controller.abort(new Error(reason))),
    destroy: vi.fn(() => controller.abort(new Error('destroyed'))),
    ...overrides,
  };
}

function claudeFile(name: string): AuthFile {
  return { name, provider: 'claude' };
}
function kimiFile(name: string): AuthFile {
  return { name, provider: 'kimi' };
}
function codexFile(name: string): AuthFile {
  return { name, provider: 'codex', authIndex: '1' };
}

function mockCount(fn: unknown): number {
  return ((fn as { mock?: { calls: unknown[] } }).mock?.calls.length) ?? 0;
}

function fakeApi(files: AuthFile[], apiCallImpl?: CpaApi['apiCall']): CpaApi {
  return {
    listAuthFiles: vi.fn(async () => files),
    downloadAuthFile: vi.fn(async () => ''),
    apiCall: vi.fn(apiCallImpl ?? (async () => ({ statusCode: 200, header: {}, bodyText: '', body: null }) as ApiCallResult)) as CpaApi['apiCall'],
  };
}

/** Minimal claude provider query that records one apiCall per account. */
function claudeQuery(calls: string[], mode: 'ok' | 'throw-a' = 'ok', failName = 'a.json'): ProviderQuery {
  return async (file, context) => {
    calls.push(`q:${file.name}`);
    if (mode === 'throw-a' && file.name === failName) throw new Error('claude failed');
    await context.apiCall({ authIndex: file.name, method: 'GET', url: 'https://x', header: {} });
    return {
      windows: [{ id: file.name, label: file.name, usedPercent: 10, remainingPercent: 90, resetAtMs: NOW + HOUR, periodHours: 5 }],
    } as ProviderQuotaResult;
  };
}

const roots: HTMLElement[] = [];

afterEach(() => {
  for (const root of roots) root.remove();
  roots.length = 0;
  document.body.innerHTML = '';
  sessionStorage.clear(); // UI preference persistence must not leak across tests
});

function newRoot(): HTMLElement {
  const root = mount();
  roots.push(root);
  return root;
}

async function startApp(opts: Parameters<typeof createQuotaApp>[0]) {
  const app = createQuotaApp(opts);
  await app.start();
  return app;
}

describe('createQuotaApp orchestration', () => {
  it('authenticates before loading auth-files and makes no api-call on start', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('/api/v1/auth/me')) return okJson({ code: 0, data: { id: 7, status: 'active' } });
      if (url.includes('/auth-files')) return okJson({ files: [claudeFile('a.json')] });
      return okJson({});
    });
    const root = newRoot();
    const app = createQuotaApp({
      root, mode: 'user', revealAccountIdentity: false,
      url: tokenUrl(), fetchImpl: fetchImpl as unknown as typeof fetch, media: fakeMedia(), clock: fakeClock(),
    });
    await app.start();

    const authMeIndex = calls.findIndex((c) => c.endsWith('/api/v1/auth/me'));
    const authFilesIndex = calls.findIndex((c) => c.includes('/auth-files'));
    expect(authMeIndex).toBeGreaterThanOrEqual(0);
    expect(authFilesIndex).toBeGreaterThan(authMeIndex);
    expect(calls.some((c) => c.includes('/api-call'))).toBe(false);
    app.destroy();
  });

  it('renders an auth-error gate when bootstrap fails', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/v1/auth/me')) return okJson({ code: 1001, message: 'no' }, 200);
      return okJson({});
    });
    const root = newRoot();
    const app = createQuotaApp({
      root, mode: 'user', revealAccountIdentity: false,
      url: tokenUrl(), fetchImpl: fetchImpl as unknown as typeof fetch, media: fakeMedia(), clock: fakeClock(),
    });
    await expect(app.start()).rejects.toThrow('1001');
    expect(root.textContent).toContain('身份');
    app.destroy();
  });

  it('renders accounts and tab counts after start', async () => {
    const files = [claudeFile('c1.json'), claudeFile('c2.json'), kimiFile('k1.json')];
    const root = newRoot();
    const app = await startApp({
      root, mode: 'user', revealAccountIdentity: false,
      session: fakeSession(), api: fakeApi(files), media: fakeMedia(), clock: fakeClock(),
    });

    const tabs = root.querySelectorAll('[role="tab"][data-provider]');
    expect(tabs.length).toBeGreaterThanOrEqual(3); // all + claude + kimi
    expect(root.querySelector('[data-provider="all"]')?.textContent).toContain('3');
    expect(root.querySelector('[data-provider="claude"]')?.textContent).toContain('2');
    expect(root.querySelector('[data-provider="kimi"]')?.textContent).toContain('1');
    expect(root.querySelectorAll('.card').length).toBe(3);
    app.destroy();
  });

  it('switching a provider tab filters the visible cards', async () => {
    const files = [claudeFile('c1.json'), kimiFile('k1.json')];
    const root = newRoot();
    const app = await startApp({
      root, mode: 'user', revealAccountIdentity: false,
      session: fakeSession(), api: fakeApi(files), media: fakeMedia(), clock: fakeClock(),
    });

    root.querySelector<HTMLElement>('[data-provider="kimi"]')!.click();
    const names = Array.from(root.querySelectorAll('.fileName')).map((e) => e.textContent);
    expect(names.some((n) => n?.includes('Kimi'))).toBe(true);
    expect(names.some((n) => n?.includes('Claude'))).toBe(false);
    app.destroy();
  });

  it('resets the current page to 1 when the provider tab changes', async () => {
    const files = Array.from({ length: 22 }, (_, i) => claudeFile(`c${i}.json`))
      .concat([kimiFile('k0.json')]);
    const root = newRoot();
    const app = await startApp({
      root, mode: 'user', revealAccountIdentity: false,
      session: fakeSession(), api: fakeApi(files), media: fakeMedia(), clock: fakeClock(), pageSize: 10,
    });

    // Move to page 2 on the "all" tab.
    root.querySelector<HTMLElement>('[data-action="page-next"]')!.click();
    expect(root.querySelector('[data-role="page-status"]')?.textContent).toContain('2');

    // Switching to kimi (1 account) must clamp/reset to page 1.
    root.querySelector<HTMLElement>('[data-provider="kimi"]')!.click();
    expect(root.querySelector('[data-role="page-status"]')?.textContent).toContain('1');
    app.destroy();
  });

  it('resets the current page to 1 when the sort mode changes', async () => {
    const files = Array.from({ length: 12 }, (_, i) => claudeFile(`c${i}.json`));
    const root = newRoot();
    const app = await startApp({
      root, mode: 'user', revealAccountIdentity: false,
      session: fakeSession(), api: fakeApi(files), media: fakeMedia(), clock: fakeClock(), pageSize: 10,
    });

    root.querySelector<HTMLElement>('[data-action="page-next"]')!.click();
    expect(root.querySelector('[data-role="page-status"]')?.textContent).toContain('2');
    root.querySelector<HTMLElement>('.sortTab[data-sort="soonest"]')!.click();
    expect(root.querySelector('[data-role="page-status"]')?.textContent).toContain('1');
    app.destroy();
  });

  it('clamps the page when a narrower provider shrinks the page count', async () => {
    const files = Array.from({ length: 12 }, (_, i) => claudeFile(`c${i}.json`))
      .concat([kimiFile('k0.json')]);
    const root = newRoot();
    const app = await startApp({
      root, mode: 'user', revealAccountIdentity: false,
      session: fakeSession(), api: fakeApi(files), media: fakeMedia(), clock: fakeClock(), pageSize: 10,
    });

    // all tab: 2 pages; go to page 2.
    root.querySelector<HTMLElement>('[data-action="page-next"]')!.click();
    expect(root.querySelector('[data-role="page-status"]')?.textContent).toContain('2');
    // kimi has 1 account → 1 page; page must clamp to 1.
    root.querySelector<HTMLElement>('[data-provider="kimi"]')!.click();
    expect(root.querySelector('[data-role="page-status"]')?.textContent).toContain('1');
    app.destroy();
  });

  it('refreshing the account list issues no quota api-call', async () => {
    const files = [claudeFile('c1.json'), claudeFile('c2.json')];
    const api = fakeApi(files);
    const root = newRoot();
    const app = await startApp({
      root, mode: 'user', revealAccountIdentity: false,
      session: fakeSession(), api, media: fakeMedia(), clock: fakeClock(),
    });
    const before = mockCount(api.apiCall);
    root.querySelector<HTMLElement>('[data-action="refresh-accounts"]')!.click();
    await vi.waitFor(() => expect(mockCount(api.listAuthFiles)).toBeGreaterThanOrEqual(2));
    expect(mockCount(api.apiCall)).toBe(before);
    app.destroy();
  });

  it('queries every visible account in batches of at most the page size (max 20)', async () => {
    const files = Array.from({ length: 25 }, (_, i) => claudeFile(`c${i}.json`));
    const api = fakeApi(files);
    const calls: string[] = [];
    const root = newRoot();
    const app = await startApp({
      root, mode: 'user', revealAccountIdentity: false,
      session: fakeSession(), api, media: fakeMedia(), clock: fakeClock(),
      providerQueries: { claude: claudeQuery(calls) },
    });

    root.querySelector<HTMLElement>('[data-action="query-all"]')!.click();
    await vi.waitFor(
      () => expect(mockCount(api.apiCall)).toBe(25),
      { timeout: 15000, interval: 50 },
    );
    // No card should be in an error state from a RangeError batch overflow.
    const states = Array.from(root.querySelectorAll('.card')).map((c) => c.getAttribute('data-state'));
    expect(states).not.toContain('error');
    app.destroy();
  }, 20000);

  it('isolates a single card failure from successful siblings', async () => {
    const files = [claudeFile('a.json'), claudeFile('b.json'), kimiFile('k.json')];
    const api = fakeApi(files);
    const calls: string[] = [];
    const root = newRoot();
    const app = await startApp({
      root, mode: 'user', revealAccountIdentity: false,
      session: fakeSession(), api, media: fakeMedia(), clock: fakeClock(),
      providerQueries: { claude: claudeQuery(calls, 'throw-a'), kimi: claudeQuery(calls) },
    });

    root.querySelector<HTMLElement>('[data-action="query-all"]')!.click();
    await vi.waitFor(() => {
      const errorCards = root.querySelectorAll('.card[data-state="error"]').length;
      const successCards = root.querySelectorAll('.card[data-state="success"]').length;
      expect(errorCards + successCards).toBe(3);
    });
    expect(root.querySelectorAll('.card[data-state="error"]').length).toBe(1);
    expect(root.querySelectorAll('.card[data-state="success"]').length).toBe(2);
    app.destroy();
  });

  it('renders stats totals for the account set', async () => {
    const files = [claudeFile('c1.json'), claudeFile('c2.json'), kimiFile('k1.json')];
    const root = newRoot();
    const app = await startApp({
      root, mode: 'user', revealAccountIdentity: false,
      session: fakeSession(), api: fakeApi(files), media: fakeMedia(), clock: fakeClock(),
    });
    const stats = root.querySelector('[data-role="stats"]')!.textContent!;
    expect(stats).toContain('3');
    app.destroy();
  });

  it('hides quota and shows an invalid-auth gate when the session is invalidated', async () => {
    const files = [claudeFile('c1.json')];
    const session = fakeSession();
    const root = newRoot();
    const app = await startApp({
      root, mode: 'user', revealAccountIdentity: false,
      session, api: fakeApi(files), media: fakeMedia(), clock: fakeClock(),
    });
    expect(root.querySelectorAll('.card').length).toBe(1);
    session.invalidate!('身份认证失败 (401)');
    await vi.waitFor(() => expect(root.querySelectorAll('.card').length).toBe(0));
    expect(root.textContent).toContain('失效');
    app.destroy();
  });

  it('destroys the clock, aborts in-flight work, clears the DOM and is idempotent', async () => {
    const files = [claudeFile('c1.json')];
    const api = fakeApi(files);
    const clock = fakeClock();
    let release!: () => void;
    const root = newRoot();
    const app = await startApp({
      root, mode: 'user', revealAccountIdentity: false,
      session: fakeSession(), api, media: fakeMedia(), clock,
      providerQueries: {
        claude: async (_f, ctx) => new Promise((_resolve, reject) => {
          release = () => reject(new Error('done'));
          ctx.signal?.addEventListener('abort', () => reject(ctx.signal?.reason), { once: true });
        }),
      },
    });
    root.querySelector<HTMLElement>('[data-action="query-all"]')!.click();
    await vi.waitFor(() => expect(root.querySelectorAll('.card[data-state="loading"]').length).toBe(1));

    app.destroy();
    expect(clock.destroy).toHaveBeenCalledTimes(1);
    expect(root.children.length).toBe(0);
    // In-flight query was aborted (no apiCall resolved into success state).
    release();
    await Promise.resolve();
    expect(root.children.length).toBe(0);
    // Idempotent: second destroy must not throw and must not double-call clock.destroy.
    expect(() => app.destroy()).not.toThrow();
    expect(clock.destroy).toHaveBeenCalledTimes(1);
  });

  it('admin reset opens a confirm dialog and consumes the reset capability on confirm', async () => {
    const file = codexFile('codex.json');
    const files = [file];
    const consume = vi.fn<CodexResetCapability>(async () => ({
      windows: [{ id: 'rate-limit-5h-primary', label: 'Five-hour', usedPercent: 0, remainingPercent: 100, resetAtMs: NOW + HOUR, periodHours: 5 }],
      accountId: 'acct-1', planType: 'pro', subscriptionActiveUntil: NOW, credits: [], availableCreditCount: 0, applicableAvailableCreditCount: 0,
    }) as never);
    const api = fakeApi(files);
    const root = newRoot();
    const app = await startApp({
      root, mode: 'admin', revealAccountIdentity: true,
      onResetRequest: createResetRequestHandler({
        capability: (bridge) => consume(bridge.account.file, bridge.context),
        resolveTrigger: () => document.activeElement instanceof HTMLElement ? document.activeElement : root,
      }),
      resetButtonLabel: RESET_BUTTON_LABEL,
      session: fakeSession(), api, media: fakeMedia(), clock: fakeClock(),
    });

    root.querySelector<HTMLElement>('[data-action="reset"]')!.click();
    const dialog = document.querySelector('.confirmDialog');
    expect(dialog).not.toBeNull();
    document.querySelector<HTMLElement>('[data-action="confirm"]')!.click();
    await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(1));
    expect(consume.mock.calls[0][0]).toStrictEqual(file);
    app.destroy();
  });

  it('catches the confirm dialog rejection so reset failures never escape as unhandled', async () => {
    const file = codexFile('codex.json');
    const consume = vi.fn<CodexResetCapability>(async () => { throw new Error('consume failed'); });
    const unhandled: unknown[] = [];
    const handler = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', handler);
    const root = newRoot();
    try {
      const app = await startApp({
        root, mode: 'admin', revealAccountIdentity: true,
        onResetRequest: createResetRequestHandler({
          capability: (bridge) => consume(bridge.account.file, bridge.context),
          resolveTrigger: () => document.activeElement instanceof HTMLElement ? document.activeElement : root,
        }),
        resetButtonLabel: RESET_BUTTON_LABEL,
        session: fakeSession(), api: fakeApi([file]), media: fakeMedia(), clock: fakeClock(),
      });
      root.querySelector<HTMLElement>('[data-action="reset"]')!.click();
      document.querySelector<HTMLElement>('[data-action="confirm"]')!.click();
      await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(1));
      // Allow the dialog.closed rejection microtask to settle.
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled.length).toBe(0);
      app.destroy();
    } finally {
      process.off('unhandledRejection', handler);
    }
  });
});

describe('createQuotaApp UI preference persistence', () => {
  const key = 'cpaQuota.uiState';

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('honors a pre-seeded provider and sort mode on start', async () => {
    sessionStorage.setItem(key, JSON.stringify({ provider: 'kimi', sortMode: 'soonest' }));
    const files = [claudeFile('c1.json'), kimiFile('k1.json')];
    const root = newRoot();
    const app = await startApp({
      root, mode: 'user', revealAccountIdentity: false,
      session: fakeSession(), api: fakeApi(files), media: fakeMedia(), clock: fakeClock(),
    });

    expect(root.querySelector<HTMLElement>('[data-provider="kimi"]')?.getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector<HTMLElement>('[data-provider="all"]')?.getAttribute('aria-selected')).toBe('false');
    expect(root.querySelector<HTMLElement>('.sortTab[data-sort="soonest"]')?.getAttribute('aria-pressed')).toBe('true');
    // Provider filter applies from the first render.
    expect(root.querySelectorAll('.card').length).toBe(1);
    app.destroy();
  });

  it('writes the provider selection to sessionStorage when a tab is clicked', async () => {
    const files = [claudeFile('c1.json'), kimiFile('k1.json')];
    const root = newRoot();
    const app = await startApp({
      root, mode: 'user', revealAccountIdentity: false,
      session: fakeSession(), api: fakeApi(files), media: fakeMedia(), clock: fakeClock(),
    });

    root.querySelector<HTMLElement>('[data-provider="kimi"]')!.click();
    expect(JSON.parse(sessionStorage.getItem(key) ?? 'null')).toEqual({ provider: 'kimi' });
    app.destroy();
  });

  it('writes the sort mode to sessionStorage when a sort tab is clicked', async () => {
    const files = [claudeFile('c1.json')];
    const root = newRoot();
    const app = await startApp({
      root, mode: 'user', revealAccountIdentity: false,
      session: fakeSession(), api: fakeApi(files), media: fakeMedia(), clock: fakeClock(),
    });

    root.querySelector<HTMLElement>('.sortTab[data-sort="soonest"]')!.click();
    expect(JSON.parse(sessionStorage.getItem(key) ?? 'null')).toEqual({ sortMode: 'soonest' });
    app.destroy();
  });

  it('keeps both preferences across a simulated reload', async () => {
    const files = [claudeFile('c1.json'), kimiFile('k1.json')];
    const root = newRoot();
    const app = await startApp({
      root, mode: 'user', revealAccountIdentity: false,
      session: fakeSession(), api: fakeApi(files), media: fakeMedia(), clock: fakeClock(),
    });
    root.querySelector<HTMLElement>('[data-provider="kimi"]')!.click();
    root.querySelector<HTMLElement>('.sortTab[data-sort="soonest"]')!.click();
    app.destroy();

    const root2 = newRoot();
    const app2 = await startApp({
      root: root2, mode: 'user', revealAccountIdentity: false,
      session: fakeSession(), api: fakeApi(files), media: fakeMedia(), clock: fakeClock(),
    });
    expect(root2.querySelector<HTMLElement>('[data-provider="kimi"]')?.getAttribute('aria-selected')).toBe('true');
    expect(root2.querySelector<HTMLElement>('.sortTab[data-sort="soonest"]')?.getAttribute('aria-pressed')).toBe('true');
    app2.destroy();
  });

  it('falls back to defaults and still starts when the stored payload is corrupt', async () => {
    sessionStorage.setItem(key, '{bad json');
    const files = [claudeFile('c1.json'), kimiFile('k1.json')];
    const root = newRoot();
    const app = await startApp({
      root, mode: 'user', revealAccountIdentity: false,
      session: fakeSession(), api: fakeApi(files), media: fakeMedia(), clock: fakeClock(),
    });

    expect(root.querySelector<HTMLElement>('[data-provider="all"]')?.getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector<HTMLElement>('.sortTab[data-sort="default"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelectorAll('.card').length).toBe(2);
    app.destroy();
  });

  it('never persists token, quota, authIndex or authFile payloads', async () => {
    const files = [codexFile('codex.json')];
    const root = newRoot();
    const app = await startApp({
      root, mode: 'user', revealAccountIdentity: false,
      session: fakeSession(), api: fakeApi(files), media: fakeMedia(), clock: fakeClock(),
    });
    root.querySelector<HTMLElement>('[data-provider="codex"]')!.click();
    const stored = sessionStorage.getItem(key) ?? '';
    expect(stored).not.toMatch(/token|quota|authIndex|authFile|secret/i);
    expect(Object.keys(JSON.parse(stored))).toEqual(['provider']);
    app.destroy();
  });
});

describe('createQuotaApp entry dependency graph', () => {
  function readEntry(name: string): string {
    return readFileSync(resolve(process.cwd(), `src/entries/${name}`), 'utf8');
  }
  function readAppModule(name: string): string {
    return readFileSync(resolve(process.cwd(), `src/app/${name}`), 'utf8');
  }

  it('user.ts imports no admin module and never references the consume capability', () => {
    const src = readEntry('user.ts');
    expect(src).not.toMatch(/from\s+['"][^'"]*\badmin\b[^'"]*['"]/);
    expect(src).not.toMatch(/consumeCodexResetCredit/);
    expect(src).toMatch(/revealAccountIdentity:\s*false/);
  });

  it('admin.ts is the sole entry importing consumeCodexResetCredit and reveals identity', () => {
    const src = readEntry('admin.ts');
    expect(src).toMatch(/consumeCodexResetCredit/);
    expect(src).toMatch(/from\s+['"][^'"]*\badmin\/codexReset['"]/);
    expect(src).toMatch(/revealAccountIdentity:\s*true/);
  });

  it('excludes the consume endpoint from the user-facing read path', () => {
    // The consume URL/value must live only in src/admin/codexReset.ts; the app
    // composition root and the user entry must never reference it.
    const createQuotaAppSrc = readAppModule('createQuotaApp.ts');
    expect(createQuotaAppSrc).not.toMatch(/consumeCodexResetCredit\s*=/);
    expect(createQuotaAppSrc).not.toMatch(/rate-limit-reset-credits\/consume/);
  });
});
