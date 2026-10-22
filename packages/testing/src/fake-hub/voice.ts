// The voice-notes lane of the fake hub (hub services/voice-notes.ts and
// modules/voice, R20 HF-4а/б; OnlyFans pages too since hub #757): the
// admission of a paid render in the hub's order, its idempotent replay by
// `clientRequestId`, a render that goes from queued or dispatched to its end,
// and the MP3 of a completed one — real audio, one of three spoken takes
// (voice-audio.ts). No provider and no character budget: `billed` says what
// the hub would, and a test scripts what the hub's switches, its provider and
// its budget make of the next creates (`scriptVoice`).
//
// Time. A render's steps are hub time, scaled by the hub's `timeScale` like
// its SSE delays: with 0 a render is over by its first status read; with the
// manual clock of a unit test it moves only when the test moves the clock
// (`clock`), with the system clock of e2e and the stand by itself. Its state
// is read off the clock whenever it is asked for: nothing runs in the
// background.
//
// The extension's own routes since 1.46.0 (contracts hub/routes.ts); the hub
// keeps them SDK-only (`voiceNoteAudio` answers bytes: `fetchVoiceNoteAudio`).

import { createHash } from 'node:crypto';

import { type HubRouteKey, type VoiceNoteCreateBody, type VoiceNoteState, type VoiceNoteView } from '@cg/contracts';

import { type Generation } from './ai';
import { type PairState } from './ai-rules';
import { iso } from './clock';
import { voiceAudioSamples, type VoiceAudioSample } from './voice-audio';

export const VOICE_ROUTES = ['voiceNoteCreate', 'voiceNoteStatus', 'voiceNoteAudio'] as const satisfies readonly HubRouteKey[];
export type VoiceRoute = (typeof VOICE_ROUTES)[number];
export const isVoiceRoute = (route: HubRouteKey): route is VoiceRoute => (VOICE_ROUTES as readonly HubRouteKey[]).includes(route);

