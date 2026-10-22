// The dock controller over the fake tab RPC (the real scheduler with R11's
// drivers behind it), @cg/testing's FakeHostPort and the fake hub's stream
// scripts: status and banners, the seven actions and their reasons, tone and
// Split, the stream, parts, inserts with Б2 and Fix, copy, cache hits, the
// refusal list, the stale mark, the debug footer, telemetry hooks, hotkeys.

import { describe, expect, it } from 'vitest';

import { CLIENT_FEATURE_FLAG_NAMES, DOCK_ACTION_IDS, OP_LIMITS, type Bootstrap, type InsertReceipt, type LiveTextTail, type PartVM, type ResultVM, type UiAction } from '@cg/contracts';
import { targetHandle, type BoardHandover, type BoardPartFacts, type BoardResults, type BoardSync } from '@cg/core/application/ai';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { FakeHostPort, hostAccount, memory, openChat, previewChat, startSnapshot, type HostAnswers } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, meta, resolveHubErrorReference, pageFeaturesOff } from '@cg/testing/hub';

import { OTHER_TAB, TAB } from './support/ai-background';
import { delta, doneStep, readyHarness, type Harness, type HarnessOptions, type HarnessParts } from './support/ai-harness';
import { NOW_MS, WORLD, session, tokenN, uuid } from './support/world';

function parts(answers: HostAnswers = {}): HarnessParts & { readonly fake: FakeHostPort } {
  const fake = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers, timeline: [] });
  return {
    fake,
    baseHost: fake,
    memory,
    catalog: createFakeCatalog(ctxOf({ now: NOW_MS })),
    bootstrap: BOOTSTRAP_PILOT_PAGES,
    resolve: resolveHubErrorReference,
    meta: (feature) => meta(feature as Parameters<typeof meta>[0]),
  };
}

const start = (options: HarnessOptions = {}, answers: HostAnswers = {}): Promise<Harness & { readonly fake: FakeHostPort }> => {
  const p = parts(answers);
  return readyHarness(p, options).then((h) => Object.assign(h, { fake: p.fake }));
};

const result = (h: Harness): ResultVM => {
  const vm = h.dock().result;
  if (vm === null) throw new Error('no result sheet');
  return vm;
};
const partsOf = (h: Harness): readonly PartVM[] => {
  const list = result(h).parts;
  if (list === null) throw new Error('no parts');
  return list;
};

/** Reply with the given answer, played to its end. */
async function reply(h: Harness, text: string | readonly string[] = 'hey you', options: Parameters<Harness['generate']>[1] = {}): Promise<string> {
  h.script(h.streamOf('fast-reply', typeof text === 'string' ? [text] : text));
  const receipt = await h.generate('reply', options);
  if (!receipt.ok || receipt.opId === undefined) throw new Error(`not started: ${JSON.stringify(receipt)}`);
  await h.finish();
  return receipt.opId;
}

describe('dock: where it shows and what state it is in', () => {

  it('[UI-011] a broken host identity closes every sensitive action', async () => {
    const h = await start();
    h.host.setCapability('identity', { state: 'contractBroken', reason: 'accounts' });
    await h.settle();
    const vm = h.dock();
    expect(vm.status).toBe('host-degraded');
    expect(vm.statusError?.code).toBe('CG-HOST-CONTRACT');
    // The banner says «только Копировать»: the mode agrees with it (vm/dock.ts: host-degraded is copy-only).
    expect(vm.mode).toBe('copy-only');
    expect(vm.view).toEqual({ s: 'partial', gaps: [{ kind: 'host-degraded', capabilities: ['identity', 'route'] }] });
    expect(vm.actions.reply).toMatchObject({ enabled: false });
    expect(vm.actions.reply.reason?.id).toBe('host-degraded');
    expect(vm.actions.reply.reason?.code).toBe('CG-HOST-CONTRACT');
    expect(vm.targetHandle).toBeNull();
    expect(await h.dispatch({ type: 'Generate', targetHandle: targetHandle('dock', openChat), feature: 'reply', options: {} })).toMatchObject({ ok: false, code: 'CG-HOST-CONTRACT' });
    expect(h.bg.callsOf('op.start')).toEqual([]);

    // What was generated before the break can be copied, never inserted.
    const before = await start();
    const opId = await reply(before, 'made before the break');
    before.host.setCapability('route', { state: 'contractBroken', reason: 'router' });
    await before.settle();
    expect(before.dock()).toMatchObject({ status: 'host-degraded', mode: 'copy-only' });
    expect(partsOf(before)[0]?.insertBlocked).toMatchObject({ id: 'host-degraded', code: 'CG-HOST-CONTRACT' });
    expect(await before.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-HOST-CONTRACT' });
    expect(before.host.inserts).toBe(0);
    expect(await before.dispatch({ type: 'Copy', artifactHandle: partsOf(before)[0]?.copyHandle as string })).toMatchObject({ ok: true });
  });

  describe('nothing of ours runs on the page: the owner’s master switch, an outdated build', () => {
    /** The hub's master switch is one for every page: off, every feature of every page reads `disabled`. */
    const MASTER_OFF: Bootstrap = pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, CLIENT_FEATURE_FLAG_NAMES, { reason: 'disabled' });
    /** A click on Reply of the open chat (the strip keeps its place while the page is off; the dock names no target then). */
    const REPLY: UiAction = { type: 'Generate', targetHandle: targetHandle('dock', openChat), feature: 'reply', options: {} };
    const set = async (h: Harness, bootstrap: Bootstrap, revision: number): Promise<void> => {
      h.bg.bootstrap = { ...bootstrap, configRevision: bootstrap.configRevision + revision };
      h.bg.emit(null, 'bootstrap.changed', { configRevision: bootstrap.configRevision + revision, issuedAt: new Date(NOW_MS).toISOString() });
      await h.settle();
    };

    it('[UI-011] [AI-140] the master switch goes off under a finished result: one status line, every action and «Ещё раз» dimmed with that reason, parts copy-only — and nothing is asked of the background', async () => {
      const h = await start();
      const opId = await reply(h, 'hey you');
      expect(result(h)).toMatchObject({ canRegenerate: true, regenerateReason: null });
      expect(partsOf(h)[0]?.insertBlocked ?? null).toBeNull();

      await set(h, MASTER_OFF, 1);
      const vm = h.dock();
      // The dock stays an ordinary, visible dock: no banner of a status, one line of its own.
      expect(vm).toMatchObject({ status: 'ready', statusError: null, visible: true, mode: 'copy-only', mark: 'faint' });
      expect(vm.view).toEqual({ s: 'ready' });
      expect(vm.notice).toMatchObject({ code: 'CG-FEATURE-DISABLED', title: 'ChatGoose выключен владельцем', body: '', detail: 'disabled', tone: 'state' });
      const off = { id: 'feature-disabled', code: 'CG-FEATURE-DISABLED', text: { key: 'dock.reason.pageOff' } };
      for (const id of DOCK_ACTION_IDS) expect(vm.actions[id], id).toMatchObject({ enabled: false, busy: false, hotkey: null, reason: off });
      expect(vm.options).toMatchObject({ toneReason: off, splitReason: off });
      // The earlier result is still there to read and to copy…
      expect(vm.result).toMatchObject({ opId, state: 'done', canRegenerate: false, regenerateReason: off });
      expect(partsOf(h).map((part) => part.text)).toEqual(['hey you']);
      expect(partsOf(h)[0]?.insertBlocked).toEqual(off);
      await h.dispatch({ type: 'Copy', artifactHandle: partsOf(h)[0]?.copyHandle as string });
      expect(h.clipboard.texts).toEqual(['hey you']);
      // …and nothing else: an insert, «Ещё раз» and a new generation (a key still reaches them) are refused before a
      // token or a start is asked, with the page's reason.
      const before = [h.bg.callsOf('token.issue').length, h.bg.callsOf('op.start').length, h.fake.calls.inserts.length];
      expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false });
      expect(await h.dispatch({ type: 'Regenerate', operationId: opId })).toMatchObject({ ok: false, code: 'CG-FEATURE-DISABLED' });
      expect(await h.dispatch(REPLY)).toMatchObject({ ok: false, code: 'CG-FEATURE-DISABLED' });
      expect([h.bg.callsOf('token.issue').length, h.bg.callsOf('op.start').length, h.fake.calls.inserts.length]).toEqual(before);
      expect(h.dock().refusal?.error).toMatchObject({ code: 'CG-FEATURE-DISABLED', detail: 'disabled' });

      // The owner switches it back on: the same dock works, without a reload.
      await set(h, BOOTSTRAP_PILOT_PAGES, 2);
      const back = h.dock();
      expect(back).toMatchObject({ status: 'ready', mode: 'insert', notice: null });
      expect(back.actions.reply).toMatchObject({ enabled: true, reason: null });
      // The same earlier result can be repeated again.
      h.script(h.streamOf('fast-reply', ['again']));
      expect(await h.dispatch({ type: 'Regenerate', operationId: opId })).toMatchObject({ ok: true, outcome: 'started' });
      await h.finish();
      expect(result(h)).toMatchObject({ canRegenerate: true, regenerateReason: null });
      expect(partsOf(h)[0]?.insertBlocked ?? null).toBeNull();
    });
  });
});

