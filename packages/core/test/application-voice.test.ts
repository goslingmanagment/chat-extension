// The voice studio's controller (application/voice/controller.ts) over the real desk and the real background service,
// the tab's requests handed straight to it: one click is one paid render — a second «Озвучить» or «Ещё вариант» while
// a create of the chat is unanswered does nothing, the button says so, and whatever became of the create (admitted,
// refused, uncertain, a click that was refused) the next click counts again; a take handed over without its outcome seen is
// still the person's money — a new draft in the field waits for «Новый войс», which asks first.

import { chatKeyOf, type ActionReceipt, type TabRequestPayload, type Target, type UiAction, type VoiceNoteView, type VoiceSession, type VoiceTake, type VoiceVM } from '@cg/contracts';
import type { KeyValuePort, StorageResult } from '@cg/core/services';
import { createVoiceController } from '@cg/core/application/voice';
import { createI18n } from '@cg/core/domain/i18n';
import { VOICE_SESSIONS_KEY, VoiceService, type VoiceFailure } from '@cg/core/services/voice';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { describe, expect, it } from 'vitest';

import { type AiPorts } from '../src/application/ai/ports';
import { VoiceDesk } from '../src/application/ai/voice-desk';
import { type AiWorkspace } from '../src/application/ai/workspace';
import { binding, chatOf, uuid } from './support/world';

const NOW = Date.parse('2026-10-23T10:00:00.000Z');
const FAN = '2002';
const PAGE = { pageId: binding.pageId, pageLabel: binding.pageLabel, platform: 'onlyfans' } as const;
const OWNER = { hubOrigin: 'https://hub.example.test', userId: 7 } as const;
const SCRIPT = '[warmly] Hey you, I missed you today.';
const SHA = 'a'.repeat(64);
const chat = chatOf(FAN);
const target: Target = { binding, chat, fanRef: FAN, conversationRef: FAN };

/** A take as storage keeps it: ready, not put into the field yet, unless `over` says otherwise. */
const take = (n: number, over: Partial<VoiceTake> = {}): VoiceTake => ({
  takeId: uuid(0x800 + n),
  createdAt: NOW - 500,
  script: SCRIPT,
  sourceGenerationRef: uuid(0x700),
  state: 'ready',
  voiceNoteId: 70 + n,
  audio: { sha256: SHA, bytes: 1_000 },
  billed: true,
  error: null,
  attached: null,
  ...over,
});

/** The chat's session with its script written and these takes of it. */
const kept = (takes: readonly VoiceTake[]): VoiceSession => ({
  sessionId: uuid(0x600),
  pageId: PAGE.pageId,
  chat,
  conversationRef: FAN,
  fanRef: FAN,
  createdAt: NOW - 1_000,
  updatedAt: NOW - 1_000,
  revision: 3,
  draft: 'hey you',
  script: { tone: 'calm', generationRef: uuid(0x700), original: SCRIPT, edited: null },
  writing: null,
  error: null,
  takes: [...takes],
});

/** A thrown failure that carries how it reads (the composition's reading is its own test). */
class Failed extends Error {
  constructor(readonly read: VoiceFailure) {
    super(read.error.code);
  }
}

const note = (over: Partial<VoiceNoteView> = {}): VoiceNoteView => ({
  voiceNoteId: 90,
  state: 'dispatched',
  scriptChars: SCRIPT.length,
  billed: null,
  audioSha256: null,
  audioBytesLen: null,
  createdAt: new Date(NOW).toISOString(),
  ...over,
});

interface Rig {
  vm(): VoiceVM;
  dispatch(action: UiAction): Promise<ActionReceipt>;
  /** The hub's creates, by their `clientRequestId`, in order. */
  readonly creates: string[];
  /** Settles the oldest create still waiting for the hub: its note, or a failure. */
  answer(outcome: VoiceNoteView | VoiceFailure): Promise<void>;
  /** The sessions in storage. */
  stored(): readonly VoiceSession[];
  /** Whether the next click's token is issued. */
  tokens: boolean;
}

