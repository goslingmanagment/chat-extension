// The Telegram announcement of a release (architecture.md §13 п. 2 and п. 7,
// UP-005): the notes of the version as one rich message (Bot API
// sendRichMessage, Rich HTML) to the chatters' channel — the version and its
// date, then each note: its title, who it is for and why, its screenshots
// (served by the site, next to the pages) and «Как это устроено» folded; at
// the end how the update comes and a button to «Что нового» on the site.
// Composing and validating the post is pure and runs before anything
// irreversible (`announce --check`); sending is a separate outward step the
// owner starts by hand, and its failure does not undo a release.
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
import type { Block, Inline } from './changelog.ts';
import { KIND_EMOJI, KIND_LABEL, NOTE_SITES, NOTES_DIR, SITE_LABEL, TECH_HEADING, type Note } from './changes.ts';
import { groups, NOTHING_NEW, releaseLabel, type Release } from './notes.ts';
import { noteImageHref } from './site.ts';

/** Telegram's limit for one rich message, in characters. */
export const POST_CHAR_LIMIT = 32_768;
export const PRODUCT_NAME = EXTENSION_NAME;
/**
 * The first version announced in the channel: 3.0.0, the one extension for ChatSpace and Fansly that replaces the
 * old Fansly one (owner, 2026-10-22). Below it `announce` posts nothing to the channel.
 */
export const ANNOUNCE_FROM = '3.0.0';

/** Rich HTML takes &lt; &gt; &amp; &quot; by name. */
const esc = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(parts: readonly Inline[]): string {
  return parts
    .map((part) => {
      if (part.kind === 'bold') return `<b>${esc(part.text)}</b>`;
      if (part.kind === 'code') return `<code>${esc(part.text)}</code>`;
      if (part.kind === 'link') return `<a href="${esc(part.href)}">${esc(part.text)}</a>`;
      return esc(part.text);
    })
    .join('');
}

function blocks(list: readonly Block[]): string[] {
  return list.map((block) => {
    if (block.kind === 'heading') return `<h4>${inline(block.inline)}</h4>`;
    if (block.kind === 'paragraph') return `<p>${inline(block.inline)}</p>`;
    return `<ul>${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`;
  });
}

/** Each screenshot full width with its own caption: a collage shrinks screenshots of different shapes past reading. */
function images(note: Note, siteBase: string): string[] {
  return note.images.map((image) => `<figure><img src="${esc(`${siteBase}${noteImageHref(image.file)}`)}"/><figcaption>${esc(image.alt)}</figcaption></figure>`);
}

function noteHtml(note: Note, siteBase: string): string[] {
  const sites = note.sites.length === NOTE_SITES.length ? 'ChatSpace и Fansly' : note.sites.map((site) => SITE_LABEL[site]).join(', ');
  const title = note.kind === 'intro' ? `<h2>${inline(note.title)}</h2>` : `<h3>${inline(note.title)}</h3>`;
  const tech = note.tech.length === 0 ? [] : [`<details><summary>${TECH_HEADING}</summary>${blocks(note.tech).join('')}</details>`];
  return [title, ...(note.kind === 'intro' ? [] : [`<p><i>${esc(sites)}</i></p>`]), ...blocks(note.story), ...images(note, siteBase), ...tech];
}

/**
 * The post of a release as Rich HTML. `siteBase` is the site folder (with its
 * slash): the screenshots and the «Что нового» button point there.
 */
