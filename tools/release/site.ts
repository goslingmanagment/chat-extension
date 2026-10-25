// The release site (architecture.md §13: «Страницы site/ лежат рядом с
// фидом»; UP-011…UP-015): static pages in site/, published as they are
// committed — the pages are the only source of their text. Three things in
// them follow the release and are written by this tool, never by hand:
//
//   <… data-cg="version">0.1.0</…>      the current version
//   <… data-cg="firefox">142</…>        the oldest Firefox the manifest allows
//   <a data-cg="xpi" href="…">           the address of the signed XPI
//   <!-- cg:begin NAME --> … <!-- cg:end NAME -->
//                                        a part made from the history (notes.ts):
//                                        `whats-new` (the current version) and
//                                        `changelog` (every version)
//
// One thing is written by hand and read by the release: the first version a
// page belongs to, `<meta name="cg-first-version" content="3.0.0">` in its
// head (the pages of the 3.0 launch). While the site declares a version above
// the one the notes give, that version is the next release, and only on the
// owner's word (cli.ts): a routine release never publishes such pages early.
//
// `pnpm release` renders them into the tree for its build and puts the files
// back after: the site in git stays the site of git's version and CHANGELOG.md. The screenshots of the notes
// (changes/*.png) go up next to the pages, under changes/. No I/O here.

import { blocksHtml, escapeHtml, inlineHtml } from './changelog.ts';
import { KIND_LABEL, NOTES_DIR, SITE_LABEL, TECH_HEADING, type Note } from './changes.ts';
import { signedXpiName, type ReleaseTarget } from './config.ts';
import { groups, NOTHING_NEW, releaseLabel, releaseOf, type History, type Release } from './notes.ts';
import { compareVersions, isVersion, reservedVersionProblem } from './version.ts';

/** Every page of the site; the first is its index. */
export const SITE_PAGES = ['index.html', 'start.html', 'guide.html', 'whats-new.html', 'changelog.html', 'privacy.html', '404.html'] as const;
export const SITE_STYLESHEET = 'site.css';
export const SITE_FILES: readonly string[] = [...SITE_PAGES, SITE_STYLESHEET];
/**
 * Pages with nothing of a release in them: they may be published ahead of one
 * («Как начать» before the first invite). The stylesheet is not among them:
 * the pages of the released version already on the server are drawn with it,
 * so it goes out with a release or with `pages` — ahead of a release only when
 * the server has none at all.
 */
export const VERSIONLESS_PAGES: readonly string[] = ['start.html', 'guide.html', 'privacy.html', '404.html'];
/**
 * The page nginx answers a missing address of the site's host with, at that address: its relative links resolve
 * from the root only through `<base href="/">`, which it must carry (and no other page may).
 */
export const NOT_FOUND_PAGE = '404.html';

export interface SiteContext {
  readonly version: string;
  readonly target: ReleaseTarget;
  readonly history: History;
  /** The signed XPI as the version's record names it, when it is signed already (an older one keeps its old name). */
  readonly xpiFile?: string;
}

/** The XPI's address as the install page links to it: relative to the site folder. */
export const xpiHref = (context: Pick<SiteContext, 'version' | 'target' | 'xpiFile'>): string => `${context.target.feedDir}/${context.xpiFile ?? signedXpiName(context.version)}`;

// ── the first version a page belongs to ──

/** How a page declares the first version it belongs to — in exactly this form. */
export const FIRST_VERSION_META = (version: string): string => `<meta name="cg-first-version" content="${version}">`;
const FIRST_VERSION_RE = /<meta\b[^>]*cg-first-version[^>]*>/gi;
const FIRST_VERSION_EXACT_RE = /^<meta name="cg-first-version" content="([^"]*)">$/;

export interface SiteFirstVersion {
  /** The highest first version a page declares. */
  readonly version: string;
  /** The pages that declare it. */
  readonly pages: readonly string[];
}