describe('dock: Reply from the click to the parts', () => {
  it('[AI-001] a click starts one generation for the open chat and shows its sheet', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply'), afterMs: 100 }, delta('hey '), delta('you', 200), doneStep] });
    const receipt = await h.generate('reply');
    expect(receipt).toMatchObject({ ok: true, type: 'Generate', outcome: 'started' });
    const started = h.bg.callsOf('op.start') as { feature: string; surface: string; target: { chat: unknown; binding: { pageId: number } }; tone: unknown; split: boolean; window: number; cause: { kind: string } }[];
    expect(started.length).toBe(1);
    expect(started[0]).toMatchObject({ feature: 'reply', surface: 'dock', tone: null, split: false, window: 100, cause: { kind: 'click' } });
    expect(started[0]?.target.chat).toEqual(openChat);
    expect(started[0]?.target.binding.pageId).toBe(WORLD.pages.one.pageId);
    expect(h.bg.callsOf('token.issue')).toEqual([{ kind: 'generate', surface: 'dock' }]);

    const running = result(h);
    expect(running).toMatchObject({ feature: 'reply', surface: 'dock', state: 'requesting', parts: null, variants: null, streamText: null, canRegenerate: false, draftNotSent: false });
    expect(running.phase?.stages).toEqual([{ id: 'context', label: { key: 'result.stage.context' }, state: 'current' }]);
    expect(running.phase?.cancel).toEqual({ type: 'CancelGeneration', operationId: running.opId });
  });

  it('[AI-124] a chat switch cancels nothing: the result waits for its own chat', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, delta('hey you', 200), doneStep] });
    const receipt = await h.generate('reply');
    h.host.openChat(previewChat);
    await h.settle();
    const elsewhere = h.dock();
    expect(elsewhere.result).toBeNull();
    expect(elsewhere.actions.reply.busy).toBe(false);
    // What runs in another chat of this tab is listed (and offered in the palette).
    expect(elsewhere.runningElsewhere).toEqual([
      {
        opId: (receipt as { opId: string }).opId,
        feature: 'reply',
        fanLabel: 'Fan Two',
        startedAt: NOW_MS,
        inThisTab: true,
        go: { type: 'Navigate', to: { kind: 'chat', targetHandle: targetHandle('dock', openChat) } },
        cancel: { type: 'CancelGeneration', operationId: (receipt as { opId: string }).opId },
      },
    ]);
    await h.finish();
    expect(h.dock().runningElsewhere).toEqual([]);
    expect(h.dock().result).toBeNull();
    h.host.openChat(openChat);
    await h.settle();
    expect(result(h)).toMatchObject({ state: 'done' });
    expect(partsOf(h).map((part) => part.text)).toEqual(['hey you']);
  });
});

describe('dock: fresh page text', () => {
  const tail: LiveTextTail = {
    capturedAt: '2026-10-03T10:00:00.000Z',
    messages: [
      { platformMessageId: '4004', direction: 'fan', sentAt: '2026-10-03T09:58:00.000Z', text: 'are you there?' },
      { platformMessageId: '4005', direction: 'model', sentAt: '2026-10-03T09:59:00.000Z', text: 'always' },
    ],
  };

  it('never without the owner switch or the hub capability, and never for Review', async () => {
    const off: Bootstrap = pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['freshText']);
    const h = await start({ bootstrap: off });
    h.host.setTail(openChat, tail);
    await reply(h);
    expect(h.host.reads.tail).toBe(0);
    expect((h.bg.callsOf('op.start')[0] as { fresh?: unknown }).fresh).toBeUndefined();
    expect(h.bg.hub.streams[0]?.body.liveTextContext).toBeUndefined();

    const noContext: Bootstrap = { ...BOOTSTRAP_PILOT_PAGES, capabilities: BOOTSTRAP_PILOT_PAGES.capabilities.filter((c) => c !== 'context-v1') };
    const other = await start({ bootstrap: noContext });
    other.host.setTail(openChat, tail);
    await reply(other);
    expect(other.host.reads.tail).toBe(0);
  });

  /**
   * Every string the tab's AI state holds: what is reachable from its surfaces through fields, arrays, maps and
   * sets. The page (the host) and the background are not the tab's state and are not entered; what a closure
   * holds is out of reach of any walk.
   */
  const heldStrings = (h: Harness): string[] => {
    const seen = new Set<unknown>([h.host, h.bg, h.clock]);
    const found: string[] = [];
    const stack: unknown[] = [h.ai];
    while (stack.length > 0) {
      const value = stack.pop();
      if (typeof value === 'string') found.push(value);
      if (value === null || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      if (value instanceof Map) for (const [key, item] of value) stack.push(key, item);
      else if (value instanceof Set) stack.push(...value);
      else for (const key of Reflect.ownKeys(value)) stack.push(Object.getOwnPropertyDescriptor(value, key)?.value);
    }
    return found;
  };

  it('the tab keeps no copy of the tail: not while the result is written, not after it ends, not after «Вставить» or «Ещё раз»', async () => {
    const h = await start();
    const words = ['the tail: are you still up?', 'the tail: only for you'];
    h.host.setTail(openChat, {
      capturedAt: '2026-10-03T10:00:00.000Z',
      messages: [
        { platformMessageId: '4004', direction: 'fan', sentAt: '2026-10-03T09:58:00.000Z', text: words[0] as string },
        { platformMessageId: '4005', direction: 'model', sentAt: '2026-10-03T09:59:00.000Z', text: words[1] as string },
      ],
    });
    const leftovers = (): string[] => heldStrings(h).filter((text) => words.some((word) => text.includes(word)));
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, delta('one ', 100), delta('two ', 100), delta('three', 100), doneStep] });
    const receipt = await h.generate('reply');
    const opId = (receipt as { opId: string }).opId;
    // The tail went with the request.
    expect((h.bg.callsOf('op.start')[0] as { fresh: LiveTextTail }).fresh.messages.map((message) => message.text)).toEqual(words);

    await h.clock.advance(200 + OP_LIMITS.updateBatchMs);
    // The result is being written: the walk reaches the operation (its stream text is there), the tail is not.
    expect(h.dock().result).toMatchObject({ state: 'streaming', streamText: 'one two' });
    expect(heldStrings(h).some((text) => text.startsWith('one two'))).toBe(true);
    expect(leftovers()).toEqual([]);

    await h.finish();
    // What the tab remembers of the start is what «Ещё раз» and Fix read, and nothing of the request: ChatSpace's AI
    // policy keeps no fingerprint of its proof (R20 F10).
    expect(h.ai.workspace.ops.get(opId)?.memo).toEqual({ split: false, fixSource: null, personaDefinitionId: WORLD.persona.definitionId, fingerprint: null });
    expect(leftovers()).toEqual([]);

    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: true, outcome: 'done' });
    expect(leftovers()).toEqual([]);

    // «Ещё раз» reads the page again: the tail it sends is the one of that moment, and it is not kept either.
    h.script(h.streamOf('fast-reply', ['again']));
    expect(await h.dispatch({ type: 'Regenerate', operationId: opId })).toMatchObject({ ok: true, outcome: 'started' });
    await h.finish();
    expect(h.host.reads.tail).toBe(2);
    expect((h.bg.callsOf('op.start')[1] as { fresh: LiveTextTail; regenerateOf: string }).regenerateOf).toBe(opId);
    expect(partsOf(h).map((part) => part.text)).toEqual(['again']);
    expect(leftovers()).toEqual([]);
  });
});

