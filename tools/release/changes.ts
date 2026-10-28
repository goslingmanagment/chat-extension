// The notes of a change (changes/README.md): one file per change a chatter
// notices, written in the PR that makes it. A release gathers the notes added
// since the previous tag; «Что нового», the version history, the Telegram post
// and the version number (minor when something is new) are all made from them.
// Commit subjects never reach a chatter.
//
//   ---
//   kind: new                  new | improved | fixed | intro
//   sites: chatspace, fansly   the sites it changes
//   release: 3.0.0             optional: held for that version (the launch), left out of
//                              the releases before it
//   order: 1                   optional: lower goes first within its kind (default 50)
//   ---
//
//   # What changed, in the chatter's words
//
//   Who it is for and why; how to use it. Paragraphs or a «-» list.
//
//   ![What the screenshot shows](spenders-all-payers.png)
//
//   ## Как это устроено
//
//   The technical side: what changed inside, the limits.
//
// The Markdown is the changelog's small subset (changelog.ts) plus image lines
// of the first part; anything else is refused with the file and the line. No
// I/O here: the caller hands in the text and the sizes of the images.

import { ChangelogError, parseBlocks, parseInline, type Block, type Inline } from './changelog.ts';
import { isVersion, reservedVersionProblem } from './version.ts';

export const NOTES_DIR = 'changes';
/** The heading of the technical part. */
export const TECH_HEADING = 'Как это устроено';

