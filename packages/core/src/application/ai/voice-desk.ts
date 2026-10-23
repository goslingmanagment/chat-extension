// What the tab holds of voice notes (1.47.0; contracts voice.ts): the open
// chat's session as the background keeps it (`voice.read`, then its
// `voice.changed` events), the text of a script being written (its
// `op.update` batches), the checked MP3 of a ready take once the studio asks
// for it, and what only this tab knows — the take the person chose, their
// text while they type, a handover into the field, a question asked in the
// studio, the takes that got ready while nobody looked (the chip's dot) —
// and (1.49.0) what the page may still voice today, read when the studio
// opens and again when a take of the page moves.
// The chip of the dock and the studio both read it, so it lives with the
// workspace, not with one controller.

import { type CgErrorWire } from '@cg/contracts/errors';
import { chatKeyOf, type ChatKey } from '@cg/contracts/ids';
import { type VoiceAllowance, type VoiceSession, type VoiceTone, type VoiceWriteResult } from '@cg/contracts/voice';
import { base64ToBytes, voiceTakesMoved } from '../../domain/voice';
import { type AiPorts } from './ports';

/** A session of a chat as the tab knows it: `loading` until the first read answers. */
export type DeskSession = { readonly state: 'loading' } | { readonly state: 'ready'; readonly session: VoiceSession | null } | { readonly state: 'failed'; readonly error: CgErrorWire };

/** The handover of a take into the chat's field (VoiceAttachVM's state). */
export interface DeskAttach {
  readonly takeId: string;
  readonly state: 'handing' | 'attached' | 'unknown' | 'failed';
  readonly error: CgErrorWire | null;
}

/** A question the studio asks before it acts. */
export type DeskConfirm = { readonly kind: 'new' } | { readonly kind: 'rewrite'; readonly tone: VoiceTone } | { readonly kind: 'again'; readonly takeId: string };

export type DeskAudio = { readonly state: 'loading' } | { readonly state: 'ready'; readonly sha256: string; readonly bytes: ArrayBuffer } | { readonly state: 'failed'; readonly error: CgErrorWire };

/** What only this tab knows of a chat's voice. */
export interface DeskUi {
  tone: VoiceTone;
  /** The take the person chose for «Прикрепить»; null — the newest ready one. */
  selected: string | null;
  /** The person's text while they type: kept here, stored a moment later. null — what the session holds. */
  text: string | null;
  attach: DeskAttach | null;
  /**
   * A take this tab asked for and the background has not answered yet: claimed by the click before its first wait, so
   * the second click of a double click finds it (one click, one render); let go whatever the answer.
   */
  making: boolean;
  confirm: DeskConfirm | null;
  /** The studio's own failure of a click (a refusal of the background, a draft that could not be read). */
  error: CgErrorWire | null;
  /**
   * The draft the field still held when a take went into it (the text goes to the fan with the voice): `cleared` once
   * «Убрать текст» took it out, for «Вернуть текст». null — nothing was left.
   */
  leftover: { readonly text: string; cleared: boolean } | null;
  /** Takes that got ready while the studio was not open: the chip's dot until it opens. */
  readonly unseen: Set<string>;
}

const SESSIONS_KEPT = 16;
const AUDIO_KEPT = 12;
/** The person's text is stored this long after the last keystroke. */
export const VOICE_EDIT_SAVE_MS = 600;
/** A day's allowance is dropped this long after its day ends (the hub's clock and ours differ a little). */
const ALLOWANCE_DAY_SLACK_MS = 1_000;
/** No timer waits longer than this for a day to end (an answer that names a far reset is read again by then). */
const ALLOWANCE_TIMER_MAX_MS = 25 * 60 * 60 * 1000;

const sessionKey = (pageId: number, conversationRef: string): string => `${String(pageId)}:${conversationRef}`;

export interface VoiceDeskDeps {
  readonly ports: AiPorts;
  changed(): void;
  /** The open chat's page and conversation, when it has them: the background is asked only about the chat the person sees. */
  openChat(): { readonly key: ChatKey; readonly pageId: number; readonly conversationRef: string } | null;
  /** Whether the studio of a chat is the dock's sheet now. */
  studioOpen(key: ChatKey): boolean;
}