describe('dock: inserting a part', () => {

  it('[AI-126] [AI-140] the owner edited the page’s persona after the result was made (its key stays, the choice followed): the result stays and is inserted', async () => {
    const h = await start();
    const opId = await reply(h, 'one [NEXT] two');
    h.bg.changePersona(WORLD.pages.one.pageId, { key: WORLD.persona.key, definitionId: WORLD.persona.otherDefinitionId });
    await h.settle();
    expect(result(h).opId).toBe(opId);
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: true, outcome: 'done' });
    expect(h.host.draftOf(openChat)?.plainText).toBe('one');
  });

  it('[UI-018] [AI-125] «Вставить» puts one part into the operation\'s own chat, by a token and a CAS on the draft', async () => {
    const h = await start({}, {});
    const opId = await reply(h, 'one [NEXT] two', { split: true });
    const receipt = await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 });
    expect(receipt).toMatchObject({ ok: true, type: 'InsertPart', outcome: 'done' });
    expect(h.fake.calls.inserts).toHaveLength(1);
    const intent = h.fake.calls.inserts[0];
    expect(intent).toMatchObject({
      operationId: opId,
      part: { index: 0 },
      target: openChat,
      mode: 'replace',
      text: 'one',
      confirmationId: null,
      expected: { kind: 'open', documentEpoch: 'doc-host-1', routeEpoch: 5, composerInstanceId: 'composer-1', draftRevision: 4, draftDigest: 'feedbeef00000004' },
      cause: { kind: 'click' },
    });
    expect(h.bg.callsOf('token.issue')).toContainEqual({ kind: 'insert', surface: 'dock' });
    // The inserted part folds, the next one leads.
    expect(partsOf(h).map((part) => `${part.insert}:${part.collapsed}:${part.next}`)).toEqual(['done:true:false', 'idle:false:true']);
    expect(result(h).meta).toContainEqual({ key: 'result.meta.inserted', params: { done: 1, total: 2 } });
    expect(h.host.draftOf(openChat)).toMatchObject({ plainText: 'one', provenance: 'our-insert' });
    // Telemetry: the receipt is reported; `inserted` is the background's to count.
    expect(h.bg.callsOf('op.reportInsert')).toEqual([{ opId, part: { index: 0 }, receipt: { state: 'applied', draftRevision: 5, draftDigest: 'feedbeef0000aaaa', ms: 6 } }]);
  });

  it('[UI-020] the draft moved between the read and the write: MAIN refuses, nothing is written, and the question is asked about the draft as it is now (X45)', async () => {
    const h = await start({}, { insert: [{ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-changed-draft' }] });
    const opId = await reply(h, 'the answer');
    h.host.type('my own words');
    await h.settle();
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: true, outcome: 'needs-confirm' });
    expect(result(h).confirm).toMatchObject({ kind: 'draft-changed', part: { index: 0 } });
    expect(h.host.draftOf(openChat)?.plainText).toBe('my own words');
  });

  it('[AI-125] [UI-026] after a chat switch the part of the other chat is not inserted: the error stays on the part', async () => {
    const h = await start();
    const opId = await reply(h, 'for fan two');
    h.host.openChat(previewChat);
    await h.settle();
    const receipt = await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 });
    expect(receipt).toMatchObject({ ok: false, code: 'CG-INSERT-CHAT-CHANGED' });
    expect(h.fake.calls.inserts).toHaveLength(0);
    expect(h.host.draftOf(previewChat)?.plainText).toBe('');
    expect(h.journal.some((entry) => entry.msg === 'insert prevented' && entry.code === 'CG-INSERT-CHAT-CHANGED')).toBe(true);
    h.host.openChat(openChat);
    await h.settle();
    expect(partsOf(h)[0]).toMatchObject({ insert: 'failed' });
    expect(partsOf(h)[0]?.insertError?.code).toBe('CG-INSERT-CHAT-CHANGED');
    // The part is still «следующая»: its «Вставить» is the retry.
    expect(partsOf(h)[0]?.next).toBe(true);
  });

  it('a refused write shows its code; an unknown outcome is never repeated by itself', async () => {
    const receipts: InsertReceipt[] = [{ state: 'rejected', code: 'CG-INSERT-FAILED' }, { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' }];
    const h = await start({}, { insert: receipts });
    const opId = await reply(h, 'one');
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-INSERT-FAILED' });
    expect(partsOf(h)[0]?.insertError?.code).toBe('CG-INSERT-FAILED');
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-INSERT-UNCERTAIN' });
    expect(partsOf(h)[0]).toMatchObject({ insert: 'failed', collapsed: false });
    expect(h.fake.calls.inserts).toHaveLength(2);
    expect((h.bg.callsOf('op.reportInsert') as { receipt: InsertReceipt }[]).map((call) => call.receipt.state)).toEqual(['rejected', 'uncertain']);
  });

  it('a host call that was lost after it may have run: one call, CG-INSERT-UNCERTAIN, never repeated by itself', async () => {
    const h = await start();
    const opId = await reply(h, 'one');
    h.host.insertThrows = true;
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-INSERT-UNCERTAIN' });
    expect(h.host.inserts).toBe(1);
    expect(partsOf(h)[0]).toMatchObject({ insert: 'failed', collapsed: false });
    expect(partsOf(h)[0]?.insertError?.code).toBe('CG-INSERT-UNCERTAIN');
    expect((h.bg.callsOf('op.reportInsert') as { receipt: InsertReceipt }[]).map((call) => call.receipt)).toEqual([{ state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' }]);
    // Time, redraws and other events write nothing again.
    h.host.type('still typing');
    await h.clock.advance(60_000);
    expect(h.host.inserts).toBe(1);
  });

  it('a double click is one write: the second call changes nothing and is not an error', async () => {
    const h = await start();
    const opId = await reply(h, 'one [NEXT] two', { split: true });
    const insert = { type: 'InsertPart', operationId: opId, part: 0 } as const;
    const receipts = await Promise.all([h.dispatch(insert), h.dispatch(insert)]);
    expect(receipts).toEqual([
      { ok: true, type: 'InsertPart', outcome: 'done', opId },
      { ok: true, type: 'InsertPart', outcome: 'noop', opId },
    ]);
    expect(h.host.inserts).toBe(1);
    expect(h.fake.calls.inserts).toHaveLength(1);
    expect((h.bg.callsOf('token.issue') as { kind: string }[]).filter((call) => call.kind === 'insert')).toHaveLength(1);
    expect(h.bg.callsOf('op.reportInsert')).toHaveLength(1);
    expect(result(h).confirm).toBeNull();
    expect(h.host.draftOf(openChat)?.plainText).toBe('one');
    // Another part of the same result clicked while the first is on its way waits for its own click too.
    const other = await start();
    const second = await reply(other, 'one [NEXT] two', { split: true });
    const both = await Promise.all([other.dispatch({ type: 'InsertPart', operationId: second, part: 0 }), other.dispatch({ type: 'InsertPart', operationId: second, part: 1 })]);
    expect(both.map((receipt) => (receipt.ok ? receipt.outcome : receipt.code))).toEqual(['done', 'noop']);
    expect(other.host.inserts).toBe(1);
    // Once the write ended the next click works.
    expect(await other.dispatch({ type: 'InsertPart', operationId: second, part: 1 })).toMatchObject({ ok: true, outcome: 'done' });
    expect(other.host.inserts).toBe(2);
  });

  it('a token the background refused writes nothing', async () => {
    const h = await start({}, { redeem: [false] });
    const opId = await reply(h, 'one');
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-INSERT-FAILED' });
    expect(h.fake.calls.inserts).toHaveLength(0);
    expect(h.host.draftOf(openChat)?.plainText).toBe('');
  });

  it('a persona change during the session voids the insert of an older result', async () => {
    const h = await start();
    const opId = await reply(h, 'one');
    // The page gets another persona in settings while the result is still on screen in this very microtask.
    h.bg.settings = { ...h.bg.settings, settings: { ...h.bg.settings.settings, personas: { ...h.bg.settings.settings.personas, byPageId: { [String(WORLD.pages.one.pageId)]: { key: 'other', definitionId: WORLD.persona.otherDefinitionId } } } }, revision: 9 };
    h.bg.emit(null, 'settings.changed', h.bg.settings);
    await h.settle();
    // [AI-126] the result of the old persona is gone with it.
    expect(h.dock().result).toBeNull();
    await expect(h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).rejects.toThrow(/no controller took/);
  });
});

describe('dock: a result this tab did not start', () => {
  /** Another tab of the same extension on the same chat. */
  const otherTab = async (h: Harness): Promise<Harness & { readonly fake: FakeHostPort }> => {
    const p = parts();
    const tab = await readyHarness(p, { shared: { bg: h.bg, clock: h.clock, tab: OTHER_TAB } });
    await tab.settle();
    return Object.assign(tab, { fake: p.fake });
  };

  it('a result adopted already finished has no known persona: it is not inserted; the same click reopens it and then it is', async () => {
    const h = await start();
    const opId = await reply(h, 'cached answer');
    const tab = await otherTab(h);
    expect(tab.ai.workspace.ops.get(opId)).toMatchObject({ own: false, memo: { personaDefinitionId: null } });
    // Not shown by itself, and not insertable on a guess that it is of the current persona.
    expect(tab.dock().result).toBeNull();
    expect(await tab.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(tab.host.inserts).toBe(0);
    // The same click with the same parameters reopens it (AI-128): the admission is for this request, persona included.
    expect(await tab.generate('reply')).toMatchObject({ ok: true, outcome: 'noop', opId });
    expect(h.bg.hub.streams).toHaveLength(1);
    expect(tab.ai.workspace.ops.get(opId)?.memo.personaDefinitionId).toBe(WORLD.persona.definitionId);
    expect(await tab.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: true, outcome: 'done' });
    expect(tab.host.draftOf(openChat)?.plainText).toBe('cached answer');
  });

  it('[AI-126] a result of the old persona adopted by a tab opened after the change is never inserted', async () => {
    const h = await start();
    const opId = await reply(h, 'written as the first persona');
    h.bg.changePersona(WORLD.pages.one.pageId, { key: 'other', definitionId: WORLD.persona.otherDefinitionId });
    await h.settle();
    const tab = await otherTab(h);
    expect(tab.ai.workspace.ops.get(opId)).not.toBeNull();
    expect(await tab.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(tab.host.inserts).toBe(0);
    // The same click is a new request now (another persona): a new generation, not the old text.
    tab.script(tab.streamOf('fast-reply', ['written as the second persona']));
    const again = await tab.generate('reply');
    expect(again).toMatchObject({ ok: true, outcome: 'started' });
    expect((again as { opId: string }).opId).not.toBe(opId);
  });
});

describe('dock: Fix', () => {
  /**
   * A draft in the field. `auto` — the click's deferred grant answers the Fix's own write (X68), as on the page; by
   * default it is gone (another Fix was clicked, the Fix ran too long), and the result waits for «Заменить мой
   * черновик» — the way most of this block goes.
   */
  const withDraft = async (answers: HostAnswers = {}, auto = false): Promise<Harness & { fake: FakeHostPort }> => {
    const h = await start({}, answers);
    if (!auto) h.bg.deferredTokens = 'refuse';
    h.host.type('i mis you so much');
    await h.settle();
    return h;
  };
  const deferredAsked = (h: Harness): number => h.bg.callsOf('token.issue').filter((call) => (call as { deferred?: unknown }).deferred === true).length;

  it('[AI-020] [AI-025] [X68] Fix as in the old extension: one click, nothing opens while it runs, and its result replaces the draft it read by itself', async () => {
    const h = await withDraft({}, true);
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('improve-draft') }, delta('I miss '), delta('you so much', 200), doneStep] });
    const receipt = await h.generate('fix');
    expect(receipt).toMatchObject({ ok: true, outcome: 'started' });
    expect((h.bg.callsOf('op.start')[0] as { draft: unknown; window: number }).draft).toEqual({ text: 'i mis you so much', revision: 5, digest: 'feedbeef00000005' });
    expect(h.bg.hub.streams[0]).toMatchObject({ feature: 'improve-draft', body: { draftText: 'i mis you so much', messageCount: 25 } });
    await h.clock.advance(100);
    // Only the chip says it runs; no sheet, no stream.
    expect(h.dock().result).toBeNull();
    expect(h.dock().actions.fix).toMatchObject({ busy: true });
    // A second click while it runs does nothing.
    expect(await h.generate('fix')).toMatchObject({ ok: true, outcome: 'noop' });
    expect(h.dock().result).toBeNull();
    await h.finish();
    // The token the click left for it, asked for by the Fix's own end; one write, over the draft as the field holds it.
    expect(deferredAsked(h)).toBe(1);
    expect(h.fake.calls.inserts).toHaveLength(1);
    expect(h.fake.calls.inserts[0]).toMatchObject({ mode: 'replace', text: 'I miss you so much', expected: { draftRevision: 5, draftDigest: 'feedbeef00000005' } });
    expect(h.host.draftOf(openChat)?.plainText).toBe('I miss you so much');
    expect(h.dock().result).toBeNull();
    expect(h.dock().actions.fix).toMatchObject({ busy: false });
  });

  it('[X68] a Split Fix of several parts writes nothing by itself: its parts open, each inserted by its own click', async () => {
    const h = await withDraft({}, true);
    h.script(h.streamOf('improve-draft', ['I miss you [NEXT] so much']));
    await h.generate('fix', { split: true });
    await h.finish();
    expect(h.fake.calls.inserts).toHaveLength(0);
    expect(deferredAsked(h)).toBe(0);
    expect(partsOf(h).map((part) => part.text)).toEqual(['I miss you', 'so much']);
  });

  it('[X68] the person went to another chat: nothing is written; the result waits in its own chat with «Заменить мой черновик»', async () => {
    const h = await withDraft({}, true);
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('improve-draft') }, delta('I miss you so much', 200), doneStep] });
    await h.generate('fix');
    h.host.openChat(previewChat);
    await h.settle();
    await h.finish();
    expect(h.fake.calls.inserts).toHaveLength(0);
    h.host.openChat(openChat);
    await h.settle();
    expect(result(h).fix).toMatchObject({ canReplace: true, replaced: false });
  });
});

