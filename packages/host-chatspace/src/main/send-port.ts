// X8 preview send port (architecture.md §6.7). This is the ONLY file in the
// MAIN world allowed to reference ChatSpace's send queue; tools/gates fails
// the build if the queue method name appears anywhere else in our code.
//
// - `preflight` answers the button: every §6.7.4 condition MAIN can see
//   (5–14), read from page memory, with no side effect — no `ensure*`, no
//   `refresh*`, no token, no history load, no store or cache write.
// - `commit` runs the same checks again and, in the SAME synchronous step,
//   makes exactly one call of the queue's own action with the §6.7.1
//   arguments. Nothing is awaited between the last check and the call, so
//   the person, a fan's message or ChatSpace cannot change anything in between.
// - The text becomes HTML the way ChatSpace's own `setText` builds it: `&`
//   first, then `<` and `>`, our line breaks as <br>, one outer <p>. Quotes
//   stay: in a text node they mean the same characters.
// - Whatever fails before the call (a read of ours that threw, the observer
//   that could not be put in place) is `held` with CG-SEND-HOST, and the
//   preflight says the same: nothing reached the queue (§6.7.7 п. 6).
// - After the call the answer is what the queue returned: null —
//   `notEnqueued`; an entry shaped as §6.2 says, whose request took the
//   receipt observer — `nativeEnqueued`; anything else — `uncertain`, and no
//   more X8 in this document: the queue threw or gave no id or other keys
//   (CG-SEND-HOST from then on), or its request did not take the observer
//   (CG-SEND-RECEIPT, receipt.ts).
// - A used attempt id never reaches the queue twice: the first result is
//   answered again. An answer that says the queue may have been called is
//   never forgotten; of the `held` ones the last 256 are kept. With the flag
//   off (the latch of live-port.ts) nothing is sent at all.
// - The queue's send action is also where a human send shows (§6.6): the
//   runtime listens for it by the name exported here; what follows is the
//   receipt observer's.
// - The fuse (decision X25): right after the call, the account's entries are
//   compared with those before it — one click makes one entry, of the chat we
//   named. More than one is `count`, one of another chat `target` (receipt.ts
//   tells the isolated side). Nothing is undone or sent because of it.
//
// The page reads come from the bridge's runtime (LiveHost); the conditions
// that are not the page's — the person and the part, the hub identity, the
// hub's `dispatch`, the lease, the subscription the hub confirms (1–3, 9, 15)
// — are checked before MAIN is asked.

import { idOf, isPlain, type Plain } from '@cg/host-kit/main/check';
import { type LiveHost, type PageStore, type Tap } from './live';
import {
  CG_SEND_ACTIVE_CHAT,
  CG_SEND_BUSY,
  CG_SEND_FAN,
  CG_SEND_FRESHNESS,
  CG_SEND_HISTORY,
  CG_SEND_HOST,
  CG_SEND_MIMIC,
  CG_SEND_OFF,
  CG_SEND_PART,
  CG_SEND_PERMISSION,
  CG_SEND_QUEUE,
  CG_SEND_RECEIPT,
  CG_SEND_TRANSLATOR,
  CG_SEND_UNCERTAIN,
  CG_TIMEOUT,
  ENTRY_FAILED,
  KEY_MESSAGES,
  KEY_MIMIC_CHATS,
  KEY_MIMIC_SETTINGS,
  KEY_PERMISSIONS,
  MIMIC_ENABLED,
  PERMISSION_NO_SEND,
  PLATFORM,
  QUEUE_MAX_PER_CHAT,
  STORE_TRANSLATOR,
} from './protocol';
import { type SendRequest } from './requests';

/** The queue's action that sends; the bridge listens for it by this name and never calls it. */
export const QUEUE_SEND = 'enqueue';

/** §6.2 anchor `pendingMessages`: the queue action, its two per-account states and the two ways to watch it; nothing called. */
export function queueShape(store: Record<string, unknown>): 'ok' | 'shape' {
  return typeof store[QUEUE_SEND] === 'function' && isPlain(store['messagesByAccountId']) && isPlain(store['processingByAccountId']) && typeof store['$onAction'] === 'function' && typeof store['$subscribe'] === 'function'
    ? 'ok'
    : 'shape';
}

/** §6.2 anchor `pendingMessages`, the entry's keys: checked on the entry the queue returns to a send of ours. */
const ENTRY_KEYS = 'id,accountId,chatId,platform,status,error,createdAt,payload'.split(',');

