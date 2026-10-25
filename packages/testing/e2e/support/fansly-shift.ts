// A working shift on the Fansly stand (R20 P7i): the TEST build installed,
// pointed at the fake hub, a chatter signed in, the Fansly page's persona
// chosen and its own switches on (`*` never reaches a Fansly page, HF-2),
// Fansly switched on as a person does it — the stand's origins granted, the
// background's sync registering both scripts —, and a tab of the Fansly stand
// open in a chat next to the neighbour, beside an extension page. The same
// for ChatSpace is support/shift.ts; both in one browser:
// `openChatSpaceBeside`.

import { DEFAULT_SETTINGS, STORAGE_KEYS, type SettingsV1 } from '@cg/contracts';
import { browser } from '@wdio/globals';

import { createWorld, standGroupId, type World } from '../../fixture-fansly/src/data';
import { SHOWCASE_CONVERSATIONS } from '../../fixture-fansly/src/showcase';
import { fanslyPageFlags } from '../../src/fake-hub/config';
import type { FakeHubControlClient } from '../../src/fake-hub/control-client';
import type { NeighborConfig } from '../../src/fake-fansly/neighbor/protocol';
import { PAGE, WORLD } from '../../src/scenarios/hub';
import { SHOWCASE, SHOWCASE_AT } from '../../src/showcase';
import { assignPersona, installTestBuild, pageRpc, writeLocalStorage } from './extension';
import { fakeHubOrigin, QUIET_PAGE, testBuildPage } from './fake-hub';
import { openWithNeighbor } from './fansly-neighbor';
import { fakeFansly } from './fansly-stand';
import { switchFanslyOnForTheStand } from './fansly-site';
import { focusTab } from './focus';
import { SHIFT_PASSWORD } from './shift';
import { chatPath, openStand, STAND_IDS, waitForChatReady } from './stand';
import { showcaseSpender } from './world';

export interface FanslyShiftOptions {
  /** Settings on top of the defaults (the hub address is the fake hub's). */
  readonly settings?: { readonly generation?: Partial<SettingsV1['generation']>; readonly ui?: Partial<SettingsV1['ui']> };
  /** The Fansly stand's path the tab opens with. */
  readonly path: string;
  /** The neighbour next to it (`off` by default). */
  readonly neighbor?: Partial<NeighborConfig>;
  readonly viewport?: { readonly width: number; readonly height: number };
  /** The hub's world is already set (a second browser of the same spec): only this browser's own shift is started. */
  readonly world?: false;
  /** Another chatter in a second browser, against the same hub and page. */
  readonly user?: { readonly username: string; readonly password: string };
}

export interface FanslyShift {
  readonly fanslyTab: string;
  readonly pagesTab: string;
  toFansly(): Promise<void>;
  toPages(): Promise<void>;
  /** A request of the page protocol from the extension page; the Fansly tab is in front again after it. */
  rpc<T = unknown>(type: string, payload?: unknown): Promise<{ readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: { readonly code: string; readonly detail?: string } }>;
}

/**
 * The hub's archive of the stand's chats is what the stand's page shows, by the page's own ids (2026-10-22): the window
 * check over a stand chat then finds its messages, and a result is marked only where a spec makes the archive lag
 * (`archiveConversation` again). The stand's world is deterministic (fixture-fansly).
 */
async function seedStandArchive(hub: FakeHubControlClient, path: string, world: World, more: readonly string[] = []): Promise<void> {
  const opened = /\/messages\/(\d+)/.exec(path)?.[1];
  const groups = new Set([WORLD.fansly.chats.a.group, WORLD.fansly.chats.b.group, ...(opened === undefined ? [] : [opened]), ...more]);
  for (const id of groups) {
    const group = world.byId.get(id);
    if (group === undefined) continue;
    const messages = group.history.map((message) => ({
      id: message.id,
      sender: message.senderId === group.fan.id ? ('fan' as const) : ('model' as const),
      // The showcase world's archive reads as its chat does: the texts and times a person sees.
      ...(SHOWCASE ? { text: message.content, at: new Date(message.createdAt * 1000).toISOString() } : {}),
    }));
    await hub.command({ op: 'archiveConversation', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: id, messages });
  }
}

/**
 * The showcase world (src/showcase.ts): the Fansly page's Spenders board is the inbox's hand-written fans with their
 * money and ages, and the hub's capture knows their chats (a preview reads each from the archive). Returns their groups.
 */
