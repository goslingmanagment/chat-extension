// The MAIN runtime (architecture.md §6.1–§6.5, §6.9, §6.10): everything the
// bridge reads and writes in ChatSpace, attached to the boot (bridge.ts).
// - After DOMContentLoaded it looks for `#app.__vue_app__` every 100 ms up to
//   15 s, then every 2 s up to 60 s, then stops (CG-HOST-NOT-READY).
// - Route epochs from router.afterEach; a route «settles» after one frame.
// - Stores: the ones that exist and, through a pinia.use() plugin, the ones
//   created later — never a store of its own. The Colada cache and the send
//   queue are watched with $onAction (passive; the queue only for sign-out).
// - Writes (D-07): the guarded insert through ChatSpace's composer bridge and
//   router.push on a human action (the isolated side redeemed the token).
//   Part B adds the X8 queue call in send-port.ts.
// Never (§6.10): requests of its own, history loads, store/cache writes,
// resend/cancel/confirmEchoedMessage/reset*, ensure*/refresh*/fetch/
// invalidate*, insertMessage/setInsertPayload, synthetic paste, body
// observers with subtree, DOM polling on a timer, faked focus/visibility,
// writes into .ProseMirror, global CSS.

import { type MainContext, type MainRuntime } from './bridge';
import { isPlain, type Plain } from './check';
import { createComposers, rejected, type Composer, type Composers, type Receipt } from './composer';
import { chatRef, createReader, findApp, hasChatRoute, readRoute, type ActionListener, type App, type PageStore, type Reader, type Route } from './page';
import {
  APP_SEARCH,
  CG_CANCELED,
  CG_CHAT_CHANGED,
  CG_FAN_BLOCKED,
  CG_INSERT_FAILED,
  CG_NAV_FAILED,
  CG_NAV_TIMEOUT,
  EDITOR_WATCH_MS,
  ERR_BAD_REQUEST,
  ERR_IDENTITY,
  ERR_NOT_READY,
  ERR_UNKNOWN_REQUEST,
  FRAME_SELECTOR,
  KEY_ACCOUNTS,
  KEY_CHAT_LIST,
  KEY_FANS,
  KEY_MESSAGES,
  KEY_MIMIC_CHATS,
  KEY_MIMIC_SETTINGS,
  KEY_PERMISSIONS,
  ROUTE_CHAT,
  STORE_CACHE,
  STORE_QUEUE,
  STORE_TABS,
} from './protocol';
import { PAYLOAD, type Identity, type InsertWire, type NavigationWire } from './requests';

type NavReceipt = { readonly state: 'navigated'; readonly routeEpoch: number; readonly insert: Receipt | null } | { readonly state: 'failed'; readonly code: string; readonly insert: Receipt | null };

/** Anchors MAIN reports (contracts ANCHOR_IDS minus the DOM ones of the isolated side and the part B ones). */
const MAIN_ANCHORS = ['app', 'router', 'accounts', 'composerBridge', 'chatMessages', 'fansMap', 'pendingMessages', 'chatList', 'composerTranslator', 'mimic', 'userPermissions'];
/** Cache reads of the bridge itself, ignored by its cache observer. */
const CACHE_READS = ['get', 'getQueryData', 'getEntries'];
/** Cache keys whose change can mount, unmount or hide the open chat's composer. */
const COMPOSER_KEYS = [KEY_FANS, KEY_MESSAGES, KEY_MIMIC_CHATS, KEY_MIMIC_SETTINGS, KEY_PERMISSIONS];
/** Cache keys behind an anchor of the whole page (the per-chat ones are matched with the open account and chat). */
const GLOBAL_ANCHOR_KEYS = [KEY_ACCOUNTS, KEY_PERMISSIONS, KEY_MIMIC_SETTINGS, KEY_MIMIC_CHATS];

