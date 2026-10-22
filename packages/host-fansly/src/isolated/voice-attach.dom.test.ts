// The voice note's MP3 into Fansly's composer (R20 P12c; docs/project-unite/architecture.md §7.10; FS-VOI-2): the port
// over a scripted MAIN on a Fansly-like page (testing/port-world.ts) whose composer opens its upload modal on a file and
// attaches it only on the person's «Upload»; the attempt's timers are the test's. The page in Firefox is the stand's
// (packages/testing/fixture-fansly).

import type { AttachIntent, AttachReceipt } from '@cg/contracts/host';
import type { HostIdentity } from '@cg/contracts/ids';
import { FANSLY_IDS } from '@cg/contracts/fixtures';
import { afterEach, describe, expect, it } from 'vitest';

import { settle, startWorld, until, type World } from '../testing/port-world';
import { DOM_ANCHORS, type DomAnchorStates } from './anchors';
import { buildFanslyReport, type FanslyContractInput } from './contract';
import { ATTACH_LIMITS, type AttachTimer } from './voice-attach';

const { fan: FAN, group: GROUP, otherGroup: OTHER } = FANSLY_IDS;
const FANS = { [GROUP]: FAN, [OTHER]: '700000000000000005' };
const { afterCloseMs: AFTER_CLOSE, capMs: CAP } = ATTACH_LIMITS;

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  history.replaceState({}, '', '/');
});

/** The attempt's timers, fired by the test by their length: the wait after the modal closed, the cap. */
function manualTimer(): AttachTimer & { armed(ms: number): number; fire(ms: number): void } {
  const callbacks = new Map<number, { readonly callback: () => void; readonly ms: number }>();
  let next = 0;
  return {
    set(callback, ms) {
      next += 1;
      callbacks.set(next, { callback, ms });
      return next;
    },
    clear(handle) {
      callbacks.delete(handle as number);
    },
    armed: (ms) => [...callbacks.values()].filter((entry) => entry.ms === ms).length,
    fire(ms) {
      for (const [handle, entry] of [...callbacks]) {
        if (entry.ms !== ms) continue;
        callbacks.delete(handle);
        entry.callback();
      }
    },
  };
}

/** The port on chat A, MAIN having named its fan. */
async function onChat(): Promise<{ readonly world: World; readonly timer: ReturnType<typeof manualTimer> }> {
  const timer = manualTimer();
  const world = await startWorld(`/messages/${GROUP}`, { fans: FANS, attachTimer: timer });
  cleanups.push(() => world.dispose());
  world.page.openChat(GROUP);
  await until('MAIN names the fan', () => world.port.current().composer !== null);
  return { world, timer };
}

const intent = (expected: HostIdentity, name = 'voice-note-42.mp3'): AttachIntent => ({
  intentId: crypto.randomUUID(),
  expected,
  cause: { kind: 'click', actionToken: 'tok_unit_voice_attach_01' },
  file: { name, type: 'audio/mpeg', bytes: new Uint8Array([0xff, 0xfb, 0x90, 0x64]).buffer },
});

/** The receipt once it came; undefined — the attempt is still open. */
function track(promise: Promise<AttachReceipt>): { readonly receipt: AttachReceipt | undefined } {
  const held: { receipt: AttachReceipt | undefined } = { receipt: undefined };
  void promise.then((receipt) => (held.receipt = receipt));
  return held;
}

const modalOpen = (): boolean => document.body.classList.contains('modal-opened');
const mainInput = (world: World): HTMLInputElement => {
  const input = world.page.composer()?.querySelector<HTMLInputElement>('.collapsable-actions > input[type=file]');
  if (input === null || input === undefined) throw new Error('no input');
  return input;
};
const reasons = (world: World): unknown[] => world.diagnostics.filter((d) => d.event === 'voice-attach').map((d) => d.detail?.['reason']);

