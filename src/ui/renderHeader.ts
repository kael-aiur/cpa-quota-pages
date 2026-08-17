import { h } from './dom';
import { refreshIcon } from './icons';

export interface HeaderHandlers {
  onRefreshAccounts: () => void;
  onQueryAll: () => void;
}

export interface HeaderOptions {
  mode: 'user' | 'admin';
  handlers: HeaderHandlers;
}

export function renderHeader(options: HeaderOptions): HTMLElement {
  const header = h('div', { class: 'pageHeader' });
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
  queryAll.append(h('span', { class: 'btnLabel', text: '查询全部账号额度' }));
  queryAll.addEventListener('click', () => options.handlers.onQueryAll());
  actions.append(queryAll);

  header.append(actions);
  return header;
}
