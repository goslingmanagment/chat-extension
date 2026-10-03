// The dock controller over the fake tab RPC (the real scheduler with R11's
// drivers behind it), @cg/testing's FakeHostPort and the fake hub's stream
// scripts: status and banners, the seven actions and their reasons, tone and
// Split, the stream, parts, inserts with Б2 and Fix, copy, cache hits, the
// refusal list, the stale mark, the debug footer, telemetry hooks, hotkeys.

import { describe, expect, it } from 'vitest';

import { DOCK_ACTION_IDS, UiActionSchema, type Bootstrap, type DockVM, type HubFrame, type InsertReceipt, type LiveTextTail, type OpView, type PartVM, type ResultVM } from '@cg/contracts';
import { KEYS_FOOTER_RESULTS, readArtifactHandle, readTargetHandle, targetHandle } from '@cg/core/application/ai';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { FakeHostPort, HOST_IDS, hostAccount, memory, openChat, previewChat, startSnapshot, type HostAnswers } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_ON, meta, resolveHubErrorReference } from '@cg/testing/hub';

import { CATALOG, OTHER_TAB, PERSONA_LABEL, TAB, settingsWithPersona } from './support/ai-background';
import { delta, doneStep, readyHarness, type Harness, type HarnessOptions, type HarnessParts } from './support/ai-harness';
import { settle } from './support/clock';
import { type ScriptResponse } from './support/fake-hub';
import { NOW_MS, WORLD, session, tokenN, uuid } from './support/world';

function parts(answers: HostAnswers = {}): HarnessParts & { readonly fake: FakeHostPort } {
  const fake = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers, timeline: [] });
  return {
    fake,
    baseHost: fake,
    memory,
    catalog: createFakeCatalog(ctxOf({ now: NOW_MS })),
    bootstrap: BOOTSTRAP_PILOT_ON,
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

const usage: HubFrame = {
  type: 'usage',
  usage: { inputTokens: 3412, outputTokens: 286, cacheWriteTokens: 0, cacheReadTokens: 3000, costMicroUsd: 14_300, costApproximate: false },
  providerResponseId: null,
  cacheHit: false,
};

describe('dock: where it shows and what state it is in', () => {
  it('[UI-012] the dock exists only in an open chat', async () => {
    const h = await start();
    expect(h.dock().visible).toBe(true);
    expect(h.dock().targetHandle).toBe(targetHandle('dock', openChat));
    h.host.openChat(null);
    await h.settle();
    const outside = h.dock();
    expect(outside.visible).toBe(false);
    expect(outside.targetHandle).toBeNull();
    expect(outside.view.s).toBe('empty');
    expect(outside.result).toBeNull();
  });

  it('ready: the persona, no banner, every action on with its key, Tone and Split unlocked', async () => {
    const h = await start();
    const vm = h.dock();
    expect(vm).toMatchObject({ status: 'ready', statusError: null, mode: 'insert', mark: 'normal', statusWords: false, quota: null, analysis: null, refusal: null, result: null, debug: null });
    expect(vm.view).toEqual({ s: 'ready' });
    expect(vm.persona).toEqual({ label: PERSONA_LABEL, pageName: 'Model One' });
    expect(Object.keys(vm.actions)).toEqual([...DOCK_ACTION_IDS]);
    for (const id of DOCK_ACTION_IDS) {
      const action = vm.actions[id];
      // The stand's composer is empty and its fan wrote a lot: Fix waits for a draft, Hi is past its time.
      if (id === 'fix' || id === 'hi') continue;
      expect(action, id).toMatchObject({ enabled: true, busy: false, active: false, reason: null, badge: null });
      expect(action.hotkey?.display, id).toBeTruthy();
    }
    expect(vm.options).toMatchObject({ tone: null, tones: ['casual', 'flirty', 'upsell', 'spicy'], split: false, locked: false, toneReason: null, splitReason: null });
    expect(vm.resultStyle).toBe('bare');
    expect(vm.hints).toBe(true);
  });

  it('[AI-121] not signed in: the banner, everything off with the reason, no persona, the mark faint', async () => {
    const h = await start({ session: null });
    const vm = h.dock();
    expect(vm.status).toBe('not-signed-in');
    expect(vm.statusError?.code).toBe('CG-AUTH-REQUIRED');
    expect(vm.view.s).toBe('forbidden');
    expect(vm.persona).toBeNull();
    expect(vm.mark).toBe('faint');
    expect(vm.targetHandle).toBeNull();
    for (const id of DOCK_ACTION_IDS) {
      expect(vm.actions[id], id).toMatchObject({ enabled: false, hotkey: null });
      expect(vm.actions[id].reason?.id, id).toBe('not-signed-in');
    }
    expect(vm.options.toneReason?.id).toBe('not-signed-in');
  });

  it('[UI-011] an account that is not bound to a page: «Аккаунт не привязан», nothing runs', async () => {
    const h = await start({ background: (bg) => (bg.bindingError = { code: 'CG-BINDING-MISSING' }) });
    const vm = h.dock();
    expect(vm.status).toBe('no-binding');
    expect(vm.statusError?.code).toBe('CG-BINDING-MISSING');
    expect(vm.persona).toBeNull();
    expect(vm.actions.reply.reason?.id).toBe('no-binding');
    expect(vm.actions.reply.reason?.code).toBe('CG-BINDING-MISSING');
  });

  it('a page that is not granted names itself so', async () => {
    const h = await start({ background: (bg) => (bg.bindingError = { code: 'CG-BINDING-NOT-GRANTED' }) });
    expect(h.dock().status).toBe('no-binding');
    expect(h.dock().statusError?.code).toBe('CG-BINDING-NOT-GRANTED');
    expect(h.dock().actions.reply.reason?.id).toBe('not-granted');
  });

  it('[UI-011] a broken host identity closes every sensitive action', async () => {
    const h = await start();
    h.host.setCapability('identity', { state: 'contractBroken', reason: 'accounts' });
    await h.settle();
    const vm = h.dock();
    expect(vm.status).toBe('host-degraded');
    expect(vm.statusError?.code).toBe('CG-HOST-CONTRACT');
    expect(vm.actions.reply).toMatchObject({ enabled: false });
    expect(vm.actions.reply.reason?.id).toBe('host-degraded');
  });

  it('[UI-013] no persona for the page: the banner leads to «Персоны»', async () => {
    const h = await start({ settings: { ...settingsWithPersona(), personas: { scope: null, byPageId: {} } } });
    const vm = h.dock();
    expect(vm.status).toBe('no-persona');
    expect(vm.statusError?.code).toBe('CG-PERSONA-UNASSIGNED');
    expect(vm.view).toMatchObject({ s: 'forbidden', remedy: { type: 'OpenSettings', route: { section: 'personas', code: 'CG-PERSONA-UNASSIGNED' } } });
    expect(vm.persona).toBeNull();
    expect(vm.actions.coach.reason?.id).toBe('no-persona');
  });

  it('[UI-013] an archived persona asks for a replacement; an empty catalog says there are none', async () => {
    const archived = await start({ background: (bg) => (bg.catalog = { personas: CATALOG.personas.map((p) => ({ ...p, status: 'archived' as const })) }) });
    expect(archived.dock().statusError?.code).toBe('CG-PERSONA-UNAVAILABLE');
    const none = await start({ settings: { ...settingsWithPersona(), personas: { scope: null, byPageId: {} } }, background: (bg) => (bg.catalog = { personas: [] }) });
    expect(none.dock().statusError?.code).toBe('CG-PERSONA-NONE');
  });

  it('the hub does not answer: «Хаб недоступен» with a retry, everything off', async () => {
    const h = await start({ background: (bg) => (bg.bootstrap = { error: { code: 'CG-HUB-UNAVAILABLE', httpStatus: 503 } }) });
    const vm = h.dock();
    expect(vm.status).toBe('hub-down');
    expect(vm.statusError).toMatchObject({ code: 'CG-HUB-UNAVAILABLE', detail: 'HTTP 503' });
    expect(vm.view).toMatchObject({ s: 'offline', retry: { type: 'ReloadView', selector: { of: 'dock' } } });
    expect(vm.actions.reply.reason?.id).toBe('hub-down');
    // «Повторить» reads everything again.
    h.bg.bootstrap = BOOTSTRAP_PILOT_ON;
    await h.dispatch({ type: 'ReloadView', selector: { of: 'dock' } });
    await h.settle();
    expect(h.dock().status).toBe('ready');
  });

  it('a binding or catalog read that failed once is read again on «Повторить» and after a reconnect; «not bound» is not', async () => {
    const h = await start({ background: (bg) => (bg.bindingError = { code: 'CG-HUB-UNAVAILABLE' }) });
    expect(h.dock()).toMatchObject({ status: 'hub-down', view: { s: 'offline', retry: { type: 'ReloadView', selector: { of: 'dock' } } } });
    expect(h.bg.callsOf('binding.resolve')).toHaveLength(1);
    // Nothing asks again by itself.
    await h.clock.advance(60_000);
    expect(h.bg.callsOf('binding.resolve')).toHaveLength(1);
    h.bg.bindingError = null;
    expect(await h.dispatch({ type: 'ReloadView', selector: { of: 'dock' } })).toMatchObject({ ok: true });
    await h.settle();
    expect(h.bg.callsOf('binding.resolve')).toHaveLength(2);
    expect(h.dock().status).toBe('ready');

    // A port that came back reads it again too.
    const dropped = await start({ background: (bg) => (bg.bindingError = { code: 'CG-RUNTIME-UNREACHABLE' }) });
    expect(dropped.dock().status).toBe('hub-down');
    dropped.bg.bindingError = null;
    dropped.bg.setConnection('reconnecting');
    dropped.bg.setConnection('ready');
    await dropped.settle();
    expect(dropped.dock().status).toBe('ready');

    // The catalog of a page without a persona: the failed read is the hub line, and «Повторить» reads it again.
    const catalog = await start({ settings: { ...settingsWithPersona(), personas: { scope: null, byPageId: {} } }, background: (bg) => (bg.catalog = { error: { code: 'CG-HUB-TIMEOUT' } }) });
    expect(catalog.dock().status).toBe('hub-down');
    expect(catalog.bg.callsOf('catalog.get')).toHaveLength(1);
    catalog.bg.catalog = CATALOG;
    await catalog.dispatch({ type: 'ReloadView', selector: { of: 'dock' } });
    await catalog.settle();
    expect(catalog.bg.callsOf('catalog.get')).toHaveLength(2);
    expect(catalog.dock().status).toBe('no-persona');

    // «Аккаунт не привязан» is the hub's answer: «Повторить» does not exist for it and a reload asks nothing.
    const unbound = await start({ background: (bg) => (bg.bindingError = { code: 'CG-BINDING-MISSING' }) });
    unbound.ai.workspace.env.reload();
    await unbound.settle();
    expect(unbound.bg.callsOf('binding.resolve')).toHaveLength(1);
    expect(unbound.dock().status).toBe('no-binding');
  });

  it('[AI-122] the chat is still loading: the words, no banner, every action off', async () => {
    const h = await start();
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), state: 'loading' }, openChat);
    await h.settle();
    const vm = h.dock();
    expect(vm.status).toBe('loading-chat');
    expect(vm.statusError).toBeNull();
    expect(vm.statusWords).toBe(true);
    expect(vm.view.s).toBe('loading');
    expect(vm.targetHandle).toBeNull();
    for (const id of DOCK_ACTION_IDS) expect(vm.actions[id].reason?.id, id).toBe('chat-loading');
  });

  it('[UI-027] a blocked fan: the copy-only row, the actions still work', async () => {
    const h = await start();
    h.host.setComposer({ hidden: true });
    await h.settle();
    const vm = h.dock();
    expect(vm).toMatchObject({ status: 'blocked-fan', mode: 'copy-only' });
    expect(vm.statusError?.code).toBe('CG-GATE-FAN-BLOCKED');
    expect(vm.actions.reply.enabled).toBe(true);
    const opId = await reply(h, 'copy me');
    expect(partsOf(h)[0]?.insertBlocked?.id).toBe('fan-blocked');
    const receipt = await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 });
    expect(receipt).toMatchObject({ ok: false, code: 'CG-GATE-FAN-BLOCKED' });
  });

  it('[UI-027] ChatSpace changed and the insert is off, or the composer is missing: copy only, with the code that says which', async () => {
    const h = await start();
    h.host.setCapability('insert', { state: 'contractBroken', reason: 'composerBridge', code: 'CG-HOST-CONTRACT' });
    await h.settle();
    expect(h.dock()).toMatchObject({ status: 'host-degraded', mode: 'copy-only' });
    expect(h.dock().statusError?.code).toBe('CG-HOST-CONTRACT');
    expect(h.dock().actions.reply.enabled).toBe(true);

    h.host.setCapability('insert', { state: 'on' });
    h.host.setComposer(null);
    await h.settle();
    expect(h.dock()).toMatchObject({ status: 'host-degraded', mode: 'copy-only' });
    expect(h.dock().statusError?.code).toBe('CG-HOST-COMPOSER-MISSING');
  });

  it('the insertion switch of the owner off: results are copied, nothing else changes', async () => {
    const off: Bootstrap = { ...BOOTSTRAP_PILOT_ON, flags: { ...BOOTSTRAP_PILOT_ON.flags, insertion: false } };
    const h = await start({ bootstrap: off });
    expect(h.dock()).toMatchObject({ status: 'ready', mode: 'copy-only' });
    await reply(h);
    expect(partsOf(h)[0]?.insertBlocked?.id).toBe('feature-disabled');
  });

  it('the extension was reloaded under the tab: a card with «Перезагрузить вкладку», nothing runs', async () => {
    const h = await start();
    h.bg.setConnection('reloaded');
    await h.settle();
    const vm = h.dock();
    expect(vm.status).toBe('reload-needed');
    expect(vm.statusError?.code).toBe('CG-RUNTIME-RELOADED');
    expect(vm.view).toMatchObject({ s: 'error', retry: { type: 'ReloadTab' } });
    expect(vm.actions.reply.reason?.id).toBe('reload-needed');
    const other = await start();
    other.host.reloadNeeded();
    await other.settle();
    expect(other.dock().status).toBe('reload-needed');
  });

  it('review, recap and coach follow their owner switches', async () => {
    const off: Bootstrap = { ...BOOTSTRAP_PILOT_ON, flags: { ...BOOTSTRAP_PILOT_ON.flags, review: false, coach: false } };
    const h = await start({ bootstrap: off });
    const vm = h.dock();
    expect(vm.actions.review.reason?.id).toBe('feature-disabled');
    expect(vm.actions.coach.reason?.id).toBe('feature-disabled');
    expect(vm.actions.recap.enabled).toBe(true);
    expect(vm.actions.reply.enabled).toBe(true);
  });

  it('debug mode shows the contract line; outside it there is none', async () => {
    const h = await start({ settings: { ...settingsWithPersona(), debug: { enabled: true, renderTrace: true } } });
    expect(h.dock().debug).toEqual({ renderTrace: true, contract: 'index-0000fake · ok' });
  });
});

