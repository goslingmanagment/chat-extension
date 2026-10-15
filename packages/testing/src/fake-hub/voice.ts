// R20 P6c4, HF-4а/б: admission of a synthetic voice render, from the deployed
// hub bd3eec065 services/voice-notes.ts. No provider, billing or audio synthesis.
// The render stays queued; status/audio still run the page flag on every call.
// These SDK routes precede the extension's own voice service (P12b2), so they
// live in the fake, not in the shared facade's contract or shipped code.

import { createHash } from 'node:crypto';

import { type Generation } from './ai';
import { type PairState } from './ai-rules';

export type VoiceRoute = 'voiceNoteCreate' | 'voiceNoteStatus' | 'voiceNoteAudio';
export interface VoiceRouteMatch {
  readonly route: VoiceRoute;
  readonly params: Readonly<Record<string, string>>;
}
export function matchVoiceRoute(method: string, path: string): VoiceRouteMatch | null {
  const match = /^\/api\/v1\/pages\/([^/]+)\/voice-notes(?:\/([^/]+)(\/audio)?)?$/.exec(path);
  if (match === null || (match[2] === undefined ? method !== 'POST' : method !== 'GET')) return null;
  try {
    return { route: match[2] === undefined ? 'voiceNoteCreate' : match[3] === undefined ? 'voiceNoteStatus' : 'voiceNoteAudio', params: { pageLabel: decodeURIComponent(match[1] ?? ''), ...(match[2] === undefined ? {} : { id: decodeURIComponent(match[2]) }) } };
  } catch { return null; }
}

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

export interface VoiceCreateBody {
  readonly clientRequestId: string;
  readonly conversationRef: string;
  readonly fanRef?: string | undefined;
  readonly sourceGenerationRef: string;
  readonly script: string;
}
interface VoiceView {
  readonly voiceNoteId: number;
  readonly state: 'queued';
  readonly scriptChars: number;
  readonly billed: null;
  readonly audioSha256: null;
  readonly audioBytesLen: null;
  readonly createdAt: string;
}
export type VoiceResult = { readonly status: 200 | 202; readonly body: VoiceView } | { readonly status: 400 | 403 | 404 | 409; readonly error: string };
interface VoiceRow {
  readonly userId: number;
  readonly pageId: number;
  readonly clientRequestId: string;
  readonly hash: string;
  readonly view: VoiceView;
}
const canonical = (script: string): string => script.normalize('NFC').replace(/\r\n/g, '\n').trim();
const TAGS = new Set(['[warmly]', '[cheerfully]', '[thoughtful]', '[excited]', '[whispers]', '[chuckles]', '[giggles]', '[sighs]', '[short pause]', '[long pause]']);
const hasControl = (value: string): boolean => [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

export class VoiceModel {
  private readonly rows: VoiceRow[] = [];

  create(body: VoiceCreateBody, input: {
    readonly userId: number;
    readonly pageId: number;
    readonly pageLabel: string;
    readonly now: number;
    readonly laneOff: boolean;
    readonly generations: ReadonlyMap<string, Generation>;
    readonly pair: (conversationRef: string, fanRef: string) => PairState;
  }): VoiceResult {
    if ([body.conversationRef, body.sourceGenerationRef, ...(body.fanRef === undefined ? [] : [body.fanRef])].some(hasControl)) return { status: 400, error: 'voice_source_invalid' };
    const script = canonical(body.script);
    // fanRef deliberately does not enter the frozen hash (HF-4а); the source already names it.
    const hash = createHash('sha256').update(`${input.pageId}\n${body.conversationRef}\n${body.sourceGenerationRef}\n${script}`).digest('hex');
    const prior = this.rows.find((row) => row.userId === input.userId && row.clientRequestId === body.clientRequestId);
    if (prior !== undefined) return prior.hash === hash ? { status: 202, body: prior.view } : { status: 409, error: 'idempotency_mismatch' };
    // voiceLaneOff models the spend switch: fresh renders refused, admitted renders still readable/replayable.
    if (input.laneOff) return { status: 403, error: 'voice_disabled' };
    if (script.length === 0 || script.length > 600 || /[<>]/.test(script) || (script.match(/\[[^[\]]*\]/g) ?? []).some((tag) => !TAGS.has(tag))) return { status: 400, error: 'voice_script_invalid' };
    const source = input.generations.get(body.sourceGenerationRef);
    if (source === undefined || source.feature !== 'voice-script' || source.userId !== input.userId || source.pageLabel !== input.pageLabel || source.conversationRef !== body.conversationRef || source.fanRef !== (body.fanRef ?? body.conversationRef) || source.outcome !== 'done' || source.stopReason === 'max_tokens' || source.stopReason === 'length') return { status: 400, error: 'voice_source_invalid' };
    if (body.fanRef !== undefined && input.pair(body.conversationRef, body.fanRef) === 'mismatch') return { status: 409, error: 'conversation_fan_mismatch' };
    const view: VoiceView = { voiceNoteId: this.rows.length + 1, state: 'queued', scriptChars: script.length, billed: null, audioSha256: null, audioBytesLen: null, createdAt: new Date(input.now).toISOString() };
    this.rows.push({ userId: input.userId, pageId: input.pageId, clientRequestId: body.clientRequestId, hash, view });
    return { status: 202, body: view };
  }

  status(id: number, pageId: number, userId: number): VoiceResult {
    const row = this.rows.find((candidate) => candidate.view.voiceNoteId === id && candidate.pageId === pageId && candidate.userId === userId);
    return row === undefined ? { status: 404, error: 'not_found' } : { status: 200, body: row.view };
  }
}
