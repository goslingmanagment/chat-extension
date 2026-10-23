// The voice notes of the background (1.47.0; services/voice/service.ts): the
// paid take is written before the hub is asked and never asked again by
// itself; «Проверить» asks again with the same id; a refusal the hub said
// spent nothing; the state is read until it settles; the MP3 is checked
// before anyone gets it; a rewrite keeps what was paid for; a restart turns
// an open create uncertain; another sign-in finds none of the sessions; the
// page's day allowance (1.49.0) is kept a few seconds and read again once a
// take moves, and a failure of it is «not known». What the person paid for and
// never put into the field stays: a storage read that fails writes nothing over
// it, the cap of sessions and «Очистить локальные данные» let go of it last or
// not at all.

import { createHash } from 'node:crypto';

import { VOICE_LIMITS, type CgErrorWire, type HumanCause, type Target, type VoiceAllowance, type VoiceNoteView, type VoiceOpView, type VoiceScriptStartWire, type VoiceSession, type VoiceTake } from '@cg/contracts';
import type { StartOutcome } from '@cg/core/services';
import type { KeyValuePort, StorageResult } from '@cg/core/services';
import { VOICE_SESSIONS_KEY, VoiceService, type VoiceFailure, type VoiceServiceDeps } from '@cg/core/services/voice';
import { describe, expect, it } from 'vitest';

import { binding, chatOf, uuid } from './support/world';

const DIGEST_LIKE = 'deadbeefcafe0001';

const NOW = Date.parse('2026-10-22T10:00:00.000Z');
const FAN = '2002';
const PAGE = { pageId: 11, pageLabel: 'model-one', platform: 'onlyfans' } as const;
const TAB = uuid(0xa1);
const CAUSE: HumanCause = { kind: 'click', actionToken: 'tok_0123456789abcdef' };
const target: Target = { binding, chat: chatOf(FAN), fanRef: FAN, conversationRef: FAN };
const SCRIPT = '[warmly] Hey you, I missed you today.';
/** An MPEG-1 Layer III frame header and a little payload: what an MP3 starts with. */
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64, ...Array.from({ length: 60 }, (_, i) => i)]).buffer;
const sha = (bytes: ArrayBuffer): string => createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
/** The signed-in person of the world: the sessions in storage are theirs. */
const OWNER = { hubOrigin: 'https://hub.example.test', userId: 7 } as const;

const start = (over: Partial<VoiceScriptStartWire> = {}): VoiceScriptStartWire => ({
  feature: 'voice-script',
  target,
  cause: CAUSE,
  window: 100,
  tone: 'casual',
  draft: { text: 'miss you, want to hear my voice?', revision: 1, digest: DIGEST_LIKE },
  ...over,
});

/** The page's day as the hub says it: `remainingChars` left of 5000, renewed at the next UTC midnight. */
const day = (remainingChars: number): VoiceAllowance => ({ scriptMaxChars: 600, dailyChars: 5_000, remainingChars, resetsAt: '2026-10-23T00:00:00.000Z' });

const note = (over: Partial<VoiceNoteView> = {}): VoiceNoteView => ({
  voiceNoteId: 77,
  state: 'dispatched',
  scriptChars: SCRIPT.length,
  billed: null,
  audioSha256: null,
  audioBytesLen: null,
  createdAt: new Date(NOW).toISOString(),
  ...over,
});

