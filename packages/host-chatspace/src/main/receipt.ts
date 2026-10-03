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
//   returned or threw the previous value is put back, if the global is still ours.
// - The observer passes EVERY call through to the previous function with the
//   same `this` and arguments and returns its result as is. It never calls
//   fetch on its own, never delays, repeats or changes a request or a
//   response, never touches headers or cookies. For the exact
//   `POST api/v0/accounts/{acc}/chats/{chat}/messages` of this send it keeps
//   one clone of the request (taken before its body is read) and one of the
//   response, both bounded; a failure to read them only costs our certainty.
// - Outcome: a 2xx with a message id is the receipt (`nativeAccepted`). A 401
//   is not an outcome (the native client refreshes its token and re-runs the
//   request outside the observer). `rejected` is only a proven final refusal:
//   an intercepted 4xx other than 401 after which the queue's entry is FAILED,
//   or Message Guard at the end of the chain (FAILED `blocked`). 5xx, network
//   failures, the native 30 s timeout, an entry that vanished (cancel, reset,
//   sign-out), a second or foreign POST through the observer, a text that is
//   not the one queued — `uncertain`, and nothing is ever sent again.
// - The echo is linked by id only: the tap keeps the ids of outgoing messages
//   it saw (an echo may come before the response); `sentObserved` needs the
//   receipt AND the outgoing echo with the same id, account and fan. A
//   receipt waits for its echo without a deadline of its own (the background
//   has one for a silent attempt, §6.7.8). While the kept copies are being
//   read nothing is said: an entry taken away at that moment does not turn a
//   receipt into «uncertain».
// - The queue's state is watched (`$subscribe`, only while a send is
//   followed) for the end of the native chain: FAILED, or the entry gone —
//   `cancel`, a reset, a sign-out, or a success whose receipt was not seen.
//   None of the queue's actions is ever called from here (§6.10).

import { idOf, isPlain, type Plain } from './check';
import { type Fact, type LiveHost, type QueueListener, type Tap } from './live';
import { CG_SEND_GUARD, CG_SEND_REJECTED, CG_SEND_UNCERTAIN, ENTRY_FAILED, ERROR_BLOCKED, GUARD_CODE, SEND_PATH } from './protocol';
import { isRef, queueBusy, type SendObserver } from './send-port';

/** Characters of a kept copy that are parsed; a longer one is not ours to judge. */
const MAX_BODY = 65_536;
/** Receipts whose echo has not come; the oldest goes first. */
const MAX_AWAITING = 32;

/** Message Guard topics as the contract takes them: at most 16, 64 characters each. */
const topics = (value: unknown): string[] => (Array.isArray(value) ? (value as unknown[]) : []).slice(0, 16).map((item) => String(item).slice(0, 64));

