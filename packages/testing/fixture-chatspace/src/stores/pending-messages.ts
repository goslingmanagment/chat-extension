// The send queue `pendingMessages` (metadata.ts «send-queue»): written from
// the observable behaviour of ChatSpace's store, not from its code.
// - enqueue(input) → the entry, or null when Mimic runs the chat or the chat
//   already holds 50 entries;
// - a sequential queue per account: one POST at a time, status SENDING set
//   synchronously, the HTTP request object created on the SAME synchronous
//   stack as enqueue when the account's queue is free;
// - a 30 s timeout (AbortController) → FAILED {kind: 'timeout'}; Message Guard
//   → FAILED {kind: 'blocked', guard}; other errors → FAILED {kind: 'platform'};
//   never a retry on its own;
// - success: the sent message goes into the chat's history cache (or the exact
//   key is invalidated when there is no cache), the entry disappears;
// - confirmEchoedMessage matches an outgoing echo by chat + PLAIN TEXT;
// - two silent resets, as ChatSpace's store has, through internal calls that
//   `$onAction` does not see: sign-out drops every entry, and an account that
//   leaves the accounts list drops its entries — both abort in-flight POSTs,
//   so a SENDING entry can vanish with no action and no answer.

import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

import { env, storeId } from '../env';
import { record } from '../journal';
import { isSignedIn } from '../net/auth';
import { api, errorBody, HTTPError } from '../net/http';
import { useQueryCache, type QueryCache } from '../query/cache';
import { hasMessage, newestMessage, plainText, sentMessageMetadata, upsertMessage, type Account, type History, type Message } from '../query/model';
import { keys } from '../query/queries';

export const PendingStatus = { PENDING: 'pending', SENDING: 'sending', FAILED: 'failed', CONFIRMED: 'confirmed' } as const;
export type PendingStatusValue = (typeof PendingStatus)[keyof typeof PendingStatus];

export type PendingError =
  | { readonly kind: 'timeout'; readonly text: string }
  | { readonly kind: 'blocked'; readonly guard: { readonly words: readonly string[]; readonly topics: readonly string[] } | null }
  | { readonly kind: 'platform'; readonly text: string; readonly tooltip?: string };

export interface ComposerContent {
  readonly html: string;
  readonly media: unknown;
  readonly gif: unknown;
  readonly taggedCreators: readonly unknown[];
}

export interface QueueInput {
  readonly accountId: string;
  readonly chatId: string;
  readonly platform: string;
  readonly text: string;
  readonly hasAttachments?: boolean;
  readonly platformMetadata?: Readonly<Record<string, unknown>>;
  readonly composerContent?: ComposerContent;
  readonly internalTemplateId?: string | null;
  readonly isCopied?: boolean;
  readonly isAiGenerated?: boolean;
}

export interface PendingEntry {
  readonly id: string;
  readonly accountId: string;
  readonly chatId: string;
  readonly platform: string;
  readonly status: PendingStatusValue;
  readonly error: PendingError | null;
  readonly createdAt: string;
  readonly payload: {
    readonly text: string;
    readonly hasAttachments: boolean;
    readonly platformMetadata: Readonly<Record<string, unknown>> | undefined;
    readonly composerContent: ComposerContent | undefined;
    readonly internalTemplateId: string | null | undefined;
    readonly isCopied: boolean | undefined;
    readonly isAiGenerated: boolean | undefined;
  };
}

/** Per chat. */
export const QUEUE_LIMIT = 50;
/** Unsend window of a freshly sent message, seconds. */
const SENT_CANCEL_SECONDS = 60;

const GUARD_TOPICS: Readonly<Record<string, string>> = {
  direct_contact: 'Direct contact',
  third_party_payment: 'Third-party payment',
  underage: 'Underage',
  hate_speech: 'Hate speech',
};