export class VoiceDesk {
  private readonly sessions = new Map<string, DeskSession>();
  private readonly streams = new Map<string, { seq: number; text: string }>();
  private readonly audios = new Map<string, DeskAudio>();
  private readonly uis = new Map<ChatKey, DeskUi>();
  private readonly saveTimers = new Map<string, unknown>();
  /** 1.49.0: the pages' day allowances as the background last said (null — not known), by pageId. */
  private readonly allowances = new Map<number, VoiceAllowance | null>();
  /** The pages whose allowance is being read; `again` — a take moved meanwhile, so it is read once more after. */
  private readonly allowanceReads = new Map<number, { again: boolean }>();
  /** A kept allowance goes when its day ends. */
  private readonly allowanceTimers = new Map<number, unknown>();
  private readonly offs: (() => void)[];

  constructor(private readonly deps: VoiceDeskDeps) {
    const { rpc } = deps.ports;
    this.offs = [
      rpc.onEvent('voice.changed', ({ chat, conversationRef, session }) => {
        const pageId = session?.pageId ?? this.pageOfKnown(chatKeyOf(chat), conversationRef);
        if (pageId === null) return;
        this.take(chatKeyOf(chat), pageId, conversationRef, session);
      }),
      rpc.onEvent('op.update', ({ opId, seq, append }) => {
        const stream = this.streams.get(opId);
        if (stream === undefined || seq <= stream.seq) return;
        stream.seq = seq;
        stream.text += append;
        this.deps.changed();
      }),
    ];
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    for (const timer of this.saveTimers.values()) this.deps.ports.clock.clearTimer(timer);
    this.saveTimers.clear();
    for (const timer of this.allowanceTimers.values()) this.deps.ports.clock.clearTimer(timer);
    this.allowanceTimers.clear();
  }

  // ── sessions ─────────────────────────────────────────────────────────────

  /** The chat's session; the first look asks the background. */
  session(pageId: number, conversationRef: string): DeskSession {
    const key = sessionKey(pageId, conversationRef);
    const known = this.sessions.get(key);
    if (known !== undefined) return known;
    this.sessions.set(key, { state: 'loading' });
    void this.read(pageId, conversationRef);
    return { state: 'loading' };
  }

  /** Reads the chat's session again (the background woke, the port came back). */
  async read(pageId: number, conversationRef: string): Promise<DeskSession> {
    const key = sessionKey(pageId, conversationRef);
    const answer = await this.deps.ports.rpc.request('voice.read', { pageId, conversationRef });
    const state: DeskSession = answer.ok ? { state: 'ready', session: answer.payload.session } : { state: 'failed', error: answer.error };
    const before = this.sessions.get(key);
    // A newer session came by an event while the read was on its way: it stays.
    if (before?.state === 'ready' && state.state === 'ready' && before.session !== null && (state.session === null || state.session.revision < before.session.revision) && state.session?.sessionId === before.session.sessionId) return before;
    this.keep(key, state);
    if (state.state === 'ready' && state.session !== null) this.follow(state.session);
    this.deps.changed();
    return state;
  }

  /** A write's answer (or an event): the session the background keeps now. */
  apply(result: VoiceWriteResult): void {
    if (result.session !== null) this.take(chatKeyOf(result.session.chat), result.session.pageId, result.session.conversationRef, result.session);
  }

  private take(chatKey: ChatKey, pageId: number, conversationRef: string, session: VoiceSession | null): void {
    const key = sessionKey(pageId, conversationRef);
    const before = this.sessions.get(key);
    const previous = before?.state === 'ready' ? before.session : null;
    // An older revision of the same session (a late answer) never replaces a newer one.
    if (previous !== null && session !== null && previous.sessionId === session.sessionId && session.revision < previous.revision) return;
    this.keep(key, { state: 'ready', session });
    if (session !== null) {
      this.follow(session);
      // A take that got ready while nobody had the studio open: the chip's dot.
      if (!this.deps.studioOpen(chatKey)) {
        const ui = this.ui(chatKey);
        for (const take of session.takes) {
          const was = previous?.takes.find((candidate) => candidate.takeId === take.takeId);
          if (take.state === 'ready' && was !== undefined && was.state !== 'ready') ui.unseen.add(take.takeId);
        }
      }
    }
    // A take that moved (the hub answered its create, or it settled) moved the page's day: the open studio reads it again.
    if (voiceTakesMoved(previous, session) && this.deps.studioOpen(chatKey)) this.readAllowance(pageId);
    // A session that went (another tab's «Новый войс») takes this tab's state of it along.
    if (session === null || previous?.sessionId !== session.sessionId) {
      const ui = this.uis.get(chatKey);
      if (ui !== undefined) {
        ui.selected = null;
        ui.text = null;
        ui.attach = null;
        ui.confirm = null;
        ui.leftover = null;
      }
    }
    this.deps.changed();
  }