/** What the receipt observer does around the one queue call (receipt.ts). */
export interface SendWatch {
  /** Right after the queue call returned or threw: the page's fetch is the page's again. */
  readonly release: () => void;
  /**
   * The queue gave its entry: its chain is followed to the receipt. False — its request did not take the observer:
   * nothing of it can be seen. Never called (the queue refused, or gave no entry we know) — nothing is followed or said.
   */
  readonly bind: (pendingId: string) => boolean;
  /** The fuse (decision X25): what this send did is not what one click of ours does; once per attempt. */
  readonly trip: (reason: 'count' | 'target', where: 'queue') => void;
}
export interface SendObserver {
  /** No send path that can be observed: one did not behave as its profile says (§6.7.6), or the page's fetch cannot be put aside. */
  readonly broken: () => boolean;
  /** Puts the observer onto the current synchronous stack for one queue call of ours. */
  readonly open: (attemptId: string, acc: string, fan: string, html: string) => SendWatch;
}

/** contracts PendingIdSchema (REF_PATTERN). */
export const isRef = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

/** §6.7.1: plain text → the HTML ChatSpace's own `setText` would build. */
export const toHtml = (text: string): string =>
  `<p>${text
    .replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')}</p>`;

/** §6.7.4 п. 13: the account's queue is sending or has something waiting (a send of ours would wait behind it). */
export const queueBusy = (host: LiveHost, queue: PageStore, acc: string): boolean => {
  const processing = queue['processingByAccountId'];
  return (isPlain(processing) && !!processing[acc]) || host.entries(acc).some((entry) => entry['status'] !== ENTRY_FAILED);
};

/** `held` answers kept for a repeated command. */
const MAX_HELD = 256;
const held = (code: string): Plain => ({ state: 'held', code });
const UNCERTAIN: Plain = { state: 'uncertain', code: CG_SEND_UNCERTAIN };