export function composePost(release: Release, siteBase: string): string {
  const label = releaseLabel(release);
  const lines = [`<h1>${esc(`${PRODUCT_NAME} ${release.version}`)}</h1>`, ...(label === '' ? [] : [`<p><i>${esc(label)}</i></p>`])];
  if (release.kind === 'legacy') lines.push(...blocks(release.blocks));
  else if (release.notes.length === 0) lines.push(`<p>${NOTHING_NEW}</p>`);
  else {
    for (const group of groups(release.notes)) {
      if (group.kind !== 'intro') lines.push('<hr/>', `<h2>${KIND_EMOJI[group.kind]} ${KIND_LABEL[group.kind]}</h2>`);
      for (const note of group.notes) lines.push(...noteHtml(note, siteBase));
    }
  }
  lines.push(
    '<hr/>',
    '<footer>Обновление придёт само в течение дня. Чтобы сразу: ☰ → «Дополнения и темы» → ⚙ → «Проверить наличие обновлений». Потом перезагрузите открытые вкладки ChatSpace и Fansly.</footer>',
    `<tg-button-row><tg-button type="url" url="${esc(`${siteBase}whats-new.html`)}">Что нового — на сайте</tg-button></tg-button-row>`,
  );
  const post = lines.join('\n');
  const length = [...post].length;
  if (length > POST_CHAR_LIMIT) throw new Error(`the announcement is ${length} characters, over Telegram's ${POST_CHAR_LIMIT} — shorten the notes of ${release.version}`);
  return post;
}

/**
 * A local page that draws the post about as Telegram does — a channel bubble, the
 * screenshots from the copy next to it (changes/), «Как это устроено» folded, the button —
 * for `pnpm release notes`. Not what Telegram renders, near enough to judge the text and the pictures.
 */
export function telegramPreview(post: string, siteBase: string): string {
  const local = post.split(`${esc(siteBase)}${NOTES_DIR}/`).join(`${NOTES_DIR}/`);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Пост в Telegram — предпросмотр</title>
<style>
  body { margin: 0; padding: 32px 16px; background: #0e1621; font: 15px/1.45 -apple-system, 'Segoe UI', Roboto, sans-serif; color: #f5f5f5; }
  .bubble { max-width: 520px; margin: 0 auto; padding: 10px 14px 12px; border-radius: 12px; background: #182533; }
  h1 { margin: 4px 0 2px; font-size: 22px; } h2 { margin: 14px 0 4px; font-size: 19px; } h3 { margin: 12px 0 2px; font-size: 16px; } h4 { margin: 8px 0 0; font-size: 15px; }
  p, ul { margin: 4px 0; } ul { padding-left: 20px; } i { color: #8ba3b8; } a { color: #6ab3f3; }
  hr { border: 0; border-top: 1px solid #2b3a4a; margin: 12px 0; }
  figure { margin: 8px -14px; } figure img { display: block; width: 100%; }
  figcaption { padding: 4px 14px 0; color: #8ba3b8; font-size: 13px; }
  details { margin: 6px 0; padding: 6px 10px; border-left: 3px solid #6ab3f3; border-radius: 4px; background: #1e2c3a; }
  summary { cursor: pointer; color: #6ab3f3; font-weight: 600; }
  footer { color: #8ba3b8; font-size: 13px; }
  code { font: 13px ui-monospace, Menlo, monospace; }
  tg-button-row { display: flex; margin: 10px auto 0; max-width: 520px; }
  tg-button { flex: 1; padding: 9px; border-radius: 8px; background: #2b5278; text-align: center; font-weight: 600; }
</style>
</head>
<body>
<div class="bubble">
${local.replace(/<tg-button-row>[\s\S]*<\/tg-button-row>/, '')}
</div>
${/<tg-button-row>[\s\S]*<\/tg-button-row>/.exec(local)?.[0] ?? ''}
</body>
</html>
`;
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

async function attempt(target: TelegramTarget, html: string, silent: boolean, fetchImpl: FetchLike): Promise<Attempt> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${target.botToken}/sendRichMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: target.chatId, rich_message: { html, skip_entity_detection: true }, disable_notification: silent }),
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
export async function sendPost(target: TelegramTarget, html: string, options: SendOptions): Promise<number | null> {
  let result = await attempt(target, html, options.silent ?? false, options.fetchImpl);
  if (result.kind === 'rate-limited') {
    if (result.seconds > RETRY_AFTER_MAX_SECONDS) throw new AnnounceError(`rate-limited: Telegram asks to wait ${result.seconds} s — run the command again later`, false);
    await options.sleep(result.seconds * 1000);
    result = await attempt(target, html, options.silent ?? false, options.fetchImpl);
  }
  if (result.kind === 'ok') return result.messageId;
  if (result.kind === 'rate-limited') throw new AnnounceError('still rate-limited after one retry — run the command again later', false);
  throw new AnnounceError(result.message, false);
}