describe('dock: gates of the actions', () => {
  it('[AI-021] Fix is off without a draft and on once the person typed one', async () => {
    const h = await start();
    expect(h.dock().actions.fix).toMatchObject({ enabled: false, hotkey: null });
    expect(h.dock().actions.fix.reason).toMatchObject({ id: 'needs-draft', code: 'CG-GATE-DRAFT' });
    expect(await h.generate('fix')).toMatchObject({ ok: false, code: 'CG-GATE-DRAFT' });
    h.host.type('my own words');
    await h.settle();
    expect(h.dock().actions.fix.enabled).toBe(true);
  });

  it('[AI-031] Hi is off once the fan wrote more than ten messages; [AI-036] Ping is never off on OnlyFans', async () => {
    const h = await start();
    expect(h.dock().actions.hi.reason).toMatchObject({ id: 'hi-gate', code: 'CG-GATE-HI' });
    expect(h.dock().actions.ping.enabled).toBe(true);
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), fanMessages: 2, loaded: 6 }, openChat);
    await h.settle();
    expect(h.dock().actions.hi.enabled).toBe(true);
  });

  it('[AI-051] Review needs history only when the whole short conversation is loaded; Recap opens its sheet anyway', async () => {
    const h = await start();
    expect(h.dock().actions.review.enabled).toBe(true);
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), loaded: 12, fanMessages: 6, modelMessages: 6, hasOlder: false }, openChat);
    await h.settle();
    expect(h.dock().actions.review.reason).toMatchObject({ id: 'no-history', code: 'CG-GATE-HISTORY' });
    expect(h.dock().actions.recap.enabled).toBe(true);
    expect(h.dock().actions.coach.enabled).toBe(true);
  });

  it('a refused gate spends nothing: no token, no request to the background', async () => {
    const h = await start();
    await h.generate('fix');
    expect(h.bg.callsOf('token.issue')).toEqual([]);
    expect(h.bg.callsOf('op.start')).toEqual([]);
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

  it('[AI-139] the stage line follows the phases; the stream text is a preview without actions', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply'), afterMs: 100 }, delta('hey ', 100), delta('you [NE', 100), delta('XT] there', 100), { kind: 'frame', frame: { type: 'done', stopReason: 'end_turn' }, afterMs: 100 }] });
    await h.generate('reply');
    await h.clock.advance(100);
    expect(result(h).phase?.stages.map((stage) => `${stage.id}:${stage.state}`)).toEqual(['context:done', 'thinking:current']);
    await h.clock.advance(100);
    expect(result(h).phase?.stages.map((stage) => `${stage.id}:${stage.state}`)).toEqual(['context:done', 'thinking:done', 'writing:current']);
    expect(result(h)).toMatchObject({ state: 'streaming', streamText: 'hey', parts: null });
    await h.clock.advance(150);
    // A marker cut by the chunk boundary is never shown, not even a piece of it.
    expect(result(h).streamText).toBe('hey you');
    await h.clock.advance(100);
    expect(result(h).streamText).toBe('hey you\n\nthere');
    expect(result(h).parts).toBeNull();
    await h.finish();
    const done = result(h);
    expect(done).toMatchObject({ state: 'done', phase: null, streamText: null, draftNotSent: true, canRegenerate: true, error: null, unparsed: false, cachedAt: null });
    expect(done.parts?.map((part) => part.text)).toEqual(['hey you', 'there']);
  });

  it('[UI-007] [UI-008] [AI-009] while it runs only its own button works; Tone and Split are locked', async () => {
    const h = await start();
    h.host.type('a draft');
    await h.settle();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, { kind: 'stall' }] });
    await h.generate('reply');
    const vm = h.dock();
    expect(vm.actions.reply).toMatchObject({ enabled: true, busy: true, active: true });
    for (const id of DOCK_ACTION_IDS.filter((action) => action !== 'reply')) {
      expect(vm.actions[id], id).toMatchObject({ enabled: false, busy: false, hotkey: null });
      expect(vm.actions[id].reason, id).toMatchObject({ id: 'chat-busy', code: 'CG-OP-CHAT-BUSY' });
    }
    expect(vm.options).toMatchObject({ locked: true });
    expect(vm.options.toneReason?.id).toBe('locked-during-generation');
    expect(vm.options.splitReason?.id).toBe('locked-during-generation');
    // The lock holds against the actions too.
    const handle = vm.targetHandle as string;
    expect(await h.dispatch({ type: 'SetTone', targetHandle: handle, tone: 'flirty' })).toMatchObject({ ok: true, outcome: 'noop' });
    expect(await h.dispatch({ type: 'SetPreference', key: 'generation.split', value: true })).toMatchObject({ ok: true, outcome: 'noop' });
    expect(h.dock().options).toMatchObject({ tone: null, split: false });
  });

  it('[AI-127] a second click on the running feature only brings its sheet back', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, { kind: 'stall' }] });
    const first = await h.generate('reply');
    await h.dispatch({ type: 'HideResult', operationId: (first as { opId: string }).opId });
    expect(h.dock().result).toBeNull();
    expect(h.dock().actions.reply.busy).toBe(true);
    const again = await h.generate('reply');
    expect(again).toMatchObject({ ok: true, outcome: 'noop', opId: (first as { opId: string }).opId });
    expect(h.bg.callsOf('op.start').length).toBe(1);
    expect(result(h).opId).toBe((first as { opId: string }).opId);
  });

  it('[AI-130] cancel is explicit: the sheet closes and nothing is left to act on', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, delta('hey'), { kind: 'stall' }] });
    const receipt = await h.generate('reply');
    await h.clock.advance(100);
    const cancel = result(h).phase?.cancel;
    if (cancel === null || cancel === undefined) throw new Error('no cancel');
    expect(await h.dispatch(cancel)).toMatchObject({ ok: true, type: 'CancelGeneration' });
    expect(h.dock().result).toBeNull();
    expect(h.dock().actions.reply).toMatchObject({ busy: false, enabled: true });
    expect(h.bg.scheduler.view((receipt as { opId: string }).opId)?.state).toBe('canceled');
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

  it('a failed generation shows its one error with the recovery buttons of the registry', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, { kind: 'frame', frame: { type: 'error', code: 'provider_rate_limited', message: 'slow down', retryAfterMs: 24_000 } }] });
    await h.generate('reply');
    await h.finish();
    const failed = result(h);
    expect(failed).toMatchObject({ state: 'failed', parts: null, draftNotSent: false, canRegenerate: false });
    expect(failed.error).toMatchObject({ code: 'CG-PROVIDER-RATE-LIMIT', retryAt: NOW_MS + 24_000 });
    expect(failed.meta).toEqual([{ key: 'result.meta.failed' }]);
    expect(failed.regenerateReason?.id).toBe('wait-until');
    const retry = failed.errorActions[0];
    expect(retry).toMatchObject({ enabled: false, action: { type: 'Regenerate', operationId: failed.opId }, hotkey: null });
    expect(retry?.reason?.id).toBe('wait-until');
    expect(failed.errorActions.at(-1)?.action).toEqual({ type: 'CopyReport', scope: 'error', code: 'CG-PROVIDER-RATE-LIMIT' });
    // The deadline only enables the button; nothing is repeated by itself.
    await h.clock.advance(20_000);
    expect(result(h)).toMatchObject({ canRegenerate: true, regenerateReason: null });
    expect(result(h).errorActions[0]).toMatchObject({ enabled: true });
    expect(h.bg.callsOf('op.start').length).toBe(1);
  });

  it('[AI-132] an answer with nothing usable is CG-OUTPUT-UNUSABLE, never an empty result', async () => {
    const h = await start();
    h.script(h.streamOf('fast-reply', ['<think>only thoughts</think>']));
    await h.generate('reply');
    await h.finish();
    expect(result(h)).toMatchObject({ state: 'failed', parts: null });
    expect(result(h).error?.code).toBe('CG-OUTPUT-UNUSABLE');
  });

  it('[UI-032] an answer the result cannot hold is shown raw, in one copy-only part', async () => {
    const h = await start();
    const many = Array.from({ length: 11 }, (_, n) => `part ${n}`).join(' [NEXT] ');
    const opId = await reply(h, many);
    const vm = result(h);
    expect(vm.unparsed).toBe(true);
    expect(vm.meta).toEqual([{ key: 'result.meta.unparsed' }]);
    expect(vm.parts?.length).toBe(1);
    expect(vm.parts?.[0]).toMatchObject({ text: many, numbered: false });
    expect(vm.parts?.[0]?.insertBlocked?.id).toBe('unparsed');
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-OUTPUT-UNUSABLE' });
    expect((await h.dispatch({ type: 'Copy', artifactHandle: vm.parts?.[0]?.copyHandle as string })).ok).toBe(true);
    expect(h.clipboard.texts).toEqual([many]);
  });
});