/** The hub's clientVersionRefusal (client-features.ts + chat-extension-settings.ts). */
export function voiceClientOutdated(minimum: string, header: string | null): boolean {
  const parse = (text: string): readonly [number, number, number] | null => {
    const match = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.exec(text);
    return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const min = parse(minimum);
  const version = header?.startsWith('chat-extension/') === true ? parse(header.slice('chat-extension/'.length)) : null;
  return min === null || version === null || (version[0] - min[0] || version[1] - min[1] || version[2] - min[2]) < 0;
}

// ── the hub's script rules (voice-script-validation.ts) ──────────────────

/** `VOICE_SCRIPT_ALLOWED_TAGS`: the only audio tags a script may carry, exact strings. */
export const HUB_VOICE_TAGS: readonly string[] = ['[warmly]', '[cheerfully]', '[thoughtful]', '[excited]', '[whispers]', '[chuckles]', '[giggles]', '[sighs]', '[short pause]', '[long pause]'];
/** The live `voiceNotesScriptMaxChars` at its default. */
export const HUB_VOICE_SCRIPT_MAX_CHARS = 600;

/** `canonicalizeVoiceScript`: what the hub hashes, checks and counts. */
export const canonicalVoiceScript = (script: string): string => script.normalize('NFC').replace(/\r\n/g, '\n').trim();

/** `computeVoiceRequestHash`: the frozen request hash (the extension computes the same); `fanRef` is not in it (HF-4а). */
export function voiceRequestHash(pageId: number, conversationRef: string, sourceGenerationRef: string, canonicalScript: string): string {
  return createHash('sha256').update(`${pageId}\n${conversationRef}\n${sourceGenerationRef}\n${canonicalScript}`).digest('hex');
}

/** `validateVoiceScript` of a canonical script: empty, too long, `<`/`>` markup, a bracket group off the list. */
export function voiceScriptInvalid(canonicalScript: string): boolean {
  if (canonicalScript.length === 0 || canonicalScript.length > HUB_VOICE_SCRIPT_MAX_CHARS || /[<>]/.test(canonicalScript)) return true;
  return (canonicalScript.match(/\[[^[\]]*\]/g) ?? []).some((group) => !HUB_VOICE_TAGS.includes(group));
}

const hasControl = (value: string): boolean => [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

// ── what a test scripts ──────────────────────────────────────────────────

/**
 * What becomes of a fresh create (`scriptVoice`):
 * - a render: `completed` (what an unscripted create gets), `slow` (completes past the studio's «долго»),
 *   `failed_definite` (the provider refused it before billing), `failed_after_dispatch` (it failed after: billing not
 *   known), `indeterminate` (no verdict: dispatched until the hub's lease runs out, then the sweep's word),
 *   `artifact_expired` (completes; its audio is gone by the time it is asked for — 410, and the note says so from then);
 * - an admitted create whose answer is lost: `drop` (the connection breaks), `hang` (no answer until the client gives
 *   up, or the hub closes);
 * - a refusal that admits and charges nothing: `voice_disabled`, `voice_provider_unavailable`,
 *   `voice_not_allowlisted`, `voice_no_profile`, `voice_quota_denied` — each at its place in the hub's admission.
 */
export const FAKE_VOICE_OUTCOMES = [
  'completed',
  'slow',
  'failed_definite',
  'failed_after_dispatch',
  'indeterminate',
  'artifact_expired',
  'drop',
  'hang',
  'voice_disabled',
  'voice_provider_unavailable',
  'voice_not_allowlisted',
  'voice_no_profile',
  'voice_quota_denied',
] as const;
export type FakeVoiceOutcomeKind = (typeof FAKE_VOICE_OUTCOMES)[number];
/** One create's outcome; `ms` — how long its render takes, in hub ms before `timeScale` (`indeterminate`: how long it stays dispatched). */
export type FakeVoiceOutcome = FakeVoiceOutcomeKind | { readonly outcome: FakeVoiceOutcomeKind; readonly ms?: number };

/** The lane's switches before the script is read, in the hub's order: the live switch, the provider, the allowlist, the voice profile. */
const SWITCH_REFUSALS = ['voice_disabled', 'voice_provider_unavailable', 'voice_not_allowlisted', 'voice_no_profile'] as const satisfies readonly FakeVoiceOutcomeKind[];
/** The outcomes that refuse the create; the budget's comes last, after the source and the fan. */
const REFUSALS: readonly FakeVoiceOutcomeKind[] = [...SWITCH_REFUSALS, 'voice_quota_denied'];
type RenderOutcome = Exclude<FakeVoiceOutcomeKind, (typeof SWITCH_REFUSALS)[number] | 'voice_quota_denied'>;

/** A render of a short script, hub ms: what the stand shows between «Озвучить» and the take. */
export const VOICE_RENDER_MS = 2_000;
/** Hub ms of a render by its outcome (before `timeScale`). `slow` outlasts the studio's 45 s; `indeterminate` waits the hub's dispatch lease. */
const RENDER_MS: Readonly<Record<RenderOutcome, number>> = {
  completed: VOICE_RENDER_MS,
  slow: 60_000,
  failed_definite: VOICE_RENDER_MS,
  failed_after_dispatch: VOICE_RENDER_MS,
  indeterminate: 120_000,
  artifact_expired: VOICE_RENDER_MS,
  drop: VOICE_RENDER_MS,
  hang: VOICE_RENDER_MS,
};
/** The hub's synthesis gate (`voiceNotesMaxConcurrentSyntheses` default): more renders than this wait queued, first come first served. */
const MAX_CONCURRENT_SYNTHESES = 2;

/** The `errorCode` of a terminal state that is not a success (`terminalErrorCode`). */
const ERROR_CODES: Partial<Readonly<Record<VoiceNoteState, string>>> = {
  quota_denied: 'voice_quota_denied',
  failed_definite: 'voice_failed_definite',
  failed_after_dispatch: 'voice_failed_after_dispatch',
  indeterminate: 'voice_indeterminate',
  artifact_expired: 'artifact_expired',
};

// ── the lane ─────────────────────────────────────────────────────────────

interface VoiceNote {
  readonly voiceNoteId: number;
  readonly userId: number;
  readonly pageId: number;
  readonly pageLabel: string;
  readonly clientRequestId: string;
  readonly hash: string;
  readonly scriptChars: number;
  readonly createdAt: number;
  /** Hub time it leaves the gate's queue. */
  readonly dispatchAt: number;
  /** Hub time the provider's call ends: its place in the gate frees. */
  readonly callEndAt: number;
  /** Hub time it reaches `end`. */
  readonly endAt: number;
  readonly end: 'completed' | 'failed_definite' | 'failed_after_dispatch' | 'indeterminate';
  readonly audio: VoiceAudioSample;
  /** Its audio goes the first time it is asked for (`artifact_expired`). */
  readonly expiresOnRead: boolean;
  expired: boolean;
}

export interface VoicePage {
  readonly pageId: number;
  readonly pageLabel: string;
  /** OnlyFans: the chat is the fan. */
  readonly chatIsFan: boolean;
}

export interface VoiceCreateInput {
  readonly userId: number;
  readonly page: VoicePage;
  readonly now: number;
  readonly timeScale: number;
  /** The lane does not serve the page (config `voiceLaneOff`): a fresh render is `voice_disabled`. */
  readonly laneOff: boolean;
  readonly generations: ReadonlyMap<string, Generation>;
  /** The page's capture of a Fansly group (HF-9). */
  readonly pair: (conversationRef: string, fanRef: string) => PairState;
}

/** What the lane answers: a note's view (`lost` — the answer never reaches the client), its MP3, or a refusal by code. */
export type VoiceAnswer =
  | { readonly kind: 'view'; readonly status: 200 | 202; readonly view: VoiceNoteView; readonly lost: 'drop' | 'hang' | null }
  | { readonly kind: 'audio'; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly kind: 'refuse'; readonly error: string };

/** A note as `status` lists it (no script, no audio). */
export interface VoiceNoteSnapshot {
  readonly voiceNoteId: number;
  readonly pageLabel: string;
  readonly clientRequestId: string;
  readonly state: VoiceNoteState;
}

const refuse = (error: string): VoiceAnswer => ({ kind: 'refuse', error });

interface Scripted<K extends FakeVoiceOutcomeKind = FakeVoiceOutcomeKind> {
  readonly outcome: K;
  readonly ms: number | null;
}

export class VoiceLane {
  private readonly notes: VoiceNote[] = [];
  private readonly script: Scripted[] = [];

  /** Appends outcomes for the next fresh creates; how many wait now. */
  plan(outcomes: readonly FakeVoiceOutcome[]): number {
    this.script.push(...outcomes.map((item) => (typeof item === 'string' ? { outcome: item, ms: null } : { outcome: item.outcome, ms: item.ms ?? null })));
    return this.script.length;
  }

  clear(): void {
    this.script.length = 0;
  }

  /** Scripted outcomes not used yet. */
  get scripted(): number {
    return this.script.length;
  }

  /**
   * `createVoiceNote`, in the hub's order. A scripted outcome is used by the next fresh create that gets as far as the
   * point where it applies: a refusal at its place in the admission, a render or a lost answer once admitted.
   */
  create(body: VoiceNoteCreateBody, input: VoiceCreateInput): VoiceAnswer {
    const { userId, page, now } = input;
    // The refs meet in the frozen hash with '\n' between them: a control character in one is refused before it is hashed.
    if ([body.conversationRef, body.sourceGenerationRef, ...(body.fanRef === undefined ? [] : [body.fanRef])].some(hasControl)) return refuse('voice_source_invalid');
    const script = canonicalVoiceScript(body.script);
    const hash = voiceRequestHash(page.pageId, body.conversationRef, body.sourceGenerationRef, script);
    // A replay runs no admission gate: the request answers the note it made, whatever changed since (the lane's switch too).
    const prior = this.notes.find((note) => note.userId === userId && note.clientRequestId === body.clientRequestId);
    if (prior !== undefined) return prior.hash === hash ? { kind: 'view', status: 202, view: this.view(prior, now), lost: null } : refuse('idempotency_mismatch');
    for (const code of SWITCH_REFUSALS) {
      if (this.take((kind) => kind === code) !== null || (code === 'voice_disabled' && input.laneOff)) return refuse(code);
    }
    if (voiceScriptInvalid(script)) return refuse('voice_script_invalid');
    // The source: a whole `voice-script` generation of this user, page, chat and fan (the generation's record is the ledger).
    const fanRef = body.fanRef ?? body.conversationRef;
    const source = input.generations.get(body.sourceGenerationRef);
    if (
      source === undefined ||
      source.feature !== 'voice-script' ||
      source.userId !== userId ||
      source.pageLabel !== page.pageLabel ||
      source.conversationRef !== body.conversationRef ||
      source.fanRef !== fanRef ||
      source.outcome !== 'done' ||
      source.stopReason === 'max_tokens' ||
      source.stopReason === 'length'
    ) {
      return refuse('voice_source_invalid');
    }
    // A fan named apart from the chat (HF-4а): on Fansly the page's capture must not hold the group as another fan's;
    // on OnlyFans the chat is the fan, so a fanRef naming anyone else is the same 409, with nothing read (hub #757).
    if (body.fanRef !== undefined && (page.chatIsFan ? body.fanRef !== body.conversationRef : input.pair(body.conversationRef, body.fanRef) === 'mismatch')) {
      return refuse('conversation_fan_mismatch');
    }
    // The day's character budget: refused statelessly, so the same id may be admitted once there is budget again.
    if (this.take((kind) => kind === 'voice_quota_denied') !== null) return refuse('voice_quota_denied');
    const scripted = (this.take((kind) => !REFUSALS.includes(kind)) as Scripted<RenderOutcome> | null) ?? { outcome: 'completed', ms: null };
    const note = this.admit(body, input, hash, script.length, scripted);
    return { kind: 'view', status: 202, view: this.view(note, now, true), lost: scripted.outcome === 'drop' || scripted.outcome === 'hang' ? scripted.outcome : null };
  }

  /** `getVoiceNoteStatus`: by (id, page, user); anything else is the same 404. */
  status(voiceNoteId: number, pageId: number, userId: number, now: number): VoiceAnswer {
    const note = this.find(voiceNoteId, pageId, userId);
    return note === undefined ? refuse('not_found') : { kind: 'view', status: 200, view: this.view(note, now), lost: null };
  }

  /** `getVoiceNoteAudio`: the bytes of a completed note; one not ready is the 404 of one that is not there; a purged one 410. */
  audio(voiceNoteId: number, pageId: number, userId: number, now: number): VoiceAnswer {
    const note = this.find(voiceNoteId, pageId, userId);
    if (note === undefined) return refuse('not_found');
    if (note.expiresOnRead && this.stateOf(note, now) === 'completed') note.expired = true;
    const state = this.stateOf(note, now);
    if (state === 'artifact_expired') return refuse('artifact_expired');
    return state === 'completed' ? { kind: 'audio', bytes: note.audio.bytes } : refuse('not_found');
  }

  snapshot(now: number): VoiceNoteSnapshot[] {
    return this.notes.map((note) => ({ voiceNoteId: note.voiceNoteId, pageLabel: note.pageLabel, clientRequestId: note.clientRequestId, state: this.stateOf(note, now) }));
  }

  /** The scripted outcome at the head, if this point of the admission is where it applies. */
  private take(applies: (kind: FakeVoiceOutcomeKind) => boolean): Scripted | null {
    const head = this.script[0];
    if (head === undefined || !applies(head.outcome)) return null;
    this.script.shift();
    return head;
  }

  private admit(body: VoiceNoteCreateBody, input: VoiceCreateInput, hash: string, scriptChars: number, scripted: Scripted<RenderOutcome>): VoiceNote {
    const { now, page } = input;
    const scaled = (ms: number): number => Math.max(0, Math.round(ms * input.timeScale));
    // The gate: first come first served, a render leaves the queue once fewer than its limit are in the provider's hands.
    const floor = Math.max(now, ...this.notes.map((note) => note.dispatchAt));
    const busyAt = (at: number): number => this.notes.filter((note) => note.dispatchAt <= at && at < note.callEndAt).length;
    const candidates = [floor, ...this.notes.map((note) => note.callEndAt).filter((end) => end > floor)].sort((a, b) => a - b);
    const dispatchAt = candidates.find((at) => busyAt(at) < MAX_CONCURRENT_SYNTHESES) ?? floor;
    const kind = scripted.outcome;
    const duration = scaled(scripted.ms ?? RENDER_MS[kind]);
    const voiceNoteId = this.notes.length + 1;
    const samples = voiceAudioSamples();
    const audio = samples[(voiceNoteId - 1) % samples.length];
    if (audio === undefined) throw new Error('fake hub: no voice audio samples');
    const note: VoiceNote = {
      voiceNoteId,
      userId: input.userId,
      pageId: page.pageId,
      pageLabel: page.pageLabel,
      clientRequestId: body.clientRequestId,
      hash,
      scriptChars,
      createdAt: now,
      dispatchAt,
      // With no verdict the provider's call times out like any other; the note waits out its lease after it.
      callEndAt: dispatchAt + (kind === 'indeterminate' ? Math.min(scaled(VOICE_RENDER_MS), duration) : duration),
      endAt: dispatchAt + duration,
      end: kind === 'failed_definite' || kind === 'failed_after_dispatch' || kind === 'indeterminate' ? kind : 'completed',
      audio,
      expiresOnRead: kind === 'artifact_expired',
      expired: false,
    };
    this.notes.push(note);
    return note;
  }

  private find(voiceNoteId: number, pageId: number, userId: number): VoiceNote | undefined {
    return this.notes.find((note) => note.voiceNoteId === voiceNoteId && note.pageId === pageId && note.userId === userId);
  }

  private stateOf(note: VoiceNote, now: number): VoiceNoteState {
    if (note.expired) return 'artifact_expired';
    if (now < note.dispatchAt) return 'queued';
    return now < note.endAt ? 'dispatched' : note.end;
  }

  /** `toStatusView`. `admitted` — the answer to its own create: queued or dispatched, however fast the render goes. */
  private view(note: VoiceNote, now: number, admitted = false): VoiceNoteView {
    const state = admitted ? (now < note.dispatchAt ? 'queued' : 'dispatched') : this.stateOf(note, now);
    const rendered = state === 'completed' || state === 'artifact_expired';
    const errorCode = ERROR_CODES[state];
    return {
      voiceNoteId: note.voiceNoteId,
      state,
      scriptChars: note.scriptChars,
      // A completed take is billed, one the provider refused is not; anything else the hub does not know (indeterminate never says).
      billed: rendered ? true : state === 'failed_definite' ? false : null,
      audioSha256: rendered ? note.audio.sha256 : null,
      audioBytesLen: rendered ? note.audio.bytes.byteLength : null,
      createdAt: iso(note.createdAt),
      ...(errorCode === undefined ? {} : { errorCode }),
    };
  }
}
