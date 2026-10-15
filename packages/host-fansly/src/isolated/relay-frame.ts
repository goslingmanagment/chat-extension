// The relay frame of «Fansly через вкладку» in a Fansly tab (R20 P9c;
// docs/project-unite/architecture.md §8.5; spec FS-NET-4, FS-PLC-6): the
// member `relay` of the Fansly page port (contracts fansly.ts
// `FanslyRelayFrame`).
//
// - Mounted only when asked (`open`: the background routes a request through
//   this tab), into an overlay host of our own — a plain `div` in <html> with a
//   closed root (X22), `position: fixed`, nothing to see or to click — so the
//   page sees no iframe and no `moz-extension:` address. The tab keeps
//   it for a batch of work and 60 s after; whoever asked closes it.
// - Its address names the account the tab is on now (`#a=<id>`): the frame
//   serves that account alone and says so to the background. Another account
//   later is another frame: a change of the tab's account takes the old one
//   down at once (`accountChanged`), so a request of the old account finds no
//   frame and leaves nowhere.
// - No account, or no relay page in this build: no frame (`failed`).
// - `open` settles when the frame's page has loaded (`open`) or failed to, or
//   its time ran out (`failed`, the frame taken down).

import type { FanslyRelayFrame } from '@cg/contracts/fansly';
import { mountClosedHost, type ClosedHost } from '@cg/host-kit/isolated/hosts';

/** How long `open` waits for the frame's page to load. */
export const RELAY_LOAD_TIMEOUT_MS = 10_000;

export interface RelayFrameOptions {
  readonly doc: Document;
  /**
   * The relay page (`moz-extension://<uuid>/fansly-relay.html`), asked when a frame is first mounted (the early start
   * does not touch the extension's API); undefined — none in this build.
   */
  readonly url: (() => Promise<string>) | undefined;
  /** The account the tab is on now (MAIN's identity); null — none yet. */
  readonly account: () => string | null;
  readonly loadTimeoutMs?: number;
  readonly onDiagnostic?: (diagnostic: { readonly event: string; readonly detail?: Readonly<Record<string, string | number | boolean | null>> }) => void;
}

export interface RelayFrameControl extends FanslyRelayFrame {
  /** The tab's account changed: the frame of the old one goes at once. */
  accountChanged(): void;
  /** A frame is in the page now. */
  mounted(): boolean;
}

interface Mounted {
  readonly host: ClosedHost;
  readonly account: string;
  /** Settles once: the page loaded, failed, or the frame went first. */
  readonly loaded: Promise<'open' | 'failed'>;
  readonly settle: (outcome: 'open' | 'failed') => void;
}

const HIDDEN_HOST = 'position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; overflow: hidden !important; visibility: hidden !important; pointer-events: none !important;';
const HIDDEN_FRAME = 'width: 0; height: 0; border: 0;';

export function createRelayFrame(options: RelayFrameOptions): RelayFrameControl {
  const { doc } = options;
  const timeoutMs = options.loadTimeoutMs ?? RELAY_LOAD_TIMEOUT_MS;
  let current: Mounted | null = null;

  const close = (): void => {
    const mounted = current;
    if (mounted === null) return;
    current = null;
    mounted.settle('failed');
    mounted.host.remove();
    options.onDiagnostic?.({ event: 'relay-frame', detail: { state: 'closed' } });
  };

  const mount = (url: () => Promise<string>, account: string): Mounted => {
    const host = mountClosedHost(doc.documentElement, 'overlay', 'last');
    host.host.setAttribute('style', HIDDEN_HOST);
    let resolve: (outcome: 'open' | 'failed') => void = () => undefined;
    const loaded = new Promise<'open' | 'failed'>((done) => {
      resolve = done;
    });
    let settled = false;
    // Settles once; a frame that did not come up goes (an iframe has no error event: the time limit says it).
    const settle = (outcome: 'open' | 'failed'): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
      if (outcome === 'failed' && current === mounted) close();
    };
    const timer = setTimeout(() => settle('failed'), timeoutMs);
    const frame = doc.createElement('iframe');
    frame.setAttribute('style', HIDDEN_FRAME);
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.tabIndex = -1;
    frame.addEventListener('load', () => settle('open'), { once: true });
    const mounted: Mounted = { host, account, loaded, settle };
    void url().then(
      (address) => {
        // Taken down meanwhile: nothing loads.
        if (current !== mounted) return;
        frame.setAttribute('src', `${address}#a=${encodeURIComponent(account)}`);
        host.root.append(frame);
        options.onDiagnostic?.({ event: 'relay-frame', detail: { state: 'mounted' } });
      },
      () => settle('failed'),
    );
    return mounted;
  };

  return {
    open() {
      const account = options.account();
      if (options.url === undefined || account === null) return Promise.resolve('failed');
      // A frame of another account is no frame of this one.
      if (current !== null && (current.account !== account || !current.host.host.isConnected)) close();
      current ??= mount(options.url, account);
      return current.loaded;
    },
    close,
    accountChanged() {
      if (current !== null && current.account !== options.account()) close();
    },
    mounted: () => current !== null,
  };
}
