// The toolbar popup as Firefox itself shows it: a panel under the extension's
// button. WebDriver cannot reach that frame, so the other specs open
// `popup.html` in a tab (support/pages.ts) — and a tab is as wide as the
// window, whatever the document asks for. The panel is not: Firefox makes it
// as wide as the document's own preferred width (`getContentSize`), so a
// document whose preferred width is 0 opens as a line. Only the browser's
// chrome can press the button and measure the panel (geckodriver
// --allow-system-access, wdio.conf.ts).

import { mkdirSync, writeFileSync } from 'node:fs';

import { browser } from '@wdio/globals';

import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { inChrome } from './background';
import { TEST_GECKO_ID } from './constants';

/** The size Firefox gave the popup's frame, CSS px; `open` — its panel is on the screen. */
export interface PanelSize {
  readonly open: boolean;
  readonly width: number;
  readonly height: number;
}

/** Where the button stands: pinned to the toolbar, or in the extensions menu (where a new add-on's button starts). */
export type ButtonArea = 'toolbar' | 'menu';

const WIDGET = `const widgetOf = (id) => id.toLowerCase().replace(/[^a-z0-9_-]/g, '_') + '-browser-action';`;
/** The popup's frame of this add-on in the window: Firefox keeps a preloaded one aside, the shown one is in a panel. */
const FRAME = `const frameOf = (id) => {
  const uuid = WebExtensionPolicy.getByID(id).mozExtensionHostname;
  return [...document.querySelectorAll('browser.webextension-popup-browser')].find((frame) => frame.closest('panel') !== null && String(frame.currentURI?.spec ?? '').includes(uuid)) ?? null;
};`;

async function chrome<T>(body: string, ...args: unknown[]): Promise<T> {
  const answer = await inChrome((driver) =>
    driver.executeAsyncScript(
      `const done = arguments[arguments.length - 1]; const args = Array.prototype.slice.call(arguments, 0, -1);
       ${WIDGET} ${FRAME}
       (async (...args) => { ${body} })(...args).then((value) => done({ ok: true, value }), (error) => done({ ok: false, error: String(error) }));`,
      args,
    ),
  );
  const result = answer as { ok: true; value: T } | { ok: false; error: string };
  if (!result.ok) throw new Error(`the browser's chrome: ${result.error}`);
  return result.value;
}

/** Puts the extension's button on the toolbar (pinned) or back into the extensions menu. */
export async function placeButton(area: ButtonArea, id: string = TEST_GECKO_ID): Promise<void> {
  await chrome(
    `const [id, area] = args;
     const { CustomizableUI } = window;
     CustomizableUI.addWidgetToArea(widgetOf(id), area === 'toolbar' ? CustomizableUI.AREA_NAVBAR : CustomizableUI.AREA_ADDONS);
     return true;`,
    id,
    area,
  );
}

/** Presses the extension's button as a person does; resolves once Firefox has loaded the popup into its panel. */
export async function pressButton(id: string = TEST_GECKO_ID): Promise<void> {
  await chrome(
    `const [id] = args;
     const { CustomizableUI } = window;
     const group = CustomizableUI.getWidget(widgetOf(id));
     const node = group.forWindow(window).node;
     if (!node) throw new Error('the extension has no button in this window');
     const loaded = new Promise((resolve, reject) => {
       const timer = setTimeout(() => reject(new Error('the popup was not loaded into a panel in 15 s')), 15000);
       window.addEventListener('WebExtPopupLoaded', function onLoaded(event) {
         if (event.detail?.extension?.id !== id) return;
         window.removeEventListener('WebExtPopupLoaded', onLoaded, true);
         clearTimeout(timer);
         resolve();
       }, true);
     });
     // In the extensions menu the button is inside a closed panel: the menu opens first, as under a person's click.
     if (group.areaType !== CustomizableUI.TYPE_TOOLBAR) await window.gUnifiedExtensions.togglePanel();
     const button = node.querySelector('.unified-extensions-item-action-button') ?? node.firstElementChild;
     button.click();
     await loaded;
     return true;`,
    id,
  );
}

/** The popup's frame as it stands now. */
export async function readPanel(id: string = TEST_GECKO_ID): Promise<PanelSize> {
  return chrome<PanelSize>(
    `const [id] = args;
     const frame = frameOf(id);
     if (frame === null) return { open: false, width: 0, height: 0 };
     const box = frame.getBoundingClientRect();
     return { open: frame.closest('panel').state === 'open', width: Math.round(box.width), height: Math.round(box.height) };`,
    id,
  );
}

/** Waits until the panel is open and its size has stopped changing (the popup grows as its data arrives). */
export async function settledPanel(id: string = TEST_GECKO_ID, timeout = 15_000): Promise<PanelSize> {
  let last: PanelSize = { open: false, width: 0, height: 0 };
  let sameSince = 0;
  try {
    await browser.waitUntil(
      async () => {
        const now = await readPanel(id);
        if (!now.open || now.width !== last.width || now.height !== last.height) sameSince = Date.now();
        last = now;
        return now.open && Date.now() - sameSince >= 1000;
      },
      { timeout, interval: 100 },
    );
  } catch {
    throw new Error(`the popup's panel did not settle in ${timeout} ms: ${JSON.stringify(last)}`);
  }
  return last;
}

/**
 * A picture of the popup as the panel shows it, into .cache/e2e/ — to look at with one's own eyes. The frame
 * draws itself (WebDriver's screenshot is of the tab; the panel is a window of its own).
 */
export async function capturePanel(name: string, id: string = TEST_GECKO_ID): Promise<string> {
  const png = await chrome<string>(
    `const [id] = args;
     const frame = frameOf(id);
     if (frame === null) throw new Error('the popup is not in a panel');
     const bitmap = await frame.browsingContext.currentWindowGlobal.drawSnapshot(null, 2, 'transparent');
     const canvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
     canvas.width = bitmap.width;
     canvas.height = bitmap.height;
     canvas.getContext('2d').drawImage(bitmap, 0, 0);
     return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);`,
    id,
  );
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  const path = `${E2E_EVIDENCE_DIR}${name}.png`;
  writeFileSync(path, Buffer.from(png, 'base64'));
  return path;
}

/** Closes the popup's panel (and the extensions menu, if the popup was opened from it). */
export async function closePanel(): Promise<void> {
  await chrome(
    `for (const panel of document.querySelectorAll('panel')) if (panel.state === 'open' || panel.state === 'showing') panel.hidePopup();
     return true;`,
  );
}
