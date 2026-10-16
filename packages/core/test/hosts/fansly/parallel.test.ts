// P8e: Fansly's real policy and the shared controllers/scheduler. Chat switches change the visible sheet,
// never an operation's target; the fourth start names the three slots rather than queuing a request.
import { describe, expect, it } from 'vitest';

import { chatKeyOf } from '@cg/contracts';
import { createFanslyAi } from '@cg/core/application/hosts/fansly/ai';
import { chatHandle, createNavigationController, createOverlayState, parseChatHandle } from '@cg/core/application/navigation';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { FakeHostPort, memory, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, meta, resolveHubErrorReference } from '@cg/testing/hub';

import { settingsWithPersona } from '../../support/ai-background';
import { readyHarness, type Harness, type HarnessOptions } from '../../support/ai-harness';
import { sequentialIds } from '../../support/clock';
import { FANSLY as FANSLY_SLICE, featuresOfBoth } from '../../support/features';
import { FANSLY, NOW_MS, WORLD, fanslyAccount, fanslyChat, uuid, withFanslyPage } from '../../support/world';

const CHATS = ['7102', '7103', '7104', '7105'].map((fan, index) => ({
  chat: { ...fanslyChat, platformFanId: fan }, group: String(7203 + index), name: `Fan ${index + 1}`, text: `Reply for fan ${index + 1}.`,
}));
type Chat = (typeof CHATS)[number];
const chatAt = (index: number): Chat => {
  const chat = CHATS[index];
  if (chat === undefined) throw new Error('no test chat');
  return chat;
};

async function open(h: Harness, target: Chat): Promise<void> {
  const window = memory.chatWindows[0];
  if (window === undefined) throw new Error('no test window');
  h.host.setWindow({ ...window, chat: target.chat }, target.chat);
  h.host.openChat(target.chat, fanslyAccount, target.group);
  await h.settle();
  expect(h.dock().status).toBe('ready');
}

async function tab(shared?: HarnessOptions['shared']): Promise<{ h: Harness; base: FakeHostPort }> {
  const base = new FakeHostPort({ start: {
    ...startSnapshot, kind: 'fansly-web', accounts: [fanslyAccount],
    identity: { ...startSnapshot.identity!, host: 'fansly-web', hostAccountId: FANSLY.creator, platformAccountId: FANSLY.creator },
  }, memory, checkpoint: null, answers: {}, timeline: [] });
  const h = await readyHarness({ baseHost: base, memory, catalog: createFakeCatalog(ctxOf({ now: NOW_MS })),
    bootstrap: withFanslyPage(BOOTSTRAP_PILOT_PAGES), resolve: resolveHubErrorReference, meta: (feature) => meta(feature as Parameters<typeof meta>[0]),
  }, {
    ...(shared === undefined ? {} : { shared }), features: FANSLY_SLICE, served: featuresOfBoth, policy: createFanslyAi({ now: () => NOW_MS }),
    settings: settingsWithPersona({ personas: { scope: { hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId }, byPageId: {
      [String(WORLD.pages.fansly.pageId)]: { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId },
    } } }),
  });
  h.host.freshness = { snapshot: (chat, request) => Promise.resolve({
    feature: request.feature, identity: { creatorId: FANSLY.creator, fanId: chat.platformFanId, groupId: request.conversationRef },
    epochs: { document: 'doc-parallel', socket: 1, route: h.host.current().route.epoch }, completeness: 'complete',
    window: [{ id: '8001', dir: 'fan' }], knownFanMessageIds: ['8001'], deletedIds: [], truncated: false,
  }) };
  const fan = memory.fans[0];
  if (fan === undefined) throw new Error('no test fan');
  for (const target of CHATS) h.host.setFan({ ...fan, chat: target.chat, displayName: target.name });
  await open(h, chatAt(0));
  return { h, base };
}

