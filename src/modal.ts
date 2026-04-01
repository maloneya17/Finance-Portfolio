/**
 * Lightweight async modal helpers.
 *
 * Replaces all window.prompt() / window.confirm() calls so the UI works
 * inside iframes, PWA shells, and other environments that block native dialogs.
 * Every function returns a Promise and resolves when the user acts (or ESC).
 *
 * Accessibility:
 *  - Dialogs carry role="dialog" aria-modal="true" and aria-labelledby
 *  - First focusable element receives focus on open; focus is returned on close
 *  - Tab/Shift+Tab cycles within the modal (focus trap)
 *  - Escape always cancels
 */
import { esc } from './utils';

function buildOverlay(): HTMLDivElement {
  const el = document.createElement('div');
  el.className =
    'fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm';
  return el;
}

function buildCard(): HTMLDivElement {
  const el = document.createElement('div');
  el.className =
    'bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 border dark:border-slate-700';
  return el;
}

/** Returns all focusable children of a container, in DOM order. */
function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

/** Adds a keyboard focus trap inside `container`. Returns a cleanup function. */
function trapFocus(container: HTMLElement): () => void {
  const handler = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const focusable = getFocusable(container);
    if (!focusable.length) return;
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}

export interface TextInputModalOpts {
  title: string;
  message?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  inputType?: 'text' | 'number' | 'password';
  confirmLabel?: string;
  dangerous?: boolean;
}

/**
 * Show a modal with a text/number/password input.
 * Resolves with the entered value, or null if cancelled / ESC pressed.
 */
export function showTextInputModal(opts: TextInputModalOpts): Promise<string | null> {
  return new Promise(resolve => {
    const titleId = '_modalTitle_' + Date.now();
    const overlay = buildOverlay();
    const card    = buildCard();
    const confirmClass = opts.dangerous
      ? 'bg-rose-600 hover:bg-rose-500 text-white'
      : 'btn-ios text-white';

    // ARIA: dialog role so screen readers announce the modal correctly
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', titleId);

    card.innerHTML = `
      <h3 id="${titleId}" class="font-bold text-slate-800 dark:text-white text-base mb-2">${esc(opts.title)}</h3>
      ${opts.message ? `<p class="text-xs text-slate-500 dark:text-slate-400 mb-3">${esc(opts.message)}</p>` : ''}
      ${opts.label ? `<label for="_modalInput" class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">${esc(opts.label)}</label>` : ''}
      <input type="${esc(opts.inputType ?? 'text')}"
        id="_modalInput"
        placeholder="${esc(opts.placeholder ?? '')}"
        class="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white outline-none transition mb-4">
      <div class="flex gap-2 justify-end">
        <button id="_modalCancel" class="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition">Cancel</button>
        <button id="_modalConfirm" class="px-4 py-2 text-xs font-bold rounded-lg transition ${confirmClass}">${esc(opts.confirmLabel ?? 'OK')}</button>
      </div>`;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const inputEl = card.querySelector<HTMLInputElement>('#_modalInput')!;
    if (opts.defaultValue !== undefined) inputEl.value = opts.defaultValue;
    inputEl.focus();
    if (opts.inputType !== 'number') inputEl.select();

    // Remember what had focus so we can restore it on close
    const previousFocus = document.activeElement as HTMLElement | null;
    const removeTrap = trapFocus(card);

    let kbHandler: (e: KeyboardEvent) => void;
    const cleanup = (val: string | null) => {
      removeTrap();
      document.removeEventListener('keydown', kbHandler);
      overlay.remove();
      previousFocus?.focus();
      resolve(val);
    };
    card.querySelector('#_modalConfirm')!.addEventListener('click', () => cleanup(inputEl.value));
    card.querySelector('#_modalCancel')!.addEventListener('click', () => cleanup(null));
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(null); });
    kbHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') cleanup(null); };
    document.addEventListener('keydown', kbHandler);
    inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') cleanup(inputEl.value); });
  });
}

export interface ConfirmModalOpts {
  title: string;
  message?: string;
  confirmLabel?: string;
  dangerous?: boolean;
}

/**
 * Show a simple confirm/cancel modal.
 * Resolves with true if the user clicked Confirm, false otherwise.
 */
export function showConfirmModal(opts: ConfirmModalOpts): Promise<boolean> {
  return new Promise(resolve => {
    const titleId = '_modalTitle_' + Date.now();
    const overlay = buildOverlay();
    const card    = buildCard();
    const confirmClass = opts.dangerous
      ? 'bg-rose-600 hover:bg-rose-500 text-white'
      : 'btn-ios text-white';

    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', titleId);

    card.innerHTML = `
      <h3 id="${titleId}" class="font-bold text-slate-800 dark:text-white text-base mb-2">${esc(opts.title)}</h3>
      ${opts.message ? `<p class="text-xs text-slate-500 dark:text-slate-400 mb-4">${esc(opts.message)}</p>` : '<div class="mb-4"></div>'}
      <div class="flex gap-2 justify-end">
        <button id="_modalCancel" class="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition">Cancel</button>
        <button id="_modalConfirm" class="px-4 py-2 text-xs font-bold rounded-lg transition ${confirmClass}">${esc(opts.confirmLabel ?? 'Confirm')}</button>
      </div>`;

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    (card.querySelector('#_modalConfirm') as HTMLButtonElement | null)?.focus();

    const previousFocus = document.activeElement as HTMLElement | null;
    const removeTrap = trapFocus(card);

    let kbHandler: (e: KeyboardEvent) => void;
    const cleanup = (val: boolean) => {
      removeTrap();
      document.removeEventListener('keydown', kbHandler);
      overlay.remove();
      previousFocus?.focus();
      resolve(val);
    };
    card.querySelector('#_modalConfirm')!.addEventListener('click', () => cleanup(true));
    card.querySelector('#_modalCancel')!.addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });
    kbHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') cleanup(false); };
    document.addEventListener('keydown', kbHandler);
  });
}
