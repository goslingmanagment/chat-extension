// The Telegram post of a release (architecture.md §13 п. 2 and п. 7, UP-005):
// the notes of the version as one rich message (Bot API sendRichMessage, Rich
// HTML) to the chatters' channel. The version and its date; the intro, when
// the version has one; for a post of four notes or more a line of contents
// that links to each; then ✨ Новое / 🛠 Улучшено / 🐛 Исправлено, each note
// with its title, its sites, who it is for and why, every screenshot full
// width with its caption and «Как это устроено» folded; at the end how the
// update comes and two buttons — «Что нового» on the site and «Установить».
//
// The screenshots go up with the request itself (multipart/form-data: the
// HTML shows `tg://photo?id=<id>`, the part named `<id>` is the file), so a
// post never depends on the pages being published, and a preview can go out
// before a release. A post of improvements and fixes alone goes without a
// notification; something new or the intro notifies.
//
// Composing the post and checking it against Telegram's limits for one
// message and its photos is pure and runs before anything irreversible
// (`pnpm release` checks it with the others; `announce --check`). Sending is
// the last step of `pnpm release` from 3.0.0 on, or `announce` by hand; a
// failed send never undoes a release.
//
// The sender follows the family rule «an indeterminate send is never
// retried»: any failure after the request left is indeterminate — a transport
// error, a 2xx whose body did not come, and every 5xx (a 502 or 504 of a
// gateway can come after Telegram took the post) — and only an explicit 429
// with a short wait gets one retry. A 4xx is a refusal: nothing was posted.
// The bot token is part of the request address, so no address and no raw
// error text reaches the output. cli.ts remembers each send per version, so a
// second post of one version asks for `--again`.

import { EXTENSION_NAME } from '../../apps/extension/build/manifest.ts';
import type { Block, Inline } from './changelog.ts';
import { KIND_EMOJI, KIND_LABEL, sitesLabel, TECH_HEADING, type Note, type NoteImage } from './changes.ts';
import { PUBLIC_SITE } from './config.ts';
import { groups, NOTHING_NEW, releaseLabel, type Release } from './notes.ts';
import { noteImageHref } from './site.ts';

export const PRODUCT_NAME = EXTENSION_NAME;
/**
 * The first version announced in the channel: 3.0.0, the one extension for OnlyFans and Fansly that replaces the
 * old Fansly one (owner, 2026-10-22). Below it nothing is posted to the channel.
 */
export const ANNOUNCE_FROM = '3.0.0';
/** From this many notes (the intro aside) the post opens with a line of contents. */
export const CONTENTS_FROM = 4;

/**
 * Telegram's limits for one rich message and its photos (Bot API: «Rich Message Limits», «sendPhoto», «Sending
 * files»). `uploadBytes` is ours: the API names no limit for a whole request, 50 MB is its largest upload.
 */
export const TELEGRAM_LIMITS = {
  characters: 32_768,
  blocks: 500,
  media: 50,
  photoBytes: 10 * 1024 * 1024,
  /** Width and height together. */
  photoSides: 10_000,
  photoRatio: 20,
  uploadBytes: 50 * 1024 * 1024,
} as const;

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

/** One screenshot of the post: uploaded with the request as the part `id`, shown where the HTML says `tg://photo?id=<id>`. */
export interface PostPhoto {
  readonly id: string;
  /** The screenshot in changes/. */
  readonly file: string;
}

export interface Post {
  readonly version: string;
  readonly html: string;
  /** The screenshots in the order the post shows them. */
  readonly photos: readonly PostPhoto[];
  /** The notes it carries, the intro included. */
  readonly notes: number;
  /** true — without a notification: the post has improvements and fixes only. */
  readonly silent: boolean;
}

/** A screenshot as it goes up: its bytes, null — the file is not there. */
export interface Upload extends PostPhoto {
  readonly data: Buffer | null;
}

/**
 * The post of a release. `site` is the public site (with its slash): the buttons point there.
 */
