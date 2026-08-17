/**
 * Admin quota entry.
 *
 * This is the ONLY entry that imports the Codex reset capability
 * (`consumeCodexResetCredit`) from `src/admin/codexReset` and injects it
 * explicitly into the composition root. It runs with
 * `revealAccountIdentity: true` so admins can see account identity and perform
 * resets. The consume endpoint string never leaves `src/admin/codexReset.ts`.
 */

import '../styles/tokens.css';
import '../styles/layout.css';
import '../styles/cards.css';
import '../styles/timeline.css';
import { createQuotaApp } from '../app/createQuotaApp';
import { consumeCodexResetCredit } from '../admin/codexReset';
import { createResetRequestHandler, RESET_BUTTON_LABEL } from '../admin/resetFlow';

const root = document.querySelector<HTMLElement>('#app');
if (!root) {
  throw new Error('Missing #app mount point');
}

const app = createQuotaApp({
  root,
  mode: 'admin',
  revealAccountIdentity: true,
  onResetRequest: createResetRequestHandler({
    capability: (bridge) => consumeCodexResetCredit(bridge.account.file, bridge.context),
    resolveTrigger: () => (document.activeElement instanceof HTMLElement ? document.activeElement : root),
  }),
  resetButtonLabel: RESET_BUTTON_LABEL,
});

void app.start().catch((error: unknown) => {
  console.error('[quota] 启动失败', error);
});

export default app;