class MemoryPort implements KeyValuePort {
  readonly values = new Map<string, unknown>();
  failWrites = false;
  /** The next reads that fail (or pass the port's timeout), counted down. */
  failReads = 0;
  get(keys: readonly string[]): Promise<StorageResult<Readonly<Record<string, unknown>>>> {
    if (this.failReads > 0) {
      this.failReads -= 1;
      return Promise.resolve({ ok: false, code: 'CG-STORAGE-READ', detail: 'timed out' });
    }
    return Promise.resolve({ ok: true, value: Object.fromEntries(keys.filter((key) => this.values.has(key)).map((key) => [key, structuredClone(this.values.get(key))])) });
  }
  set(items: Readonly<Record<string, unknown>>): Promise<StorageResult<void>> {
    if (this.failWrites) return Promise.resolve({ ok: false, code: 'CG-STORAGE-WRITE', detail: 'disk full' });
    for (const [key, value] of Object.entries(items)) this.values.set(key, structuredClone(value));
    return Promise.resolve({ ok: true, value: undefined });
  }
  remove(keys: readonly string[]): Promise<StorageResult<void>> {
    for (const key of keys) this.values.delete(key);
    return Promise.resolve({ ok: true, value: undefined });
  }
  keys(): Promise<StorageResult<readonly string[]>> {
    return Promise.resolve({ ok: true, value: [...this.values.keys()] });
  }
  onChanged(): () => void {
    return () => undefined;
  }
  stored(): readonly VoiceSession[] {
    return ((this.values.get(VOICE_SESSIONS_KEY) as { sessions?: VoiceSession[] } | undefined)?.sessions ?? []);
  }
  /** Storage as an earlier background left it: these sessions of the signed-in person. */
  keep(sessions: readonly VoiceSession[]): this {
    this.values.set(VOICE_SESSIONS_KEY, { v: 1, owner: OWNER, sessions: structuredClone(sessions) });
    return this;
  }
}

/** A thrown failure that carries how it reads (the composition's reading is its own test). */
class Failed extends Error {
  constructor(readonly read: VoiceFailure) {
    super(read.error.code);
  }
}

interface World {
  readonly service: VoiceService<string>;
  readonly store: MemoryPort;
  readonly creates: { clientRequestId: string; script: string; fanRef?: string; storedAt: readonly VoiceSession[] }[];
  readonly statuses: number[];
  /** The pages whose allowance the hub was asked for, in order. */
  readonly allowanceReads: string[];
  readonly started: VoiceScriptStartWire[];
  readonly emitted: (VoiceSession | null)[];
  readonly hub: { create: () => Promise<VoiceNoteView>; status: () => Promise<VoiceNoteView>; audio: () => Promise<ArrayBuffer>; allowance: () => Promise<VoiceAllowance> };
  readonly views: Map<string, VoiceOpView>;
  owner: { hubOrigin: string; userId: number } | null;
  redeemable: boolean;
  /** Called with each session the tabs are told of, after it is recorded. */
  onEmit: ((session: VoiceSession | null) => void) | null;
  timers: (() => void)[];
  now: number;
  /** Runs the timers that are due (all of them: the service's pauses are short). */
  tick(): Promise<void>;
}

/** Every promise the service chained settles (a macrotask runs after all of them). */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function world(over: { store?: MemoryPort } = {}): World {
  const store = over.store ?? new MemoryPort();
  let opIds = 0x500;
  let ids = 0x600;
  const w: World = {
    store,
    creates: [],
    statuses: [],
    allowanceReads: [],
    started: [],
    emitted: [],
    views: new Map(),
    owner: { ...OWNER },
    redeemable: true,
    onEmit: null,
    timers: [],
    now: NOW,
    hub: {
      create: () => Promise.resolve(note()),
      status: () => Promise.resolve(note({ state: 'completed', billed: true, audioSha256: sha(MP3), audioBytesLen: MP3.byteLength })),
      audio: () => Promise.resolve(MP3.slice(0)),
      allowance: () => Promise.resolve(day(1_400)),
    },
    service: null as unknown as VoiceService<string>,
    async tick() {
      const due = w.timers.splice(0);
      for (const run of due) run();
      await flush();
    },
  };
  const deps: VoiceServiceDeps<string> = {
    now: () => w.now,
    ids: { uuid: () => uuid((ids += 1)) },
    timers: { set: (callback) => w.timers.push(callback), clear: () => undefined },
    store,
    hub: {
      create: (request) => {
        w.creates.push({ clientRequestId: request.body.clientRequestId, script: request.body.script, ...(request.body.fanRef === undefined ? {} : { fanRef: request.body.fanRef }), storedAt: structuredClone(store.stored()) });
        return w.hub.create();
      },
      status: (ref) => {
        w.statuses.push(ref.voiceNoteId);
        return w.hub.status();
      },
      audio: () => w.hub.audio(),
      allowance: (query) => {
        w.allowanceReads.push(query.pageLabel);
        return w.hub.allowance();
      },
    },
    failure: (error) => (error instanceof Failed ? error.read : { error: { code: 'CG-UNKNOWN' }, reached: 'unknown' }),
    page: (pageId) => Promise.resolve(pageId === PAGE.pageId ? { ok: true, page: PAGE } : { ok: false, code: 'CG-BINDING-NOT-GRANTED' }),
    pageLabel: (pageId) => (pageId === PAGE.pageId ? PAGE.pageLabel : null),
    tabOf: (sender) => sender,
    redeem: () => w.redeemable,
    ops: {
      start: (_tab, input): Promise<StartOutcome> => {
        w.started.push(input);
        return Promise.resolve({ kind: 'admission', admission: { ok: true, opId: uuid((opIds += 1)) }, reopened: false });
      },
      view: (opId) => w.views.get(opId) ?? null,
    },
    owner: () => w.owner,
    emit: (change) => {
      w.emitted.push(change.session);
      w.onEmit?.(change.session);
    },
    sha256: (bytes) => Promise.resolve(sha(bytes)),
    log: () => undefined,
  };
  (w as { service: VoiceService<string> }).service = new VoiceService(deps);
  return w;
}

