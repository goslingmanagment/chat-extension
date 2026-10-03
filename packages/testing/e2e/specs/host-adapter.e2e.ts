// R09 part A on the R02 stand (architecture.md §6.1–§6.5, §6.9, §6.10, §12 п. 4):
// the ChatSpace adapter of @cg/host-chatspace in headless Firefox — the MAIN
// bridge in the page's realm, the isolated side in a WebDriver BiDi sandbox
// (support/host-harness.ts) — without the extension, which the integrator
// wires next. What it proves: the dock follows chat switches with several
// v-show composers, the blocked-fan row, degradation per removed anchor, the
// insert CAS (A→B→A, formatting, template/chip inserts, the translator,
// a restored draft), 200 fast switches with inserts in flight and not one in
// the wrong chat, navigation with a deferred insert (success, deadline,
// cancel), and zero requests of our own (network trap + stand journal).
// Test titles carry the parity rows they prove.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import type { StandBreak } from '../../fixture-chatspace/src/protocol';
import { harness, installHostHarness, waitForHarness, waitForHarnessState, type InstalledHarness } from '../support/host-harness';
import { useNetworkTrap } from '../support/network-trap';
import { callStand, chatPath, composerRoots, dockPlacement, foreignCalls, openStand, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a1, a2, a3, a4, a5, a6, a7, a8 } = STAND_IDS.fans;

type Receipt = { state: string; code?: string; needs?: string; draftRevision?: number };
interface HarnessState {
  identity: { routeEpoch: number; composerInstanceId: string | null; chat: { platformFanId: string } | null } | null;
  route: { epoch: number; chat: { platformFanId: string } | null };
  composer: { instanceId: string; hidden: boolean; ready: boolean; draft: { revision: number; provenance: string } } | null;
  accounts: Array<{ hostAccountId: string; platformAccountId: string | null }>;
  contract: { build: string | null; anchors: Record<string, string>; capabilities: Record<string, { state: string; reason?: string; code?: string }> };
  mounts: { dock: { kind: string; composerInstanceId: string | null } };
  theme: { scheme: string; tokens: number };
  diagnostics: Array<{ event: string }>;
}
interface DraftView {
  revision: number;
  digest: string;
  plainText: string;
  provenance: string;
}

const state = (): Promise<HarnessState> => harness<HarnessState>('state');
/** What the run measured, for the R09 report: .cache/e2e/host-adapter.json. */
const evidence: Record<string, unknown> = {};
const evidenceDir = fileURLToPath(new URL('../../../../.cache/e2e/', import.meta.url));

/**
 * Opens a stand path with ChatSpace's own local state cleared (drafts, chat
 * tabs: they outlive a reload) and waits for the adapter — the preload
 * scripts run again on every document — to see the app.
 */
async function open(path: string, breaks: readonly StandBreak[] = [], waitForChat = true): Promise<void> {
  await browser.execute(() => {
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith('chat-space:')) localStorage.removeItem(key);
    } catch {
      // about:blank before the first stand page
    }
  });
  await openStand(path, { breaks, waitForChat });
  await waitForHarness();
  if (!breaks.includes('vue-app')) await waitForHarnessState(state, (s) => s.contract.anchors['app'] === 'ok', 'adapter sees the app');
}

/** Waits until the adapter's identity shows the open chat with a ready composer. */
async function settledOn(fan: string): Promise<HarnessState> {
  return waitForHarnessState(state, (s) => s.identity?.chat?.platformFanId === fan && s.composer?.ready === true && s.mounts.dock.kind === 'in-flow', `adapter on ${fan}`);
}

async function activeComposerKey(): Promise<string> {
  const roots = await composerRoots();
  expect(roots.active).toHaveLength(1);
  return roots.active[0] ?? '';
}

/** Types into the active composer's editor like a person. */
async function typeInComposer(...keys: string[]): Promise<void> {
  const key = await activeComposerKey();
  await $(`[data-stand-composer="${key}"] .ProseMirror`).click();
  await browser.keys(keys);
}

async function composerText(fan: string): Promise<string | null> {
  return (await callStand('composerState', ACC, fan))?.text ?? null;
}