export const NOTE_KINDS = ['intro', 'new', 'improved', 'fixed'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_SITES = ['chatspace', 'fansly', 'telegram'] as const;
export type NoteSite = (typeof NOTE_SITES)[number];

export const KIND_LABEL: Readonly<Record<NoteKind, string>> = { intro: 'Главное', new: 'Новое', improved: 'Улучшено', fixed: 'Исправлено' };
export const KIND_EMOJI: Readonly<Record<NoteKind, string>> = { intro: '🪿', new: '✨', improved: '🛠', fixed: '🐛' };
/**
 * The sites as chatters name them. They work OnlyFans through ChatSpace, so for them the site is OnlyFans (owner,
 * 2026-10-25); the field value stays `chatspace` — the released notes carry it.
 */
export const SITE_LABEL: Readonly<Record<NoteSite, string>> = { chatspace: 'OnlyFans', fansly: 'Fansly', telegram: 'Telegram' };

/** The sites of a note in one line: «OnlyFans и Fansly», «Fansly», «OnlyFans». */
export const sitesLabel = (sites: readonly NoteSite[]): string => NOTE_SITES.filter((site) => sites.includes(site)).map((site) => SITE_LABEL[site]).join(' и ');

export const LIMITS = {
  slug: 60,
  title: 90,
  story: 900,
  tech: 1500,
  images: 4,
  imageBytes: 800 * 1024,
} as const;

export interface NoteImage {
  /** The file next to the note, as the note names it. */
  readonly file: string;
  /** What the screenshot shows: the caption on the site and in the post. */
  readonly alt: string;
}

export interface Note {
  readonly slug: string;
  readonly kind: NoteKind;
  readonly sites: readonly NoteSite[];
  readonly title: readonly Inline[];
  readonly story: readonly Block[];
  readonly images: readonly NoteImage[];
  /** Empty only for an intro. */
  readonly tech: readonly Block[];
  /** The version the note is held for (the launch); null — the next release takes it. */
  readonly release: string | null;
  /** Lower goes first within its kind; 50 when the note names none. */
  readonly order: number;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
const IMAGE_FILE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:png|jpe?g)$/;
const CYRILLIC_RE = /[А-Яа-яЁё]/;

/** The file name of a note → its slug; null — not a note (README.md, a picture, a draft starting with «_»). */
export function noteSlug(fileName: string): string | null {
  if (!fileName.endsWith('.md') || fileName === 'README.md' || fileName.startsWith('_')) return null;
  return fileName.slice(0, -3);
}

const plain = (inline: readonly Inline[]): string => inline.map((part) => part.text).join('');
export const blocksText = (blocks: readonly Block[]): string =>
  blocks.map((block) => (block.kind === 'list' ? block.items.map(plain).join(' ') : plain(block.inline))).join(' ');

/**
 * Parses and checks one note. `imageBytes` gives the size of a file next to the
 * note, or null when there is none. Throws an Error naming the file and line.
 */
export function parseNote(slug: string, source: string, imageBytes: (file: string) => number | null): Note {
  const path = `${NOTES_DIR}/${slug}.md`;
  const fail = (message: string, line?: number): never => {
    throw new Error(line === undefined ? `${path}: ${message}` : `${path}:${line}: ${message}`);
  };
  if (!SLUG_RE.test(slug) || slug.length > LIMITS.slug) fail(`the file name is lowercase latin words joined by «-», at most ${LIMITS.slug} characters`);

  const lines = source.replace(/\r\n/g, '\n').split('\n');
  // No long dash in what chatters read (the owner, 2026-10-26): a colon, a comma, a period or brackets instead.
  const dash = lines.findIndex((text) => text.includes('\u2014'));
  if (dash >= 0) fail('a long dash «\u2014»: write a colon, a comma, a period or brackets instead (the owner, 2026-10-26)', dash + 1);
  if (lines[0] !== '---') fail('starts with «---» and the fields kind and sites', 1);
  const close = lines.indexOf('---', 1);
  if (close < 0) fail('the fields are not closed by «---»', 1);
  const fields = new Map<string, { value: string; line: number }>();
  for (let index = 1; index < close; index += 1) {
    const text = lines[index] ?? '';
    if (text.trim() === '' || text.trimStart().startsWith('#')) continue;
    const match = /^([a-z]+):\s*(.*?)\s*(?:#.*)?$/.exec(text);
    if (match === null) fail(`«key: value» expected, got «${text}»`, index + 1);
    const [, key = '', value = ''] = match ?? [];
    if (fields.has(key)) fail(`«${key}» twice`, index + 1);
    fields.set(key, { value, line: index + 1 });
  }
  for (const [key, { line }] of fields) if (!['kind', 'sites', 'release', 'order'].includes(key)) fail(`unknown field «${key}»: kind, sites, release and order`, line);
  const orderField = fields.get('order');
  const order = orderField === undefined ? DEFAULT_ORDER : Number(orderField.value);
  if (!Number.isInteger(order) || order < 1 || order > 99) fail(`order is a whole number from 1 to 99, got «${orderField?.value ?? ''}»`, orderField?.line);
  const releaseField = fields.get('release');
  const release = releaseField === undefined ? null : releaseField.value;
  if (release !== null && (!isVersion(release) || reservedVersionProblem(release) !== null)) fail(`release is the version the note waits for, X.Y.Z (3.0.0 — the launch), got «${release}»`, releaseField?.line);
  const kindField = fields.get('kind');
  const kind = kindField?.value as NoteKind | undefined;
  if (kind === undefined || !NOTE_KINDS.includes(kind)) fail(`kind is one of ${NOTE_KINDS.join(', ')}`, kindField?.line ?? 1);
  const sitesField = fields.get('sites');
  const sites = (sitesField?.value ?? '').split(',').map((site) => site.trim()).filter((site) => site !== '');
  if (sites.length === 0 || sites.some((site) => !NOTE_SITES.includes(site as NoteSite)) || new Set(sites).size !== sites.length) {
    fail(`sites lists ${NOTE_SITES.join(' and/or ')}, by commas`, sitesField?.line ?? 1);
  }

  // The body: «# title», the story with its pictures, «## Как это устроено» and the technical part.
  const body = lines.slice(close + 1).map((text, index) => ({ text, line: close + 2 + index }));
  const first = body.findIndex((line) => line.text.trim() !== '');
  const titleLine = body[first];
  if (titleLine === undefined || !titleLine.text.startsWith('# ')) fail('the first line after the fields is the title, «# …»', titleLine?.line ?? close + 2);
  const titleText = (titleLine?.text ?? '').slice(2).trim();
  const rest = body.slice(first + 1);
  const techAt = rest.findIndex((line) => line.text.startsWith('## '));
  if (techAt >= 0 && rest[techAt]?.text.slice(3).trim() !== TECH_HEADING) fail(`the only «##» heading is «## ${TECH_HEADING}»`, rest[techAt]?.line);
  const storyLines = techAt < 0 ? rest : rest.slice(0, techAt);
  const techLines = techAt < 0 ? [] : rest.slice(techAt + 1);
  for (const line of [...storyLines, ...techLines]) {
    if (/^#{1,2} /.test(line.text)) fail('one «#» title and one «## Как это устроено»; smaller headings — «###»', line.line);
  }

  const images: NoteImage[] = [];
  const textLines = storyLines.filter((line) => {
    const image = IMAGE_LINE_RE.exec(line.text);
    if (image === null) return true;
    const [, alt = '', file = ''] = image;
    if (!IMAGE_FILE_RE.test(file)) fail(`a picture is a .png or .jpg next to the note, its name lowercase latin with «-»: «${file}»`, line.line);
    if (alt.trim() === '') fail(`say what the picture shows: ![what it shows](${file})`, line.line);
    const bytes = imageBytes(file);
    if (bytes === null) fail(`no ${NOTES_DIR}/${file}`, line.line);
    if (bytes !== null && bytes > LIMITS.imageBytes) fail(`${file} is ${Math.round(bytes / 1024)} KB, at most ${LIMITS.imageBytes / 1024} KB (sips -Z 1600 ${NOTES_DIR}/${file}, or a .jpg)`, line.line);
    images.push({ file, alt: alt.trim() });
    return false;
  });
  if (images.length > LIMITS.images) fail(`at most ${LIMITS.images} pictures`);
  for (const line of techLines) if (IMAGE_LINE_RE.test(line.text)) fail('pictures go above «## Как это устроено»', line.line);

  // The changelog's parser names CHANGELOG.md in its errors: here they are this note's.
  const parsed = <T>(parse: () => T): T => {
    try {
      return parse();
    } catch (error) {
      if (error instanceof ChangelogError) fail(error.message.replace(/^CHANGELOG\.md(?::\d+)?: /, ''), Number(/^CHANGELOG\.md:(\d+)/.exec(error.message)?.[1]) || undefined);
      throw error;
    }
  };
  const title = parsed(() => parseInline(titleText, titleLine?.line));
  const story = parsed(() => parseBlocks(textLines));
  const tech = parsed(() => parseBlocks(techLines));

  const titlePlain = plain(title);
  if (titlePlain === '' || !CYRILLIC_RE.test(titlePlain)) fail('the title is in Russian, for a chatter', titleLine?.line);
  if (titlePlain.length > LIMITS.title) fail(`the title is ${titlePlain.length} characters, at most ${LIMITS.title}`, titleLine?.line);
  if (/[.]$/.test(titlePlain)) fail('no full stop after the title', titleLine?.line);
  const storyText = blocksText(story);
  if (story.length === 0) fail('under the title: who it is for and why — a paragraph or a list');
  if (!CYRILLIC_RE.test(storyText)) fail('the text under the title is in Russian, for a chatter');
  if (storyText.length > LIMITS.story) fail(`the text under the title is ${storyText.length} characters, at most ${LIMITS.story}: the details go to «## ${TECH_HEADING}»`);
  if (story.some((block) => block.kind === 'heading')) fail(`no «###» above «## ${TECH_HEADING}»: the title says it, the text explains it`);
  if (kind !== 'intro' && tech.length === 0) fail(`«## ${TECH_HEADING}» and the technical side under it`);
  const techText = blocksText(tech);
  if (techText.length > LIMITS.tech) fail(`the technical part is ${techText.length} characters, at most ${LIMITS.tech}`);

  return { slug, kind: kind as NoteKind, sites: sites as NoteSite[], title, story, images, tech, release, order };
}

const ORDER: Readonly<Record<NoteKind, number>> = { intro: 0, new: 1, improved: 2, fixed: 3 };
const DEFAULT_ORDER = 50;

/** The notes of a release in reading order: the intro, new, improved, fixed; within a kind by `order`, then as they came. */
export function sortNotes(notes: readonly Note[]): Note[] {
  return notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => ORDER[a.note.kind] - ORDER[b.note.kind] || a.note.order - b.note.order || a.index - b.index)
    .map(({ note }) => note);
}

/** What one release's notes may not be together. */
export function releaseProblems(notes: readonly Note[]): string[] {
  const intros = notes.filter((note) => note.kind === 'intro');
  return intros.length > 1 ? [`one intro per release, there are ${intros.length}: ${intros.map((note) => note.slug).join(', ')}`] : [];
}

/** The part of the version a release raises when nobody names one: something new — minor, else patch. */
export function bumpOf(notes: readonly Note[]): 'minor' | 'patch' {
  return notes.some((note) => note.kind === 'new') ? 'minor' : 'patch';
}
