import { CLIENT_FEATURE_FLAG_NAMES, type ClaimBody, type ClaimState, type OpView, type SendAttemptView, type SendBegin, type SessionIdentity } from '@cg/contracts';
import { T0, checkpoint, session, target, uuid } from '@cg/contracts/fixtures';
import type { OpsEnvironment } from '@cg/core/domain/ops';
import type { Clock } from '@cg/core/services';
import { BOOTSTRAP_PILOT_PAGES, resolveHubErrorReference } from '@cg/testing/hub';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chatSpaceModule } from '../bg/chatspace';
import type { BackgroundHostHandle, BackgroundKit } from '../src/composition/background/host-module';
import { CHATSPACE_FEATURE_SLICE } from '../src/composition/features/chatspace';
import { memoryStore } from './support/memory-store';

const TAB = uuid(0xa1);
const OP = uuid(0x100);
const ATTEMPT = uuid(0x500);
const NOW_MS = T0;
const MESSAGE = '4100';
const persona = { key: 'default', definitionId: 'pdef_0123456789abcdef' };
const group = { generationRef: uuid(0x200), variant: 0, partCount: 1 };
const handles: BackgroundHostHandle[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.dispose();
});

async function harness() {
  const clock: Clock = { now: () => NOW_MS, setTimer: vi.fn(() => 1), clearTimer: vi.fn() };
  const local = memoryStore('local');
  const sent = vi.fn<BackgroundKit['attributions']['sent']>();
  let currentSession: SessionIdentity | null = session;
  let view: OpView | null = null;
  const bootstrap = {
    ...BOOTSTRAP_PILOT_PAGES,
    flags: Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, true])),
    pages: BOOTSTRAP_PILOT_PAGES.pages.map((page) => ({ ...page, features: Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, { available: true }])) })),
    limits: { ...BOOTSTRAP_PILOT_PAGES.limits, previewSendReceiptProfiles: [{ id: 'chatspace-test', adapterVersion: '1.0.0', modules: { notificationEntry: 'sha256-0001' } }] },
  };
  const environment = (): OpsEnvironment => ({ session: currentSession, bootstrap, persona: () => persona, debug: false, settingsLoaded: true, features: () => CHATSPACE_FEATURE_SLICE });
  const keyData = new Map<string, unknown>();
  const keys = { get: (key: string) => Promise.resolve(keyData.get(key)), set: (key: string, value: unknown) => { keyData.set(key, structuredClone(value)); return Promise.resolve(); } };
  const state = (body?: ClaimBody): ClaimState => ({
    greeting: { state: 'none', at: null, messageRef: null, source: null },
    lease: { state: 'none', leaseToken: null, expiresAt: null, heldBy: null },
    group: { ...group, sentParts: [], heldParts: [] },
    custody: body?.action === 'dispatch'
      ? { attemptId: body.attemptId, state: 'dispatching', ticket: 'ticket', ticketExpiresAt: new Date(NOW_MS + 10_000).toISOString() }
      : null,
    serverNow: new Date(clock.now()).toISOString(),
    flagRevision: bootstrap.configRevision,
  });
  const kit = {
    clock,
    ids: { uuid: () => uuid(0x900) },
    hub: {
      facade: { claim: ({ body }: { body: ClaimBody }) => Promise.resolve(state(body)), claimStatus: () => Promise.resolve(state()) },
      call: <T>(_route: string, run: () => Promise<T>) => run(),
      resolve: resolveHubErrorReference,
      bootstrap: () => bootstrap,
    },
    storage: { local, localKeys: keys, sessionKeys: keys },
    log: { sink: { write: vi.fn() }, service: vi.fn() },
    telemetry: { report: vi.fn(), countCode: vi.fn() },
    router: { events: { emit: vi.fn() }, tabs: () => [TAB] },
    ops: {
      environment,
      view: () => view,
      forSend: () => view === null ? null : { view, checkpoint, tag: { hubOrigin: session.hubOrigin, userId: session.userId, signInEpoch: session.epoch, pageId: target.binding.pageId, personaKey: persona.key, personaDefinitionId: persona.definitionId } },
    },
    tokens: { redeem: vi.fn(() => true) },
    install: { instanceId: () => uuid(0x900), owner: () => currentSession === null ? null : `${currentSession.hubOrigin}|${currentSession.userId}` },
    attributions: { sent },
  } as unknown as BackgroundKit;
  const start = async (): Promise<BackgroundHostHandle> => {
    const handle = await chatSpaceModule().start(kit);
    handles.push(handle);
    return handle;
  };
  let handle = await start();
  const report = (state: SendAttemptView['state'], platformMessageId?: string) => handle.onTabMessage({
    type: 'send.report', sender: { kind: 'tab', tabSessionId: TAB },
    payload: { view: { attemptId: ATTEMPT, state, ...(platformMessageId === undefined ? {} : { platformMessageId }) }, ...(state === 'nativeEnqueued' ? { pendingId: 'pending-1' } : {}) },
  });
  return {
    sent,
    async begin(options: { manual?: boolean; purpose?: SendBegin['purpose']; textRevision?: number; priced?: boolean } = {}) {
      const manual = options.manual ?? true;
      if (!manual) view = { opId: OP, feature: 'reply', surface: 'preview', target, state: 'done', phase: { name: 'settled', since: NOW_MS }, startedAt: NOW_MS, endedAt: NOW_MS, generationRef: group.generationRef, result: { kind: 'parts', parts: ['AI reply'], splitRequested: false }, toneUsed: null };
      const payload: SendBegin = {
        attemptId: ATTEMPT, opId: OP, target, purpose: options.purpose ?? 'preview-reply', group, part: { index: 0 }, previewRevision: 0,
        textRevision: options.textRevision ?? 0, checkpoint, documentEpoch: checkpoint.documentEpoch, acceptFreshness: true,
        cause: { kind: 'click', actionToken: uuid(0x300) },
        ...(manual ? { manual: { textFingerprint: 'a'.repeat(64) } } : {}),
        marks: { priced: options.priced ?? false, withMedia: options.priced ?? false },
      };
      expect(await handle.onTabMessage({ type: 'send.begin', sender: { kind: 'tab', tabSessionId: TAB }, payload })).toMatchObject({ ok: true, payload: { ok: true } });
      expect(await report('nativeEnqueued')).toMatchObject({ ok: true, payload: { recorded: true } });
    },
    report,
    async confirm() {
      expect(await report('nativeAccepted', MESSAGE)).toMatchObject({ ok: true, payload: { recorded: true } });
      expect(sent).not.toHaveBeenCalled();
      expect(await report('sentObserved', MESSAGE)).toMatchObject({ ok: true, payload: { recorded: true } });
    },
    switchSession(next: SessionIdentity | null) { currentSession = next; view = null; },
    async restart() { await handle.dispose(); handles.splice(handles.indexOf(handle), 1); handle = await start(); },
  };
}