describe('dock: tones and Split', () => {
  it('[AI-005] [AI-003] a tone picked in the menu starts Reply in it and is gone after', async () => {
    const h = await start();
    await reply(h, 'flirty answer', { tone: 'flirty' });
    expect((h.bg.callsOf('op.start')[0] as { tone: string }).tone).toBe('flirty');
    expect(result(h).toneUsed).toBe('flirty');
    expect(result(h).meta).toContainEqual({ key: 'result.meta.tone', params: { tone: 'Flirt' } });
    expect(h.dock().options.tone).toBeNull();
  });

  it('[AI-003] [AI-004] [AI-006] the chosen tone goes with the next Reply only; picking it again takes it off', async () => {
    const h = await start();
    const handle = h.dock().targetHandle as string;
    expect(h.dock().options.tone).toBeNull();
    await h.dispatch({ type: 'SetTone', targetHandle: handle, tone: 'upsell' });
    expect(h.dock().options.tone).toBe('upsell');
    await h.dispatch({ type: 'SetTone', targetHandle: handle, tone: 'upsell' });
    expect(h.dock().options.tone).toBeNull();
    await h.dispatch({ type: 'SetTone', targetHandle: handle, tone: 'spicy' });
    await reply(h, 'first');
    expect((h.bg.callsOf('op.start')[0] as { tone: string }).tone).toBe('spicy');
    expect(h.dock().options.tone).toBeNull();
    await h.dispatch({ type: 'HideResult', operationId: result(h).opId });
    await reply(h, 'second');
    expect((h.bg.callsOf('op.start')[1] as { tone: unknown }).tone).toBeNull();
  });

  it('the tone belongs to its chat: another chat has none', async () => {
    const h = await start();
    await h.dispatch({ type: 'SetTone', targetHandle: h.dock().targetHandle as string, tone: 'casual' });
    h.host.openChat(previewChat);
    await h.settle();
    expect(h.dock().options.tone).toBeNull();
    h.host.openChat(openChat);
    await h.settle();
    expect(h.dock().options.tone).toBe('casual');
  });

  it('[AI-007] [AI-129] «Ещё раз» repeats the tone of the original, past the cache', async () => {
    const h = await start();
    const first = await reply(h, 'one', { tone: 'flirty' });
    h.script(h.streamOf('fast-reply', ['two']));
    const receipt = await h.dispatch({ type: 'Regenerate', operationId: first });
    await h.finish();
    expect(receipt).toMatchObject({ ok: true, type: 'Regenerate', outcome: 'started' });
    const again = h.bg.callsOf('op.start')[1] as { tone: string; regenerateOf: string; force: boolean };
    expect(again).toMatchObject({ tone: 'flirty', regenerateOf: first, force: true });
    expect(h.bg.hub.streams[1]?.body.isRegeneration).toBe(true);
    expect(result(h).toneUsed).toBe('flirty');
    expect(partsOf(h).map((part) => part.text)).toEqual(['two']);
  });

  it('[AI-010] Split is the saved setting, snapshotted at the start; the write is confirmed with its revision', async () => {
    const h = await start();
    const receipt = await h.dispatch({ type: 'SetPreference', key: 'generation.split', value: true });
    expect(receipt).toMatchObject({ ok: true, type: 'SetPreference', revision: 2 });
    expect(h.dock().options.split).toBe(true);
    await reply(h, 'a [NEXT] b [NEXT] c');
    expect((h.bg.callsOf('op.start')[0] as { split: boolean }).split).toBe(true);
    expect(h.bg.hub.streams[0]?.body.replyMode).toBe('preferSplit');
    expect(result(h)).toMatchObject({ splitRequested: true });
    expect(result(h).meta).toEqual([{ key: 'result.meta.parts', params: { n: 3 } }]);
    expect(partsOf(h).map((part) => `${part.index}:${part.numbered}:${part.next}`)).toEqual(['0:true:true', '1:true:false', '2:true:false']);
  });

  it('[AI-011] Split asked and one part back: «получилась одна часть», no new request by itself', async () => {
    const h = await start({ settings: { ...settingsWithPersona(), generation: { ...settingsWithPersona().generation, split: true } } });
    await reply(h, 'just one message');
    expect(result(h)).toMatchObject({ splitRequested: true, unparsed: false });
    expect(result(h).meta).toEqual([{ key: 'result.meta.onePart' }]);
    expect(partsOf(h)).toHaveLength(1);
    expect(partsOf(h)[0]).toMatchObject({ numbered: false, next: true });
    expect(h.bg.callsOf('op.start').length).toBe(1);
    // Without Split the same answer reads «одним сообщением».
    const plain = await start();
    await reply(plain, 'just one message');
    expect(result(plain).meta).toEqual([{ key: 'result.meta.single' }]);
  });
});

