import type { Provider } from '../providers/types';
import type { SortMode } from '../quota/types';
import { h } from './dom';

const PROVIDER_LABELS: Record<Provider, string> = {
  claude: 'Claude',
  antigravity: 'Antigravity',
  codex: 'Codex',
  xai: 'xAI',
  kimi: 'Kimi',
};

const PROVIDER_ORDER: Provider[] = ['claude', 'antigravity', 'codex', 'xai', 'kimi'];

export interface TabsHandlers {
  onSelectProvider: (selection: Provider | 'all') => void;
  onSelectSort?: (mode: SortMode) => void;
}

export interface TabsOptions {
  providers?: Provider[];
  selected: Provider | 'all';
  sortMode?: SortMode;
  /** Optional account counts appended to each tab label (e.g. "Claude · 3"). */
  counts?: Partial<Record<Provider | 'all', number>>;
  handlers: TabsHandlers;
}

type Selection = Provider | 'all';

function tabButton(
  selection: Selection,
  label: string,
  active: boolean,
  onSelect: () => void,
  count?: number,
): HTMLButtonElement {
  const btn = h('button', {
    class: `tab${active ? ' is-active' : ''}`,
    attrs: {
      type: 'button',
      role: 'tab',
      'data-provider': selection,
      'aria-selected': active ? 'true' : 'false',
      ...(active ? { 'aria-current': 'true' } : {}),
    },
  });
  btn.append(h('span', { class: 'tabLabel', text: label }));
  if (count !== undefined) btn.append(h('span', { class: 'tabCount', text: String(count) }));
  btn.addEventListener('click', onSelect);
  return btn;
}

export function renderTabs(options: TabsOptions): HTMLElement {
  const available = options.providers ?? PROVIDER_ORDER;
  const present = PROVIDER_ORDER.filter((provider) => available.includes(provider));
  const selected = options.selected;
  const counts = options.counts;

  const tabBar = h('div', { class: 'tabBar', attrs: { role: 'tablist', 'aria-label': '按 Provider 筛选' } });
  tabBar.append(tabButton('all', '全部', selected === 'all', () => options.handlers.onSelectProvider('all'), counts?.all));
  for (const provider of present) {
    tabBar.append(tabButton(
      provider,
      PROVIDER_LABELS[provider],
      selected === provider,
      () => options.handlers.onSelectProvider(provider),
      counts?.[provider],
    ));
  }

  const container = h('div', { class: 'tabs', children: [tabBar] });

  if (options.handlers.onSelectSort) {
    const sortMode = options.sortMode ?? 'default';
    const sortBar = h('div', { class: 'sortControl', attrs: { role: 'group', 'aria-label': '排序方式' } });
    const modes: ReadonlyArray<{ id: SortMode; label: string }> = [
      { id: 'default', label: '默认' },
      { id: 'soonest', label: '最近重置' },
    ];
    for (const mode of modes) {
      const active = sortMode === mode.id;
      const btn = h('button', {
        class: `sortTab${active ? ' is-active' : ''}`,
        attrs: {
          type: 'button',
          'data-sort': mode.id,
          'aria-pressed': active ? 'true' : 'false',
        },
      });
      btn.append(h('span', { text: mode.label }));
      btn.addEventListener('click', () => options.handlers.onSelectSort?.(mode.id));
      sortBar.append(btn);
    }
    container.append(sortBar);
  }

  return container;
}
