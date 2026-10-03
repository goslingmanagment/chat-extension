// ChatSpace-shaped pieces for the live side's tests (architecture.md §6.6–§6.8):
// a WebSocket class, a send queue with the native send chain, a scripted
// `fetch`, and a LiveHost over plain maps. Test-only: no bundle imports this
// file. They re-express only what the adapter relies on, the way the R02
// stand does; the real-browser proof is the e2e on the stand.
//
// - The queue is sequential per account. Its send creates the request and
//   takes `win.fetch` SYNCHRONOUSLY inside the send action (the HTTP client
//   captures fetch when the request object is created), then gets its token
//   and calls the captured function. A 401 refreshes the token and re-runs
//   the request once as a new request object, created at that moment (so it
//   takes fetch anew). Success removes the entry; Message Guard leaves it
//   FAILED `blocked`; other errors FAILED `platform`; its own timeout FAILED
//   `timeout`. Never a retry on its own.
// - The queue's action is named by the send port's own constant: the queue
//   method's name lives in one file only (tools/gates).

import { type Entry, type LiveHost, type PageStore, type Route, type SentDraft } from '../main/live';
import { QUEUE_SEND, queueShape } from '../main/send-port';
import { fakeStore, type FakeStore } from './fake-page';

/** A WebSocket as the page's client uses it: handlers as properties, events for listeners. */
export class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  /** Every socket constructed, in order (reset by the test). */
  static made: FakeSocket[] = [];

  readyState = FakeSocket.OPEN;
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly sent: unknown[] = [];

  constructor(
    readonly url: string | URL,
    readonly protocols?: string | string[],
  ) {
    super();
    FakeSocket.made.push(this);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  /** The server sends a frame: listeners first, then the page's own `onmessage`. */
  receive(frame: unknown): void {
    const event = new MessageEvent('message', { data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
    this.dispatchEvent(event);
    this.onmessage?.(event);
  }

  close(): void {
    this.readyState = FakeSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }
}

export const frames = {
  authenticated: { event: 'authenticated' },
  message: (acc: string, fan: string, id: string, fromFan: boolean, extra: Record<string, unknown> = {}) => ({
    event: 'account_new_message',
    account: { account_id: acc, platform: 'onlyfans', platform_account_id: '3003' },
    message: { id, content: `text of ${id}`, sentAt: '2026-10-03T10:00:00.000Z', chatId: fan, platform_fan_id: fan, is_from_fan: fromFan, platformMetadata: { isTip: false, isFromQueue: false }, ...extra },
  }),
  summary: (acc: string) => ({ event: 'account_notifications_summary', account: { account_id: acc, platform: 'onlyfans' }, notifications_count: 1 }),
};

export interface FetchCall {
  readonly url: string;
  readonly method: string;
  /** The request as the page gave it to fetch (the observer must not have touched it). */
  readonly input: unknown;
  readonly init: unknown;
  readonly self: unknown;
  /** Settles what the page's fetch returned. */
  respond(status: number, body?: unknown): void;
  fail(error?: Error): void;
}

/** A `fetch` the test answers by hand; `calls` holds every call that reached it. */
export function scriptedFetch(): { readonly fetch: typeof fetch; readonly calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fake = function (this: unknown, input: unknown, init?: unknown): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      const request = input as { url?: string; method?: string; signal?: AbortSignal } | string;
      const signal = typeof request === 'string' ? (init as { signal?: AbortSignal } | undefined)?.signal : request.signal;
      signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      calls.push({
        url: typeof request === 'string' ? request : (request.url ?? ''),
        method: (typeof request === 'string' ? (init as { method?: string } | undefined)?.method : request.method) ?? 'GET',
        input,
        init,
        self: this,
        respond: (status, body) => resolve(new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
        fail: (error = new TypeError('network')) => reject(error),
      });
    });
  };
  return { fetch: fake, calls };
}

export interface QueueEntry {
  readonly id: string;
  readonly accountId: string;
  readonly chatId: string;
  readonly platform: string;
  status: 'pending' | 'sending' | 'failed' | 'confirmed';
  error: { kind: 'timeout' | 'blocked' | 'platform'; guard?: { words: string[]; topics: string[] } | null } | null;
  readonly payload: Record<string, unknown>;
}

export interface FakeQueue {
  readonly store: FakeStore;
  /** Every input the send action was called with. */
  readonly sends: Array<Record<string, unknown>>;
  entries(acc: string): QueueEntry[];
  /** The send action as the page calls it (the composer, a quick reply). */
  send(input: Record<string, unknown>): QueueEntry | null;
  /** The next send action returns null (Mimic took the chat, or 50 entries). */
  refuseNext(): void;
  /** The next send action throws. */
  throwNext(): void;
  /** The entry's own timeout fires: the request is aborted. */
  timeout(id: string): void;
  /** The session token the next request waits for; a test may hold it. */
  token: () => Promise<string>;
  /** Runs inside the send action, on its synchronous stack, right after the request object took `fetch`. */
  during: (() => void) | null;
  /** Requests the client created, in order (the objects it hands to fetch). */
  readonly requests: Request[];
}

