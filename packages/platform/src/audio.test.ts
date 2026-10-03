import { afterEach, describe, expect, it, vi } from 'vitest';

import { AUDIO_RESUME_TIMEOUT_MS, createAudioPlayer, type AudioContextLike, type ToneSpec } from './audio';
import { DOWNLOAD_URL_TTL_MS, downloadFile, safeFileName } from './download';
import { writeClipboardText } from './clipboard';

interface Call {
  readonly node: string;
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeContext(
  initial: string,
  resume: (ctx: { state: string }) => Promise<void> = (ctx) => {
    ctx.state = 'running';
    return Promise.resolve();
  },
) {
  const calls: Call[] = [];
  const param = (node: string) => ({
    setValueAtTime: (...args: unknown[]) => calls.push({ node, method: 'set', args }),
    linearRampToValueAtTime: (...args: unknown[]) => calls.push({ node, method: 'linear', args }),
    exponentialRampToValueAtTime: (...args: unknown[]) => calls.push({ node, method: 'exp', args }),
  });
  const ctx = {
    state: initial,
    currentTime: 2,
    destination: { connect: () => undefined },
    resume: () => resume(ctx),
    close: () => {
      ctx.state = 'closed';
      return Promise.resolve();
    },
    createOscillator: () => {
      const osc = {
        type: 'sine',
        frequency: param('freq'),
        connect: () => calls.push({ node: 'osc', method: 'connect', args: [] }),
        start: (when?: number) => calls.push({ node: 'osc', method: 'start', args: [when, osc.type] }),
        stop: (when?: number) => calls.push({ node: 'osc', method: 'stop', args: [when] }),
      };
      return osc;
    },
    createGain: () => ({ gain: param('gain'), connect: () => calls.push({ node: 'gain', method: 'connect', args: [] }) }),
  };
  return { ctx: ctx as AudioContextLike & { state: string }, calls };
}

const chime: ToneSpec = {
  notes: [
    { frequencyHz: 880, startMs: 0, durationMs: 120, wave: 'triangle', gain: 0.8 },
    { frequencyHz: 1320, endFrequencyHz: 990, startMs: 90, durationMs: 200 },
  ],
};

describe('[SN-014] one AudioContext in the event page, resumed within 1.5 s', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates the context once, resumes a suspended one and schedules the synthesized notes', async () => {
    const { ctx, calls } = fakeContext('suspended');
    const create = vi.fn(() => ctx);
    const player = createAudioPlayer({ createContext: create });
    expect(await player.play(chime, 0.5)).toEqual({ played: true });
    expect(await player.play(chime, 0.5)).toEqual({ played: true });
    expect(create).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.method === 'start')).toHaveLength(4);
    const starts = calls.filter((c) => c.method === 'start').slice(0, 2);
    expect(starts[0]?.args[1]).toBe('triangle');
    expect(starts[1]?.args[0]).toBeCloseTo(2.01 + 0.09, 5);
    // Peak gain = volume × note gain; the glide note ramps its frequency.
    expect(calls.find((c) => c.node === 'gain' && c.method === 'linear')?.args[0]).toBeCloseTo(0.4, 5);
    expect(calls.some((c) => c.node === 'freq' && c.method === 'exp' && c.args[0] === 990)).toBe(true);
    expect(player.stats()).toEqual({ played: 2, blocked: 0, contextState: 'running' });
  });

  it('a context that does not run within 1.5 s is CG-AUDIO-BLOCKED', async () => {
    vi.useFakeTimers();
    const { ctx } = fakeContext('suspended', () => new Promise(() => undefined));
    const player = createAudioPlayer({ createContext: () => ctx });
    const result = player.play(chime, 1);
    await vi.advanceTimersByTimeAsync(AUDIO_RESUME_TIMEOUT_MS - 1);
    let settled = false;
    void result.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ played: false, code: 'CG-AUDIO-BLOCKED', reason: 'suspended' });
    expect(player.stats().blocked).toBe(1);
  });

  it('refuses an empty tone, a missing AudioContext and a broken node graph; clamps wild parameters', async () => {
    const empty = createAudioPlayer({ createContext: () => fakeContext('running').ctx });
    expect(await empty.play({ notes: [] }, 1)).toEqual({ played: false, code: 'CG-AUDIO-BLOCKED', reason: 'empty' });
    const missing = createAudioPlayer({
      createContext: () => {
        throw new Error('no audio');
      },
    });
    expect(await missing.play(chime, 1)).toEqual({ played: false, code: 'CG-AUDIO-BLOCKED', reason: 'unavailable' });
    const { ctx: broken } = fakeContext('running');
    broken.createGain = () => {
      throw new Error('x');
    };
    expect(await createAudioPlayer({ createContext: () => broken }).play(chime, 1)).toMatchObject({ played: false, reason: 'unavailable' });
    const { ctx, calls } = fakeContext('running');
    const player = createAudioPlayer({ createContext: () => ctx });
    expect(await player.play({ notes: [{ frequencyHz: 1e9, startMs: -5, durationMs: 1e9, gain: 7 }] }, Number.NaN)).toEqual({ played: true });
    const freq = calls.find((c) => c.node === 'freq' && c.method === 'set');
    expect(freq?.args[0]).toBe(20_000);
    const stop = calls.find((c) => c.method === 'stop');
    expect(stop?.args[0]).toBeCloseTo(2.01 + 5 + 0.02, 5);
    // A closed context is replaced by a new one.
    await player.close();
    expect(player.stats().contextState).toBeNull();
    await player.close();
  });
});

