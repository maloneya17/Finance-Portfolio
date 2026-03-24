/**
 * Lightweight async modal helpers.
 *
 * Replaces all window.prompt() / window.confirm() calls so the UI works
 * inside iframes, PWA shells, and other environments that block native dialogs.
 * Every function returns a Promise and resolves when the user acts (or ESC).
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
    const overlay = buildOverlay();
    const card = buildCard();
    const confirmClass = opts.dangerous
      ? 'bg-rose-600 hover:bg-rose-500 text-white'
      : 'bg-indigo-600 hover:bg-indigo-500 text-white';

    card.innerHTML = `
      <h3 class="font-bold text-slate-800 dark:text-white text-base mb-2">${esc(opts.title)}</h3>
      ${opts.message ? `<p class="text-xs text-slate-500 dark:text-slate-400 mb-3">${esc(opts.message)}</p>` : ''}
      ${opts.label ? `<label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">${esc(opts.label)}</label>` : ''}
      <input type="${esc(opts.inputType ?? 'text')}"
        id="_modalInput"
        placeholder="${esc(opts.placeholder ?? '')}"
        class="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-300 transition mb-4">
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

    const cleanup = (val: string | null) => { overlay.remove(); resolve(val); };
    card.querySelector('#_modalConfirm')!.addEventListener('click', () => cleanup(inputEl.value));
    card.querySelector('#_modalCancel')!.addEventListener('click', () => cleanup(null));
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(null); });
    const kbHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { document.removeEventListener('keydown', kbHandler); cleanup(null); }
    };
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
    const overlay = buildOverlay();
    const card = buildCard();
    const confirmClass = opts.dangerous
      ? 'bg-rose-600 hover:bg-rose-500 text-white'
      : 'bg-indigo-600 hover:bg-indigo-500 text-white';

    card.innerHTML = `
      <h3 class="font-bold text-slate-800 dark:text-white text-base mb-2">${esc(opts.title)}</h3>
      ${opts.message ? `<p class="text-xs text-slate-500 dark:text-slate-400 mb-4">${esc(opts.message)}</p>` : '<div class="mb-4"></div>'}
      <div class="flex gap-2 justify-end">
        <button id="_modalCancel" class="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition">Cancel</button>
        <button id="_modalConfirm" class="px-4 py-2 text-xs font-bold rounded-lg transition ${confirmClass}">${esc(opts.confirmLabel ?? 'Confirm')}</button>
      </div>`;

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    (card.querySelector('#_modalConfirm') as HTMLButtonElement | null)?.focus();

    const cleanup = (val: boolean) => { overlay.remove(); resolve(val); };
    card.querySelector('#_modalConfirm')!.addEventListener('click', () => cleanup(true));
    card.querySelector('#_modalCancel')!.addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });
    const kbHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { document.removeEventListener('keydown', kbHandler); cleanup(false); }
    };
    document.addEventListener('keydown', kbHandler);
  });
}
