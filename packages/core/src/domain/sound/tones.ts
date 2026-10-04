// The eight notification tones (architecture.md §9.8; SN-013, ST-127,
// ST-129, ST-130): synthesized — no audio files, no network. The tables are
// the Fansly extension's, note for note (`blip` at volume 50 is the OnlyFans
// desktop app's notification blip); the background's player
// (`@cg/platform` createAudioPlayer) schedules them: this shape is its
// ToneSpec.

import { type Platform } from '@cg/contracts/ids';
import { SETTINGS_RANGES, SOUND_TONE_IDS, type SettingsV1, type ToneId } from '@cg/contracts/settings';

export type ToneWave = 'sine' | 'square' | 'triangle' | 'sawtooth';

/** One oscillator of a tone; times in ms from the tone's start. */
export interface SoundNote {
  readonly wave: ToneWave;
  readonly startMs: number;
  /** The gain is back at silence here. */
  readonly durationMs: number;
  readonly frequencyHz: number;
  /** Pitch glide target, reached `glideMs` after the note starts. */
  readonly endFrequencyHz?: number;
  readonly glideMs?: number;
  readonly attackMs: number;
}

export interface SoundTone {
  readonly notes: readonly SoundNote[];
}

const steady = (wave: ToneWave, startMs: number, frequencyHz: number, attackMs: number, durationMs: number): SoundNote => ({ wave, startMs, durationMs, frequencyHz, attackMs });
const glide = (wave: ToneWave, startMs: number, frequencyHz: number, endFrequencyHz: number, glideMs: number, attackMs: number, durationMs: number): SoundNote => ({
  wave,
  startMs,
  durationMs,
  frequencyHz,
  endFrequencyHz,
  glideMs,
  attackMs,
});

export const TONES: Readonly<Record<ToneId, SoundTone>> = {
  /** Two bright notes a sixth apart (C6 → A6), the second ringing longer. */
  chime: { notes: [steady('sine', 0, 1047, 10, 160), steady('sine', 110, 1760, 10, 300)] },
  /** A falling water drop. */
  drop: { notes: [glide('sine', 0, 1400, 520, 100, 5, 160)] },
  /** One high bell with a long tail and its octave. */
  bell: { notes: [steady('sine', 0, 1568, 5, 700), steady('sine', 0, 3136, 5, 250)] },
  /** A quick rising major arpeggio (A5 · C♯6 · E6). */
  arpeggio: { notes: [steady('triangle', 0, 880, 8, 70), steady('triangle', 70, 1109, 8, 70), steady('triangle', 140, 1319, 8, 160)] },
  /** Two soft low knocks. */
  knock: { notes: [glide('triangle', 0, 330, 220, 50, 4, 80), glide('triangle', 140, 330, 220, 50, 4, 80)] },
  /** Two short high beeps. */
  double: { notes: [steady('sine', 0, 1320, 10, 60), steady('sine', 130, 1320, 10, 60)] },
  /** A soft rising triangle. */
  soft: { notes: [glide('triangle', 0, 660, 990, 120, 30, 350)] },
  /** The OnlyFans desktop app's blip: 880 → 1320 Hz. */
  blip: { notes: [glide('sine', 0, 880, 1320, 80, 20, 180)] },
};

export function toneOf(id: ToneId): SoundTone {
  return TONES[id];
}

export function isToneId(value: unknown): value is ToneId {
  return typeof value === 'string' && (SOUND_TONE_IDS as readonly string[]).includes(value);
}

/** The whole tone, start to silence, ms: a preview or a throttle never cuts shorter than this. */
export function toneDurationMs(tone: SoundTone): number {
  return tone.notes.reduce((end, note) => Math.max(end, note.startMs + note.durationMs), 0);
}

// ── volume ─────────────────────────────────────────────────────────────────

/** The loudest peak gain (volume 100): +12 dB over the default. */
export const MAX_PEAK_GAIN = 0.24;

/** 5–100 in steps of 5 (ST-130); anything else falls back to the nearest step, a non-number to 50. */
export function normalizeVolume(raw: unknown): number {
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 50;
  const { min, max, step } = SETTINGS_RANGES.volume;
  return Math.min(max, Math.max(min, Math.round(value / step) * step));
}

/** Quadratic, the way ears expect a slider to behave: 50 → 0.06, 100 → 0.24. This is the player's level. */
export function volumeToGain(volume: unknown): number {
  const normalized = normalizeVolume(volume) / 100;
  return MAX_PEAK_GAIN * normalized * normalized;
}

// ── defaults ───────────────────────────────────────────────────────────────

export type SoundKind = 'message' | 'subscriber';

/**
 * Default tones per platform (§9.8: «У OnlyFans и Fansly разные тона по
 * умолчанию»). OnlyFans is the pilot's host and its row IS the settings
 * default (chime, double — contracts DEFAULT_SETTINGS, ST-127, ST-129), so
 * what the settings page shows is what rings. Fansly (phase 2, R20) gets the
 * other pair of the two old clients, so a chatter working both hosts in one
 * browser hears which one rings. Which pair goes to which platform is the
 * owner's call (ui-design §9.4 п. 4); it is one table.
 */
export const PLATFORM_DEFAULT_TONES: Readonly<Record<Platform, Readonly<Record<SoundKind, ToneId>>>> = {
  onlyfans: { message: 'chime', subscriber: 'double' },
  fansly: { message: 'blip', subscriber: 'arpeggio' },
};

/**
 * The tone that rings: the person's explicit choice wins. Settings v1 keep
 * one tone per kind for every host, so «explicit» is «differs from the
 * schema default»; an untouched setting gives the platform's own default.
 */
export function resolveTone(kind: SoundKind, platform: Platform, sound: SettingsV1['sound'], schemaDefault: SettingsV1['sound']): ToneId {
  const chosen = kind === 'message' ? sound.messages.tone : sound.subscribers.tone;
  const untouched = kind === 'message' ? schemaDefault.messages.tone : schemaDefault.subscribers.tone;
  return chosen === untouched ? PLATFORM_DEFAULT_TONES[platform][kind] : chosen;
}