export function createSendPort(host: LiveHost, tap: Tap, observer: SendObserver, enabled: () => boolean) {
  /** The fuse (decision X25): one queue call of ours adds at most one entry, and only to the chat it names. */
  const added = (req: SendRequest, entry: unknown, before: ReadonlySet<unknown>, watch: SendWatch): void => {
    try {
      const fresh = host.entries(req.acc).filter((item) => !before.has(item['id']));
      // Only an id that reads, and reads as another: an entry the queue shapes otherwise is no evidence.
      const other = (value: unknown, ours: string): boolean => idOf(value) !== null && idOf(value) !== ours;
      if (fresh.some((item) => other(item['chatId'], req.fan) || other(item['accountId'], req.acc))) watch.trip('target', 'queue');
      else if (fresh.length > (entry === null ? 0 : 1)) watch.trip('count', 'queue');
    } catch {
      tap.fail('fuseQueue');
    }
  };

  /** Attempts that reached `commit`, with their first answer. */
  const used = new Map<string, Plain>();
  /** The attempts answered `held`, oldest first: only these are ever forgotten. */
  const heldIds: string[] = [];
  /** The queue answered a send of ours with what §6.2 does not know: no more X8 in this document. */
  let lost = false;

  /** Conditions 3–14 of §6.7.4 as the page shows them now; the first one that fails. */
  const conditions = (req: SendRequest): string | null => {
    const { acc, fan } = req;
    if (!enabled()) return CG_SEND_OFF;
    if (observer.broken()) return CG_SEND_RECEIPT;
    if (req.plainText.trim() === '') return CG_SEND_PART;
    const queue = host.queue();
    if (!queue || lost) return CG_SEND_HOST;
    // 5, 8: the account as loaded, bound to the same page; the role's permissions there and not blocking. «Loaded» is as
    // far as page memory tells: ChatSpace keeps `[]` after a failed or cleared load too, and its own Send goes by the same list.
    const permissions = host.data(KEY_PERMISSIONS);
    if (host.account(acc)?.platformAccountId !== req.platformAccountId || !Array.isArray(permissions) || permissions.includes(PERMISSION_NO_SEND)) return CG_SEND_PERMISSION;
    // 6: the open chat has its composer and the dock.
    const route = host.route();
    if (route.acc === acc && route.fan === fan) return CG_SEND_ACTIVE_CHAT;
    // 7: after the send ChatSpace invalidates this exact key; an observed or loading entry would load the history.
    const history = host.entry(KEY_MESSAGES, acc, fan);
    if (history && (history.active !== false || history.asyncStatus?.value !== 'idle')) return CG_SEND_HISTORY;
    // 9: what the page knows forbids; a fan it does not hold is not a refusal (the hub's subscription check is not MAIN's).
    const known = host.fan(acc, fan);
    if (known && (known['isBlocked'] === true || known['canReceiveMessages'] === false || known['isRestricted'] === true)) return CG_SEND_FAN;
    // 10: Mimic data must be loaded; no data is not «off».
    const mimic = host.data(KEY_MIMIC_SETTINGS);
    const mimicChats = host.data(KEY_MIMIC_CHATS);
    const mimicChat = isPlain(mimicChats) ? mimicChats[`${acc}:${fan}`] : null;
    if (!isPlain(mimic) || typeof mimicChats !== 'object' || mimicChats === null || (mimic['isActive'] === true && isPlain(mimicChat) && mimicChat['status'] === MIMIC_ENABLED)) return CG_SEND_MIMIC;
    // 11: the queue would bypass the auto-translation; it is off only when the settings say so (unreadable ones refuse).
    let translator: unknown;
    try {
      const store = host.store(STORE_TRANSLATOR);
      translator = (Reflect.apply(store?.['getAccountSettings'] as () => unknown, store, [acc]) as { value?: unknown }).value;
    } catch {
      // No store, or not the one we know.
    }
    if (!isPlain(translator) || (translator['enabled'] !== false && translator['autoTranslate'] !== false)) return CG_SEND_TRANSLATOR;
    // 13: never behind another send, never into a full chat queue.
    if (queueBusy(host, queue, acc) || host.entries(acc).filter((entry) => entry['chatId'] === fan).length >= QUEUE_MAX_PER_CHAT) return CG_SEND_BUSY;
    // 14: the checkpoint of Generate against the counters now.
    return req.checkpoint.documentEpoch !== host.epoch() ? CG_SEND_FRESHNESS : tap.fresh(req.checkpoint);
  };
  /** A read of ours that throws is a page we do not know: refused, for the button and for the click alike. */
  const refusal = (req: SendRequest): string | null => {
    try {
      return conditions(req);
    } catch {
      return CG_SEND_HOST;
    }
  };

  const send = (req: SendRequest): Plain => {
    if (Date.now() > req.expiresAt) return held(CG_TIMEOUT);
    const code = refusal(req);
    if (code) return held(code);
    const html = toHtml(req.plainText);
    let watch: SendWatch;
    try {
      watch = observer.open(req.attemptId, req.acc, req.fan, html);
    } catch {
      // Nothing reached the queue: «held», never «uncertain» (§6.7.7 п. 6).
      return held(CG_SEND_HOST);
    }
    let entry: unknown;
    /** The account's entries before the call: what the call added is told by them (the fuse). */
    let before: Set<unknown> | null = null;
    try {
      before = new Set(host.entries(req.acc).map((item) => item['id']));
    } catch {
      // Not readable: the fuse has nothing to compare.
    }
    try {
      // The one write into ChatSpace's store (D-07, §6.7.1): still the synchronous step of the checks above.
      entry = (host.queue() as unknown as { enqueue(input: Plain): unknown }).enqueue({
        accountId: req.acc,
        chatId: req.fan,
        platform: PLATFORM,
        text: html,
        hasAttachments: false,
        isAiGenerated: req.isAiGenerated,
        isCopied: false,
        platformMetadata: {},
        composerContent: { html, media: null, gif: null, taggedCreators: [] },
      });
    } catch {
      // The call boundary is not intact: the queue may hold the entry.
    } finally {
      watch.release();
    }
    if (before !== null) added(req, entry, before, watch);
    if (entry === null) return { state: 'notEnqueued', code: CG_SEND_QUEUE };
    // §6.2: the queue threw, or gave what is not the entry we know — its chain cannot be read to its end.
    const pendingId = isPlain(entry) && ENTRY_KEYS.every((key) => key in entry) && isRef(entry['id']) ? entry['id'] : null;
    lost = pendingId === null;
    return pendingId !== null && watch.bind(pendingId) ? { state: 'nativeEnqueued', pendingId } : UNCERTAIN;
  };

  return {
    /** No side effects; the reason for the button. */
    preflight(req: SendRequest): Plain {
      const code = refusal(req);
      return code ? { ok: false, code } : { ok: true };
    },
    /** One queue call per attempt id, ever; a repeated command gets the first answer. */
    commit(req: SendRequest): Plain {
      let result = used.get(req.attemptId);
      if (!result) {
        // Kept before the call: whatever happens inside, this attempt never runs again.
        used.set(req.attemptId, UNCERTAIN);
        used.set(req.attemptId, (result = send(req)));
        // Only «held» is ever forgotten, the oldest first: an attempt that may have reached the queue stays for the document's life.
        if (result['state'] === 'held' && heldIds.push(req.attemptId) > MAX_HELD) used.delete(heldIds.shift() as string);
      }
      return result;
    },
  };
}
