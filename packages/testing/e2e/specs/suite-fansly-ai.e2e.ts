// The AI features on Fansly through its policy (R20 P8c; spec FS-AI-1, FS-AI-2; docs/project-unite/architecture.md
// §5.8, §9.2, §11.1; plan.md §3 `suite-fansly-ai`): the extension's test build on the Fansly stand against the fake
// hub, a chatter signed in, the Fansly page's persona chosen and its own switches on. Part A — Hi and Ping:
// - Hi asks the hub by the tab's proof of the conversation's start (`StartProofV1`): a chat first opened past one
//   page of history has none, the Hi goes without it and the hub refuses `history_unproven` (§5.8 (а)); a chat the
//   tab saw from its first message — one personal line and 40 automatic ones (a welcome text, a mass message's copy,
//   the rest made by automation) — goes with the proof, its count and the fan's avatar, and the hub admits it
//   (§5.8 (б)); more than ten personal messages, proven, and the client refuses by itself, asking nothing;
// - Ping: a fan whose text the page holds from the last five days is refused by the client before anything is
//   asked; the hub's own `gate_ping_active` in the gate's words; a fan silent for a week — Ping goes, its window
//   from the settings, its segment the hub's;
// - the hub before HF-8в, between HF-8в and HF-5, after HF-5: Hi is «хаб пока не умеет» until the hub declares
//   `hi-start-proof-v1`, Reply goes with the window check only where the hub declared it.
// Nothing of ours asks the Fansly stand for anything; the fake hub refuses what the hub would (HF-5, gate_ping_active).

import { mkdirSync } from 'node:fs';

import { browser, expect } from '@wdio/globals';

import { createWorld } from '../../fixture-fansly/src/data';
import { PILOT_CAPABILITIES } from '../../src/fake-hub/config';
import type { FakeHubControlClient } from '../../src/fake-hub/control-client';
import type { FakeHubJournalEntry } from '../../src/fake-hub/types';
import { WORLD } from '../../src/scenarios/hub';
import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { waitForReport } from '../support/extension';
import { useFakeHub } from '../support/fake-hub';
import { setFanslyNeighbor } from '../support/fansly-neighbor';
import { startFanslyShift, type FanslyShift } from '../support/fansly-shift';
import { callFansly, fakeFansly, fanslyStandServer, waitForFanslyStandIdle } from '../support/fansly-stand';
import { useNetworkTrap } from '../support/network-trap';
import { pressOurs, readOurs } from '../support/ours';
import { dockIs } from '../support/shift';

const A = WORLD.fansly.chats.a;
const B = WORLD.fansly.chats.b;
const PAGE_LABEL = WORLD.pages.fansly.pageLabel;
/** A chat of the stand the spec opens first in §5.8 (а): 15 messages of its own, a page and more of them added unseen. */
const UNSEEN = createWorld().groups[5];
/** The fan of the conversation made in §5.8 (б): new, no message yet. */
const NEW_FAN = '920000000000008003';
/** The stand's welcome automation (fake-fansly data.ts `automated`): the page's `/message/automated` names its text. */
const WELCOME = 'Stand welcome: thanks for the follow';

interface StreamBody {
  readonly conversationRef: string;
  readonly fanRef: string;
  readonly messageCount: number;
  readonly variantCount?: number;
  readonly coverageCheck?: { readonly window: readonly { readonly id: string; readonly dir: string }[]; readonly deletedIds: readonly string[] };
  readonly startProof?: Record<string, unknown>;
  readonly personalMessageCount?: number;
  readonly fanAvatarUrl?: string;
  readonly liveTextContext?: unknown;
}
interface Stream {
  readonly status: number;
  readonly error: string | null;
  readonly reason: string | null;
  readonly feature: string;
  readonly capabilities: readonly string[];
  readonly body: StreamBody;
}
const streamOf = (entry: FakeHubJournalEntry): Stream => {
  const request = entry.request as { readonly feature: string; readonly capabilities: readonly string[]; readonly body: StreamBody };
  return { status: entry.status, error: entry.error, reason: entry.reason, feature: request.feature, capabilities: request.capabilities, body: request.body };
};
const streamsSince = async (hub: FakeHubControlClient, mark: number): Promise<Stream[]> => (await hub.journal(mark)).entries.filter((entry) => entry.route === 'aiFeatureStream').map(streamOf);

