import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme } from '../../src/ui/theme';

class FakeMediaQueryList extends EventTarget {
  matches: boolean;
  readonly media = '(prefers-color-scheme: dark)';
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null = null;
  constructor(matches: boolean) {
    super();
    this.matches = matches;
  }
  /** Deprecated MQL members (unused by applyTheme, kept for interface parity). */
  addListener(): void {}
  removeListener(): void {}
  setMatches(matches: boolean): void {
    this.matches = matches;
    this.dispatchEvent(new Event('change'));
  }
}

function root(): HTMLElement {
  return document.documentElement;
}

afterEach(() => {
  root().removeAttribute('data-theme');
});

describe('applyTheme', () => {
  it('uses the requested light/dark theme without listening to the system', () => {
    const media = new FakeMediaQueryList(true);
    const cleanup = applyTheme({ requestedTheme: 'dark', media });

    expect(root().getAttribute('data-theme')).toBe('dark');
    // URL override wins even when the system flips.
    media.setMatches(false);
    expect(root().getAttribute('data-theme')).toBe('dark');
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });

  it('falls back to the system preference when no valid theme is requested and tracks changes', () => {
    const media = new FakeMediaQueryList(false);
    const cleanup = applyTheme({ requestedTheme: null, media });

    expect(root().getAttribute('data-theme')).toBe('light');

    media.setMatches(true);
    expect(root().getAttribute('data-theme')).toBe('dark');

    media.setMatches(false);
    expect(root().getAttribute('data-theme')).toBe('light');

    cleanup();
    media.setMatches(true);
    expect(root().getAttribute('data-theme')).toBe('light');
  });

  it('ignores an unrecognized requested theme and follows the system instead', () => {
    const media = new FakeMediaQueryList(true);
    const cleanup = applyTheme({ requestedTheme: 'mauve', media });

    expect(root().getAttribute('data-theme')).toBe('dark');
    cleanup();
  });

  it('removes the media listener on cleanup', () => {
    const media = new FakeMediaQueryList(true);
    const removeSpy = vi.spyOn(media, 'removeEventListener');
    const addSpy = vi.spyOn(media, 'addEventListener');

    const cleanup = applyTheme({ requestedTheme: null, media });
    expect(addSpy).toHaveBeenCalledWith('change', expect.any(Function));

    cleanup();
    expect(removeSpy).toHaveBeenCalledWith('change', expect.any(Function));

    media.setMatches(false);
    expect(root().getAttribute('data-theme')).toBe('dark');
  });

  it('does not attach a system listener when a valid theme overrides it', () => {
    const media = new FakeMediaQueryList(true);
    const addSpy = vi.spyOn(media, 'addEventListener');

    applyTheme({ requestedTheme: 'light', media });
    expect(addSpy).not.toHaveBeenCalled();
  });
});
