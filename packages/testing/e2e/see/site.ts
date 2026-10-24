// `s.web` (tools/see/README.md, «Recipes»): verbs for the site itself, not our UI — what an agent studying fansly.com
// needs and would otherwise rediscover each time: a click by visible text, Fansly's popups, a navigation whose load
// never ends, text with emoji (WebDriver cannot type it), Fansly's styled selects, its hidden file inputs, its API
// with the page's own session, and the page's traffic (live.ts) cut and saved. Generic DOM helpers work on the stand
// too; `api`, `headers` and the traffic are the live site's.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { $, $$, browser } from '@wdio/globals';

import { headerRecords, LIVE, netRecords, type HeaderRecord, type NetRecord } from './live';

export interface SiteVerbs {
  /** Clicks the shown element whose own text is `text` (or its parent, its grandparent); throws when there is none. */
  click(text: string): Promise<void>;
  /** The same; false instead of throwing (a popup that may not be there). */
  maybe(text: string): Promise<boolean>;
  /** Clicks the button an icon stands for (`s.web.icon('fa-clock')` — the schedule; Fansly's buttons are often icons only). */
  icon(className: string): Promise<void>;
  /** Fansly's popups, once a profile: the age gate, the cookie banner, «Maybe Later». */
  dismiss(): Promise<void>;
  /** Opens a path of the site; a load that never ends (Fansly's long polls) is no failure; then `dismiss()`. */
  go(path: string): Promise<void>;
  /** Text into a field through the page's own input event: emoji and all. */
  fill(selector: string, text: string): Promise<void>;
  /** A `<select>`'s value through the page's own change event (Fansly's styled selects refuse WebDriver's). */
  pick(selector: string, value: string): Promise<void>;
  /**
   * Files into a hidden file input: by default the last one on the page (the post form's, or an open upload window's
   * «add more»); a preview goes into its media's own input, `'.modal .media-container input[type=file]'`.
   */
  attach(paths: readonly string[], selector?: string): Promise<void>;
  /** Fansly's API from the page with the page's own session (`?ngsw-bypass=true` added); the body parsed when it is JSON. */
  api(path: string, init?: { readonly method?: string; readonly body?: unknown }): Promise<{ readonly status: number; readonly body: unknown }>;
  /** Where the page's traffic stands now, for `since`, `waitNet`, `save`. */
  mark(): number;
  /** The page's requests and socket frames since a mark, only those whose URL matches when one is given. */
  since(mark: number, url?: RegExp): NetRecord[];
  /** Waits for a request since the mark whose URL matches (and passes `test`); returns it. */
  waitNet(mark: number, url: RegExp, test?: (record: NetRecord) => boolean, timeoutMs?: number): Promise<NetRecord>;
  /** Saves `since(mark, url)` beside the run's pictures as `<name>.json`; returns the path. */
  save(name: string, mark: number, url?: RegExp): string;
  /** Request and response headers of Fansly's hosts and of its storage (S3), preflights included; auth, cookies and the session id blanked. */
  readonly headers: readonly HeaderRecord[];
}

const own = (text: string): string => `//*[normalize-space(.)="${text}"][not(*[normalize-space(.)="${text}"])]`;

async function clickByText(text: string): Promise<boolean> {
  for (const xpath of [own(text), `${own(text)}/..`, `${own(text)}/../..`]) {
    for (const target of await $$(xpath)) {
      if ((await target.isDisplayed()) && (await target.isClickable())) {
        await target.click();
        await browser.pause(500);
        return true;
      }
    }
  }
  return false;
}

const liveOnly = (what: string): void => {
  if (!LIVE) throw new Error(`s.web.${what}() is the live site's (pnpm see … --live / --bare)`);
};