/** Account and chat of a call that is the native send request (a Request, or a URL string with its options); null for any other call. */
const sendTarget = (input: unknown, init: unknown): RegExpExecArray | null => {
  const request = (input ?? {}) as { url?: unknown; method?: unknown };
  const url = typeof input === 'string' ? input : request.url;
  const method = (init as { method?: unknown } | undefined)?.method ?? request.method;
  return typeof url === 'string' && /^post$/i.test(String(method)) ? SEND_PATH.exec(url.split(/[?#]/)[0] as string) : null;
};

export function createReceipts(win: Window & typeof globalThis, host: LiveHost, tap: Tap): SendObserver & { readonly send: QueueListener; readonly echo: (fact: Fact) => void } {
  /** Sends whose native chain has not ended: each one's «the queue changed». */
  const open = new Set<() => void>();
  /** `acc:fan:id` of a receipt → what its outgoing echo completes. */
  const awaiting = new Map<string, () => void>();
  let broken = false;
  let stop: unknown = null;

  /**
   * Follows one send: `attempt` — the X8 attempt (its states go out as
   * `previewSendState`), or null with `fact` — a human send (one `humanSend`
   * fact). `text` — what its request must carry.
   */
  const follow = (acc: string, fan: string, text: unknown, attempt: string | null, fact: Plain | null) => {
    let pendingId: string | null = null;
    /** POSTs to the send path that went through the observer. */
    let calls = 0;
    /** Status of the intercepted response; 0 — none (yet). */
    let status = 0;
    /** The server's message id from that response. */
    let id: string | null = null;
    /** The server's error code and Message Guard topics of an intercepted refusal. */
    let code = '';
    let guard: string[] | null = null;
    /** The kept copies are being read. */
    let reading = false;
    /** A second POST, another chat's, or a text that is not the one queued: nothing can be claimed. */
    let odd = false;
    /** The native chain ended: an outcome was said, the queue is no longer watched for it. */
    let done = false;

    const say = (state: string, extra: Plain): void => host.post('previewSendState', { view: { attemptId: attempt, state, ...extra } });
    const human = (platformMessageId: string | null): void => host.post('humanSend', { ...fact, pendingId, platformMessageId });
    const close = (): void => {
      done = true;
      open.delete(decide);
      if (open.size === 0 && typeof stop === 'function') {
        (stop as () => void)();
        stop = null;
      }
    };

    /** The receipt of exactly this send. */
    const accept = (receipt: string): void => {
      close();
      const view = { platformMessageId: receipt };
      if (!attempt) return human(receipt);
      say('nativeAccepted', view);
      if (tap.echoed(acc, fan, receipt)) return say('sentObserved', view);
      awaiting.set(`${acc}:${fan}:${receipt}`, () => say('sentObserved', view));
      if (awaiting.size > MAX_AWAITING) awaiting.delete(awaiting.keys().next().value as string);
    };

    /**
     * One outcome per send, and only once the queue gave its entry: after an outcome nothing calls this again (the
     * queue is no longer watched for it, the one read has ended).
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
      // The entry is gone and no request of it passed the observer: the send path is not the profile's.
      if (!entry && !calls) broken = true;
      const error = failed && isPlain(entry['error']) ? entry['error'] : {};
      const blocked = error['kind'] === ERROR_BLOCKED;
      const refused = status >= 400 && status < 500 && status !== 401;
      const upstream = status ? `HTTP ${status} ${code}`.trim() : 'no receipt';
      if (failed && !odd && (refused || blocked)) {
        say('rejected', {
          code: blocked || guard ? CG_SEND_GUARD : CG_SEND_REJECTED,
          ...(refused ? { httpStatus: status } : {}),
          detail: { ...(blocked || guard ? { guardTopics: guard ?? topics(isPlain(error['guard']) ? error['guard']['topics'] : null) } : {}), upstream },
        });
      } else say('uncertain', { code: CG_SEND_UNCERTAIN, detail: { upstream } });
    };

    /** Reads the kept copies of the one request of this send; the page's own objects are never read. */
    const read = (copy: Request, answer: Promise<Response>): void => {
      reading = true;
      const body = copy
        .text()
        .then((raw) => {
          if (raw.length > MAX_BODY || (JSON.parse(raw) as Plain)['text'] !== text) odd = true;
        })
        .catch(() => {
          odd = true;
        });
      const reply = answer
        .then((response) => {
          status = response.status;
          // A 401 is not an outcome and a 5xx proves nothing: their bodies are left alone.
          return status === 401 || status >= 500 ? '' : response.clone().text();
        })
        .then((raw) => {
          const json: unknown = raw && raw.length <= MAX_BODY ? JSON.parse(raw) : null;
          if (!isPlain(json)) return;
          if (status >= 200 && status < 300) id = typeof json['id'] === 'number' && !Number.isSafeInteger(json['id']) ? null : idOf(json['id']);
          else {
            code = typeof json['code'] === 'string' ? json['code'].slice(0, 64) : '';
            if (code === GUARD_CODE) guard = topics(json['topic_matches']);
          }
        })
        .catch(() => undefined);
      void Promise.all([body, reply]).then(() => {
        reading = false;
        decide();
      });
    };

    return {
      /** Puts the observer in place of the page's fetch; the returned function puts the previous value back if the global is still ours. */
      capture(): () => void {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- the page's function, only ever called with its caller's own `this`
        const previous = win.fetch;
        if (typeof previous !== 'function') return () => undefined;
        const observer = function (this: unknown, ...args: unknown[]): unknown {
          let copy: Request | undefined;
          let hit = false;
          try {
            const target = done ? null : sendTarget(args[0], args[1]);
            if (target) {
              hit = true;
              calls += 1;
              // ChatSpace's client hands fetch a Request; its copy is taken before the previous function reads the body.
              if (calls === 1 && target[1] === acc && target[2] === fan) copy = (args[0] as Request).clone();
            }
          } catch {
            // No copy: nothing can be claimed.
          }
          const result: unknown = Reflect.apply(previous, this, args);
          if (hit) {
            odd ||= !copy;
            try {
              if (copy) read(copy, result as Promise<Response>);
              else decide();
            } catch {
              odd = true;
            }
          }
          return result;
        };
        win.fetch = observer as typeof win.fetch;
        return () => {
          if (win.fetch === observer) win.fetch = previous;
        };
      },
      /** The queue gave its entry: its chain is followed in the queue's own state until it ends. */
      bind: (entryId: string): void => {
        pendingId = entryId;
        open.add(decide);
        stop ??=
          host.queue()?.$subscribe?.(
            () => {
              for (const each of open) {
                try {
                  each();
                } catch {
                  // Inside ChatSpace's own state change: a failure of ours stays here.
                }
              }
            },
            { detached: true, flush: 'sync' },
          ) ?? null;
        decide();
      },
      /** Nothing was queued. */
      drop: (): void => {
        done = true;
      },
    };
  };

  return {
    broken: () => broken,
    open(attemptId, acc, fan, html) {
      const followed = follow(acc, fan, html, attemptId, null);
      return { release: followed.capture(), bind: followed.bind, drop: followed.drop };
    },
    /**
     * §6.6: a send that is not ours. Only the open chat's composer counts: it passes its content along, and its draft
     * is known. Our own queue call comes through here too and is never the open chat's (§6.7.4 п. 6): it has no draft.
     */
    send(input, after, onError) {
      const args = isPlain(input) ? input : {};
      const acc = idOf(args['accountId']);
      const fan = idOf(args['chatId']);
      const queue = host.queue();
      // The draft is read here, before the send clears the field.
      const from = acc && fan && queue && isPlain(args['composerContent']) ? host.draft(acc, fan) : null;
      if (!acc || !fan || !queue || !from) return;
      const fact = { acc, fan, textDigest: from.digest, draft: from.draft };
      // A draft that is not from our insert has nothing to attribute; a send that waits behind another creates its
      // request later, outside this stack. Both go out as facts without a receipt: attribution unknown.
      const followed = from.draft.insertIntentId && !queueBusy(host, queue, acc) ? follow(acc, fan, args['text'], null, fact) : null;
      const release = followed?.capture();
      // Both run inside ChatSpace's own action: the page's fetch goes back first, and nothing of ours may throw into it.
      after((entry) => {
        release?.();
        try {
          const pendingId = isPlain(entry) && isRef(entry['id']) ? entry['id'] : null;
          // The queue refused: nothing was sent.
          if (!pendingId) return;
          if (followed) followed.bind(pendingId);
          else host.post('humanSend', { ...fact, pendingId, platformMessageId: null });
        } catch {
          // The send went on; its fact is lost.
        }
      });
      onError(() => release?.());
    },
    echo(fact) {
      const tag = `${fact.acc}:${fact.fan}:${fact.msgId}`;
      const sent = fact.fromFan ? undefined : awaiting.get(tag);
      if (sent && awaiting.delete(tag)) sent();
    },
  };
}