const route = (): Promise<{ readonly groupId: string | null }> => callFansly('route');
const held = async (): Promise<string[]> => (await callFansly('list'))?.ids.slice() ?? [];
const heldIn = async (group: string): Promise<string[] | null> => {
  const list = await callFansly('list');
  return list === null || list.groupId !== group ? null : list.ids.slice();
};
async function openChat(group: string, fan: string): Promise<void> {
  await callFansly('open', group, 'router');
  await browser.waitUntil(async () => (await route()).groupId === group, { timeout: 10_000, timeoutMsg: `the chat ${group} did not open` });
  await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true && d.target?.endsWith(`:${fan}`) === true, `the dock of the chat of ${fan}, ready`, 20_000);
}
/** The page holds `count` messages of `group` and has settled: no request of its own in flight. */
async function holds(group: string, count: number, what: string): Promise<string[]> {
  await browser.waitUntil(async () => (await heldIn(group))?.length === count, { timeout: 15_000, timeoutMsg: `the page does not hold ${count} messages of ${group} (${what}): ${(await held()).length}` });
  await waitForFanslyStandIdle();
  return held();
}
const settled = (feature: string, fan: string) => (d: { readonly target: string | null; readonly result: { readonly feature: string; readonly state: string } | null }): boolean =>
  d.target?.endsWith(`:${fan}`) === true && d.result?.feature === feature && ['done', 'failed'].includes(d.result.state);

/** The words of Hi's tooltip — «Hi недоступен: …» when it is off —, in the closed root beside the button. */
const hiReason = (): Promise<string | null> =>
  readOurs('dock', '.cg-strip', (strip) => {
    const button = [...strip.querySelectorAll('button')].find((node) => /^Hi/.test((node.textContent ?? '').trim()));
    const id = button?.getAttribute('aria-describedby') ?? null;
    return id === null ? null : ((strip.getRootNode() as Document | ShadowRoot).getElementById(id)?.textContent ?? null);
  });

