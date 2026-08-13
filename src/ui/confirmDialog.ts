/**
 * Accessible confirmation dialog for destructive admin actions.
 *
 * jsdom does not implement `<dialog>.showModal()`, and even in real browsers
 * modal focus traps need careful handling, so this dialog manages focus,
 * Escape, and the button-lock contract explicitly rather than leaning on the
 * platform modal. The DOM is built entirely with the safe `h()` helper — no
 * raw HTML is ever inserted.
 */

import { h } from './dom';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  trigger: HTMLElement;
  onConfirm: () => Promise<void>;
}

export interface DialogController {
  /** The live dialog root element. Detached from the DOM once closed. */
  readonly element: HTMLElement;
  /**
   * Resolves when the dialog closes without an error (cancel, Escape, programmatic
   * close, or a successful confirm). Rejects with the `onConfirm` rejection when
   * the confirm path fails, so callers can surface the consume error.
   */
  readonly closed: Promise<void>;
  /** Close the dialog as if the user cancelled: no confirm runs, focus restores. */
  close(): void;
}

let dialogCounter = 0;

export function openConfirmDialog(options: ConfirmDialogOptions): DialogController {
  const { title, message, confirmText, cancelText, trigger, onConfirm } = options;
  const uid = `cpa-confirm-${(dialogCounter += 1)}`;
  const titleId = `${uid}-title`;
  const messageId = `${uid}-message`;

  const titleEl = h('h2', { class: 'confirmTitle', text: title, attrs: { id: titleId } });
  const messageEl = h('p', { class: 'confirmMessage', text: message, attrs: { id: messageId } });

  const confirmBtn = h('button', {
    class: 'btn btn-primary',
    attrs: { type: 'button', 'data-action': 'confirm' },
    text: confirmText,
  });
  const cancelBtn = h('button', {
    class: 'btn',
    attrs: { type: 'button', 'data-action': 'cancel' },
    text: cancelText,
  });

  const actions = h('div', { class: 'confirmActions', children: [cancelBtn, confirmBtn] });

  const root = h('div', {
    class: 'confirmDialog',
    attrs: {
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'aria-describedby': messageId,
      tabindex: '-1',
    },
    children: [titleEl, messageEl, actions],
  });

  document.body.append(root);

  let closed = false;
  let confirming = false;
  let resolveClosed!: () => void;
  let rejectClosed!: (cause: unknown) => void;
  const closedPromise = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });

  const restoreFocus = (): void => {
    try {
      trigger.focus();
    } catch {
      /* trigger may have been removed from the DOM by the caller */
    }
  };

  const teardown = (): void => {
    if (closed) return;
    closed = true;
    root.remove();
    restoreFocus();
  };

  const close = (): void => {
    if (closed || confirming) return;
    teardown();
    resolveClosed();
  };

  const finishConfirm = async (cause: undefined | unknown): Promise<void> => {
    if (cause === undefined) {
      teardown();
      resolveClosed();
    } else {
      teardown();
      rejectClosed(cause);
    }
  };

  const runConfirm = async (): Promise<void> => {
    if (closed || confirming) return;
    confirming = true;
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.setAttribute('aria-busy', 'true');
    try {
      await onConfirm();
      await finishConfirm(undefined);
    } catch (cause) {
      await finishConfirm(cause);
    }
  };

  cancelBtn.addEventListener('click', close);
  confirmBtn.addEventListener('click', runConfirm);
  root.addEventListener('keydown', (event: KeyboardEvent) => {
    if (closed) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });

  // Default focus lands on the non-destructive action so a stray Enter cannot
  // trigger the irreversible consume.
  cancelBtn.focus();

  return {
    element: root,
    get closed(): Promise<void> {
      return closedPromise;
    },
    close,
  };
}
