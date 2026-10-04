// Our own UI on the page, reached the way a person reaches it. Every surface
// of ours lives in a closed shadow root (architecture.md §6.3), which a
// script of the page cannot open — but WebDriver's «Get Element Shadow Root»
// returns the root of an element whatever its mode (Firefox: the classic
// protocol, which wdio's `shadow$` uses first). So the e2e finds our buttons,
// rows and fields as elements and presses them with real WebDriver actions:
// trusted events through the page's own dispatch, exactly what the action
// gate asks for (§14). Nothing here calls into the extension.

import { $, browser } from '@wdio/globals';

/** Where a surface of ours is mounted: the dock above the composer, or an overlay layer of <html>. */
export type Where = 'dock' | 'panel' | 'modal' | 'toast';

const HOSTS: Readonly<Record<Where, string>> = {
  dock: '[data-cg="dock"]',
  panel: '[data-cg="overlay"][data-cg-layer="panel"]',
  modal: '[data-cg="overlay"][data-cg-layer="modal"]',
  toast: '[data-cg="overlay"][data-cg-layer="toast"]',
};

export const hostSelector = (where: Where): string => HOSTS[where];

/** One element of ours by a CSS selector inside the closed root. */
export const ours = (where: Where, selector: string) => $(HOSTS[where]).shadow$(selector);
/** Every element of ours that matches. */
export const allOurs = (where: Where, selector: string) => $(HOSTS[where]).shadow$$(selector);

