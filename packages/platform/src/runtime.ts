import { browser } from '@wxt-dev/browser';

/** Absolute moz-extension:// URL of a packaged file (e.g. a lazy chunk). */
export function extensionUrl(path: string): string {
  return browser.runtime.getURL(path);
}

export function extensionId(): string {
  return browser.runtime.id;
}

/**
 * False once the extension was reloaded/updated under an already-open tab:
 * the old content script keeps running but its runtime is gone (§6.8 п. 8).
 */
export function isExtensionContextAlive(): boolean {
  try {
    return typeof browser.runtime?.id === 'string';
  } catch {
    return false;
  }
}