/** Every declaration of a first version in the pages, as written; `version` null — not in the exact form. */
function firstVersionTags(files: ReadonlyMap<string, string>): Array<{ readonly page: string; readonly tag: string; readonly version: string | null }> {
  return [...files].flatMap(([page, html]) =>
    page.endsWith('.html') ? [...html.matchAll(FIRST_VERSION_RE)].map((match) => ({ page, tag: match[0], version: FIRST_VERSION_EXACT_RE.exec(match[0])?.[1] ?? null })) : [],
  );
}

/** What is wrong with the pages' declarations of their first version; [] — each is exact, a version, at most one per page. */
export function firstVersionProblems(files: ReadonlyMap<string, string>): string[] {
  const tags = firstVersionTags(files);
  const problems: string[] = [];
  for (const page of new Set(tags.map((tag) => tag.page))) {
    const many = tags.filter((tag) => tag.page === page).length;
    if (many > 1) problems.push(`${page}: one ${FIRST_VERSION_META('X.Y.Z')} per page, there are ${many}`);
  }
  for (const { page, tag, version } of tags) {
    const reserved = version !== null && isVersion(version) ? reservedVersionProblem(version) : null;
    if (version === null || !isVersion(version)) problems.push(`${page}: «${tag}» — a page declares its first version as ${FIRST_VERSION_META('X.Y.Z')}`);
    else if (reserved !== null) problems.push(`${page}: ${reserved}`);
  }
  return problems;
}

/** The first version the site belongs to: the highest any page declares; null — none does. Throws on a declaration that is not exact. */
export function siteFirstVersion(files: ReadonlyMap<string, string>): SiteFirstVersion | null {
  const problems = firstVersionProblems(files);
  if (problems.length > 0) throw new Error(`site/ declares its first version wrongly:\n  ${problems.join('\n  ')}`);
  const declared = firstVersionTags(files).flatMap(({ page, version }) => (version === null ? [] : [{ page, version }]));
  const top = declared.map((each) => each.version).sort(compareVersions).at(-1);
  return top === undefined ? null : { version: top, pages: declared.filter((each) => each.version === top).map((each) => each.page) };
}

/** The address of a note's screenshot on the site, relative to its pages. */
export const noteImageHref = (file: string): string => `${NOTES_DIR}/${file}`;

/** Every screenshot the history shows: the files of changes/ that go up with the pages. */
export function historyImages(history: History): string[] {
  return [...new Set(history.releases.flatMap((release) => (release.kind === 'notes' ? release.notes.flatMap((note) => note.images.map((image) => image.file)) : [])))].sort();
}

function noteHtml(note: Note, version: string, indent: string): string {
  const sites = note.sites.map((site) => `<span class="note__site">${SITE_LABEL[site]}</span>`).join('');
  const lines = [
    `<article class="note note--${note.kind}" id="v${version}-${note.slug}">`,
    `  <p class="note__meta"><span class="note__kind">${KIND_LABEL[note.kind]}</span>${sites}</p>`,
    `  <h3 class="note__title">${inlineHtml(note.title)}</h3>`,
    blocksHtml(note.story, '  '),
    ...note.images.map((image) => `  <figure class="note__shot"><img src="${escapeHtml(noteImageHref(image.file))}" alt="${escapeHtml(image.alt)}" loading="lazy"><figcaption>${escapeHtml(image.alt)}</figcaption></figure>`),
    ...(note.tech.length === 0 ? [] : [`  <details class="note__tech">`, `    <summary>${TECH_HEADING}</summary>`, blocksHtml(note.tech, '    '), '  </details>']),
    '</article>',
  ];
  return lines.join('\n').split('\n').map((line) => `${indent}${line}`).join('\n');
}

function releaseHtml(release: Release, indent: string): string {
  const label = releaseLabel(release);
  const head = [
    `${indent}<section class="release" id="v${release.version}">`,
    `${indent}  <h2 class="release__title"><span class="release__version">${release.version}</span>${label === '' ? '' : ` <span class="release__label">${escapeHtml(label)}</span>`}</h2>`,
  ];
  if (release.kind === 'legacy') return [...head, blocksHtml(release.blocks, `${indent}  `), `${indent}</section>`].join('\n');
  const body = release.notes.length === 0 ? [`${indent}  <p class="muted">${NOTHING_NEW}</p>`] : groups(release.notes).flatMap((group) => group.notes.map((note) => noteHtml(note, release.version, `${indent}  `)));
  return [...head, ...body, `${indent}</section>`].join('\n');
}