/** Mimic runs this chat: settings active and the chat enabled (the same check as the composer's). */
export function isMimicTakeover(cache: QueryCache, accountId: string, chatId: string): boolean {
  if (cache.getQueryData<{ isActive?: boolean }>(keys.mimicSettings())?.isActive !== true) return false;
  return cache.getQueryData<Record<string, { status?: string }>>(keys.mimicChats())?.[`${accountId}:${chatId}`]?.status === 'enabled';
}

async function guardOf(error: unknown): Promise<{ words: string[]; topics: string[] } | null> {
  if (!(error instanceof HTTPError)) return null;
  try {
    const body = (await error.response.clone().json()) as { word_matches?: unknown; topic_matches?: unknown };
    const words = Array.isArray(body.word_matches) ? body.word_matches.filter((item): item is string => typeof item === 'string') : [];
    const topics = Array.isArray(body.topic_matches) ? body.topic_matches.filter((item): item is string => typeof item === 'string').map((topic) => GUARD_TOPICS[topic] ?? topic) : [];
    return words.length === 0 && topics.length === 0 ? null : { words, topics };
  } catch {
    return null;
  }
}

let localSeq = 0;
/** A local entry id (a UUID; a stand-own counter where crypto.randomUUID is missing). */
const localId = (): string => {
  localSeq += 1;
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `stand-local-${localSeq}`;
};

const isAbort = (error: unknown): boolean => error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

const sameText = (left: string, right: string): boolean => {
  const a = plainText(left);
  const b = plainText(right);
  return a === '' && b === '' ? false : a === b;
};

