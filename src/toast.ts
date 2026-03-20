import { esc } from './utils';

// Monotonic counter — guarantees unique IDs even when toasts fire in the same millisecond
let _toastSeq = 0;

export function showToast(msg: string, undoFn?: (() => void) | null): void {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const id = 'toast_' + (++_toastSeq);
  const undoHtml = undoFn
    ? `<button class="toast-btn" data-undo="${id}">Undo</button>`
    : '';
  container.insertAdjacentHTML(
    'beforeend',
    `<div id="${id}" class="toast"><span>${esc(msg)}</span>${undoHtml}</div>`,
  );
  const el = document.getElementById(id) as (HTMLElement & { _undoFn?: () => void }) | null;
  if (el && undoFn) el._undoFn = undoFn;
  setTimeout(() => el?.parentNode && el.remove(), 4500);
}

// Delegated undo handler — wired once in main.ts
export function handleToastUndo(e: MouseEvent): void {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-undo]');
  if (!btn) return;
  const id = btn.dataset['undo'];
  if (!id) return;
  const el = document.getElementById(id) as (HTMLElement & { _undoFn?: () => void }) | null;
  if (el?._undoFn) { el._undoFn(); el.remove(); }
}
