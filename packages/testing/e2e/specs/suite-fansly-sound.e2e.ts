// R20 P14a: the real MAIN → isolated batch → background arbiter on Fansly's
// stand, also on the inbox before the application loads. No live traffic.
import { browser, expect } from '@wdio/globals';

import { followFrame, messageCreatedFrame } from '../../fixture-fansly/src/wire';
import { pageRpc } from '../support/extension';
import { testBuildPage, useFakeHub } from '../support/fake-hub';
import { openWithNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { startFanslyShift, type FanslyShift } from '../support/fansly-shift';
import { fakeFansly, fanslyIds, fanslyStandServer } from '../support/fansly-stand';
import { focusTab } from '../support/focus';
import { useNetworkTrap } from '../support/network-trap';

interface Sound { outcomes: Record<string, number>; listeningTabs: number }
const value = (sound: Sound, name: string): number => sound.outcomes[name] ?? 0;
const rings = (sound: Sound, prefix = ''): number => value(sound, `${prefix}played`) + value(sound, `${prefix}audio-error`);

describe('[FS-SND-1] Fansly socket sounds', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: FanslyShift;
  let ids: Awaited<ReturnType<typeof fanslyIds>>;
  let mark = 0;
  let second: string | null = null;

  const sound = async (): Promise<Sound> => {
    const answer = await pageRpc<{ sound: Sound }>('diagnostics.get');
    if (!answer.ok) throw new Error(answer.error.code);
    return answer.payload.sound;
  };
  const away = async (): Promise<Sound> => {
    await shift.toPages();
    await focusTab();
    await browser.pause(350); // Coalesced blur/visibility presence reaches the background.
    return sound();
  };
  const waitCount = async (before: Sound, key: string, count = 1): Promise<void> => {
    await browser.waitUntil(async () => value(await sound(), key) >= value(before, key) + count, { timeout: 10000, timeoutMsg: `sound outcome ${key}` });
  };

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    mark = await fanslyStandServer.mark();
    shift = await startFanslyShift(hub(), { path: '/messages', neighbor: { mode: 'after' } });
    ids = await fanslyIds();
    await away();
    await browser.url(testBuildPage('popup.html'));
    await browser.waitUntil(async () => (await sound()).listeningTabs === 1, { timeout: 10000 });
  });
  after(async () => {
    if (second !== null) { await browser.switchToWindow(second); await browser.closeWindow(); }
    expect((await fanslyStandServer.journal(mark)).filter((entry) => entry.origin !== 'asset')).toEqual([]);
    await setFanslyNeighbor(null);
  });

  it('[SN-001] [SN-010] rings on the inbox, and a second tab or repeated socket frame cannot ring again', async () => {
    second = (await browser.createWindow('tab')).handle;
    await browser.switchToWindow(second);
    await openWithNeighbor('/messages', { mode: 'after' });
    await away();
    // A registered port precedes the coalesced account report, especially in a background tab.
    await browser.waitUntil(async () => {
      const seen = await pageRpc<{ accounts: { account: { hostAccountId: string }; routeTabs: number }[] }>('accounts.seen');
      return seen.ok && seen.payload.accounts.some((entry) => entry.account.hostAccountId === ids.creator && entry.routeTabs === 2);
    }, { timeout: 10000, timeoutMsg: 'both inbox tabs reported their creator' });
    const before = await sound();
    const created = await fakeFansly().command({ op: 'message', groupId: ids.groups[0] as string, text: 'fresh sound fact' });
    try {
      await browser.waitUntil(async () => rings(await sound()) === rings(before) + 1, { timeout: 10000 });
    } catch {
      throw new Error(`inbox sound: before=${JSON.stringify(before)} after=${JSON.stringify(await sound())}`);
    }
    await waitCount(before, 'duplicate');
    if (created.message === undefined) throw new Error('no message');
    const seen = await sound();
    await fakeFansly().command({ op: 'frames', frames: [messageCreatedFrame(created.message)] });
    await waitCount(seen, 'duplicate', 2);
    expect(rings(await sound())).toBe(rings(before) + 1);
  });

  it('[SN-008] the group in the focused visible tab is silent, then rings with that tab in the background', async () => {
    await shift.toFansly();
    await openWithNeighbor(`/messages/${ids.groups[0]}`, { mode: 'after' });
    await focusTab();
    await browser.pause(500);
    await fakeFansly().command({ op: 'message', groupId: ids.groups[0] as string, text: 'already visible' });
    await browser.pause(500);
    const afterFocus = await away();
    expect(value(afterFocus, 'open-chat')).toBeGreaterThan(0);
    await browser.pause(2100);
    await fakeFansly().command({ op: 'message', groupId: ids.groups[0] as string, text: 'now in background' });
    await browser.waitUntil(async () => rings(await sound()) === rings(afterFocus) + 1, { timeout: 10000 });
  });

  it('[SN-012] a socket follow rings without a hub session; its duplicate shares the one arbiter', async () => {
    await away();
    expect(await pageRpc('session.signOut')).toMatchObject({ ok: true });
    await browser.pause(2100);
    const before = await sound();
    const followed = await fakeFansly().command({ op: 'follow' });
    await browser.waitUntil(async () => rings(await sound(), 'subscriber.') === rings(before, 'subscriber.') + 1, { timeout: 10000 });
    if (followed.follow === undefined) throw new Error('no follow');
    const seen = await sound();
    await fakeFansly().command({ op: 'frames', frames: [followFrame(followed.follow)] });
    await waitCount(seen, 'subscriber.duplicate', 2);
    expect(rings(await sound(), 'subscriber.')).toBe(rings(before, 'subscriber.') + 1);
  });

  it('[SN-006] the model mute silences messages and socket subscribers', async () => {
    await away();
    expect(await pageRpc('settings.patch', { patch: { sound: { mutedAccounts: [`fansly-web:${ids.creator}`] } }, baseRevision: null })).toMatchObject({ ok: true });
    const before = await sound();
    await fakeFansly().command({ op: 'message', groupId: ids.groups[0] as string, text: 'muted' });
    await fakeFansly().command({ op: 'follow' });
    await waitCount(before, 'muted');
    await waitCount(before, 'subscriber.muted');
    expect(rings(await sound())).toBe(rings(before));
    expect(rings(await sound(), 'subscriber.')).toBe(rings(before, 'subscriber.'));
  });
});
