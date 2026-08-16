import { afterEach, vi } from 'vitest';

const initialUrl = 'http://localhost/';

history.replaceState(null, '', initialUrl);

afterEach(() => {
  history.replaceState(null, '', initialUrl);
  vi.restoreAllMocks();
  vi.useRealTimers();
});
