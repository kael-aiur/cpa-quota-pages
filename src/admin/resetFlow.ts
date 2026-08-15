/**
 * Admin-only Codex reset flow: confirm dialog + consume + result publishing.
 *
 * This module deliberately lives under `src/admin/` — next to
 * `codexReset.ts` — so the irreversible-dialog copy and the consume call
 * only ever enter the admin bundle. The shared app root (`createQuotaApp`)
 * resolves a `QuotaResetBridge` and hands it to {@link createResetRequestHandler};
 * it never imports this module, the dialog, or the capability itself, which is
 * what keeps `/rate-limit-reset-credits/consume` out of `dist/quota.html`.
 */

import type { QuotaResetBridge } from '../app/types';
import { openConfirmDialog } from '../ui/confirmDialog';

export function createResetRequestHandler(options: {
  capability: (bridge: QuotaResetBridge) => Promise<unknown>;
  /** Element that should receive focus when the dialog closes. */
  resolveTrigger: () => HTMLElement;
}): (bridge: QuotaResetBridge) => void {
  const { capability, resolveTrigger } = options;
  return (bridge) => {
    const dialog = openConfirmDialog({
      title: '重置 Codex 额度',
      message: '此操作不可撤销，将立即消耗一次额度重置券以重置该账号额度，确认继续？',
      confirmText: '确认重置',
      cancelText: '取消',
      trigger: resolveTrigger(),
      onConfirm: async () => {
        try {
          const data = await capability(bridge);
          bridge.publish({ status: 'success', data: data as never });
        } catch (error) {
          bridge.publish({ status: 'error', error });
          throw error;
        }
      },
    });
    // Handoff constraint (Task 14): DialogController.closed rejects when
    // onConfirm fails. Attach a handler so the rejection is never unhandled;
    // the failure is already surfaced per-card via the bridge publish above.
    dialog.closed.catch(() => { /* reset failure already recorded on the card */ });
  };
}
