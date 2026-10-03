// The stand's own behaviour in Firefox, without the extension: the contracts
// R09 and the X8 matrix will lean on (architecture.md §12 п. 3) must hold on
// the fixture first — native send queue and its client, scripted answers,
// queue refusals, Esc / Alt+S / TipTap marks, drafts, keep-bottom, socket
// reconnects, query observers, a «new build», blocked fan, theme.

import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import type { ComposerSnapshot, PageJournalEntry, ServerJournalEntry } from '../../fixture-chatspace/src/protocol';
import { createDataset } from '../../src/stand/dataset';
import { DEFAULT_PERMISSIONS } from '../../src/stand/state';
import { useNetworkTrap } from '../support/network-trap';
import { callStand, chatPath, composerRoots, foreignCalls, openStand, STAND_IDS, standServer, waitForChatReady, waitForJournal } from '../support/stand';
import { setViewport } from '../support/visual';

const { a: accountA, b: accountB } = STAND_IDS.accounts;
const { a1, a2, a3, a4, a5, a6, b1 } = STAND_IDS.fans;
/** TipTap's Mod: ⌘ on macOS, Ctrl elsewhere. */
const MOD = process.platform === 'darwin' ? Key.Command : Key.Ctrl;
/** The shown chat tab's slot (v-show sets display: none on the others). */
const ACTIVE_SLOT = '[data-stand-composer-slot]:not([style*="display: none"])';
const ACTIVE_EDITOR = `${ACTIVE_SLOT} .ProseMirror`;
const ACTIVE_SEND = `${ACTIVE_SLOT} [data-stand-send]`;

async function pageMark(): Promise<number> {
  return (await callStand('journal')).at(-1)?.seq ?? 0;
}

async function pageJournal(since: number, type?: string): Promise<PageJournalEntry[]> {
  return (await callStand('journal', since)).filter((entry) => type === undefined || entry.type === type);
}

interface PendingView {
  readonly id: string;
  readonly chatId: string;
  readonly status: string;
  readonly error: { kind: string; guard?: { words: string[]; topics: string[] } | null } | null;
}

async function pending(accountId: string): Promise<PendingView[]> {
  return ((await callStand('pendingMessages')) as Record<string, PendingView[]>)[accountId] ?? [];
}

/** Calls an action of a page store by id, the way the extension's MAIN world would reach it. */
async function storeCall(storeId: string, action: string, args: unknown[]): Promise<unknown> {
  return browser.execute(
    (id: string, name: string, list: unknown[]) => {
      const app = document.querySelector<HTMLElement & { __vue_app__?: { config: { globalProperties: Record<string, unknown> } } }>('#app')?.__vue_app__;
      const pinia = app?.config.globalProperties['$pinia'] as { _s: Map<string, Record<string, unknown>> } | undefined;
      const fn = pinia?._s.get(id)?.[name];
      if (typeof fn !== 'function') throw new Error(`no ${id}.${name}`);
      const result: unknown = (fn as (...items: unknown[]) => unknown)(...list);
      return result === undefined ? null : (JSON.parse(JSON.stringify(result)) as unknown);
    },
    storeId,
    action,
    args,
  );
}

/** Types into the shown composer (element send-keys: one key at a time, repeats included). */
async function typeInActiveComposer(text: string): Promise<void> {
  await $(ACTIVE_EDITOR).click();
  await $(ACTIVE_EDITOR).addValue(text);
}

async function setComposerText(accountId: string, chatId: string, text: string): Promise<void> {
  await browser.execute(
    (account: string, chat: string, value: string) => {
      const slot = [...document.querySelectorAll<HTMLElement>('[data-stand-composer]')]
        .find((root) => root.getAttribute('data-stand-composer')?.endsWith(`:${account}:${chat}`))
        ?.querySelector('[data-id="browser-composer-translator"]') as (HTMLElement & { __omComposerBridge?: { setText(text: string): void } }) | null;
      if (!slot?.__omComposerBridge) throw new Error('no bridge');
      slot.__omComposerBridge.setText(value);
    },
    accountId,
    chatId,
    text,
  );
}

const sendsOf = (entries: readonly ServerJournalEntry[], chatId: string): ServerJournalEntry[] => entries.filter((entry) => entry.kind === 'send' && entry.chatId === chatId);
const historyLoadsOf = (entries: readonly ServerJournalEntry[], chatId: string): ServerJournalEntry[] => entries.filter((entry) => entry.kind === 'history-load' && entry.chatId === chatId);