describe('dock: operations of other surfaces are not the dock\'s', () => {
  it('«Ещё раз» belongs to the chat of its result: from another chat it is refused, and Fix never rewrites chat A\'s draft for chat B', async () => {
    const h = await start();
    h.host.type('draft of fan two');
    await h.settle();
    h.script(h.streamOf('improve-draft', ['Draft of fan two.']));
    const fix = await h.generate('fix');
    await h.finish();
    const opId = (fix as { opId: string }).opId;
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), chat: previewChat }, previewChat);
    h.host.openChat(previewChat);
    await h.settle();
    const starts = h.bg.callsOf('op.start').length;
    expect(await h.dispatch({ type: 'Regenerate', operationId: opId })).toMatchObject({ ok: false, type: 'Regenerate', code: 'CG-CONTEXT-CHANGED' });
    expect(h.bg.callsOf('op.start')).toHaveLength(starts);
  });

  it('a click that names another chat than the open one starts nothing — on any controller', async () => {
    const h = await start();
    const foreign = targetHandle('dock', { ...openChat, platformFanId: '888' });
    for (const feature of ['reply', 'hi', 'ping', 'fix', 'review', 'recap', 'recap-short', 'coach'] as const) {
      expect(await h.dispatch({ type: 'Generate', targetHandle: foreign, feature, options: {} }), feature).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    }
    expect(await h.dispatch({ type: 'Generate', targetHandle: foreign, feature: 'coach', options: { question: 'for another fan' } })).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(await h.dispatch({ type: 'SetTone', targetHandle: foreign, tone: 'flirty' })).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(h.bg.callsOf('op.start')).toEqual([]);
    expect(h.bg.callsOf('token.issue')).toEqual([]);
    expect(h.bg.callsOf('recap.read')).toEqual([]);
    expect(h.overlays.opened).toEqual([]);
    expect(h.dock()).toMatchObject({ analysis: null, result: null, refusal: null });
    expect(h.dock().options.tone).toBeNull();
  });
});