function regions(context: SiteContext): Record<string, (indent: string) => string> {
  return {
    'whats-new': (indent) => releaseHtml(releaseOf(context.history, context.version), indent),
    changelog: (indent) => context.history.releases.map((release) => releaseHtml(release, indent)).join('\n'),
  };
}

const REGION_RE = /^([ \t]*)<!-- cg:begin ([a-z-]+) -->\n[\s\S]*?^[ \t]*<!-- cg:end \2 -->$/gm;
const TEXT_SLOT_RE = /(<([a-z0-9]+)\b[^>]*\bdata-cg="(version|firefox)"[^>]*>)[^<]*(<\/\2>)/g;
const XPI_TAG_RE = /<a\b[^>]*\bdata-cg="xpi"[^>]*>/g;

/** One page with its generated parts rewritten for `context`. */
export function renderPage(html: string, context: SiteContext): string {
  const parts = regions(context);
  const firefox = context.target.strictMinVersion.split('.')[0] ?? context.target.strictMinVersion;
  return html
    .replace(REGION_RE, (whole: string, indent: string, name: string) => {
      const make = parts[name];
      if (make === undefined) throw new Error(`unknown generated part «${name}»`);
      return `${indent}<!-- cg:begin ${name} -->\n${make(indent)}\n${indent}<!-- cg:end ${name} -->`;
    })
    .replace(TEXT_SLOT_RE, (_whole: string, open: string, _tag: string, slot: string, close: string) => `${open}${slot === 'version' ? context.version : firefox}${close}`)
    .replace(XPI_TAG_RE, (tag) => {
      if (!/\bhref="[^"]*"/.test(tag)) throw new Error('the link with data-cg="xpi" has no href');
      return tag.replace(/\bhref="[^"]*"/, `href="${xpiHref(context)}"`);
    });
}

/** Every file of the site as it must be for `context` (the stylesheet as it is). */
export function renderSite(files: ReadonlyMap<string, string>, context: SiteContext): Map<string, string> {
  return new Map([...files].map(([name, text]) => [name, name.endsWith('.html') ? renderPage(text, context) : text]));
}

const count = (text: string, pattern: RegExp): number => [...text.matchAll(pattern)].length;

/**
 * What is wrong with the site; [] — it can be published. `files` are the
 * files of site/ by name; `linked` are the page addresses the extension itself
 * opens (file names); `images` — the screenshots in changes/ that go up with them.
 */