/** Every promise chained so far settles (a macrotask runs after all of them). */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** The studio of the open chat, open, over storage that keeps `takes` of its script; `draft` — the field's text. */
async function rig(takes: readonly VoiceTake[], draft = ''): Promise<Rig> {
  let ids = 0x5000;
  const nextId = (): string => uuid((ids += 1));
  const values = new Map<string, unknown>([[VOICE_SESSIONS_KEY, { v: 1, owner: OWNER, sessions: [kept(takes)] }]]);
  const store: KeyValuePort = {
    get: (keys): Promise<StorageResult<Readonly<Record<string, unknown>>>> => Promise.resolve({ ok: true, value: Object.fromEntries(keys.filter((key) => values.has(key)).map((key) => [key, structuredClone(values.get(key))])) }),
    set: (items): Promise<StorageResult<void>> => {
      for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value));
      return Promise.resolve({ ok: true, value: undefined });
    },
    remove: () => Promise.resolve({ ok: true, value: undefined }),
    keys: () => Promise.resolve({ ok: true, value: [...values.keys()] }),
    onChanged: () => () => undefined,
  };
  const waiting: { resolve(view: VoiceNoteView): void; reject(error: Failed): void }[] = [];
  const listeners = new Map<string, (payload: unknown) => void>();
  const creates: string[] = [];
  const service = new VoiceService<string>({
    now: () => NOW,
    ids: { uuid: nextId },
    timers: { set: () => 0, clear: () => undefined },
    store,
    hub: {
      create: (request) => {
        creates.push(request.body.clientRequestId);
        return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
      },
      status: () => Promise.resolve(note({ state: 'completed', billed: true, audioSha256: SHA, audioBytesLen: 1_000 })),
      audio: () => Promise.reject(new Failed({ error: { code: 'CG-NETWORK' }, reached: 'unknown' })),
      allowance: () => Promise.reject(new Failed({ error: { code: 'CG-NETWORK' }, reached: 'unknown' })),
    },
    failure: (error) => (error instanceof Failed ? error.read : { error: { code: 'CG-UNKNOWN' }, reached: 'unknown' }),
    page: (pageId) => Promise.resolve(pageId === PAGE.pageId ? { ok: true, page: PAGE } : { ok: false, code: 'CG-BINDING-NOT-GRANTED' }),
    pageLabel: (pageId) => (pageId === PAGE.pageId ? PAGE.pageLabel : null),
    tabOf: (sender) => sender,
    redeem: () => true,
    ops: { start: () => Promise.resolve({ kind: 'admission', admission: { ok: true, opId: uuid(0x900) }, reopened: false }), view: () => null },
    owner: () => OWNER,
    emit: (change) => listeners.get('voice.changed')?.(change),
    sha256: () => Promise.resolve(SHA),
    log: () => undefined,
  });
  const TAB = 'tab-1';
  const ok = <T>(payload: T): { readonly ok: true; readonly payload: T } => ({ ok: true, payload });
  /** The background's answers, as its handlers give them (composition/background/voice.ts). */
  const answers: { readonly [T in 'voice.read' | 'voice.take' | 'voice.script' | 'voice.edit' | 'voice.allowance']: (payload: TabRequestPayload<T>) => Promise<unknown> } = {
    'voice.read': async ({ pageId, conversationRef }) => {
      const read = await service.read(TAB, pageId, conversationRef);
      return read.ok ? ok({ session: read.session }) : read;
    },
    'voice.take': async ({ sessionId, takeId, script, cause }) => ok(await service.take(TAB, sessionId, takeId, script, cause)),
    'voice.script': async ({ start, sessionId }) => ok(await service.script(TAB, start, sessionId)),
    'voice.edit': async ({ sessionId, text }) => ok(await service.edit(TAB, sessionId, text)),
    'voice.allowance': () => Promise.resolve(ok({ allowance: null })),
  };
  const rpc = {
    async request(type: string, payload: unknown): Promise<unknown> {
      // A message to the background and its answer: never in the same turn.
      await Promise.resolve();
      const answer = (answers as Readonly<Record<string, ((payload: unknown) => Promise<unknown>) | undefined>>)[type];
      return answer === undefined ? { ok: false, error: { code: 'CG-UNKNOWN' } } : answer(payload);
    },
    onEvent(type: string, listener: (payload: unknown) => void) {
      listeners.set(type, listener);
      return () => listeners.delete(type);
    },
  };
  const clock = { now: () => NOW, setTimer: () => 0, clearTimer: () => undefined };
  const ports = {
    rpc,
    clock,
    ids: { uuid: nextId },
    i18n: createI18n({ language: 'ru', now: () => NOW, timeZone: 'UTC' }),
    catalog: createFakeCatalog(ctxOf({ now: NOW })),
    host: {
      attachFile: () => Promise.resolve({ state: 'attached' }),
      readDraft: () => Promise.resolve({ plainText: draft, revision: 1, digest: 'd' }),
      current: () => ({ route: { epoch: 1 } }),
    },
  } as unknown as AiPorts;
  const key = chatKeyOf(chat);
  const situation = {
    chat: { chat, conversationRef: FAN, key, handle: 'h1', account: null, identity: { chat }, routeEpoch: 1 },
    ready: { page: { pageId: PAGE.pageId }, target, settings: { generation: { windows: {} } }, bootstrap: { limits: { deepMax: 50 } } },
    host: { composer: { draft: { provenance: draft === '' ? 'empty' : 'human' } }, contract: { capabilities: { fileAttach: { state: 'on' } } } },
    fanName: 'Ann',
  };
  let version = 0;
  const subscribers = new Set<() => void>();
  const bump = (): void => {
    version += 1;
    for (const subscriber of subscribers) subscriber();
  };
  const r = { tokens: true };
  const voice = new VoiceDesk({ ports, changed: bump, openChat: () => ({ key, pageId: PAGE.pageId, conversationRef: FAN }), studioOpen: () => true });
  const ws = {
    ports,
    voice,
    get version() {
      return version;
    },
    bump,
    subscribe(subscriber: () => void) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    situation: () => situation,
    sheet: () => ({ kind: 'voice' }),
    setSheet: () => undefined,
    admitted: () => ({ usable: true, reason: null }),
    token: (_kind: string, _surface: string, cause: string) => Promise.resolve(r.tokens ? ok({ kind: cause, actionToken: `tok_${nextId().slice(-16)}` }) : { ok: false, error: { code: 'CG-HUB-TIMEOUT' } }),
  } as unknown as AiWorkspace;
  const controller = createVoiceController(ws);
  const vm = (): VoiceVM => controller.getSnapshot({ of: 'voice' }) as VoiceVM;
  // The studio opens: the chat's session as the background keeps it.
  vm();
  await settle();
  return Object.assign(r, {
    vm,
    creates,
    dispatch: (action: UiAction): Promise<ActionReceipt> => {
      const receipt = controller.dispatch(action);
      if (receipt === null) throw new Error(`the studio does not take ${action.type}`);
      return receipt;
    },
    async answer(outcome: VoiceNoteView | VoiceFailure) {
      const next = waiting.shift();
      if (next === undefined) throw new Error('no create waits for the hub');
      if ('voiceNoteId' in outcome) next.resolve(outcome);
      else next.reject(new Failed(outcome));
      await settle();
    },
    stored: () => (values.get(VOICE_SESSIONS_KEY) as { readonly sessions: readonly VoiceSession[] }).sessions,
  });
}

