// P12a: no voice panel yet. The TEST-only loopback probe calls its real
// application/RPC port; the extension, scheduler, journal and SDK are real.
import { browser, expect } from '@wdio/globals';
import type { Admission, SiteOpView } from '@cg/contracts';
import { WORLD } from '../../src/scenarios/hub';
import { dockIs } from '../support/shift';
import { readReport } from '../support/extension';
import { useFakeHub } from '../support/fake-hub';
import { setFanslyNeighbor } from '../support/fansly-neighbor';
import { startFanslyShift } from '../support/fansly-shift';
import { callFansly, fakeFansly } from '../support/fansly-stand';
import { useNetworkTrap } from '../support/network-trap';

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
