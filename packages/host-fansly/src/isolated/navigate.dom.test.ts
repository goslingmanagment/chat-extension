// Opening a chat on Fansly and «Открыть и вставить» (R20 P7e; docs/project-unite/architecture.md §7.6; FS-INS-4;
// SP-036, NEW-01): the port over a scripted MAIN on a Fansly-like page (testing/port-world.ts) whose router reads
// the inbox's links and `popstate` as Angular does. The browser's own run is suite-fansly-insert.e2e.ts.

import { FANSLY_IDS } from '@cg/contracts/fixtures';
import { NavigationReceiptSchema, type NavigationReceipt } from '@cg/contracts/host';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { editorCalls, installEditor, settle, startWorld, until, type World } from '../testing/port-world';
import { NAV_CHECK_MS } from './navigate';

const { creator: CREATOR, fan: FAN, group: GROUP, otherGroup: OTHER } = FANSLY_IDS;
const OTHER_FAN = '700000000000000005';
const THIRD = '700000000000000006';
const THIRD_FAN = '700000000000000007';
const FANS = { [GROUP]: FAN, [OTHER]: OTHER_FAN, [THIRD]: THIRD_FAN };

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  history.replaceState({}, '', '/');
});
beforeEach(() => {
  cleanups.push(installEditor());
});

/** The port on chat A; the page's router reads `popstate`; the inbox shows the rows named. */
async function onChat(rows: readonly string[] = [], options: { readonly navInsertTimeoutMs?: number } = {}): Promise<World> {
  const world = await startWorld(`/messages/${GROUP}`, { fans: FANS, ...options });
  cleanups.push(() => world.dispose());
  world.page.routing(true);
  world.page.openChat(GROUP);
  world.page.inbox(rows);
  await until('chat A', () => world.port.current().composer !== null);
  return world;
}

const valueOf = (world: World): string | null => world.page.textarea()?.value ?? null;
const atChat = (world: World, fanId: string): boolean => world.port.current().route.chat?.platformFanId === fanId && world.port.current().composer !== null;
const parsed = (receipt: NavigationReceipt): NavigationReceipt => NavigationReceiptSchema.parse(receipt);
const ways = (world: World): unknown[] => world.diagnostics.filter((d) => d.event === 'navigate').map((d) => d.detail?.['way']);

describe('[SP-036] opening a chat the way a person does', () => {
  it('[SP-036] by the inbox row’s own link when the virtual list has it rendered, else by the address and a `popstate` Angular reads a task later; never a load', async () => {
    const world = await onChat([OTHER]);
    const linked = parsed(await world.port.navigate(world.navigation(OTHER)));
    expect(linked).toEqual({ state: 'navigated', routeEpoch: world.port.current().route.epoch, insert: null });
    expect(location.pathname).toBe(`/messages/${OTHER}`);
    await until('chat B', () => atChat(world, OTHER_FAN));
    const popped = parsed(await world.port.navigate(world.navigation(THIRD)));
    expect(popped.state).toBe('navigated');
    await until('chat C', () => atChat(world, THIRD_FAN));
    expect(ways(world)).toEqual(['link', 'popstate']);
    expect(world.redeemed).toEqual(['navigate', 'navigate']);
    // Past the 2-second check: the chats opened, nothing was loaded by its address.
    await new Promise((resolve) => setTimeout(resolve, NAV_CHECK_MS + 100));
    expect(world.loads).toEqual([]);
    expect((await world.port.health()).isolated.route.unsignalled).toBe(0);
  });

  it('[SP-036] a page that does not react within 2 s is loaded by the address — unless the person went elsewhere meanwhile', async () => {
    const world = await onChat();
    world.page.routing(false);
    const receipt = parsed(await world.port.navigate(world.navigation(OTHER, 'given up by the load')));
    expect(world.loads).toEqual([`/messages/${OTHER}`]);
    // The deferred insert could not live through a load: given up.
    expect(receipt).toMatchObject({ state: 'navigated', insert: { state: 'rejected', code: 'CG-INSERT-CANCELED' } });
    world.page.routing(true);
    history.replaceState({}, '', `/messages/${GROUP}`);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    await until('chat A', () => atChat(world, FAN));
    world.page.routing(false);
    void world.port.navigate(world.navigation(THIRD));
    await settle();
    world.page.openChat(OTHER);
    await new Promise((resolve) => setTimeout(resolve, NAV_CHECK_MS + 100));
    expect(world.loads).toEqual([`/messages/${OTHER}`]);
  });

  it('refused before anything moves: another account, an unknown group, no redeemed token', async () => {
    const world = await onChat([OTHER]);
    expect(await world.port.navigate(world.navigation(OTHER, 'x', { account: '700000000000000042' }))).toEqual({ state: 'failed', code: 'CG-NAV-FAILED', insert: { state: 'rejected', code: 'CG-NAV-FAILED' } });
    const { conversationRef: _group, ...noGroup } = world.navigation(OTHER).target;
    expect(await world.port.navigate({ ...world.navigation(OTHER), target: noGroup })).toEqual({ state: 'failed', code: 'CG-NAV-FAILED', insert: null });
    world.allowRedeem(false);
    expect(await world.port.navigate(world.navigation(OTHER, 'x'))).toEqual({ state: 'failed', code: 'CG-NAV-FAILED', insert: { state: 'rejected', code: 'CG-NAV-FAILED' } });
    expect(location.pathname).toBe(`/messages/${GROUP}`);
    // The tab's own account: it is the one open.
    world.allowRedeem(true);
    expect(await world.port.navigate({ ...world.navigation(OTHER), target: { hostAccountId: CREATOR, platformFanId: null } })).toMatchObject({ state: 'navigated', insert: null });
  });
});

