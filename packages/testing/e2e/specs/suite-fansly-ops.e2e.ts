// P8e: the real dock's parallel generations, refusal list, toasts and guarded inserts on Fansly's stand.
// P12a: no voice panel yet. The TEST-only loopback probe calls its real
// application/RPC port; the extension, scheduler, journal and SDK are real.
import { browser, expect } from '@wdio/globals';
import { TAB_PROTOCOL_VERSION, type Admission, type SiteOpView } from '@cg/contracts';
import { WORLD, meta } from '../../src/scenarios/hub';
import { dockIs } from '../support/shift';
import { readReport, waitForReport } from '../support/extension';
import { useFakeHub } from '../support/fake-hub';
import { openWithNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { startFanslyShift, type FanslyShift } from '../support/fansly-shift';
import { callFansly, fakeFansly, fanslyIds } from '../support/fansly-stand';
import { focusTab } from '../support/focus';
import { useNetworkTrap } from '../support/network-trap';
import { pressOurs, readOurs, waitOursByText } from '../support/ours';

const A = WORLD.fansly.chats.a;
const B = WORLD.fansly.chats.b;
let seq = 0;
type Answer<T> = { ok: true; payload: T } | { ok: false; error: { code: string } };
async function command<T>(input: { op: 'start' | 'read' | 'cancel' | 'list'; feature?: string; opId?: string; draft?: string }): Promise<T> {
  const id = `ops-${++seq}`;
  await browser.execute((raw) => document.documentElement.setAttribute('data-cg-ops-command', raw), JSON.stringify({ id, ...input }));
  let answer: Answer<T> | undefined;
  await browser.waitUntil(async () => {
    const report = (await readReport())?.['siteOps'] as { id?: string; answer?: Answer<T>; error?: string } | undefined;
    if (report?.error !== undefined) throw new Error(report.error);
    if (report?.id !== id) return false;
    answer = report.answer;
    return answer !== undefined;
  }, { timeout: 20_000, timeoutMsg: `${input.op}: operation port did not answer` });
  if (answer === undefined || !answer.ok) throw new Error(`operation port: ${JSON.stringify(answer)}`);
  return answer.payload;
}
const opOf = (value: Admission): string => { if (!value.ok) throw new Error(value.code); return value.opId; };
const read = (opId: string): Promise<{ view: SiteOpView | null }> => command({ op: 'read', opId });
async function done(opId: string): Promise<SiteOpView> {
  const held: { view: SiteOpView | null } = { view: null };
  await browser.waitUntil(async () => { held.view = (await read(opId)).view; return held.view?.state === 'done' || held.view?.state === 'failed'; }, { timeout: 30_000, timeoutMsg: 'site operation did not finish' });
  if (held.view === null) throw new Error('no site view');
  expect(held.view.state).toBe('done');
  return held.view;
}
async function open(group: string, fan: string): Promise<void> {
  await callFansly('open', group, 'router');
  await dockIs((dock) => dock.status === 'ready' && dock.target?.endsWith(`:${fan}`) === true, 'ready in the operation’s chat', 20_000);
}

describe('Fansly site operations share Reply’s admission (R20 P12a)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    await startFanslyShift(hub(), { path: `/messages/${A.group}`, viewport: { width: 1440, height: 900 } });
    await dockIs((dock) => dock.status === 'ready' && dock.actions['reply'] === true, 'the Fansly dock is ready', 20_000);
  });
  after(async () => { await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0 } }); });

  it('[AI-111] voice-script: the port returns a completed script and its source; the real fake hub accepts group ≠ fan and no clientContext', async () => {
    const mark = await hub().mark();
    const op = opOf(await command<Admission>({ op: 'start', feature: 'voice-script', draft: 'A synthetic draft.' }));
    const view = await done(op);
    expect(view.result).toEqual({ kind: 'voice-script', script: '[warmly] Hey you, it is lovely to hear from you.' });
    expect(view.generationRef).toBeTruthy();
    expect([view.target.conversationRef, view.target.fanRef]).toEqual([A.group, A.fan]);
    const streams = (await hub().journal(mark)).entries.filter((entry) => entry.route === 'aiFeatureStream');
    expect(streams.map((entry) => entry.status)).toEqual([200]);
    const request = streams[0]?.request as { feature: string; body: Record<string, unknown> };
    expect(request.feature).toBe('voice-script');
    expect([request.body['conversationRef'], request.body['fanRef'], 'clientContext' in request.body, 'liveTextContext' in request.body]).toEqual([A.group, A.fan, false, false]);
  });

  it('one chat: a script blocks Reply and notes; explicit cancellation frees the shared slot and keeps the canceled state', async () => {
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 1000 } });
    const op = opOf(await command<Admission>({ op: 'start', feature: 'voice-script' }));
    for (const feature of ['reply', 'notes-fill']) {
      expect(await command<Admission>({ op: 'start', feature })).toMatchObject({ ok: false, code: 'CG-OP-CHAT-BUSY', active: [], siteActive: [{ opId: op, feature: 'voice-script' }] });
    }
    expect(await command({ op: 'cancel', opId: op })).toEqual({ state: 'canceled' });
    expect((await read(op)).view?.state).toBe('canceled');
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
    const next = opOf(await command<Admission>({ op: 'start', feature: 'notes-fill' }));
    expect((await done(next)).result?.kind).toBe('note-fields');
  });

  it('different chats: script and notes run together, changing chats never cancels either; the original group/fan pairs stay fixed', async () => {
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 1000 } });
    const mark = await hub().mark();
    const script = opOf(await command<Admission>({ op: 'start', feature: 'voice-script' }));
    await open(B.group, B.fan);
    const notes = opOf(await command<Admission>({ op: 'start', feature: 'notes-fill' }));
    expect(await command<Admission>({ op: 'start', feature: 'reply' })).toMatchObject({ ok: false, code: 'CG-OP-CHAT-BUSY' });
    const scriptView = await done(script);
    const notesView = await done(notes);
    expect([scriptView.target.conversationRef, notesView.target.conversationRef]).toEqual([A.group, B.group]);
    const streams = (await hub().journal(mark)).entries.filter((entry) => entry.route === 'aiFeatureStream');
    expect(streams.map((entry) => entry.status)).toEqual([200, 200]);
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
    await open(A.group, A.fan);
  });
});

