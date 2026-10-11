import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { STRICT_MIN_VERSION } from '../../apps/extension/build/manifest.ts';
import { SITE_BASE, SITE_PAGES as EXTENSION_LINKS } from '../../apps/extension/src/site.ts';
import { parseChangelog } from './changelog.ts';
import { CHANGELOG_FILE, releaseTarget, REPO_ROOT, SITE_DIR, VERSION_FILE } from './config.ts';
import { HOME_HREF, renderPage, renderSite, siteProblems, SITE_FILES, SITE_PAGES, VERSIONLESS_PAGES, xpiHref, type SiteContext } from './site.ts';
import { readPackageVersion } from './version.ts';

const siteDir = join(REPO_ROOT, SITE_DIR);
const committed = new Map(readdirSync(siteDir).sort().map((name) => [name, readFileSync(join(siteDir, name), 'utf8')]));
const context: SiteContext = {
  version: readPackageVersion(readFileSync(join(REPO_ROOT, VERSION_FILE), 'utf8')),
  target: releaseTarget(),
  changelog: parseChangelog(readFileSync(join(REPO_ROOT, CHANGELOG_FILE), 'utf8')),
};
const linked = Object.values(EXTENSION_LINKS).map((url) => url.slice(SITE_BASE.length));

const CHANGELOG = parseChangelog('# Что нового\n\n## 0.2.0 — 12 октября\n\nВторая <версия>.\n\n- **Раз.** Два.\n\n## 0.1.0\n\nПервая.\n');
const next: SiteContext = { version: '0.2.0', target: releaseTarget(), changelog: CHANGELOG };

