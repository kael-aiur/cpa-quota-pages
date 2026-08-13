import type { AccountEntry } from '../quota/types';
import type { Provider } from '../providers/types';
import type { QuotaLoadState } from '../app/state';
import { h, textOf } from './dom';
import { refreshIcon, resetIcon } from './icons';
import { renderProviderBody } from './renderProviderBody';

export interface RenderOptions {
  mode: 'user' | 'admin';
  revealAccountIdentity: boolean;
  canConsumeCodexReset: boolean;
  /** Precomputed SHA-256 anonymous label (see quota/identity). */
  anonymousLabel: string;
  /** Snapshot time for reset formatting; defaults to Date.now(). */
  nowMs?: number;
}

export interface CardHandlers {
  onQuery?: (accountId: string) => void;
  onReset?: (accountId: string) => void;
}

const PROVIDER_LABEL: Record<Provider, string> = {
  claude: 'Claude',
  antigravity: 'Antigravity',
  codex: 'Codex',
  xai: 'xAI',
  kimi: 'Kimi',
};

function identityLabel(entry: AccountEntry): string {
  const file = entry.file;
  return textOf(file.email) || textOf(file.account) || textOf(file.name) || entry.id;
}

function metaRow(label: string, value: string | null | undefined): HTMLElement | null {
  if (value === null || value === undefined || value === '') return null;
  return h('div', {
    class: 'cardMetaRow',
    children: [
      h('span', { class: 'label', text: label }),
      h('span', { class: 'value', text: value }),
    ],
  });
}

function buildAdminMeta(entry: AccountEntry): HTMLElement | null {
  const file = entry.file;
  const rows = [
    metaRow('账号', textOf(file.email) || textOf(file.account)),
    metaRow('文件', textOf(file.name)),
    metaRow('index', textOf(file.authIndex ?? file.auth_index)),
    metaRow('项目', textOf(file.projectId ?? file.project_id)),
    metaRow('ID', textOf(file.id)),
  ].filter((row): row is HTMLElement => row !== null);
  if (rows.length === 0) return null;
  return h('div', { class: 'cardMeta', children: rows });
}

function renderQuotaRegion(
  entry: AccountEntry,
  quota: QuotaLoadState,
  nowMs: number,
): HTMLElement {
  const region = h('div', { class: 'quotaSection', data: { role: 'quota' } });

  switch (quota.status) {
    case 'idle':
      region.append(h('div', { class: 'quotaMessage', text: '点击「查看额度」获取实时用量' }));
      break;
    case 'loading':
      region.append(h('div', {
        class: 'quotaRow',
        children: [
          h('div', {
            class: 'quotaRowHeader',
            children: [h('span', { class: 'quotaModel', text: '查询中…' })],
          }),
          h('div', { class: 'skeleton', style: { width: '100%' } }),
        ],
      }));
      break;
    case 'error':
      region.append(h('div', {
        class: 'quotaError',
        text: `查询失败：${textOf(quota.error.message) || textOf(quota.error.name) || '未知错误'}`,
      }));
      break;
    case 'success':
      region.append(renderProviderBody(entry.provider, quota.data, nowMs));
      break;
  }
  return region;
}

export function renderQuotaCard(
  entry: AccountEntry,
  quota: QuotaLoadState,
  options: RenderOptions,
  handlers: CardHandlers,
): HTMLElement {
  const nowMs = options.nowMs ?? Date.now();
  const reveal = options.mode === 'admin' && options.revealAccountIdentity;
  const label = reveal ? identityLabel(entry) : options.anonymousLabel;
  const isLoading = quota.status === 'loading';

  const card = h('div', {
    class: 'card',
    data: { provider: entry.provider, state: quota.status },
    aria: { busy: isLoading ? 'true' : 'false' },
  });

  const header = h('div', {
    class: 'cardHeader',
    children: [
      h('span', { class: 'typeBadge', text: PROVIDER_LABEL[entry.provider] }),
      h('span', { class: 'fileName', text: label, ...(reveal ? { title: label } : {}) }),
    ],
  });
  card.append(header);

  if (reveal) {
    const meta = buildAdminMeta(entry);
    if (meta) card.append(meta);
  }

  card.append(renderQuotaRegion(entry, quota, nowMs));

  const actions = h('div', { class: 'cardActions' });

  const queryBtn = h('button', {
    class: 'btn btn-sm btn-primary',
    attrs: { type: 'button', 'data-action': 'query' },
  });
  queryBtn.disabled = isLoading;
  queryBtn.append(refreshIcon());
  queryBtn.append(h('span', { class: 'btnLabel', text: '查看额度' }));
  queryBtn.addEventListener('click', () => handlers.onQuery?.(entry.id));
  actions.append(queryBtn);

  const canReset = options.mode === 'admin' && entry.provider === 'codex' && options.canConsumeCodexReset;
  if (canReset) {
    const resetBtn = h('button', {
      class: 'btn btn-sm',
      attrs: { type: 'button', 'data-action': 'reset' },
    });
    resetBtn.append(resetIcon());
    resetBtn.append(h('span', { class: 'btnLabel', text: '重置额度' }));
    resetBtn.addEventListener('click', () => handlers.onReset?.(entry.id));
    actions.append(resetBtn);
  }

  card.append(actions);
  return card;
}