describe('dock: Hi, Ping', () => {
  const fewMessages = async (): Promise<Harness & { fake: FakeHostPort }> => {
    const h = await start();
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), fanMessages: 1, modelMessages: 2, loaded: 3 }, openChat);
    await h.settle();
    return h;
  };

  it('[AI-030] Hi asks for three variants and shows them, each with its parts', async () => {
    const h = await fewMessages();
    h.script(h.streamOf('hi-greeting', ['hey [NEXT] you there? [VARIANT] hi stranger [VARIANT] morning']));
    await h.generate('hi');
    await h.finish();
    expect((h.bg.callsOf('op.start')[0] as { variantCount: number }).variantCount).toBe(3);
    expect(h.bg.hub.streams[0]?.body.variantCount).toBe(3);
    const vm = result(h);
    expect(vm.parts).toBeNull();
    expect(vm.variants?.map((variant) => variant.parts.map((part) => part.text))).toEqual([['hey', 'you there?'], ['hi stranger'], ['morning']]);
    expect(vm.variants?.[1]?.label).toEqual({ key: 'part.variant', params: { n: 2 } });
    expect(vm.meta).toEqual([
      { key: 'result.meta.variants', params: { n: 3 } },
      { key: 'result.meta.partsEach', params: { n: 2 } },
    ]);
    // Until a variant is picked the first one leads.
    expect(vm.variants?.map((variant) => variant.parts.map((part) => part.next))).toEqual([[true, false], [false], [false]]);
  });

  it('after a part of a variant is inserted, that variant leads', async () => {
    const h = await fewMessages();
    h.script(h.streamOf('hi-greeting', ['a1 [NEXT] a2 [VARIANT] b1 [NEXT] b2']));
    const receipt = await h.generate('hi');
    await h.finish();
    const opId = (receipt as { opId: string }).opId;
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, variant: 1, part: 0 })).toMatchObject({ ok: true, outcome: 'done' });
    const vm = result(h);
    expect(vm.variants?.map((variant) => variant.parts.map((part) => `${part.insert}:${part.next}`))).toEqual([
      ['idle:false', 'idle:false'],
      ['done:false', 'idle:true'],
    ]);
    expect(h.host.draftOf(openChat)?.plainText).toBe('b1');
  });

  it('[AI-035] [AI-039] Ping carries no template text from the client and starts for an active fan too', async () => {
    const h = await start();
    h.script(h.streamOf('ping', ['hey stranger']));
    expect((await h.generate('ping')).ok).toBe(true);
    await h.finish();
    expect(h.bg.hub.streams[0]?.feature).toBe('ping');
    expect(Object.keys(h.bg.hub.streams[0]?.body ?? {})).not.toContain('draftText');
    expect(partsOf(h).map((part) => part.text)).toEqual(['hey stranger']);
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

  it('goes with Reply in the open chat: read once at the start, N from the bootstrap', async () => {
    const h = await start();
    h.host.setTail(openChat, tail);
    await reply(h);
    expect(h.host.reads.tail).toBe(1);
    expect((h.bg.callsOf('op.start')[0] as { fresh: LiveTextTail }).fresh).toEqual(tail);
    expect(h.bg.hub.streams[0]?.body.liveTextContext?.items.map((item) => item.platformMessageId)).toEqual(['4004', '4005']);
    expect(h.bg.hub.streams[0]?.capabilities).toContain('context-v1');
  });

  it('never without the owner switch or the hub capability, and never for Review', async () => {
    const off: Bootstrap = { ...BOOTSTRAP_PILOT_ON, flags: { ...BOOTSTRAP_PILOT_ON.flags, freshText: false } };
    const h = await start({ bootstrap: off });
    h.host.setTail(openChat, tail);
    await reply(h);
    expect(h.host.reads.tail).toBe(0);
    expect((h.bg.callsOf('op.start')[0] as { fresh?: unknown }).fresh).toBeUndefined();
    expect(h.bg.hub.streams[0]?.body.liveTextContext).toBeUndefined();

    const noContext: Bootstrap = { ...BOOTSTRAP_PILOT_ON, capabilities: BOOTSTRAP_PILOT_ON.capabilities.filter((c) => c !== 'context-v1') };
    const other = await start({ bootstrap: noContext });
    other.host.setTail(openChat, tail);
    await reply(other);
    expect(other.host.reads.tail).toBe(0);
  });

  it('a host that cannot give the tail just means a generation on the archive', async () => {
    const h = await start();
    h.host.setCapability('freshText', { state: 'off', reason: 'chatMessages' });
    await reply(h);
    expect((h.bg.callsOf('op.start')[0] as { fresh?: unknown }).fresh).toBeUndefined();
    expect(partsOf(h)).toHaveLength(1);
  });
});

