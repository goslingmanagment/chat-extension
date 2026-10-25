// P9e review: hiding preview-send must not forget the person's own Fansly send.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type HostEvent, type NavigationReceipt, type TabResponsePayload } from '@cg/contracts';
import { ACTION_TOKEN, TAB_REQUEST_FIXTURES, binding, opView, session, uuid } from '@cg/contracts/fixtures';
import { Surfaces, fanHandle, type PageContextPort, type PreviewTargetInfo, type TabRpc } from '@cg/core/application/boards';
import { createI18n } from '@cg/core/domain/i18n';
import { FakeHostPort, memory, startSnapshot, type HostStep } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, NOW_MS, WORLD } from '@cg/testing/hub';
import { createPreviewController } from '../lazy/fansly/boards-preview';

const FANSLY = { creator: WORLD.pages.fansly.platformAccountId, fan: '7102', group: '7203' };
const fanslyChat = { host: 'fansly-web', hostAccountId: FANSLY.creator, platformFanId: FANSLY.fan } as const;
const fanslyAccount = { host: 'fansly-web', hostAccountId: FANSLY.creator, platform: 'fansly', platformAccountId: FANSLY.creator, username: null, displayName: null } as const;
const fanslyBinding = { ...binding, host: fanslyAccount.host, hostAccountId: FANSLY.creator, platform: fanslyAccount.platform, platformAccountId: FANSLY.creator, pageId: WORLD.pages.fansly.pageId, pageLabel: WORLD.pages.fansly.pageLabel };
const persona = { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId };
const settle = async (turns = 3) => { for (let i = 0; i < turns; i++) await new Promise<void>((resolve) => setImmediate(resolve)); };

const live: { dispose(): void }[] = [];
afterEach(() => { for (const item of live.splice(0)) item.dispose(); vi.restoreAllMocks(); });
const applied: NavigationReceipt = { state: 'navigated', routeEpoch: 6, insert: { state: 'applied', draftRevision: 1, draftDigest: 'feedbeef0000aaaa', ms: 12 } };

async function preview() {
  let timer = 0;
  let id = 0x9000;
  const clock = { now: () => NOW_MS, setTimer: () => ++timer, clearTimer: () => undefined };
  const bootstrap = { ...BOOTSTRAP_PILOT_PAGES, pages: BOOTSTRAP_PILOT_PAGES.pages.map((page) => page.pageId === fanslyBinding.pageId ? { ...page, features: BOOTSTRAP_PILOT_PAGES.pages[0]!.features } : page) };
  const settings = { ...DEFAULT_SETTINGS, generation: { ...DEFAULT_SETTINGS.generation, split: true }, personas: { scope: { hubOrigin: session.hubOrigin, userId: session.userId }, byPageId: { [String(fanslyBinding.pageId)]: persona } } };
  const opId = uuid(0x100);
  let generated = false;
  const requests: string[] = [];
  const rpc: TabRpc = {
    request(type) {
      requests.push(type);
      let payload: unknown;
      if (type === 'op.start') { generated = true; payload = { ok: true, opId }; }
      else if (type === 'op.list') payload = { ops: generated ? [{ ...opView, opId, surface: 'preview', target: { binding: fanslyBinding, chat: fanslyChat, fanRef: FANSLY.fan, conversationRef: FANSLY.group }, result: { kind: 'parts', parts: ['First part', 'Second part'], splitRequested: true } }] : [], truncated: false };
      else if (type === 'token.issue') payload = { actionToken: ACTION_TOKEN, expiresAt: NOW_MS + 5000 };
      else if (type === 'feed.read' || type === 'fan.card') payload = TAB_REQUEST_FIXTURES[type].res.valid[0];
      else payload = { recorded: true };
      return Promise.resolve({ ok: true, payload: payload as TabResponsePayload<typeof type> });
    },
    onEvent: () => () => undefined,
  };
  const timeline: HostStep[] = [];
  const host = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: { navigate: [applied, applied] }, timeline }, NOW_MS);
  live.push(host);
  const context: PageContextPort = {
    current: () => ({ phase: 'ready', blocker: null, session, bootstrap, settings, epoch: 1, account: fanslyAccount, binding: fanslyBinding, page: bootstrap.pages.find((page) => page.pageId === fanslyBinding.pageId) ?? null, persona: { ...persona, label: null } }),
    subscribe: () => () => undefined, refresh: () => Promise.resolve(), dispose: () => undefined,
  };
  const info: PreviewTargetInfo = { handle: fanHandle('spenders', fanslyBinding.pageId, FANSLY.fan), source: 'spenders', pageId: fanslyBinding.pageId, fanRef: FANSLY.fan, conversationRef: FANSLY.group, name: 'Fan', username: null, lifetime: null, period30: null, weWroteAt: null, fanWroteAt: null, newcomer: null };
  const controller = createPreviewController({
    rpc, host, clock, context, ids: { uuid: () => uuid(id++) }, surfaces: new Surfaces(),
    i18n: createI18n({ language: 'ru', now: () => clock.now(), timeZone: 'Europe/Moscow' }),
    navigator: { open: () => Promise.resolve({ state: 'navigated', routeEpoch: 6, insert: null }) },
    directories: { spenders: { resolve: (handle) => handle === info.handle ? info : null, neighbours: () => ({ previous: null, next: null }), subscribe: () => () => undefined }, newcomers: null, palette: null, outreach: null },
    greeting: null, sender: null, drafts: null, clipboard: null, notifier: null, handover: () => undefined,
  });
  live.push(controller);
  const snapshot = () => controller.getSnapshot({ of: 'preview', from: 'spenders' });
  controller.subscribe({ of: 'preview', from: 'spenders' }, () => undefined);
  const reopen = async () => {
    await controller.dispatch({ type: 'OpenPreview', targetHandle: info.handle });
    await settle(12);
  };
  await reopen();
  expect(await controller.dispatch({ type: 'Generate', targetHandle: info.handle, feature: 'reply', options: {} })).toMatchObject({ ok: true, opId });
  await settle(12);
  expect(snapshot().result?.parts?.map((part) => part.text)).toEqual(['First part', 'Second part']);
  const insert = (part: number) => controller.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part });
  const emit = (event: HostEvent) => { timeline.push({ kind: 'event', at: clock.now() - NOW_MS, event }); host.advance(); };
  const sent = (insertIntentId: string, extra: Partial<Extract<HostEvent, { type: 'humanSend' }>['fact']> = {}) => emit({ type: 'humanSend', fact: { chat: fanslyChat, pendingId: 'g1', platformMessageId: '4100', textDigest: 'feedbeef0000aaaa', draft: { revision: 1, provenance: 'our-insert', insertIntentId, editedSinceInsert: false }, ...extra } });
  return { controller, host, snapshot, reopen, insert, sent, opId, requests };
}

