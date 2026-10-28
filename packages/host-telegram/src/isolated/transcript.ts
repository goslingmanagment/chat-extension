// The open chat as a transcript for the hub (docs/specs/2026-10-27-telegram-site.md §4.3): what Web A rendered in the
// active slide's list, never more — the extension never scrolls a chat. Web A keeps at most 80 or 120 messages in the
// DOM and opens a chat around the last read one, so the newest may be missing: without `.list-bottom-marker` the
// transcript ends with `--- newer messages are not loaded ---` (and the dock warns).
//
// - Lines: `[HH:MM] Fan:` / `Model:` (`.Message.own` is the account's), the day lines as the page shows them
//   (`--- Today ---`, `--- Saturday ---`, `--- October 18 ---`), the minutes as the page shows them made 24-hour. No
//   full date: the time's `title` appears only on mouseenter, and the page is never touched to get it.
// - Text from the message's `.text-content` with emoji from `<img alt>`; the time, «edited» and reactions (the meta)
//   left out. A message being sent (a fractional `data-message-id`) is left out; `.ActionMessage` lines are skipped.
// - Labels: `[Photo]`, `[Video]`, `[Album]`, `[Voice message]`, `[Sticker 😘]` / `[Sticker]`, `[Call]`; a reply quote
//   from `.EmbeddedMessage` becomes `(replying to: «…»)`. A translated chat is marked «(translated by Telegram)».
// - A continuation line that would read as a message or a day line is indented: the hub counts messages by their
//   start lines (its window cut).
// The texts live in memory only, for the request that carries them.

import type { FanScript } from '@cg/contracts/host';

import { TELEGRAM_SELECTORS } from './dom';

/** The tail line when the newest messages are not rendered. */
export const NOT_NEWEST_LINE = '--- newer messages are not loaded ---';
/** The header line of a chat Telegram translates. */
export const TRANSLATED_LINE = '(translated by Telegram)';
/** What the hub reads for a chat with no message (its own words, `transcript/format.ts`). */
export const NO_HISTORY = 'No conversation history.';
/** A reply quote's length, as Web A cuts its embedded text. */
const QUOTE_MAX = 200;

const MESSAGE_START = /^\[\d{1,2}:\d{2}\] (?:Fan|Model):/;
const DAY_LINE = /^--- .+ ---$/;
const CYRILLIC = /[Ѐ-ӿ]/;
/** The last time the meta shows: «14:02», «edited 14:02», «2:05 PM». */
const TIME = /(\d{1,2}):(\d{2})(?:\s*([AaPp])\.?\s*[Mm]\.?)?/g;

/** Inside a message, what is not its text: the meta (time, «edited», views), reactions, the reply quote. */
const NOT_TEXT = '.MessageMeta, .Reactions, .reactions, .EmbeddedMessage';

export interface TranscriptRead {
  readonly transcript: string;
  /** Message lines in `transcript`. */
  readonly messageCount: number;
  /** `.list-bottom-marker` was rendered: the newest messages are in. */
  readonly newest: boolean;
  /** The fan's lines among the texts: Cyrillic in any — `cyrillic`; fan lines without — `other`; none — `unknown`. */
  readonly fanScript: FanScript;
  readonly fanMessages: number;
  readonly modelMessages: number;
  /** The newest fan message's id (Web A's `data-message-id`); null — none rendered. */
  readonly lastFanMessageId: string | null;
}

interface Entry {
  readonly day: string | null;
  readonly own: boolean;
  readonly id: string;
  time: string | null;
  readonly body: string;
}

/** The meta's time made 24-hour; null — none shown. */
export function timeOf(text: string): string | null {
  let last: RegExpExecArray | null = null;
  for (const match of text.matchAll(TIME)) last = match;
  if (last === null) return null;
  let hours = Number(last[1]);
  const minutes = Number(last[2]);
  if (hours > 23 || minutes > 59) return null;
  const meridiem = last[3]?.toLowerCase();
  if (meridiem === 'p' && hours < 12) hours += 12;
  if (meridiem === 'a' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** An element's text as a person reads it: text nodes, an image's `alt` (emoji), a break; `skip` subtrees left out. */
function textOf(node: Node, skip: string): string {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) out += (child as Text).data;
    else if (child.nodeType === 1) {
      const element = child as Element;
      if (element.matches(skip)) continue;
      if (element.tagName === 'IMG') out += element.getAttribute('alt') ?? '';
      else if (element.tagName === 'BR') out += '\n';
      else out += textOf(element, skip);
    }
  }
  return out;
}

const clean = (text: string): string =>
  text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** What a message carries besides its text: one label, or null. */
function labelOf(message: Element): string | null {
  if (message.classList.contains('is-album')) return '[Album]';
  const content = message.querySelector('.message-content');
  if (content === null) return null;
  const kinds = content.classList;
  if (kinds.contains('voice')) return '[Voice message]';
  if (kinds.contains('round')) return '[Video]';
  if (kinds.contains('custom-shape')) {
    const emoji = content.querySelector('.media-inner img[alt]')?.getAttribute('alt')?.trim() ?? '';
    return emoji === '' ? '[Sticker]' : `[Sticker ${emoji}]`;
  }
  // An animated emoji alone: its own `.media-inner`, and no `media` class on the content.
  if (kinds.contains('emoji-only')) return content.querySelector('.AnimatedEmoji') !== null ? '[Animated emoji]' : null;
  if (kinds.contains('audio')) return '[Audio]';
  if (kinds.contains('document')) return '[File]';
  if (kinds.contains('contact')) return '[Contact]';
  if (kinds.contains('poll')) return '[Poll]';
  if (kinds.contains('video')) return '[Video]';
  // A photo or a video: the content is `media`, the video's frame is the dark one.
  if (kinds.contains('media')) return content.querySelector('.media-inner.dark') !== null ? '[Video]' : '[Photo]';
  return null;
}