describe('dock: inserting a part', () => {
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

  it('the next part replaces our own unchanged insert without a question', async () => {
    const h = await start();
    const opId = await reply(h, 'one [NEXT] two', { split: true });
    await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 });
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 1 })).toMatchObject({ ok: true, outcome: 'done' });
    expect(h.fake.calls.inserts[1]).toMatchObject({ mode: 'replace', text: 'two', confirmationId: null, expected: { draftRevision: 5 } });
    expect(result(h).confirm).toBeNull();
  });

  it('[UI-020] the person\'s own text in the field asks «Заменить / Добавить в конец / Отмена» for that revision', async () => {
    const h = await start();
    const opId = await reply(h, 'the answer');
    h.host.type('my own words');
    await h.settle();
    const receipt = await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 });
    expect(receipt).toMatchObject({ ok: true, outcome: 'needs-confirm' });
    expect(h.fake.calls.inserts).toHaveLength(0);
    const confirm = result(h).confirm;
    expect(confirm).toMatchObject({ kind: 'human-draft', part: { index: 0 }, formatLoss: false });

    const answered = await h.dispatch({ type: 'AnswerConfirm', confirmationId: confirm?.confirmationId as string, choice: 'append' });
    expect(answered).toMatchObject({ ok: true, outcome: 'done' });
    expect(h.fake.calls.inserts[0]).toMatchObject({ mode: 'append', text: 'the answer', confirmationId: confirm?.confirmationId, expected: { draftRevision: 5 } });
    expect(result(h).confirm).toBeNull();
    expect(h.host.draftOf(openChat)?.plainText).toBe('my own words\nthe answer');
  });

  it('«Отмена» writes nothing and the question is gone', async () => {
    const h = await start();
    const opId = await reply(h, 'the answer');
    h.host.type('my own words');
    await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 });
    const id = result(h).confirm?.confirmationId as string;
    expect(await h.dispatch({ type: 'AnswerConfirm', confirmationId: id, choice: 'cancel' })).toMatchObject({ ok: true, outcome: 'noop' });
    expect(h.fake.calls.inserts).toHaveLength(0);
    expect(result(h).confirm).toBeNull();
    expect(partsOf(h)[0]).toMatchObject({ insert: 'idle' });
  });

  it('a draft that changed after the question voids the consent: the question is asked again about the new revision', async () => {
    const h = await start();
    const opId = await reply(h, 'the answer');
    h.host.type('my own words');
    await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 });
    const first = result(h).confirm?.confirmationId as string;
    h.host.type('my own words, more');
    await h.settle();
    const again = await h.dispatch({ type: 'AnswerConfirm', confirmationId: first, choice: 'replace' });
    expect(again).toMatchObject({ ok: true, outcome: 'needs-confirm' });
    expect(h.fake.calls.inserts).toHaveLength(0);
    const second = result(h).confirm;
    expect(second).toMatchObject({ kind: 'draft-changed' });
    expect(second?.confirmationId).not.toBe(first);
    expect(await h.dispatch({ type: 'AnswerConfirm', confirmationId: second?.confirmationId as string, choice: 'replace' })).toMatchObject({ ok: true, outcome: 'done' });
    expect(h.fake.calls.inserts[0]).toMatchObject({ mode: 'replace', expected: { draftRevision: 6 } });
    // The used answer cannot write twice.
    await expect(h.dispatch({ type: 'AnswerConfirm', confirmationId: second?.confirmationId as string, choice: 'replace' })).rejects.toThrow(/no controller took/);
  });

  it('without an observed editor anything in the field needs consent, and the question warns about formatting', async () => {
    const h = await start();
    const opId = await reply(h, 'the answer');
    h.host.setCapability('draftRead', { state: 'degraded', reason: 'editor' });
    h.host.type('typed');
    await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 });
    expect(result(h).confirm).toMatchObject({ kind: 'human-draft', formatLoss: true });
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

  it('MAIN found another draft than the intent was built on: nothing was written, the question is asked', async () => {
    const h = await start({}, { insert: [{ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-changed-draft' }] });
    const opId = await reply(h, 'one');
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: true, outcome: 'needs-confirm' });
    expect(result(h).confirm).toMatchObject({ kind: 'draft-changed' });
    expect(partsOf(h)[0]).toMatchObject({ insert: 'idle' });
  });

  it('a token the background refused writes nothing', async () => {
    const h = await start({}, { redeem: [false] });
    const opId = await reply(h, 'one');
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-INSERT-FAILED' });
    expect(h.fake.calls.inserts).toHaveLength(0);
    expect(h.host.draftOf(openChat)?.plainText).toBe('');
  });

  it('nothing is inserted from a result that is still streaming or failed', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, delta('hey'), { kind: 'stall' }] });
    const receipt = await h.generate('reply');
    await h.clock.advance(100);
    expect(await h.dispatch({ type: 'InsertPart', operationId: (receipt as { opId: string }).opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-OUTPUT-UNUSABLE' });
    expect(h.fake.calls.inserts).toHaveLength(0);
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

describe('dock: Fix', () => {
  const withDraft = async (answers: HostAnswers = {}): Promise<Harness & { fake: FakeHostPort }> => {
    const h = await start({}, answers);
    h.host.type('i mis you so much');
    await h.settle();
    return h;
  };

  it('[AI-020] [AI-025] Fix rewrites the draft it read; its stream is not shown, only the stage line', async () => {
    const h = await withDraft();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('improve-draft') }, delta('I miss '), delta('you so much', 200), doneStep] });
    const receipt = await h.generate('fix');
    expect(receipt).toMatchObject({ ok: true, outcome: 'started' });
    expect((h.bg.callsOf('op.start')[0] as { draft: unknown; window: number }).draft).toEqual({ text: 'i mis you so much', revision: 5, digest: 'feedbeef00000005' });
    expect(h.bg.hub.streams[0]).toMatchObject({ feature: 'improve-draft', body: { draftText: 'i mis you so much', messageCount: 25 } });
    await h.clock.advance(100);
    expect(result(h)).toMatchObject({ state: 'streaming', streamText: null });
    expect(result(h).phase).not.toBeNull();
    await h.finish();
    const vm = result(h);
    expect(vm.parts?.map((part) => part.text)).toEqual(['I miss you so much']);
    expect(vm.meta[0]).toEqual({ key: 'result.meta.byYourDraft' });
    expect(vm.fix).toEqual({ sourceDraft: 'i mis you so much', canReplace: true, replaceReason: null, replaced: false, restoreUntil: null, restoreExpired: false });
    expect(vm.draftNotSent).toBe(true);
  });

  it('[AI-022] «Заменить мой черновик» is the consent for the source revision: one CAS, no second question', async () => {
    const h = await withDraft();
    h.script(h.streamOf('improve-draft', ['I miss you so much']));
    const receipt = await h.generate('fix');
    await h.finish();
    const opId = (receipt as { opId: string }).opId;
    expect(await h.dispatch({ type: 'ReplaceMyDraft', operationId: opId, part: 0 })).toMatchObject({ ok: true, outcome: 'done' });
    const intent = h.fake.calls.inserts[0];
    expect(intent).toMatchObject({ mode: 'replace', text: 'I miss you so much', expected: { draftRevision: 5, draftDigest: 'feedbeef00000005' } });
    expect(intent?.confirmationId).toMatch(/^[0-9a-f-]{36}$/);
    const vm = result(h);
    expect(vm.fix).toMatchObject({ replaced: true, canReplace: false, restoreUntil: NOW_MS + 5_000 + 30_000, restoreExpired: false });
    expect(vm).toMatchObject({ draftNotSent: false, canRegenerate: false, confirm: null });
    expect(h.host.draftOf(openChat)?.plainText).toBe('I miss you so much');
  });

  it('[AI-022] «Вернуть мой текст» works for 30 seconds, as a CAS on the revision the replacement produced', async () => {
    const h = await withDraft();
    h.script(h.streamOf('improve-draft', ['I miss you so much']));
    const receipt = await h.generate('fix');
    await h.finish();
    const opId = (receipt as { opId: string }).opId;
    await h.dispatch({ type: 'ReplaceMyDraft', operationId: opId, part: 0 });
    expect(await h.dispatch({ type: 'RestoreMyDraft', operationId: opId })).toMatchObject({ ok: true, outcome: 'done' });
    expect(h.fake.calls.inserts[1]).toMatchObject({ mode: 'replace', text: 'i mis you so much', confirmationId: null, expected: { draftRevision: 6, draftDigest: 'feedbeef0000aaaa' } });
    expect(h.host.draftOf(openChat)?.plainText).toBe('i mis you so much');
    expect(result(h).fix).toMatchObject({ replaced: true, restoreUntil: null });
  });

  it('after 30 seconds the text cannot be brought back, and the view says so by itself', async () => {
    const h = await withDraft();
    h.script(h.streamOf('improve-draft', ['I miss you so much']));
    const receipt = await h.generate('fix');
    await h.finish();
    const opId = (receipt as { opId: string }).opId;
    await h.dispatch({ type: 'ReplaceMyDraft', operationId: opId, part: 0 });
    let notified = 0;
    h.ai.dock.subscribe({ of: 'dock' }, () => (notified += 1));
    await h.clock.advance(30_001);
    expect(notified).toBeGreaterThan(0);
    expect(result(h).fix).toMatchObject({ restoreUntil: null, restoreExpired: true });
    expect(await h.dispatch({ type: 'RestoreMyDraft', operationId: opId })).toMatchObject({ ok: false, code: 'CG-TIMEOUT' });
    expect(h.fake.calls.inserts).toHaveLength(1);
  });

  it('the draft changed while Fix was generating: the consent is void, the person is asked', async () => {
    const h = await withDraft();
    h.script(h.streamOf('improve-draft', ['I miss you so much']));
    const receipt = await h.generate('fix');
    await h.finish();
    h.host.type('i mis you so much!!');
    await h.settle();
    const opId = (receipt as { opId: string }).opId;
    expect(await h.dispatch({ type: 'ReplaceMyDraft', operationId: opId, part: 0 })).toMatchObject({ ok: true, outcome: 'needs-confirm' });
    expect(h.fake.calls.inserts).toHaveLength(0);
    const confirm = result(h).confirm;
    expect(confirm).toMatchObject({ kind: 'draft-changed' });
    await h.dispatch({ type: 'AnswerConfirm', confirmationId: confirm?.confirmationId as string, choice: 'replace' });
    expect(h.fake.calls.inserts[0]).toMatchObject({ mode: 'replace', text: 'I miss you so much', expected: { draftRevision: 6 } });
    expect(result(h).fix).toMatchObject({ replaced: true });
  });

  it('a replacement of a draft that changed meanwhile: «Вернуть мой текст» brings back the text that was replaced, not the older source', async () => {
    const h = await withDraft();
    h.script(h.streamOf('improve-draft', ['I miss you so much']));
    const receipt = await h.generate('fix');
    await h.finish();
    const opId = (receipt as { opId: string }).opId;
    h.host.type('i mis you so much — and I added a whole new thought here');
    await h.settle();
    await h.dispatch({ type: 'ReplaceMyDraft', operationId: opId, part: 0 });
    await h.dispatch({ type: 'AnswerConfirm', confirmationId: result(h).confirm?.confirmationId as string, choice: 'replace' });
    expect(h.host.draftOf(openChat)?.plainText).toBe('I miss you so much');
    expect(result(h).fix).toMatchObject({ replaced: true, sourceDraft: 'i mis you so much' });
    expect(result(h).fix?.restoreUntil).not.toBeNull();
    expect(await h.dispatch({ type: 'RestoreMyDraft', operationId: opId })).toMatchObject({ ok: true, outcome: 'done' });
    expect(h.host.draftOf(openChat)?.plainText).toBe('i mis you so much — and I added a whole new thought here');
    // The Fix text is no longer in the field: its part is not «вставлено» any more, and nothing is left «вставляю…».
    expect(partsOf(h)[0]).toMatchObject({ insert: 'idle', collapsed: false });
  });

  it('a double click on «Заменить мой черновик» or «Вернуть мой текст» is one write', async () => {
    const h = await withDraft();
    h.script(h.streamOf('improve-draft', ['I miss you so much']));
    const receipt = await h.generate('fix');
    await h.finish();
    const opId = (receipt as { opId: string }).opId;
    const replace = { type: 'ReplaceMyDraft', operationId: opId, part: 0 } as const;
    const replaced = await Promise.all([h.dispatch(replace), h.dispatch(replace)]);
    expect(replaced.map((r) => (r.ok ? r.outcome : r.code))).toEqual(['done', 'noop']);
    expect(h.host.inserts).toBe(1);
    const restore = { type: 'RestoreMyDraft', operationId: opId } as const;
    const restored = await Promise.all([h.dispatch(restore), h.dispatch(restore)]);
    expect(restored.map((r) => (r.ok ? r.outcome : r.code))).toEqual(['done', 'noop']);
    expect(h.host.inserts).toBe(2);
    expect(h.host.draftOf(openChat)?.plainText).toBe('i mis you so much');
  });

  it('the person typed after the replacement: «Вернуть мой текст» asks instead of overwriting silently', async () => {
    const h = await withDraft();
    h.script(h.streamOf('improve-draft', ['I miss you so much']));
    const receipt = await h.generate('fix');
    await h.finish();
    const opId = (receipt as { opId: string }).opId;
    await h.dispatch({ type: 'ReplaceMyDraft', operationId: opId, part: 0 });
    h.host.type('I miss you so much, babe');
    await h.settle();
    expect(await h.dispatch({ type: 'RestoreMyDraft', operationId: opId })).toMatchObject({ ok: true, outcome: 'needs-confirm' });
    expect(h.fake.calls.inserts).toHaveLength(1);
    expect(result(h).confirm).toMatchObject({ kind: 'draft-changed' });
  });

  it('without an observed editor «Заменить мой черновик» is off with its reason; copy is the way', async () => {
    const h = await withDraft();
    h.script(h.streamOf('improve-draft', ['I miss you so much']));
    const receipt = await h.generate('fix');
    await h.finish();
    h.host.setCapability('draftRead', { state: 'degraded', reason: 'editor' });
    await h.settle();
    expect(result(h).fix).toMatchObject({ canReplace: false });
    expect(result(h).fix?.replaceReason?.id).toBe('draft-unverifiable');
    expect(await h.dispatch({ type: 'ReplaceMyDraft', operationId: (receipt as { opId: string }).opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-HOST-NOT-READY' });
    expect(h.fake.calls.inserts).toHaveLength(0);
  });

  it('[AI-023] «Ещё раз» rewrites the same source draft, whatever the field holds now', async () => {
    const h = await withDraft();
    h.script(h.streamOf('improve-draft', ['first rewrite']));
    const receipt = await h.generate('fix');
    await h.finish();
    h.host.type('something else entirely');
    await h.settle();
    h.script(h.streamOf('improve-draft', ['second rewrite']));
    await h.dispatch({ type: 'Regenerate', operationId: (receipt as { opId: string }).opId });
    await h.finish();
    expect(h.bg.hub.streams[1]?.body.draftText).toBe('i mis you so much');
    expect(result(h).fix?.sourceDraft).toBe('i mis you so much');
  });

  it('[AI-024] the same draft and the same Split reopen the result; another draft is a new generation', async () => {
    const h = await withDraft();
    h.script(h.streamOf('improve-draft', ['rewrite']));
    const first = await h.generate('fix');
    await h.finish();
    await h.dispatch({ type: 'HideResult', operationId: (first as { opId: string }).opId });
    const again = await h.generate('fix');
    expect(again).toMatchObject({ ok: true, outcome: 'noop', opId: (first as { opId: string }).opId });
    expect(h.bg.hub.streams).toHaveLength(1);
    expect(result(h).cachedAt).not.toBeNull();
    h.host.type('another draft');
    await h.settle();
    h.script(h.streamOf('improve-draft', ['another rewrite']));
    const third = await h.generate('fix');
    await h.finish();
    expect(third).toMatchObject({ ok: true, outcome: 'started' });
    expect((third as { opId: string }).opId).not.toBe((first as { opId: string }).opId);
  });
});

describe('dock: copy', () => {
  it('[UI-025] «Копировать» marks the part and reports `copied` only after the clipboard write succeeded', async () => {
    const h = await start();
    const opId = await reply(h, 'one [NEXT] two', { split: true });
    const handle = partsOf(h)[1]?.copyHandle as string;
    expect(readArtifactHandle(handle)).toEqual({ kind: 'part', opId, variant: null, index: 1 });
    expect(await h.dispatch({ type: 'Copy', artifactHandle: handle })).toMatchObject({ ok: true, type: 'Copy' });
    expect(h.clipboard.texts).toEqual(['two']);
    expect(partsOf(h)[1]).toMatchObject({ copy: 'done', copyError: null });
    expect(h.bg.callsOf('op.reportCopy')).toEqual([{ opId, part: { index: 1 } }]);
    // The mark goes back by itself after two seconds.
    await h.clock.advance(2_000);
    expect(partsOf(h)[1]?.copy).toBe('idle');
  });

  it('[UI-025] a clipboard the browser refuses: the error on the part, nothing reported as copied', async () => {
    const h = await start();
    await reply(h, 'one');
    h.clipboard.fail = true;
    const receipt = await h.dispatch({ type: 'Copy', artifactHandle: partsOf(h)[0]?.copyHandle as string });
    expect(receipt).toMatchObject({ ok: false, code: 'CG-CLIPBOARD' });
    expect(partsOf(h)[0]).toMatchObject({ copy: 'failed' });
    expect(partsOf(h)[0]?.copyError?.code).toBe('CG-CLIPBOARD');
    expect(h.bg.callsOf('op.reportCopy')).toEqual([]);
  });

  it('a handle that names nothing of ours is not taken', async () => {
    const h = await start();
    await expect(h.dispatch({ type: 'Copy', artifactHandle: 'prompt:1' })).rejects.toThrow(/no controller took/);
    expect(await h.dispatch({ type: 'Copy', artifactHandle: `part:${uuid(0xdead)}:-:0` })).toMatchObject({ ok: false, code: 'CG-CLIPBOARD' });
  });
});

describe('dock: hide, the result cache, the keys footer', () => {
  it('[AI-128] «Скрыть» keeps the result: the same click reopens it with the time it was made, without a new generation', async () => {
    const h = await start();
    const opId = await reply(h, 'cached answer');
    expect(await h.dispatch({ type: 'HideResult', operationId: opId })).toMatchObject({ ok: true });
    expect(h.dock().result).toBeNull();
    expect(h.dock().actions.reply.active).toBe(false);
    await h.clock.advance(60_000);
    const again = await h.generate('reply');
    expect(again).toMatchObject({ ok: true, outcome: 'noop', opId });
    expect(h.bg.hub.streams).toHaveLength(1);
    // The time is when the result was made, not when it was reopened.
    expect(result(h)).toMatchObject({ opId, state: 'done', cachedAt: NOW_MS + 20 });
    expect(partsOf(h).map((part) => part.text)).toEqual(['cached answer']);
  });

  it('[AI-128] other parameters are a new generation, not the cached one', async () => {
    const h = await start();
    const first = await reply(h, 'plain');
    const second = await reply(h, 'with a tone', { tone: 'casual' });
    expect(second).not.toBe(first);
    expect(result(h).cachedAt).toBeNull();
    expect(h.bg.hub.streams).toHaveLength(2);
  });

  it('a result of another tab session for this chat is found when the chat opens (results live 30 minutes in the background)', async () => {
    const h = await start();
    // Another tab generated a reply for the same chat a moment ago.
    h.script(h.streamOf('fast-reply', ['from the other tab']));
    const other = h.bg.rpc(OTHER_TAB);
    const token = await other.request('token.issue', { kind: 'generate', surface: 'dock' });
    if (!token.ok) throw new Error('token');
    const startOp = h.bg.callsOf('op.start');
    expect(startOp).toEqual([]);
    const target = (await other.request('binding.resolve', { account: hostAccount })) as { ok: true; payload: { binding: OpView['target']['binding'] } };
    await other.request('op.start', {
      feature: 'reply',
      surface: 'dock',
      target: { binding: target.payload.binding, chat: openChat, fanRef: HOST_IDS.fan, conversationRef: HOST_IDS.fan },
      cause: { kind: 'click', actionToken: token.payload.actionToken },
      tone: null,
      split: false,
      window: 100,
      // The same page, so the same visible tail went with it.
      fresh: (memory.tails[0] as (typeof memory.tails)[number]).tail,
    });
    await h.finish();
    // The same click in this tab reopens that result: nothing new is generated.
    const receipt = await h.generate('reply');
    expect(receipt).toMatchObject({ ok: true, outcome: 'noop' });
    expect(h.bg.hub.streams).toHaveLength(1);
    expect(partsOf(h).map((part) => part.text)).toEqual(['from the other tab']);
    expect(result(h).cachedAt).not.toBeNull();
  });

  it('«Развернуть» is a state of the result the views share', async () => {
    const h = await start();
    const opId = await reply(h);
    expect(result(h).expanded).toBe(false);
    expect(await h.dispatch({ type: 'ExpandResult', operationId: opId, expanded: true })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(result(h).expanded).toBe(true);
    await h.dispatch({ type: 'ExpandResult', operationId: opId, expanded: false });
    expect(result(h).expanded).toBe(false);
  });

  it('the keys footer goes under the first five results, then no more; «Скрыть» ends it at once', async () => {
    const h = await start();
    const tones = ['casual', 'flirty', 'upsell', 'spicy'] as const;
    for (let n = 1; n <= KEYS_FOOTER_RESULTS; n += 1) {
      // Every one a new request: the same parameters would only reopen a result.
      await reply(h, `answer ${n}`, { tone: tones[n % 4] as (typeof tones)[number], split: n > 4 });
      expect(h.dock().keysFooter, `result ${n}`).toBe(true);
      expect(h.bg.settings.settings.onboarding.keysFooter.shown).toBe(n);
    }
    await reply(h, 'the sixth', { tone: 'upsell', split: true });
    expect(h.dock().keysFooter).toBe(false);
    expect(h.bg.settings.settings.onboarding.keysFooter.shown).toBe(KEYS_FOOTER_RESULTS);

    const other = await start();
    await reply(other);
    expect(other.dock().keysFooter).toBe(true);
    expect(await other.dispatch({ type: 'SetPreference', key: 'onboarding.keysFooter.dismissed', value: true })).toMatchObject({ ok: true });
    expect(other.dock().keysFooter).toBe(false);
    expect(other.bg.settings.settings.onboarding.keysFooter).toEqual({ shown: 1, dismissed: true });
  });

  it('a preference that is not the dock\'s is not taken', async () => {
    const h = await start();
    await expect(h.dispatch({ type: 'SetPreference', key: 'ui.hints', value: false })).rejects.toThrow(/no controller took/);
  });
});

describe('dock: a refused start and what runs elsewhere', () => {
  const stall = (feature: Parameters<typeof meta>[0] = 'fast-reply'): ScriptResponse => ({ kind: 'stream', steps: [{ kind: 'frame', frame: meta(feature) }, { kind: 'stall' }] });
  const fans = ['2101', '2102', '2103'];

  it('[AI-123] a fourth generation in the tab is refused with the list of the three that run', async () => {
    const h = await start();
    const opIds: string[] = [];
    for (const fan of fans) {
      const chat = { ...openChat, platformFanId: fan };
      h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), chat }, chat);
      h.host.setFan({ ...(memory.fans[0] as (typeof memory.fans)[number]), chat, displayName: `Fan ${fan}` });
      h.host.openChat(chat);
      await h.settle();
      h.script(stall());
      const receipt = await h.generate('reply');
      opIds.push((receipt as { opId: string }).opId);
    }
    h.host.openChat(openChat);
    await h.settle();
    expect(h.dock().runningElsewhere.map((op) => op.opId).sort()).toEqual([...opIds].sort());

    const refused = await h.generate('reply');
    expect(refused).toMatchObject({ ok: false, code: 'CG-OP-TAB-LIMIT' });
    expect((refused as { running?: unknown[] }).running).toHaveLength(3);
    const vm = h.dock();
    expect(vm.result).toBeNull();
    expect(vm.refusal?.feature).toBe('reply');
    expect(vm.refusal?.error.code).toBe('CG-OP-TAB-LIMIT');
    expect(vm.refusal?.running.map((op) => op.fanLabel)).toEqual(['Fan 2101', 'Fan 2102', 'Fan 2103']);
    expect(vm.refusal?.running[0]).toMatchObject({
      inThisTab: true,
      feature: 'reply',
      go: { type: 'Navigate', to: { kind: 'chat', targetHandle: targetHandle('dock', { ...openChat, platformFanId: '2101' }) } },
      cancel: { type: 'CancelGeneration', operationId: opIds[0] },
    });
    expect(readTargetHandle((vm.refusal?.running[0]?.go as { to: { targetHandle: string } }).to.targetHandle)?.chat.platformFanId).toBe('2101');
    // No queue: nothing started by itself; canceling one frees a slot and clears the list.
    expect(h.bg.callsOf('op.start')).toHaveLength(4);
    await h.dispatch(vm.refusal?.running[0]?.cancel as never);
    expect(h.dock().refusal).toBeNull();
    h.script(h.streamOf('fast-reply', ['now it runs']));
    expect(await h.generate('reply')).toMatchObject({ ok: true, outcome: 'started' });
  });

  it('[AI-123] the chat is busy in another tab: the refusal says so and names what runs', async () => {
    const h = await start();
    h.script(stall());
    const other = h.bg.rpc(OTHER_TAB);
    const token = await other.request('token.issue', { kind: 'generate', surface: 'dock' });
    const target = await other.request('binding.resolve', { account: hostAccount });
    if (!token.ok || !target.ok) throw new Error('setup');
    await other.request('op.start', {
      feature: 'ping',
      surface: 'dock',
      target: { binding: target.payload.binding, chat: openChat, fanRef: HOST_IDS.fan, conversationRef: HOST_IDS.fan },
      cause: { kind: 'click', actionToken: token.payload.actionToken },
      tone: null,
      split: false,
      window: 100,
    });
    const refused = await h.generate('reply');
    expect(refused).toMatchObject({ ok: false, code: 'CG-OP-CHAT-BUSY' });
    expect(h.dock().refusal?.error.code).toBe('CG-OP-CHAT-BUSY');
    expect(h.dock().refusal?.running).toHaveLength(1);
    expect(h.dock().refusal?.running[0]).toMatchObject({ feature: 'ping', inThisTab: false });
  });
});

