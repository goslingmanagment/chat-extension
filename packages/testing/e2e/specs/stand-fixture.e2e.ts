// The stand's own behaviour in Firefox, without the extension: the contracts
// R09 and the X8 matrix will lean on (architecture.md §12 п. 3) must hold on
// the fixture first — native send queue and its client, scripted answers,
// queue refusals, Esc / Alt+S / TipTap marks, drafts, keep-bottom, socket
// reconnects, query observers, a «new build», blocked fan, theme.

import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import type { ComposerSnapshot, PageJournalEntry, ServerJournalEntry } from '../../fixture-chatspace/src/protocol';
import { useNetworkTrap } from '../support/network-trap';
import { callStand, chatPath, foreignCalls, openStand, STAND_IDS, standServer, waitForChatReady, waitForJournal } from '../support/stand';
import { setViewport } from '../support/visual';

const { a: accountA } = STAND_IDS.accounts;
const { a1, a2, a3, a4 } = STAND_IDS.fans;
/** TipTap's Mod: ⌘ on macOS, Ctrl elsewhere. */
const MOD = process.platform === 'darwin' ? Key.Command : Key.Ctrl;
const ACTIVE_EDITOR = '.composer-root:not([style*="display: none"]) .ProseMirror';
const ACTIVE_SEND = '.composer-root:not([style*="display: none"]) .send-button';

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
    await $('.composer-root:not([style*="display: none"]) .composer-strip__trailing .chip').click();
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

  it('the message list keeps the bottom when the box above the composer grows, and its anchor when scrolled up', async () => {
    // Short enough that the first history page overflows.
    await setViewport({ width: 1280, height: 600 });
    await browser.waitUntil(async () => (await callStand('messageList'))?.atBottom === true, { timeout: 3000, timeoutMsg: 'list not at the bottom after the resize' });
    const insertBlock = async (): Promise<void> => {
      await browser.execute(() => {
        const root = document.querySelector('.composer-root:not([style*="display: none"])');
        const block = document.createElement('div');
        block.setAttribute('data-stand-test-block', '');
        block.style.height = '120px';
        root?.insertBefore(block, root.firstChild);
      });
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
        const debug = await browser.execute(() => ({ w: innerWidth, h: innerHeight, blocks: document.querySelectorAll('[data-stand-test-block]').length, roots: [...document.querySelectorAll('.composer-root')].map((r) => (r as HTMLElement).style.display) }));
        throw new Error(`the list lost the bottom when the box above the composer grew: ${JSON.stringify(state)} ${JSON.stringify(debug)} ${JSON.stringify((await callStand('journal')).slice(-15))}`);
      });
    await removeBlock();

    const anchor = async (): Promise<{ id: string | null; offset: number }> =>
      browser.execute(() => {
        const scroller = document.querySelector<HTMLElement>('.messages-scroll');
        const first = [...document.querySelectorAll<HTMLElement>('[data-message-id]')].find((node) => scroller !== null && node.offsetTop + node.offsetHeight > scroller.scrollTop + 1);
        return { id: first?.dataset['messageId'] ?? null, offset: first === undefined || scroller === null ? 0 : first.offsetTop - scroller.scrollTop };
      });
    await browser.execute(() => {
      const scroller = document.querySelector<HTMLElement>('.messages-scroll');
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
      const slot = document.querySelector('.composer-root:not([style*="display: none"]) [data-id="browser-composer-translator"]');
      return { pending: pinia?._s.has('pendingMessages'), route: router?.currentRoute.value.name, bridge: slot !== null && '__omComposerBridge' in slot, editor: document.querySelector('.ProseMirror') !== null };
    });
    expect(shape).toEqual({ pending: false, route: 'conversation', bridge: false, editor: true });
    const composers: readonly ComposerSnapshot[] = await callStand('composers');
    expect(composers.map((composer) => [composer.chatId, composer.shown, composer.hasEditor, composer.hasBridge])).toEqual([[a1, true, true, false]]);
    await openStand(chatPath(accountA, a1));
  });

  it("a blocked fan's composer stays hidden and its history is not loaded; unblocking shows it", async () => {
    const server = await standServer.mark();
    await callStand('openChat', accountA, a3, { newTab: true });
    await browser.waitUntil(async () => (await callStand('composers')).some((composer) => composer.chatId === a3), { timeout: 5000, timeoutMsg: 'no composer for the blocked fan' });
    await expect($('.conversation-blocked')).toBeDisplayed();
    expect((await callStand('composers')).find((composer) => composer.chatId === a3)?.shown).toBe(false);
    expect(historyLoadsOf((await standServer.journal(server)).entries, a3)).toEqual([]);
    await callStand('setFan', accountA, a3, { isBlocked: false });
    await waitForChatReady(accountA, a3);
    await callStand('closeActiveChatTab');
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