describe('[NEW-01] «Открыть и вставить» (FS-INS-4)', () => {
  it('[NEW-01] waits for the target’s own field — its group, its fan named by MAIN, two looks — and writes once, into it only', async () => {
    const world = await onChat([OTHER]);
    world.holdChats(true);
    const pending = world.port.navigate(world.navigation(OTHER, 'Opened and inserted'));
    await until('the address on B', () => location.pathname === `/messages/${OTHER}`);
    // The field of B is there, but MAIN has not named its fan: nothing is written yet.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(editorCalls).toEqual([]);
    world.holdChats(false);
    const receipt = parsed(await pending);
    expect(receipt).toMatchObject({ state: 'navigated', routeEpoch: world.port.current().route.epoch, insert: { state: 'applied' } });
    expect(valueOf(world)).toBe('Opened and inserted');
    expect(editorCalls).toEqual(['Opened and inserted']);
    expect(world.port.insertion()?.chat).toEqual({ host: 'fansly-web', hostAccountId: CREATOR, platformFanId: OTHER_FAN });
    expect((await world.draft()).provenance).toBe('our-insert');
  });

  it('[NEW-01] [FS-INS-3] a draft of the person in the target (the page’s cache) is never written over: the question is asked, the text stays', async () => {
    const world = await onChat([OTHER]);
    world.page.cacheDrafts(true);
    world.page.openChat(OTHER);
    await until('chat B', () => atChat(world, OTHER_FAN));
    const element = world.page.textarea() as HTMLTextAreaElement;
    element.value = 'my draft for B';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    world.page.openChat(GROUP);
    await until('chat A', () => atChat(world, FAN));
    const receipt = parsed(await world.port.navigate(world.navigation(OTHER, 'AI over it')));
    expect(receipt).toEqual({ state: 'navigated', routeEpoch: world.port.current().route.epoch, insert: { state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' } });
    expect(valueOf(world)).toBe('my draft for B');
  });

  it('[NEW-01] the deadline: the fan never named in time → CG-NAV-TIMEOUT, and nothing is written later', async () => {
    const world = await onChat([OTHER], { navInsertTimeoutMs: 300 });
    world.holdChats(true);
    const receipt = parsed(await world.port.navigate(world.navigation(OTHER, 'too late')));
    expect(receipt).toEqual({ state: 'failed', code: 'CG-NAV-TIMEOUT', insert: { state: 'rejected', code: 'CG-NAV-TIMEOUT' } });
    world.holdChats(false);
    await until('chat B', () => atChat(world, OTHER_FAN));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(valueOf(world)).toBe('');
  });

  it('[NEW-01] given up while it waits — the person opens another chat, the extension’s signal, another insert of ours — CG-INSERT-CANCELED; the navigation stays', async () => {
    const world = await onChat([OTHER, THIRD]);
    world.holdChats(true);
    const left = world.port.navigate(world.navigation(OTHER, 'left'));
    await until('the address on B', () => location.pathname === `/messages/${OTHER}`);
    world.page.openChat(THIRD);
    expect(await left).toMatchObject({ state: 'navigated', insert: { state: 'rejected', code: 'CG-INSERT-CANCELED' } });

    const controller = new AbortController();
    const aborted = world.port.navigate(world.navigation(OTHER, 'aborted'), { signal: controller.signal });
    await until('the address on B', () => location.pathname === `/messages/${OTHER}`);
    controller.abort();
    expect(await aborted).toMatchObject({ state: 'navigated', insert: { state: 'rejected', code: 'CG-INSERT-CANCELED' } });

    const replaced = world.port.navigate(world.navigation(THIRD, 'replaced by a newer one'));
    await until('the address on C', () => location.pathname === `/messages/${THIRD}`);
    const newer = world.port.navigate(world.navigation(OTHER, 'the newer one'));
    expect(await replaced).toMatchObject({ insert: { state: 'rejected', code: 'CG-INSERT-CANCELED' } });
    world.holdChats(false);
    expect(await newer).toMatchObject({ state: 'navigated', insert: { state: 'applied' } });
    expect(editorCalls).toEqual(['the newer one']);
    // Already given up when it starts: the chat opens, the insert is refused at once.
    const done = new AbortController();
    done.abort();
    expect(await world.port.navigate(world.navigation(THIRD, 'never'), { signal: done.signal })).toMatchObject({ state: 'navigated', insert: { state: 'rejected', code: 'CG-INSERT-CANCELED' } });
    await until('chat C', () => atChat(world, THIRD_FAN));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(valueOf(world)).toBe('');
  });

  it('[NEW-01] the target is the chat open now: written into its field without a navigation', async () => {
    const world = await onChat();
    const receipt = parsed(await world.port.navigate(world.navigation(GROUP, 'here already')));
    expect(receipt).toMatchObject({ state: 'navigated', insert: { state: 'applied' } });
    expect(valueOf(world)).toBe('here already');
    expect(ways(world)).toEqual(['here']);
  });
});