describe('dock: a start the background did not admit is never silent', () => {

  it('[RB-010] back after an outage the dock takes nothing for current that it read before: the owner’s switch that changed unheard is read first — «Вставить» pressed in the very step the port returns writes nothing', async () => {
    const h = await start();
    const opId = await reply(h, 'one [NEXT] two');
    expect(h.dock()).toMatchObject({ status: 'ready', mode: 'insert' });
    const reads = { bootstrap: h.bg.callsOf('bootstrap.get').length, settings: h.bg.callsOf('settings.get').length };
    h.bg.setConnection('lost');
    // The owner switches `insertion` off for the page. The background reads it and tells the tabs — this tab's
    // port is down: it hears nothing.
    const off: Bootstrap = { ...pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['insertion']), configRevision: BOOTSTRAP_PILOT_PAGES.configRevision + 1 };
    h.bg.bootstrap = off;
    h.bg.emit(null, 'bootstrap.changed', { configRevision: off.configRevision, issuedAt: new Date(NOW_MS).toISOString() });
    await h.settle();
    // The port is back. In this very step — before any answer — the copy from before the outage is not «ready»:
    h.bg.setConnection('ready');
    expect(h.dock()).toMatchObject({ status: 'loading-chat' });
    expect(Object.values(h.dock().actions).some((action) => action.enabled)).toBe(false);
    // …and a click that lands now inserts nothing by the old switch.
    const early = h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 });
    expect(await early).toMatchObject({ ok: false });
    expect(h.fake.calls.inserts).toEqual([]);
    expect(h.bg.callsOf('token.issue').filter((call) => (call as { kind: string }).kind === 'insert')).toEqual([]);
    await h.settle();
    // Read again, by itself — the settings and the bootstrap both — and the page is copy-only now.
    expect(h.bg.callsOf('bootstrap.get').length).toBe(reads.bootstrap + 1);
    expect(h.bg.callsOf('settings.get').length).toBe(reads.settings + 1);
    expect(h.dock()).toMatchObject({ status: 'ready', mode: 'copy-only' });
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false });
    expect(h.fake.calls.inserts).toEqual([]);
  });

  it('[RB-010] [AI-126] the persona of the page changed while the port was down: back, the result of the old persona is gone before anything of it can be inserted', async () => {
    const h = await start();
    const opId = await reply(h, 'one [NEXT] two');
    expect(result(h).opId).toBe(opId);
    h.bg.setConnection('lost');
    h.bg.changePersona(WORLD.pages.one.pageId, { key: 'other', definitionId: WORLD.persona.otherDefinitionId });
    await h.settle();
    h.bg.setConnection('ready');
    // Before the settings are read again nothing of the old persona is written…
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 }).catch(() => ({ ok: false }))).toMatchObject({ ok: false });
    expect(h.fake.calls.inserts).toEqual([]);
    await h.settle();
    // …and once they are, its result has left the dock.
    expect(h.dock().result).toBeNull();
    await expect(h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).rejects.toThrow(/no controller took/);
    expect(h.fake.calls.inserts).toEqual([]);
  });
});

describe('dock: acceptance telemetry hooks', () => {

  it('the route and every insert are journaled without the text', async () => {
    const h = await start();
    const opId = await reply(h, 'a secret answer');
    await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 });
    h.host.openChat(previewChat);
    await h.settle();
    expect(h.journal.map((entry) => entry.msg)).toEqual(expect.arrayContaining(['insert intent', 'insert applied', 'route changed']));
    expect(JSON.stringify(h.journal)).not.toContain('secret');
    expect(h.journal.find((entry) => entry.msg === 'insert intent')?.fields).toMatchObject({ textLength: 15, mode: 'replace' });
  });
});

describe('dock: the sign-in and the views', () => {
  it('[AI-126] a sign-out drops results and running generations of that sign-in', async () => {
    const h = await start();
    await reply(h, 'answer');
    h.bg.changeSession(null, 'sign-out');
    await h.settle();
    const vm = h.dock();
    expect(vm.status).toBe('not-signed-in');
    expect(vm.result).toBeNull();
    // Signing in again starts clean: nothing of the old sign-in comes back.
    h.bg.changeSession({ ...session, epoch: session.epoch + 2 }, 'sign-in');
    await h.settle();
    expect(h.dock()).toMatchObject({ status: 'ready', result: null });
  });

  it('the tab session and token: actions of the dock never reuse a token', async () => {
    const h = await start();
    const opId = await reply(h, 'one [NEXT] two', { split: true });
    await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 });
    await h.dispatch({ type: 'InsertPart', operationId: opId, part: 1 });
    const tokens = [...(h.bg.callsOf('op.start') as { cause: { actionToken: string } }[]).map((call) => call.cause.actionToken), ...h.fake.calls.inserts.map((intent) => intent.cause.actionToken)];
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(tokens.every((token) => token !== tokenN(1))).toBe(true);
    expect(h.bg.calls.every((call) => call.tab === TAB)).toBe(true);
  });
});

// ── a board's result in the dock of its own chat (§6.5) ────────────────────

/** The boards' side as the preview's controller gives it: what the test says of each part, and whether a card shows the result. */
function boardSide(): BoardResults & {
  readonly parts: Map<string, BoardPartFacts>;
  onCard: boolean;
  /** The board does not hold the result any more (its track aged out). */
  gone: boolean;
  /** What a look into the journal at a click comes to; and what the journal says then that this tab had not heard. */
  journal: BoardSync;
  atSync: (() => void) | null;
  syncs: number;
  told(): void;
} {
  const listeners = new Set<() => void>();
  const side = {
    parts: new Map<string, BoardPartFacts>(),
    onCard: false,
    gone: false,
    journal: 'read' as BoardSync,
    atSync: null as (() => void) | null,
    syncs: 0,
    part: (_opId: string, part: { readonly variant?: number; readonly index: number }): BoardPartFacts | null => (side.gone ? null : (side.parts.get(`${part.variant ?? 0}:${part.index}`) ?? { sentAt: null, hold: null })),
    sync: (): Promise<BoardSync> => {
      side.syncs += 1;
      if (side.gone) return Promise.resolve('gone');
      if (side.journal === 'read') side.atSync?.();
      return Promise.resolve(side.journal);
    },
    showing: () => side.onCard,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    told: () => listeners.forEach((listener) => listener()),
  };
  return side;
}