const scriptView = (opId: string, over: Partial<VoiceOpView> = {}): VoiceOpView =>
  ({
    opId,
    feature: 'voice-script',
    surface: 'dock',
    target,
    state: 'done',
    startedAt: NOW,
    endedAt: NOW + 3000,
    result: { kind: 'voice-script', script: SCRIPT },
    generationRef: uuid(0x700),
    toneUsed: 'casual',
    ...over,
  }) as unknown as VoiceOpView;

/** A take as storage keeps it: ready and not put into the field, unless `over` says otherwise. */
const keptTake = (n: number, over: Partial<VoiceTake> = {}): VoiceTake => ({
  takeId: uuid(0xc00 + n),
  createdAt: NOW - 60_000,
  script: SCRIPT,
  sourceGenerationRef: uuid(0x700),
  state: 'ready',
  voiceNoteId: 100 + n,
  audio: { sha256: sha(MP3), bytes: MP3.byteLength },
  billed: true,
  error: null,
  attached: null,
  ...over,
});

/** A session of the fan `fan` as storage keeps it, touched `n` ms after the oldest one. */
const keptSession = (fan: string, n: number, takes: readonly VoiceTake[] = []): VoiceSession => ({
  sessionId: uuid(0xb00 + n),
  pageId: PAGE.pageId,
  chat: chatOf(fan),
  conversationRef: fan,
  fanRef: fan,
  createdAt: NOW - 60_000 + n,
  updatedAt: NOW - 60_000 + n,
  revision: 1,
  draft: 'miss you, want to hear my voice?',
  script: { tone: 'warm', generationRef: uuid(0x700), original: SCRIPT, edited: null },
  writing: null,
  error: null,
  takes: [...takes],
});

/** The paid takes not in the field yet, one of each kind, and the takes that are not: what the person would lose. */
const AT_STAKE: readonly Partial<VoiceTake>[] = [{}, { state: 'uncertain', voiceNoteId: null, audio: null, billed: null, error: { code: 'CG-VOICE-UNCERTAIN' } }, { attached: { state: 'unknown', at: NOW - 30_000 } }];
const SETTLED: readonly Partial<VoiceTake>[] = [{ attached: { state: 'attached', at: NOW - 30_000 } }, { state: 'refused', voiceNoteId: null, audio: null, billed: false, error: { code: 'CG-VOICE-QUOTA' } }];

