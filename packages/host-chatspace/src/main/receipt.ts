// The receipt observer (architecture.md §6.6, §6.7.6): the second passive
// observer of MAIN, never a second write and never a request of our own.
//
// ChatSpace's queue returns a local id, not the result of the send, and its
// own echo matching compares plain text. The only exact link is the server's
// message id in the response of the native POST. To read it:
// - Only for the one synchronous stack of a queue call — ours (the X8 send),
//   or a human's composer send whose draft descends from our insert and whose
//   account queue is free (§6.6) — `fetch` of the page is replaced by an
//   observer. ChatSpace's HTTP client takes `globalThis.fetch` when it creates
//   the request, synchronously inside that call; right after the call
//   returned or threw the previous value is put back, if the global is still
//   ours — and for a human send once more at the end of the stack, should the
//   queue's action ever stop being synchronous.
// - The observer passes EVERY call through to the previous function with the
//   same `this` and arguments and returns its result as is. It never calls
//   fetch on its own, never delays, repeats or changes a request or a
//   response, never touches headers or cookies. For the exact
//   `POST api/v0/accounts/{acc}/chats/{chat}/messages` of this send it keeps
//   one clone of the request (taken before its body is read) and one of the
//   response. The copies are read whole and judged only up to MAX_BODY
//   characters (a longer one is not ours to judge); a failure to read them
//   only costs our certainty.
// - Outcome: a 2xx with a message id is the receipt (`nativeAccepted`). A 401
//   is not an outcome (the native client refreshes its token and re-runs the
//   request outside the observer). `rejected` is only a proven final refusal:
//   an intercepted 4xx other than 401 after which the queue's entry is FAILED,
//   or Message Guard at the end of the chain (FAILED `blocked`). 5xx, network
//   failures, the native 30 s timeout, an entry that vanished (cancel, reset,
//   sign-out), a second or foreign POST through the observer, a text that is
//   not the one queued — `uncertain`, and nothing is ever sent again.
// - The echo is linked by id only: while a send is followed, the outgoing
//   ids seen for its chat are kept with it (an echo may come before the
//   response; other chats cannot push them out). The linked pair — the
//   receipt AND the outgoing echo with the same id, account and fan — is
//   what says `sentObserved` for X8 and what a human send's fact with a
//   message id means (§6.6 п. 4, TL-004): that fact goes out when the pair
//   is whole, and at once, without an id, when the chain ended without a
//   receipt. A receipt waits for its echo without a deadline of its own (the
//   background has one for a silent attempt, §6.7.8). While the kept copies
//   are being read nothing is said: an entry taken away at that moment does
//   not turn a receipt into «uncertain».
// - The client takes fetch for its request with `fetch.bind(globalThis)`
//   (§6.7.6 п. 2; the receipt profile pins that module). The observer hears
//   that `bind` on itself: a queue call whose request did not take it is not
//   the profile's send path — `uncertain` at once, and no more X8 in this
//   document. An entry that goes away before its request reached fetch
//   (Cancel, a reset, a sign-out while the client waits for its token) is
//   only `uncertain`.
// - A page whose `fetch` cannot be replaced (none, or a property that takes
//   no assignment) has no observable send path: X8 is refused there before
//   anything is queued (CG-SEND-RECEIPT, the preflight says so too).
// - The queue's state is watched (`$subscribe`, only while a send is
//   followed) for the end of the native chain: FAILED, or the entry gone —
//   `cancel`, a reset, a sign-out, or a success whose receipt was not seen.
//   None of the queue's actions is ever called from here (§6.10).
// - What ChatSpace calls — the observer in place of fetch, the queue's
//   `after`/`onError` and `$subscribe` — keeps every failure of ours inside
//   (guard.ts; counted by the bridge). The previous fetch is called outside
//   any of it: what it throws or returns — a rejection too — is ChatSpace's
//   and reaches ChatSpace unchanged, the very same value.
// - The fuse (decision X25). Every ChatSpace build may now pass the receipt
//   gate, so after an X8 send this observer checks the evidence it already
//   holds and tells the isolated side (`previewSendFuse`, once per attempt)
//   when it is not what we sent:
//   - `text` — the request ChatSpace put on the wire, the message its
//     response carries, or the outgoing echo of the receipt's id shows another
//     text than the part we queued (compared as ChatSpace shows a text,
//     shown.ts: a rewrite of the same text is no trip);
//   - `count` — a second POST through the observer, or, from the queue call
//     until shortly after the receipt, a second outgoing echo in that chat
//     with our text (send-port.ts adds: a second queue entry);
//   - `target` — a POST through the observer to another chat or account, or
//     the echo of our receipt's id in another chat or account.
//   The outcome of the attempt is what it is (a linked pair stays
//   `sentObserved`); the fuse only turns X8 off. It never sends, never
//   retries, never changes a request. The echo's text is read here only for
//   such a comparison and is kept nowhere.