describe('dock: quota, stale results, debug', () => {
  it('[UI-031] the quota shows only when it is low; zero turns every AI action off until the day turns', async () => {
    const low = (remaining: number): ScriptResponse => ({
      kind: 'stream',
      steps: [{ kind: 'frame', frame: { ...meta('fast-reply'), quota: { accepted: true, remainingRequestsToday: remaining, remainingMicroUsdToday: null } } }, delta('ok'), doneStep],
    });
    const h = await start();
    expect(h.dock().quota).toBeNull();
    h.script(low(120));
    await h.generate('reply');
    await h.finish();
    expect(h.dock().quota).toBeNull();

    h.script(low(12));
    await h.generate('reply', { tone: 'casual' });
    await h.finish();
    expect(h.dock().quota).toEqual({ remaining: 12, low: true, resetsAt: '2026-10-04T00:00:00.000Z' });
    expect(h.dock().mark).toBe('normal');

    h.script(low(0));
    await h.generate('reply', { tone: 'spicy' });
    await h.finish();
    const zero = h.dock();
    expect(zero.quota).toEqual({ remaining: 0, low: false, resetsAt: '2026-10-04T00:00:00.000Z' });
    expect(zero.mark).toBe('faint');
    expect(zero.actions.reply.reason).toMatchObject({ id: 'quota-zero', code: 'CG-QUOTA-DAILY' });
    expect(result(h)).toMatchObject({ canRegenerate: false });
    expect(result(h).regenerateReason?.id).toBe('quota-zero');
    const refused = await h.generate('reply', { tone: 'flirty' });
    expect(refused).toMatchObject({ ok: false, code: 'CG-QUOTA-DAILY' });
    expect(h.bg.callsOf('op.start')).toHaveLength(3);
  });

  it('a new fan message after the generation marks the result stale; parts can still be inserted in the dock', async () => {
    const h = await start();
    const opId = await reply(h, 'answer');
    expect(result(h).stale).toBeNull();
    h.bg.scheduler.incoming({ host: 'chatspace', hostAccountId: HOST_IDS.acc, platformFanId: HOST_IDS.fan, platformMessageId: '4999', fromFan: true, automatic: false, tip: false, sentAt: '2026-10-03T10:01:00.000Z', socketEpoch: 1, fanSequence: 3, source: 'ws-tap' });
    await h.settle();
    expect(result(h).stale).toEqual({ reason: 'fan-wrote', at: '2026-10-03T10:01:00.000Z' });
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: true });
  });

  it('[UI-030] the debug footer — usage line, stage profile, prompt token — exists only in debug mode', async () => {
    const debugFrame: HubFrame = { type: 'debug_input_v1', systemBlocks: [{ text: 'system', cache: 'none' }], userBlocks: [{ text: 'user', cache: 'none' }], contextManifest: null };
    const script = (): ScriptResponse => ({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply'), afterMs: 300 }, { kind: 'frame', frame: debugFrame }, delta('hey', 100), { kind: 'frame', frame: usage }, doneStep] });

    const plain = await start();
    plain.script(script());
    await plain.generate('reply');
    await plain.finish();
    expect(result(plain).debug).toBeNull();
    expect(JSON.stringify(plain.dock())).not.toMatch(/tok|\$0\.0/);

    const h = await start({ settings: { ...settingsWithPersona(), debug: { enabled: true, renderTrace: false } } });
    h.script(script());
    await h.generate('reply');
    // While it runs only the live timer is known — and only in the expanded view.
    expect(result(h).debug).toMatchObject({ costLine: null, liveTimer: false, prompt: null });
    await h.dispatch({ type: 'ExpandResult', operationId: result(h).opId, expanded: true });
    expect(result(h).debug?.liveTimer).toBe(true);
    await h.finish();
    const debug = result(h).debug;
    // Intl groups digits with no-break spaces.
    expect(debug?.costLine?.replace(/\s/gu, ' ')).toBe('in 3 412 tok • out 286 tok • cache r 3 000 / w 0 • $0.0143 • 0,4 с');
    expect(debug?.stages.map((stage) => stage.name)).toEqual(['запрос', 'meta', 'первый чанк', 'поток', 'разбор']);
    expect(debug?.stages.find((stage) => stage.name === 'meta')?.ms).toBe(300);
    expect(debug?.totalMs).toBe(400);
    expect(debug?.liveTimer).toBe(false);
    // The prompt itself never reaches the tab: no hook kept it in this background, so there is no token either.
    expect(debug?.prompt).toBeNull();
    expect(h.bg.hub.streams[0]?.capabilities).toContain('debug-input-v1');
  });
});