describe('the site in the repository', () => {
  it('[UP-011] [UP-012] [UP-013] [UP-014] [UP-015] is whole and is the site of the version and the changelog in the tree', () => {
    expect(siteProblems(committed, context, linked)).toEqual([]);
    expect([...committed.keys()].sort()).toEqual([...SITE_FILES].sort());
  });

  it('[UP-013] has every page the extension opens, under the address the extension uses', () => {
    expect(linked.sort()).toEqual(['changelog.html', 'start.html', 'whats-new.html']);
    for (const name of linked) expect(committed.has(name), name).toBe(true);
    expect(siteProblems(committed, context, ['help.html'])).toEqual(['the extension links to help.html, and the site has no such page']);
  });

  it('[UP-012] [UP-010] the install page links the signed XPI of this version in the feed folder and names the oldest Firefox', () => {
    const index = committed.get('index.html') ?? '';
    expect(xpiHref(context)).toBe(`firefox/chatgoose-chatspace-${context.version}.xpi`);
    expect(index).toContain(`data-cg="xpi" href="${xpiHref(context)}"`);
    expect(index).toContain(`<b data-cg="version">${context.version}</b>`);
    expect(index).toContain(`<b data-cg="firefox">${STRICT_MIN_VERSION.split('.')[0]}</b>`);
    // The address the browser will ask for is the one the feed names.
    expect(`${context.target.siteBase}${xpiHref(context)}`).toBe(`${context.target.feedBase}chatgoose-chatspace-${context.version}.xpi`);
  });

  it('every page carries the same sections, marks itself as the current one, and is in Russian', () => {
    for (const page of SITE_PAGES) {
      const html = committed.get(page) ?? '';
      const links = [...html.matchAll(/<a class="nav__link" href="([^"]+)"( aria-current="page")?>/g)].map((match) => [match[1], match[2] !== undefined]);
      expect(links.map(([href]) => href), page).toEqual([...SITE_PAGES]);
      expect(links.filter(([, current]) => current).map(([href]) => href), page).toEqual([page]);
      expect(html, page).toMatch(/[а-яё]{4,}/i);
    }
  });

  it('the logo of every page leads to the common home of the ChatGoose clients, one level above the site', () => {
    expect(HOME_HREF).toBe('../');
    for (const page of SITE_PAGES) {
      const html = committed.get(page) ?? '';
      expect([...html.matchAll(/<a class="nav__brand" href="([^"]*)">/g)].map((match) => match[1]), page).toEqual([HOME_HREF]);
    }
  });

  it('pages published ahead of a release say nothing of a version', () => {
    for (const name of VERSIONLESS_PAGES) {
      const text = committed.get(name) ?? '';
      expect(text, name).not.toMatch(/data-cg=|cg:begin/);
      expect(text, name).not.toContain(context.version);
    }
  });
});

describe('the generated parts of a page', () => {
  const page = [
    '<main>',
    '  <a class="btn" data-cg="xpi" href="firefox/old.xpi">Установить</a>',
    '  <span>Версия <b data-cg="version">0.1.0</b>, Firefox <b data-cg="firefox">100</b></span>',
    '  <!-- cg:begin whats-new -->',
    '  <p>старое</p>',
    '  <!-- cg:end whats-new -->',
    '  <!-- cg:begin changelog -->',
    '  <!-- cg:end changelog -->',
    '</main>',
  ].join('\n');

  it('[UP-006] follow the version: the XPI link, the version, the oldest Firefox', () => {
    const html = renderPage(page, next);
    expect(html).toContain('<a class="btn" data-cg="xpi" href="firefox/chatgoose-chatspace-0.2.0.xpi">Установить</a>');
    expect(html).toContain(`Версия <b data-cg="version">0.2.0</b>, Firefox <b data-cg="firefox">${STRICT_MIN_VERSION.split('.')[0]}</b>`);
    // Rendering what is already rendered changes nothing.
    expect(renderPage(html, next)).toBe(html);
  });

  it('[UP-014] [UP-015] follow the changelog: the current version on «Что нового», every version in the history', () => {
    const html = renderPage(page, next);
    const whatsNew = html.slice(html.indexOf('<!-- cg:begin whats-new -->'), html.indexOf('<!-- cg:end whats-new -->'));
    expect(whatsNew).toContain('  <section class="release" id="v0.2.0">');
    expect(whatsNew).toContain('<h2 class="release__title"><span class="release__version">0.2.0</span> <span class="release__label">12 октября</span></h2>');
    expect(whatsNew).toContain('    <p>Вторая &lt;версия&gt;.</p>');
    expect(whatsNew).not.toContain('старое');
    expect(whatsNew).not.toContain('id="v0.1.0"');
    const history = html.slice(html.indexOf('<!-- cg:begin changelog -->'), html.indexOf('<!-- cg:end changelog -->'));
    expect(history.indexOf('id="v0.2.0"')).toBeGreaterThan(0);
    expect(history.indexOf('id="v0.1.0"')).toBeGreaterThan(history.indexOf('id="v0.2.0"'));
  });

  it('a version without its changelog section, an unknown part or an install link without an address stop the rendering', () => {
    expect(() => renderPage(page, { ...next, version: '0.3.0' })).toThrow(/no «## 0\.3\.0» section/);
    expect(() => renderPage('<!-- cg:begin nothing -->\n<!-- cg:end nothing -->', next)).toThrow(/unknown generated part «nothing»/);
    expect(() => renderPage('<a data-cg="xpi">x</a>', next)).toThrow(/has no href/);
  });
});

describe('what stops the site from being published', () => {
  const withPage = (name: string, change: (html: string) => string): Map<string, string> => new Map([...committed].map(([file, text]) => [file, file === name ? change(text) : text]));
  const problems = (files: Map<string, string>): string[] => siteProblems(files, context, linked);

  it('a bumped version or an edited changelog the pages have not followed', () => {
    const bumped: SiteContext = { ...context, version: '9.9.9', changelog: parseChangelog(`# Что нового\n\n## 9.9.9\n\nНовое.\n\n${readFileSync(join(REPO_ROOT, CHANGELOG_FILE), 'utf8').split('\n').slice(2).join('\n')}`) };
    expect(siteProblems(committed, bumped, linked).sort()).toEqual(['changelog.html', 'index.html', 'whats-new.html'].map((name) => `${name} is behind the version or the changelog — run \`pnpm release site\``));
    // …and `pnpm release site` is exactly what brings them back.
    expect(siteProblems(renderSite(committed, bumped), bumped, linked)).toEqual([]);
  });

  it('a missing page, a stray file', () => {
    expect(problems(new Map([...committed].filter(([name]) => name !== 'guide.html')))).toEqual(['guide.html is missing']);
    expect(problems(new Map([...committed, ['draft.html', '']]))).toEqual(['draft.html is not a file of the site (tools/release/site.ts lists them)']);
  });

  it('anything that is not a static page of ours: a script, a handler, an image, a stylesheet or a link from elsewhere', () => {
    const body = (extra: string) => (html: string) => html.replace('</main>', `${extra}</main>`);
    expect(problems(withPage('guide.html', body('<script>1</script>')))).toEqual(['guide.html: no scripts on the site']);
    expect(problems(withPage('guide.html', body('<p onclick="x()">a</p>')))).toEqual(['guide.html: no inline event handlers']);
    expect(problems(withPage('guide.html', body('<img src="a.png">')))).toEqual(['guide.html: no embedded media (icons are inline SVG)']);
    expect(problems(withPage('guide.html', (html) => html.replace('</head>', '<link rel="preconnect" href="https://fonts.example.test"></head>')))).toEqual(['guide.html: loads https://fonts.example.test from another host']);
    expect(problems(withPage('guide.html', body('<a href="http://example.test/">a</a>')))).toEqual(['guide.html: the link http://example.test/ is not https']);
    expect(problems(withPage('guide.html', body('<a href="https://example.test/">a</a>')))).toEqual(['guide.html: the outside link https://example.test/ needs rel="noopener"']);
    expect(problems(withPage('guide.html', body('<a href="https://example.test/" rel="noopener">a</a>')))).toEqual([]);
    expect(problems(withPage('guide.html', body('<a href="faq.html">a</a>')))).toEqual(['guide.html: the link faq.html leads nowhere']);
    // The common home, one level up, is the only address outside the folder a page links to without a host.
    expect(problems(withPage('guide.html', body('<a href="../">a</a>')))).toEqual([]);
    expect(problems(withPage('guide.html', body('<a href="../desktop/">a</a>')))).toEqual(['guide.html: the link ../desktop/ leads nowhere']);
    expect(problems(withPage('guide.html', (html) => html.replace('<html lang="ru">', '<html>')))).toEqual(['guide.html: must start with <!doctype html> and <html lang="ru">']);
  });

  it('an install page without its link or its version, a release part where no release belongs', () => {
    expect(problems(withPage('index.html', (html) => html.replace(' data-cg="xpi"', '')))).toContain('index.html: exactly one install link (data-cg="xpi") is expected');
    expect(problems(withPage('start.html', (html) => html.replace('</main>', '<b data-cg="version">0.1.0</b></main>')))).toEqual(['start.html: a page that is published ahead of a release must carry nothing of a release']);
  });
});
