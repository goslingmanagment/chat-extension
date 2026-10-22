// CHANGELOG.md is the one text of «что нового»: the site's history page, the
// «Что нового» page of the current version and the Telegram announcement are
// all made from it (UP-005, UP-014, UP-015). It is written for chatters, in
// Russian, newest version first:
//
//   # Что нового
//
//   ## 0.2.0
//
//   One or two sentences about the release.
//
//   ### Новое
//
//   - **Что-то.** Как этим пользоваться.
//
// The parser takes a small, exact subset of Markdown — `##` version sections,
// `###` subheadings, paragraphs, one-level `-` lists, **bold**, `code` and
// [links](https://…) — and refuses everything else, so nothing reaches a page
// or the channel half-rendered. No I/O here.

import { compareVersions, isVersion } from './version.ts';

export type Inline =
  | { readonly kind: 'text' | 'bold' | 'code'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string };

export type Block =
  | { readonly kind: 'heading'; readonly inline: readonly Inline[] }
  | { readonly kind: 'paragraph'; readonly inline: readonly Inline[] }
  | { readonly kind: 'list'; readonly items: ReadonlyArray<readonly Inline[]> };

export interface ChangelogSection {
  readonly version: string;
  /** What follows the version in the heading (a date, a name), or ''. */
  readonly label: string;
  readonly blocks: readonly Block[];
}

export interface Changelog {
  readonly title: string;
  /** Newest first. */
  readonly sections: readonly ChangelogSection[];
}

export class ChangelogError extends Error {
  constructor(message: string, line?: number) {
    super(line === undefined ? `CHANGELOG.md: ${message}` : `CHANGELOG.md:${line}: ${message}`);
    this.name = 'ChangelogError';
  }
}

