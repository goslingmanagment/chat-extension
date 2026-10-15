// FS-CO-1 / NEW-12. The content script can see DOM markers, never MAIN's
// Symbol. MAIN supplies that fact in fx.identity. No recovery without reload:
// removing the old DOM does not remove its socket tap or event listeners.
import { hasLegacyDom, INSTANCE_ATTRIBUTE, RELOAD_ATTRIBUTE, type StopReason } from './legacy-markers';
import { showReloadNotice } from './notice';

export interface Coexistence {
  readonly stopped: AbortSignal;
  readonly ready: Promise<void>;
  reason(): StopReason | null;
  check(): void;
  stop(reason: StopReason): void;
  dispose(): void;
}

export function watchCoexistence(win: Window, staleHosts = 0): Coexistence {
  const doc = win.document;
  const controller = new AbortController();
  let reason: StopReason | null = null;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
  const stop = (next: StopReason): void => {
    if (reason !== null) return;
    reason = next;
    controller.abort(next);
    if (doc.documentElement) showReloadNotice(doc, next);
    resolveReady();
  };
  const check = (): void => {
    if (hasLegacyDom(doc)) stop('legacy');
    else if (doc.documentElement?.hasAttribute(RELOAD_ATTRIBUTE)) stop('update');
  };
  let claimed = false;
  const claim = (): void => {
    const root = doc.documentElement;
    if (!root || claimed) return;
    claimed = true;
    if (root.hasAttribute(INSTANCE_ATTRIBUTE)) {
      root.setAttribute(RELOAD_ATTRIBUTE, 'update');
      stop('update');
    } else root.setAttribute(INSTANCE_ATTRIBUTE, '1');
  };
  check();
  if (staleHosts > 0) stop('update');
  claim();
  const onReady = (): void => {
    claim();
    if (doc.documentElement) observer.observe(doc.documentElement, { attributes: true, attributeFilter: [RELOAD_ATTRIBUTE] });
    check();
    if (reason !== null) showReloadNotice(doc, reason);
    // All extensions have finished their DOMContentLoaded listeners before admission.
    win.setTimeout(() => { check(); resolveReady(); }, 0);
  };
  // Attribute-only observation: an update/reinjection invalidates an existing
  // copy immediately, without a whole-document subtree observer or polling.
  const observer = new MutationObserver(check);
  if (doc.documentElement) observer.observe(doc.documentElement, { attributes: true, attributeFilter: [RELOAD_ATTRIBUTE] });
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', onReady, { once: true });
  else onReady();
  return { stopped: controller.signal, ready, reason: () => reason, check, stop, dispose: () => { observer.disconnect(); doc.removeEventListener('DOMContentLoaded', onReady); } };
}