/**
 * A reply a preview generated for the fan of `previewChat` while another chat was open — as the preview's
 * controller starts it: surface `preview`, its own token. Resolves with the finished operation's id.
 */
async function previewReply(h: Harness, text: string, surface: 'preview' | 'newcomers' = 'preview'): Promise<string> {
  const rpc = h.bg.rpc(TAB);
  const bound = await rpc.request('binding.resolve', { account: hostAccount });
  const token = await rpc.request('token.issue', { kind: 'generate', surface });
  if (!bound.ok || !token.ok) throw new Error('no binding or token');
  h.script(h.streamOf(surface === 'preview' ? 'fast-reply' : 'hi-greeting', [text]));
  const admitted = await rpc.request('op.start', {
    feature: surface === 'preview' ? 'reply' : 'hi',
    surface,
    target: { binding: bound.payload.binding, chat: previewChat, fanRef: previewChat.platformFanId, conversationRef: previewChat.platformFanId },
    cause: { kind: 'click', actionToken: token.payload.actionToken },
    tone: null,
    split: true,
    window: 100,
    ...(surface === 'newcomers' ? { variantCount: 1 as const } : {}),
  });
  if (!admitted.ok || !admitted.payload.ok) throw new Error(`not admitted: ${JSON.stringify(admitted)}`);
  await h.finish();
  return admitted.payload.opId;
}

const handover = (opId: string, over: Partial<BoardHandover> = {}): BoardHandover => ({ opId, chat: previewChat, personaDefinitionId: WORLD.persona.definitionId, split: true, part: { index: 0 }, outcome: 'inserted', ...over });