describe('the ChatSpace-like stand on its own', () => {
  useNetworkTrap();
  let journalStart = 0;

  before(async () => {
    await standServer.reset();
    journalStart = await standServer.mark();
    await openStand(chatPath(accountA, a1));
  });

  after(async () => {
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
  });

  it('a human Send goes through the native queue: request created on the same stack with the native fetch, echo after the response, draft cleared', async () => {
    const page = await pageMark();
    const server = await standServer.mark();
    await typeInActiveComposer('Hello stand');
    const draft = (await callStand('draft', accountA, a1)) as { body?: { json?: { type?: string } }; updatedAt?: number } | null;
    expect(draft?.body?.json?.type).toBe('doc');
    expect(typeof draft?.updatedAt).toBe('number');
    await browser.keys(Key.Enter);
    const entries = await waitForJournal((items) => items.some((entry) => entry.kind === 'ws-out' && entry.detail?.['event'] === 'account_new_message'), server, 'outgoing echo');
    const [send] = sendsOf(entries, a1);
    expect(send).toMatchObject({ origin: 'native', accountId: accountA, detail: { outcome: 'ok', text: '<p>Hello stand</p>', isCopied: false, isAiGenerated: false, replyTime: null } });
    expect((send?.detail?.['previousMessage'] as { is_fan_message?: boolean } | null)?.is_fan_message).toBe(true);
    const requests = await pageJournal(page, 'http-request');
    const post = requests.find((entry) => entry['method'] === 'POST' && String(entry['path']).endsWith(`/chats/${a1}/messages`));
    expect(post).toMatchObject({ fetchCapture: 'native', attempt: 'first' });
    // The request object was created on the stack of the queue entry (before any await).
    const added = (await pageJournal(page, 'queue-added'))[0];
    expect(post?.seq).toBe((added?.seq ?? 0) + 2);
    await browser.waitUntil(async () => (await pending(accountA)).length === 0, { timeout: 5000, timeoutMsg: 'queue entry stays' });
    expect(await callStand('draft', accountA, a1)).toBeNull();
    const history = (await callStand('queryData', ['chatMessages', accountA, a1])) as { pages: Array<{ items: Array<{ id: string; text: string }> }> };
    expect(history.pages[0]?.items[0]?.text).toBe('<p>Hello stand</p>');
  });

  it('scripted answers: Message Guard → FAILED blocked; 401 → one bare re-run after a fresh session token; a hang → timeout', async () => {
    await callStand('scriptSend', accountA, a1, [{ kind: 'guard', words: ['stand-word'], topics: ['direct_contact'] }]);
    let server = await standServer.mark();
    await setComposerText(accountA, a1, 'guarded text');
    await $(ACTIVE_SEND).click();
    await browser.waitUntil(async () => (await pending(accountA))[0]?.status === 'failed', { timeout: 5000, timeoutMsg: 'guard failure' });
    const [blocked] = await pending(accountA);
    expect(blocked?.error).toEqual({ kind: 'blocked', guard: { words: ['stand-word'], topics: ['Direct contact'] } });
    // Never retried on its own.
    await browser.pause(300);
    expect(sendsOf((await standServer.journal(server)).entries, a1)).toHaveLength(1);
    await storeCall('pendingMessages', 'cancel', [accountA, blocked?.id]);

    await callStand('scriptSend', accountA, a1, [{ kind: 'status', status: 401 }, { kind: 'ok' }]);
    const page = await pageMark();
    server = await standServer.mark();
    await setComposerText(accountA, a1, 'after a 401');
    await $(ACTIVE_SEND).click();
    await browser.waitUntil(async () => sendsOf((await standServer.journal(server)).entries, a1).length === 2 && (await pending(accountA)).length === 0, {
      timeout: 5000,
      timeoutMsg: '401 then 200',
    });
    const posts = (await pageJournal(page, 'http-request')).filter((entry) => entry['method'] === 'POST' && String(entry['path']).endsWith('/messages'));
    expect(posts.map((entry) => entry['attempt'])).toEqual(['first', 'after-401']);
    expect((await pageJournal(page, 'auth-refresh')).length).toBe(1);
    expect(sendsOf((await standServer.journal(server)).entries, a1).map((entry) => entry.detail?.['outcome'])).toEqual(['status', 'ok']);

    await callStand('setQueueTimeoutMs', 1200);
    await callStand('scriptSend', accountA, a1, [{ kind: 'hang' }]);
    server = await standServer.mark();
    await setComposerText(accountA, a1, 'into the void');
    await $(ACTIVE_SEND).click();
    await browser.waitUntil(async () => (await pending(accountA))[0]?.error?.kind === 'timeout', { timeout: 5000, timeoutMsg: 'timeout failure' });
    await waitForJournal((items) => items.some((entry) => entry.kind === 'send-aborted' && entry.chatId === a1), server, 'aborted hanging POST');
    await callStand('setQueueTimeoutMs', 30_000);
    await storeCall('pendingMessages', 'resetForAccount', [accountA]);
  });

  it('the queue refuses with null: Mimic runs the chat; 50 entries in one chat', async () => {
    await callStand('setMimic', { isActive: true, chats: { [`${accountA}:${a2}`]: 'enabled' } });
    const input = { accountId: accountA, chatId: a2, platform: 'onlyfans', text: '<p>x</p>', platformMetadata: {} };
    expect(await storeCall('pendingMessages', 'enqueue', [input])).toBeNull();
    await callStand('setMimic', { isActive: false, chats: {} });

    await callStand('scriptSend', accountA, a4, [{ kind: 'hang' }]);
    const results: unknown[] = [];
    for (let index = 0; index < 51; index += 1) results.push(await storeCall('pendingMessages', 'enqueue', [{ ...input, chatId: a4, text: `<p>n${index}</p>` }]));
    expect(results.slice(0, 50).every((entry) => entry !== null)).toBe(true);
    expect(results[50]).toBeNull();
    const queued = await pending(accountA);
    expect(queued.filter((entry) => entry.status === 'sending')).toHaveLength(1);
    expect(queued.filter((entry) => entry.status === 'pending')).toHaveLength(49);
    await storeCall('pendingMessages', 'resetForAccount', [accountA]);
    expect(await pending(accountA)).toEqual([]);
  });

  it('Esc closes the chat tab from the composer (last resort), not while a [data-dismissible-open] panel is open', async () => {
    await callStand('openChat', accountA, a2, { newTab: true });
    await waitForChatReady(accountA, a2);
    expect((await callStand('composers')).length).toBe(2);
    const page = await pageMark();
    await $(`${ACTIVE_SLOT} [data-stand-templates]`).click();
    await expect($('[data-dismissible-open]')).toBeDisplayed();
    await browser.keys(Key.Escape);
    await expect($('[data-dismissible-open]')).not.toBeExisting();
    expect(await pageJournal(page, 'chat-tab-closed')).toEqual([]);
    expect((await callStand('route')).chatId).toBe(a2);

    await $(ACTIVE_EDITOR).click();
    await browser.keys(Key.Escape);
    await browser.waitUntil(async () => (await callStand('route')).chatId === a1, { timeout: 5000, timeoutMsg: 'Esc did not close the chat tab' });
    expect((await pageJournal(page, 'chat-tab-closed'))[0]).toMatchObject({ accountId: accountA, chatId: a2, via: 'escape' });
    await browser.waitUntil(async () => (await callStand('composers')).length === 1, { timeout: 5000, timeoutMsg: 'closed tab keeps its composer' });
  });

  it('Alt+S toggles the translator (capture on the composer root); Mod+I / Mod+E toggle italic and inline code', async () => {
    await $(ACTIVE_EDITOR).click();
    await browser.keys([Key.Alt, 's']);
    const stored = await browser.execute(() => {
      const key = Object.keys(localStorage).find((name) => name.startsWith('chat-space:composer-translator:accounts:'));
      return key === undefined ? null : (JSON.parse(localStorage.getItem(key) ?? 'null') as Record<string, { enabled?: boolean }>);
    });
    expect(stored?.[accountA]?.enabled).toBe(true);
    expect((await callStand('composerState', accountA, a1))?.text).toBe('');
    await callStand('setTranslator', accountA, { enabled: false });

    await browser.keys([MOD, 'i']);
    await browser.keys(['x']);
    await browser.keys([MOD, 'i']);
    await browser.keys([MOD, 'e']);
    await browser.keys(['y']);
    expect((await callStand('composerState', accountA, a1))?.html).toBe('<p><em>x</em><code>y</code></p>');
    await setComposerText(accountA, a1, '');
  });

  it('the draft is TipTap JSON in chat-space:draft:of:{acc}:{fan} and comes back after a reload', async () => {
    await setComposerText(accountA, a1, 'Draft line\nsecond');
    const draft = (await callStand('draft', accountA, a1)) as { body: { json: { content: Array<{ content: Array<{ type: string }> }> } } };
    expect(draft.body.json.content[0]?.content.map((node) => node.type)).toEqual(['text', 'hardBreak', 'text']);
    await openStand(chatPath(accountA, a1));
    expect((await callStand('composerState', accountA, a1))?.html).toBe('<p>Draft line<br>second</p>');
    await setComposerText(accountA, a1, '');
    expect(await callStand('draft', accountA, a1)).toBeNull();
  });

  it('the bridge exists as soon as the composer mounts and does nothing until TipTap loads; every re-render puts a new bridge object', async () => {
    await callStand('setEditorDelayMs', 2000);
    try {
      await callStand('openChat', accountA, a5, { newTab: true });
      await browser.waitUntil(async () => (await callStand('composers')).some((composer) => composer.chatId === a5 && composer.shown), { timeout: 5000, timeoutMsg: 'no composer for a5' });
      const early = await browser.execute((account: string, chat: string) => {
        const slot = slotOf(account, chat);
        const bridge = slot?.__omComposerBridge;
        let threw = false;
        try {
          bridge?.setText('lost before the editor');
          bridge?.insertText(' and this');
        } catch {
          threw = true;
        }
        return { bridge: bridge !== undefined, editor: (slot?.closest('.composer-frame')?.querySelector('.ProseMirror') ?? null) !== null, threw };

        function slotOf(a: string, c: string): (HTMLElement & { __omComposerBridge?: { setText(text: string): void; insertText(text: string): void } }) | null {
          const root = [...document.querySelectorAll<HTMLElement>('[data-stand-composer]')].find((node) => node.getAttribute('data-stand-composer')?.endsWith(`:${a}:${c}`));
          return root?.querySelector('[data-id="browser-composer-translator"]') ?? null;
        }
      }, accountA, a5);
      expect(early).toEqual({ bridge: true, editor: false, threw: false });
    } finally {
      await callStand('setEditorDelayMs', 0);
    }
    await waitForChatReady(accountA, a5);
    // The early calls were lost, not replayed later.
    expect((await callStand('composerState', accountA, a5))?.text).toBe('');
    const renewed = await browser.execute(async (account: string, chat: string) => {
      const root = [...document.querySelectorAll<HTMLElement>('[data-stand-composer]')].find((node) => node.getAttribute('data-stand-composer')?.endsWith(`:${account}:${chat}`));
      const slot = root?.querySelector<HTMLElement & { __omComposerBridge?: object }>('[data-id="browser-composer-translator"]');
      const toggle = root?.querySelector<HTMLElement>('[data-stand-templates]');
      const first = slot?.__omComposerBridge;
      toggle?.click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const second = slot?.__omComposerBridge;
      toggle?.click();
      return first !== undefined && second !== undefined && first !== second;
    }, accountA, a5);
    expect(renewed).toBe(true);
    await callStand('closeActiveChatTab');
    await browser.waitUntil(async () => (await callStand('route')).chatId === a1, { timeout: 5000, timeoutMsg: 'back to a1' });
  });

  it("bridge.focus() keeps the human's cursor: insertText lands mid-draft, not at the end", async () => {
    await typeInActiveComposer('Hello world');
    for (let step = 0; step < 'world'.length + 1; step += 1) await browser.keys(Key.ArrowLeft);
    await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
    await browser.execute(
      (account: string, chat: string) => {
        const root = [...document.querySelectorAll<HTMLElement>('[data-stand-composer]')].find((node) => node.getAttribute('data-stand-composer')?.endsWith(`:${account}:${chat}`));
        const bridge = (root?.querySelector('[data-id="browser-composer-translator"]') as (HTMLElement & { __omComposerBridge?: { focus(): void; insertText(text: string): void } }) | null)?.__omComposerBridge;
        bridge?.focus();
        bridge?.insertText(' dear');
      },
      accountA,
      a1,
    );
    expect((await callStand('composerState', accountA, a1))?.text).toBe('Hello dear world');
    await setComposerText(accountA, a1, '');
  });

  it('the draft key changes a microtask after a bridge call, not inside it', async () => {
    const timing = await browser.execute(
      async (account: string, chat: string) => {
        const key = `chat-space:draft:of:${account}:${chat}`;
        const root = [...document.querySelectorAll<HTMLElement>('[data-stand-composer]')].find((node) => node.getAttribute('data-stand-composer')?.endsWith(`:${account}:${chat}`));
        const bridge = (root?.querySelector('[data-id="browser-composer-translator"]') as (HTMLElement & { __omComposerBridge?: { setText(text: string): void } }) | null)?.__omComposerBridge;
        const before = localStorage.getItem(key);
        bridge?.setText('written a microtask later');
        const inTheCall = localStorage.getItem(key);
        await Promise.resolve();
        const after = localStorage.getItem(key);
        return { unchangedInTheCall: inTheCall === before, writtenAfter: after !== null && after.includes('written a microtask later') };
      },
      accountA,
      a1,
    );
    expect(timing).toEqual({ unchangedInTheCall: true, writtenAfter: true });
    await setComposerText(accountA, a1, '');
  });

  it('the editor is set up as on the host: a placeholder, and a typed URL becomes a link (in the HTML and the draft)', async () => {
    expect(await browser.execute((selector: string) => document.querySelector(`${selector} p.is-editor-empty`)?.getAttribute('data-placeholder') ?? null, ACTIVE_EDITOR)).toBe('Stand message…');
    await typeInActiveComposer('see https://example.com/stand ');
    expect((await callStand('composerState', accountA, a1))?.html).toMatch(/<a [^>]*href="https:\/\/example\.com\/stand"/);
    expect(JSON.stringify(await callStand('draft', accountA, a1))).toContain('"type":"link"');
    await setComposerText(accountA, a1, '');
  });

  it('the message list keeps the bottom when the box above the composer grows, and its anchor when scrolled up', async () => {
    // Short enough that the first history page overflows.
    await setViewport({ width: 1280, height: 600 });
    await browser.waitUntil(async () => (await callStand('messageList'))?.atBottom === true, { timeout: 3000, timeoutMsg: 'list not at the bottom after the resize' });
    const insertBlock = async (): Promise<void> => {
      await browser.execute((selector: string) => {
        const root = document.querySelector(`${selector} [data-stand-composer]`);
        const block = document.createElement('div');
        block.setAttribute('data-stand-test-block', '');
        block.style.height = '120px';
        root?.insertBefore(block, root.firstChild);
      }, ACTIVE_SLOT);
      await browser.execute(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    };
    const removeBlock = async (): Promise<void> => {
      await browser.execute(() => document.querySelector('[data-stand-test-block]')?.remove());
    };
    expect((await callStand('messageList'))?.atBottom).toBe(true);
    await insertBlock();
    // The list reacts in its ResizeObserver callback; give it a few frames.
    let state = await callStand('messageList');
    await browser
      .waitUntil(
        async () => {
          state = await callStand('messageList');
          return state?.atBottom === true;
        },
        { timeout: 2000, interval: 50 },
      )
      .catch(async () => {
        const debug = await browser.execute(() => ({ w: innerWidth, h: innerHeight, blocks: document.querySelectorAll('[data-stand-test-block]').length, slots: [...document.querySelectorAll<HTMLElement>('[data-stand-composer-slot]')].map((slot) => slot.style.display) }));
        throw new Error(`the list lost the bottom when the box above the composer grew: ${JSON.stringify(state)} ${JSON.stringify(debug)} ${JSON.stringify((await callStand('journal')).slice(-15))}`);
      });
    await removeBlock();

    const anchor = async (): Promise<{ id: string | null; offset: number }> =>
      browser.execute(() => {
        const scroller = document.querySelector<HTMLElement>('[data-stand-message-list]');
        const first = [...document.querySelectorAll<HTMLElement>('[data-stand-message-id]')].find((node) => scroller !== null && node.offsetTop + node.offsetHeight > scroller.scrollTop + 1);
        return { id: first?.dataset['standMessageId'] ?? null, offset: first === undefined || scroller === null ? 0 : first.offsetTop - scroller.scrollTop };
      });
    await browser.execute(() => {
      const scroller = document.querySelector<HTMLElement>('[data-stand-message-list]');
      if (scroller !== null) scroller.scrollTop = Math.round((scroller.scrollHeight - scroller.clientHeight) / 2);
    });
    await browser.pause(100);
    const before = await anchor();
    await insertBlock();
    let after = await anchor();
    await browser.waitUntil(
      async () => {
        after = await anchor();
        return after.id === before.id && Math.abs(after.offset - before.offset) <= 1;
      },
      { timeout: 2000, interval: 50, timeoutMsg: `the anchor moved: ${JSON.stringify(before)} → ${JSON.stringify(after)}` },
    );
    expect((await callStand('messageList'))?.atBottom).toBe(false);
    await removeBlock();
    await setViewport(null);
  });

  it('socket and cache: reconnects make a new socket; pushes to unloaded or inactive chats load no history; a held observer would', async () => {
    const sockets = (await callStand('wsStatus')).sockets;
    await standServer.wsClose();
    await browser.waitUntil(async () => {
      const status = await callStand('wsStatus');
      return status.sockets === sockets + 1 && status.authenticated;
    }, { timeout: 10_000, timeoutMsg: 'no new socket after the server closed the old one' });
    await browser.waitUntil(async () => (await standServer.state()).sockets.some((socket) => socket.label === 'native' && socket.authenticated && socket.accounts.includes(accountA)), {
      timeout: 5000,
      timeoutMsg: 'the new socket did not resubscribe',
    });

    // Open a2 and leave it: its history stays cached but nobody observes it.
    await callStand('openChat', accountA, a2);
    await waitForChatReady(accountA, a2);
    await callStand('openChat', accountA, a1);
    await waitForChatReady(accountA, a1);
    const cached = await callStand('queryState', ['chatMessages', accountA, a2]);
    expect(cached).toMatchObject({ exists: true, hasData: true, active: false });
    const server = await standServer.mark();
    await standServer.fanMessage(accountA, a2, 'push into an inactive cache');
    await standServer.fanMessage(accountA, a4, 'push into a chat never opened');
    await browser.pause(400);
    let entries = (await standServer.journal(server)).entries;
    expect(historyLoadsOf(entries, a2)).toEqual([]);
    expect(historyLoadsOf(entries, a4)).toEqual([]);
    expect(await callStand('queryState', ['chatMessages', accountA, a4])).toMatchObject({ exists: false });

    const token = await callStand('holdQueryObserver', ['chatMessages', accountA, a4]);
    expect(await callStand('queryState', ['chatMessages', accountA, a4])).toMatchObject({ exists: true, active: true, hasData: false });
    await standServer.fanMessage(accountA, a4, 'push while observed');
    entries = await waitForJournal((items) => historyLoadsOf(items, a4).length === 1, server, 'history load of an observed chat');
    expect(historyLoadsOf(entries, a4)[0]?.origin).toBe('native');
    await callStand('releaseQueryObserver', token);
    expect((await callStand('queryState', ['chatMessages', accountA, a4])).active).toBe(false);
  });

  it('a «new build» without anchors: no pendingMessages store, no bridge, the chat route renamed', async () => {
    await openStand(chatPath(accountA, a1), { breaks: ['store:pendingMessages', 'composer-bridge', 'router-name'] });
    const shape = await browser.execute(() => {
      const app = document.querySelector<HTMLElement & { __vue_app__?: { config: { globalProperties: Record<string, unknown> } } }>('#app')?.__vue_app__;
      const pinia = app?.config.globalProperties['$pinia'] as { _s: Map<string, unknown> } | undefined;
      const router = app?.config.globalProperties['$router'] as { currentRoute: { value: { name: unknown } } } | undefined;
      const slot = document.querySelector('[data-stand-composer-slot]:not([style*="display: none"]) [data-id="browser-composer-translator"]');
      return { pending: pinia?._s.has('pendingMessages'), route: router?.currentRoute.value.name, bridge: slot !== null && '__omComposerBridge' in slot, editor: document.querySelector('.ProseMirror') !== null };
    });
    expect(shape).toEqual({ pending: false, route: 'conversation', bridge: false, editor: true });
    const composers: readonly ComposerSnapshot[] = await callStand('composers');
    expect(composers.map((composer) => [composer.chatId, composer.shown, composer.hasEditor, composer.hasBridge])).toEqual([[a1, true, true, false]]);
    await openStand(chatPath(accountA, a1));
  });

  it("opening a blocked fan's chat loads its history (a read on the platform) and hides the composer; unblocking shows it", async () => {
    const server = await standServer.mark();
    await callStand('openChat', accountA, a3, { newTab: true });
    await browser.waitUntil(async () => (await callStand('composers')).some((composer) => composer.chatId === a3), { timeout: 5000, timeoutMsg: 'no composer for the blocked fan' });
    await expect($('[data-stand-fan-blocked]')).toBeDisplayed();
    expect((await callStand('composers')).find((composer) => composer.chatId === a3)?.shown).toBe(false);
    const loads = await waitForJournal((items) => historyLoadsOf(items, a3).length === 1, server, 'history load of the blocked chat');
    expect(historyLoadsOf(loads, a3)[0]?.origin).toBe('native');
    await callStand('setFan', accountA, a3, { isBlocked: false });
    await waitForChatReady(accountA, a3);
    await callStand('closeActiveChatTab');
  });

  it('no composer, slot or bridge where the host renders none: Mimic running, role without sending, fan that cannot receive, Mimic data loading', async () => {
    const activeSlot = async (): Promise<{ slot: boolean; translator: boolean; notice: string | null; mimic: boolean }> =>
      browser.execute((selector: string) => {
        const slot = document.querySelector(selector);
        return {
          slot: slot !== null,
          translator: (slot?.querySelector('[data-id="browser-composer-translator"]') ?? null) !== null,
          notice: slot?.querySelector('[data-testid="chat-unavailable-notice"]')?.textContent ?? null,
          mimic: (slot?.querySelector('[data-stand-mimic-panel]') ?? null) !== null,
        };
      }, ACTIVE_SLOT);
    const until = async (want: (state: Awaited<ReturnType<typeof activeSlot>>) => boolean, what: string): Promise<void> => {
      await browser.waitUntil(async () => want(await activeSlot()), { timeout: 5000, timeoutMsg: what });
      expect((await composerRoots()).active).toEqual([]);
    };

    await callStand('setMimic', { isActive: true, chats: { [`${accountA}:${a6}`]: 'enabled' } });
    await callStand('openChat', accountA, a6, { newTab: true });
    await until((state) => state.slot && state.mimic && !state.translator && state.notice === null, 'Mimic panel without a composer');
    await callStand('setMimic', { isActive: false, chats: {} });
    await waitForChatReady(accountA, a6);

    await callStand('setPermissions', [...DEFAULT_PERMISSIONS, 'of_block_message_sending']);
    await until((state) => !state.translator && (state.notice ?? '').includes('Your role cannot send messages'), 'role notice without a composer');
    // An owner sends whatever the role says.
    await callStand('setPermissions', [...DEFAULT_PERMISSIONS, 'of_block_message_sending'], true);
    await waitForChatReady(accountA, a6);
    await callStand('setPermissions', [...DEFAULT_PERMISSIONS], false);

    await callStand('setFan', accountA, a6, { canReceiveChatMessage: false });
    await until((state) => !state.translator && (state.notice ?? '').includes('Messaging restricted'), 'restricted notice without a composer');
    await callStand('setFan', accountA, a6, { canReceiveChatMessage: true });
    await waitForChatReady(accountA, a6);
    await callStand('closeActiveChatTab');

    await standServer.holdMimic(true);
    try {
      await openStand(chatPath(accountA, a1), { waitForChat: false });
      await until((state) => state.slot && !state.translator && state.notice === null && !state.mimic, 'nothing while Mimic data loads');
    } finally {
      await standServer.holdMimic(false);
    }
    await waitForChatReady(accountA, a1);
  });

  it("composers live per account: another account's composers unmount, and coming back mounts fresh ones", async () => {
    const page = await pageMark();
    const before = (await callStand('composers')).map((composer) => composer.key);
    expect(before.length).toBeGreaterThan(0);
    await callStand('openChat', accountB, b1);
    await waitForChatReady(accountB, b1);
    expect((await callStand('composers')).map((composer) => composer.accountId)).toEqual([accountB]);
    await callStand('openChat', accountA, a1);
    await waitForChatReady(accountA, a1);
    expect((await callStand('composers')).every((composer) => composer.accountId === accountA)).toBe(true);
    const unmounted = (await pageJournal(page, 'composer-unmounted')).map((entry) => entry['key']);
    const mounted = (await pageJournal(page, 'composer-mounted')).map((entry) => entry['key']);
    for (const key of before) {
      expect(unmounted).toContain(key);
      expect(mounted).toContain(key);
    }
  });

  it('chat-list scopes, anchored history and pinned messages use the host keys', async () => {
    const listKey = (...rest: string[]): string[] => ['chatList', accountA, ...rest];
    const active = async (key: string[]): Promise<boolean> => (await callStand('queryState', key)).active;
    await $('[data-stand-chat-scope]').selectByAttribute('value', 'filter:unread');
    await browser.waitUntil(async () => active(listKey('filter:unread')), { timeout: 5000, timeoutMsg: 'unread list not observed' });
    expect(await active(listKey('all'))).toBe(false);
    await $('[data-testid="chats-panel-search-input"]').setValue('fern');
    await browser.keys(Key.Enter);
    await browser.waitUntil(async () => active(listKey('filter:unread', 'search:fern')), { timeout: 5000, timeoutMsg: 'search list not observed' });
    await $('[data-stand-chat-order]').click();
    await browser.waitUntil(async () => active(listKey('filter:unread', 'search:fern', 'order:old')), { timeout: 5000, timeoutMsg: 'old-first list not observed' });
    await $('[data-stand-chat-scope]').selectByAttribute('value', 'all');
    await $('[data-testid="chats-panel-search-input"]').clearValue();
    await browser.keys(Key.Enter);
    await $('[data-stand-chat-order]').click();
    await browser.waitUntil(async () => active(listKey('all')), { timeout: 5000, timeoutMsg: 'back to all chats' });

    const anchorId = createDataset().chats.get(`${accountA}:${a1}`)?.messages[20]?.id ?? '';
    const server = await standServer.mark();
    await callStand('openChat', accountA, a1, { firstId: anchorId });
    await browser.waitUntil(async () => (await callStand('queryState', ['chatMessages', accountA, a1, anchorId])).hasData, { timeout: 5000, timeoutMsg: 'anchored history' });
    expect(historyLoadsOf((await standServer.journal(server)).entries, a1).map((entry) => entry.detail?.['anchor'])).toEqual([anchorId]);
    await $('[data-stand-exit-anchor]').click();
    await browser.waitUntil(async () => !(await callStand('queryState', ['chatMessages', accountA, a1, anchorId])).exists, { timeout: 5000, timeoutMsg: 'anchored entry left behind' });

    const pinnedKey = ['chatMessages', accountA, a1, 'pinned'];
    await $('[data-testid="conversation-header-pinned-messages-button"]').click();
    await browser.waitUntil(async () => (await callStand('queryState', pinnedKey)).hasData && (await active(pinnedKey)), { timeout: 5000, timeoutMsg: 'pinned messages not loaded' });
    await browser.keys(Key.Escape);
    await browser.waitUntil(async () => !(await active(pinnedKey)), { timeout: 5000, timeoutMsg: 'pinned dialog still observing' });
    expect((await callStand('route')).chatId).toBe(a1);
  });

  it('window signals: becoming visible refreshes the chat list, not the history; offline and online force a new socket', async () => {
    const page = await pageMark();
    const sockets = (await callStand('wsStatus')).sockets;
    await browser.execute(() => document.dispatchEvent(new Event('visibilitychange')));
    const refetched = (await pageJournal(page, 'query-window-refetch')).map((entry) => (entry['key'] as string[])[0]);
    expect(refetched).toContain('chatList');
    expect(refetched).not.toContain('chatMessages');
    await browser.execute(() => window.dispatchEvent(new Event('offline')));
    await browser.waitUntil(
      async () => {
        const status = await callStand('wsStatus');
        return status.sockets === sockets + 1 && status.authenticated;
      },
      { timeout: 10_000, timeoutMsg: 'no new socket after offline' },
    );
    expect((await pageJournal(page, 'ws-recover'))[0]).toMatchObject({ cause: 'offline' });
  });

  it('silent queue resets: an account leaving the accounts list, and sign-out, drop SENDING entries and abort their POSTs', async () => {
    const queued = async (accountId: string, chatId: string): Promise<void> => {
      await callStand('scriptSend', accountId, chatId, [{ kind: 'hang' }]);
      await storeCall('pendingMessages', 'enqueue', [{ accountId, chatId, platform: 'onlyfans', text: '<p>in flight</p>', platformMetadata: {} }]);
      await browser.waitUntil(async () => (await pending(accountId))[0]?.status === 'sending', { timeout: 5000, timeoutMsg: 'not sending' });
    };
    let server = await standServer.mark();
    await queued(accountB, b1);
    await standServer.hideAccount(accountB);
    try {
      await waitForJournal((items) => items.some((entry) => entry.kind === 'send-aborted' && entry.chatId === b1), server, 'the POST of the dropped account aborted');
      expect(await pending(accountB)).toEqual([]);
    } finally {
      await standServer.hideAccount(accountB, false);
    }

    server = await standServer.mark();
    await queued(accountA, a2);
    await callStand('signOut');
    await waitForJournal((items) => items.some((entry) => entry.kind === 'send-aborted' && entry.chatId === a2), server, 'the POST aborted on sign-out');
    expect(await pending(accountA)).toEqual([]);
    expect((await callStand('wsStatus')).status).toBe('CLOSED');
    await openStand(chatPath(accountA, a1));
  });

  it('theme and fixed width: .dark/.light on <html>, --app-content-max-width 1600px', async () => {
    await callStand('setTheme', 'light');
    expect(await browser.execute(() => [document.documentElement.classList.contains('light'), document.documentElement.classList.contains('dark')])).toEqual([true, false]);
    await setViewport({ width: 1920, height: 1000 });
    try {
      await callStand('setFixedWidth', true, 'left');
      const box = await browser.execute(() => {
        const content = document.querySelector('.app-content')?.getBoundingClientRect();
        return { left: content?.left ?? -1, width: content?.width ?? -1, variable: document.documentElement.style.getPropertyValue('--app-content-max-width') };
      });
      expect(box).toEqual({ left: 0, width: 1600, variable: '1600px' });
    } finally {
      await callStand('setFixedWidth', false);
      await callStand('setTheme', 'dark');
      await setViewport(null);
    }
  });
});
