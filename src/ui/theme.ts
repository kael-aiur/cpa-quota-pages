/**
 * Theme application with priority: URL (`?theme=light|dark`) > system preference.
 *
 * When a valid theme is requested, it wins unconditionally and no system
 * listener is attached. When the request is missing or unrecognized, the system
 * preference is honored and tracked via a `change` listener on the supplied
 * media query list; the returned cleanup removes that listener.
 */

type Theme = 'light' | 'dark';

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

export interface ApplyThemeOptions {
  requestedTheme: string | null;
  media: MediaQueryList;
}

export function applyTheme(options: ApplyThemeOptions): () => void {
  const root = document.documentElement;
  const { requestedTheme, media } = options;

  if (isTheme(requestedTheme)) {
    root.setAttribute('data-theme', requestedTheme);
    return () => undefined;
  }

  const apply = () => {
    root.setAttribute('data-theme', media.matches ? 'dark' : 'light');
  };
  apply();
  media.addEventListener('change', apply);
  return () => media.removeEventListener('change', apply);
}