/** A message's body: the reply quote, the label, the text; a call — a message with no meta and nothing else. */
function bodyOf(message: Element): string {
  const parts: string[] = [];
  const quote = message.querySelector('.EmbeddedMessage .embedded-text-wrapper');
  const quoted = quote === null ? '' : clean(quote.textContent ?? '').replace(/\s+/g, ' ').slice(0, QUOTE_MAX);
  if (quoted !== '') parts.push(`(replying to: «${quoted}»)`);
  const label = labelOf(message);
  if (label !== null) parts.push(label);
  const content = [...message.querySelectorAll('.text-content')].find((node) => node.closest('.EmbeddedMessage') === null) ?? null;
  const text = content === null ? '' : clean(textOf(content, NOT_TEXT));
  if (text !== '') parts.push(text);
  if (parts.length === 0) parts.push(message.querySelector('.MessageMeta') === null ? '[Call]' : '[Message]');
  return parts.join(' ');
}

/** A continuation line that would read as a message's start or a day line is indented. */
function safeLines(body: string): string {
  return body
    .split('\n')
    .map((line, index) => (index > 0 && (MESSAGE_START.test(line) || DAY_LINE.test(line)) ? `  ${line}` : line))
    .join('\n');
}

/**
 * The transcript of the list slide (`TELEGRAM_SELECTORS.listSlide`), at most `maxChars` characters: the oldest
 * messages go first when it is longer, each kept message under its own day line.
 */
export function readTranscript(listSlide: Element, maxChars: number): TranscriptRead {
  const nodes = listSlide.querySelectorAll(`.sticky-date, ${TELEGRAM_SELECTORS.message}`);
  const entries: Entry[] = [];
  let day: string | null = null;
  let translated = false;
  for (const node of nodes) {
    if (node.classList.contains('sticky-date')) {
      const label = clean(node.textContent ?? '').replace(/\s+/g, ' ');
      if (label !== '') day = label;
      continue;
    }
    const id = node.getAttribute('data-message-id') ?? '';
    // A message being sent has a fractional id; an id that is not a number is nobody's.
    if (!/^[1-9]\d{0,29}$/.test(id)) continue;
    if (node.querySelector('.MessageMeta .message-translated') !== null) translated = true;
    const meta = node.querySelector('.MessageMeta .message-time');
    entries.push({ day, own: node.classList.contains('own'), id, time: meta === null ? null : timeOf(meta.textContent ?? ''), body: bodyOf(node) });
  }
  // A message whose meta shows no time takes its neighbour's: the hub reads a time on every message line.
  let carry: string | null = null;
  for (const entry of entries) carry = entry.time ??= carry;
  carry = null;
  for (const entry of [...entries].reverse()) carry = entry.time ??= carry;

  const newest = listSlide.querySelector(TELEGRAM_SELECTORS.bottomMarker) !== null;
  const fan = entries.filter((entry) => !entry.own);
  const fanScript: FanScript = fan.length === 0 ? 'unknown' : fan.some((entry) => CYRILLIC.test(entry.body)) ? 'cyrillic' : 'other';
  const lastFan = fan.at(-1)?.id ?? null;

  const header = translated ? [TRANSLATED_LINE] : [];
  const tail = newest ? [] : [NOT_NEWEST_LINE];
  const lineOf = (entry: Entry): string => `[${entry.time ?? '00:00'}] ${entry.own ? 'Model' : 'Fan'}: ${safeLines(entry.body)}`;
  const render = (from: number): string => {
    const lines: string[] = [...header];
    let shownDay: string | null = null;
    for (const entry of entries.slice(from)) {
      if (entry.day !== null && entry.day !== shownDay) {
        lines.push(`--- ${entry.day} ---`);
        shownDay = entry.day;
      }
      lines.push(lineOf(entry));
    }
    return [...lines, ...tail].join('\n');
  };
  let from = 0;
  let transcript = entries.length === 0 ? [...header, NO_HISTORY, ...tail].join('\n') : render(0);
  // Too long for the hub: the oldest messages go, one at a time (rare — a few long messages; at most ~120 rendered).
  while (transcript.length > maxChars && from < entries.length - 1) {
    from += Math.max(1, Math.floor((entries.length - from) / 10));
    transcript = render(Math.min(from, entries.length - 1));
  }
  if (transcript.length > maxChars) transcript = transcript.slice(transcript.length - maxChars);
  const kept = entries.length === 0 ? 0 : entries.length - Math.min(from, entries.length - 1);
  return {
    transcript,
    messageCount: kept,
    newest,
    fanScript,
    fanMessages: fan.length,
    modelMessages: entries.length - fan.length,
    lastFanMessageId: lastFan,
  };
}
