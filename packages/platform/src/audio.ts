// Notification sound in the event page (architecture.md §9.8; SN-014): one
// AudioContext for the whole extension, resumed within 1.5 s before a tone,
// a tone synthesized from the parameters the sound policy hands over (the
// eight tone tables are R17's, SN-013). A context that will not run is
// CG-AUDIO-BLOCKED — the options page's «Проверить звук» click wakes it.

export type ToneWave = 'sine' | 'square' | 'triangle' | 'sawtooth';

/** One oscillator of a tone. */
export interface ToneNote {
  readonly frequencyHz: number;
  /** Glide to this frequency by the end of the note. */
  readonly endFrequencyHz?: number;
  readonly startMs: number;
  readonly durationMs: number;
  readonly wave?: ToneWave;
  /** Peak level of this note, 0–1 (default 1), before the volume. */
  readonly gain?: number;
  /** Rise time; the note then decays exponentially to silence. Default 5 ms. */
  readonly attackMs?: number;
}

export interface ToneSpec {
  readonly notes: readonly ToneNote[];
}

export interface AudioParamLike {
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
}

export interface OscillatorLike extends AudioNodeLike {
  type: string;
  readonly frequency: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface GainLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface AudioContextLike {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
}

export type AudioPlayResult = { readonly played: true } | { readonly played: false; readonly code: 'CG-AUDIO-BLOCKED'; readonly reason: 'unavailable' | 'suspended' | 'empty' };

export interface AudioStats {
  readonly played: number;
  readonly blocked: number;
  readonly contextState: string | null;
}

export interface AudioPlayer {
  /** `volume` 0–1 (settings `sound.volume` / 100). */
  play(tone: ToneSpec, volume: number): Promise<AudioPlayResult>;
  stats(): AudioStats;
  close(): Promise<void>;
}

export interface AudioPlayerOptions {
  readonly createContext?: () => AudioContextLike;
  readonly resumeTimeoutMs?: number;
}

/** §9.8, SN-014. */
export const AUDIO_RESUME_TIMEOUT_MS = 1500;

/** Bounds a tone is clamped to: audible range, at most 16 notes within 5 s. */
export const TONE_BOUNDS = { minHz: 20, maxHz: 20_000, maxNotes: 16, maxMs: 5000, silence: 0.0001 } as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const finite = (value: number | undefined, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

function defaultContext(): AudioContextLike {
  return new AudioContext();
}

async function resumeWithin(context: AudioContextLike, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([context.resume().catch(() => undefined), new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export function createAudioPlayer(options: AudioPlayerOptions = {}): AudioPlayer {
  const create = options.createContext ?? defaultContext;
  const resumeTimeoutMs = options.resumeTimeoutMs ?? AUDIO_RESUME_TIMEOUT_MS;
  let context: AudioContextLike | null = null;
  let played = 0;
  let blocked = 0;

  const ensure = (): AudioContextLike | null => {
    if (context && context.state !== 'closed') return context;
    try {
      context = create();
    } catch {
      context = null;
    }
    return context;
  };

  const refuse = (reason: 'unavailable' | 'suspended' | 'empty'): AudioPlayResult => {
    blocked += 1;
    return { played: false, code: 'CG-AUDIO-BLOCKED', reason };
  };

  return {
    async play(tone, volume) {
      const notes = tone.notes.slice(0, TONE_BOUNDS.maxNotes);
      if (notes.length === 0) return refuse('empty');
      const ctx = ensure();
      if (!ctx) return refuse('unavailable');
      if (ctx.state !== 'running') await resumeWithin(ctx, resumeTimeoutMs);
      if (ctx.state !== 'running') return refuse('suspended');
      const level = clamp(finite(volume, 0), 0, 1);
      const t0 = ctx.currentTime + 0.01;
      try {
        for (const note of notes) {
          const start = t0 + clamp(finite(note.startMs, 0), 0, TONE_BOUNDS.maxMs) / 1000;
          const duration = clamp(finite(note.durationMs, 0), 1, TONE_BOUNDS.maxMs) / 1000;
          const attack = Math.min(duration / 2, clamp(finite(note.attackMs, 5), 0, TONE_BOUNDS.maxMs) / 1000);
          const peak = Math.max(TONE_BOUNDS.silence, level * clamp(finite(note.gain, 1), 0, 1));
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          oscillator.type = note.wave ?? 'sine';
          oscillator.frequency.setValueAtTime(clamp(finite(note.frequencyHz, 440), TONE_BOUNDS.minHz, TONE_BOUNDS.maxHz), start);
          if (note.endFrequencyHz !== undefined) {
            oscillator.frequency.exponentialRampToValueAtTime(clamp(finite(note.endFrequencyHz, 440), TONE_BOUNDS.minHz, TONE_BOUNDS.maxHz), start + duration);
          }
          gain.gain.setValueAtTime(TONE_BOUNDS.silence, start);
          gain.gain.linearRampToValueAtTime(peak, start + attack);
          gain.gain.exponentialRampToValueAtTime(TONE_BOUNDS.silence, start + duration);
          oscillator.connect(gain);
          gain.connect(ctx.destination);
          oscillator.start(start);
          oscillator.stop(start + duration + 0.02);
        }
      } catch {
        return refuse('unavailable');
      }
      played += 1;
      return { played: true };
    },
    stats: () => ({ played, blocked, contextState: context?.state ?? null }),
    async close() {
      const ctx = context;
      context = null;
      if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => undefined);
    },
  };
}