describe('[host:fansly] the voice note into the composer: before anything reaches the page (FS-VOI-2)', () => {
  it('[FS-VOI-2] another document, composer or chat than the intent’s: refused before the token — nothing spent, nothing handed over', async () => {
    const { world } = await onChat();
    const opened = world.identity();
    for (const expected of [{ ...opened, documentEpoch: 'doc2' }, { ...opened, composerInstanceId: 'f99' }, { ...opened, hostLoginEpoch: 'fansly-9' }]) {
      expect(await world.port.attachFile(intent(expected))).toEqual({ state: 'refused', reason: 'identity' });
    }
    // The person went on to another chat: a file asked for chat A is no file for chat B.
    world.page.openChat(OTHER);
    await until('MAIN names the other fan', () => world.port.current().route.chat?.platformFanId === FANS[OTHER]);
    expect(await world.port.attachFile(intent(opened))).toEqual({ state: 'refused', reason: 'identity' });
    expect(world.redeemed).toEqual([]);
    expect(world.page.taken).toEqual([]);
    expect(modalOpen()).toBe(false);
  });

  it('[FS-VOI-2] the click’s token is spent before the page is touched: a refused one hands nothing over; a second click meanwhile is busy; a chat changed meanwhile gets nothing', async () => {
    const { world } = await onChat();
    world.allowRedeem(false);
    expect(await world.port.attachFile(intent(world.identity()))).toEqual({ state: 'refused', reason: 'cause' });
    expect(world.redeemed).toEqual(['insert']);
    expect(world.page.taken).toEqual([]);
    world.allowRedeem(true);
    const release = world.holdRedeem();
    const first = track(world.port.attachFile(intent(world.identity())));
    await settle();
    // The background is still spending the first click's token: nothing on the page yet, and a second click is busy.
    expect(world.redeemed).toEqual(['insert', 'insert']);
    expect(await world.port.attachFile(intent(world.identity()))).toEqual({ state: 'refused', reason: 'busy' });
    expect(world.redeemed).toEqual(['insert', 'insert']);
    expect(world.page.taken).toEqual([]);
    world.page.openChat(OTHER);
    release();
    await until('the first click answered', () => first.receipt !== undefined);
    expect(first.receipt).toEqual({ state: 'refused', reason: 'identity' });
    expect(world.page.taken).toEqual([]);
    expect(modalOpen()).toBe(false);
  });

  it('[FS-VOI-2] busy while a modal of Fansly is up or an attempt of ours is still watched; no input in the main composer — anchor-missing, and the contract says it broke', async () => {
    const { world, timer } = await onChat();
    world.page.modal(true);
    expect(await world.port.attachFile(intent(world.identity()))).toEqual({ state: 'refused', reason: 'busy' });
    world.page.modal(false);
    const first = track(world.port.attachFile(intent(world.identity())));
    await until('the modal opened', modalOpen);
    world.page.dismiss();
    await settle();
    // Closed, and still watched for 20 s: one more click is no second file on its way.
    expect(await world.port.attachFile(intent(world.identity()))).toEqual({ state: 'refused', reason: 'busy' });
    timer.fire(AFTER_CLOSE);
    await until('the first attempt ended', () => first.receipt !== undefined);
    expect(world.redeemed).toEqual(['insert']);
    mainInput(world).remove();
    expect(await world.port.attachFile(intent(world.identity()))).toEqual({ state: 'refused', reason: 'anchor-missing' });
    expect(world.redeemed).toEqual(['insert']);
    expect((await world.port.recheck()).capabilities.fileAttach).toEqual({ state: 'contractBroken', reason: 'fileInput', code: 'CG-HOST-CONTRACT' });
  });
});