/** A picture of the stand's page as it is now, in .cache/e2e/ (compared by eye with ui-design.md). */
async function shootStand(name: string): Promise<void> {
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  await browser.execute(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await browser.saveScreenshot(`${E2E_EVIDENCE_DIR}${name}.png`);
}
async function shootBothThemes(name: string): Promise<void> {
  for (const theme of ['bright', 'dark'] as const) {
    await callFansly('setTheme', theme);
    await waitForReport((now) => now.dock?.scheme === (theme === 'bright' ? 'light' : 'dark'), `the dock in the ${theme} theme`);
    await shootStand(`suite-fansly-ai-${name}-${theme}`);
  }
  await callFansly('setTheme', 'bright');
}

describe('Hi and Ping on Fansly through its policy: the proof of the start, the avatar, the active fan, the hub’s eras (R20 P8c, part A)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: FanslyShift;
  let journalStart = 0;
  /** The conversation made in §5.8 (б). */
  let fresh = '';

  /** The background reads the owner's settings again (as its refresh does) and tells the tab. */
  const rereadBootstrap = async (): Promise<void> => {
    expect(await shift.rpc('bootstrap.get', { force: true })).toMatchObject({ ok: true });
  };

  before(async () => {
    if (UNSEEN === undefined) throw new Error('the stand has no sixth chat');
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    journalStart = await fanslyStandServer.mark();
    shift = await startFanslyShift(hub(), { path: `/messages/${A.group}`, viewport: { width: 1440, height: 900 } });
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true && d.target?.endsWith(`:${A.fan}`) === true, 'the dock of the first Fansly chat, ready', 20_000);
  });

  after(async () => {
    await hub().command({ op: 'config', patch: { capabilities: [...PILOT_CAPABILITIES] } });
    // Nothing of the extension asked the Fansly stand for anything (the page's own calls go to the fake Fansly).
    expect((await fanslyStandServer.journal(journalStart)).filter((entry) => entry.origin !== 'asset')).toEqual([]);
  });

  it('[AI-032] [FS-AI-2] §5.8 (а): the first open of a chat of 41 messages — the fresh end is a full page, no proof of the start: the Hi goes with hi-start-proof-v1 and no proof, never a zero count, and the hub refuses history_unproven in the gate’s words', async function () {
    this.timeout(120_000);
    const chat = UNSEEN as NonNullable<typeof UNSEEN>;
    // The conversation grew past a page while no tab looked: 41 messages before the page ever opens it.
    const fake = fakeFansly();
    for (let n = chat.history.length; n < 41; n += 1) await fake.command({ op: 'message', groupId: chat.id, text: `unseen line ${n + 1}`, silent: true });
    await openChat(chat.id, chat.fan.id);
    await holds(chat.id, 25, 'the fresh end, one page');

    const mark = await hub().mark();
    await pressOurs('dock', '.cg-strip button', /^Hi/);
    const shown = await dockIs(settled('hi', chat.fan.id), 'the Hi of the chat, settled', 30_000);
    expect(shown.result).toMatchObject({ state: 'failed', error: 'CG-GATE-HI' });
    const streams = await streamsSince(hub(), mark);
    expect(streams.map(({ status, error, reason }) => ({ status, error, reason }))).toEqual([{ status: 400, error: 'gate_hi_greeting_limit', reason: 'history_unproven' }]);
    const [hi] = streams;
    expect(hi?.capabilities).toEqual(expect.arrayContaining(['context-v1', 'coverage-check-v1', 'hi-start-proof-v1']));
    expect([hi?.body.conversationRef, hi?.body.fanRef, hi?.body.messageCount, hi?.body.coverageCheck?.window.length]).toEqual([chat.id, chat.fan.id, 25, 25]);
    expect([hi?.body.startProof, hi?.body.personalMessageCount]).toEqual([undefined, undefined]);
    await shootBothThemes('hi-unproven');
  });

  it('[AI-030] [AI-031] [AI-033] [AI-034] [FX-018] [FS-AI-2] §5.8 (б): a chat the tab saw from its first message — one personal line, 40 automatic (made by automation, a welcome text, a mass message’s copy): the Hi carries the proof, its count and the fan’s avatar; the hub admits it, three greetings', async function () {
    this.timeout(180_000);
    const fake = fakeFansly();
    fresh = (await fake.command({ op: 'conversation', fanId: NEW_FAN })).groupId ?? '';
    expect(fresh).not.toBe('');
    await openChat(fresh, NEW_FAN);
    await holds(fresh, 0, 'a new conversation');
    // While the tab looks: the fan's one line, then the model's automatic messages of every kind the old client knew.
    const first = (await fake.command({ op: 'message', groupId: fresh, text: 'hey, just followed' })).message?.id ?? '';
    const automated: string[] = [];
    for (let n = 0; n < 38; n += 1) automated.push((await fake.command({ op: 'message', groupId: fresh, from: 'creator', type: 2, text: `Automatic message ${n + 1}` })).message?.id ?? '');
    automated.push((await fake.command({ op: 'message', groupId: fresh, from: 'creator', text: WELCOME })).message?.id ?? '');
    automated.push((await fake.command({ op: 'message', groupId: fresh, from: 'creator', text: 'A copy of a mass message', correlationId: '806000000000000099' })).message?.id ?? '');
    expect(await holds(fresh, 41, 'one personal and 40 automatic')).toEqual([first, ...automated]);

    const mark = await hub().mark();
    await pressOurs('dock', '.cg-strip button', /^Hi/);
    const shown = await dockIs(settled('hi', NEW_FAN), 'the Hi of the new conversation, settled', 30_000);
    expect(shown.result).toMatchObject({ state: 'done', error: null });
    const streams = await streamsSince(hub(), mark);
    expect(streams.map(({ status }) => status)).toEqual([200]);
    const [hi] = streams;
    expect(hi?.feature).toBe('hi-greeting');
    expect(hi?.capabilities).toEqual(expect.arrayContaining(['context-v1', 'coverage-check-v1', 'hi-start-proof-v1']));
    expect(hi?.body).toMatchObject({ conversationRef: fresh, fanRef: NEW_FAN, messageCount: 25, variantCount: 3, personalMessageCount: 1 });
    expect(hi?.body.startProof).toEqual({ v: 1, source: 'tab-short-page', groupId: fresh, startWitnessId: first, coveredCount: 41, personalCount: 1, automatedIds: automated });
    // The avatar the page loaded, as an address of Fansly's CDN (the hub's schema took it); the journal keeps its length only.
    expect(hi?.body.fanAvatarUrl).toMatch(/^‹\d+ chars›$/);
  });

  it('[AI-031] [FS-AI-2] more than ten personal messages, proven: the client refuses Hi by itself, in the gate’s words — no request reaches the hub', async function () {
    this.timeout(120_000);
    if ((await route()).groupId !== fresh) await openChat(fresh, NEW_FAN);
    const fake = fakeFansly();
    for (let n = 0; n < 10; n += 1) await fake.command({ op: 'message', groupId: fresh, text: `fan line ${n + 2}` });
    await holds(fresh, 51, 'eleven personal now');
    const mark = await hub().mark();
    await pressOurs('dock', '.cg-strip button', /^Hi/);
    await dockIs((d) => d.refusal === 'CG-GATE-HI', 'Hi refused by the client', 15_000);
    await browser.pause(500);
    expect(await streamsSince(hub(), mark)).toEqual([]);
  });

  it('[AI-036] [ER-034] [FS-AI-1] a fan whose text the page holds from the last five days: the client refuses Ping before anything is asked, in the gate’s words', async function () {
    this.timeout(60_000);
    if ((await route()).groupId !== fresh) await openChat(fresh, NEW_FAN);
    const mark = await hub().mark();
    await pressOurs('dock', '.cg-strip button', /^Ping/);
    await dockIs((d) => d.refusal === 'CG-GATE-PING', 'Ping refused by the client', 15_000);
    await browser.pause(500);
    expect(await streamsSince(hub(), mark)).toEqual([]);
    await shootBothThemes('ping-active');
  });

  it('[AI-035] [AI-037] [AI-134] [ER-034] [FS-AI-1] a fan silent for a week: Ping goes — its window from the settings, no segment of the client’s —; the hub’s own `gate_ping_active` for a fan its transcript shows active, in the gate’s words', async function () {
    this.timeout(120_000);
    await openChat(B.group, B.fan);
    const seed = (sender: 'fan' | 'model'): Promise<unknown> =>
      hub().command({ op: 'archiveConversation', pageLabel: PAGE_LABEL, conversationRef: B.group, messages: [{ id: `${B.group.slice(0, -3)}901`, sender }] });
    // The page's texts of this chat are older than five days, and the hub's archive holds no text of the fan.
    await seed('model');
    const mark = await hub().mark();
    await pressOurs('dock', '.cg-strip button', /^Ping/);
    const shown = await dockIs(settled('ping', B.fan), 'the Ping of the silent fan, settled', 30_000);
    expect(shown.result).toMatchObject({ state: 'done', error: null });
    const [ping] = await streamsSince(hub(), mark);
    expect([ping?.status, ping?.feature, ping?.body.messageCount, 'clientContext' in (ping?.body ?? {})]).toEqual([200, 'ping', 100, false]);
    expect(ping?.capabilities).not.toContain('hi-start-proof-v1');

    // The hub's transcript shows the fan active (a text of a minute ago in its archive): its refusal, in the gate's words.
    await seed('fan');
    const again = await hub().mark();
    await pressOurs('dock', '.cg-sheet button', /^Ещё раз/);
    const refused = await dockIs((d) => settled('ping', B.fan)(d) && d.result?.opId !== shown.result?.opId, 'the hub’s refusal of the new Ping', 30_000);
    expect(refused.result).toMatchObject({ state: 'failed', error: 'CG-GATE-PING' });
    expect((await streamsSince(hub(), again)).map(({ status, error }) => ({ status, error }))).toEqual([{ status: 400, error: 'gate_ping_active' }]);
  });

  it('[FS-AI-2] the hub before HF-8в, between HF-8в and HF-5, after HF-5: Hi is «хаб пока не умеет» until the hub declares hi-start-proof-v1; Reply asks the window check only of a hub that declared it', async function () {
    this.timeout(180_000);
    if ((await route()).groupId !== B.group) await openChat(B.group, B.fan);
    const era = async (without: readonly string[]): Promise<void> => {
      await hub().command({ op: 'config', patch: { capabilities: PILOT_CAPABILITIES.filter((capability) => !without.includes(capability)) } });
      await rereadBootstrap();
    };
    const reply = async (first: boolean): Promise<Stream | undefined> => {
      const mark = await hub().mark();
      const before = (await dockIs(() => true, 'the dock')).result?.opId ?? null;
      await pressOurs('dock', first ? '.cg-strip button' : '.cg-sheet button', first ? /^Reply/ : /^Ещё раз/);
      await dockIs((d) => d.result?.feature === 'reply' && d.result.state === 'done' && d.result.opId !== before, 'a new Reply', 30_000);
      return (await streamsSince(hub(), mark))[0];
    };

    // Before HF-8в: neither the window check nor the start proof.
    await era(['coverage-check-v1', 'hi-start-proof-v1']);
    await dockIs((d) => d.actions['hi'] === false && d.actions['reply'] === true, 'Hi off on a hub before HF-8в', 20_000);
    expect(await hiReason()).toContain('Hi недоступен: хаб пока не умеет эту функцию');
    const old = await reply(true);
    expect([old?.status, old?.body.coverageCheck, old?.capabilities.includes('coverage-check-v1')]).toEqual([200, undefined, false]);

    // Between HF-8в and HF-5: the window check, still no Hi.
    await era(['hi-start-proof-v1']);
    await browser.pause(500);
    expect((await dockIs(() => true, 'the dock')).actions['hi']).toBe(false);
    const between = await reply(false);
    expect([between?.status, between?.capabilities.includes('coverage-check-v1'), (between?.body.coverageCheck?.window.length ?? 0) > 0]).toEqual([200, true, true]);

    // After HF-5: Hi again.
    await era([]);
    await dockIs((d) => d.actions['hi'] === true, 'Hi on after HF-5', 20_000);
    expect((await hiReason()) ?? '').not.toContain('недоступен');
  });
});