/** The studio's button that voices: «Озвучить» first, «Ещё вариант» beside a ready take. */
function makeButton(vm: VoiceVM): NonNullable<VoiceVM['primary']> {
  const found = [vm.primary, vm.secondary].find((button) => button?.action.type === 'MakeVoiceTake');
  if (found === undefined || found === null) throw new Error(`no voicing button: ${JSON.stringify([vm.primary, vm.secondary])}`);
  return found;
}

describe('the voice studio: one click, one render', () => {
  it('«Озвучить» pressed twice before the first answer asks the hub once; the button waits meanwhile', async () => {
    const r = await rig([]);
    const make = makeButton(r.vm());
    expect(make).toMatchObject({ enabled: true, label: { key: 'voice.make' } });
    const first = r.dispatch(make.action);
    // The second press of a double click, before the first got any answer.
    const second = r.dispatch(make.action);
    expect(makeButton(r.vm())).toMatchObject({ enabled: false, reason: { id: 'voice-working' } });
    expect(await second).toMatchObject({ ok: true, outcome: 'noop' });
    expect(await first).toMatchObject({ ok: true, outcome: 'started' });
    await settle();
    expect(r.creates).toHaveLength(1);
    expect(r.stored()[0]!.takes).toHaveLength(1);
  });

  it('«Ещё вариант» waits while the new take’s create is unanswered: a press then does nothing; once the hub admitted it, it counts again', async () => {
    const r = await rig([take(1)]);
    const again = makeButton(r.vm());
    expect(again).toMatchObject({ enabled: true, label: { key: 'voice.makeAgain' } });
    await r.dispatch(again.action);
    await settle();
    // Written, the hub asked, no answer yet: one more press is nothing.
    expect(r.stored()[0]!.takes[1]!.state).toBe('creating');
    expect(makeButton(r.vm())).toMatchObject({ enabled: false, reason: { id: 'voice-creating' } });
    expect(await r.dispatch(again.action)).toMatchObject({ ok: true, outcome: 'noop' });
    expect(r.creates).toHaveLength(1);
    // The hub admitted it and it renders on its own: another take beside it is the person's choice again (the old extension's way).
    await r.answer(note());
    expect(r.stored()[0]!.takes[1]!.state).toBe('working');
    expect(makeButton(r.vm())).toMatchObject({ enabled: true, reason: null });
    expect(await r.dispatch(again.action)).toMatchObject({ ok: true, outcome: 'started' });
    expect(r.creates).toHaveLength(2);
  });

  it('whatever became of the take — refused, uncertain, a click that was refused — the next click counts again', async () => {
    const r = await rig([take(1)]);
    const again = makeButton(r.vm()).action;
    // The click's token is refused: nothing was asked, the button is free at once.
    r.tokens = false;
    expect(await r.dispatch(again)).toMatchObject({ ok: false });
    expect(makeButton(r.vm()).enabled).toBe(true);
    r.tokens = true;
    // The hub refused the create (nothing spent), then a create got no answer (uncertain, «Проверить»).
    await r.dispatch(again);
    await r.answer({ error: { code: 'CG-VOICE-QUOTA', httpStatus: 429 }, reached: 'refused' });
    expect(makeButton(r.vm()).enabled).toBe(true);
    await r.dispatch(again);
    await r.answer({ error: { code: 'CG-HUB-TIMEOUT' }, reached: 'unknown' });
    expect(r.vm().takes.map((one) => one.state)).toEqual(['ready', 'refused', 'uncertain']);
    expect(makeButton(r.vm()).enabled).toBe(true);
    expect(r.creates).toHaveLength(2);
  });
});