describe('[host:fansly] the voice note into the composer: handed over once, then watched until Fansly shows it (§7.10)', () => {
  it('[FS-VOI-2] [AI-114] one MP3, one `change`, on the main composer’s own input; attached only once «Upload» put it among the attachments and closed the modal — however long the person took', async () => {
    const { world, timer } = await onChat();
    world.page.miniChat(true);
    let changes = 0;
    mainInput(world).addEventListener('change', () => (changes += 1));
    const pending = track(world.port.attachFile(intent(world.identity())));
    await until('the modal opened', modalOpen);
    expect(changes).toBe(1);
    expect(world.page.taken.map((files) => files.map((file) => [file.name, file.type, file.size]))).toEqual([[['voice-note-42.mp3', 'audio/mpeg', 4]]]);
    // The person is still choosing Free or PPV: no wait after a close runs, only the cap; nothing is handed again.
    await settle();
    expect(pending.receipt).toBeUndefined();
    expect([timer.armed(AFTER_CLOSE), timer.armed(CAP)]).toEqual([0, 1]);
    world.page.upload();
    await until('attached', () => pending.receipt !== undefined);
    expect(pending.receipt).toMatchObject({ state: 'attached' });
    expect(changes).toBe(1);
    // Watched no more; which path the file took is said.
    expect([timer.armed(AFTER_CLOSE), timer.armed(CAP)]).toEqual([0, 0]);
    expect(world.diagnostics.filter((d) => d.event === 'voice-attach')).toEqual([{ event: 'voice-attach', detail: { state: 'attached', reason: null, path: 'data-transfer', ms: expect.any(Number) } }]);
    expect((await world.port.health()).isolated.attach).toEqual({ dataTransfer: 1, cloneInto: 0, attached: 1, notAttached: 0, unknown: 0 });
    // A name that is no plain file name goes to the fan as `voice-<id>.mp3`.
    const odd = intent(world.identity(), '../войс 1.mp3');
    const second = track(world.port.attachFile(odd));
    await until('the modal opened again', modalOpen);
    expect(world.page.taken.at(-1)?.map((file) => file.name)).toEqual([`voice-${odd.intentId.slice(0, 8)}.mp3`]);
    world.page.upload();
    await until('attached again', () => second.receipt !== undefined);
    expect(second.receipt).toMatchObject({ state: 'attached' });
  });

  it('[FS-VOI-2] the modal closed with nothing new — the attachment already there is no new one: not attached (dismissed), once 20 s more brought nothing', async () => {
    const { world, timer } = await onChat();
    world.page.composer()?.querySelector('.message-attachments')?.append(Object.assign(document.createElement('app-account-media-create-template'), { className: 'attachment' }));
    const pending = track(world.port.attachFile(intent(world.identity())));
    await until('the modal opened', modalOpen);
    world.page.dismiss();
    await settle();
    expect(pending.receipt).toBeUndefined();
    expect(timer.armed(AFTER_CLOSE)).toBe(1);
    timer.fire(AFTER_CLOSE);
    await until('the attempt ended', () => pending.receipt !== undefined);
    expect(pending.receipt).toEqual({ state: 'not-attached', reason: 'dismissed' });
    expect(world.page.taken).toHaveLength(1);
    expect([timer.armed(AFTER_CLOSE), timer.armed(CAP)]).toEqual([0, 0]);
  });

  it('[FS-VOI-2] two new attachments, a modal again after ours closed empty, another chat while the modal is up: unknown — and the file is never handed over again', async () => {
    const { world, timer } = await onChat();
    const two = track(world.port.attachFile(intent(world.identity())));
    await until('the modal opened', modalOpen);
    world.page.upload(2);
    await until('the first attempt ended', () => two.receipt !== undefined);
    const again = track(world.port.attachFile(intent(world.identity())));
    await until('the modal opened', modalOpen);
    world.page.dismiss();
    await settle();
    world.page.modal(true);
    await until('the second attempt ended', () => again.receipt !== undefined);
    world.page.modal(false);
    const moved = track(world.port.attachFile(intent(world.identity())));
    await until('the modal opened', modalOpen);
    world.page.openChat(OTHER);
    await until('the third attempt ended', () => moved.receipt !== undefined);
    expect([two.receipt, again.receipt, moved.receipt]).toEqual([{ state: 'unknown' }, { state: 'unknown' }, { state: 'unknown' }]);
    expect(reasons(world)).toEqual(['two', 'modal-again', 'left']);
    expect(world.page.taken).toHaveLength(3);
    expect([timer.armed(AFTER_CLOSE), timer.armed(CAP)]).toEqual([0, 0]);
  });

  it('[FS-VOI-2] no modal at all, the person still in it at the cap, a dispatch that threw once it began: unknown', async () => {
    const { world, timer } = await onChat();
    const composer = world.page.composer();
    // A page that takes no file from its input (its handler gone): handed over, nothing shown.
    const swallow = (event: Event): void => event.stopImmediatePropagation();
    composer?.addEventListener('change', swallow, { capture: true });
    const ignored = track(world.port.attachFile(intent(world.identity())));
    await until('handed over', () => timer.armed(AFTER_CLOSE) === 1);
    timer.fire(AFTER_CLOSE);
    await until('the first attempt ended', () => ignored.receipt !== undefined);
    composer?.removeEventListener('change', swallow, { capture: true });
    const capped = track(world.port.attachFile(intent(world.identity())));
    await until('the modal opened', modalOpen);
    timer.fire(CAP);
    await until('the second attempt ended', () => capped.receipt !== undefined);
    world.page.dismiss();
    Object.defineProperty(mainInput(world), 'dispatchEvent', { configurable: true, value: () => { throw new Error('dead object'); } });
    expect(await world.port.attachFile(intent(world.identity()))).toEqual({ state: 'unknown' });
    expect([ignored.receipt, capped.receipt]).toEqual([{ state: 'unknown' }, { state: 'unknown' }]);
    expect(reasons(world)).toEqual(['not-taken', 'cap', 'dispatch']);
    expect(world.page.taken).toHaveLength(1);
    expect([timer.armed(AFTER_CLOSE), timer.armed(CAP)]).toEqual([0, 0]);
  });

  it('[FS-VOI-2] Firefox’s Xray refuses our FileList: the page’s own copy of the file goes on the one input the route’s chain names — never the mini-chat’s', async () => {
    const { world } = await onChat();
    world.page.miniChat(true);
    const input = mainInput(world);
    const files = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
    let refused = false;
    Object.defineProperty(input, 'files', {
      configurable: true,
      get: () => files?.get?.call(input),
      set(value: FileList) {
        if (!refused) {
          refused = true;
          throw new Error('Permission denied to access property');
        }
        files?.set?.call(input, value);
      },
    });
    const scope = globalThis as { cloneInto?: unknown; wrappedJSObject?: unknown };
    Object.assign(scope, { wrappedJSObject: window, cloneInto: <T>(value: T): T => value });
    cleanups.push(() => void (delete scope.wrappedJSObject, delete scope.cloneInto));
    const pending = track(world.port.attachFile(intent(world.identity())));
    await until('the modal opened', modalOpen);
    world.page.upload();
    await until('attached', () => pending.receipt !== undefined);
    expect(pending.receipt).toMatchObject({ state: 'attached' });
    expect(world.page.taken.map((list) => list.map((file) => file.name))).toEqual([['voice-note-42.mp3']]);
    expect((await world.port.health()).isolated.attach).toMatchObject({ dataTransfer: 0, cloneInto: 1, attached: 1 });
  });
});