export function composePost(release: Release, site: string = PUBLIC_SITE): Post {
  const photos: PostPhoto[] = [];
  // Each screenshot full width with its own caption: a collage shrinks screenshots of different shapes past reading.
  const figure = (image: NoteImage): string => {
    const id = `shot-${photos.length + 1}`;
    photos.push({ id, file: image.file });
    return `<figure><img src="tg://photo?id=${id}"/><figcaption>${esc(image.alt)}</figcaption></figure>`;
  };
  const noteHtml = (note: Note, anchor: boolean): string[] => {
    const tech = note.tech.length === 0 ? [] : [`<details><summary>${TECH_HEADING}</summary>${blocks(note.tech).join('')}</details>`];
    const head = note.kind === 'intro' ? [`<h2>${inline(note.title)}</h2>`] : [...(anchor ? [`<a name="${note.slug}"></a>`] : []), `<h3>${inline(note.title)}</h3>`, `<p><i>${esc(sitesLabel(note.sites))}</i></p>`];
    return [...head, ...blocks(note.story), ...note.images.map(figure), ...tech];
  };

  const label = releaseLabel(release);
  const lines = [`<h1>${esc(`${PRODUCT_NAME} ${release.version}`)}</h1>`, ...(label === '' ? [] : [`<p><i>${esc(label)}</i></p>`])];
  const notes = release.kind === 'notes' ? release.notes : [];
  if (release.kind === 'legacy') lines.push(...blocks(release.blocks));
  else if (notes.length === 0) lines.push(`<p>${NOTHING_NEW}</p>`);
  else {
    const parts = groups(notes);
    for (const intro of parts.filter((group) => group.kind === 'intro')) lines.push(...intro.notes.flatMap((note) => noteHtml(note, false)));
    const listed = parts.filter((group) => group.kind !== 'intro');
    const contents = listed.flatMap((group) => group.notes);
    if (contents.length >= CONTENTS_FROM) lines.push(`<p><b>В этом выпуске:</b> ${contents.map((note) => `<a href="#${note.slug}">${esc(note.title.map((part) => part.text).join(''))}</a>`).join(' · ')}</p>`);
    for (const group of listed) {
      lines.push('<hr/>', `<h2>${KIND_EMOJI[group.kind]} ${KIND_LABEL[group.kind]}</h2>`);
      for (const note of group.notes) lines.push(...noteHtml(note, contents.length >= CONTENTS_FROM));
    }
  }
  lines.push(
    '<hr/>',
    '<footer>Firefox поставит обновление сам в течение дня. Чтобы сразу: ☰ → «Дополнения и темы» → ⚙ → «Проверить наличие обновлений». Потом перезагрузите открытые вкладки OnlyFans (ChatSpace) и Fansly.</footer>',
    `<tg-button-row><tg-button type="url" url="${esc(`${site}whats-new.html#v${release.version}`)}">Что нового на сайте</tg-button><tg-button type="url" url="${esc(site)}">Установить</tg-button></tg-button-row>`,
  );
  return { version: release.version, html: lines.join('\n'), photos, notes: notes.length, silent: !notes.some((note) => note.kind === 'new' || note.kind === 'intro') };
}

// ── Telegram's limits ──

/** The text of the post as Telegram counts it: what is shown, without the tags. */
export const postCharacters = (html: string): number => [...html.replace(/<[^>]*>/g, '').replace(/&(?:lt|gt|amp|quot);/g, '_')].length;