export interface FakeQueueOptions {
  readonly apiBase?: string;
  /** A client that took `fetch` once, when it was built — not when a request is created (a send path no profile covers). */
  readonly earlyFetch?: boolean;
}

/** The send queue `pendingMessages` with the native chain; `win.fetch` is taken when the request object is created. */
export function fakeQueue(win: { fetch: typeof fetch }, options: FakeQueueOptions = {}): FakeQueue {
  const apiBase = options.apiBase ?? 'https://api.example.test/';
  const early = options.earlyFetch ? win.fetch.bind(globalThis) : null;
  const messagesByAccountId: Record<string, QueueEntry[]> = {};
  const processingByAccountId: Record<string, boolean> = {};
  const controllers = new Map<string, AbortController>();
  const sends: Array<Record<string, unknown>> = [];
  let seq = 0;
  let refuse = false;
  let fail = false;
  const self: FakeQueue = {
    store: undefined as unknown as FakeStore,
    sends,
    entries: (acc) => messagesByAccountId[acc] ?? [],
    send: (input) => (self.store[QUEUE_SEND] as (input: Record<string, unknown>) => QueueEntry | null)(input),
    refuseNext: () => {
      refuse = true;
    },
    throwNext: () => {
      fail = true;
    },
    timeout: (id) => controllers.get(id)?.abort(),
    token: () => Promise.resolve('session-token'),
    during: null,
    requests: [],
  };
  const changed = (): void => self.store.$changed();
  const remove = (entry: QueueEntry): void => {
    const list = messagesByAccountId[entry.accountId] ?? [];
    const index = list.indexOf(entry);
    if (index === -1) return;
    list.splice(index, 1);
    if (list.length === 0) delete messagesByAccountId[entry.accountId];
    changed();
  };
  const setStatus = (entry: QueueEntry, status: QueueEntry['status'], error: QueueEntry['error'] = null): void => {
    entry.status = status;
    entry.error = error;
    changed();
  };
  const alive = (entry: QueueEntry): boolean => (messagesByAccountId[entry.accountId] ?? []).includes(entry);

  /** One HTTP request of the client: fetch is taken here, synchronously; the call comes after the token. */
  const request = (entry: QueueEntry, signal: AbortSignal, bare: boolean): Promise<Response> => {
    const captured = early ?? win.fetch.bind(globalThis);
    const made = new Request(`${apiBase}api/v0/accounts/${entry.accountId}/chats/${entry.chatId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: entry.payload['text'], is_copied: entry.payload['isCopied'] ?? false, is_ai_generated: entry.payload['isAiGenerated'] ?? false, platformMetadata: entry.payload['platformMetadata'] ?? {} }),
      signal,
    });
    self.requests.push(made);
    if (!bare) self.during?.();
    return (async () => {
      await Promise.resolve();
      made.headers.set('authorization', `Bearer ${await self.token()}`);
      const response = await captured(made, {});
      if (response.status === 401 && !bare) return request(entry, signal, true);
      return response;
    })();
  };

  const sendOne = async (entry: QueueEntry): Promise<void> => {
    setStatus(entry, 'sending');
    const controller = new AbortController();
    controllers.set(entry.id, controller);
    try {
      const response = await request(entry, controller.signal, false);
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { response });
      await response.json();
      if (alive(entry)) remove(entry);
    } catch (error) {
      if (!alive(entry)) return;
      if ((error as Error).name === 'AbortError') return setStatus(entry, 'failed', { kind: 'timeout' });
      const response = (error as { response?: Response }).response;
      const body = response ? ((await response.clone().json().catch(() => null)) as { code?: string; word_matches?: string[]; topic_matches?: string[] } | null) : null;
      if (body?.code === 'MESSAGE_GUARD_VIOLATION') setStatus(entry, 'failed', { kind: 'blocked', guard: { words: body.word_matches ?? [], topics: (body.topic_matches ?? []).map((topic) => `Topic ${topic}`) } });
      else setStatus(entry, 'failed', { kind: 'platform' });
    } finally {
      controllers.delete(entry.id);
    }
  };

  const process = async (acc: string): Promise<void> => {
    if (processingByAccountId[acc]) return;
    processingByAccountId[acc] = true;
    try {
      for (let next = self.entries(acc).find((entry) => entry.status === 'pending'); next; next = self.entries(acc).find((entry) => entry.status === 'pending')) await sendOne(next);
    } finally {
      delete processingByAccountId[acc];
      changed();
    }
  };

  const drop = (acc: string): void => {
    for (const entry of [...self.entries(acc)]) {
      controllers.get(entry.id)?.abort();
      remove(entry);
    }
  };

  (self as { store: FakeStore }).store = fakeStore(
    'pendingMessages',
    {
      messagesByAccountId,
      processingByAccountId,
      [QUEUE_SEND]: (input: Record<string, unknown>): QueueEntry | null => {
        sends.push(input);
        if (fail) {
          fail = false;
          throw new Error('queue failed');
        }
        if (refuse) {
          refuse = false;
          return null;
        }
        seq += 1;
        const entry: QueueEntry = { id: `00000000-0000-4000-9000-${String(seq).padStart(12, '0')}`, accountId: String(input['accountId']), chatId: String(input['chatId']), platform: String(input['platform']), status: 'pending', error: null, payload: { ...input } };
        (messagesByAccountId[entry.accountId] ??= []).push(entry);
        changed();
        void process(entry.accountId);
        return entry;
      },
      cancel: (acc: string, id: string) => {
        const entry = self.entries(acc).find((item) => item.id === id);
        if (!entry) return;
        controllers.get(id)?.abort();
        remove(entry);
      },
      resend: (acc: string, id: string) => {
        const entry = self.entries(acc).find((item) => item.id === id);
        if (entry?.status !== 'failed') return;
        setStatus(entry, 'pending');
        void process(acc);
      },
      resetForAccount: drop,
      resetAll: () => Object.keys(messagesByAccountId).forEach(drop),
    },
    [QUEUE_SEND, 'cancel', 'resend', 'resetForAccount', 'resetAll'],
  );
  return self;
}

export interface FakeLive {
  readonly host: LiveHost;
  /** Events posted to the bridge, in order. */
  readonly posted: Array<{ t: string; payload: Record<string, unknown> }>;
  readonly stores: Map<string, PageStore>;
  /** Cache data by JSON key. */
  readonly data: Map<string, unknown>;
  /** Cache entries by JSON key (observers, loading). */
  readonly entries: Map<string, Entry>;
  route: Route;
  /** The open chat's draft as the composer has it; null — none. */
  draft: { draft: SentDraft; digest: string } | null;
  /** ChatSpace's `subscribedAccountIds`; null — not observable. */
  subscribed: Set<string> | null;
  /** Times the contract was asked to be judged again. */
  changes: number;
  set(key: readonly string[], value: unknown): void;
}

/** A LiveHost over plain maps: what the runtime lends the tap script, without a page. */
export function fakeLive(documentEpoch = 'doc1'): FakeLive {
  const live: FakeLive = {
    host: undefined as unknown as LiveHost,
    posted: [],
    stores: new Map(),
    data: new Map(),
    entries: new Map(),
    route: { name: 'chat', acc: '1001', fan: '2002' },
    draft: null,
    subscribed: new Set(['1001']),
    changes: 0,
    set: (key, value) => void live.data.set(JSON.stringify(key), value),
  };
  (live as { host: LiveHost }).host = {
    epoch: () => documentEpoch,
    post: (t, payload) => void live.posted.push({ t, payload }),
    route: () => live.route,
    store: (id) => live.stores.get(id),
    data: (...key) => live.data.get(JSON.stringify(key)),
    entry: (...key) => live.entries.get(JSON.stringify(key)) ?? null,
    queue: () => {
      const queue = live.stores.get('pendingMessages');
      return queue && queueShape(queue) === 'ok' ? queue : null;
    },
    entries: (acc) => {
      const all = live.stores.get('pendingMessages')?.['messagesByAccountId'] as Record<string, Array<Record<string, unknown>>> | undefined;
      return all?.[acc] ?? [];
    },
    members: () => live.subscribed,
    draft: (acc, fan) => (live.route.acc === acc && live.route.fan === fan ? live.draft : null),
    changed: () => {
      live.changes += 1;
    },
  };
  return live;
}

/** The page memory a clean preview send needs: account 1001 bound to creator 3003, permissions, Mimic off, translator off. */
export function seedLive(live: FakeLive, acc = '1001'): void {
  live.set(['accounts'], [{ id: Number(acc), platformAccountId: '3003', platform: 'onlyfans' }]);
  live.set(['userPermissions'], ['om_message_translator']);
  live.set(['mimicSettings'], { isActive: false });
  live.set(['mimicChats'], {});
  live.set(['fansMap', acc], { '2003': { id: '2003', isBlocked: false, canReceiveMessages: true, isRestricted: false } });
  const settings: Record<string, { enabled: boolean; autoTranslate: boolean }> = {};
  live.stores.set(
    'composerTranslator',
    fakeStore('composerTranslator', {
      settings,
      getAccountSettings(this: unknown, account: string) {
        return { value: { enabled: false, autoTranslate: true, ...settings[account] } };
      },
    }),
  );
}
