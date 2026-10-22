// The voice studio's player (1.47.0): a take's MP3 decoded once into an
// AudioBuffer — its true length, and the peaks its waveform is drawn from —
// and played through Web Audio. No <audio> and no object URL: a page's media
// policy has no say over a buffer we play ourselves (ChatSpace, fansly.com),
// and nothing of the file leaves our closed root. One take plays at a time;
// nothing plays by itself.

import { signal, type ReadonlySignal } from '@preact/signals';

/** Bars of a take's waveform. */
export const WAVE_BARS = 56;

export interface DecodedTake {
  readonly duration: number;
  /** WAVE_BARS heights in [0.08, 1]: the loudest sample of each slice, scaled to the loudest slice. */
  readonly peaks: readonly number[];
  readonly buffer: AudioBuffer;
}

/** What plays now: the take (by its audio's sha256), from where, since when on the context's clock. */
export interface NowPlaying {
  readonly sha256: string;
  readonly offset: number;
  readonly startedAt: number;
  readonly duration: number;
}

type AudioWindow = Window & { readonly AudioContext?: typeof AudioContext; readonly OfflineAudioContext?: typeof OfflineAudioContext };

let context: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
const decoded = new Map<string, Promise<DecodedTake>>();
const playing = signal<NowPlaying | null>(null);
/** Where a paused take stopped, by its sha256: its next ▶ goes on from there. */
const paused = signal<ReadonlyMap<string, number>>(new Map());

/** The take that plays, for every row to read; null — silence. */
export const nowPlaying: ReadonlySignal<NowPlaying | null> = playing;
/** The paused takes and where they stopped. */
export const pausedAt: ReadonlySignal<ReadonlyMap<string, number>> = paused;

function withPaused(sha256: string, at: number | null): void {
  const next = new Map(paused.value);
  if (at === null) next.delete(sha256);
  else next.set(sha256, at);
  paused.value = next;
}

/** The one context that plays, made on the first ▶ (a click: the page's autoplay rules let it start). */
function contextOf(win: Window): AudioContext {
  if (context !== null && context.state !== 'closed') return context;
  const Ctor = (win as AudioWindow).AudioContext;
  if (Ctor === undefined) throw new Error('no Web Audio');
  context = new Ctor();
  return context;
}

/** A take is decoded offline: showing its waveform starts no audio and asks the page for nothing. */
function decoderOf(win: Window): BaseAudioContext {
  const Offline = (win as AudioWindow).OfflineAudioContext;
  if (Offline !== undefined) return new Offline(1, 1, 44_100);
  return contextOf(win);
}

function peaksOf(buffer: AudioBuffer): number[] {
  const data = buffer.getChannelData(0);
  const slice = Math.max(1, Math.floor(data.length / WAVE_BARS));
  const raw: number[] = [];
  for (let bar = 0; bar < WAVE_BARS; bar += 1) {
    let peak = 0;
    const end = Math.min(data.length, (bar + 1) * slice);
    // Every fourth sample is plenty for a 2 px bar.
    for (let i = bar * slice; i < end; i += 4) {
      const value = Math.abs(data[i] ?? 0);
      if (value > peak) peak = value;
    }
    raw.push(peak);
  }
  const loudest = Math.max(...raw, 1e-6);
  return raw.map((peak) => Math.max(0.08, Math.min(1, peak / loudest)));
}

/** A take decoded once per sha256: the same file, the same buffer, whichever row asks. */
export function decodeTake(win: Window, sha256: string, bytes: ArrayBuffer): Promise<DecodedTake> {
  const known = decoded.get(sha256);
  if (known !== undefined) return known;
  const run = (async (): Promise<DecodedTake> => {
    const ctx = decoderOf(win);
    // decodeAudioData takes the buffer over: the view's bytes stay whole for the handover and «Скачать».
    const buffer = await ctx.decodeAudioData(bytes.slice(0));
    return { duration: buffer.duration, peaks: peaksOf(buffer), buffer };
  })();
  decoded.set(sha256, run);
  run.catch(() => decoded.delete(sha256));
  return run;
}

/** Where a take is, in seconds: the playing one's live place, a paused one's stop; null — at its start, silent. */
export function positionOf(sha256: string): number | null {
  const now = playing.value;
  if (now !== null && now.sha256 === sha256 && context !== null) return Math.min(now.duration, now.offset + (context.currentTime - now.startedAt));
  return paused.value.get(sha256) ?? null;
}

/**
 * Plays a take from `offset` seconds — by default from where it was paused, else from its start; whatever played
 * pauses. Called on the person's click (the context may start then).
 */
export async function play(win: Window, sha256: string, take: DecodedTake, offset?: number): Promise<void> {
  pause();
  const at = offset ?? paused.value.get(sha256) ?? 0;
  const ctx = contextOf(win);
  if (ctx.state === 'suspended') await ctx.resume();
  const node = ctx.createBufferSource();
  node.buffer = take.buffer;
  node.connect(ctx.destination);
  const from = at >= take.duration - 0.05 ? 0 : Math.max(0, at);
  node.onended = () => {
    if (source !== node) return;
    // Played to its end: its next ▶ starts it again.
    source = null;
    playing.value = null;
    withPaused(sha256, null);
  };
  node.start(0, from);
  source = node;
  withPaused(sha256, null);
  playing.value = { sha256, offset: from, startedAt: ctx.currentTime, duration: take.duration };
}

/** Pauses what plays: the take keeps its place for the next ▶. */
export function pause(): void {
  const now = playing.value;
  if (now !== null) {
    const at = positionOf(now.sha256);
    if (at !== null) withPaused(now.sha256, at);
  }
  stop();
}

/** Stops what plays, keeping no place (the studio closed, another chat). */
export function stop(): void {
  const node = source;
  source = null;
  playing.value = null;
  if (node === null) return;
  node.onended = null;
  try {
    node.stop();
  } catch {
    // Already ended.
  }
  node.disconnect();
}

/** «m:ss» of seconds. */
export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`;
}