describe('dock: a board’s result goes on in the dock of the chat «Открыть и вставить» opened (§6.5)', () => {
  it('[NEW-01] after the insert the dock shows the rest of the same operation: part 1 «вставлено», part 2 «Вставить» — one click, the dock’s own guarded write into that chat', async () => {
    const h = await start();
    const side = boardSide();
    h.ai.workspace.bindBoards(side);
    const opId = await previewReply(h, 'one [NEXT] two');
    // Nothing of a preview's result is in the dock of another chat.
    expect(h.dock().result).toBeNull();
    // «Открыть и вставить»: ChatSpace opened the fan's chat and the host put part 1 into its field.
    h.host.openChat(previewChat);
    await h.settle();
    expect(await h.ai.workspace.adoptBoardResult(handover(opId))).toBe(true);
    await h.settle();
    const vm = result(h);
    expect(vm).toMatchObject({ opId, surface: 'preview', feature: 'reply', state: 'done', canRegenerate: false, fix: null, confirm: null, draftNotSent: true, sendProgress: null });
    expect(partsOf(h).map((part) => `${part.text}:${part.insert}:${part.collapsed}:${part.next}`)).toEqual(['one:done:true:false', 'two:idle:false:true']);
    expect(vm.meta).toContainEqual({ key: 'result.meta.inserted', params: { done: 1, total: 2 } });
    // Nothing was written or asked of the background by taking the result over.
    expect(h.fake.calls.inserts).toEqual([]);
    expect(h.bg.callsOf('op.start')).toHaveLength(1);
    // Part 2 by its own click: a token of the click, a CAS on the draft as the host holds it now, into the operation's own chat.
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 1 })).toMatchObject({ ok: true, outcome: 'done' });
    expect(h.fake.calls.inserts).toHaveLength(1);
    expect(h.fake.calls.inserts[0]).toMatchObject({ operationId: opId, part: { index: 1 }, target: previewChat, text: 'two', mode: 'replace', expected: { kind: 'open' }, cause: { kind: 'click' } });
    expect(partsOf(h).map((part) => part.insert)).toEqual(['done', 'done']);
    // A human send of that draft is the operation's `sent`: the hub registers it as a part of the preview's group.
    h.host.humanSend({ chat: previewChat, pendingId: 'pending-9', textDigest: 'feedbeef00000007', platformMessageId: '4101', draft: { revision: 2, provenance: 'our-insert', insertIntentId: h.fake.calls.inserts[0]?.intentId as string, editedSinceInsert: false } });
    await h.settle();
    expect(h.bg.callsOf('op.reportSent')).toEqual([{ opId, part: { index: 1 }, pendingId: 'pending-9', platformMessageId: '4101', edited: false }]);
    // Copy, expand and hide are the dock's while it shows the result.
    expect(await h.dispatch({ type: 'Copy', artifactHandle: partsOf(h)[1]?.copyHandle as string })).toMatchObject({ ok: true });
    expect(h.clipboard.texts).toEqual(['two']);
    expect(await h.dispatch({ type: 'ExpandResult', operationId: opId, expanded: true })).toMatchObject({ ok: true });
    expect(result(h).expanded).toBe(true);
    expect(await h.dispatch({ type: 'HideResult', operationId: opId })).toMatchObject({ ok: true });
    expect(h.dock().result).toBeNull();
  });

  it('[NEW-05] [UI-020] the chat holds the person’s own text: nothing was written — the question «Заменить / Добавить в конец / Отмена» stands in that chat’s dock, and only their answer writes', async () => {
    const h = await start();
    h.ai.workspace.bindBoards(boardSide());
    const opId = await previewReply(h, 'one [NEXT] two');
    h.host.openChat(previewChat);
    h.host.type('mine in the chat');
    await h.settle();
    expect(await h.ai.workspace.adoptBoardResult(handover(opId, { outcome: 'needs-confirm' }))).toBe(true);
    await h.settle();
    const confirm = result(h).confirm;
    expect(confirm).toMatchObject({ kind: 'human-draft', part: { index: 0 }, formatLoss: false });
    expect(partsOf(h).map((part) => `${part.insert}:${part.next}`)).toEqual(['idle:true', 'idle:false']);
    // Asked, never written: no token, no host write, the person's words untouched.
    expect(h.fake.calls.inserts).toEqual([]);
    expect(h.bg.callsOf('token.issue')).toEqual([{ kind: 'generate', surface: 'preview' }]);
    expect(h.host.draftOf(previewChat)?.plainText).toBe('mine in the chat');
    // «Добавить в конец» is the person's own click: one write, on the revision the question was about.
    expect(await h.dispatch({ type: 'AnswerConfirm', confirmationId: confirm?.confirmationId as string, choice: 'append' })).toMatchObject({ ok: true, outcome: 'done' });
    expect(h.fake.calls.inserts).toHaveLength(1);
    expect(h.fake.calls.inserts[0]).toMatchObject({ operationId: opId, part: { index: 0 }, target: previewChat, mode: 'append', text: 'one', confirmationId: confirm?.confirmationId });
    expect(h.host.draftOf(previewChat)?.plainText).toBe('mine in the chat\none');
    expect(result(h).confirm).toBeNull();
    expect(partsOf(h).map((part) => `${part.insert}:${part.next}`)).toEqual(['done:false', 'idle:true']);
  });

  it('[AI-125] [AI-126] the dock does not take what it cannot vouch for: another chat is open, the persona is not known or is another one, the operation is the dock’s own or unknown — and then it inserts nothing of it', async () => {
    const h = await start();
    h.ai.workspace.bindBoards(boardSide());
    const opId = await previewReply(h, 'one [NEXT] two');
    // The person is still (or already) in another chat.
    expect(await h.ai.workspace.adoptBoardResult(handover(opId))).toBe(false);
    expect(h.dock().result).toBeNull();
    h.host.openChat(previewChat);
    await h.settle();
    // The result came back after a tab reload: the controller that shows it does not know its persona.
    expect(await h.ai.workspace.adoptBoardResult(handover(opId, { personaDefinitionId: null }))).toBe(false);
    expect(await h.ai.workspace.adoptBoardResult(handover(uuid(0xdead)))).toBe(false);
    expect(h.dock().result).toBeNull();
    // Not taken — not the dock's: «Вставить» of that operation is nobody's here.
    await expect(h.dispatch({ type: 'InsertPart', operationId: opId, part: 1 })).rejects.toThrow(/no controller took/);
    expect(h.fake.calls.inserts).toEqual([]);
    // Taken under one persona, it is not taken again under another.
    expect(await h.ai.workspace.adoptBoardResult(handover(opId))).toBe(true);
    expect(await h.ai.workspace.adoptBoardResult(handover(opId, { personaDefinitionId: WORLD.persona.otherDefinitionId }))).toBe(false);
    // A reply of the dock itself is never a board's result.
    h.host.openChat(openChat);
    await h.settle();
    const own = await reply(h, 'the dock’s own');
    expect(await h.ai.workspace.adoptBoardResult(handover(own, { chat: openChat }))).toBe(false);
    expect(result(h)).toMatchObject({ opId: own, surface: 'dock', canRegenerate: true });
  });

  it('[AI-126] the page’s persona changed after the hand-over: the result leaves the dock, and nothing of it is inserted', async () => {
    const h = await start();
    h.ai.workspace.bindBoards(boardSide());
    const opId = await previewReply(h, 'one [NEXT] two');
    h.host.openChat(previewChat);
    await h.settle();
    await h.ai.workspace.adoptBoardResult(handover(opId));
    await h.settle();
    expect(result(h).opId).toBe(opId);
    h.bg.changePersona(WORLD.pages.one.pageId, { key: 'other', definitionId: WORLD.persona.otherDefinitionId });
    await h.settle();
    expect(h.dock().result).toBeNull();
    await expect(h.dispatch({ type: 'InsertPart', operationId: opId, part: 1 })).rejects.toThrow(/no controller took/);
    expect(h.fake.calls.inserts).toEqual([]);
  });

  it('[TL-004] what the board knows of the parts shows in the dock: a delivered part reads «Отправлено» and is not inserted again; a part of the fan on its way or with an unknown outcome holds «Вставить» with the reason', async () => {
    const h = await start();
    const side = boardSide();
    h.ai.workspace.bindBoards(side);
    const opId = await previewReply(h, 'one [NEXT] two');
    h.host.openChat(previewChat);
    await h.settle();
    await h.ai.workspace.adoptBoardResult(handover(opId));
    await h.settle();
    // The person pressed ChatSpace's Send on part 1; the background journaled it and the board read it.
    const sentAt = new Date(NOW_MS + 60_000).toISOString();
    side.parts.set('0:0', { sentAt, hold: null });
    side.told();
    await h.settle();
    const [first, second] = partsOf(h);
    expect(first).toMatchObject({ send: { s: 'sent', at: sentAt }, collapsed: true, next: false, label: { key: 'part.ariaSent', params: { n: 1 } } });
    expect(second).toMatchObject({ insert: 'idle', next: true, insertBlocked: null });
    expect(second?.send).toBeUndefined();
    expect(result(h)).toMatchObject({ draftNotSent: false, sendProgress: { sent: 1, total: 2 } });
    expect(result(h).meta).toContainEqual({ key: 'result.meta.sentProgress', params: { sent: 1, total: 2 } });
    expect(result(h).meta.map((item) => item.key)).not.toContain('result.meta.inserted');
    // A delivered part is never put into a composer again, whatever asks.
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-SEND-PART' });
    // Another tab is sending part 2 through the preview: the fan is held, here as in the preview.
    side.parts.set('0:1', { sentAt: null, hold: { id: 'parts-sending', code: null, text: { key: 'result.againBlocked' } } });
    side.told();
    await h.settle();
    expect(partsOf(h)[1]?.insertBlocked).toEqual({ id: 'parts-sending', code: null, text: { key: 'result.againBlocked' } });
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 1 })).toMatchObject({ ok: false, code: 'CG-SEND-BUSY' });
    expect(h.fake.calls.inserts).toEqual([]);
    // The hold ends (the part went or was refused): the part is the dock's to insert again.
    side.parts.delete('0:1');
    side.told();
    await h.settle();
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 1 })).toMatchObject({ ok: true, outcome: 'done' });
    expect(h.fake.calls.inserts).toHaveLength(1);
  });

  it('[NF-022] [X8-08] «Вставить» in the dock reads the journal at the click, as the board’s «Открыть и вставить» does: an uncertain send another tab began since the hand-over holds the part; a journal that does not answer is not «nothing holds it»', async () => {
    const h = await start();
    const side = boardSide();
    h.ai.workspace.bindBoards(side);
    const opId = await previewReply(h, 'one [NEXT] two');
    h.host.openChat(previewChat);
    await h.settle();
    await h.ai.workspace.adoptBoardResult(handover(opId));
    await h.settle();
    const uncertain = { id: 'parts-sending', code: null, text: { key: 'result.againBlocked' } } as const;
    // Another tab is sending part 1 of this fan through its preview. This tab was told
    // nothing (the board holds what it last heard): the row still offers «Вставить».
    expect(partsOf(h)[1]).toMatchObject({ insert: 'idle', insertBlocked: null });
    side.atSync = () => side.parts.set('0:1', { sentAt: null, hold: uncertain });
    const before = side.syncs;
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 1 })).toMatchObject({ ok: false, code: 'CG-SEND-BUSY' });
    expect(side.syncs).toBe(before + 1);
    expect(h.fake.calls.inserts).toEqual([]);
    expect(h.bg.callsOf('token.issue').filter((call) => (call as { kind: string }).kind === 'insert')).toEqual([]);
    // What the read found is on the row now.
    expect(partsOf(h)[1]?.insertBlocked).toEqual(uncertain);
    // The journal does not answer (the port is down, the background did not read it): refused, never guessed.
    side.atSync = null;
    side.parts.delete('0:1');
    side.journal = 'unread';
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 1 })).toMatchObject({ ok: false, code: 'CG-RUNTIME-UNREACHABLE' });
    expect(h.fake.calls.inserts).toEqual([]);
    // It answers and nothing holds the fan: the part goes in — one read per click.
    side.journal = 'read';
    const reads = side.syncs;
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 1 })).toMatchObject({ ok: true, outcome: 'done' });
    expect(side.syncs).toBe(reads + 1);
    expect(h.fake.calls.inserts).toHaveLength(1);
    // The dock's own reply asks nobody: there is no board behind it.
    h.host.openChat(openChat);
    await h.settle();
    const own = await reply(h, 'the dock’s own');
    const quiet = side.syncs;
    expect(await h.dispatch({ type: 'InsertPart', operationId: own, part: 0 })).toMatchObject({ ok: true, outcome: 'done' });
    expect(side.syncs).toBe(quiet);
  });

  it('[NEW-05] [NF-022] an answer to the Б2 question is a write of its own: the journal is read again at the answer — a fan held since the question, or a part sent meanwhile, is not written over an old «Добавить в конец»', async () => {
    for (const since of ['held', 'sent'] as const) {
      const h = await start();
      const side = boardSide();
      h.ai.workspace.bindBoards(side);
      const opId = await previewReply(h, 'one [NEXT] two');
      h.host.openChat(previewChat);
      h.host.type('mine in the chat');
      await h.settle();
      expect(await h.ai.workspace.adoptBoardResult(handover(opId, { outcome: 'needs-confirm' }))).toBe(true);
      await h.settle();
      const confirm = result(h).confirm;
      expect(confirm).toMatchObject({ kind: 'human-draft', part: { index: 0 } });
      // The question stands. Meanwhile, in another tab…
      side.atSync = () =>
        side.parts.set(
          '0:0',
          since === 'sent'
            ? { sentAt: new Date(NOW_MS + 60_000).toISOString(), hold: null }
            : { sentAt: null, hold: { id: 'parts-sending', code: null, text: { key: 'result.againBlocked' } } },
        );
      expect([since, await h.dispatch({ type: 'AnswerConfirm', confirmationId: confirm?.confirmationId as string, choice: 'append' })]).toMatchObject([since, { ok: false, code: since === 'sent' ? 'CG-SEND-PART' : 'CG-SEND-BUSY' }]);
      // Nothing was written, the person's words are as they were, and the question is gone with its «да».
      expect(h.fake.calls.inserts).toEqual([]);
      expect(h.host.draftOf(previewChat)?.plainText).toBe('mine in the chat');
      expect(result(h).confirm).toBeNull();
      // «Отмена» needs no read: it writes nothing.
      const again = await start();
      const other = boardSide();
      again.ai.workspace.bindBoards(other);
      const next = await previewReply(again, 'one [NEXT] two');
      again.host.openChat(previewChat);
      again.host.type('mine in the chat');
      await again.settle();
      await again.ai.workspace.adoptBoardResult(handover(next, { outcome: 'needs-confirm' }));
      await again.settle();
      const reads = other.syncs;
      expect(await again.dispatch({ type: 'AnswerConfirm', confirmationId: result(again).confirm?.confirmationId as string, choice: 'cancel' })).toMatchObject({ ok: true });
      expect(other.syncs).toBe(reads);
    }
  });

  it('[NF-022] the board no longer holds the result (it aged out there): the dock does not offer its parts as if nothing were known — «часть устарела — обновите ответ», and «Вставить» writes nothing', async () => {
    const h = await start();
    const side = boardSide();
    h.ai.workspace.bindBoards(side);
    const opId = await previewReply(h, 'one [NEXT] two');
    h.host.openChat(previewChat);
    await h.settle();
    await h.ai.workspace.adoptBoardResult(handover(opId));
    await h.settle();
    expect(partsOf(h)[1]).toMatchObject({ insert: 'idle', insertBlocked: null });
    // Half an hour later the preview drops the result; the dock still shows it.
    side.gone = true;
    side.told();
    await h.settle();
    const stale = { id: 'send-unavailable', code: 'CG-SEND-PART', text: { key: 'send.reason.part' } };
    expect(result(h).opId).toBe(opId);
    expect(partsOf(h).map((part) => part.insertBlocked)).toEqual([stale, stale]);
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 1 })).toMatchObject({ ok: false, code: 'CG-SEND-PART' });
    expect(h.fake.calls.inserts).toEqual([]);
    // Copying is still there: the text is on screen.
    expect(await h.dispatch({ type: 'Copy', artifactHandle: partsOf(h)[1]?.copyHandle as string })).toMatchObject({ ok: true });
    // The boards are not bound at all (their chunk went away): the same.
    h.ai.workspace.bindBoards(null);
    await h.settle();
    expect(partsOf(h).map((part) => part.insertBlocked)).toEqual([stale, stale]);
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 1 })).toMatchObject({ ok: false, code: 'CG-SEND-PART' });
    expect(h.fake.calls.inserts).toEqual([]);
  });
});