export function createMainRuntime(context: MainContext): MainRuntime {
  const { win, now, setTimer, frame, emit } = context;
  const doc = win.document;
  const clock = Date.now;
  let app: App | null = null;
  let reader: Reader = createReader(doc, null);
  let composers: Composers | null = null;
  let routeEpoch = 0;
  /** The route has stood at least one frame (§6.4 п. 1). */
  let settled = false;
  let settleTicket = 0;
  let login = 1;
  /** Our own router.push in progress: its afterEach does not cancel the pending insert. */
  let pushing = 0;
  let disposed = false;
  /** Per-chat anchors keep their last checked state; unchecked counts as fine. */
  const sticky: Record<string, string> = {};
  const usedIntents = new Set<string>();
  const usedConsents = new Set<string>();
  let pending: { readonly intentId: string; cancel(code: string): void } | null = null;
  /** Deferred inserts the isolated side canceled (§6.5) — maybe before their navigation arrived. */
  const canceledInserts = new Set<string>();
  /** Deferred inserts that ended (written, refused, timed out or canceled): a cancel comes too late for them. */
  const endedInserts = new Set<string>();
  const observed = new WeakSet<object>();
  let editorWatch: MutationObserver | null = null;
  /**
   * The composer last found by a full search, in its route epoch: while the
   * person types into it, the composer state is re-read without the layout
   * reads of the search. Anything that can change which composer is shown
   * (route, chat tabs, the cache keys behind the composer, a new editor)
   * clears it. Writes and reads for the isolated side always search afresh.
   */
  let typing: { readonly epoch: number; readonly composer: Composer } | null = null;

  // ── reads ──

  const route = (): Route => readRoute(app?.router ?? null);
  const loginEpoch = (): string | null => (app ? `L${login}` : null);
  const accountOf = (acc: string | null) => reader.accounts().find((account) => account.hostAccountId === acc) ?? null;
  const blocked = (read: Route): boolean => !!read.fan && reader.rawFan(read.acc as string, read.fan)?.['isBlocked'] === true;

  const routePayload = (): Plain => {
    const read = route();
    return {
      route: { epoch: routeEpoch, name: read.name, account: accountOf(read.acc), chat: read.fan ? chatRef(read.acc as string, read.fan) : null },
      hostLoginEpoch: loginEpoch(),
    };
  };

  /**
   * The open chat's visible composer slot (§6.3, §6.4). `confirmed` — the
   * route's account shows the route's chat in its active chat tab, the tab
   * ChatSpace rendered that composer for (its `chatId` prop comes from the
   * tab; prod Vue keeps no props on DOM nodes). null — none (yet), or the tab
   * and the route disagree: a switch in flight (ChatSpace shows the new tab's
   * composer first and the route follows after its async router guards, or
   * the route moves first and the tab follows). false — ambiguous.
   * Unconfirmed — the chat tabs are unreadable (a new build): the dock may sit
   * on that composer, nothing reads or writes it.
   */
  const locate = (): { readonly slot: Element; readonly confirmed: boolean } | null | false => {
    const read = route();
    if (!settled || !composers || !read.fan) return null;
    const slot = composers.activeSlot();
    if (!slot) return slot;
    const tab = reader.tabChat(read.acc as string);
    if (tab === undefined) return { slot, confirmed: false };
    return tab === read.fan ? { slot, confirmed: true } : null;
  };

  /**
   * The open chat's composer, searched afresh: bound on first sight to the
   * chat ChatSpace rendered it for, and used only while the route shows that
   * chat. null — none (yet); false — ambiguous, or a node of another chat.
   */
  const activeComposer = (): Composer | null | false => {
    const found = locate();
    if (found === false) return false;
    if (!found?.confirmed || !composers) return null;
    const read = route();
    return composers.bind(found.slot, read.acc as string, read.fan as string) ?? false;
  };

  /** Sets a per-chat anchor; a change is reported to the isolated side (the contract event is coalesced). */
  const mark = (anchor: string, state: string): void => {
    if (sticky[anchor] === state) return;
    sticky[anchor] = state;
    emit('contract', contractPayload);
  };

  /** While the active composer has no editor yet, a short narrow observer on its frame waits for TipTap (never on body, §6.10). */
  const watchEditor = (composer: Composer): void => {
    const target = composer.slot.closest(FRAME_SELECTOR);
    if (editorWatch || !target || !composers) return;
    const stop = (): void => {
      editorWatch?.disconnect();
      editorWatch = null;
    };
    const watch = new (win as Window & typeof globalThis).MutationObserver(() => {
      composers?.attach(composer);
      if (composer.editor || !composer.slot.isConnected) stop();
    });
    watch.observe(target, { childList: true, subtree: true });
    editorWatch = watch;
    setTimer(stop, EDITOR_WATCH_MS);
  };

  /** `typed` — only the draft of the composer last found changed: reuse it while it is still in the document and the route epoch holds. */
  const composerState = (typed = false): Plain | null => {
    const read = route();
    if (!read.fan || !composers) return null;
    const chat = chatRef(read.acc as string, read.fan);
    const placeholder = (prefix: string, hidden: boolean): Plain => ({ chat, instanceId: `${prefix}${routeEpoch}`, ready: false, hidden, draft: { revision: 0, provenance: 'empty' } });
    if (blocked(read)) return placeholder('b', true);
    let composer: Composer | null = typed && typing?.epoch === routeEpoch && typing.composer.slot.isConnected ? typing.composer : null;
    if (!composer) {
      typing = null;
      const found = locate();
      if (!found) return null;
      // Which chat this composer serves cannot be told: copy only — the dock may sit there, nothing is written (CG-HOST-COMPOSER-MISSING).
      if (!found.confirmed) {
        mark('composerBridge', 'missing');
        return placeholder('u', false);
      }
      composer = composers.bind(found.slot, read.acc as string, read.fan);
      if (!composer) return null;
      typing = { epoch: routeEpoch, composer };
    }
    const bridge = composers.bridgeOf(composer);
    const editor = composers.editorElement(composer.slot);
    // `shape` — the bridge is there but the editor behind it is not observable (no CAS promise, §6.4).
    if (editor) mark('composerBridge', !bridge ? 'missing' : composer.editor ? 'ok' : 'shape');
    if (!composer.editor) watchEditor(composer);
    const draft = composers.read(composer);
    return { chat, instanceId: composer.id, ready: !!bridge && !!editor, hidden: false, draft: { revision: composer.revision, provenance: composers.provenance(composer, draft) } };
  };
  const composerNow = (typed = false): void => emit('composer', () => ({ state: composerState(typed) }));
  /** Re-read a frame later: Vue renders after the store change that triggered us. */
  const composerSoon = (): void => {
    typing = null;
    frame(() => composerNow());
  };
  /** A draft changed: the composer it belongs to, when it is the one last found, is re-read without a new search. */
  const onComposerChange = (draftOf?: Composer): void => {
    if (draftOf && draftOf === typing?.composer) frame(() => composerNow(true));
    else composerSoon();
  };

  const contractPayload = (): Plain => {
    const read = route();
    const found: Record<string, string> = {
      app: app && findApp(doc)?.app === app.app ? 'ok' : 'missing',
      router: !app?.router ? 'missing' : hasChatRoute(app.router) ? 'ok' : 'shape',
    };
    if (app) Object.assign(found, Object.assign(sticky, reader.anchors(read.acc, read.fan)));
    const listed = (state: string): string[] => MAIN_ANCHORS.filter((key) => (found[key] ?? 'ok') === state);
    // Without #app (still searching, or given up after 60 s) the host is simply not ready: nothing else is judged.
    return { build: reader.build(), missing: app ? listed('missing') : ['app'], shape: app ? listed('shape') : [], receiptModules: {} };
  };

  const identityMatches = (expected: Identity): boolean => {
    const read = route();
    const chat = expected.chat;
    return (
      expected.documentEpoch === context.documentEpoch &&
      expected.hostLoginEpoch === loginEpoch() &&
      expected.routeEpoch === routeEpoch &&
      expected.hostAccountId === read.acc &&
      accountOf(read.acc)?.platformAccountId === expected.platformAccountId &&
      (chat ? chat.hostAccountId === read.acc && chat.platformFanId === read.fan : !read.fan)
    );
  };

  /** The open chat's composer named by an identity, or null. */
  const composerOf = (expected: Identity): Composer | null => {
    const composer = identityMatches(expected) && expected.chat ? activeComposer() : null;
    return composer && composer.id === expected.composerInstanceId ? composer : null;
  };

  // ── writes ──

  const insertGuarded = (intent: InsertWire): Receipt | Promise<Receipt> => {
    const expected = intent.expected;
    if (usedIntents.has(intent.intentId) || clock() > intent.expiresAt || expected.kind !== 'open') return rejected(CG_INSERT_FAILED);
    usedIntents.add(intent.intentId);
    pending?.cancel(CG_CANCELED);
    const read = route();
    if (expected.documentEpoch !== context.documentEpoch || read.acc !== intent.target.hostAccountId || read.fan !== intent.target.platformFanId || expected.routeEpoch !== routeEpoch) {
      return rejected(CG_CHAT_CHANGED);
    }
    if (blocked(read)) return rejected(CG_FAN_BLOCKED);
    const composer = activeComposer();
    if (!composer || !composers || composer.id !== expected.composerInstanceId) return rejected(CG_CHAT_CHANGED);
    return composers.write(composer, intent, { revision: expected.draftRevision, digest: expected.draftDigest }, usedConsents);
  };

  /**
   * «Открыть и вставить» (§6.5): after router.push, wait frame by frame for
   * the target's working composer — a new route epoch, a settled route, the
   * bridge and the editor, the same identity on two consecutive frames — then
   * write in one step into an empty draft or our own unchanged insert. A
   * human navigation, another insert intent, an ambiguous composer, the
   * route leaving the target or the isolated side (`cancelInsert`: sign-out,
   * persona or binding change) cancel it (CG-INSERT-CANCELED, the navigation
   * itself happened); the deadline is the insert's `expiresAt` (CG-NAV-TIMEOUT).
   */
  const deferredInsert = (intent: InsertWire, sinceEpoch: number): Promise<NavReceipt> =>
    new Promise((resolve) => {
      const end = (receipt: NavReceipt): void => {
        endedInserts.add(intent.intentId);
        resolve(receipt);
      };
      const self = {
        intentId: intent.intentId,
        cancel: (code: string): void => {
          if (pending !== self) return;
          pending = null;
          end(code === CG_CANCELED ? { state: 'navigated', routeEpoch, insert: rejected(code) } : { state: 'failed', code, insert: rejected(code) });
        },
      };
      pending?.cancel(CG_CANCELED);
      pending = self;
      let last = '';
      let stable = 0;
      const step = (): void => {
        if (pending !== self) return;
        if (canceledInserts.has(intent.intentId)) return self.cancel(CG_CANCELED);
        if (clock() > intent.expiresAt) return self.cancel(CG_NAV_TIMEOUT);
        const read = route();
        if (read.acc !== intent.target.hostAccountId || read.fan !== intent.target.platformFanId) return self.cancel(CG_CANCELED);
        const composer = activeComposer();
        if (composer === false) return self.cancel(CG_CANCELED);
        const ready = composer && routeEpoch > sinceEpoch && composer.editor && composers?.bridgeOf(composer);
        const key = ready ? `${routeEpoch}:${composer.id}` : '';
        stable = key && key === last ? stable + 1 : key ? 1 : 0;
        last = key;
        if (stable < 2 || !composer || !composers) return frame(step);
        pending = null;
        endedInserts.add(intent.intentId);
        void Promise.resolve(composers.write(composer, intent, null, usedConsents)).then((insert) => resolve({ state: 'navigated', routeEpoch, insert }));
      };
      frame(step);
    });

  const navigate = async (intent: NavigationWire): Promise<NavReceipt> => {
    const then = intent.thenInsert;
    const fail = (code: string): NavReceipt => ({ state: 'failed', code, insert: then ? rejected(code) : null });
    const router = app?.router;
    if (usedIntents.has(intent.intentId) || (then && usedIntents.has(then.intentId))) return fail(CG_NAV_FAILED);
    usedIntents.add(intent.intentId);
    if (then) usedIntents.add(then.intentId);
    pending?.cancel(CG_CANCELED);
    if (!router || (then && (then.expected.documentEpoch !== context.documentEpoch || clock() > then.expiresAt))) return fail(CG_NAV_FAILED);
    const before = route();
    const already = !!intent.fan && before.acc === intent.acc && before.fan === intent.fan;
    const sinceEpoch = already ? routeEpoch - 1 : routeEpoch;
    let failure: unknown;
    pushing += 1;
    try {
      failure = await router.push({ name: ROUTE_CHAT, params: intent.fan ? { accountId: intent.acc, chatId: intent.fan } : { accountId: intent.acc } });
    } catch {
      failure = true;
    } finally {
      pushing -= 1;
    }
    const after = route();
    // An account navigation may land on the account's last chat (Б13): only the account must match then.
    if ((failure && !already) || after.acc !== intent.acc || (intent.fan && after.fan !== intent.fan)) return fail(CG_NAV_FAILED);
    return then ? deferredInsert(then, sinceEpoch) : { state: 'navigated', routeEpoch, insert: null };
  };

  // ── ChatSpace ──

  const settle = (): void => {
    const ticket = ++settleTicket;
    settled = false;
    frame(() => {
      if (ticket !== settleTicket) return;
      settled = true;
      composerNow();
      emit('contract', contractPayload);
    });
  };

  const onRouteChange = (_to: unknown, _from: unknown, failure?: unknown): void => {
    if (failure || disposed) return;
    routeEpoch += 1;
    typing = null;
    if (!pushing) pending?.cancel(CG_CANCELED);
    emit('route', routePayload);
    settle();
  };

  const onCacheAction: ActionListener = ({ name, args, after }) => {
    if (disposed || CACHE_READS.includes(name)) return;
    after(() => {
      const first = args[0];
      const key = (isPlain(first) && Array.isArray(first['key']) ? first['key'] : Array.isArray(first) ? first : []) as unknown[];
      const read = route();
      const head = key[0] as string;
      // A key behind an anchor changed (data often lands after the route settled): the contract is judged again (coalesced, sent only when it changed).
      if (
        GLOBAL_ANCHOR_KEYS.includes(head) ||
        ((head === KEY_FANS || head === KEY_CHAT_LIST) && key[1] === read.acc) ||
        (head === KEY_MESSAGES && key[1] === read.acc && key[2] === read.fan)
      ) {
        emit('contract', contractPayload);
      }
      if (head === KEY_ACCOUNTS) {
        emit('accounts', () => ({}));
        emit('route', routePayload);
      }
      if (!read.fan || (key[1] !== undefined && key[1] !== read.acc)) return;
      const fan = read.fan;
      if (COMPOSER_KEYS.includes(head)) composerSoon();
      // The open chat's history, its fan, its row of the list: the isolated side re-reads what it shows.
      if ((head === KEY_MESSAGES && key[2] === fan) || head === KEY_FANS || head === KEY_CHAT_LIST) emit('chatCache', () => ({ acc: read.acc, fan }));
    });
  };

  const onStore = (store: PageStore): void => {
    if (observed.has(store)) return;
    observed.add(store);
    try {
      if (store.$id === STORE_CACHE) store.$onAction(onCacheAction, true);
      // A chat tab activated, closed or given another chat: ChatSpace shows another composer, maybe before the route follows.
      if (store.$id === STORE_TABS) store.$onAction(({ after }) => after(composerSoon), true);
      // A sign-out resets ChatSpace's send queue: a new host login epoch (identities from before no longer match).
      if (store.$id === STORE_QUEUE)
        store.$onAction(({ name }) => {
          if (name !== 'resetAll' || disposed) return;
          login += 1;
          emit('route', routePayload);
        }, true);
    } catch {
      // Not shaped as expected; the contract check reports it.
    }
    emit('contract', contractPayload);
  };

  const attachApp = (found: App): void => {
    app = found;
    reader = createReader(doc, found.pinia);
    composers = createComposers(win, onComposerChange, frame);
    routeEpoch = 1;
    try {
      found.router?.afterEach(onRouteChange);
      // Stores created later reach us through a plugin; we never create a store (§6.1).
      found.pinia?.use(({ store }) => onStore(store));
      for (const store of found.pinia?._s.values() ?? []) onStore(store);
    } catch {
      // Reported by the contract check.
    }
    emit('route', routePayload);
    emit('accounts', () => ({}));
    emit('contract', contractPayload);
    settle();
  };

  const searchApp = (): void => {
    const searchStarted = now();
    const attempt = (): void => {
      if (disposed || app) return;
      const found = findApp(doc);
      if (found) return attachApp(found);
      const elapsed = now() - searchStarted;
      if (elapsed < APP_SEARCH.slowUntilMs) return void setTimer(attempt, elapsed < APP_SEARCH.fastUntilMs ? APP_SEARCH.fastMs : APP_SEARCH.slowMs);
      // Given up (CG-HOST-NOT-READY): no endless retries.
      emit('contract', contractPayload);
    };
    attempt();
  };

  const onDomReady = (): void => {
    doc.removeEventListener('DOMContentLoaded', onDomReady);
    searchApp();
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', onDomReady);
  else setTimer(searchApp, 0);

  // ── requests ──

  const handle = (t: string, payload: Plain): unknown => {
    // Part B wires the tap and the send port; until then both flags read back as off.
    if (t === 'flags') return { wsTap: false, previewSend: false };
    if (t === 'snapshot') return { ...routePayload(), composer: composerState(), accounts: reader.accounts(), contract: contractPayload() };
    if (t === 'listAccounts') return reader.accounts();
    if (!app) return ERR_NOT_READY;
    const acc = payload['acc'] as string;
    const fan = payload['fan'] as string;
    const expected = payload['expected'] as Identity;
    const composer = t === 'readDraft' || t === 'focus' ? composerOf(expected) : null;
    switch (t) {
      case 'chatWindow':
        return reader.chatWindow(acc, fan, payload['max'] as number);
      case 'fan':
        return reader.fan(acc, fan);
      case 'listChats':
        return reader.chatList(acc, payload['limit'] as number);
      case 'readTail':
        return identityMatches(expected) && expected.chat ? reader.tail(expected.chat.hostAccountId, expected.chat.platformFanId, payload['max'] as number) : ERR_IDENTITY;
      case 'readDraft': {
        if (!composer || !composers) return ERR_IDENTITY;
        const draft = composers.read(composer);
        return { composerInstanceId: composer.id, revision: composer.revision, plainText: draft.text.slice(0, 20_000), provenance: composers.provenance(composer, draft), digest: draft.digest };
      }
      case 'focus':
        return composer && composers ? { focused: composers.focus(composer) } : ERR_IDENTITY;
      case 'insertGuarded':
        return insertGuarded(payload['intent'] as InsertWire);
      case 'cancelInsert': {
        const id = payload['intentId'] as string;
        if (endedInserts.has(id)) return { canceled: false };
        canceledInserts.add(id);
        if (pending?.intentId === id) pending.cancel(CG_CANCELED);
        return { canceled: true };
      }
    }
    return navigate(payload['intent'] as NavigationWire);
  };

  return {
    handle(t, payload) {
      const check = PAYLOAD[t];
      if (!check) return ERR_UNKNOWN_REQUEST;
      return check(payload) ? handle(t, payload as Plain) : ERR_BAD_REQUEST;
    },
    dispose() {
      pending?.cancel(CG_CANCELED);
      disposed = true;
      doc.removeEventListener('DOMContentLoaded', onDomReady);
      editorWatch?.disconnect();
      composers?.dispose();
    },
  };
}
