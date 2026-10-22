// Voice notes, the pure rules (1.47.0; contracts voice.ts): what the hub will
// take as a script, how a take reads the hub's view of its note, what an MP3
// looks like, how long a script sounds. No clock, no storage, no hub.
//
// The script's canonical form and its checks are the hub's own law
// (hub voice-script-validation.ts): NFC, CRLF → LF, trimmed; at most the
// page's character cap; no `<` or `>`; every `[…]` group one of the allowed
// tags. The studio says what the hub would refuse before the paid click.

import type { CgCode, CgErrorWire } from '@cg/contracts/errors';
import { VOICE_LIMITS, VOICE_TAGS, type VoiceNoteView, type VoiceSession, type VoiceTake, type VoiceTakeState } from '@cg/contracts/voice';

/** NFC-normalised, CRLF folded to LF, trimmed: the bytes the hub hashes, checks and voices. */
export function canonicalVoiceScript(raw: string): string {
  return raw.normalize('NFC').replace(/\r\n/g, '\n').trim();
}

export type VoiceScriptIssue =
  | { readonly kind: 'empty' }
  | { readonly kind: 'too-long'; readonly max: number }
  | { readonly kind: 'markup' }
  | { readonly kind: 'bad-tag'; readonly tag: string };

const BRACKET_GROUP = /\[[^[\]]*\]/g;
const TAGS: ReadonlySet<string> = new Set(VOICE_TAGS);

/** What the hub would refuse in a canonical script (`voice_script_invalid`); null — nothing. */
export function voiceScriptIssue(canonical: string, max: number = VOICE_LIMITS.scriptChars): VoiceScriptIssue | null {
  if (canonical.length === 0) return { kind: 'empty' };
  if (canonical.length > max) return { kind: 'too-long', max };
  if (canonical.includes('<') || canonical.includes('>')) return { kind: 'markup' };
  for (const group of canonical.match(BRACKET_GROUP) ?? []) if (!TAGS.has(group)) return { kind: 'bad-tag', tag: group };
  return null;
}

/** «≈ N с»: seconds of speech of a script, at least one. */
export function voiceSeconds(chars: number): number {
  return Math.max(1, Math.round(chars / VOICE_LIMITS.charsPerSecond));
}

/** The text a take of the session's script would voice now: the person's text, else the AI's; null — no script. */
export function currentScriptText(session: Pick<VoiceSession, 'script'>): string | null {
  const script = session.script;
  if (script === null) return null;
  return script.edited ?? script.original;
}

/** Whether a take voices another text than the one now in the editor. */
export function takeIsStale(take: Pick<VoiceTake, 'script'>, current: string | null): boolean {
  return current === null || canonicalVoiceScript(current) !== take.script;
}

/** How a take reads the hub's view of its note: its state, the error to show, characters spent, the audio's facts. */
export interface TakeReading {
  readonly state: VoiceTakeState;
  readonly error: CgErrorWire | null;
  readonly billed: boolean | null;
  readonly audio: VoiceTake['audio'];
}

const wire = (code: CgCode): CgErrorWire => ({ code });

export function readNoteView(view: VoiceNoteView): TakeReading {
  const billed = view.billed;
  switch (view.state) {
    case 'queued':
    case 'dispatched':
      return { state: 'working', error: null, billed, audio: null };
    case 'completed':
      // A completed note names its audio; one that does not cannot be checked, so it is never handed to anyone.
      return view.audioSha256 !== null && view.audioBytesLen !== null && view.audioBytesLen > 0 && view.audioBytesLen <= VOICE_LIMITS.audioMaxBytes
        ? { state: 'ready', error: null, billed, audio: { sha256: view.audioSha256, bytes: view.audioBytesLen } }
        : { state: 'failed', error: wire('CG-VOICE-CORRUPT'), billed, audio: null };
    case 'failed_definite':
      return { state: 'failed', error: wire('CG-VOICE-FAILED'), billed: false, audio: null };
    case 'failed_after_dispatch':
      return { state: 'failed', error: wire('CG-VOICE-UNCERTAIN'), billed, audio: null };
    case 'indeterminate':
      return { state: 'uncertain', error: wire('CG-VOICE-UNCERTAIN'), billed: null, audio: null };
    case 'quota_denied':
      return { state: 'refused', error: wire('CG-VOICE-QUOTA'), billed: false, audio: null };
    case 'artifact_expired':
      return { state: 'expired', error: wire('CG-VOICE-EXPIRED'), billed, audio: null };
  }
}

/** A take's state never goes back: a later read that says less than the stored one (a ready take read as working) is not taken. */
const RANK: Readonly<Record<VoiceTakeState, number>> = { creating: 0, uncertain: 1, working: 2, ready: 3, failed: 3, refused: 3, expired: 4 };

export function takeMayMove(from: VoiceTakeState, to: VoiceTakeState): boolean {
  if (from === to) return true;
  // An uncertain take may turn out to be anything the hub says; a creating one too.
  if (from === 'creating' || from === 'uncertain') return true;
  return RANK[to] > RANK[from] || (from === 'ready' && to === 'expired');
}

// ── MP3 ──────────────────────────────────────────────────────────────────────

/**
 * Whether bytes look like an MP3: an ID3v2 tag skipped, then an MPEG audio frame header (11 sync bits, a valid
 * version, layer, bitrate and sample rate). The hub checked the same before it kept the file; this is the second look
 * at the bytes that are about to be played and attached.
 */
export function looksLikeMp3(bytes: Uint8Array): boolean {
  let at = 0;
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    // ID3v2: a 10-byte header, then a synchsafe size (7 bits a byte), a footer of 10 more when its flag is set.
    const size = ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f);
    at = 10 + size + ((bytes[5]! & 0x10) !== 0 ? 10 : 0);
  }
  // A few padding bytes may stand before the first frame.
  const end = Math.min(bytes.length - 4, at + 4096);
  for (let i = at; i <= end; i += 1) {
    if (bytes[i] !== 0xff || (bytes[i + 1]! & 0xe0) !== 0xe0) continue;
    const version = (bytes[i + 1]! >> 3) & 0x03;
    const layer = (bytes[i + 1]! >> 1) & 0x03;
    const bitrate = (bytes[i + 2]! >> 4) & 0x0f;
    const rate = (bytes[i + 2]! >> 2) & 0x03;
    if (version !== 0x01 && layer !== 0x00 && bitrate !== 0x00 && bitrate !== 0x0f && rate !== 0x03) return true;
  }
  return false;
}

// ── base64 ───────────────────────────────────────────────────────────────────

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += `${ALPHABET[(n >> 18) & 63]!}${ALPHABET[(n >> 12) & 63]!}==`;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += `${ALPHABET[(n >> 18) & 63]!}${ALPHABET[(n >> 12) & 63]!}${ALPHABET[(n >> 6) & 63]!}=`;
  }
  return out;
}

const DECODE: Readonly<Record<string, number>> = Object.fromEntries([...ALPHABET].map((char, index) => [char, index]));

/** The bytes of a base64 text (the alphabet above, `=` padding); null — not base64. */
export function base64ToBytes(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const a = DECODE[text[i]!];
    const b = DECODE[text[i + 1]!];
    const c = text[i + 2] === '=' ? 0 : DECODE[text[i + 2]!];
    const d = text[i + 3] === '=' ? 0 : DECODE[text[i + 3]!];
    if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}