/** Its blocks, counted generously: every block element, list item, caption, summary, button and anchor. */
export const postBlocks = (html: string): number =>
  [...html.matchAll(/<(?:h[1-6]|p|ul|ol|li|figure|figcaption|details|summary|hr|footer|blockquote|pre|table|tr|aside|tg-button-row|tg-button)\b|<a name="/g)].length;

/** The pixel size and type of a PNG or a JPEG; null — neither. */
export function imageSize(data: Buffer): { readonly width: number; readonly height: number; readonly type: 'image/png' | 'image/jpeg' } | null {
  if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47 && data.toString('latin1', 12, 16) === 'IHDR') {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), type: 'image/png' };
  }
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  // The segments of a JPEG up to its frame header (SOF0…SOF15 but DHT, JPG and DAC): height, then width.
  let at = 2;
  while (at + 9 < data.length) {
    if (data[at] !== 0xff) return null;
    const marker = data[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: data.readUInt16BE(at + 7), height: data.readUInt16BE(at + 5), type: 'image/jpeg' };
    at += 2 + data.readUInt16BE(at + 2);
  }
  return null;
}

/** Why the post cannot go out as one rich message with these screenshots; [] — it can. */
export function postProblems(post: Post, uploads: readonly Upload[]): string[] {
  const limits = TELEGRAM_LIMITS;
  const problems: string[] = [];
  const characters = postCharacters(post.html);
  if (characters > limits.characters) problems.push(`the post is ${characters} characters, Telegram takes ${limits.characters} — shorten the notes of ${post.version}`);
  const count = postBlocks(post.html);
  if (count > limits.blocks) problems.push(`the post has ${count} blocks, Telegram takes ${limits.blocks}`);
  if (uploads.length > limits.media) problems.push(`the post has ${uploads.length} screenshots, Telegram takes ${limits.media}`);
  let total = 0;
  for (const upload of uploads) {
    const where = `changes/${upload.file}`;
    if (upload.data === null) {
      problems.push(`${where} is missing`);
      continue;
    }
    total += upload.data.length;
    const size = imageSize(upload.data);
    if (upload.data.length > limits.photoBytes) problems.push(`${where} is ${Math.round(upload.data.length / 1024)} KB, a photo is at most ${limits.photoBytes / 1024 / 1024} MB`);
    if (size === null) problems.push(`${where} is neither a PNG nor a JPEG`);
    else if (size.width + size.height > limits.photoSides) problems.push(`${where} is ${size.width}×${size.height}: a photo's width and height together are at most ${limits.photoSides}`);
    else if (Math.max(size.width, size.height) > limits.photoRatio * Math.max(1, Math.min(size.width, size.height))) problems.push(`${where} is ${size.width}×${size.height}: a photo is at most ${limits.photoRatio} times longer than wide`);
  }
  if (total > limits.uploadBytes) problems.push(`the screenshots are ${Math.round(total / 1024 / 1024)} MB together, one request carries ${limits.uploadBytes / 1024 / 1024} MB`);
  return problems;
}

/** One line for a plan: what goes, how big, and whether it rings. */
export function describePost(post: Post, uploads: readonly Upload[]): string {
  const bytes = uploads.reduce((sum, upload) => sum + (upload.data?.length ?? 0), 0);
  const shots = post.photos.length === 0 ? 'no screenshot' : `${post.photos.length} screenshot(s) uploaded with it (${(bytes / 1024 / 1024).toFixed(1)} MB)`;
  const rings = post.silent ? `silent — ${post.notes === 0 ? 'no note' : 'improvements and fixes only'}` : 'with a notification — something new';
  return `${post.notes} note(s), ${shots}, ${postCharacters(post.html)} characters, ${postBlocks(post.html)} blocks; ${rings}`;
}

/**
 * A local page that draws the post about as Telegram does — a channel bubble, the
 * screenshots from the copy next to it (changes/), «Как это устроено» folded, the buttons —
 * for `pnpm release notes`. Not what Telegram renders, near enough to judge the text and the pictures.
 */
