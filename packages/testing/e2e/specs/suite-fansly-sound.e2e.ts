// Fansly's sounds on its stand (R20 P14a; docs/project-unite/architecture.md §8.12; FS-SND-1, FS-SND-2; plan.md §3
// `suite-fansly-sound`): the extension's test build with Fansly switched on as a person does it, a chatter signed in,
// the Fansly page's own switches on; the fake Fansly's socket says what Fansly's would (`5/1`, `3/2`).
// - a fan writes into a chat nobody has open: it rings once — the tab sits on Fansly's inbox, where our application
//   has no place and is not loaded: the page's facts go from the early bundle, in batches, to the background's one
//   arbiter; the creator's own message rings nothing;
// - a new subscriber on the page's socket rings the subscriber's sound, and the hub's «Новые» is never asked for the
//   Fansly page (its page hears them);
// - two tabs of the model hear the same message: it rings once;
// - the chat open in the tab in front rings nothing (focus and visibility as the tab says them — no `tabs`
//   permission); the model muted in the settings rings nothing.
// The sound's outcomes are read from the background's diagnostics (`diagnostics.get`): a tone that started, or one a
// headless player would not start (`audio-error`), is a ring. Nothing of ours asks the Fansly stand anything.

import { browser, expect } from '@wdio/globals';

