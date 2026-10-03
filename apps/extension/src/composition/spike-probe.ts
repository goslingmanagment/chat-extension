// Spike M0 diagnostics — compiled into CG_TEST_HOSTS builds only (composition
// passes `testBuild`, a compile-time constant, so the release bundle drops it).
// Writes a JSON report to <html data-cg-spike> for the e2e: the e2e cannot
// look inside our closed shadow roots, so the extension reports for itself.

import type { ClosedHost } from '@cg/host-chatspace/isolated';
import { mountClosedHost } from '@cg/host-chatspace/isolated';
import { extensionUrl } from '@cg/platform';

import type * as SpikeChunk from '../../lazy/entries/spike';

export const LAZY_SPIKE_PATH = 'lazy/spike.js';
/** Same key as build/bundle-timing.ts (the marks around this bundle, test builds only). */
const BUNDLE_MARKS_KEY = '__cgBundleMarks';

export interface SpikeProbe {
  set(key: string, value: unknown): void;
  /** composeTab's own synchronous time; the bundle-wide number follows a task later. */
  bootstrapped(composeMs: number): void;
  dockMounted(host: ClosedHost, metrics: Record<string, unknown>): void;
}

interface BundleMarks {
  readonly t0?: number;
  readonly t1?: number;
}

export function createSpikeProbe(win: Window): SpikeProbe {
  const doc = win.document;
  const html = doc.documentElement;
  const state: Record<string, unknown> = { startedAt: performance.now(), readyStateAtStart: doc.readyState };
  const flush = (): void => html.setAttribute('data-cg-spike', JSON.stringify(state));
  const set = (key: string, value: unknown): void => {
    state[key] = value;
    flush();
  };
  flush();

  return {
    set,
    bootstrapped(composeMs) {
      // The bundle's last statement (t1) runs after main() returns: read it a task later.
      setTimeout(() => {
        const marks = Reflect.get(globalThis, BUNDLE_MARKS_KEY) as BundleMarks | undefined;
        const bundleMs = marks?.t0 !== undefined && marks.t1 !== undefined ? marks.t1 - marks.t0 : null;
        set('bootstrap', { composeMs, bundleMs });
      }, 0);
    },
    dockMounted(host, metrics) {
      const root = host.root;
      // Computed inside the closed root: proves our stylesheet applies (unstyled, the row is ~22 px).
      const toolbar = root.querySelector('[role="toolbar"]');
      const computed = toolbar ? getComputedStyle(toolbar) : null;
      const style = computed ? { display: computed.display, height: computed.height, boxSizing: computed.boxSizing } : null;
      set('dock', { ...metrics, style, inFlowFirstChild: host.host.parentElement?.firstElementChild === host.host });
      const input = root.querySelector('input');
      const focusState = (): Record<string, unknown> => ({
        rootActive: root.activeElement?.tagName ?? null,
        docActiveIsHost: doc.activeElement === host.host,
        value: input?.value ?? null,
      });
      root.addEventListener('focusin', () => set('focus', focusState()));
      root.addEventListener('input', () => set('focus', focusState()));
      root.addEventListener('compositionstart', () => set('ime', 'compositionstart'));
      root.addEventListener('compositionend', () => set('ime', 'compositionend'));
      // The spike list only on the M0 stand page, never on a real host.
      if (html.getAttribute('data-cg-stand') !== 'spike') return;
      void loadSpikeList(doc).then(
        (result) => set('list', result),
        (error: unknown) => set('listError', String(error)),
      );
    },
  };
}

async function loadSpikeList(doc: Document): Promise<Record<string, unknown>> {
  const started = performance.now();
  const chunk = (await import(/* @vite-ignore */ extensionUrl(LAZY_SPIKE_PATH))) as typeof SpikeChunk;
  const loadMs = performance.now() - started;
  const overlay = mountClosedHost(doc.documentElement, 'overlay', 'last');
  overlay.host.style.setProperty('position', 'fixed');
  overlay.host.style.setProperty('top', '8px');
  overlay.host.style.setProperty('right', '8px');
  overlay.host.style.setProperty('width', '260px');
  overlay.host.style.setProperty('z-index', '950');
  const result = chunk.mountSpikeList(overlay.root, 1000);
  const paintStarted = performance.now();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return { loadMs, ...result, firstFrameMs: performance.now() - paintStarted };
}
