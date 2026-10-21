// What a person's action was, as the chatter's log keeps it (2026-10-21, «Скачать лог»): the action's type and its
// machine values — the surface, the feature, the chat by its ids, a filter, a choice. A text the person typed (a
// search, a draft, a label, a Coach question, a sign-in) is its length; the login and the password are not even
// that. Handles are the controllers' own names and carry ids only: they are read back into `fanId`, `accountId`,
// `pageId`, `opId` so the file says which chat a click was about without the UI ever naming a fan.

import { HOST_KINDS } from '@cg/contracts/hosts';
import { type ActionReceipt, type UiAction } from '@cg/contracts/vm';

const isHost = (value: string | undefined): boolean => value !== undefined && (HOST_KINDS as readonly string[]).includes(value);

/** A handle as ids: the fan, the account, the hub page, the operation; an unknown spelling is kept as it is. */
export function handleFacts(handle: string): Record<string, string | number> {
  const parts = handle.split(':');
  const target = /^(dock|spenders|newcomers|palette):([a-z-]+):([^:]+):([^:]+)$/.exec(handle);
  if (target !== null && isHost(target[2])) return { source: target[1] as string, accountId: target[3] as string, fanId: target[4] as string };
  const board = /^(spenders|newcomers|palette):(\d{1,16}):(\d{1,30})$/.exec(handle);
  if (board !== null) return { source: board[1] as string, pageId: Number(board[2]), fanId: board[3] as string };
  // A chat key (host, account, fan): the subject of the dock's first look at a chat.
  if (parts.length === 3 && isHost(parts[0])) return { accountId: parts[1] as string, fanId: parts[2] as string };
  const pass = /^pass:([^:]+):(\d{1,30})$/.exec(handle);
  if (pass !== null) return { source: 'pass', fanId: pass[2] as string };
  const chat = /^nav\.chat\.([^.]+)\.([^.]+)(?:\.([^.]+))?$/.exec(handle);
  if (chat !== null) return { accountId: chat[1] as string, fanId: chat[2] as string, ...(chat[3] === undefined ? {} : { conversationId: chat[3] }) };
  const account = /^nav\.acc\.(.+)$/.exec(handle) ?? /^account-id:[a-z-]+:(\d{1,30})$/.exec(handle);
  if (account !== null) return { accountId: account[1] as string };
  const part = /^part:([0-9a-fA-F-]{36}):(\d|-):(\d)$/.exec(handle);
  if (part !== null) return { opId: part[1] as string, ...(part[2] === '-' ? {} : { variant: Number(part[2]) }), part: Number(part[3]) };
  const review = /^review:([0-9a-fA-F-]{36})$/.exec(handle);
  if (review !== null) return { opId: review[1] as string };
  const page = /^page-(\d{1,16})$/.exec(handle);
  if (page !== null) return { pageId: Number(page[1]) };
  return { targetRef: handle };
}

/** Fields whose value is the person's own text: only its length goes. */
const TEXT_FIELDS: ReadonlySet<string> = new Set(['text', 'query', 'label', 'question']);
/** Never even the length. */
const SECRET_FIELDS: ReadonlySet<string> = new Set(['login', 'password']);
/** A machine value under a name the log keeps (redact.ts allowlist). */
const RENAMED: Readonly<Record<string, string>> = { operationId: 'opId', length: 'choice', what: 'which', key: 'prefKey', value: 'choice', folder: 'folderId', page: 'choice' };
/** Debug handles name a prompt snapshot: not an id of a chat, and of no use in the file. */
const SKIPPED_FIELDS: ReadonlySet<string> = new Set(['type', 'promptHandle']);

function put(out: Record<string, unknown>, key: string, value: unknown): void {
  if (SKIPPED_FIELDS.has(key) || SECRET_FIELDS.has(key)) return;
  if (TEXT_FIELDS.has(key)) {
    out[`${key}Chars`] = typeof value === 'string' ? value.length : null;
    return;
  }
  if (typeof value === 'string') {
    if (key.endsWith('Handle')) Object.assign(out, handleFacts(value));
    else out[RENAMED[key] ?? key] = value;
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    out[RENAMED[key] ?? key] = value;
    return;
  }
  if (Array.isArray(value)) {
    out[`${key.replace(/s$/, '')}Count`] = value.length;
    return;
  }
  if (typeof value !== 'object') return;
  const inner = value as Record<string, unknown>;
  if (key === 'selector') {
    out['view'] = inner['of'];
    return;
  }
  // `to` of Navigate names its kind (`toKind`: a bare `to` could hold a name, the log keeps no such field); `options` of
  // Generate and `route` of OpenSettings are their fields.
  if (key === 'to') out['toKind'] = inner['kind'];
  for (const [name, item] of Object.entries(inner)) if (!(key === 'to' && name === 'kind')) put(out, name, item);
}

/** The machine values of an action (see the head of the file). */
export function actionFacts(action: UiAction): Record<string, unknown> {
  const out: Record<string, unknown> = { action: action.type };
  // Sign-in: that it was asked is the whole record.
  if (action.type === 'SignIn') return out;
  for (const [key, value] of Object.entries(action)) put(out, key, value);
  return out;
}

/** What an action came to: its outcome, or its refusal's code with the sentence the person was shown. */
export function receiptFacts(receipt: ActionReceipt): Record<string, unknown> {
  if (receipt.ok) {
    return {
      ok: true,
      outcome: receipt.outcome,
      ...(receipt.opId === undefined ? {} : { resultOpId: receipt.opId }),
      ...(receipt.attemptId === undefined ? {} : { attemptId: receipt.attemptId }),
    };
  }
  return { ok: false, code: receipt.code, say: receipt.error.title, ...(receipt.running === undefined ? {} : { runningCount: receipt.running.length }) };
}

/**
 * Actions too frequent to say one by one and that decide nothing: a hover that holds a toast, the search field's
 * every key (the controller debounces it; the filter it ends with is what the list shows).
 */
export function isQuietAction(action: UiAction): boolean {
  return action.type === 'HoldToast';
}
