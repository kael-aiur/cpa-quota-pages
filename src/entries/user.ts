/**
 * User-facing quota entry.
 *
 * This module intentionally imports ONLY the application composition root and
 * the read-only styles. It never imports anything under `src/admin/`, never
 * references the Codex reset capability, and runs the app with
 * `revealAccountIdentity: false` so account identity stays anonymized. The
 * reset/ write path is unreachable from this bundle.
 */

import '../styles/tokens.css';
import '../styles/layout.css';
import '../styles/cards.css';
import '../styles/timeline.css';
import { createQuotaApp } from '../app/createQuotaApp';

const root = document.querySelector<HTMLElement>('#app');
if (!root) {
  throw new Error('Missing #app mount point');
}

const app = createQuotaApp({
  root,
  mode: 'user',
  revealAccountIdentity: false,
});

void app.start().catch((error: unknown) => {
  // Bootstrap failures are already rendered as an auth-error gate; swallow the
  // unhandled rejection here so the console stays quiet.
  console.error('[quota] 启动失败', error);
});

export default app;
