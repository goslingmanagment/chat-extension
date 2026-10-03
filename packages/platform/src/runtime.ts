import { defaultBrowser, type BrowserApi } from './browser-api';

/** Absolute moz-extension:// URL of a packaged file (e.g. a lazy chunk). */
export function extensionUrl(path: string, api: BrowserApi = defaultBrowser()): string {
  return api.runtime.getURL(path);
}

export function extensionId(api: BrowserApi = defaultBrowser()): string {
  return api.runtime.id;
}

/**
 * False once the extension was reloaded/updated under an already-open tab:
 * the old content script keeps running but its runtime is gone (§6.8 п. 8).
 */
export function isExtensionContextAlive(api?: BrowserApi): boolean {
  try {
    return typeof (api ?? defaultBrowser()).runtime?.id === 'string';
  } catch {
    return false;
  }
}
