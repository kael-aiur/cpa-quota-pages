import { h } from './dom';
import { adminIcon, refreshIcon, sunIcon, moonIcon } from './icons';

export interface HeaderHandlers {
  onRefreshAccounts: () => void;
  onQueryAll: () => void;
  onToggleTheme?: () => void;
}

export interface HeaderOptions {
  title?: string;
  description?: string;
  mode: 'user' | 'admin';
  handlers: HeaderHandlers;
}

export function renderHeader(options: HeaderOptions): HTMLElement {
  const header = h('div', { class: 'pageHeader' });

  const text = h('div', {
    class: 'pageHeader-text',
    children: [
      h('h1', {
        class: 'pageTitle',
        children: [
          h('span', { class: 'dot', aria: { hidden: 'true' } }),
          h('span', { text: options.title ?? '查看额度' }),
          ...(options.mode === 'admin'
            ? [h('span', { class: 'modeBadge', children: [adminIcon(), document.createTextNode('管理员')] })]
            : []),
        ],
      }),
      ...(options.description
        ? [h('p', { class: 'description', text: options.description })]
        : []),
    ],
  });
  header.append(text);

  const actions = h('div', { class: 'headerActions' });

  const refresh = h('button', {
    class: 'btn',
    attrs: { type: 'button', title: '重新拉取账号列表', 'data-action': 'refresh-accounts' },
  });
  refresh.append(refreshIcon());
  refresh.append(h('span', { class: 'btnLabel', text: '刷新账号' }));
  refresh.addEventListener('click', () => options.handlers.onRefreshAccounts());
  actions.append(refresh);

  const queryAll = h('button', {
    class: 'btn btn-primary',
    attrs: { type: 'button', title: '查询全部账号额度', 'data-action': 'query-all' },
  });
  queryAll.append(refreshIcon());
  queryAll.append(h('span', { class: 'btnLabel', text: '查询全部额度' }));
  queryAll.addEventListener('click', () => options.handlers.onQueryAll());
  actions.append(queryAll);

  if (options.handlers.onToggleTheme) {
    const toggle = h('button', {
      class: 'btn themeToggle',
      attrs: { type: 'button', title: '切换主题', 'aria-label': '切换主题', 'data-action': 'toggle-theme' },
    });
    toggle.append(sunIcon());
    toggle.append(moonIcon());
    toggle.addEventListener('click', () => options.handlers.onToggleTheme?.());
    actions.append(toggle);
  }

  header.append(actions);
  return header;
}