import { callsTo } from '../../src/fake-hub/journal';
import { WORLD } from '../../src/scenarios/hub/world';
import { pageRpc, readReport, waitForReport } from '../support/extension';
import { testBuildPage, useFakeHub } from '../support/fake-hub';
import { openWithNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { startFanslyShift, type FanslyShift } from '../support/fansly-shift';
import { fakeFansly, fanslyIds, fanslyStandServer } from '../support/fansly-stand';
import { focusTab } from '../support/focus';
import { useNetworkTrap } from '../support/network-trap';
import { dockIs } from '../support/shift';

type Ids = Awaited<ReturnType<typeof fanslyIds>>;
interface SoundFacts {
  readonly listeningTabs: number;
  readonly lastIncomingAt: string | null;
  readonly outcomes: Readonly<Record<string, number>>;
}

const CREATOR = WORLD.pages.fansly.platformAccountId;
/** SN-009: a message never rings within 2 s of the last one; a test that wants the next one to ring waits it out. */
const MESSAGE_PAUSE_MS = 2100;

/** The background's sound, read from the extension page (it must be in front: `pageRpc` runs there). */
async function soundNow(): Promise<SoundFacts> {
  const diagnostics = await pageRpc<{ sound: SoundFacts }>('diagnostics.get');
  if (!diagnostics.ok) throw new Error(`diagnostics.get: ${diagnostics.error.code}`);
  return diagnostics.payload.sound;
}
const count = (sound: SoundFacts, name: string): number => sound.outcomes[name] ?? 0;
/** Tones the arbiter decided to start: played, or handed to a player that would not run in this browser. */
const rings = (sound: SoundFacts, kind: '' | 'subscriber.' = ''): number => count(sound, `${kind}played`) + count(sound, `${kind}audio-error`);

async function waitSound(predicate: (sound: SoundFacts) => boolean, message: string): Promise<SoundFacts> {
  const seen: { last: SoundFacts | null } = { last: null };
  try {
    await browser.waitUntil(
      async () => {
        seen.last = await soundNow();
        return predicate(seen.last);
      },
      { timeout: 10_000, interval: 200 },
    );
  } catch {
    throw new Error(`${message}: the arbiter decided ${JSON.stringify(seen.last?.outcomes ?? {})}`);
  }
  if (seen.last === null) throw new Error(`${message}: no diagnostics read`);
  return seen.last;
}

describe('Fansly’s sounds on its stand: the page’s socket, the one arbiter, the tab’s focus (R20 P14a)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: FanslyShift;
  let ids: Ids;
  let journalStart = 0;
  let hubStart = 0;

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    journalStart = await fanslyStandServer.mark();
    hubStart = await hub().mark();
    shift = await startFanslyShift(hub(), { path: '/messages', neighbor: { mode: 'off' } });
    ids = await fanslyIds();
    expect(ids.creator).toBe(CREATOR);
    await waitForReport((report) => report.rpc?.registered === true, 'the Fansly tab registered with the background');
    await shift.toPages();
    // `accounts.seen` is the popup's request; the background's diagnostics and the settings answer it too.
    await browser.url(testBuildPage('popup.html'));
    await browser.waitUntil(
      async () => {
        const seen = await pageRpc<{ accounts: ReadonlyArray<{ account: { host: string; hostAccountId: string }; openTabs: number }> }>('accounts.seen');
        return seen.ok && seen.payload.accounts.some((item) => item.account.host === 'fansly-web' && item.account.hostAccountId === CREATOR && item.openTabs > 0);
      },
      { timeout: 15_000, timeoutMsg: 'the background has not heard which Fansly account the tab shows' },
    );
  });

  after(async () => {
    // Nothing of the extension asked the Fansly stand for anything (the page's own calls go to the fake Fansly).
    expect((await fanslyStandServer.journal(journalStart)).filter((entry) => entry.origin !== 'asset')).toEqual([]);
    await setFanslyNeighbor(null);
  });

  it('[SN-001] [FS-SND-1] a fan writes into a chat nobody has open: it rings once — from Fansly’s inbox, our application not even loaded; the creator’s own message rings nothing', async () => {
    const before = await soundNow();
    expect(before.listeningTabs).toBe(1);
    await fakeFansly().command({ op: 'message', groupId: ids.groups[1] ?? '', text: 'hi there' });
    const rang = await waitSound((sound) => rings(sound) === rings(before) + 1, 'the fan’s message did not ring');
    expect(rang.lastIncomingAt).not.toBeNull();
    await fakeFansly().command({ op: 'message', groupId: ids.groups[1] ?? '', text: 'my own', from: 'creator' });
    const own = await waitSound((sound) => count(sound, 'not-fan') === count(rang, 'not-fan') + 1, 'the creator’s message was not decided');
    expect(rings(own)).toBe(rings(before) + 1);
    // The tab on the inbox never loaded our application: the facts went from its early bundle.
    await shift.toFansly();
    expect((await readReport())?.app).toBeUndefined();
    await shift.toPages();
  });

  it('[SN-012] [FS-SND-1] a new subscriber on the page’s socket rings the subscriber’s sound; the hub’s «Новые» is never asked for the Fansly page', async () => {
    await browser.pause(MESSAGE_PAUSE_MS);
    const before = await soundNow();
    await fakeFansly().command({ op: 'follow' });
    await waitSound((sound) => rings(sound, 'subscriber.') === rings(before, 'subscriber.') + 1, 'the new subscriber did not ring');
    // The Fansly page has «Новые» and its sound on, the browser knows its creator: still not one read of its list for the sound.
    expect(callsTo((await hub().journal(hubStart)).entries, 'clientAudienceNew')).toEqual([]);
  });

  it('[SN-010] [FS-SND-1] two tabs of the model hear the same message on their sockets: it rings once, the second copy is a duplicate', async () => {
    const second = (await browser.createWindow('tab')).handle;
    await browser.switchToWindow(second);
    await openWithNeighbor('/notifications', { mode: 'off' });
    await waitForReport((report) => report.rpc?.registered === true, 'the second Fansly tab registered');
    await shift.toPages();
    await browser.waitUntil(async () => (await soundNow()).listeningTabs === 2, { timeout: 10_000, timeoutMsg: 'the background does not count two tabs' });
    await browser.pause(MESSAGE_PAUSE_MS);
    const before = await soundNow();
    await fakeFansly().command({ op: 'message', groupId: ids.groups[2] ?? '', text: 'twice heard' });
    const after = await waitSound((sound) => rings(sound) === rings(before) + 1 && count(sound, 'duplicate') === count(before, 'duplicate') + 1, 'one ring and one duplicate');
    await browser.pause(1000);
    expect(rings(await soundNow())).toBe(rings(after));
    await browser.switchToWindow(second);
    await browser.closeWindow();
    await shift.toPages();
    await browser.waitUntil(async () => (await soundNow()).listeningTabs === 1, { timeout: 10_000, timeoutMsg: 'the second tab is still counted' });
  });

  it('[SN-008] [SN-006] [FS-SND-1] the chat open in the tab in front rings nothing — its focus and visibility as the tab says them; the model muted rings nothing, a message or a subscriber', async () => {
    const group = ids.groups[0] ?? '';
    const fan = ids.fans[group] ?? '';
    await shift.toFansly();
    await openWithNeighbor(`/messages/${group}`, { mode: 'off' });
    await focusTab();
    await dockIs((dock) => dock.target !== null && dock.target.endsWith(`:${fan}`), 'our dock of the open chat', 20_000);
    await shift.toPages();
    await browser.pause(MESSAGE_PAUSE_MS);
    const before = await soundNow();
    await shift.toFansly();
    const inFront = await browser.execute(() => document.visibilityState === 'visible' && document.hasFocus());
    // The tab says it is in front before the message comes (its presence report is debounced).
    await browser.pause(2500);
    await fakeFansly().command({ op: 'message', groupId: group, text: 'seen already' });
    await browser.pause(2000);
    await shift.toPages();
    const after = await soundNow();
    if (inFront) {
      expect(count(after, 'open-chat')).toBe(count(before, 'open-chat') + 1);
      expect(rings(after)).toBe(rings(before));
    } else {
      // A headless window without the focus: the chat is not «in front», the message rings.
      expect(rings(after)).toBe(rings(before) + 1);
    }

    // The model's switch (ST-075): both of its sounds are silent, and counted as such.
    expect(await pageRpc('settings.patch', { patch: { sound: { mutedAccounts: [`fansly-web:${CREATOR}`] } }, baseRevision: null })).toMatchObject({ ok: true });
    await browser.pause(MESSAGE_PAUSE_MS);
    await fakeFansly().command({ op: 'message', groupId: ids.groups[1] ?? '', text: 'while muted' });
    await fakeFansly().command({ op: 'follow' });
    const muted = await waitSound((sound) => count(sound, 'muted') === count(after, 'muted') + 1 && count(sound, 'subscriber.muted') === count(after, 'subscriber.muted') + 1, 'the muted model was not counted');
    expect([rings(muted), rings(muted, 'subscriber.')]).toEqual([rings(after), rings(after, 'subscriber.')]);
    expect(await pageRpc('settings.patch', { patch: { sound: { mutedAccounts: [] } }, baseRevision: null })).toMatchObject({ ok: true });
  });
});