const INLINE_RE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string, line?: number): Inline[] {
  const out: Inline[] = [];
  const plain = (chunk: string): void => {
    if (chunk === '') return;
    if (/\*\*|`/.test(chunk)) throw new ChangelogError(`unmatched ** or \` in «${chunk.trim()}»`, line);
    if (/\]\(|!\[/.test(chunk)) throw new ChangelogError(`broken link or an image in «${chunk.trim()}» (images are not supported)`, line);
    out.push({ kind: 'text', text: chunk });
  };
  let last = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    plain(text.slice(last, match.index));
    last = match.index + match[0].length;
    const [, bold, code, label, href] = match;
    if (bold !== undefined) out.push({ kind: 'bold', text: bold });
    else if (code !== undefined) out.push({ kind: 'code', text: code });
    else if (label !== undefined && href !== undefined) {
      if (text[match.index - 1] === '!') throw new ChangelogError(`images are not supported: «${match[0]}»`, line);
      if (!/^https:\/\/[^\s"<>]+$/.test(href)) throw new ChangelogError(`a link must be an https address, got «${href}»`, line);
      out.push({ kind: 'link', text: label, href });
    }
  }
  plain(text.slice(last));
  return out;
}

const UNSUPPORTED: ReadonlyArray<[RegExp, string]> = [
  [/^#{4,}\s/, 'headings deeper than ###'],
  [/^\s*```|^\s*~~~/, 'code fences'],
  [/^>/, 'quotes'],
  [/^\|/, 'tables'],
  [/^\s*\d+[.)]\s/, 'numbered lists (use «-»)'],
  [/^\s+[-*+]\s/, 'nested lists'],
  [/^[*+]\s/, 'lists marked with * or + (use «-»)'],
  [/^\s*<[a-zA-Z/!]/, 'HTML'],
  [/^(?:-{3,}|\*{3,}|_{3,})\s*$/, 'horizontal rules'],
];

export function parseBlocks(lines: ReadonlyArray<{ readonly text: string; readonly line: number }>): Block[] {
  const blocks: Block[] = [];
  let paragraph: { text: string; line: number } | null = null;
  let list: Array<{ text: string; line: number }> | null = null;
  const flush = (): void => {
    if (paragraph !== null) blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.text, paragraph.line) });
    if (list !== null) blocks.push({ kind: 'list', items: list.map((item) => parseInline(item.text, item.line)) });
    paragraph = null;
    list = null;
  };
  for (const { text, line } of lines) {
    if (text.trim() === '') {
      flush();
      continue;
    }
    for (const [pattern, what] of UNSUPPORTED) if (pattern.test(text)) throw new ChangelogError(`${what} are not supported: «${text.trim()}»`, line);
    if (text.startsWith('### ')) {
      flush();
      blocks.push({ kind: 'heading', inline: parseInline(text.slice(4).trim(), line) });
    } else if (text.startsWith('- ')) {
      if (paragraph !== null) flush();
      list ??= [];
      list.push({ text: text.slice(2).trim(), line });
    } else if (list !== null && /^ {2,}\S/.test(text)) {
      // A wrapped list item: the continuation is indented under its text.
      const item = list.at(-1);
      if (item !== undefined) item.text = `${item.text} ${text.trim()}`;
    } else if (/^\s/.test(text)) {
      throw new ChangelogError(`an indented line outside a list: «${text.trim()}»`, line);
    } else {
      if (list !== null) flush();
      paragraph = paragraph === null ? { text: text.trim(), line } : { text: `${paragraph.text} ${text.trim()}`, line: paragraph.line };
    }
  }
  flush();
  return blocks;
}

export function parseChangelog(source: string): Changelog {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let title: string | null = null;
  const raw: Array<{ version: string; label: string; line: number; lines: Array<{ text: string; line: number }> }> = [];
  for (const [index, text] of lines.entries()) {
    const line = index + 1;
    if (text.startsWith('# ')) {
      if (title !== null || raw.length > 0) throw new ChangelogError('one «# » title, on the first line', line);
      title = text.slice(2).trim();
    } else if (text.startsWith('## ')) {
      const [version = '', ...rest] = text.slice(3).trim().split(/\s+/);
      if (!isVersion(version)) throw new ChangelogError(`a section starts with its version, X.Y.Z: «${text}»`, line);
      raw.push({ version, label: rest.join(' ').replace(/^[—–·-]\s*/, ''), line, lines: [] });
    } else if (raw.length > 0) {
      raw.at(-1)?.lines.push({ text, line });
    } else if (text.trim() !== '' && title === null) {
      throw new ChangelogError('the file starts with a «# » title', line);
    } else if (text.trim() !== '') {
      throw new ChangelogError('text between the title and the first «## » section', line);
    }
  }
  if (title === null) throw new ChangelogError('no «# » title');
  const sections = raw.map((section): ChangelogSection => {
    const blocks = parseBlocks(section.lines);
    if (blocks.length === 0) throw new ChangelogError(`the section of ${section.version} is empty`, section.line);
    return { version: section.version, label: section.label, blocks };
  });
  sections.forEach((section, index) => {
    const older = sections[index + 1];
    if (older !== undefined && compareVersions(section.version, older.version) <= 0) {
      throw new ChangelogError(`sections go from the newest version down, each once: ${section.version} stands above ${older.version}`);
    }
  });
  return { title, sections };
}

export function sectionOf(changelog: Changelog, version: string): ChangelogSection {
  const section = changelog.sections.find((candidate) => candidate.version === version);
  if (section === undefined) throw new ChangelogError(`no «## ${version}» section — write what is new in this version first`);
  return section;
}

// ── HTML (the site) ────────────────────────────────────────────────────────

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function inlineHtml(inline: readonly Inline[]): string {
  return inline
    .map((part) => {
      if (part.kind === 'bold') return `<strong>${escapeHtml(part.text)}</strong>`;
      if (part.kind === 'code') return `<code>${escapeHtml(part.text)}</code>`;
      if (part.kind === 'link') return `<a href="${escapeHtml(part.href)}" rel="noopener">${escapeHtml(part.text)}</a>`;
      return escapeHtml(part.text);
    })
    .join('');
}

/** The blocks of a section as HTML lines, each indented by `indent`. */
export function blocksHtml(blocks: readonly Block[], indent = ''): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.kind === 'heading') lines.push(`<h3>${inlineHtml(block.inline)}</h3>`);
    else if (block.kind === 'paragraph') lines.push(`<p>${inlineHtml(block.inline)}</p>`);
    else lines.push('<ul>', ...block.items.map((item) => `  <li>${inlineHtml(item)}</li>`), '</ul>');
  }
  return lines.map((line) => `${indent}${line}`).join('\n');
}

// ── Markdown back out (the Telegram announcement) ──────────────────────────

/** Telegram's Rich Markdown reads `$…$` as a formula: a bare dollar goes out escaped, a code span as it is. */
function inlineMarkdown(inline: readonly Inline[]): string {
  const text = (value: string): string => value.replace(/\$/g, '\\$');
  return inline
    .map((part) => {
      if (part.kind === 'bold') return `**${text(part.text)}**`;
      if (part.kind === 'code') return `\`${part.text}\``;
      if (part.kind === 'link') return `[${text(part.text)}](${part.href})`;
      return text(part.text);
    })
    .join('');
}

export function blocksMarkdown(blocks: readonly Block[]): string {
  return blocks
    .map((block) => {
      if (block.kind === 'heading') return `### ${inlineMarkdown(block.inline)}`;
      if (block.kind === 'paragraph') return inlineMarkdown(block.inline);
      return block.items.map((item) => `- ${inlineMarkdown(item)}`).join('\n');
    })
    .join('\n\n');
}
