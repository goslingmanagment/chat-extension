// Decision X54 on the wired extension: the PPV state of the open chat reaches
// the generation. The TEST build on the ChatSpace-like stand against the fake
// hub, every press a real click. What it proves end to end:
// - a fan bought the model's paid message after the chat was opened: the page's
//   loaded copy still says «not bought» (ChatSpace's socket says nothing of a
//   purchase), and Reply sends the hub `livePpvContext` with the purchase as
//   OnlyMonster's API gives it now — our own read of the open chat, with the
//   page's session, through MAIN;
// - that read is of the chat the person opened and of no other: the stand
//   labels it `ours`, and nothing else of ours reaches the stand;
// - a hub that does not list `live-ppv-v1` is never sent the field, and then
//   the start reads nothing from the API.

import { expect } from '@wdio/globals';

import { useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { pressOurs } from '../support/ours';
import { dockIs, startShift, type Shift } from '../support/shift';
import { callStand, foreignCalls, ourCalls, STAND_IDS, standServer, waitForChatReady } from '../support/stand';
import { PILOT_CAPABILITIES } from '../../src/fake-hub/config';
import { callsTo } from '../../src/fake-hub/journal';

const ACC = STAND_IDS.accounts.a;
const { a1, a2, a4 } = STAND_IDS.fans;

interface StreamBody {
  readonly conversationRef?: string;
  readonly livePpvContext?: { readonly items: ReadonlyArray<{ readonly platformMessageId: string; readonly priceUsd: number; readonly purchased: boolean }> };
}

describe('X54 on the wired extension — the PPV state of the open chat reaches the generation', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: Shift;
  let journalStart = 0;

  const open = async (fan: string): Promise<void> => {
    await callStand('openChat', ACC, fan);
    await waitForChatReady(ACC, fan);
    await dockIs((d) => d.status === 'ready' && d.target !== null && d.target.endsWith(`:${fan}`), `the dock of chat ${fan}`);
  };
  /** Reply by a click on the strip; resolves with the body the hub got for it. */
  const reply = async (): Promise<StreamBody> => {
    const mark = await hub().mark();
    const before = (await dockIs((d) => d.status === 'ready', 'the dock')).result?.opId ?? null;
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    await dockIs((d) => d.result !== null && d.result.opId !== before && d.result.state === 'done', 'the result', 20_000);
    const calls = callsTo((await hub().journal(mark)).entries, 'aiFeatureStream');
    expect(calls).toHaveLength(1);
    return ((calls[0]?.request as { body?: StreamBody } | undefined)?.body ?? {});
  };

  before(async () => {
    await standServer.reset();
    journalStart = await standServer.mark();
    await hub().command({ op: 'config', patch: { capabilities: [...PILOT_CAPABILITIES, 'live-ppv-v1'] } });
    shift = await startShift(hub());
  });

  after(async () => {
    await hub().command({ op: 'config', patch: { capabilities: [...PILOT_CAPABILITIES] } });
    // Nothing of ours reached the stand but our reads of the open chat, checked in the tests.
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
  });

  it('[X54] a purchase made after the chat opened reaches Reply as OnlyFans says it now; only the open chat is read', async () => {
    const bought = await standServer.paidMessage(ACC, a1, 25);
    const unbought = await standServer.paidMessage(ACC, a1, 15);
    await open(a1);
    const mark = await standServer.mark();
    // The fan buys the first one: the server's message changes, the page's loaded copy does not.
    await standServer.purchase(ACC, a1, bought);

    const body = await reply();
    expect(body.conversationRef).toBe(a1);
    expect(body.livePpvContext?.items).toEqual([
      { platformMessageId: unbought, priceUsd: 15, purchased: false },
      { platformMessageId: bought, priceUsd: 25, purchased: true },
    ]);
    // Our read: the open chat's messages, nothing else.
    const ours = ourCalls((await standServer.journal(mark)).entries).filter((entry) => entry.kind === 'history-load');
    expect(ours.length).toBeGreaterThanOrEqual(1);
    expect([...new Set(ours.map((entry) => entry.chatId))]).toEqual([a1]);
  });

  it('[X54] another chat: its own state, read only once it is open; a chat without paid messages sends none', async () => {
    await open(a2);
    const mark = await standServer.mark();
    const body = await reply();
    expect(body.conversationRef).toBe(a2);
    expect(body.livePpvContext).toBeUndefined();
    expect([...new Set(ourCalls((await standServer.journal(mark)).entries).map((entry) => entry.chatId).filter((chat) => chat !== undefined))]).toEqual([a2]);
  });

  it('[X54] a hub without live-ppv-v1: no field, and the start reads nothing from the API', async () => {
    await hub().command({ op: 'config', patch: { capabilities: [...PILOT_CAPABILITIES] } });
    // The background reads the owner's settings again (as its refresh does) and tells the tab.
    expect(await shift.rpc('bootstrap.get', { force: true })).toMatchObject({ ok: true });
    // A chat with a paid message and no result yet: a state to send, if the hub took it.
    await standServer.paidMessage(ACC, a4, 20, true);
    await open(a4);
    const mark = await standServer.mark();
    const body = await reply();
    expect(body.livePpvContext).toBeUndefined();
    expect(ourCalls((await standServer.journal(mark)).entries)).toEqual([]);
  });
});
