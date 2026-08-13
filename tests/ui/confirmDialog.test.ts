import { afterEach, describe, expect, it, vi } from 'vitest';
import { openConfirmDialog } from '../../src/ui/confirmDialog';
import type { DialogController } from '../../src/ui/confirmDialog';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mountTrigger(): HTMLButtonElement {
  const trigger = document.createElement('button');
  trigger.textContent = '重置额度';
  trigger.dataset.action = 'reset';
  document.body.append(trigger);
  trigger.focus();
  return trigger;
}

function queryButton(root: ParentNode, action: 'confirm' | 'cancel'): HTMLButtonElement {
  const btn = root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  if (!btn) throw new Error(`missing ${action} button`);
  return btn;
}

function isAttached(controller: DialogController | undefined): boolean {
  return !!controller && document.body.contains(controller.element);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('openConfirmDialog accessibility', () => {
  it('renders title and the irreversible warning message', () => {
    const trigger = mountTrigger();
    const controller = openConfirmDialog({
      title: '重置 Codex 额度',
      message: '此操作不可撤销，将立即消耗一次重置额度。',
      confirmText: '确认重置',
      cancelText: '取消',
      trigger,
      onConfirm: vi.fn(async () => {}),
    });

    const text = controller.element.textContent ?? '';
    expect(text).toContain('重置 Codex 额度');
    expect(text).toContain('此操作不可撤销');
    expect(isAttached(controller)).toBe(true);
    controller.close();
    expect(isAttached(controller)).toBe(false);
  });

  it('defaults focus to the cancel button so a stray Enter does not confirm', () => {
    const trigger = mountTrigger();
    const controller = openConfirmDialog({
      title: '重置 Codex 额度',
      message: '此操作不可撤销',
      confirmText: '确认重置',
      cancelText: '取消',
      trigger,
      onConfirm: vi.fn(async () => {}),
    });

    const cancel = queryButton(controller.element, 'cancel');
    expect(document.activeElement).toBe(cancel);

    controller.close();
  });

  it('closes without invoking onConfirm when Escape is pressed and returns focus to the trigger', () => {
    const trigger = mountTrigger();
    const onConfirm = vi.fn(async () => {});
    const controller = openConfirmDialog({
      title: '重置 Codex 额度',
      message: '此操作不可撤销',
      confirmText: '确认重置',
      cancelText: '取消',
      trigger,
      onConfirm,
    });

    controller.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(isAttached(controller)).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus to the trigger when the cancel button is clicked', () => {
    const trigger = mountTrigger();
    const onConfirm = vi.fn(async () => {});
    const controller = openConfirmDialog({
      title: '重置 Codex 额度',
      message: '此操作不可撤销',
      confirmText: '确认重置',
      cancelText: '取消',
      trigger,
      onConfirm,
    });

    const cancel = queryButton(controller.element, 'cancel');
    cancel.click();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(isAttached(controller)).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('locks both buttons while onConfirm is pending, then closes and restores focus', async () => {
    const trigger = mountTrigger();
    const gate = deferred<void>();
    const onConfirm = vi.fn(() => gate.promise);
    const controller = openConfirmDialog({
      title: '重置 Codex 额度',
      message: '此操作不可撤销',
      confirmText: '确认重置',
      cancelText: '取消',
      trigger,
      onConfirm,
    });

    const confirm = queryButton(controller.element, 'confirm');
    const cancel = queryButton(controller.element, 'cancel');
    expect(confirm.disabled).toBe(false);
    expect(cancel.disabled).toBe(false);

    confirm.click();
    // Let the click handler run and the locking state apply.
    await vi.waitFor(() => expect(confirm.disabled).toBe(true));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(cancel.disabled).toBe(true);
    // Dialog must stay open while the consume is in flight.
    expect(isAttached(controller)).toBe(true);

    // A second click while locked must not re-enter onConfirm.
    confirm.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);

    gate.resolve();
    await vi.waitFor(() => expect(isAttached(controller)).toBe(false));

    expect(document.activeElement).toBe(trigger);
  });

  it('closes and restores focus even when onConfirm rejects', async () => {
    const trigger = mountTrigger();
    const onConfirm = vi.fn(async () => {
      throw new Error('consume failed');
    });
    const controller = openConfirmDialog({
      title: '重置 Codex 额度',
      message: '此操作不可撤销',
      confirmText: '确认重置',
      cancelText: '取消',
      trigger,
      onConfirm,
    });

    const confirm = queryButton(controller.element, 'confirm');
    const onError = vi.fn();
    // Swallow the unhandled rejection so the test focuses on dialog behavior.
    controller.closed.catch(onError);

    confirm.click();
    await vi.waitFor(() => expect(isAttached(controller)).toBe(false));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('exposes the dialog with alertdialog role and aria-modal for assistive tech', () => {
    const trigger = mountTrigger();
    const controller = openConfirmDialog({
      title: '重置 Codex 额度',
      message: '此操作不可撤销',
      confirmText: '确认重置',
      cancelText: '取消',
      trigger,
      onConfirm: vi.fn(async () => {}),
    });

    expect(controller.element.getAttribute('role')).toBe('alertdialog');
    expect(controller.element.getAttribute('aria-modal')).toBe('true');
    expect(controller.element.getAttribute('aria-labelledby')).toBeTruthy();
    expect(controller.element.getAttribute('aria-describedby')).toBeTruthy();

    controller.close();
  });
});