describe('Fansly parallel generations through the shared core (R20 P8e)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: FanslyShift;
  const gates: string[] = [];
  const ops: string[] = [];
  let chats: { group: string; fan: string; name: string; text: string }[] = [];

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    shift = await startFanslyShift(hub(), { path: `/messages/${A.group}`, viewport: { width: 1440, height: 900 } });
    const ids = await fanslyIds();
    chats = ids.groups.slice(0, 4).map((group, index) => ({ group, fan: ids.fans[group] ?? '', name: `Stand Fan ${index + 1}`, text: `Reply only for fan ${index + 1}.` }));
    expect(chats).toHaveLength(4);
    for (const chat of chats) await hub().command({ op: 'thread', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: chat.group, fanRef: chat.fan });
    await open(A.group, A.fan);
  });
  afterEach(async () => {
    for (const gate of gates.splice(0)) await hub().command({ op: 'release', gate });
    for (const opId of ops.splice(0)) await command({ op: 'cancel', feature: 'reply', opId });
    await hub().command({ op: 'clearScripts' });
  });

  const composer = async () => {
    const found = (await callFansly('composers')).find((field) => field.place === 'main' && field.connected);
    if (found === undefined) throw new Error('no main composer');
    return found;
  };
  const holdReply = async (gate: string, text: string): Promise<void> => {
    gates.push(gate);
    await hub().command({ op: 'scriptSse', feature: 'fast-reply', responses: [{ kind: 'stream', steps: [
      { kind: 'frame', frame: meta('fast-reply', { pageLabel: WORLD.pages.fansly.pageLabel }) }, { kind: 'gate', name: gate },
      { kind: 'frame', frame: { type: 'content_delta', text } },
      { kind: 'frame', frame: { type: 'done', stopReason: 'end_turn' } }, { kind: 'eof' },
    ] }] });
  };

  it('[AI-123] [AI-124] [ER-014] three chats at once, the fourth refused with its busy-chat list; a toast opens its own group and each result inserts only there', async function () {
    this.timeout(120_000);
    const running = chats.slice(0, 3);
    const fourth = chats[3];
    if (fourth === undefined) throw new Error('no fourth chat');
    const mark = await hub().mark();
    for (const [index, chat] of running.entries()) {
      await open(chat.group, chat.fan);
      await holdReply(`p8e-${index}`, chat.text);
      await pressOurs('dock', '.cg-strip button', /^Reply/);
      const shown = await dockIs((dock) => dock.result?.feature === 'reply' && dock.result.state === 'streaming', 'Reply is running in its chat');
      if (shown.result === null) throw new Error('no operation');
      ops.push(shown.result.opId);
    }
    await open(fourth.group, fourth.fan);
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    const refused = await dockIs((dock) => dock.refusal === 'CG-OP-TAB-LIMIT', 'the fourth start is refused');
    expect(refused.refusalRunning).toEqual(ops);
    expect(await readOurs('dock', '.cg-ops', (node) => Array.from(node.querySelectorAll('.cg-op__fan'), (fan) => fan.textContent))).toEqual(running.map(({ name }) => name));

    // The existing refusal's «Перейти» carries the group's id, without adding a new surface.
    const first = running[0];
    if (first === undefined) throw new Error('no first chat');
    await pressOurs('dock', `[data-cg-op="${ops[0]}"] button`, /^Перейти$/);
    await dockIs((dock) => dock.target?.endsWith(`:${first.fan}`) === true && dock.result?.opId === ops[0], 'the refusal opens the running chat');
    expect((await callFansly('route')).groupId).toBe(first.group);
    await open(fourth.group, fourth.fan);
    // Dock readiness precedes the coalesced tab.presence report (200 ms). Until
    // the background sees the fourth group it can suppress the first result's
    // toast as belonging to the open chat. Read diagnostics in the other page
    // without activating it, so this wait does not change visibility/presence.
    await browser.waitUntil(async () => {
      const result = await browser.scriptCallFunction({
        target: { context: shift.pagesTab }, awaitPromise: true,
        functionDeclaration: `async (version, group) => {
          const answer = await browser.runtime.sendMessage({ v: version, kind: 'req', id: 1, type: 'diagnostics.get', payload: {} });
          if (!answer.ok) throw new Error(JSON.stringify(answer.error));
          return answer.payload.tabs.some((tab) => tab.conversationRef === group);
        }`,
        arguments: [{ type: 'number', value: TAB_PROTOCOL_VERSION }, { type: 'string', value: fourth.group }],
      });
      if (result.type !== 'success') throw new Error(`presence diagnostics: ${JSON.stringify(result.exceptionDetails)}`);
      return result.result.type === 'boolean' && result.result.value;
    }, { timeout: 15_000, interval: 100, timeoutMsg: 'the background did not observe the fourth group before completing Replies' });
    const handle = (chat: (typeof chats)[number]) => `nav.chat.${WORLD.pages.fansly.platformAccountId}.${chat.fan}.${chat.group}`;
    // ER-010: the same code/scope replaces the previous toast. Complete out of order,
    // observing each result's own group before the next completion can replace its toast.
    for (const index of [1, 0, 2]) {
      const chat = running[index];
      const gate = gates[index];
      if (chat === undefined || gate === undefined) throw new Error('no held Reply');
      await hub().command({ op: 'release', gate });
      const report = await waitForReport((now) => now.toasts?.some((toast) => toast.chats.includes(handle(chat))) === true, `the background result names group ${chat.group}`);
      expect(report.toasts?.filter((toast) => toast.chats.length > 0).map(({ kind, chats }) => ({ kind, chats }))).toEqual([
        { kind: 'success', chats: [handle(chat)] },
      ]);
      expect((await callFansly('route')).groupId).toBe(fourth.group); // completion never navigates or inserts
      expect(await composer()).toMatchObject({ groupId: fourth.group, value: '', model: '', cached: '' });
      expect(report.dock?.result).toBeNull();
    }

    // One real toast click proves the whole route, including the absent navigation switch on Fansly.
    const third = running[2];
    if (third === undefined) throw new Error('no third chat');
    const toast = await waitOursByText('toast', '.cg-toast', new RegExp(third.name), 'the third fan’s ready toast');
    await toast.$('.cg-toast__acts button').click();
    await dockIs((dock) => dock.target?.endsWith(`:${third.fan}`) === true && dock.result !== null && dock.result.opId === ops[2] && dock.result.state === 'done', 'the toast opens only its result');
    expect((await callFansly('route')).groupId).toBe(third.group);

    for (const [index, chat] of running.entries()) {
      await open(chat.group, chat.fan);
      await dockIs((dock) => dock.result !== null && dock.result.opId === ops[index] && dock.result.state === 'done', 'the kept result belongs to this chat');
      expect(await composer()).toMatchObject({ groupId: chat.group, value: '', model: '', cached: '' });
      await pressOurs('dock', '[data-cg-part="0"] button', /^Вставить/);
      await browser.waitUntil(async () => (await composer()).model === chat.text, { timeout: 5000, timeoutMsg: 'the result did not reach its own composer' });
      expect(await composer()).toMatchObject({ groupId: chat.group, value: chat.text, model: chat.text, cached: chat.text });
    }
    await open(fourth.group, fourth.fan);
    expect(await composer()).toMatchObject({ groupId: fourth.group, value: '', model: '', cached: '' });
    const streams = (await hub().journal(mark)).entries.filter((entry) => entry.route === 'aiFeatureStream');
    expect(streams.map((entry) => entry.status)).toEqual([200, 200, 200]);
    expect(streams.map((entry) => { const { body } = entry.request as { body: { conversationRef: string; fanRef: string } }; return [body.conversationRef, body.fanRef]; })).toEqual(running.map(({ group, fan }) => [group, fan]));
  });

  it('[ER-033] [RB-021] [NEW-11] the same chat in another tab is refused by the shared admission; explicit cancellation releases it', async () => {
    await open(A.group, A.fan);
    const mark = await hub().mark();
    await holdReply('p8e-other-tab', 'A reply held across tabs.');
    const first = opOf(await command<Admission>({ op: 'start', feature: 'reply' }));
    ops.push(first);
    const other = (await browser.createWindow('tab')).handle;
    try {
      await browser.switchToWindow(other);
      await openWithNeighbor(`/messages/${A.group}`, { mode: 'off' });
      await focusTab();
      await dockIs((dock) => dock.status === 'ready' && dock.actions['reply'] === true, 'the second tab is ready');
      expect(await command<Admission>({ op: 'start', feature: 'reply' })).toMatchObject({ ok: false, code: 'CG-OP-CHAT-BUSY', active: [{ opId: first, chat: { platformFanId: A.fan }, inThisTab: false }] });
      expect((await hub().journal(mark)).entries.filter((entry) => entry.route === 'aiFeatureStream')).toHaveLength(1);
      expect(await command({ op: 'cancel', feature: 'reply', opId: first })).toEqual({ state: 'canceled' });
      const next = opOf(await command<Admission>({ op: 'start', feature: 'reply' }));
      ops.push(next);
      await browser.waitUntil(async () => (await hub().journal(mark)).entries.filter((entry) => entry.route === 'aiFeatureStream').length === 2, { timeout: 10_000, timeoutMsg: 'the released chat did not start a new request' });
      expect((await hub().journal(mark)).entries.filter((entry) => entry.route === 'aiFeatureStream').map((entry) => entry.status)).toEqual([200, 200]);
    } finally {
      await browser.switchToWindow(other);
      await browser.closeWindow();
      await shift.toFansly();
    }
  });
});
