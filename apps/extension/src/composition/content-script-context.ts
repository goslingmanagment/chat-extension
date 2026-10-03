// Stand-in for WXT's ContentScriptContext in the isolated ChatSpace content
// script (architecture.md §11 «ранний бутстрап ≤ 3 мс»). wxt.config.ts aliases
// `wxt/utils/content-script-context` to this file for that one entry point.
//
// Why: WXT's class reads `browser.runtime.id` while it is being defined (its
// static event names) and its module pulls @wxt-dev/browser, whose top level
// reads `globalThis.browser.runtime` too. The first touch of the WebExtension
// API in a new document costs ~3 ms cold (measured with the spike-m0 e2e in
// R09: an empty content script with WXT's context took 5.2 ms on its first
// start after install, 0.5 ms later; without it 0.02 ms), which alone broke
// the 3 ms budget. Our lifecycle never relied on that context anyway
// (composition/tab.ts: its invalidation event can be dispatched by the page);
// the extension going away is seen through the runtime port. This class keeps
// the shape tab.ts uses and touches nothing of the browser API.

export class ContentScriptContext {
  private readonly controller = new AbortController();

  constructor(
    readonly contentScriptName: string,
    readonly options?: unknown,
  ) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get isInvalid(): boolean {
    return this.controller.signal.aborted;
  }

  get isValid(): boolean {
    return !this.isInvalid;
  }

  /** Never fires on its own: no page-dispatchable «script started» event invalidates this context. */
  onInvalidated(callback: () => void): () => void {
    this.controller.signal.addEventListener('abort', callback);
    return () => this.controller.signal.removeEventListener('abort', callback);
  }

  abort(reason?: unknown): void {
    this.controller.abort(reason);
  }
}
