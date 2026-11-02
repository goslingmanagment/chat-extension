// Fansly can reuse a medium's original filename (for example IMG_001.jpeg) when the person's File has a new name.
// Give only the newly prepended album card its name through Fansly's own rename modal, never the global medium.
// Selectors checked against the site's 2026-10-30 bundle, app-vault-ablum-media-rename-modal (the typo is Fansly's).
import { readVaultPage, VAULT_SELECTORS, vaultMediaKey } from './dom';

export const VAULT_CONFIRM_TIMEOUT_MS = 30_000;
const MODAL = 'app-vault-ablum-media-rename-modal';

interface RenameTimer {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** Exactly one new card prepended; the old visible prefix still follows it. No guess among concurrent additions. */
export function prependedVaultCard(before: readonly string[], after: readonly string[]): boolean {
  const first = after[0];
  if (first === undefined || before.includes(first) || after.length < Math.min(before.length + 1, 3)) return false;
  return after.slice(1).every((key, index) => before[index] === key);
}

/** One modal, one Save. False means indeterminate: a caller must never upload the file again by itself. */
export function renameVaultCard(win: Window, name: string, allowed: () => boolean, signal: AbortSignal | undefined, timer: RenameTimer): Promise<boolean> {
  const doc = win.document;
  const card = doc.querySelector(`${VAULT_SELECTORS.host} ${VAULT_SELECTORS.card}`);
  const label = card?.querySelector<HTMLElement>(VAULT_SELECTORS.name);
  // Another native modal belongs to the person. Do not fill it, close it or replace it.
  if (label === null || label === undefined || doc.querySelector('.modal') !== null || !allowed()) return Promise.resolve(false);
  const key = vaultMediaKey(name);
  return new Promise((resolve) => {
    let modal: Element | null = null;
    let saving = false;
    let finished = false;
    const end = (ok: boolean): void => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      timer.clear(deadline);
      signal?.removeEventListener('abort', abort);
      resolve(ok);
    };
    const abort = (): void => end(false);
    const check = (): void => {
      if (finished) return;
      if (saving) {
        if (modal?.isConnected === false) end(readVaultPage(doc).cards[0] === key);
        return;
      }
      if (!allowed() || !card?.isConnected) return end(false);
      const matches = doc.querySelectorAll(MODAL);
      if (matches.length !== 1) return;
      modal = matches.item(0);
      const input = modal.querySelector<HTMLInputElement>('input[type=text]');
      const save = modal.querySelector<HTMLElement>('.btn.solid-blue');
      if (input === null || save === null) return;
      saving = true;
      input.value = name;
      input.dispatchEvent(new (win as Window & typeof globalThis).Event('input', { bubbles: true }));
      if (!allowed() || !input.isConnected || !save.isConnected) return end(false);
      save.click();
      check();
    };
    const observer = new (win as Window & typeof globalThis).MutationObserver(check);
    observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
    const deadline = timer.set(() => end(false), VAULT_CONFIRM_TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted === true) return end(false);
    try {
      label.click();
      check();
    } catch {
      end(false);
    }
  });
}
