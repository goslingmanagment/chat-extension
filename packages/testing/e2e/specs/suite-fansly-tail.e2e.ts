// R20 P8b3 owns the whole tail suite (plan §3): MAIN's actual test build and bridge on the stand, then the
// installed extension against the fake hub. All traffic is loopback; the observer never requests site history.
import { browser, expect } from '@wdio/globals';

import type { OpView } from '@cg/contracts';
import type { FanslyHealth } from '@cg/contracts/bridge-messages-fansly';
import type { FanslySnapshot } from '@cg/contracts/fansly';
import { SESSION_KEYS } from '@cg/core/domain';

import { messageCreatedFrame, type WireMessage } from '../../fixture-fansly/src/wire';
import { budgetMs } from '../../src/e2e-timing';
import type { FakeHubJournalEntry } from '../../src/fake-hub/types';
import { WORLD } from '../../src/scenarios/hub';
import { suspendBackground } from '../support/background';
import { readReport } from '../support/extension';
import { useFakeHub } from '../support/fake-hub';
import { openWithNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { startFanslyShift, type FanslyShift } from '../support/fansly-shift';
import { FANSLY_MAIN, callFansly, fakeFansly, fanslyIds, fanslyStandServer, waitForFanslyStandIdle, waitForFanslyStandReady } from '../support/fansly-stand';
import { installFanslyTapHarness, tap, waitForFanslyTap, waitForTap, type FanslyTapHarness } from '../support/fansly-tap';
import { useNetworkTrap } from '../support/network-trap';
import { oursExists, pressOurs, waitOursText } from '../support/ours';
import { dockIs } from '../support/shift';

const A = WORLD.fansly.chats.a;
const B = WORLD.fansly.chats.b;
const held = async (): Promise<string[]> => (await callFansly('list'))?.ids.slice() ?? [];
const health = (): Promise<FanslyHealth> => tap('health');
async function snapshot(groupId = A.group, feature: 'reply' | 'hi' | 'recap' = 'reply', window = 60, withText = feature !== 'recap'): Promise<FanslySnapshot> {
  const answer = await tap<{ snapshot: FanslySnapshot | null }>('snapshot', { groupId, feature, window, withText });
  if (answer.snapshot === null) throw new Error(`no snapshot of ${groupId}`);
  return answer.snapshot;
}
const complete = () => waitForTap(() => snapshot(), (s) => s.completeness === 'complete', 'a certificate from the page’s fresh end');
async function recover(): Promise<void> {
  await callFansly('cameBack', 31_000);
  await waitForFanslyStandIdle();
  await complete();
}
function frame(n: number, groupId: string, senderId: string, content = 'tail-private-sentinel'): string {
  const message: WireMessage = { id: `9500000000${String(n).padStart(8, '0')}`, type: 2, dataVersion: 1,
    content, groupId, senderId, correlationId: null, inReplyTo: null, inReplyToRoot: null,
    createdAt: Math.floor(Date.now() / 1000), attachments: [], embeds: [], interactions: [], likes: [], totalTipAmount: 0 };
  return messageCreatedFrame(message);
}

describe('suite-fansly-tail: the observed window, certificates, gaps and bounded snapshots', () => {
  useNetworkTrap();
  let harness: FanslyTapHarness;
  let since = 0;
  let apiSince = 0;
  before(async () => { harness = await installFanslyTapHarness({ main: 'start' }); });
  beforeEach(async () => {
    await fakeFansly().command({ op: 'reset' });
    await setFanslyNeighbor(null);
    since = await fanslyStandServer.mark();
    apiSince = await fakeFansly().mark();
    await openWithNeighbor(`/messages/${A.group}`, { mode: 'after' });
    await waitForFanslyTap();
    await waitForFanslyStandIdle();
    await tap('focus', A.group, 1);
    await complete();
  });
  afterEach(async () => {
    expect((await fanslyStandServer.journal(since)).filter((entry) => entry.origin !== 'asset')).toEqual([]);
    expect(await fakeFansly().calls('ours', apiSince)).toEqual([]);
    expect(await tap('stats')).toMatchObject({ invalidEvents: 0, invalidAnswers: 0 });
  });
  after(async () => { await harness.remove(); await setFanslyNeighbor(null); });

  it('[AI-001] [FS-TAIL-1] [FS-TAIL-3] [FS-TAIL-6] the fan’s tail is visible within 0.5 s; eleven messages are all counted; A→B→A without a new page request preserves A', async () => {
    const first = await snapshot();
    const start = performance.now();
    const written = (await fakeFansly().command({ op: 'message', groupId: A.group, text: 'tail in half a second' })).message?.id ?? '';
    const one = await waitForTap(() => snapshot(), (s) => s.tail?.some((m) => m.platformMessageId === written) === true, 'the newest fan text', budgetMs(500));
    expect(performance.now() - start).toBeLessThanOrEqual(budgetMs(500));
    expect(one.window.at(-1)).toEqual({ id: written, dir: 'fan' });
    const ids = [written];
    for (let n = 1; n < 11; n++) ids.push((await fakeFansly().command({ op: 'message', groupId: A.group, text: `line ${n}` })).message?.id ?? '');
    const all = await waitForTap(() => snapshot(), (s) => ids.every((id) => s.window.some((m) => m.id === id)), 'all eleven fan messages');
    expect(all.window.length).toBe(first.window.length + 11);
    expect(all.knownFanMessageIds).toEqual(ids.slice(-10));
    await callFansly('open', B.group);
    await waitForFanslyStandIdle();
    const mark = await fakeFansly().mark();
    await callFansly('open', A.group);
    await waitForFanslyStandIdle();
    expect((await snapshot()).window).toEqual(all.window);
    expect((await snapshot()).completeness).toBe('complete');
    expect((await fakeFansly().calls('page', mark)).filter((c) => c.route === 'message.history')).toEqual([]);
    expect((await health()).perf.snapshotMs.max).toBeLessThanOrEqual(budgetMs(5));
  });

  it('[FS-TAIL-4] [FS-WS-2] [FS-WS-5] a damaged frame and a socket break invalidate the certificate; only a fresh request after t:1 recovers it', async () => {
    await fakeFansly().command({ op: 'frames', frames: ['{"t":10000,"d":"broken"}'] });
    await waitForTap(() => snapshot(), (s) => s.completeness === 'unknown', 'the incomplete frame loses observation');
    await recover();
    const epoch = (await snapshot()).epochs.socket;
    await fakeFansly().command({ op: 'socket', verifyDelayMs: 700, close: true });
    await waitForTap(() => snapshot(), (s) => s.completeness === 'unknown', 'the broken socket loses observation');
    await waitForFanslyStandIdle(20_000);
    const restored = await complete();
    expect(restored.epochs.socket).toBeGreaterThan(epoch);
    expect(restored.window.map((m) => m.id)).toEqual((await held()).slice(-60));
  });

  it('[FS-TAIL-4] [FS-TAIL-6] a request started before t:1 is not a certificate; the later certificate governs even if the earlier answer arrives last', async () => {
    await fakeFansly().command({ op: 'socket', verifyDelayMs: 2000 });
    await fakeFansly().command({ op: 'api', rules: [{ route: 'message.history', caller: 'page', times: 1, outcome: { kind: 'delay', ms: 5000 } }] });
    await openWithNeighbor(`/messages/${A.group}`, { mode: 'after' });
    await waitForFanslyTap();
    await tap('focus', A.group, 1);
    expect((await snapshot()).completeness).toBe('unknown');
    await waitForFanslyStandIdle(20_000);
    const last = await complete();
    expect(last.window.map((m) => m.id)).toEqual((await held()).slice(-60));
    const events = await tap<Array<{ t: string; p: { state?: string; reason?: string } }>>('events');
    expect(events.filter((e) => e.t === 'fx.coverage' && e.p.reason === 'certificate')).toHaveLength(1);
  });

  it('[FS-TAIL-3] [FS-TAIL-4] a by-id answer or lastMessage beyond the observed interval makes it unknown; a fresh end starts a new interval', async () => {
    const missing = (await fakeFansly().command({ op: 'message', groupId: A.group, text: 'not in the socket', silent: true })).message?.id ?? '';
    await callFansly('notify', [missing]);
    await waitForTap(() => snapshot(), (s) => s.completeness === 'unknown', 'a source named an unseen message');
    await recover();
    expect((await snapshot()).window.some((m) => m.id === missing)).toBe(true);
    // The same gap announced by the group’s lastMessage, with the history answer held back.
    const later = (await fakeFansly().command({ op: 'message', groupId: A.group, text: 'lastMessage only', silent: true })).message?.id ?? '';
    await callFansly('open', B.group); await waitForFanslyStandIdle();
    await fakeFansly().command({ op: 'api', rules: [{ route: 'message.history', caller: 'page', times: 1, outcome: { kind: 'delay', ms: 1500 } }] });
    await callFansly('forget', A.group); await callFansly('open', A.group);
    await waitForTap(() => snapshot(), (s) => s.completeness === 'unknown', 'lastMessage names a missing id');
    await waitForFanslyStandIdle();
    // This held request began before lastMessage's unseen grace expired: its answer cannot certify after that loss.
    expect((await snapshot()).completeness).toBe('unknown');
    await recover();
    expect((await complete()).window.some((m) => m.id === later)).toBe(true);
  });

  it('[FS-TAIL-3] [FS-TAIL-4] [FS-WS-2] batches, duplicate copies and a cascade delete merge once; a later history answer cannot resurrect a deleted copy', async () => {
    const cast = await fakeFansly().command({ op: 'broadcast', text: 'mass send', groupIds: [A.group, B.group] });
    const copy = cast.messages?.find((m) => m.groupId === A.group);
    if (copy === undefined || cast.message === undefined) throw new Error('no broadcast copies');
    await fakeFansly().command({ op: 'frames', frames: [messageCreatedFrame(copy), messageCreatedFrame(copy)], batch: true });
    await waitForTap(() => snapshot(), (s) => s.window.some((m) => m.id === copy.id), 'the copy from a batch');
    expect((await snapshot()).window.filter((m) => m.id === copy.id)).toHaveLength(1);
    await fakeFansly().command({ op: 'api', rules: [{ route: 'message.history', caller: 'page', times: 1, outcome: { kind: 'delay', ms: 800 } }] });
    await callFansly('cameBack', 31_000);
    await fakeFansly().command({ op: 'delete', messageId: cast.message.id });
    await waitForFanslyStandIdle();
    const deleted = await snapshot();
    expect(deleted.window.some((m) => m.id === copy.id)).toBe(false);
    expect(deleted.tail?.some((m) => m.platformMessageId === copy.id)).toBe(false);
    // If the governing certificate no longer holds the copy, its absence is proof; otherwise its tombstone is.
    expect(deleted.completeness).toBe('complete');
    expect(new Set(deleted.window.map((m) => m.id)).size).toBe(deleted.window.length);
  });

  it('[FS-TAIL-4] a bfcache return loses observation; one fresh request restores a quiet chat', async () => {
    await browser.execute(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    expect(await snapshot()).toMatchObject({ completeness: 'unknown', gap: 'bfcache' });
    await recover();
  });

  it('[FS-TAIL-5] [FS-TAIL-6] [FS-PRIV-1] eviction after 300 chats is unknown; the snapshot is a bounded copy and metadata carries no text', async () => {
    const saved = await snapshot();
    saved.window.length = 0;
    expect((await snapshot()).window.length).toBeGreaterThan(0);
    // MAIN protects the focused chat; A must be inactive to exercise eviction.
    await tap('focus', B.group, 2);
    const ids = await fanslyIds();
    for (let from = 0; from < 325; from += 25) {
      const frames = Array.from({ length: 25 }, (_, i) => frame(from + i, `9600000000${String(from + i).padStart(8, '0')}`, ids.creator));
      await fakeFansly().command({ op: 'frames', frames });
      await waitForTap(health, (h) => h.stream.unacked === 0, 'the consumer acknowledged the batch');
    }
    expect((await snapshot()).completeness).toBe('unknown');
    expect(JSON.stringify(await tap('events'))).not.toContain('tail-private-sentinel');
    expect(new TextEncoder().encode(JSON.stringify(saved)).length).toBeLessThanOrEqual(128 * 1024);
    await tap('focus', A.group, 3);
    await recover();
    expect((await snapshot()).window.length).toBeGreaterThan(0);
  });

  it('[FS-TAIL-1] [FS-TAIL-6] [FS-TAIL-10] Hi checks only its 25-message window; Recap gets ids without text; frame overflow trims old texts and says truncated', async () => {
    for (let n = 0; n < 36; n++) await fakeFansly().command({ op: 'message', groupId: A.group, text: 'я'.repeat(5000) });
    await waitForTap(() => snapshot(), (s) => s.window.length === 60, 'sixty observed messages');
    const hi = await snapshot(A.group, 'hi', 25);
    expect(hi.window).toHaveLength(25);
    expect(hi.knownFanMessageIds.every((id) => hi.window.some((m) => m.id === id))).toBe(true);
    const recap = await snapshot(A.group, 'recap', 60, false);
    expect(recap.tail).toBeUndefined();
    const reply = await snapshot();
    expect(reply.truncated).toBe(true);
    expect(reply.tail?.at(-1)?.platformMessageId).toBe(reply.window.at(-1)?.id);
    expect(new TextEncoder().encode(JSON.stringify(reply)).length).toBeLessThanOrEqual(128 * 1024);
  });

  it('[FS-TAIL-4] [FS-TAIL-5] [FS-WS-3] blocked credits cause exactly one fx.gap, no sent; snapshots stay unknown until a new certificate', async () => {
    const ids = await fanslyIds();
    await tap('setAcking', false);
    const before = (await health()).frames.seen;
    const frames = Array.from({ length: 3000 }, (_, n) => frame(n, B.group, ids.creator));
    for (let from = 0; from < frames.length; from += 500) await fakeFansly().command({ op: 'frames', frames: frames.slice(from, from + 500) });
    await waitForTap(health, (h) => h.frames.seen >= before + frames.length, 'the blocked stream read all frames', 30_000);
    expect(await tap('gaps')).toEqual([{ reason: 'overflow' }]);
    expect((await health()).stream.heldBytes).toBeLessThanOrEqual(256 * 1024);
    expect((await snapshot()).completeness).toBe('unknown');
    expect((await tap<Array<{ t: string }>>('events')).some((e) => e.t === 'fx.sent')).toBe(false);
    await tap('setAcking', true);
    const batches = await tap<Array<{ n: number }>>('batches');
    await tap('ack', batches.at(-1)?.n ?? 0); await tap('state');
    await recover();
  });
});

describe('suite-fansly-tail: Reply, Fix and a reopened result carry their own evidence', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: FanslyShift;
  let standMark = 0;
  let apiMark = 0;
  const streams = async (since: number): Promise<FakeHubJournalEntry[]> => (await hub().journal(since)).entries.filter((entry) => entry.route === 'aiFeatureStream');
  const done = (feature: string, previous?: string | null) => dockIs((d) => d.result?.feature === feature && d.result.state === 'done' && (previous === undefined || d.result.opId !== previous), `${feature} done`, 30_000);
  const seed = (window: readonly { id: string; dir: 'fan' | 'model' }[]) => hub().command({ op: 'archiveConversation', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: A.group, messages: window.map((m) => ({ id: m.id, sender: m.dir })) });
  before(async () => {
    await fakeFansly().command({ op: 'reset' });
    await setFanslyNeighbor(null);
    standMark = await fanslyStandServer.mark();
    apiMark = await fakeFansly().mark();
    shift = await startFanslyShift(hub(), { path: `/messages/${A.group}`, neighbor: { mode: 'after' } });
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the Fansly dock ready', 20_000);
    await waitForFanslyStandIdle();
  });
  afterEach(async () => { await shift.toFansly(); });
  after(async () => {
    expect((await fanslyStandServer.journal(standMark)).filter((e) => e.origin !== 'asset')).toEqual([]);
    await fakeFansly().assertOursClean(apiMark, 'suite-fansly-tail');
    await setFanslyNeighbor(null);
  });

  it('[AI-001] [AI-128] [FS-TAIL-1] [FS-TAIL-8] another window makes a new request; reopening the same window after tab and background reload keeps ITS verdict', async () => {
    const mark = await hub().mark();
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    const first = (await done('reply')).result?.opId;
    await waitOursText('dock', 'Ответ мог не учесть', 'the original window miss', { selector: '.cg-stale__t' });
    const firstCall = (await streams(mark))[0];
    const check = (firstCall?.request as { body: { coverageCheck: { window: Array<{ id: string; dir: 'fan' | 'model' }> } } }).body.coverageCheck;
    await seed(check.window);
    // Catching up alone cannot make this already-generated result fresh.
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    expect((await done('reply')).result?.opId).toBe(first);
    expect(await streams(mark)).toHaveLength(1);
    await waitOursText('dock', 'Ответ мог не учесть', 'the cached result keeps its original miss', { selector: '.cg-stale__t' });
    const written = (await fakeFansly().command({ op: 'message', groupId: A.group, text: 'a different proof' })).message?.id ?? '';
    await browser.waitUntil(async () => (await held()).includes(written), { timeout: 10_000 });
    await seed([...check.window, { id: written, dir: 'fan' }]);
    // Re-certify the latest page so the same window is observed before and after the document reload.
    await callFansly('cameBack', 31_000); await waitForFanslyStandIdle();
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    const second = (await done('reply', first)).result?.opId;
    expect(await streams(mark)).toHaveLength(2);
    await browser.waitUntil(async () => !(await oursExists('dock', '.cg-stale')), { timeout: 10_000, timeoutMsg: 'the new result should be fresh' });
    await shift.toPages(); expect(await suspendBackground()).toBe('stopped'); await shift.toFansly();
    await browser.refresh(); await waitForFanslyStandReady(); await waitForFanslyStandIdle();
    await dockIs((d) => d.status === 'ready', 'the reloaded Fansly dock ready', 20_000);
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    expect((await done('reply')).result?.opId).toBe(second);
    expect(await streams(mark)).toHaveLength(2);
    await browser.waitUntil(async () => !(await oursExists('dock', '.cg-stale')), { timeout: 10_000 });
    // The store contains both results’ own evidence, never the newest result’s verdict copied onto the oldest.
    await shift.toPages();
    const saved = await browser.execute(async () => {
      const api = (globalThis as unknown as { browser: { storage: { session: { get(): Promise<Record<string, unknown>> } } } }).browser;
      return api.storage.session.get();
    });
    // The real background adapter stores one OpView per result, not the scheduler's in-memory { ops } envelope.
    const firstSaved = saved[`${SESSION_KEYS.resultPrefix}${first}`] as OpView | undefined;
    const secondSaved = saved[`${SESSION_KEYS.resultPrefix}${second}`] as OpView | undefined;
    expect(firstSaved?.freshnessProof?.fingerprint.window).toEqual(check.window);
    expect(secondSaved?.freshnessProof?.fingerprint.window.at(-1)?.id).toBe(written);
    expect(JSON.stringify(saved)).not.toContain('a different proof');
    await shift.toFansly();
  });

  it('[AI-020] [FS-TAIL-6] [FS-TAIL-8] Fix reads the Fansly draft and the same snapshot; a deletion before Generate with a lagging hub is marked and still insertable', async () => {
    const mark = await hub().mark();
    const ids = await held();
    const deleted = ids.at(-2) ?? '';
    await fakeFansly().command({ op: 'delete', messageId: deleted });
    await browser.waitUntil(async () => !(await held()).includes(deleted), { timeout: 10_000 });
    const field = browser.$(FANSLY_MAIN.field);
    await field.click(); await browser.keys('my draft for Fix');
    await pressOurs('dock', '.cg-strip button', /^Fix/);
    const fixed = await done('fix');
    const call = (await streams(mark))[0];
    const body = (call?.request as { body: { draftText?: string; coverageCheck: { deletedIds: string[]; window: Array<{ id: string }> }; liveTextContext?: { items: unknown[] } } }).body;
    expect(body.draftText).toBe(`‹${'my draft for Fix'.length} chars›`);
    expect(body.coverageCheck.deletedIds).toContain(deleted);
    expect(body.coverageCheck.window.some((m) => m.id === deleted)).toBe(false);
    expect(body.liveTextContext?.items.length).toBeGreaterThan(0);
    await waitOursText('dock', 'Контекст устарел', 'the deleted message is still served by the lagging hub', { selector: '.cg-stale__t' });
    // Generation leaves the source alone; the explicit click replaces it even under this mark.
    expect(await field.getValue()).toBe('my draft for Fix');
    await pressOurs('dock', '.cg-dock button', /^Заменить мой черновик/);
    await browser.waitUntil(async () => (await field.getValue()) === 'Here is a smoother version of your draft.', { timeout: 10_000, timeoutMsg: 'Fix did not replace its source under the stale mark' });
    await waitOursText('dock', 'Контекст устарел', 'the result keeps its stale mark after replacement', { selector: '.cg-stale__t' });
    expect((await readReport())?.dock?.result?.opId).toBe(fixed.result?.opId);
  });
});