export function telegramPreview(post: Post): string {
  const files = new Map(post.photos.map((photo) => [photo.id, photo.file]));
  const local = post.html.replace(/tg:\/\/photo\?id=([A-Za-z0-9_-]+)/g, (whole: string, id: string) => {
    const file = files.get(id);
    return file === undefined ? whole : noteImageHref(file);
  });
  const row = /<tg-button-row>[\s\S]*<\/tg-button-row>/;
  const buttons = (row.exec(local)?.[0] ?? '').replace(/<tg-button type="url" url="([^"]*)">([\s\S]*?)<\/tg-button>/g, '<a class="button" href="$1">$2</a>');
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
  tg-button-row { display: flex; gap: 6px; margin: 10px auto 0; max-width: 520px; }
  .button { flex: 1; padding: 9px; border-radius: 8px; background: #2b5278; color: #f5f5f5; text-align: center; font-weight: 600; text-decoration: none; }
  .meta { max-width: 520px; margin: 10px auto 0; color: #8ba3b8; font-size: 13px; text-align: center; }
</style>
</head>
<body>
<div class="bubble">
${local.replace(row, '')}
</div>
${buttons}
<p class="meta">${post.silent ? 'Уйдёт без уведомления: только улучшения и исправления.' : 'Уйдёт с уведомлением: есть новое.'} ${post.photos.length} скриншот(ов) — с самим постом.</p>
</body>
</html>
`;
}

// ── sending ──

export interface TelegramTarget {
  readonly botToken: string;
  readonly chatId: string;
}

export type FetchLike = (url: string, init: { method: string; body: FormData; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The screenshots go up with the request: over a slow route that takes longer than a text alone. */
const REQUEST_TIMEOUT_MS = 120_000;
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

/** The body of one request: the message, the media it names and the files themselves. */
function requestBody(target: TelegramTarget, post: Post, uploads: readonly Upload[], silent: boolean): FormData {
  const form = new FormData();
  form.set('chat_id', target.chatId);
  const media = post.photos.map((photo) => ({ id: photo.id, media: { type: 'photo', media: `attach://${photo.id}` } }));
  form.set('rich_message', JSON.stringify({ html: post.html, ...(media.length === 0 ? {} : { media }), skip_entity_detection: true }));
  form.set('disable_notification', String(silent));
  for (const upload of uploads) {
    const data = upload.data ?? Buffer.alloc(0);
    form.set(upload.id, new Blob([new Uint8Array(data)], { type: imageSize(data)?.type ?? 'application/octet-stream' }), upload.file);
  }
  return form;
}

async function attempt(target: TelegramTarget, body: () => FormData, fetchImpl: FetchLike): Promise<Attempt> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${target.botToken}/sendRichMessage`, { method: 'POST', body: body(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
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
  /** Without a notification: the post's own rule (`post.silent`), or always for a preview. */
  readonly silent: boolean;
  readonly fetchImpl: FetchLike;
  readonly sleep: (ms: number) => Promise<void>;
}

/**
 * Posts the post with its screenshots (`uploads`: one per photo of the post, in its order); resolves with the
 * message id (null when Telegram did not name it). A post over Telegram's limits is refused before any request.
 */
export async function sendPost(target: TelegramTarget, post: Post, uploads: readonly Upload[], options: SendOptions): Promise<number | null> {
  if (uploads.length !== post.photos.length || uploads.some((upload, index) => upload.id !== post.photos[index]?.id || upload.file !== post.photos[index]?.file)) {
    throw new AnnounceError('the screenshots to upload are not the ones the post shows: nothing was sent', false);
  }
  const problems = postProblems(post, uploads);
  if (problems.length > 0) throw new AnnounceError(`the post of ${post.version} cannot go out, nothing was sent: ${problems.join('; ')}`, false);
  const body = (): FormData => requestBody(target, post, uploads, options.silent);
  let result = await attempt(target, body, options.fetchImpl);
  if (result.kind === 'rate-limited') {
    if (result.seconds > RETRY_AFTER_MAX_SECONDS) throw new AnnounceError(`rate-limited: Telegram asks to wait ${result.seconds} s — run the command again later`, false);
    await options.sleep(result.seconds * 1000);
    result = await attempt(target, body, options.fetchImpl);
  }
  if (result.kind === 'ok') return result.messageId;
  if (result.kind === 'rate-limited') throw new AnnounceError('still rate-limited after one retry — run the command again later', false);
  throw new AnnounceError(result.message, false);
}
