/**
 * @vitest-environment-options {"settings":{"disableIframePageLoading":true,"disableJavaScriptFileLoading":true,"disableCSSFileLoading":true}}
 */
// The fan panel's windows of Workboard over the site (tab/frames.ts `form`), on the real frames controller and the real
// frame host in happy-dom: whatever the clicks, one window at most, every open settles, Esc closes the one that is up.

import type { ColorScheme, ValueSignal } from '@cg/contracts/vm';
import type { TabRpcClient } from '@cg/platform';
import { afterEach, describe, expect, it } from 'vitest';

import { createWorkboardFrames, type WorkboardFrames } from './frames';

const LAYER = 'div[data-host="overlay"][data-layer="frame"]';
const FOR = { pageLabel: 'test-1', fanRef: '9990000000000000004', fanName: 'Fan' } as const;

/** The background's `report.state`, answered when the test says so (the first answer about the origin is slow). */
function slowOrigin(): { readonly rpc: TabRpcClient; release(): void } {
  const waiting: (() => void)[] = [];
  const rpc = {
    request: (type: string) =>
      type === 'report.state'
        ? new Promise((resolve) => waiting.push(() => resolve({ ok: true, payload: { report: null, origin: 'https://team.example.test' } })))
        : Promise.resolve({ ok: true, payload: { recorded: true } }),
  } as unknown as TabRpcClient;
  return {
    rpc,
    release: () => {
      for (const answer of waiting.splice(0)) answer();
    },
  };
}

const scheme: ValueSignal<ColorScheme> = { value: 'light', subscribe: () => () => undefined } as unknown as ValueSignal<ColorScheme>;
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};
let made: WorkboardFrames | null = null;

function frames(rpc: TabRpcClient): WorkboardFrames {
  made = createWorkboardFrames({ win: window, rpc, tokens: '', scheme, saleLook: null, log: () => undefined });
  return made;
}

afterEach(() => {
  made?.dispose();
  made = null;
  for (const node of document.querySelectorAll(LAYER)) node.remove();
});

describe('Workboard windows of the fan panel (frames.form)', () => {
  it('two first clicks before the origin is known: one window, the first open settles not done, Esc closes the one up', async () => {
    const origin = slowOrigin();
    const tab = frames(origin.rpc);
    const settled: string[] = [];
    const first = tab.form('custom', FOR).then((outcome) => {
      settled.push(`first:${String(outcome.done)}`);
      return outcome;
    });
    const second = tab.form('custom', FOR).then((outcome) => {
      settled.push(`second:${String(outcome.done)}`);
      return outcome;
    });
    origin.release();
    await flush();
    expect(document.querySelectorAll(LAYER)).toHaveLength(1);
    expect(await first).toEqual({ done: false });
    expect(settled).toEqual(['first:false']);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await second).toEqual({ done: false });
    expect(document.querySelectorAll(LAYER)).toHaveLength(0);
  });

  it('another window opened while one is up takes its place: the first settles not done, one host stays', async () => {
    const origin = slowOrigin();
    const tab = frames(origin.rpc);
    const first = tab.form('custom', FOR);
    origin.release();
    await flush();
    expect(document.querySelectorAll(LAYER)).toHaveLength(1);
    const second = tab.form('ask', FOR);
    origin.release();
    await flush();
    expect(await first).toEqual({ done: false });
    expect(document.querySelectorAll(LAYER)).toHaveLength(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await second).toEqual({ done: false });
    expect(document.querySelectorAll(LAYER)).toHaveLength(0);
  });
});