describe('R09 part A — the ChatSpace adapter on the stand', () => {
  const { trap } = useNetworkTrap();
  let journalStart = 0;
  let installed: InstalledHarness | null = null;

  before(async () => {
    await standServer.reset();
    journalStart = await standServer.mark();
    installed = await installHostHarness();
  });

  after(async () => {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(`${evidenceDir}host-adapter.json`, `${JSON.stringify({ ...evidence, harnessBytes: { main: installed?.mainBytes, isolated: installed?.isolatedBytes } }, null, 2)}\n`);
    await installed?.remove();
    // §12 «Гейт безопасности»: nothing but the page's own client and the harness talked to the stand.
    const entries = (await standServer.journal(journalStart)).entries;
    expect(foreignCalls(entries)).toEqual([]);
  });

  describe('bridge, identity and the host contract', () => {
    before(async () => {
      await open(chatPath(ACC, a1));
    });

    it('[EX-007] [EX-008] MAIN runs at document_start in the page realm and hands its port to the isolated side', async () => {
      const probe = await harness<{ readyStateAtStart: string; installMs: number }>('probe');
      evidence['mainInstallMs'] = probe.installMs;
      expect(probe.readyStateAtStart).toBe('loading');
      expect(probe.installMs).toBeLessThan(1);
      const s = await settledOn(a1);
      expect(s.identity).toMatchObject({ routeEpoch: 1, chat: { platformFanId: a1 } });
    });

    it('[AU-030] [DB-031] [NEW-09] on the stand every part A anchor is ok; the build fingerprint is the entry module', async () => {
      const s = await state();
      const entry = await browser.execute(() => /\/assets\/(index-[\w-]+)\.js/.exec(document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') ?? '')?.[1] ?? null);
      expect(s.contract.build).toBe(entry);
      const broken = Object.entries(s.contract.anchors).filter(([id, value]) => value !== 'ok' && id !== 'wsFrames' && id !== 'receiptProfile');
      expect(broken).toEqual([]);
      for (const name of ['identity', 'route', 'accounts', 'dockMount', 'insert', 'draftRead', 'chatWindow', 'freshText', 'fan', 'chatList', 'navigate', 'theme']) {
        expect([name, s.contract.capabilities[name]?.state]).toEqual([name, 'on']);
      }
      expect(s.contract.capabilities['previewSend']).toEqual({ state: 'off', reason: 'not-yet' });
    });

    it('[AU-034] [AU-035] the accounts ChatSpace loaded, each with its platformAccountId', async () => {
      const s = await state();
      expect(s.accounts.map((account) => [account.hostAccountId, account.platformAccountId])).toEqual([
        [STAND_IDS.accounts.a, STAND_IDS.platformAccounts.a],
        [STAND_IDS.accounts.b, STAND_IDS.platformAccounts.b],
        [STAND_IDS.accounts.c, STAND_IDS.platformAccounts.c],
      ]);
    });

    it('reads page memory only: chat window, fresh tail (no queued messages), fan, chat list; the theme follows .dark', async () => {
      const window = await harness<{ state: string; loaded: number; hasOlder: boolean | null }>('chatWindow');
      expect(window).toMatchObject({ state: 'ready' });
      expect(window.loaded).toBeGreaterThan(0);
      const tail = await harness<{ messages: Array<{ platformMessageId: string; text: string }> } | null>('tail', 10);
      expect(tail?.messages.length).toBeGreaterThan(0);
      expect(tail?.messages.every((message) => /^\d+$/.test(message.platformMessageId) && !message.text.includes('<'))).toBe(true);
      await waitForHarnessState(() => harness<unknown[]>('listChats', 50), (rows) => rows.length > 0, 'cached chat list');
      expect((await state()).theme).toMatchObject({ scheme: 'dark', tokens: 64 });
      await callStand('setTheme', 'light');
      await waitForHarnessState(state, (s) => s.theme.scheme === 'light', 'light theme');
      await callStand('setTheme', 'dark');
    });

    it('[BG-002] «Проверить» re-reads page memory and DOM and gives the same picture', async () => {
      const report = await harness<{ capabilities: Record<string, { state: string }> }>('recheck');
      expect(report.capabilities['insert']?.state).toBe('on');
    });
  });

  describe('[UI-001] the dock in ChatSpace’s composer (§6.3)', () => {
    before(async () => {
      await open(chatPath(ACC, a1));
      await settledOn(a1);
    });

    it('[UI-001] [UI-016] docks as the first child of the active composer root; the message list keeps its bottom', async () => {
      const key = await activeComposerKey();
      expect(await dockPlacement()).toEqual({ hosts: 1, parentKey: key, firstChild: true, visible: true });
      expect((await callStand('messageList'))?.atBottom).toBe(true);
    });

    it('[UI-001] follows chat switches with several v-show composers — one host, the same closed root', async () => {
      await harness('markDock');
      await callStand('openChat', ACC, a2, { newTab: true });
      await waitForChatReady(ACC, a2);
      await settledOn(a2);
      const second = await activeComposerKey();
      expect(second.endsWith(`:${a2}`)).toBe(true);
      await browser.waitUntil(async () => (await dockPlacement()).parentKey === second, { timeout: 3000, timeoutMsg: 'dock in the second composer' });
      expect(await dockPlacement()).toEqual({ hosts: 1, parentKey: second, firstChild: true, visible: true });
      const roots = await composerRoots();
      expect(roots.all).toHaveLength(2);
      expect(roots.firstSlotOwner).not.toBe(second);
      await callStand('openChat', ACC, a1);
      await settledOn(a1);
      const first = await activeComposerKey();
      await browser.waitUntil(async () => (await dockPlacement()).parentKey === first, { timeout: 3000, timeoutMsg: 'dock back in the first composer' });
      expect(await harness<boolean>('dockMarker')).toBe(true);
      expect((await callStand('messageList'))?.atBottom).toBe(true);
    });

    it('[UI-027] a blocked fan: a narrow copy-only row at the end of the composers container', async () => {
      await callStand('openChat', ACC, a3, { newTab: true });
      const s = await waitForHarnessState(state, (x) => x.composer?.hidden === true && x.mounts.dock.kind === 'copy-only-row', 'blocked fan row');
      expect(s.identity?.composerInstanceId).toBeNull();
      const placement = await browser.execute(() => {
        const host = document.querySelector('[data-cg="dock"]');
        const container = document.querySelector('[data-stand-composers]');
        return { inContainer: host?.parentElement === container, last: container?.lastElementChild === host, mode: host?.getAttribute('data-cg-mode') ?? null };
      });
      expect(placement).toEqual({ inContainer: true, last: true, mode: 'copy-only' });
      await callStand('openChat', ACC, a1);
      await settledOn(a1);
    });

    it('overlays live in <html> outside #app on their z-layers; data-dismissible-open keeps ChatSpace’s Esc from closing the chat tab', async () => {
      expect(await harness('overlay', 'modal')).toEqual({ layer: 'modal', z: '950', inHtml: true });
      expect(await harness('overlay', 'toast')).toEqual({ layer: 'toast', z: '960', inHtml: true });
      await harness('dismissible', 'modal', 'e2e', true);
      const tabs = await browser.execute(() => document.querySelectorAll('[data-chat-tab]').length);
      await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
      await browser.keys([Key.Escape]);
      await browser.pause(100);
      expect(await browser.execute(() => document.querySelectorAll('[data-chat-tab]').length)).toBe(tabs);
      await harness('dismissible', 'modal', 'e2e', false);
      expect(await browser.execute(() => document.querySelector('[data-cg-layer="modal"]')?.hasAttribute('data-dismissible-open'))).toBe(false);
    });
  });

  describe('the guarded insert (§6.4)', () => {
    beforeEach(async () => {
      await open(chatPath(ACC, a4));
      await settledOn(a4);
    });

    it('[UI-019] [NEW-06] [RB-009] into an empty draft: applied, verified against the draft key, cursor in the composer', async () => {
      const receipt = await harness<Receipt & { ms?: number }>('insert', { text: 'Hello from the stand' });
      expect(receipt).toMatchObject({ state: 'applied' });
      evidence['insertMs'] = receipt.ms;
      expect(await composerText(a4)).toBe('Hello from the stand');
      const stored = JSON.stringify(await callStand('draft', ACC, a4));
      expect(stored).toContain('Hello from the stand');
      const focused = await browser.execute(() => document.activeElement?.closest('.composer-frame') !== null);
      expect(focused).toBe(true);
      expect(await harness<DraftView>('draft')).toMatchObject({ provenance: 'our-insert', plainText: 'Hello from the stand' });
    });

    it('[NEW-05] [UI-020] a typed draft needs one-time consent for its revision; replace and append', async () => {
      await typeInComposer('m', 'y', ' ', 'w', 'o', 'r', 'd', 's');
      await waitForHarnessState(() => harness<DraftView>('draft'), (d) => d.plainText === 'my words', 'typed draft');
      expect(await harness<Receipt>('insert', { text: 'AI text' })).toEqual({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' });
      expect(await harness<Receipt>('insert', { text: 'appended', mode: 'append', confirm: true })).toMatchObject({ state: 'applied' });
      expect(await composerText(a4)).toBe('my words\nappended');
      expect(await harness<Receipt>('insert', { text: 'replaced', confirm: true })).toMatchObject({ state: 'applied' });
      expect(await composerText(a4)).toBe('replaced');
    });

    it('[AI-022] A→B→A, formatting, chip and template inserts all change the revision: a stale CAS is refused', async () => {
      await typeInComposer('A');
      const stale = await harness<unknown>('snapshotDraft');
      await browser.keys([Key.Backspace, 'B', Key.Backspace, 'A']);
      await waitForHarnessState(() => harness<DraftView>('draft'), (d) => d.plainText === 'A', 'A again');
      expect(await harness<Receipt>('insert', { text: 'x', confirm: true, from: stale })).toEqual({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-changed-draft' });

      const beforeBold = await harness<{ revision: number }>('snapshotDraft');
      await browser.keys([Key.Ctrl, 'a']);
      await browser.keys([Key.Ctrl, 'b']);
      await waitForHarnessState(() => harness<DraftView>('draft'), (d) => d.revision > beforeBold.revision, 'formatting changed the revision');
      expect((await callStand('composerState', ACC, a4))?.marks['bold']).toBe(true);
      expect(await harness<Receipt>('insert', { text: 'x', confirm: true, from: beforeBold })).toMatchObject({ needs: 'confirm-changed-draft' });

      const key = await activeComposerKey();
      for (const click of [`[data-stand-composer="${key}"] .composer-strip__quick .chip`, `[data-stand-composer="${key}"] [data-stand-templates]`]) {
        const before = await harness<{ revision: number }>('snapshotDraft');
        await $(click).click();
        if (click.includes('templates')) await $(`[data-stand-composer="${key}"] .templates-panel__item`).click();
        await waitForHarnessState(() => harness<DraftView>('draft'), (d) => d.revision > before.revision, `${click} changed the revision`);
        expect(await harness<Receipt>('insert', { text: 'x', confirm: true, from: before })).toMatchObject({ needs: 'confirm-changed-draft' });
      }
    });

    it('[AI-022] the translator’s clear + insertContent changes the revision too', async () => {
      await callStand('setPermissions', ['om_message_translator'], true);
      await callStand('setTranslator', ACC, { enabled: true, autoTranslate: true });
      await standServer.script(ACC, a4, [{ kind: 'hang' }]);
      await typeInComposer('t', 'r');
      const before = await harness<{ revision: number }>('snapshotDraft');
      const key = await activeComposerKey();
      await $(`[data-stand-composer="${key}"] [data-stand-send]`).click();
      await waitForHarnessState(() => harness<DraftView>('draft'), (d) => d.revision > before.revision, 'translation changed the revision');
      expect(await harness<Receipt>('insert', { text: 'x', confirm: true, from: before })).toMatchObject({ needs: 'confirm-changed-draft' });
      await callStand('setTranslator', ACC, { enabled: false, autoTranslate: false });
    });

    it('a restored draft (the tab closed and reopened) is a new composer: old intents are refused, the restored text needs consent', async () => {
      expect(await harness<Receipt>('insert', { text: 'kept in storage' })).toMatchObject({ state: 'applied' });
      const old = await harness<unknown>('snapshotDraft');
      await callStand('closeActiveChatTab');
      await callStand('openChat', ACC, a4, { newTab: true });
      await waitForChatReady(ACC, a4);
      const s = await settledOn(a4);
      expect(await composerText(a4)).toBe('kept in storage');
      expect(s.composer?.draft.provenance).toBe('human-or-unknown');
      expect(await harness<Receipt>('insert', { text: 'x', from: old })).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
      expect(await harness<Receipt>('insert', { text: 'x' })).toMatchObject({ state: 'rejected', needs: 'confirm-human-draft' });
    });

    it('[RB-014] [UI-026] an intent for the chat that was open is refused after a switch; expired and unredeemed intents write nothing', async () => {
      const prepared = await harness<unknown>('snapshotDraft');
      await callStand('openChat', ACC, a5, { newTab: true });
      await settledOn(a5);
      expect(await harness<Receipt>('insert', { text: 'meant for a4', from: prepared })).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
      expect(await composerText(a4)).toBe('');
      expect(await composerText(a5)).toBe('');
      expect(await harness<Receipt>('insert', { text: 'late', ttlMs: 5, holdMs: 30 })).toEqual({ state: 'rejected', code: 'CG-INSERT-FAILED' });
      const calls = (await callStand('journal')).filter((entry) => entry.type === 'bridge-call').length;
      await harness('setRedeem', false);
      expect(await harness<Receipt>('insert', { text: 'no token' })).toEqual({ state: 'rejected', code: 'CG-INSERT-FAILED' });
      await harness('setRedeem', true);
      expect((await callStand('journal')).filter((entry) => entry.type === 'bridge-call').length).toBe(calls);
    });
  });

  describe('[RB-014] 200 fast switches with inserts in flight', () => {
    it('[RB-014] [RB-015] [NEW-06] not one insert lands in a chat it was not aimed at', async () => {
      await open(chatPath(ACC, a1));
      await callStand('openChat', ACC, a2, { newTab: true });
      await waitForChatReady(ACC, a2);
      await callStand('openChat', ACC, a4, { newTab: true });
      await waitForChatReady(ACC, a4);
      await settledOn(a4);
      const fans = [a1, a2, a4];
      const since = (await callStand('journal')).at(-1)?.seq ?? 0;
      const results = await harness<Array<{ fan: string; text: string; receipt: Receipt }>>('race', { n: 200, fans });
      await browser.pause(300);
      const states = results.map((result) => result.receipt.state);
      const outcomes: Record<string, number> = {};
      for (const result of results) {
        const key = `${result.receipt.state}${result.receipt.code ? ` ${result.receipt.code}` : ''}`;
        outcomes[key] = (outcomes[key] ?? 0) + 1;
      }
      evidence['race'] = { switches: 200, inserts: results.length, skipped: await harness<number>('raceSkipped'), outcomes };
      expect(results.length).toBeGreaterThan(150);
      expect(states.filter((value) => value === 'applied').length).toBeGreaterThan(50);
      expect(states.filter((value) => value === 'rejected').length).toBeGreaterThan(20);
      expect(results.filter((result) => result.receipt.code === 'CG-INSERT-MISPLACED')).toEqual([]);
      expect(states.filter((value) => value === 'error')).toEqual([]);
      // Every setText ChatSpace saw went to the composer of the chat the intent was for.
      const writes = (await callStand('journal', since)).filter((entry) => entry.type === 'bridge-call' && entry['method'] === 'setText');
      for (const fan of fans) {
        const aimed = results.filter((result) => result.fan === fan && result.receipt.state !== 'rejected').length;
        expect([fan, writes.filter((entry) => entry['chatId'] === fan).length]).toEqual([fan, aimed]);
      }
      // The last applied text per chat is what its draft holds.
      for (const fan of fans) {
        const last = results.filter((result) => result.fan === fan && result.receipt.state === 'applied').at(-1);
        const text = await composerText(fan);
        if (last) expect([fan, text]).toEqual([fan, last.text]);
        if (text?.startsWith('R')) expect(text.endsWith(`@${fan}`)).toBe(true);
      }
    });
  });

  describe('navigation and «Открыть и вставить» (§6.5, §6.9)', () => {
    before(async () => {
      await open(chatPath(ACC, a1));
      await settledOn(a1);
    });

    const waitNavigation = (id: string, timeout = 8000): Promise<unknown> =>
      waitForHarnessState(() => harness<unknown>('navigation', id), (value) => value !== 'pending', `navigation ${id}`, timeout);

    it('[SP-035] [NF-011] opens a chat on a human action (router.push); ChatSpace loads its history as for a click', async () => {
      const mark = await standServer.mark();
      const id = await harness<string>('navigate', { acc: ACC, fan: a5 });
      const receipt = (await waitNavigation(id)) as { state: string; routeEpoch: number };
      expect(receipt.state).toBe('navigated');
      await settledOn(a5);
      expect(await callStand('route')).toMatchObject({ chatId: a5 });
      const loads = (await standServer.journal(mark)).entries.filter((entry) => entry.kind === 'history-load');
      expect(loads.every((entry) => entry.origin === 'native' && entry.chatId === a5)).toBe(true);
    });

    it('[NEW-01] [NF-011] open and insert: waits for the target’s working composer, then inserts once', async () => {
      const id = await harness<string>('navigate', { acc: ACC, fan: a6, text: 'Opened and inserted' });
      expect(await waitNavigation(id)).toMatchObject({ state: 'navigated', insert: { state: 'applied' } });
      expect(await composerText(a6)).toBe('Opened and inserted');
    });

    it('[NEW-01] deadline: the composer never gets ready in time → CG-NAV-TIMEOUT, nothing inserted later', async () => {
      await callStand('setEditorDelayMs', 3000);
      const id = await harness<string>('navigate', { acc: ACC, fan: a7, text: 'too late', ttlMs: 1200 });
      expect(await waitNavigation(id)).toEqual({ state: 'failed', code: 'CG-NAV-TIMEOUT', insert: { state: 'rejected', code: 'CG-NAV-TIMEOUT' } });
      await callStand('setEditorDelayMs', 0);
      await waitForChatReady(ACC, a7, 8000);
      expect(await composerText(a7)).toBe('');
    });

    it('[NEW-01] cancel: the person opens another chat while we wait → CG-INSERT-CANCELED, nothing inserted', async () => {
      await callStand('setEditorDelayMs', 2500);
      const id = await harness<string>('navigate', { acc: ACC, fan: a8, text: 'canceled' });
      await browser.waitUntil(async () => (await callStand('route')).chatId === a8, { timeout: 3000 });
      await callStand('openChat', ACC, a1);
      expect(await waitNavigation(id)).toMatchObject({ state: 'navigated', insert: { state: 'rejected', code: 'CG-INSERT-CANCELED' } });
      await callStand('setEditorDelayMs', 0);
      await callStand('openChat', ACC, a8);
      await waitForChatReady(ACC, a8, 8000);
      expect(await composerText(a8)).toBe('');
    });

    it('opens an account (Б13) and refuses without a redeemed human cause', async () => {
      const id = await harness<string>('navigate', { acc: STAND_IDS.accounts.b, fan: null });
      expect(await waitNavigation(id)).toMatchObject({ state: 'navigated' });
      await harness('setRedeem', false);
      const refused = await harness<string>('navigate', { acc: ACC, fan: a1 });
      expect(await waitNavigation(refused)).toEqual({ state: 'failed', code: 'CG-NAV-FAILED', insert: null });
      await harness('setRedeem', true);
      expect((await callStand('route')).accountId).toBe(STAND_IDS.accounts.b);
    });
  });

  describe('[RB-008] degradation when ChatSpace loses an anchor (§6.2)', () => {
    const capabilities = async (): Promise<HarnessState['contract']['capabilities']> => (await state()).contract.capabilities;

    it('[RB-008] [ER-048] no #app.__vue_app__: the host is not ready, no identity, no dock', async () => {
      await open(chatPath(ACC, a1), ['vue-app'], false);
      const s = await waitForHarnessState(state, (x) => x.contract.capabilities['identity']?.code === 'CG-HOST-NOT-READY', 'not ready');
      expect(s.identity).toBeNull();
      expect(s.mounts.dock.kind).toBe('none');
      expect((await dockPlacement()).hosts).toBe(0);
    });

    it('[RB-008] [ER-049] a renamed chat route breaks the route contract: CG-HOST-CONTRACT, no dock', async () => {
      await open(chatPath(ACC, a1), ['router-name'], false);
      const caps = await waitForHarnessState(capabilities, (c) => c['route']?.state === 'contractBroken', 'router broken');
      expect(caps['navigate']).toEqual({ state: 'contractBroken', reason: 'router', code: 'CG-HOST-CONTRACT' });
      expect((await state()).mounts.dock.kind).toBe('none');
    });

    it('[RB-008] [UI-027] without the composer bridge only copying is left (CG-HOST-COMPOSER-MISSING); the dock stays', async () => {
      await open(chatPath(ACC, a1), ['composer-bridge']);
      const caps = await waitForHarnessState(capabilities, (c) => c['insert']?.state === 'off', 'insert off');
      expect(caps['insert']).toEqual({ state: 'off', reason: 'composerBridge', code: 'CG-HOST-COMPOSER-MISSING' });
      expect((await state()).mounts.dock.kind).toBe('in-flow');
      expect(await harness<Receipt>('insert', { text: 'x' })).toEqual({ state: 'rejected', code: 'CG-HOST-COMPOSER-MISSING' });
    });

    it('[RB-008] without the frame root the dock floats over the composer and does not push the list', async () => {
      await open(chatPath(ACC, a1), ['composer-frame']);
      const s = await waitForHarnessState(state, (x) => x.mounts.dock.kind === 'fixed-overlay', 'fixed overlay');
      expect(s.contract.capabilities['dockMount']).toEqual({ state: 'degraded', reason: 'composerFrame' });
      const host = await browser.execute(() => {
        const element = document.querySelector<HTMLElement>('[data-cg="dock"]');
        return { parentIsHtml: element?.parentElement === document.documentElement, position: element?.style.position ?? null };
      });
      expect(host).toEqual({ parentIsHtml: true, position: 'fixed' });
      expect(await harness<Receipt>('insert', { text: 'still inserts' })).toMatchObject({ state: 'applied' });
    });

    it('[RB-008] without the editor handle there is no CAS promise: insert and draftRead degrade, a typed draft always needs consent', async () => {
      await open(chatPath(ACC, a1), ['editor-handle']);
      const caps = await waitForHarnessState(capabilities, (c) => c['insert']?.state === 'degraded', 'insert degraded');
      expect(caps['draftRead']).toEqual({ state: 'degraded', reason: 'editor' });
      expect(await harness<Receipt>('insert', { text: 'first' })).toMatchObject({ state: 'applied' });
      expect(await harness<Receipt>('insert', { text: 'second' })).toMatchObject({ state: 'rejected', needs: 'confirm-human-draft' });
    });

    it('[RB-008] a moved draft key degrades draftRead once a typed draft has no key', async () => {
      await open(chatPath(ACC, a1), ['draft-key']);
      await settledOn(a1);
      await typeInComposer('k', 'e', 'y');
      await waitForHarnessState(() => harness<DraftView>('draft'), (d) => d.plainText === 'key', 'typed');
      expect((await capabilities())['draftRead']).toEqual({ state: 'degraded', reason: 'draftKey' });
    });

    it('[RB-008] a renamed history key turns the fresh tail and the chat window off; a removed store shows as a missing anchor', async () => {
      await open(chatPath(ACC, a1), ['query-key:chatMessages', 'store:pendingMessages'], false);
      const caps = await waitForHarnessState(capabilities, (c) => c['freshText']?.state === 'off', 'fresh text off');
      expect(caps['chatWindow']).toEqual({ state: 'off', reason: 'chatMessages' });
      expect((await state()).contract.anchors['pendingMessages']).toBe('missing');
      expect(await harness('tail', 10)).toBeNull();
    });

    it('[RB-008] without the accounts list there is no binding key: identity off', async () => {
      await open(chatPath(ACC, a1), ['query-key:accounts'], false);
      const caps = await waitForHarnessState(capabilities, (c) => c['accounts']?.state !== 'on', 'accounts off');
      expect(caps['identity']?.state).not.toBe('on');
      expect((await state()).identity).toBeNull();
    });
  });

  describe('the security gate (§12)', () => {
    it('[RB-022] zero requests of our own and no history of chats nobody opened', async () => {
      const entries = (await standServer.journal(journalStart)).entries;
      expect(foreignCalls(entries)).toEqual([]);
      expect(entries.filter((entry) => entry.kind === 'history-load' && entry.origin !== 'native')).toEqual([]);
      expect(await trap().takeViolations()).toEqual([]);
    });
  });
});