  /** The script being written: its text grows with the operation's batches. */
  private follow(session: VoiceSession): void {
    const writing = session.writing;
    if (writing !== null && !this.streams.has(writing.opId)) this.streams.set(writing.opId, { seq: -1, text: '' });
  }

  streamText(opId: string): string {
    return this.streams.get(opId)?.text ?? '';
  }

  private keep(key: string, state: DeskSession): void {
    this.sessions.delete(key);
    this.sessions.set(key, state);
    while (this.sessions.size > SESSIONS_KEPT) this.sessions.delete(this.sessions.keys().next().value as string);
  }

  private pageOfKnown(chatKey: ChatKey, conversationRef: string): number | null {
    const open = this.deps.openChat();
    if (open !== null && open.key === chatKey && open.conversationRef === conversationRef) return open.pageId;
    for (const [key, state] of this.sessions) if (state.state === 'ready' && state.session !== null && chatKeyOf(state.session.chat) === chatKey && key.endsWith(`:${conversationRef}`)) return state.session.pageId;
    return null;
  }

  // ── the day's allowance (1.49.0) ─────────────────────────────────────────

  /** The page's day allowance as the background last said; null — not known (not read yet, an older hub, a failed read). */
  allowance(pageId: number): VoiceAllowance | null {
    return this.allowances.get(pageId) ?? null;
  }

  /** The studio of the page is open and its allowance was never read (the studio opened before this tab knew it): reads it. */
  ensureAllowance(pageId: number): void {
    if (!this.allowances.has(pageId) && !this.allowanceReads.has(pageId)) this.readAllowance(pageId);
  }

  /**
   * Asks the background for the page's allowance (its short cache, or the hub): when the studio opens, when a take of
   * the page moves, when the kept one's day ends. One read of a page at a time; one asked meanwhile follows it — the
   * take that moved may be newer than the answer on its way. A failure is «not known», never an error of the studio.
   */
  readAllowance(pageId: number): void {
    const reading = this.allowanceReads.get(pageId);
    if (reading !== undefined) {
      reading.again = true;
      return;
    }
    this.allowanceReads.set(pageId, { again: false });
    const done = (allowance: VoiceAllowance | null): void => {
      const again = this.allowanceReads.get(pageId)?.again === true;
      this.allowanceReads.delete(pageId);
      this.keepAllowance(pageId, allowance);
      if (again) this.readAllowance(pageId);
    };
    void this.deps.ports.rpc.request('voice.allowance', { pageId }).then(
      (answer) => done(answer.ok ? answer.payload.allowance : null),
      () => done(null),
    );
  }

  private keepAllowance(pageId: number, allowance: VoiceAllowance | null): void {
    const { clock } = this.deps.ports;
    const timer = this.allowanceTimers.get(pageId);
    if (timer !== undefined) clock.clearTimer(timer);
    this.allowanceTimers.delete(pageId);
    this.allowances.set(pageId, allowance);
    // Once its day ends, what was left of it no longer holds: it goes, and an open studio of the page reads the new day.
    // An answer whose day is already over here (a clock ahead of the hub's) shows nothing and is not read again by itself.
    const left = allowance === null ? Number.NaN : Date.parse(allowance.resetsAt) - clock.now();
    if (Number.isFinite(left) && left > 0) {
      this.allowanceTimers.set(
        pageId,
        clock.setTimer(Math.min(left + ALLOWANCE_DAY_SLACK_MS, ALLOWANCE_TIMER_MAX_MS), () => {
          this.allowanceTimers.delete(pageId);
          this.allowances.delete(pageId);
          const open = this.deps.openChat();
          if (open !== null && open.pageId === pageId && this.deps.studioOpen(open.key)) this.readAllowance(pageId);
          this.deps.changed();
        }),
      );
    }
    this.deps.changed();
  }