/** Whether an element of ours matching the selector is there now (false too while nothing of ours is mounted there). */
export async function oursExists(where: Where, selector: string): Promise<boolean> {
  const host = $(HOSTS[where]);
  if (!(await host.isExisting())) return false;
  return host.shadow$(selector).isExisting();
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The first element matching `selector` whose rendered text is `text` (or matches it); null — none on screen. */
export async function oursByText(where: Where, selector: string, text: string | RegExp): Promise<WebdriverIO.Element | null> {
  const host = $(HOSTS[where]);
  if (!(await host.isExisting())) return null;
  for (const element of await host.shadow$$(selector).getElements()) {
    let shown: string;
    try {
      shown = squash(await element.getText());
    } catch {
      continue; // re-rendered under us
    }
    if (typeof text === 'string' ? shown === text : text.test(shown)) return element;
  }
  return null;
}

/** Waits for that element and returns it. */
export async function waitOursByText(where: Where, selector: string, text: string | RegExp, message: string, timeout = 10_000): Promise<WebdriverIO.Element> {
  let found: WebdriverIO.Element | null = null;
  try {
    await browser.waitUntil(
      async () => {
        found = await oursByText(where, selector, text);
        return found !== null;
      },
      { timeout, interval: 100 },
    );
  } catch {
    throw new Error(`${message}: no «${String(text)}» among ${selector} of ${where} in ${timeout} ms; it shows: ${(await oursText(where)).slice(0, 600)}`);
  }
  return found as unknown as WebdriverIO.Element;
}

/** Presses the element with that text: a real click, in the middle of it. */
export async function pressOurs(where: Where, selector: string, text: string | RegExp, message = `press «${String(text)}»`, timeout = 10_000): Promise<void> {
  const element = await waitOursByText(where, selector, text, message, timeout);
  await element.click();
}

/** What a surface of ours shows, as text (whitespace squashed); '' — nothing mounted there. */
export async function oursText(where: Where, selector = '.cg-root'): Promise<string> {
  const host = $(HOSTS[where]);
  if (!(await host.isExisting())) return '';
  const texts: string[] = [];
  for (const element of await host.shadow$$(selector).getElements()) {
    try {
      // `textContent`, not getText(): what is drawn below the fold of a scrolled list counts too.
      texts.push(squash(await browser.execute((node: HTMLElement) => node.textContent ?? '', element as unknown as HTMLElement)));
    } catch {
      // re-rendered under us
    }
  }
  return texts.join(' ¶ ');
}

/** Waits until the surface shows (or stops showing) a text. */
export async function waitOursText(where: Where, text: string | RegExp, message: string, options: { readonly timeout?: number; readonly gone?: boolean; readonly selector?: string } = {}): Promise<string> {
  const timeout = options.timeout ?? 10_000;
  let last = '';
  const has = (): boolean => (typeof text === 'string' ? last.includes(text) : text.test(last));
  try {
    await browser.waitUntil(
      async () => {
        last = await oursText(where, options.selector);
        return has() !== (options.gone === true);
      },
      { timeout, interval: 100 },
    );
  } catch {
    throw new Error(`${message}: ${where} ${options.gone === true ? 'still shows' : 'never showed'} «${String(text)}» in ${timeout} ms; it shows: ${last.slice(0, 800)}`);
  }
  return last;
}

/** The markup of a surface of ours without its style sheets (for a failure's report and for the visual notes). */
export async function oursHtml(where: Where): Promise<string> {
  const host = $(HOSTS[where]);
  if (!(await host.isExisting())) return '';
  const any = host.shadow$('*');
  if (!(await any.isExisting())) return '';
  return browser.execute(
    (node: HTMLElement) =>
      [...(node.getRootNode() as ShadowRoot).children]
        .filter((child) => child.tagName !== 'STYLE')
        .map((child) => child.outerHTML)
        .join('\n'),
    (await any.getElement()) as unknown as HTMLElement,
  );
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The viewport box of an element of ours; null — not on screen. */
export async function oursBox(where: Where, selector: string): Promise<Box | null> {
  const element = ours(where, selector);
  if (!(await element.isExisting())) return null;
  return browser.execute(
    (node: HTMLElement) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    },
    (await element.getElement()) as unknown as HTMLElement,
  );
}

/** What has the keyboard focus inside a surface of ours: its tag, role, label and text; null — the focus is elsewhere. */
export async function oursFocus(where: Where): Promise<{ readonly tag: string; readonly role: string | null; readonly label: string | null; readonly text: string } | null> {
  const focused = ours(where, ':focus');
  if (!(await focused.isExisting())) return null;
  return browser.execute(
    (node: HTMLElement) => ({ tag: node.tagName.toLowerCase(), role: node.getAttribute('role'), label: node.getAttribute('aria-label'), text: (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) }),
    (await focused.getElement()) as unknown as HTMLElement,
  );
}

/** WebDriver's own commands, one round trip each; wdio's element wrappers wait and retry around them. */
interface Classic {
  findElement(using: string, value: string): Promise<Record<string, string>>;
  getElementShadowRoot(elementId: string): Promise<Record<string, string>>;
  findElementsFromShadowRoot(shadowId: string, using: string, value: string): Promise<Array<Record<string, string>>>;
  elementClick(elementId: string): Promise<void>;
}

const idOf = (reference: Record<string, string>): string => Object.values(reference)[0] ?? '';
/** The closed roots already asked for, by browser session and host: a host of ours is one element for the life of its page. */
const roots = new Map<string, string>();

/**
 * Presses the first element of ours matching `selector` as it stands at this very moment — no waiting for it
 * to appear, to settle or to become clickable, the way a person in a hurry clicks. False — nothing was there
 * to press, or it went away under the pointer.
 */
export async function pressOursNow(where: Where, selector: string): Promise<boolean> {
  const classic = browser as unknown as Classic;
  const key = `${browser.sessionId}:${where}`;
  for (const attempt of [0, 1]) {
    try {
      let root = roots.get(key);
      if (root === undefined) {
        root = idOf(await classic.getElementShadowRoot(idOf(await classic.findElement('css selector', HOSTS[where]))));
        roots.set(key, root);
      }
      const found = await classic.findElementsFromShadowRoot(root, 'css selector', selector);
      const first = found[0];
      if (first === undefined) return false;
      await classic.elementClick(idOf(first));
      return true;
    } catch (error) {
      // A page that was reloaded has new hosts: ask once more. Anything else is a miss.
      const stale = /detached shadow root|no such shadow root|stale element|no such element/i.test(String(error));
      if (attempt === 0 && stale && roots.delete(key)) continue;
      return false;
    }
  }
  return false;
}