describe('dock: acceptance telemetry hooks', () => {
  it('`shown` is reported once, and only for a finished result that was really visible', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, delta('hey', 100), doneStep] });
    const receipt = await h.generate('reply');
    const opId = (receipt as { opId: string }).opId;
    h.ai.resultShown(opId);
    expect(h.bg.callsOf('op.reportShown')).toEqual([]);
    await h.finish();
    h.ai.resultShown(opId);
    h.ai.resultShown(opId);
    h.ai.resultShown(uuid(0xdead));
    await h.settle();
    expect(h.bg.callsOf('op.reportShown')).toEqual([{ opId }]);
  });

  it('`sent` comes from the host\'s proof: the message id and the insert the draft descends from; `edited` by revision', async () => {
    const h = await start();
    const opId = await reply(h, 'one [NEXT] two', { split: true });
    await h.dispatch({ type: 'InsertPart', operationId: opId, part: 1 });
    const intentId = h.fake.calls.inserts[0]?.intentId as string;
    const fact = { chat: openChat, pendingId: 'pending-1', textDigest: 'feedbeef00000007' };
    // Attribution unknown: no id from the receipt, or a draft that is not ours.
    h.host.humanSend({ ...fact, platformMessageId: null, draft: { revision: 5, provenance: 'our-insert', insertIntentId: intentId, editedSinceInsert: false } });
    h.host.humanSend({ ...fact, platformMessageId: '4101', draft: { revision: 9, provenance: 'human-or-unknown', insertIntentId: null, editedSinceInsert: null } });
    h.host.humanSend({ ...fact, platformMessageId: '4101', draft: { revision: 5, provenance: 'our-insert', insertIntentId: uuid(0xdead), editedSinceInsert: false } });
    await h.settle();
    expect(h.bg.callsOf('op.reportSent')).toEqual([]);
    h.host.humanSend({ ...fact, platformMessageId: '4101', draft: { revision: 6, provenance: 'human-or-unknown', insertIntentId: intentId, editedSinceInsert: true } });
    await h.settle();
    expect(h.bg.callsOf('op.reportSent')).toEqual([{ opId, part: { index: 1 }, pendingId: 'pending-1', platformMessageId: '4101', edited: true }]);
  });

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