/** A session with its script written: the script started and its operation done. */
async function withScript(w: World): Promise<VoiceSession> {
  const started = await w.service.script(TAB, start(), null);
  if (!started.ok) throw new Error(`script: ${started.error.code}`);
  const opId = started.session.writing?.opId ?? '';
  w.service.scriptDone(scriptView(opId));
  await flush();
  const read = await w.service.read(TAB, PAGE.pageId, FAN);
  if (!read.ok || read.session === null || read.session.script === null) throw new Error(`no script: ${JSON.stringify(read)}`);
  return read.session;
}

describe('voice notes in the background', () => {
  it('the script is the chat’s session: written, then taken with its source; another tone is the hub’s own word', async () => {
    const w = world();
    const session = await withScript(w);
    expect(w.started[0]?.tone).toBe('casual');
    expect(session.script).toMatchObject({ tone: 'warm', original: SCRIPT, generationRef: uuid(0x700), edited: null });
    expect(session.writing).toBeNull();
    expect(w.store.stored()).toHaveLength(1);
    // A preset the studio does not have is our bug, never sent.
    expect(await w.service.script(TAB, start({ tone: 'spicy' }), null)).toMatchObject({ ok: false, error: { code: 'CG-UI-FAILED' } });
  });

  it('a take is written before the hub is asked, and the hub’s answer after', async () => {
    const w = world();
    const session = await withScript(w);
    const made = await w.service.take(TAB, session.sessionId, uuid(0x801), SCRIPT, CAUSE);
    expect(made.ok).toBe(true);
    await flush();
    expect(w.creates).toHaveLength(1);
    const create = w.creates[0]!;
    expect(create).toMatchObject({ clientRequestId: uuid(0x801), script: SCRIPT });
    // On OnlyFans the chat is the fan: no fanRef apart.
    expect(create.fanRef).toBeUndefined();
    // The take was already in storage when the hub was asked.
    expect(create.storedAt[0]?.takes.map((take) => [take.takeId, take.state])).toEqual([[uuid(0x801), 'creating']]);
    const after = w.store.stored()[0]!.takes[0]!;
    expect(after).toMatchObject({ state: 'working', voiceNoteId: 77 });
  });

  it('a storage write that fails asks nothing of the hub; a refused click asks nothing either', async () => {
    const w = world();
    const session = await withScript(w);
    w.store.failWrites = true;
    expect(await w.service.take(TAB, session.sessionId, uuid(0x802), SCRIPT, CAUSE)).toMatchObject({ ok: false, error: { code: 'CG-STORAGE-WRITE' } });
    w.store.failWrites = false;
    w.redeemable = false;
    expect(await w.service.take(TAB, session.sessionId, uuid(0x803), SCRIPT, CAUSE)).toMatchObject({ ok: false, error: { code: 'CG-UI-FAILED' } });
    await flush();
    expect(w.creates).toHaveLength(0);
    expect(w.store.stored()[0]!.takes).toHaveLength(0);
  });

  it('the same click twice makes one take', async () => {
    const w = world();
    const session = await withScript(w);
    await w.service.take(TAB, session.sessionId, uuid(0x804), SCRIPT, CAUSE);
    await w.service.take(TAB, session.sessionId, uuid(0x804), SCRIPT, CAUSE);
    await flush();
    expect(w.creates).toHaveLength(1);
    expect(w.store.stored()[0]!.takes).toHaveLength(1);
  });

  it('another take while a create of the session is unanswered is refused, whoever asks (another tab, a click whose answer got lost); once the hub admitted it, it is asked', async () => {
    const w = world();
    const session = await withScript(w);
    let answer: (view: VoiceNoteView) => void = () => undefined;
    w.hub.create = () => new Promise((resolve) => (answer = resolve));
    await w.service.take(TAB, session.sessionId, uuid(0x80c), SCRIPT, CAUSE);
    expect(await w.service.take(TAB, session.sessionId, uuid(0x80d), SCRIPT, CAUSE)).toMatchObject({ ok: false, error: { code: 'CG-OP-CHAT-BUSY' } });
    expect(w.creates).toHaveLength(1);
    // Admitted: it renders on its own and holds nothing.
    answer(note());
    await flush();
    expect(w.store.stored()[0]!.takes[0]!.state).toBe('working');
    expect(await w.service.take(TAB, session.sessionId, uuid(0x80d), SCRIPT, CAUSE)).toMatchObject({ ok: true });
    await flush();
    expect(w.creates.map((create) => create.clientRequestId)).toEqual([uuid(0x80c), uuid(0x80d)]);
  });

  it('an answer that does not come leaves the take uncertain, and nothing asks again by itself; «Проверить» asks with the same id', async () => {
    const w = world();
    const session = await withScript(w);
    w.hub.create = () => Promise.reject(new Failed({ error: { code: 'CG-HUB-TIMEOUT' }, reached: 'unknown' }));
    await w.service.take(TAB, session.sessionId, uuid(0x805), SCRIPT, CAUSE);
    await flush();
    expect(w.store.stored()[0]!.takes[0]).toMatchObject({ state: 'uncertain', error: { code: 'CG-VOICE-UNCERTAIN' }, billed: null });
    for (let i = 0; i < 5; i += 1) await w.tick();
    expect(w.creates).toHaveLength(1);
    // The person's «Проверить»: the same request again — the hub answers the note it has.
    w.hub.create = () => Promise.resolve(note({ voiceNoteId: 78 }));
    await w.service.check(TAB, session.sessionId, uuid(0x805), CAUSE);
    await flush();
    expect(w.creates.map((create) => create.clientRequestId)).toEqual([uuid(0x805), uuid(0x805)]);
    expect(w.store.stored()[0]!.takes[0]).toMatchObject({ state: 'working', voiceNoteId: 78 });
  });

  it('a refusal the hub said spent nothing: refused, never asked again', async () => {
    const w = world();
    const session = await withScript(w);
    w.hub.create = () => Promise.reject(new Failed({ error: { code: 'CG-VOICE-QUOTA', httpStatus: 429 }, reached: 'refused' }));
    await w.service.take(TAB, session.sessionId, uuid(0x806), SCRIPT, CAUSE);
    await flush();
    expect(w.store.stored()[0]!.takes[0]).toMatchObject({ state: 'refused', billed: false, error: { code: 'CG-VOICE-QUOTA' } });
    await w.tick();
    expect(w.creates).toHaveLength(1);
  });

  it('a working take is read until it is ready; its audio is the hub’s, checked by sha256, length and its frames', async () => {
    const w = world();
    const session = await withScript(w);
    await w.service.take(TAB, session.sessionId, uuid(0x807), SCRIPT, CAUSE);
    await flush();
    await w.tick();
    const ready = w.store.stored()[0]!.takes[0]!;
    expect(ready).toMatchObject({ state: 'ready', billed: true, audio: { sha256: sha(MP3), bytes: MP3.byteLength } });
    expect(w.statuses).toEqual([77]);
    const audio = await w.service.audio(TAB, session.sessionId, uuid(0x807));
    expect(audio).toMatchObject({ ok: true, audio: { mime: 'audio/mpeg', sha256: sha(MP3), bytes: MP3.byteLength } });
    // Bytes that are not the note's are never handed out.
    const other = world();
    const otherSession = await withScript(other);
    await other.service.take(TAB, otherSession.sessionId, uuid(0x808), SCRIPT, CAUSE);
    await flush();
    await other.tick();
    other.hub.audio = () => Promise.resolve(new Uint8Array([0xff, 0xfb, 0x90, 0x64, 9, 9]).buffer);
    expect(await other.service.audio(TAB, otherSession.sessionId, uuid(0x808))).toEqual({ ok: false, error: { code: 'CG-VOICE-CORRUPT' } });
  });

  it('a read that fails waits longer before the next one, and never turns into a create', async () => {
    const w = world();
    const session = await withScript(w);
    await w.service.take(TAB, session.sessionId, uuid(0x809), SCRIPT, CAUSE);
    await flush();
    w.hub.status = () => Promise.reject(new Failed({ error: { code: 'CG-NETWORK' }, reached: 'unknown' }));
    await w.tick();
    expect(w.statuses).toHaveLength(1);
    // The next read waits (3 s after one failure): a tick at once reads nothing.
    await w.tick();
    expect(w.statuses).toHaveLength(1);
    w.now += 3_000;
    await w.tick();
    expect(w.statuses).toHaveLength(2);
    expect(w.creates).toHaveLength(1);
    expect(w.store.stored()[0]!.takes[0]!.state).toBe('working');
  });

  it('a rewrite keeps the takes and the script there was; a failed one says why and loses nothing', async () => {
    const w = world();
    const session = await withScript(w);
    await w.service.take(TAB, session.sessionId, uuid(0x80a), SCRIPT, CAUSE);
    await flush();
    const rewrite = await w.service.script(TAB, start({ tone: 'flirty', force: true }), session.sessionId);
    expect(rewrite.ok).toBe(true);
    const opId = rewrite.ok ? (rewrite.session.writing?.opId ?? '') : '';
    w.service.scriptDone(scriptView(opId, { state: 'failed', result: undefined, generationRef: undefined, error: { code: 'CG-PROVIDER-UNAVAILABLE' } } as Partial<VoiceOpView>));
    await flush();
    const after = w.store.stored()[0]!;
    expect(after.script?.original).toBe(SCRIPT);
    expect(after.error).toEqual({ code: 'CG-PROVIDER-UNAVAILABLE' } satisfies CgErrorWire);
    expect(after.takes).toHaveLength(1);
    expect(after.writing).toBeNull();
  });

  it('a background that restarts with a create open turns it uncertain and asks nothing', async () => {
    const w = world();
    const session = await withScript(w);
    w.hub.create = () => new Promise(() => undefined);
    await w.service.take(TAB, session.sessionId, uuid(0x80b), SCRIPT, CAUSE);
    await flush();
    expect(w.store.stored()[0]!.takes[0]!.state).toBe('creating');
    // A new event page over the same storage.
    const next = world({ store: w.store });
    await next.service.resume();
    expect(next.store.stored()[0]!.takes[0]).toMatchObject({ state: 'uncertain', error: { code: 'CG-VOICE-UNCERTAIN' } });
    await next.tick();
    expect(next.creates).toHaveLength(0);
  });

  it('another sign-in finds none of the previous one’s sessions', async () => {
    const w = world();
    await withScript(w);
    w.owner = { hubOrigin: 'https://hub.example.test', userId: 8 };
    expect(await w.service.read(TAB, PAGE.pageId, FAN)).toEqual({ ok: true, session: null });
    expect(w.store.stored()).toHaveLength(0);
  });

  it('«Новый войс» discards the session and tells the tabs', async () => {
    const w = world();
    const session = await withScript(w);
    expect(await w.service.discard(TAB, session.sessionId)).toEqual({ discarded: true });
    expect(w.store.stored()).toHaveLength(0);
    expect(w.emitted.at(-1)).toBeNull();
  });

  it('a storage read that fails writes nothing over the sessions: a read says so, a write is refused, the next call reads again', async () => {
    const store = new MemoryPort().keep([keptSession(FAN, 0, [keptTake(1)])]);
    // The background woke and storage did not answer; a tab reads the chat, then starts a script, while it still does not.
    store.failReads = 3;
    const w = world({ store });
    await w.service.resume();
    expect(await w.service.read(TAB, PAGE.pageId, FAN)).toEqual({ ok: false, error: { code: 'CG-STORAGE-READ' } });
    expect(await w.service.script(TAB, start(), null)).toMatchObject({ ok: false, error: { code: 'CG-STORAGE-READ' } });
    expect(w.started).toHaveLength(0);
    expect(w.store.stored()).toEqual([keptSession(FAN, 0, [keptTake(1)])]);
    // Storage answers again: the chat's session is there, its paid take with it.
    expect(await w.service.read(TAB, PAGE.pageId, FAN)).toMatchObject({ ok: true, session: { sessionId: uuid(0xb00), takes: [{ takeId: uuid(0xc01), state: 'ready' }] } });
    expect(w.store.stored()[0]!.takes).toHaveLength(1);
  });

  it('the cap of sessions lets go of those with nothing paid at stake first, the least recently touched of them', async () => {
    // The cap's worth of chats: the oldest hold paid takes not in the field yet, the rest nothing at stake.
    const atStake = AT_STAKE.map((over, n) => keptSession(String(3000 + n), n, [keptTake(n, over)]));
    const rest = Array.from({ length: VOICE_LIMITS.sessions - atStake.length }, (_, i) => {
      const n = atStake.length + i;
      const over = SETTLED[i];
      return keptSession(String(3000 + n), n, over === undefined ? [] : [keptTake(n, over)]);
    });
    const w = world({ store: new MemoryPort().keep([...atStake, ...rest]) });
    // A new chat's voice: one session goes — the oldest with nothing at stake (its take is in the field).
    await withScript(w);
    const left = w.store.stored().map((session) => session.conversationRef);
    expect(left).toHaveLength(VOICE_LIMITS.sessions);
    expect(left).toEqual(expect.arrayContaining(['3000', '3001', '3002', FAN]));
    expect(left).not.toContain(String(3000 + atStake.length));
  });

  it('a session with a paid take not in the field goes only when every other one has one too: the oldest, never the one just written', async () => {
    const all = Array.from({ length: VOICE_LIMITS.sessions }, (_, n) => keptSession(String(3000 + n), n, [keptTake(n)]));
    const w = world({ store: new MemoryPort().keep(all) });
    await withScript(w);
    const left = w.store.stored().map((session) => session.conversationRef);
    expect(left).toHaveLength(VOICE_LIMITS.sessions);
    expect(left).toContain(FAN);
    expect(left).not.toContain('3000');
  });

  it('«Очистить локальные данные» keeps a session with a paid take not in the field yet (the hub lists no notes); the rest go', async () => {
    const atStake = [...AT_STAKE, { state: 'working', audio: null, billed: null } satisfies Partial<VoiceTake>].map((over, n) => keptSession(String(3000 + n), n, [keptTake(n, over)]));
    const rest = [...SETTLED.map((over, i) => [keptTake(10 + i, over)]), []].map((takes, i) => keptSession(String(3010 + i), 10 + i, takes));
    const w = world({ store: new MemoryPort().keep([...atStake, ...rest]) });
    await w.service.clear();
    expect(w.store.stored().map((session) => session.conversationRef)).toEqual(['3000', '3001', '3002', '3003']);
    expect(w.emitted).toEqual(rest.map(() => null));
    // A storage read that fails clears nothing: what it keeps is not known.
    const failing = new MemoryPort().keep([...atStake, ...rest]);
    failing.failReads = 1;
    await world({ store: failing }).service.clear();
    expect(failing.stored()).toHaveLength(atStake.length + rest.length);
  });

  it('an edit is the person’s text; the AI’s text again is no edit', async () => {
    const w = world();
    const session = await withScript(w);
    const edited = await w.service.edit(TAB, session.sessionId, '[whispers] Hey you');
    expect(edited).toMatchObject({ ok: true, session: { script: { edited: '[whispers] Hey you' } } });
    const back = await w.service.edit(TAB, session.sessionId, `  ${SCRIPT}\r\n`);
    expect(back).toMatchObject({ ok: true, session: { script: { edited: null } } });
  });
});

