// Passive listeners installed synchronously in the core. Their registration must
// precede any await, otherwise Firefox does not persist them as wake-up events.
import { defaultBrowser, type BrowserApi, type WebRequestDetailsApi } from './browser-api';

export type WebRequestFact = WebRequestDetailsApi & { readonly phase: 'headers' | 'completed' | 'error' };

export function observeWebRequests(urls: readonly string[], receive: (fact: WebRequestFact) => void, api: BrowserApi = defaultBrowser()) {
  let stop: (() => void) | null = null;
  const attach = (): void => {
    if (stop !== null || api.webRequest === undefined) return;
    const events = api.webRequest;
    const headers = (details: WebRequestDetailsApi): void => receive({ ...details, phase: 'headers' });
    const completed = (details: WebRequestDetailsApi): void => receive({ ...details, phase: 'completed' });
    const error = (details: WebRequestDetailsApi): void => receive({ ...details, phase: 'error' });
    const detach = (): void => {
      for (const [event, listener] of [[events.onBeforeSendHeaders, headers], [events.onCompleted, completed], [events.onErrorOccurred, error]] as const) {
        try { event.removeListener(listener); } catch { /* The API may already be revoked. */ }
      }
    };
    try {
      events.onBeforeSendHeaders.addListener(headers, { urls: [...urls] }, ['requestHeaders']);
      events.onCompleted.addListener(completed, { urls: [...urls] });
      events.onErrorOccurred.addListener(error, { urls: [...urls] });
      stop = detach;
    } catch { detach(); }
  };
  attach();
  return { attach, detach: (): void => { stop?.(); stop = null; } };
}
