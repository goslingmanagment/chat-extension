// The router's two listeners (core services/container-proxy.ts). Registered synchronously in the core, like
// web-request.ts, so Firefox keeps them as wake-up events: a request of a sleeping event page wakes it and waits for the
// answer (measured on Firefox 159).
import { defaultBrowser, type BrowserApi, type WebRequestDetailsApi } from './browser-api';

export interface ProxyRequestHandlers {
  /** The route of any request of the browser: at once in the common path. */
  readonly answer: (details: WebRequestDetailsApi) => unknown;
  /** A navigation of the site's pages, with the proxy it went through. */
  readonly page: (details: WebRequestDetailsApi) => void;
}

export function observeProxyRequests(pageMatches: readonly string[], handlers: ProxyRequestHandlers, api: BrowserApi = defaultBrowser()) {
  let on = false;
  const answer = (details: WebRequestDetailsApi): unknown => handlers.answer(details);
  const page = (details: WebRequestDetailsApi): void => handlers.page(details);
  const filter = { urls: ['<all_urls>'] };
  const detach = (): void => {
    on = false;
    try { api.proxy?.onRequest.removeListener(answer); } catch { /* The API may already be revoked. */ }
    try { api.webRequest?.onBeforeRequest.removeListener(page); } catch { /* The same. */ }
  };
  const attach = (): void => {
    if (on || api.proxy === undefined) return;
    try {
      api.proxy.onRequest.addListener(answer, filter, ['requestHeaders']);
      api.webRequest?.onBeforeRequest.addListener(page, { urls: [...pageMatches], types: ['main_frame'] });
      on = true;
    } catch { detach(); }
  };
  attach();
  return {
    attach,
    detach,
    /** The last registered filter has the last word: another add-on's different proxy for the same request loses to it. */
    moveToLast(): void {
      if (!on || api.proxy === undefined) return;
      try {
        api.proxy.onRequest.removeListener(answer);
        api.proxy.onRequest.addListener(answer, filter, ['requestHeaders']);
      } catch { /* Stays as it was. */ }
    },
  };
}