describe('ChatSpace preview send attribution', () => {
  it.each([
    { name: 'draft Send', purpose: 'preview-reply' as const, priced: false, textRevision: 0 },
    { name: 'own text with PPV', purpose: 'greeting' as const, priced: true, textRevision: 0 },
    { name: 'edited Online guide text', purpose: 'preview-reply' as const, priced: false, textRevision: 1 },
  ])('$name is attributed as hand without a scheduler operation, once and only after proof', async ({ purpose, priced, textRevision }) => {
    const h = await harness();
    await h.begin({ purpose, priced, textRevision });
    expect(h.sent).not.toHaveBeenCalled();
    await h.confirm();
    expect(h.sent).toHaveBeenCalledExactlyOnceWith({ pageId: target.binding.pageId, fanRef: target.fanRef, platformMessageId: MESSAGE, priced, withMedia: priced, composedWith: 'hand', edited: textRevision > 0 });
    await h.report('sentObserved', MESSAGE);
    expect(h.sent).toHaveBeenCalledTimes(1);
  });

  it('keeps a manual send’s attribution across a background restart and a late receipt', async () => {
    const h = await harness();
    await h.begin({ priced: true });
    await h.report('uncertain');
    await h.restart();
    await h.confirm();
    expect(h.sent).toHaveBeenCalledExactlyOnceWith({ pageId: target.binding.pageId, fanRef: target.fanRef, platformMessageId: MESSAGE, priced: true, withMedia: true, composedWith: 'hand' });
  });

  it.each([
    null,
    { ...session, userId: session.userId + 1 },
    { ...session, hubOrigin: 'https://another-hub.example.test' },
    { ...session, epoch: session.epoch + 1 },
  ])('does not attribute the original manual send to a different sign-in: %j', async (next) => {
    const h = await harness();
    await h.begin();
    h.switchSession(next);
    await h.restart();
    await h.confirm();
    expect(h.sent).not.toHaveBeenCalled();
  });

  it('still attributes an edited AI reply with its feature', async () => {
    const h = await harness();
    await h.begin({ manual: false, textRevision: 1 });
    await h.confirm();
    expect(h.sent).toHaveBeenCalledExactlyOnceWith({ pageId: target.binding.pageId, fanRef: target.fanRef, platformMessageId: MESSAGE, priced: false, withMedia: false, composedWith: 'reply', edited: true });
  });
});