async function showcaseBoard(hub: FakeHubControlClient, world: World): Promise<string[]> {
  const rows = SHOWCASE_CONVERSATIONS.flatMap((conversation, index) => {
    const group = world.byId.get(standGroupId(index));
    return group === undefined ? [] : [{ group: group.id, seed: showcaseSpender({ fanRef: group.fan.id, conversationRef: group.id, username: conversation.username, displayName: conversation.displayName, spentUsd: conversation.spentUsd, chat: conversation.chat }) }];
  });
  for (const row of rows) await hub.command({ op: 'thread', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: row.group, fanRef: row.seed.fanRef });
  await hub.command({ op: 'spenderFans', fans: rows.map((row) => row.seed) });
  await hub.command({ op: 'config', patch: { spendersTotal: rows.length } });
  return rows.map((row) => row.group);
}

export async function startFanslyShift(hub: FakeHubControlClient, options: FanslyShiftOptions): Promise<FanslyShift> {
  if (options.world !== false) {
    await hub.command({ op: 'config', patch: fanslyPageFlags() });
    // The stand's world, as the fake Fansly made it (the showcase's dated from the run's one «now»).
    const world = createWorld(undefined, SHOWCASE ? SHOWCASE_AT : null);
    await seedStandArchive(hub, options.path, world, SHOWCASE ? await showcaseBoard(hub, world) : []);
  }
  await installTestBuild();
  await browser.url(testBuildPage(QUIET_PAGE));
  const settings: SettingsV1 = {
    ...DEFAULT_SETTINGS,
    hub: { baseUrl: fakeHubOrigin() },
    ui: { ...DEFAULT_SETTINGS.ui, ...options.settings?.ui },
    generation: { ...DEFAULT_SETTINGS.generation, ...options.settings?.generation },
  };
  await writeLocalStorage({ [STORAGE_KEYS.settings]: settings, 'dev.fanslyApi.origin': fakeFansly().apiOrigin });
  await browser.waitUntil(
    async () => {
      const state = await pageRpc<{ settings: SettingsV1 }>('settings.get');
      return state.ok && state.payload.settings.hub.baseUrl === fakeHubOrigin();
    },
    { timeout: 15_000, timeoutMsg: 'the settings owner did not pick the hub address up' },
  );
  // The password is taken only from the settings page (the sender rule of `session.signIn`).
  await browser.url(testBuildPage('options.html'));
  const signedIn = await pageRpc('session.signIn', { login: options.user?.username ?? WORLD.user.username, password: options.user?.password ?? SHIFT_PASSWORD });
  if (!signedIn.ok) throw new Error(`sign-in: ${signedIn.error.code}`);
  await assignPersona(WORLD.pages.fansly.pageLabel);
  // The showcase's chatter is set up: every page of hers has its persona (src/showcase.ts).
  if (SHOWCASE) for (const page of [WORLD.pages.one, WORLD.pages.vip]) await assignPersona(page.pageLabel);
  // «Включить Fansly», as far as the stand goes: its origins and webRequest granted, the background registers both scripts.
  await switchFanslyOnForTheStand();
  await browser.url(testBuildPage(QUIET_PAGE));
  const pagesTab = await browser.getWindowHandle();
  const fanslyTab = (await browser.createWindow('tab')).handle;
  const toFansly = async (): Promise<void> => {
    await browser.switchToWindow(fanslyTab);
    await focusTab();
  };
  const toPages = (): Promise<void> => browser.switchToWindow(pagesTab);
  await browser.switchToWindow(fanslyTab);
  if (options.viewport !== undefined) await browser.browsingContextSetViewport({ context: fanslyTab, viewport: { ...options.viewport } });
  await openWithNeighbor(options.path, options.neighbor ?? { mode: 'off' });
  await focusTab();
  return {
    fanslyTab,
    pagesTab,
    toFansly,
    toPages,
    async rpc(type, payload = {}) {
      await toPages();
      try {
        return await pageRpc(type, payload);
      } finally {
        await toFansly();
      }
    },
  };
}

/**
 * A ChatSpace tab of the stand in the same browser, beside the Fansly one (the open chat of fan a1 of account a), the
 * hub's ChatSpace page with its persona. The page must be bound to the stand's account before the shift signed in
 * (`standWorld`, support/world.ts). Returns its window handle; it is in front.
 */
export async function openChatSpaceBeside(shift: FanslyShift): Promise<string> {
  await shift.toPages();
  await assignPersona(PAGE);
  const tab = (await browser.createWindow('tab')).handle;
  await browser.switchToWindow(tab);
  await openStand(chatPath(STAND_IDS.accounts.a, STAND_IDS.fans.a1));
  await waitForChatReady(STAND_IDS.accounts.a, STAND_IDS.fans.a1);
  await focusTab();
  return tab;
}