export function makeSite(out: string): SiteVerbs {
  const site: SiteVerbs = {
    async click(text) {
      if (!(await clickByText(text))) throw new Error(`no shown, clickable «${text}»`);
    },
    maybe: (text) => clickByText(text),
    async icon(className) {
      for (const icon of await $$(`i.${className}`)) {
        if (!(await icon.isDisplayed())) continue;
        await browser.execute((element: HTMLElement) => ((element.closest('button, .btn, [class*="pointer"]') ?? element.parentElement ?? element) as HTMLElement).click(), icon as unknown as HTMLElement);
        await browser.pause(800);
        return;
      }
      throw new Error(`no shown icon .${className}`);
    },
    async dismiss() {
      for (const text of ['Enter', 'Essential Only', 'Maybe Later']) await clickByText(text);
    },
    async go(path) {
      await browser.url(new URL(path, 'https://fansly.com').toString()).catch((error: unknown) => {
        if (!/timed out|timeout/i.test(String(error))) throw error;
      });
      await browser.pause(2500);
      await site.dismiss();
    },
    async fill(selector, text) {
      await (await $(selector)).waitForExist({ timeout: 10_000 });
      await browser.execute(
        (target: string, value: string) => {
          const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(target);
          if (field === null) throw new Error(`no ${target}`);
          field.focus();
          field.value = value;
          field.dispatchEvent(new Event('input', { bubbles: true }));
        },
        selector,
        text,
      );
    },
    async pick(selector, value) {
      await browser.execute(
        (target: string, wanted: string) => {
          const select = document.querySelector<HTMLSelectElement>(target);
          if (select === null) throw new Error(`no ${target}`);
          select.value = wanted;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        },
        selector,
        value,
      );
    },
    async attach(paths, selector) {
      const marked = await browser.execute((target: string | null) => {
        const inputs = [...document.querySelectorAll<HTMLInputElement>(target ?? 'input[type=file]')];
        const input = target === null ? inputs.at(-1) : inputs[0];
        if (input === undefined) return false;
        input.style.display = 'block';
        input.style.width = '10px';
        input.style.height = '10px';
        input.setAttribute('data-cg-attach', '1');
        return true;
      }, selector ?? null);
      if (!marked) throw new Error(`no file input ${selector ?? ''}`.trim());
      await (await $('input[data-cg-attach="1"]')).setValue(paths.join('\n'));
      await browser.execute(() => {
        const input = document.querySelector<HTMLInputElement>('input[data-cg-attach="1"]');
        if (input !== null) {
          input.style.display = 'none';
          input.removeAttribute('data-cg-attach');
        }
      });
      await browser.pause(1500);
    },
    async api(path, init = {}) {
      liveOnly('api');
      return browser.execute(
        async (target: string, method: string, body: string | null) => {
          const token = (JSON.parse(localStorage.getItem('session_active_session') ?? '{}') as { token?: string }).token ?? '';
          const url = `https://apiv3.fansly.com/api/v1${target}${target.includes('?') ? '&' : '?'}ngsw-bypass=true`;
          const response = await fetch(url, { method, headers: { authorization: token, 'content-type': 'application/json' }, ...(body === null ? {} : { body }) });
          const text = await response.text();
          let parsed: unknown = text;
          try {
            parsed = JSON.parse(text);
          } catch {
            // not JSON: the text as it came
          }
          return { status: response.status, body: parsed };
        },
        path,
        init.method ?? 'GET',
        init.body === undefined ? null : JSON.stringify(init.body),
      );
    },
    mark: () => netRecords.length,
    since: (mark, url) => netRecords.slice(mark).filter((record) => url === undefined || url.test(record.url)),
    async waitNet(mark, url, test = () => true, timeoutMs = 60_000) {
      let found: NetRecord | undefined;
      await browser.waitUntil(async () => (found = site.since(mark, url).find(test)) !== undefined, { timeout: timeoutMs, interval: 500, timeoutMsg: `no request ${String(url)} in ${timeoutMs / 1000} s` });
      return found as NetRecord;
    },
    save(name, mark, url) {
      const path = join(out, `${name.replace(/[^\w.-]+/g, '-')}.json`);
      writeFileSync(path, `${JSON.stringify(site.since(mark, url), null, 2)}\n`);
      return path;
    },
    get headers() {
      return headerRecords;
    },
  };
  return site;
}