export function siteProblems(files: ReadonlyMap<string, string>, context: SiteContext, linked: readonly string[], images: ReadonlySet<string> = new Set(historyImages(context.history))): string[] {
  const problems: string[] = [];
  for (const name of SITE_FILES) if (!files.has(name)) problems.push(`${name} is missing`);
  for (const name of files.keys()) if (!SITE_FILES.includes(name)) problems.push(`${name} is not a file of the site (tools/release/site.ts lists them)`);
  for (const name of linked) if (!files.has(name)) problems.push(`the extension links to ${name}, and the site has no such page`);
  if (problems.length > 0) return problems;

  for (const page of SITE_PAGES) {
    const html = files.get(page) ?? '';
    const say = (text: string): void => {
      problems.push(`${page}: ${text}`);
    };
    if (!/^<!doctype html>\n<html lang="ru">/i.test(html)) say('must start with <!doctype html> and <html lang="ru">');
    if (!/<meta charset="utf-8">/i.test(html)) say('no <meta charset="utf-8">');
    if (!/<meta name="viewport" /.test(html)) say('no viewport meta');
    if (!/<title>[^<]+<\/title>/.test(html)) say('no <title>');
    if (count(html, /<link rel="stylesheet" href="site\.css">/g) !== 1) say(`must link ${SITE_STYLESHEET} exactly once`);
    // The error page is served at any missing address of its host: its links resolve from the root. No other page may.
    if (page === NOT_FOUND_PAGE) {
      if (count(html, /<base href="\/">/g) !== 1) say('must carry <base href="/"> once: nginx serves it at any missing address');
    } else if (/<base\b/i.test(html)) say('no <base>: the page is served at its own address');
    // Static and self-contained: no script, no handler, nothing loaded from another host.
    if (/<script\b/i.test(html)) say('no scripts on the site');
    if (/\son[a-z]+\s*=/i.test(html)) say('no inline event handlers');
    // The only pictures are the notes' screenshots, from the site's own changes/ folder.
    if (/<(?:iframe|object|embed|video|audio|source)\b/i.test(html)) say('no embedded media (icons are inline SVG)');
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const src = /\bsrc="([^"]*)"/.exec(match[0])?.[1] ?? '';
      if (!src.startsWith(`${NOTES_DIR}/`) || !images.has(src.slice(NOTES_DIR.length + 1))) say(`the picture ${src || '(no src)'} is no screenshot of a note in ${NOTES_DIR}/`);
    }
    for (const match of html.matchAll(/<link\b[^>]*\bhref="([^"]*)"/g)) {
      if (/^(?:[a-z]+:)?\/\//i.test(match[1] ?? '')) say(`loads ${match[1]} from another host`);
    }
    for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>/g)) {
      const href = match[1] ?? '';
      // The install link is written by this tool; a stale one is «behind the version» below.
      if (href.startsWith('#') || /\bdata-cg="xpi"/.test(match[0])) continue;
      if (/^[a-z]+:/i.test(href)) {
        if (!href.startsWith('https://')) say(`the link ${href} is not https`);
        else if (!/\brel="noopener"/.test(match[0])) say(`the outside link ${href} needs rel="noopener"`);
        continue;
      }
      const file = href.replace(/#.*$/, '');
      if (!files.has(file)) say(`the link ${href} leads nowhere`);
    }
    for (const match of html.matchAll(/<!-- cg:(begin|end) ([a-z-]+) -->/g)) {
      const name = match[2] ?? '';
      if (!(name in regions(context))) say(`unknown generated part «${name}»`);
      else if (count(html, new RegExp(`<!-- cg:begin ${name} -->`, 'g')) !== 1 || count(html, new RegExp(`<!-- cg:end ${name} -->`, 'g')) !== 1) say(`the part «${name}» must open and close once`);
    }
  }

  const index = files.get('index.html') ?? '';
  if (count(index, XPI_TAG_RE) !== 1) problems.push('index.html: exactly one install link (data-cg="xpi") is expected');
  if (count(index, /data-cg="version"/g) < 1) problems.push('index.html: the version (data-cg="version") is not shown');
  if (count(index, /data-cg="firefox"/g) < 1) problems.push('index.html: the oldest Firefox (data-cg="firefox") is not shown');
  if (count(files.get('whats-new.html') ?? '', /<!-- cg:begin whats-new -->/g) !== 1) problems.push('whats-new.html: no generated part «whats-new»');
  if (count(files.get('changelog.html') ?? '', /<!-- cg:begin changelog -->/g) !== 1) problems.push('changelog.html: no generated part «changelog»');
  for (const name of VERSIONLESS_PAGES) {
    if (/data-cg="|<!-- cg:/.test(files.get(name) ?? '')) problems.push(`${name}: a page that is published ahead of a release must carry nothing of a release`);
  }
  problems.push(...firstVersionProblems(files));
  if (problems.length > 0) return problems;

  let rendered: Map<string, string>;
  try {
    rendered = renderSite(files, context);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  for (const [name, text] of rendered) {
    if (text !== files.get(name)) problems.push(`${name} is behind the version or the changelog (the release renders it: tools/release/site.ts)`);
  }
  return problems;
}
