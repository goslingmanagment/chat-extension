// The Telegram announcement of a release (architecture.md §13 п. 2 and п. 7,
// UP-005): the CHANGELOG.md section of the version, posted to the chatters'
// channel. Composing and validating the post is pure and runs in the gate
// (`announce --check`), before anything irreversible; sending is a separate
// outward step the owner starts by hand, and its failure does not undo a
// release.
//
// The sender follows the family rule «an indeterminate send is never
// retried»: any failure after the request left is indeterminate — a transport
// error, a 2xx whose body did not come, and every 5xx (a 502 or 504 of a
// gateway can come after Telegram took the post) — and only an explicit 429
// with a short wait gets one retry. A 4xx is a refusal: nothing was posted.
// The bot token is part of the request address, so no address and no raw
// error text reaches the output. cli.ts remembers each send per version, so a
// second `announce` of one version asks for `--again`.

import { EXTENSION_NAME } from '../../apps/extension/build/manifest.ts';
import { blocksMarkdown, type ChangelogSection } from './changelog.ts';

/** Telegram's limit for one rich message, in characters. */
export const POST_CHAR_LIMIT = 32_768;
export const PRODUCT_NAME = EXTENSION_NAME;

export function composePost(section: ChangelogSection): string {
  const post = `# ${PRODUCT_NAME} ${section.version}\n\n${blocksMarkdown(section.blocks)}`;
  const length = [...post].length;
  if (length > POST_CHAR_LIMIT) throw new Error(`the announcement is ${length} characters, over Telegram's ${POST_CHAR_LIMIT} — shorten the section of ${section.version}`);
  return post;
}

export interface TelegramTarget {
  readonly botToken: string;
  readonly chatId: string;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_AFTER_MAX_SECONDS = 60;

export class AnnounceError extends Error {
  /** true — Telegram may have accepted the post: look at the channel before trying again. */
  readonly indeterminate: boolean;
  constructor(message: string, indeterminate: boolean) {
    super(message);
    this.name = 'AnnounceError';
    this.indeterminate = indeterminate;
  }
}

interface TelegramReply {
  readonly ok?: unknown;
  readonly result?: { readonly message_id?: unknown };
  readonly error_code?: unknown;
  readonly description?: unknown;
  readonly parameters?: { readonly retry_after?: unknown };
}

type Attempt = { readonly kind: 'ok'; readonly messageId: number | null } | { readonly kind: 'rate-limited'; readonly seconds: number } | { readonly kind: 'failed'; readonly message: string };

const redact = (text: string, secret: string): string => text.split(secret).join('<bot token>');

function indeterminate(error: unknown, token: string): AnnounceError {
  const name = error instanceof Error ? error.name : '';
  const detail = name === 'TimeoutError' || name === 'AbortError' ? 'the request timed out' : redact(error instanceof Error ? error.message : String(error), token);
  return new AnnounceError(`transport failure (${detail}): the send is indeterminate — Telegram may have accepted it; look at the channel before trying again`, true);
}

async function attempt(target: TelegramTarget, markdown: string, silent: boolean, fetchImpl: FetchLike): Promise<Attempt> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${target.botToken}/sendRichMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: target.chatId, rich_message: { markdown, skip_entity_detection: true }, disable_notification: silent }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw indeterminate(error, target.botToken);
  }
  let json: TelegramReply | null = null;
  try {
    json = (await response.json()) as TelegramReply | null;
  } catch (error) {
    // The headers came, the body did not: on a 2xx Telegram may well have posted it.
    if (response.ok) throw indeterminate(error, target.botToken);
  }
  if (response.ok && json?.ok === true) {
    const id = json.result?.message_id;
    return { kind: 'ok', messageId: typeof id === 'number' ? id : null };
  }
  const retryAfter = json?.parameters?.retry_after;
  if (json?.error_code === 429 && typeof retryAfter === 'number') return { kind: 'rate-limited', seconds: retryAfter };
  const description = json === null ? `HTTP ${response.status} with an unreadable body` : typeof json.description === 'string' ? json.description : `HTTP ${response.status} without a description`;
  if (response.status >= 500) {
    throw new AnnounceError(`server error (${redact(description, target.botToken)}): the send is indeterminate — a 5xx can come after the post was accepted; look at the channel before trying again`, true);
  }
  const code = typeof json?.error_code === 'number' ? json.error_code : response.status;
  return { kind: 'failed', message: `Telegram error ${code}: ${redact(description, target.botToken)}` };
}

export interface SendOptions {
  readonly silent?: boolean;
  readonly fetchImpl: FetchLike;
  readonly sleep: (ms: number) => Promise<void>;
}

/** Posts the announcement; resolves with the message id (null when Telegram did not name it). */
export async function sendPost(target: TelegramTarget, markdown: string, options: SendOptions): Promise<number | null> {
  let result = await attempt(target, markdown, options.silent ?? false, options.fetchImpl);
  if (result.kind === 'rate-limited') {
    if (result.seconds > RETRY_AFTER_MAX_SECONDS) throw new AnnounceError(`rate-limited: Telegram asks to wait ${result.seconds} s — run the command again later`, false);
    await options.sleep(result.seconds * 1000);
    result = await attempt(target, markdown, options.silent ?? false, options.fetchImpl);
  }
  if (result.kind === 'ok') return result.messageId;
  if (result.kind === 'rate-limited') throw new AnnounceError('still rate-limited after one retry — run the command again later', false);
  throw new AnnounceError(result.message, false);
}