describe('[host:fansly] Spenders preview and the person’s own Send (P9e)', () => {
  it('[SP-054] [TL-004] insert part 0 → humanSend confirmed by P7f → reopen: sent part cannot be inserted again; part 1 is next', async () => {
    const w = await preview();
    expect(w.snapshot().result).toMatchObject({ draftNotSent: true });
    expect(await w.insert(0)).toMatchObject({ ok: true, outcome: 'opened' });
    const intentId = w.host.calls.navigations[0]?.thenInsert?.intentId;
    expect(intentId).toBeDefined();
    w.sent(intentId!);
    await settle();
    await w.reopen();
    expect(w.snapshot().result).toMatchObject({ draftNotSent: false, sendProgress: { sent: 1, total: 2 } });
    const [first, second] = w.snapshot().result?.parts ?? [];
    expect(first).toMatchObject({ send: { s: 'sent' }, collapsed: true, next: false, openInsert: { s: 'hidden' } });
    expect(second).toMatchObject({ next: true, sendOrder: null, openInsert: { s: 'available' } });
    expect(second?.send).toBeUndefined();
    expect(await w.insert(0)).toMatchObject({ ok: false });
    expect(await w.insert(1)).toMatchObject({ ok: true, outcome: 'opened' });
    expect(w.host.calls.navigations.map((intent) => intent.thenInsert?.part)).toEqual([{ index: 0 }, { index: 1 }]);
    expect(w.host.calls.commits).toEqual([]);
    expect(w.requests.filter((type) => type === 'send.list')).toHaveLength(0);
    expect(await w.controller.dispatch({ type: 'SendPart', operationId: w.opId, part: 1 })).toMatchObject({ ok: false, code: 'CG-FEATURE-DISABLED' });
    // Continuing with the result in the dock accounts for its own proven sends too.
    w.controller.results.manualSent?.(w.opId, { index: 1 }, '4101');
    await w.reopen();
    expect(w.snapshot().result?.sendProgress).toEqual({ sent: 2, total: 2 });
    expect(await w.insert(1)).toMatchObject({ ok: false });
  });

  it('only a proven send of the linked insert in its own chat counts, including a human edit; duplicate observations are idempotent', async () => {
    const w = await preview();
    await w.insert(0);
    const intentId = w.host.calls.navigations[0]!.thenInsert!.intentId;
    w.sent('another-insert');
    w.sent(intentId, { platformMessageId: null });
    w.sent(intentId, { chat: { ...fanslyChat, platformFanId: '7109' } });
    w.sent(intentId, { draft: { revision: 2, provenance: 'human-or-unknown', insertIntentId: intentId, editedSinceInsert: null } });
    await w.reopen();
    expect(w.snapshot().result).toMatchObject({ draftNotSent: true, sendProgress: null });
    expect(w.snapshot().result?.parts?.[0]?.openInsert).toEqual({ s: 'available' });
    w.sent(intentId, { draft: { revision: 2, provenance: 'human-or-unknown', insertIntentId: intentId, editedSinceInsert: true } });
    const first = w.snapshot().result?.parts?.[0];
    w.sent(intentId);
    expect(w.snapshot().result?.parts?.[0]).toEqual(first);
    expect(w.snapshot().result?.sendProgress).toEqual({ sent: 1, total: 2 });
  });

  it('a send observed before navigation answers is already linked; a refused insert leaves no provenance to attribute', async () => {
    const w = await preview();
    const navigate = w.host.navigate.bind(w.host);
    vi.spyOn(w.host, 'navigate').mockImplementation(async (intent) => {
      const receipt = await navigate(intent);
      w.sent(intent.thenInsert!.intentId);
      return receipt;
    });
    await w.insert(0);
    await w.reopen();
    expect(w.snapshot().result?.parts?.[0]?.send?.s).toBe('sent');
    vi.spyOn(w.host, 'navigate').mockImplementation((intent) => {
      w.host.calls.navigations.push(intent);
      return Promise.resolve({ state: 'failed', code: 'CG-NAV-FAILED', insert: { state: 'rejected', code: 'CG-INSERT-FAILED' } });
    });
    await w.insert(1);
    w.sent(w.host.calls.navigations.at(-1)!.thenInsert!.intentId);
    expect(w.snapshot().result?.sendProgress).toEqual({ sent: 1, total: 2 });
  });
});