import { idOf, isPlain, type Plain } from './check';
import { type Fact, type LiveHost, type QueueListener, type Tap } from './live';
import { CG_SEND_GUARD, CG_SEND_REJECTED, CG_SEND_UNCERTAIN, ENTRY_FAILED, ERROR_BLOCKED, EVT_FUSE, GUARD_CODE, SEND_PATH } from './protocol';
import { isRef, queueBusy, type SendObserver } from './send-port';
import { sameShown, shownForms } from './shown';

/** Characters of a kept copy that are parsed; a longer one is not ours to judge. */
const MAX_BODY = 65_536;
/** Receipts whose echo has not come; the oldest goes first. */
const MAX_AWAITING = 32;
/** Outgoing ids kept with one followed send (its chat's, from the queue call to the receipt). */
const MAX_EARLY = 64;
/** X8 sends whose chat is watched for a second message with their text (the fuse's `count`); the oldest goes first. */
const MAX_WATCHED = 32;
/** How long after its receipt a send's chat is still watched for a second outgoing echo with its text. */
export const ECHO_TAIL_MS = 10_000;
/** Receipts of X8 sends whose id is watched in other chats (the fuse's `target`); the oldest goes first. */
const MAX_RECEIPTS = 64;

/** Message Guard topics as the contract takes them: at most 16, 64 characters each. */
const topics = (value: unknown): string[] => (Array.isArray(value) ? (value as unknown[]) : []).slice(0, 16).map((item) => String(item).slice(0, 64));