export const usePendingMessages = defineStore(storeId('pendingMessages'), () => {
  const cache = useQueryCache();
  const messagesByAccountId = ref<Record<string, PendingEntry[]>>({});
  const processingByAccountId = ref<Record<string, boolean>>({});
  const controllers = new Map<string, AbortController>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const find = (accountId: string, id: string): { list: PendingEntry[]; index: number; entry: PendingEntry } | null => {
    const list = messagesByAccountId.value[accountId];
    if (list === undefined) return null;
    const index = list.findIndex((entry) => entry.id === id);
    const entry = list[index];
    return entry === undefined ? null : { list, index, entry };
  };
  const setStatus = (accountId: string, id: string, status: PendingStatusValue, error: PendingError | null = null): void => {
    const hit = find(accountId, id);
    if (hit === null) return;
    hit.list[hit.index] = { ...hit.entry, status, error };
    record('queue-status', { accountId, id, chatId: hit.entry.chatId, status, error: error?.kind ?? null });
  };
  const removeEntry = (accountId: string, id: string): boolean => {
    const hit = find(accountId, id);
    if (hit === null) return false;
    hit.list.splice(hit.index, 1);
    if (hit.list.length === 0) delete messagesByAccountId.value[accountId];
    record('queue-removed', { accountId, id });
    return true;
  };
  const clearTimer = (id: string): void => {
    clearTimeout(timers.get(id));
    timers.delete(id);
  };
  const countForChat = (accountId: string, chatId: string): number => messagesByAccountId.value[accountId]?.filter((entry) => entry.chatId === chatId).length ?? 0;
  const accountOf = (accountId: string): Account | undefined => cache.getQueryData<Account[]>(keys.accounts())?.find((account) => String(account.id) === accountId);

  /**
   * The cache learns the sent message with the server's id exactly as the
   * response carried it (a number stays a number), or, without a cache, its
   * exact key is invalidated.
   */
  const storeSent = (entry: PendingEntry, serverId: unknown): void => {
    const key = keys.chatMessages(entry.accountId, entry.chatId);
    const history = cache.getQueryData<History>(key);
    const account = accountOf(entry.accountId);
    if (history === undefined || account === undefined) {
      void cache.invalidateQueries({ key, exact: true });
      return;
    }
    const sent: Message = {
      id: serverId as Message['id'],
      text: entry.payload.text,
      createdAt: entry.createdAt,
      platform: entry.platform,
      platformSenderId: account.platformAccountId,
      isOutgoing: true,
      platformMetadata: sentMessageMetadata(SENT_CANCEL_SECONDS),
    };
    cache.setQueryData<History>(key, (previous) => {
      const base = previous ?? history;
      return hasMessage(base, sent.id) ? base : upsertMessage(base, sent);
    });
  };

  const previousMessageOf = (entry: PendingEntry): { id: number; created_at: string; is_fan_message: boolean } | null => {
    const newest = newestMessage(cache.getQueryData<History>(keys.chatMessages(entry.accountId, entry.chatId)));
    // String(): a numeric server id stored as is must not break the next send.
    const id = newest === null ? '' : String(newest.id);
    if (newest === null || id.trim() === '' || !Number.isSafeInteger(Number(id))) return null;
    return { id: Number(id), created_at: newest.createdAt, is_fan_message: !newest.isOutgoing };
  };

  const send = async (entry: PendingEntry): Promise<void> => {
    setStatus(entry.accountId, entry.id, PendingStatus.SENDING);
    const controller = new AbortController();
    controllers.set(entry.id, controller);
    timers.set(
      entry.id,
      setTimeout(() => controller.abort(), env.queueTimeoutMs),
    );
    try {
      // Created synchronously: the request object (and the fetch it uses) exists before the first await.
      const response = await api
        .post(`api/v0/accounts/${entry.accountId}/chats/${entry.chatId}/messages`, {
          signal: controller.signal,
          json: {
            text: entry.payload.text,
            is_copied: entry.payload.isCopied ?? false,
            is_ai_generated: entry.payload.isAiGenerated ?? false,
            internal_template_id: entry.payload.internalTemplateId ?? null,
            reply_time: null,
            previous_message: previousMessageOf(entry),
            platformMetadata: entry.payload.platformMetadata ?? {},
          },
        })
        .json<{ id?: unknown }>();
      if (find(entry.accountId, entry.id) === null) return;
      storeSent(entry, response.id);
      removeEntry(entry.accountId, entry.id);
    } catch (error) {
      const hit = find(entry.accountId, entry.id);
      if (hit === null) return;
      if (hit.entry.status === PendingStatus.CONFIRMED) {
        removeEntry(entry.accountId, entry.id);
        return;
      }
      if (isAbort(error)) {
        setStatus(entry.accountId, entry.id, PendingStatus.FAILED, { kind: 'timeout', text: 'Sending timed out' });
        return;
      }
      const body = await errorBody(error);
      if (body?.code === 'MESSAGE_GUARD_VIOLATION') {
        setStatus(entry.accountId, entry.id, PendingStatus.FAILED, { kind: 'blocked', guard: await guardOf(error) });
      } else {
        setStatus(entry.accountId, entry.id, PendingStatus.FAILED, {
          kind: 'platform',
          text: 'Failed to send',
          ...(body?.upstreamMessage !== undefined ? { tooltip: body.upstreamMessage } : {}),
        });
      }
    } finally {
      clearTimer(entry.id);
      controllers.delete(entry.id);
    }
  };

  const nextPending = (accountId: string): PendingEntry | undefined => messagesByAccountId.value[accountId]?.find((entry) => entry.status === PendingStatus.PENDING);

  const process = async (accountId: string): Promise<void> => {
    if (processingByAccountId.value[accountId] === true) return;
    processingByAccountId.value[accountId] = true;
    try {
      for (let entry = nextPending(accountId); entry !== undefined; entry = nextPending(accountId)) {
        if (isMimicTakeover(cache, entry.accountId, entry.chatId)) setStatus(entry.accountId, entry.id, PendingStatus.FAILED, { kind: 'platform', text: 'Mimic took over this chat' });
        else await send(entry);
      }
    } finally {
      delete processingByAccountId.value[accountId];
    }
  };

  const enqueue = (input: QueueInput): PendingEntry | null => {
    if (isMimicTakeover(cache, input.accountId, input.chatId) || countForChat(input.accountId, input.chatId) >= QUEUE_LIMIT) {
      record('queue-refused', { accountId: input.accountId, chatId: input.chatId });
      return null;
    }
    const entry: PendingEntry = {
      id: localId(),
      accountId: input.accountId,
      chatId: input.chatId,
      platform: input.platform,
      status: PendingStatus.PENDING,
      error: null,
      createdAt: new Date().toISOString(),
      payload: {
        text: input.text,
        hasAttachments: input.hasAttachments ?? false,
        platformMetadata: input.platformMetadata,
        composerContent: input.composerContent,
        internalTemplateId: input.internalTemplateId,
        isCopied: input.isCopied,
        isAiGenerated: input.isAiGenerated,
      },
    };
    const list = messagesByAccountId.value[input.accountId] ?? [];
    list.push(entry);
    messagesByAccountId.value[input.accountId] = list;
    record('queue-added', { accountId: entry.accountId, chatId: entry.chatId, id: entry.id, busy: processingByAccountId.value[input.accountId] === true });
    void process(input.accountId);
    return entry;
  };

  const cancel = (accountId: string, id: string): void => {
    controllers.get(id)?.abort();
    clearTimer(id);
    controllers.delete(id);
    removeEntry(accountId, id);
  };

  const resend = (accountId: string, id: string): void => {
    const hit = find(accountId, id);
    if (hit?.entry.status !== PendingStatus.FAILED || isMimicTakeover(cache, accountId, hit.entry.chatId)) return;
    setStatus(accountId, id, PendingStatus.PENDING);
    void process(accountId);
  };

  const confirmEchoedMessage = (accountId: string, chatId: string, content: string, alreadyInCache = false): void => {
    const list = messagesByAccountId.value[accountId];
    if (list === undefined) return;
    const matches = (entry: PendingEntry): boolean => entry.chatId === chatId && sameText(entry.payload.text, content);
    if (!alreadyInCache) {
      const sending = list.find((entry) => entry.status === PendingStatus.SENDING && matches(entry));
      if (sending !== undefined) {
        setStatus(accountId, sending.id, PendingStatus.CONFIRMED);
        return;
      }
    }
    const timedOut = list.find((entry) => entry.status === PendingStatus.FAILED && entry.error?.kind === 'timeout' && matches(entry));
    if (timedOut !== undefined) removeEntry(accountId, timedOut.id);
  };

  const resetForAccount = (accountId: string): void => {
    for (const entry of messagesByAccountId.value[accountId] ?? []) {
      controllers.get(entry.id)?.abort();
      clearTimer(entry.id);
      controllers.delete(entry.id);
    }
    delete messagesByAccountId.value[accountId];
    delete processingByAccountId.value[accountId];
  };

  const resetAll = (): void => {
    for (const accountId of Object.keys(messagesByAccountId.value)) resetForAccount(accountId);
  };

  // Plain closures, not the store's actions: these resets do not reach $onAction.
  watch(isSignedIn, (signedIn, was) => {
    if (was && !signedIn) {
      record('queue-reset', { reason: 'signed-out' });
      resetAll();
    }
  });
  const accountIds = computed(() => cache.getQueryData<Account[]>(keys.accounts())?.map((account) => String(account.id)));
  let knownAccounts = new Set<string>();
  watch(
    accountIds,
    (ids) => {
      if (ids === undefined) return;
      const current = new Set(ids);
      for (const id of knownAccounts) {
        if (current.has(id)) continue;
        record('queue-reset', { reason: 'account-removed', accountId: id });
        resetForAccount(id);
      }
      knownAccounts = current;
    },
    { immediate: true },
  );

  return { messagesByAccountId, processingByAccountId, enqueue, cancel, resend, confirmEchoedMessage, resetForAccount, resetAll };
});