describe('dock: «Ещё раз» and the options chosen after the answer (2026-10-22)', () => {
  it('[AI-007] «Ещё раз» goes with the tone and the Split chosen after the answer — else the original’s tone; Split lasts for the tab and is never stored', async () => {
    const h = await start();
    const handle = h.dock().targetHandle;
    if (handle === null) throw new Error('no open chat');
    const starts = (): { tone: unknown; split: boolean }[] => h.bg.callsOf('op.start') as { tone: unknown; split: boolean }[];
    expect(await h.dispatch({ type: 'SetTone', targetHandle: handle, tone: 'casual' })).toMatchObject({ ok: true });
    const first = await reply(h, 'hey you');
    expect(starts()[0]).toMatchObject({ tone: 'casual', split: false });

    // After the answer: another tone, and Split on — «Ещё раз» takes both, as the old extension did.
    expect(await h.dispatch({ type: 'SetTone', targetHandle: handle, tone: 'flirty' })).toMatchObject({ ok: true });
    expect(await h.dispatch({ type: 'SetSplit', split: true })).toMatchObject({ ok: true });
    expect(h.dock().options.split).toBe(true);
    h.script(h.streamOf('fast-reply', ['one [NEXT] two']));
    expect(await h.dispatch({ type: 'Regenerate', operationId: first })).toMatchObject({ ok: true, outcome: 'started' });
    await h.finish();
    expect(starts()[1]).toMatchObject({ tone: 'flirty', split: true });

    // Nothing chosen since: the original's tone again, and the tab's Split still on.
    const second = result(h).opId;
    h.script(h.streamOf('fast-reply', ['three [NEXT] four']));
    expect(await h.dispatch({ type: 'Regenerate', operationId: second })).toMatchObject({ ok: true, outcome: 'started' });
    await h.finish();
    expect(starts()[2]).toMatchObject({ tone: 'flirty', split: true });
    // The tab's Split is its own: nothing of it was written to the settings.
    expect((h.bg.callsOf('settings.patch') as { patch: { generation?: unknown } }[]).filter((call) => call.patch.generation !== undefined)).toEqual([]);
  });

  it('a generation that runs is not hidden: HideResult changes nothing until it ends (its answer would show nowhere)', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply'), afterMs: 100 }, delta('hey ', 200), doneStep] });
    const receipt = await h.generate('reply');
    if (!receipt.ok || receipt.opId === undefined) throw new Error('not started');
    const opId = receipt.opId;
    expect(await h.dispatch({ type: 'HideResult', operationId: opId })).toMatchObject({ ok: true, outcome: 'noop' });
    expect(h.dock().result?.opId).toBe(opId);
    await h.finish();
    expect(h.dock().result).toMatchObject({ opId, state: 'done' });
    expect(await h.dispatch({ type: 'HideResult', operationId: opId })).toMatchObject({ ok: true });
    expect(h.dock().result).toBeNull();
  });
});

describe('the focus handed to the next part (decision X44, ui-design §6.3)', () => {
  it('[UI-023] ⌘E → Enter → Enter → Enter → Enter: a two-part Reply offers part 1 over the empty composer, part 2 once the first was sent — and nothing inserts by itself', async () => {
    const h = await start();
    const opId = await reply(h, 'one [NEXT] two', { split: true });
    expect(h.dock().focusPart).toEqual({ opId, part: 0 });
    expect(h.fake.calls.inserts).toHaveLength(0);
    // The person's Enter on the focused part: the part is in the field, nothing is offered while it waits there.
    await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 });
    await h.settle();
    expect(h.host.draftOf(openChat)?.provenance).toBe('our-insert');
    expect(h.dock().focusPart).toBeNull();
    // Their Enter in the composer sends it: the field is empty again, the second part is offered.
    h.host.type('');
    await h.settle();
    expect(h.dock().focusPart).toEqual({ opId, part: 1 });
    await h.dispatch({ type: 'InsertPart', operationId: opId, part: 1 });
    await h.settle();
    expect(h.dock().focusPart).toBeNull();
    h.host.type('');
    await h.settle();
    // Every part is in: nothing more to offer. Two inserts, both by the person's own action.
    expect(h.dock().focusPart).toBeNull();
    expect(h.fake.calls.inserts.map((intent) => intent.part.index)).toEqual([0, 1]);
  });
});