describe('the voice studio: a take handed over and not seen is still at stake', () => {
  it('reopened with a new draft in the field, the studio keeps it; «Новый войс» asks first', async () => {
    const r = await rig([take(1, { attached: { state: 'unknown', at: NOW - 100 } })], 'a new caption for her');
    expect(await r.dispatch({ type: 'ShowVoice', targetHandle: 'h1', open: true })).toMatchObject({ ok: true, outcome: 'opened' });
    await settle();
    expect(r.stored().map((session) => [session.sessionId, session.takes.length])).toEqual([[uuid(0x600), 1]]);
    expect(await r.dispatch({ type: 'NewVoice', targetHandle: 'h1' })).toMatchObject({ ok: true, outcome: 'needs-confirm' });
    expect(r.vm().confirm?.lead).toMatchObject({ key: 'voice.confirm.unattached' });
    expect(r.stored()[0]!.takes).toHaveLength(1);
  });

  it('one seen in the field gives way to the new draft at once, as before', async () => {
    const r = await rig([take(1, { attached: { state: 'attached', at: NOW - 100 } })], 'a new caption for her');
    expect(await r.dispatch({ type: 'ShowVoice', targetHandle: 'h1', open: true })).toMatchObject({ ok: true, outcome: 'started' });
    await settle();
    expect(r.stored().map((session) => session.takes.length)).toEqual([0]);
  });
});