describe('the page’s day allowance (1.49.0)', () => {
  it('is kept a few seconds, then read again; reads at the same time share one request', async () => {
    const w = world();
    const [first, second] = await Promise.all([w.service.allowance(TAB, PAGE.pageId), w.service.allowance(TAB, PAGE.pageId)]);
    expect([first, second]).toEqual([{ allowance: day(1_400) }, { allowance: day(1_400) }]);
    expect(w.allowanceReads).toEqual([PAGE.pageLabel]);
    w.now += 14_000;
    w.hub.allowance = () => Promise.resolve(day(900));
    expect(await w.service.allowance(TAB, PAGE.pageId)).toEqual({ allowance: day(1_400) });
    w.now += 1_000;
    expect(await w.service.allowance(TAB, PAGE.pageId)).toEqual({ allowance: day(900) });
    expect(w.allowanceReads).toHaveLength(2);
  });

  it('a take the hub admits, refuses or settles moves the day: a tab told of it reads the hub’s new count', async () => {
    const w = world();
    const session = await withScript(w);
    await w.service.allowance(TAB, PAGE.pageId);
    // Admitted: a tab that reads the day as it hears of the take gets the hub's new count, not the one kept a moment ago.
    const told: Promise<{ readonly allowance: VoiceAllowance | null }>[] = [];
    w.onEmit = (changed) => {
      if (changed?.takes[0]?.state === 'working') told.push(w.service.allowance(TAB, PAGE.pageId));
    };
    w.hub.allowance = () => Promise.resolve(day(1_400 - SCRIPT.length));
    await w.service.take(TAB, session.sessionId, uuid(0x901), SCRIPT, CAUSE);
    await flush();
    w.onEmit = null;
    expect(told).toHaveLength(1);
    expect(await told[0]).toEqual({ allowance: day(1_400 - SCRIPT.length) });
    expect(w.allowanceReads).toHaveLength(2);
    // A status read that finds it still working moves nothing; the one that finds it ready does.
    w.hub.status = () => Promise.resolve(note());
    await w.tick();
    await w.service.allowance(TAB, PAGE.pageId);
    expect(w.allowanceReads).toHaveLength(2);
    w.hub.status = () => Promise.resolve(note({ state: 'completed', billed: true, audioSha256: sha(MP3), audioBytesLen: MP3.byteLength }));
    await w.tick();
    expect(w.store.stored()[0]!.takes[0]!.state).toBe('ready');
    await w.service.allowance(TAB, PAGE.pageId);
    expect(w.allowanceReads).toHaveLength(3);
    // A refusal spent nothing, yet says something of the day (another chatter may have spent it): read again too.
    w.hub.create = () => Promise.reject(new Failed({ error: { code: 'CG-VOICE-QUOTA', httpStatus: 429 }, reached: 'refused' }));
    await w.service.take(TAB, session.sessionId, uuid(0x902), SCRIPT, CAUSE);
    await flush();
    await w.service.allowance(TAB, PAGE.pageId);
    expect(w.allowanceReads).toHaveLength(4);
  });

  it('an answer on its way when a take moves is not kept: the next read asks again', async () => {
    const w = world();
    const session = await withScript(w);
    let answer: (value: VoiceAllowance) => void = () => undefined;
    w.hub.allowance = () => new Promise((resolve) => (answer = resolve));
    const before = w.service.allowance(TAB, PAGE.pageId);
    await flush();
    await w.service.take(TAB, session.sessionId, uuid(0x903), SCRIPT, CAUSE);
    await flush();
    answer(day(1_400));
    expect(await before).toEqual({ allowance: day(1_400) });
    w.hub.allowance = () => Promise.resolve(day(1_400 - SCRIPT.length));
    expect(await w.service.allowance(TAB, PAGE.pageId)).toEqual({ allowance: day(1_400 - SCRIPT.length) });
    expect(w.allowanceReads).toHaveLength(2);
  });

  it('a failure is «not known», kept like an answer; a page not the sender’s is never asked; nothing paid is asked by it', async () => {
    const w = world();
    w.hub.allowance = () => Promise.reject(new Failed({ error: { code: 'CG-HUB-REQUEST', httpStatus: 404 }, reached: 'refused' }));
    expect(await w.service.allowance(TAB, PAGE.pageId)).toEqual({ allowance: null });
    expect(await w.service.allowance(TAB, PAGE.pageId)).toEqual({ allowance: null });
    expect(w.allowanceReads).toHaveLength(1);
    expect(await w.service.allowance(TAB, 99)).toEqual({ allowance: null });
    expect(w.allowanceReads).toHaveLength(1);
    expect(w.creates).toHaveLength(0);
  });
});