describe('[host:fansly] P8e: parallel generations through the shared core', () => {
  it('[ER-014] an explicit toast/result click opens its group even though the navigation switch is unavailable; keys still open nothing', async () => {
    const { h, base } = await tab();
    let switchReads = 0;
    const navigation = createNavigationController({ host: h.host, rpc: h.bg.rpc(), i18n: h.ai.workspace.ports.i18n,
      ids: sequentialIds(0x700), clock: h.clock, overlays: createOverlayState(), features: FANSLY_SLICE,
      ownerSwitch: () => { switchReads += 1; return false; },
    });
    const target = chatAt(1);
    expect(await navigation.dispatch({ type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle(target.chat, target.group) } })).toEqual({ ok: true, type: 'Navigate', outcome: 'opened' });
    expect(base.calls.navigations[0]?.target).toEqual({ hostAccountId: FANSLY.creator, platformFanId: target.chat.platformFanId, conversationRef: target.group });
    expect(base.calls.redeemed).toMatchObject([{ kind: 'navigate', redeemed: true }]);
    expect(switchReads).toBe(0);
    for (const to of [{ kind: 'chat-step', direction: 'next' }, { kind: 'next-unread' }, { kind: 'chat-slot', slot: 2 }] as const) {
      expect(await navigation.dispatch({ type: 'Navigate', to })).toEqual({ ok: true, type: 'Navigate', outcome: 'noop' });
    }
    expect(base.calls.navigations).toHaveLength(1);
    h.ai.dispose();
  });

  it('[AI-123] [AI-124] three chats keep running; the fourth refusal lists their fans/groups; out-of-order results insert only in their own chats', async () => {
    const { h, base } = await tab();
    const running: { target: Chat; opId: string }[] = [];
    for (const [index, target] of CHATS.slice(0, 3).entries()) {
      await open(h, target);
      h.script({ kind: 'stream', steps: [
        { kind: 'frame', frame: meta('fast-reply') },
        { kind: 'frame', frame: { type: 'content_delta', text: target.text }, afterMs: (3 - index) * 100 },
        { kind: 'frame', frame: { type: 'done', stopReason: 'end_turn' } },
      ] });
      const started = await h.generate('reply');
      if (!started.ok || started.opId === undefined) throw new Error('Reply was not admitted');
      running.push({ target, opId: started.opId });
      expect(h.bg.scheduler.active()).toHaveLength(index + 1);
    }
    const fourth = chatAt(3);
    await open(h, fourth);
    h.host.type('My fourth chat draft.');
    expect(await h.generate('reply')).toMatchObject({ ok: false, code: 'CG-OP-TAB-LIMIT' });
    expect(h.dock().refusal?.running.map(({ opId, fanLabel, go }) => ({ opId, fanLabel, target: go.type === 'Navigate' && go.to.kind === 'chat' ? parseChatHandle(go.to.targetHandle) : null })))
      .toEqual(running.map(({ target, opId }) => ({ opId, fanLabel: target.name, target: { hostAccountId: FANSLY.creator, platformFanId: target.chat.platformFanId, conversationRef: target.group } })));
    expect(h.bg.hub.streams.map(({ body }) => [body.conversationRef, body.fanRef])).toEqual(running.map(({ target }) => [target.group, target.chat.platformFanId]));

    // The third answer ends first while the fourth fan is visible. Even an old part action writes nothing there.
    await h.clock.advance(150);
    expect(running.map(({ opId }) => h.bg.scheduler.view(opId)?.state)).toEqual(['streaming', 'streaming', 'done']);
    for (const { opId } of running) {
      if (h.bg.scheduler.view(opId)?.state !== 'done') continue;
      expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-INSERT-CHAT-CHANGED' });
    }
    await h.finish();
    expect(h.host.inserts).toBe(0);
    expect(h.host.draftOf(fourth.chat)?.plainText).toBe('My fourth chat draft.');
    expect(h.dock().result).toBeNull();
    for (const { target, opId } of running) {
      await open(h, target);
      expect(h.dock().result).toMatchObject({ opId, state: 'done' });
      expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: true });
      expect(h.host.draftOf(target.chat)?.plainText).toBe(target.text);
    }
    expect(base.calls.inserts.map(({ target, text }) => [chatKeyOf(target), text])).toEqual(running.map(({ target }) => [chatKeyOf(target.chat), target.text]));
    expect(h.bg.hub.streams).toHaveLength(3); // the refused fourth start was never queued
    h.ai.dispose();
  });

  it('[ER-033] [RB-021] [NEW-11] a chat is locked across tabs; a different chat in that tab is free and cancellation frees only its own slot', async () => {
    const { h } = await tab();
    h.script({ kind: 'hang' });
    const first = await h.generate('reply');
    if (!first.ok || first.opId === undefined) throw new Error('Reply was not admitted');
    const { h: other } = await tab({ bg: h.bg, clock: h.clock, tab: uuid(0xa2) });
    const refused = await other.ai.workspace.startFeature({ feature: 'reply', surface: 'dock', cause: 'click', options: {}, force: true });
    expect(refused).toMatchObject({ kind: 'refused', refusal: { error: { code: 'CG-OP-CHAT-BUSY' }, running: [{ opId: first.opId, inThisTab: false }] } });
    expect(h.bg.hub.streams).toHaveLength(1);
    await open(other, chatAt(1));
    other.script({ kind: 'hang' });
    const second = await other.generate('reply');
    if (!second.ok || second.opId === undefined) throw new Error('second Reply was not admitted');
    expect(h.bg.scheduler.active()).toHaveLength(2);
    await h.dispatch({ type: 'CancelGeneration', operationId: first.opId });
    expect(h.bg.scheduler.active().map(({ opId }) => opId)).toEqual([second.opId]);
    await open(other, chatAt(0));
    other.script(other.streamOf('fast-reply', ['A new reply.']));
    expect(await other.generate('reply')).toMatchObject({ ok: true, outcome: 'started' });
    await other.finish();
    await other.dispatch({ type: 'CancelGeneration', operationId: second.opId });
    expect(h.bg.scheduler.active()).toEqual([]);
    h.ai.dispose(); other.ai.dispose();
  });
});