/** Account and chat of a call that is the native send request (a Request, or a URL with its options); null for any other call. */
const sendTarget = (input: unknown, init: unknown): RegExpExecArray | null => {
  const request = input as { url?: unknown; method?: unknown } | undefined;
  const method = (init as { method?: unknown } | undefined)?.method ?? request?.method;
  return /^post$/i.test(String(method)) ? SEND_PATH.exec(String(request?.url ?? input).split(/[?#]/)[0] as string) : null;
};

/** The fuse's word about one X8 send (decision X25): reason and where it was seen; `seenChars` — the length of another text. */
type Trip = (reason: 'text' | 'count' | 'target', where: 'request' | 'response' | 'echo' | 'queue', seenChars?: number) => void;

/** The length of a text as shown (shown.ts), for the logs: never the text. */
const charsOf = (text: unknown): number => shownForms(text)?.[0]?.length ?? 0;

/** A send whose native chain has not ended. */
interface Followed {
  readonly chat: string;
  /** Our part as ChatSpace would show it (X8 only; null — a human send, or not told). */
  readonly forms: readonly string[] | null;
  /** Outgoing ids seen for its chat since its queue call. */
  readonly seen: string[];
  /** Of those, the ones whose text is another than ours (X8 only), with its length. */
  readonly others: Map<string, number>;
  /** «The queue changed». */
  readonly decide: () => void;
}

/** An X8 send's chat, watched for a second outgoing message with its text. */
interface Watched {
  readonly chat: string;
  readonly forms: readonly string[];
  readonly ids: Set<string>;
  /** Until when (local clock); Infinity — its chain has not ended. */
  until: number;
  readonly trip: Trip;
}

export function createReceipts(
  win: Window & typeof globalThis,
  host: LiveHost,
  { guard, fail }: Pick<Tap, 'guard' | 'fail'>,
): SendObserver & { readonly send: QueueListener; readonly echo: (fact: Fact, content?: unknown) => void } {
  const open = new Set<Followed>();
  /** «The queue changed» for each send followed; one that fails leaves the others theirs. */
  const decideOne = guard('decide', (each: Followed) => each.decide());
  /** `acc:fan:id` of a receipt → what its outgoing echo completes (with that echo's text). */
  const awaiting = new Map<string, (content: unknown) => void>();
  /** X8 sends whose chat is watched for a second message with their text. */
  const watched: Watched[] = [];
  /** The id of an X8 receipt → its chat and its fuse: the echo of that id must come in that chat. */
  const receipts = new Map<string, { readonly chat: string; readonly trip: Trip }>();
  let broken = false;
  let stop: unknown = null;

  /** The page's fetch cannot be put aside for one stack: none, or its own property takes no assignment (not writable, a getter alone). */
  const fixed = (): boolean => {
    const own = Object.getOwnPropertyDescriptor(win, 'fetch');
    return typeof win.fetch !== 'function' || !(!own || own.writable || own.set);
  };

  /**
   * Follows one send: `attempt` — the X8 attempt (its states go out as
   * `previewSendState`), or null with `fact` — a human send (one `humanSend`
   * fact). `text` — what its request must carry.
   */
  const follow = (acc: string, fan: string, text: unknown, attempt: string | null, fact: Plain | null) => {
    let pendingId: string | null = null;
    /** Our part as ChatSpace would show it (X8 only): what the fuse compares. */
    const forms = attempt ? shownForms(text) : null;
    let tripped = false;
    /** The fuse, once per attempt (decision X25); a human send is not ours to judge. */
    const trip: Trip = (reason, where, seenChars) => {
      if (!attempt || tripped) return;
      tripped = true;
      const lengths = reason === 'text' ? { sentChars: forms?.[0]?.length ?? 0, seenChars: seenChars ?? 0 } : {};
      host.post(EVT_FUSE, { attemptId: attempt, reason, where, ...lengths });
    };
    /** The send's chat is watched for a second message with our text (`count`), from the queue call on. */
    const watch: Watched | null = attempt && forms ? { chat: `${acc}:${fan}`, forms, ids: new Set(), until: Number.POSITIVE_INFINITY, trip } : null;
    if (watch) {
      watched.push(watch);
      if (watched.length > MAX_WATCHED) watched.shift();
    }
    /** The echo of the receipt's id shows our text, or the fuse trips. */
    const checkEcho = (content: unknown): void => {
      if (sameShown(forms, content) === false) trip('text', 'echo', charsOf(content));
    };
    /** The client took the observer for its request (`.bind`, the profile's capture), or called it. */
    let taken = false;
    /** POSTs to the send path that went through the observer. */
    let calls = 0;
    /** Status of the intercepted response; 0 — none (yet). */
    let status = 0;
    /** The server's message id from that response. */
    let id: string | null = null;
    /** The server's error code and Message Guard topics of an intercepted refusal. */
    let code = '';
    let guardTopics: string[] | null = null;
    /** The kept copies are being read. */
    let reading = false;
    /** A second POST, another chat's, or a text that is not the one queued: nothing can be claimed. */
    let odd = false;
    /** The native chain ended: an outcome was said, the queue is no longer watched for it. */
    let done = false;

    const say = (state: string, extra: Plain): void => host.post('previewSendState', { view: { attemptId: attempt, state, ...extra } });
    const human = (platformMessageId: string | null): void => host.post('humanSend', { ...fact, pendingId, platformMessageId });
    /** The chain ended: with a receipt the chat is watched a little longer (a second echo may follow the first), else no more. */
    const close = (receipt = false): void => {
      done = true;
      if (watch) watch.until = receipt ? Date.now() + ECHO_TAIL_MS : 0;
      open.delete(self);
      if (open.size === 0 && typeof stop === 'function') {
        (stop as () => void)();
        stop = null;
      }
    };

    /** The receipt of exactly this send; with its outgoing echo it is the linked pair (§6.6 п. 4, §6.7.6 п. 6). */
    const accept = (receipt: string): void => {
      close(true);
      const view = { platformMessageId: receipt };
      const paired = attempt
        ? (content: unknown): void => {
            checkEcho(content);
            say('sentObserved', view);
          }
        : (): void => human(receipt);
      if (attempt) {
        say('nativeAccepted', view);
        // Its id must come back in this chat and no other (the fuse's `target`).
        receipts.set(receipt, { chat: self.chat, trip });
        if (receipts.size > MAX_RECEIPTS) receipts.delete(receipts.keys().next().value as string);
      }
      if (self.seen.includes(receipt)) {
        // The echo came first: whether its text is ours was told when it came.
        const other = self.others.get(receipt);
        if (other !== undefined) trip('text', 'echo', other);
        return attempt ? say('sentObserved', view) : human(receipt);
      }
      awaiting.set(`${self.chat}:${receipt}`, paired);
      if (awaiting.size > MAX_AWAITING) awaiting.delete(awaiting.keys().next().value as string);
    };

    /**
     * One outcome per send, and only once the queue gave its entry (a send that was never bound says nothing): after an
     * outcome nothing calls this again (the queue is no longer watched for it, the one read has ended).
     */
    const decide = (): void => {
      if (reading || !pendingId) return;
      if (id && !odd) return accept(id);
      const entry = host.entries(acc).find((item) => item['id'] === pendingId);
      const failed = entry?.['status'] === ENTRY_FAILED;
      if (entry && !failed && !odd) return;
      // The chain ended without a receipt: a proven refusal, or nothing that can be claimed.
      close();
      if (!attempt) return human(null);
      const error = failed && isPlain(entry['error']) ? entry['error'] : {};
      const blocked = error['kind'] === ERROR_BLOCKED;
      const refused = status >= 400 && status < 500 && status !== 401;
      const upstream = status ? `HTTP ${status} ${code}`.trim() : 'no receipt';
      if (failed && !odd && (refused || blocked)) {
        say('rejected', {
          code: blocked || guardTopics ? CG_SEND_GUARD : CG_SEND_REJECTED,
          ...(refused ? { httpStatus: status } : {}),
          detail: { ...(blocked || guardTopics ? { guardTopics: guardTopics ?? topics(isPlain(error['guard']) ? error['guard']['topics'] : null) } : {}), upstream },
        });
      } else say('uncertain', { code: CG_SEND_UNCERTAIN, detail: { upstream } });
    };

    /** Reads the kept copies of the one request of this send; the page's own objects are never read. */
    const read = async (copy: Request, answer: Promise<Response>): Promise<void> => {
      reading = true;
      // The response's copy is taken the moment it arrives, before the page reads its own; no answer — no receipt.
      const reply = answer
        .then((response) => {
          status = response.status;
          // A 401 is not an outcome and a 5xx proves nothing: their bodies are left alone.
          return status === 401 || status >= 500 ? '' : response.clone().text();
        })
        .catch(() => '');
      try {
        const sent = await copy.text();
        const body = sent.length > MAX_BODY ? null : (JSON.parse(sent) as Plain);
        odd ||= body === null || body['text'] !== text;
        // The fuse: what went on the wire shows another text than the part we queued.
        if (body !== null && sameShown(forms, body['text']) === false) trip('text', 'request', charsOf(body['text']));
      } catch {
        odd = true;
      }
      try {
        const raw = await reply;
        const json: unknown = raw.length <= MAX_BODY ? JSON.parse(raw) : null;
        if (isPlain(json)) {
          if (status >= 200 && status < 300) {
            id = idOf(json['id']);
            // The fuse: the message the response carries shows another text (a response without one says nothing).
            if (sameShown(forms, json['content']) === false) trip('text', 'response', charsOf(json['content']));
          } else {
            code = typeof json['code'] === 'string' ? json['code'].slice(0, 64) : '';
            if (code === GUARD_CODE) guardTopics = topics(json['topic_matches']);
          }
        }
      } catch {
        // Not an answer we can read: no receipt.
      }
      reading = false;
      decide();
    };

    const self: Followed = { chat: `${acc}:${fan}`, forms, seen: [], others: new Map(), decide };
    return {
      trip,
      /** Puts the observer in place of the page's fetch; the returned function puts the previous value back if the global is still ours. */
      capture(): () => void {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- the page's function, only ever called with its caller's own `this`
        const previous = win.fetch;
        const observer = function (this: unknown, ...args: unknown[]): unknown {
          let copy: Request | undefined;
          let hit = false;
          taken = true;
          try {
            const target = done ? null : sendTarget(args[0], args[1]);
            if (target) {
              hit = true;
              calls += 1;
              // ChatSpace's client hands fetch a Request; its copy is taken before the previous function reads the body.
              if (calls === 1 && target[1] === acc && target[2] === fan) copy = (args[0] as Request).clone();
              // The fuse: one click, one POST, to the chat we named.
              else if (target[1] !== acc || target[2] !== fan) trip('target', 'request');
              else trip('count', 'request');
            }
          } catch {
            // No copy: nothing can be claimed.
            fail('observe');
          }
          // ChatSpace's own call: what the previous fetch throws, or the promise it returns, is ChatSpace's, as it is.
          const result: unknown = Reflect.apply(previous, this, args);
          if (hit) {
            odd ||= !copy;
            try {
              if (copy) read(copy, result as Promise<Response>).catch(() => fail('read'));
              else decide();
            } catch {
              odd = true;
              fail('observe');
            }
          }
          return result;
        };
        // The client's capture (§6.7.6 п. 2) is heard on our own function only; what it gets is what `bind` gives.
        // eslint-disable-next-line @typescript-eslint/unbound-method -- applied to the observer right below
        const bind = observer.bind;
        (observer as { bind: unknown }).bind = (...args: [unknown, ...unknown[]]): unknown => {
          taken = true;
          return bind.apply(observer, args);
        };
        win.fetch = observer as typeof win.fetch;
        return () => {
          if (win.fetch === observer) win.fetch = previous;
        };
      },
      /**
       * The queue gave its entry: its chain is followed in the queue's own state until it ends. False — its request
       * did not take the observer, nothing of it can be seen: for X8 that is not the profile's send path (no more X8);
       * for a human send, a fact without a receipt.
       */
      bind: (entryId: string): boolean => {
        pendingId = entryId;
        if (!taken) {
          done = true;
          if (watch) watch.until = 0;
          if (attempt) broken = true;
          else human(null);
          return false;
        }
        open.add(self);
        // Inside ChatSpace's own state change: a failure of ours stays here.
        stop ??=
          host.queue()?.$subscribe?.(
            guard('queueState', () => open.forEach(decideOne)),
            { detached: true, flush: 'sync' },
          ) ?? null;
        decide();
        return true;
      },
    };
  };

  return {
    broken: () => broken || fixed(),
    open(attemptId, acc, fan, html) {
      const followed = follow(acc, fan, html, attemptId, null);
      return { release: followed.capture(), bind: followed.bind, trip: followed.trip };
    },
    /**
     * §6.6: a send that is not ours. Only the open chat's composer counts: it passes its content along, and its draft
     * is known. Our own queue call comes through here too and is never the open chat's (§6.7.4 п. 6): it has no draft.
     */
    send(input, after, onError) {
      const args = isPlain(input) ? input : {};
      const acc = idOf(args['accountId']);
      const fan = idOf(args['chatId']);
      // Another send in a chat whose last X8 send is in its tail (the fuse's `count`): the messages from here on may be
      // that send's — ours or the person's — and are not counted against the one before.
      const now = Date.now();
      for (const each of watched) if (each.chat === `${acc ?? ''}:${fan ?? ''}` && Number.isFinite(each.until) && each.until > now) each.until = 0;
      const queue = host.queue();
      // The draft is read here, before the send clears the field.
      const from = acc && fan && queue && isPlain(args['composerContent']) ? host.draft(acc, fan) : null;
      if (!acc || !fan || !queue || !from) return;
      const followed = follow(acc, fan, args['text'], null, { acc, fan, textDigest: from.digest, draft: from.draft });
      // The observer goes in only when there is something to attribute and the request is created on this stack. A
      // draft that is not from our insert, or a send that waits behind another (its request comes later), takes no
      // observer: its fact goes out without a receipt — attribution unknown.
      const release = from.draft.insertIntentId && !queueBusy(host, queue, acc) && !fixed() ? followed.capture() : null;
      const restore = guard('release', () => release?.());
      // The observer never outlives this synchronous stack, even if the queue's action stopped being synchronous.
      if (release) queueMicrotask(restore);
      // Both run inside ChatSpace's own action: the page's fetch goes back first, and nothing of ours may throw into it.
      after(
        guard('after', (entry: unknown) => {
          restore();
          // No entry — the queue refused: nothing was sent. A failure here loses the send's fact; the send went on.
          if (isPlain(entry) && isRef(entry['id'])) followed.bind(entry['id']);
        }),
      );
      onError(restore);
    },
    echo(fact, content) {
      if (fact.fromFan) return;
      const chat = `${fact.acc}:${fact.fan}`;
      for (const each of open) {
        if (each.chat !== chat || each.seen.length >= MAX_EARLY) continue;
        each.seen.push(fact.msgId);
        // An X8 send keeps only whether this echo shows its text — should it turn out to be its receipt's.
        if (each.forms !== null && sameShown(each.forms, content) === false) each.others.set(fact.msgId, charsOf(content));
      }
      // The fuse (decision X25), X8 sends only: the echo of a receipt's id in another chat or account (`target`)…
      const receipt = receipts.get(fact.msgId);
      if (receipt && receipt.chat !== chat) receipt.trip('target', 'echo');
      // …and a second outgoing message with the same text in a watched chat (`count`). A redelivery is the same id.
      const now = Date.now();
      for (let i = watched.length - 1; i >= 0; i -= 1) if ((watched[i] as Watched).until < now) watched.splice(i, 1);
      for (const each of watched) {
        if (each.chat !== chat || sameShown(each.forms, content) !== true) continue;
        each.ids.add(fact.msgId);
        if (each.ids.size > 1) each.trip('count', 'echo');
      }
      const tag = `${chat}:${fact.msgId}`;
      const paired = awaiting.get(tag);
      if (paired && awaiting.delete(tag)) paired(content);
    },
  };
}