describe('[host:fansly] fileAttach in the contract report (§7.12)', () => {
  it('[FS-CTR-2] on with the field’s chain, its file input, its attachments and the chat MAIN named; each gap says its own state', () => {
    const ok = Object.fromEntries(DOM_ANCHORS.map((anchor) => [anchor, 'ok'])) as DomAnchorStates;
    const fileAttach = (over: Partial<FanslyContractInput> = {}) =>
      buildFanslyReport({ bridge: true, wire: null, creator: true, observation: 'ready', dom: ok, build: null, adapterVersion: '0.1.0', checkedAt: 0, ...over }).capabilities.fileAttach;
    expect(fileAttach()).toEqual({ state: 'on' });
    // Not judged yet (no chat open since the page began) is no break.
    expect(fileAttach({ dom: { ...ok, fileInput: 'notYet', attachments: 'notYet' } })).toEqual({ state: 'on' });
    expect(fileAttach({ bridge: false })).toEqual({ state: 'off', reason: 'bridge', code: 'CG-HOST-NOT-READY' });
    expect(fileAttach({ observation: 'unknown' })).toEqual({ state: 'off', reason: 'focus', code: 'CG-HOST-NOT-READY' });
    expect(fileAttach({ dom: { ...ok, composer: 'missing' } })).toEqual({ state: 'off', reason: 'textarea', code: 'CG-HOST-COMPOSER-MISSING' });
    expect(fileAttach({ dom: { ...ok, fileInput: 'missing' } })).toEqual({ state: 'contractBroken', reason: 'fileInput', code: 'CG-HOST-CONTRACT' });
    expect(fileAttach({ dom: { ...ok, attachments: 'missing' } })).toEqual({ state: 'contractBroken', reason: 'attachments', code: 'CG-HOST-CONTRACT' });
    expect(fileAttach({ blocked: 'legacy' })).toEqual({ state: 'off', reason: 'legacy', code: 'CG-HOST-NOT-READY' });
  });
});