describe('dock: keys of the scheme (the early dispatcher asks `command`)', () => {
  it('a key of an enabled action is the action, as a key cause', async () => {
    const h = await start();
    h.script(h.streamOf('fast-reply', ['by key']));
    const outcome = await h.ai.command('reply');
    await h.finish();
    expect(outcome).toMatchObject({ kind: 'dispatched', action: { type: 'Generate', feature: 'reply' }, receipt: { ok: true, outcome: 'started' } });
    expect((h.bg.callsOf('op.start')[0] as { cause: { kind: string } }).cause.kind).toBe('key');
    expect(partsOf(h).map((part) => part.text)).toEqual(['by key']);
  });

  it('[HK-026] a key of an action that is off is swallowed and says why', async () => {
    const h = await start();
    const outcome = await h.ai.command('fix');
    expect(outcome).toMatchObject({ kind: 'hint', reason: { id: 'needs-draft' } });
    expect(h.toasts).toEqual([{ kind: 'info', code: 'CG-GATE-DRAFT', scope: 'dock.hotkey', title: { key: 'dock.action.unavailable', params: { action: 'Fix', reason: 'сначала напишите черновик в поле ввода' } }, body: null }]);
    expect(h.bg.callsOf('op.start')).toEqual([]);
  });

  it('⌘⇧H is swallowed with «Help пока убран»: Help is removed', async () => {
    const h = await start();
    expect(await h.ai.command('help')).toMatchObject({ kind: 'hint', reason: { id: 'help-removed' } });
    expect(h.toasts[0]).toMatchObject({ title: { key: 'dock.helpRemoved' }, scope: 'dock.hotkey' });
    expect(h.bg.calls.filter((call) => call.type === 'op.start')).toEqual([]);
    // There is no Help action and no Help feature to start at all.
    expect(Object.keys(h.dock().actions)).not.toContain('help');
    expect(UiActionSchema.safeParse({ type: 'Generate', targetHandle: h.dock().targetHandle, feature: 'help', options: {} }).success).toBe(false);
  });

  it('[AI-008] the tone key walks no tone → Casual → Flirt → Sell → Spice → no tone and starts nothing', async () => {
    const h = await start();
    const walk: (string | null)[] = [];
    for (let n = 0; n < 6; n += 1) {
      await h.ai.command('tone');
      walk.push(h.dock().options.tone);
    }
    expect(walk).toEqual(['casual', 'flirty', 'upsell', 'spicy', null, 'casual']);
    expect(h.bg.callsOf('op.start')).toEqual([]);
  });

  it('the Split key flips the saved setting; ⌘. cancels what runs in the open chat', async () => {
    const h = await start();
    expect(await h.ai.command('split')).toMatchObject({ kind: 'dispatched', receipt: { ok: true, revision: 2 } });
    expect(h.dock().options.split).toBe(true);
    expect(await h.ai.command('cancel')).toEqual({ kind: 'ignored' });
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, { kind: 'stall' }] });
    await h.generate('reply');
    // AI-009: locked while it runs.
    expect(await h.ai.command('tone')).toMatchObject({ kind: 'hint', reason: { id: 'locked-during-generation' } });
    expect(await h.ai.command('split')).toMatchObject({ kind: 'hint' });
    expect(await h.ai.command('cancel')).toMatchObject({ kind: 'dispatched', action: { type: 'CancelGeneration' }, receipt: { ok: true } });
    await settle();
    expect(h.dock().result).toBeNull();
  });

  it('outside a chat the AI keys are not ours; a key that is not an AI command is ignored', async () => {
    const h = await start();
    expect(await h.ai.command('spenders')).toEqual({ kind: 'ignored' });
    h.host.openChat(null);
    await h.settle();
    expect(await h.ai.command('reply')).toEqual({ kind: 'ignored' });
    expect(h.toasts).toEqual([]);
  });
});

describe('dock: what the background already knows, and a port that came back', () => {
  /** Another tab of the same sign-in starts a Reply for the open chat of the stand. */
  async function otherTabReply(h: Harness): Promise<string> {
    const other = h.bg.rpc(OTHER_TAB);
    const token = await other.request('token.issue', { kind: 'generate', surface: 'dock' });
    const target = await other.request('binding.resolve', { account: hostAccount });
    if (!token.ok || !target.ok) throw new Error('setup');
    const admission = await other.request('op.start', {
      feature: 'reply',
      surface: 'dock',
      target: { binding: target.payload.binding, chat: openChat, fanRef: HOST_IDS.fan, conversationRef: HOST_IDS.fan },
      cause: { kind: 'click', actionToken: token.payload.actionToken },
      tone: null,
      split: false,
      window: 100,
      fresh: (memory.tails[0] as (typeof memory.tails)[number]).tail,
    });
    if (!admission.ok || !admission.payload.ok) throw new Error('not admitted');
    return admission.payload.opId;
  }

  it('[AI-124] coming to a chat reads what the background knows about it: a run of another tab keeps it busy, and its result arrives', async () => {
    const h = await start();
    h.host.openChat(previewChat);
    await h.settle();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, delta('from the other tab', 200), doneStep] });
    const opId = await otherTabReply(h);
    h.host.openChat(openChat);
    await h.settle();
    expect(h.bg.callsOf('op.list')).toContainEqual({ scope: 'tab', chatKey: `${openChat.host}:${openChat.hostAccountId}:${openChat.platformFanId}` });
    const busy = h.dock();
    expect(busy.actions.reply).toMatchObject({ busy: true });
    expect(busy.actions.ping.reason?.id).toBe('chat-busy');
    expect(busy.options.locked).toBe(true);
    // It is not this tab's run: it is not listed as running elsewhere in this tab, and no sheet opened by itself.
    expect(busy.runningElsewhere).toEqual([]);
    expect(busy.result).toBeNull();
    await h.finish();
    expect(h.dock().actions.reply).toMatchObject({ busy: false, enabled: true });
    // The same click reopens that result.
    expect(await h.generate('reply')).toMatchObject({ ok: true, outcome: 'noop', opId });
    expect(partsOf(h).map((part) => part.text)).toEqual(['from the other tab']);
    expect(h.bg.hub.streams).toHaveLength(1);
  });

  it('a port that came back drops nothing of the same sign-in', async () => {
    const h = await start();
    await reply(h, 'kept answer');
    h.bg.setConnection('reconnecting');
    await h.settle();
    h.bg.setConnection('ready');
    await h.settle();
    expect(h.dock().status).toBe('ready');
    expect(partsOf(h).map((part) => part.text)).toEqual(['kept answer']);
    // «Повторить» of a banner reads everything again and keeps the results too.
    await h.dispatch({ type: 'ReloadView', selector: { of: 'dock' } });
    await h.settle();
    expect(partsOf(h).map((part) => part.text)).toEqual(['kept answer']);
  });

  it('what ended while the port was down is read when it comes back', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, delta('finished ', 100), delta('in the gap', 100), doneStep] });
    await h.generate('reply');
    await h.clock.advance(100);
    expect(result(h)).toMatchObject({ state: 'streaming', streamText: 'finished' });
    h.bg.setConnection('reconnecting');
    await h.clock.advance(5_000);
    // The terminal view was emitted into a dead port: the tab still shows the run.
    expect(result(h).state).toBe('streaming');
    h.bg.setConnection('ready');
    await h.settle();
    expect(result(h)).toMatchObject({ state: 'done' });
    expect(partsOf(h).map((part) => part.text)).toEqual(['finished in the gap']);
  });

  it('a run the background no longer knows after the gap is interrupted — nothing spins forever, nothing is repeated by itself', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, { kind: 'stall' }] });
    await h.generate('reply');
    h.bg.setConnection('lost');
    h.bg.opList = { ops: [], truncated: false };
    h.bg.setConnection('ready');
    await h.settle();
    const vm = result(h);
    expect(vm).toMatchObject({ state: 'interrupted', parts: null });
    expect(vm.error?.code).toBe('CG-OP-INTERRUPTED');
    expect(h.dock().actions.reply).toMatchObject({ busy: false });
    expect(h.bg.callsOf('op.start')).toHaveLength(1);
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

  it('a subscriber hears a change once it really changed what it shows; the snapshot is stable in between', async () => {
    const h = await start();
    const seen: DockVM[] = [];
    const off = h.ai.dock.subscribe({ of: 'dock' }, (view) => seen.push(view as DockVM));
    const before = h.dock();
    expect(h.dock()).toBe(before);
    // A change that does not touch the dock (another chat's cache) notifies nobody.
    h.host.setTail(previewChat, null);
    await h.settle();
    expect(seen).toEqual([]);
    expect(h.dock()).toBe(before);
    h.host.type('typing');
    await h.settle();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.actions.fix.enabled).toBe(true);
    off();
    h.host.type('');
    await h.settle();
    expect(seen).toHaveLength(1);
  });

  it('the language switches on the fly: errors and reasons are rendered again', async () => {
    const h = await start({ session: null });
    expect(h.dock().statusError?.title).toBe('Нужно войти');
    const i18n = h.ai.workspace.ports.i18n as unknown as { setLanguage(language: 'en'): void };
    i18n.setLanguage('en');
    await h.settle();
    expect(h.dock().statusError?.title).not.toBe('Нужно войти');
  });

  it('every action the dock view offers is a valid UiAction', async () => {
    const h = await start();
    await reply(h, 'one [NEXT] two', { split: true });
    const actions: unknown[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) {
        const record = value as Record<string, unknown>;
        if (typeof record['type'] === 'string' && /^[A-Z]/.test(record['type'])) actions.push(record);
        Object.values(record).forEach(walk);
      }
    };
    walk(h.dock());
    for (const action of actions) expect(UiActionSchema.safeParse(action).success, JSON.stringify(action)).toBe(true);
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
