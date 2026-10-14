// Keystroke latency in the stand page's composer (R20 P3d, for P16a too: «p95
// ввода ≤ база + 5 мс», plan.md §4). Event Timing in Firefox reports only
// events of 16 ms and more, in 8-ms steps — a typed letter usually costs
// less — so the probe measures in the page itself, from the page's main
// world, for every trusted keystroke that changes the field:
// - `handled`: from the keydown's own time stamp to the end of the task that
//   dispatched it — keydown, keypress, beforeinput and input with every
//   listener of the page, of the neighbour and of an extension's content
//   scripts (a message posted from the `input` listener runs right after
//   that task);
// - `frame`: to the next animation frame after that — what a person sees.
// The letters are typed by WebDriver as separate key presses with a pause
// between them, as a person types, never as one burst.

import { browser } from '@wdio/globals';

const PROBE = '__cgInputProbe';

export interface LatencySample {
  readonly handled: number;
  readonly frame: number;
}

export interface LatencySummary {
  readonly keys: number;
  readonly handled: Percentiles;
  readonly frame: Percentiles;
}

export interface Percentiles {
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly mean: number;
}

/** Installs the probe in the page (once per document). */
export async function installInputProbe(): Promise<void> {
  await browser.execute((name: string) => {
    const scope = window as unknown as Record<string, { samples: Array<{ handled: number; frame: number }> } | undefined>;
    if (scope[name] !== undefined) return;
    const state = { samples: [] as Array<{ handled: number; frame: number }> };
    scope[name] = state;
    let pending: number | null = null;
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.isTrusted) pending = event.timeStamp;
      },
      true,
    );
    window.addEventListener('input', (event) => {
      if (!event.isTrusted || pending === null) return;
      const start = pending;
      pending = null;
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        const handled = performance.now() - start;
        requestAnimationFrame(() => state.samples.push({ handled, frame: performance.now() - start }));
        channel.port1.close();
      };
      channel.port2.postMessage(null);
    });
  }, PROBE);
}

/** Takes the samples gathered so far and empties the probe. */
export async function takeLatencySamples(): Promise<LatencySample[]> {
  return browser.execute((name: string) => {
    const state = (window as unknown as Record<string, { samples: Array<{ handled: number; frame: number }> } | undefined>)[name];
    if (state === undefined) return [];
    const taken = state.samples;
    state.samples = [];
    return taken;
  }, PROBE);
}

export function percentiles(values: readonly number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? 0;
  const round = (value: number): number => Math.round(value * 100) / 100;
  const mean = sorted.length === 0 ? 0 : sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return { p50: round(at(0.5)), p95: round(at(0.95)), max: round(sorted.at(-1) ?? 0), mean: round(mean) };
}

export function summarizeLatency(samples: readonly LatencySample[]): LatencySummary {
  return { keys: samples.length, handled: percentiles(samples.map((sample) => sample.handled)), frame: percentiles(samples.map((sample) => sample.frame)) };
}

/**
 * Types `text` into the focused field as separate key presses, `gapMs` apart (one WebDriver action chain: the gaps are
 * the browser's, not the round trips').
 */
export async function typeSlowly(text: string, gapMs = 70): Promise<void> {
  const keys = browser.action('key');
  for (const char of text) keys.down(char).up(char).pause(gapMs);
  await keys.perform();
}
