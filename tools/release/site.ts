// The release site (architecture.md §13: «Страницы site/ лежат рядом с
// фидом»; UP-011…UP-015): static pages in site/, published as they are
// committed. Three things in them follow the release and are written by this
// tool, never by hand:
//
//   <… data-cg="version">0.1.0</…>      the current version
//   <… data-cg="firefox">142</…>        the oldest Firefox the manifest allows
//   <a data-cg="xpi" href="…">           the address of the signed XPI
//   <!-- cg:begin NAME --> … <!-- cg:end NAME -->
//                                        a part made from CHANGELOG.md:
//                                        `whats-new` (the current version) and
//                                        `changelog` (every version)
//
// `pnpm release site` rewrites them; a test fails while the committed pages
// lag behind the version or the changelog, so the site in git is always the
// site of the version in git. No I/O here.

import { blocksHtml, escapeHtml, sectionOf, type Changelog, type ChangelogSection } from './changelog.ts';
import { signedXpiName, type ReleaseTarget } from './config.ts';

/** Every page of the site; the first is its index. */
export const SITE_PAGES = ['index.html', 'start.html', 'guide.html', 'whats-new.html', 'changelog.html', 'privacy.html'] as const;
export const SITE_STYLESHEET = 'site.css';
export const SITE_FILES: readonly string[] = [...SITE_PAGES, SITE_STYLESHEET];
/** Pages with nothing of a release in them: they may be published ahead of one («Как начать» before the first invite). */
export const VERSIONLESS_FILES: readonly string[] = ['start.html', 'guide.html', 'privacy.html', SITE_STYLESHEET];

export interface SiteContext {
  readonly version: string;
  readonly target: ReleaseTarget;
  readonly changelog: Changelog;
}

/** The XPI's address as the install page links to it: relative to the site folder. */
export const xpiHref = (context: Pick<SiteContext, 'version' | 'target'>): string => `${context.target.feedDir}/${signedXpiName(context.version)}`;

function releaseHtml(section: ChangelogSection, indent: string): string {
  const label = section.label === '' ? '' : ` <span class="release__label">${escapeHtml(section.label)}</span>`;
  return [
    `${indent}<section class="release" id="v${section.version}">`,
    `${indent}  <h2 class="release__title"><span class="release__version">${section.version}</span>${label}</h2>`,
    blocksHtml(section.blocks, `${indent}  `),
    `${indent}</section>`,
  ].join('\n');
}

function regions(context: SiteContext): Record<string, (indent: string) => string> {
  return {
    'whats-new': (indent) => releaseHtml(sectionOf(context.changelog, context.version), indent),
    changelog: (indent) => context.changelog.sections.map((section) => releaseHtml(section, indent)).join('\n'),
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
 * opens (file names).
 */
export function siteProblems(files: ReadonlyMap<string, string>, context: SiteContext, linked: readonly string[]): string[] {
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
    // Static and self-contained: no script, no handler, nothing loaded from another host.
    if (/<script\b/i.test(html)) say('no scripts on the site');
    if (/\son[a-z]+\s*=/i.test(html)) say('no inline event handlers');
    if (/<(?:img|iframe|object|embed|video|audio|source)\b/i.test(html)) say('no embedded media (icons are inline SVG)');
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
  for (const name of VERSIONLESS_FILES) {
    if (/data-cg="|<!-- cg:/.test(files.get(name) ?? '')) problems.push(`${name}: a page that is published ahead of a release must carry nothing of a release`);
  }
  if (problems.length > 0) return problems;

  let rendered: Map<string, string>;
  try {
    rendered = renderSite(files, context);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  for (const [name, text] of rendered) {
    if (text !== files.get(name)) problems.push(`${name} is behind the version or the changelog — run \`pnpm release site\``);
  }
  return problems;
}