describe('clipboard (§14: only on a gesture)', () => {
  it('writes inside a gesture, refuses outside one, maps failures to CG-CLIPBOARD', async () => {
    const writes: string[] = [];
    const clipboard = {
      writeText: (text: string) => {
        writes.push(text);
        return Promise.resolve();
      },
    };
    expect(await writeClipboardText('part one', { clipboard, userActivation: { isActive: true } })).toEqual({ ok: true });
    expect(await writeClipboardText('part one', { clipboard, userActivation: { isActive: false } })).toEqual({ ok: false, code: 'CG-CLIPBOARD', reason: 'no-gesture' });
    expect(await writeClipboardText('x', {})).toEqual({ ok: false, code: 'CG-CLIPBOARD', reason: 'unavailable' });
    expect(await writeClipboardText('x', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } })).toEqual({ ok: false, code: 'CG-CLIPBOARD', reason: 'refused' });
    expect(await writeClipboardText('x', undefined)).toMatchObject({ ok: false });
    expect(writes).toEqual(['part one']);
  });
});

describe('download through a Blob (no downloads permission)', () => {
  it('clicks a hidden link with a safe file name and revokes the URL later', async () => {
    const clicks: { href: string; download: string }[] = [];
    const appended: unknown[] = [];
    const timers: { fn: () => void; ms: number }[] = [];
    const revoked: string[] = [];
    let blob: Blob | null = null;
    const link = { href: '', download: '', rel: '', style: { display: '' }, click: () => clicks.push({ href: link.href, download: link.download }), remove: () => undefined };
    const ok = downloadFile(
      { fileName: '../diag:2026/10/03.json', mime: 'application/json', body: '{"a":1}' },
      {
        document: { createElement: () => link, body: { append: (node: unknown) => appended.push(node) } } as never,
        createObjectURL: (b) => ((blob = b), 'blob:moz-extension://x/1'),
        revokeObjectURL: (url) => revoked.push(url),
        setTimeout: (fn, ms) => timers.push({ fn, ms }),
      },
    );
    expect(ok).toBe(true);
    expect(clicks).toEqual([{ href: 'blob:moz-extension://x/1', download: '_diag_2026_10_03.json' }]);
    expect(appended).toEqual([link]);
    expect(await (blob as Blob | null)?.text()).toBe('{"a":1}');
    expect(timers[0]?.ms).toBe(DOWNLOAD_URL_TTL_MS);
    timers[0]?.fn();
    expect(revoked).toEqual(['blob:moz-extension://x/1']);
    expect(downloadFile({ fileName: 'a', mime: 'text/plain', body: '' }, { createObjectURL: () => { throw new Error('x'); } } as never)).toBe(false);
    expect(safeFileName('...')).toBe('chatgoose');
    expect(safeFileName('a\u0000b')).toBe('a_b');
    expect(safeFileName('x'.repeat(300))).toHaveLength(128);
  });
});