  // ── this tab's state of a chat ───────────────────────────────────────────

  ui(key: ChatKey): DeskUi {
    let ui = this.uis.get(key);
    if (ui === undefined) {
      ui = { tone: 'calm', selected: null, text: null, attach: null, making: false, confirm: null, error: null, leftover: null, unseen: new Set() };
      this.uis.set(key, ui);
      while (this.uis.size > SESSIONS_KEPT) this.uis.delete(this.uis.keys().next().value as ChatKey);
    }
    return ui;
  }

  /** The studio of a chat opened: what got ready meanwhile has been seen. */
  seen(key: ChatKey): void {
    const ui = this.uis.get(key);
    if (ui === undefined || ui.unseen.size === 0) return;
    ui.unseen.clear();
    this.deps.changed();
  }

  /** The chip of a chat: a take renders or a script is written (busy), a take got ready unseen (the dot). */
  chip(key: ChatKey, pageId: number | null, conversationRef: string): { readonly busy: boolean; readonly ready: boolean } {
    const ui = this.uis.get(key);
    const state = pageId === null ? undefined : this.sessions.get(sessionKey(pageId, conversationRef));
    const session = state?.state === 'ready' ? state.session : null;
    const busy = session !== null && (session.writing !== null || session.takes.some((take) => take.state === 'creating' || take.state === 'working'));
    return { busy, ready: ui !== undefined && ui.unseen.size > 0 };
  }

  /** The person typed: kept here at once, stored a moment after the last keystroke. */
  edit(key: ChatKey, sessionId: string, text: string): void {
    this.ui(key).text = text;
    const { clock } = this.deps.ports;
    const timer = this.saveTimers.get(sessionId);
    if (timer !== undefined) clock.clearTimer(timer);
    this.saveTimers.set(
      sessionId,
      clock.setTimer(VOICE_EDIT_SAVE_MS, () => {
        this.saveTimers.delete(sessionId);
        void this.save(key, sessionId);
      }),
    );
    this.deps.changed();
  }

  /** Stores the person's text now (before a take, a rewrite, the studio closing). */
  async save(key: ChatKey, sessionId: string): Promise<void> {
    const timer = this.saveTimers.get(sessionId);
    if (timer !== undefined) {
      this.deps.ports.clock.clearTimer(timer);
      this.saveTimers.delete(sessionId);
    }
    const text = this.uis.get(key)?.text ?? null;
    if (text === null) return;
    const answer = await this.deps.ports.rpc.request('voice.edit', { sessionId, text });
    if (!answer.ok) return;
    this.apply(answer.payload);
  }

  // ── audio ────────────────────────────────────────────────────────────────

  audio(takeId: string): DeskAudio | null {
    return this.audios.get(takeId) ?? null;
  }

  /** A ready take's MP3, asked once; the bytes stay in the tab's memory for the player, the handover and «Скачать». */
  fetchAudio(sessionId: string, takeId: string): void {
    const known = this.audios.get(takeId);
    if (known !== undefined && known.state !== 'failed') return;
    this.audios.set(takeId, { state: 'loading' });
    void this.deps.ports.rpc.request('voice.audio', { sessionId, takeId }).then((answer) => {
      let audio: DeskAudio;
      if (!answer.ok) audio = { state: 'failed', error: answer.error };
      else if (!answer.payload.ok) audio = { state: 'failed', error: answer.payload.error };
      else {
        const bytes = base64ToBytes(answer.payload.audio.base64);
        audio = bytes === null || bytes.byteLength !== answer.payload.audio.bytes ? { state: 'failed', error: { code: 'CG-VOICE-CORRUPT' } } : { state: 'ready', sha256: answer.payload.audio.sha256, bytes: bytes.buffer as ArrayBuffer };
      }
      this.audios.set(takeId, audio);
      while (this.audios.size > AUDIO_KEPT) this.audios.delete(this.audios.keys().next().value as string);
      this.deps.changed();
    });
  }
}
