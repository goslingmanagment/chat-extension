// waiting: «Ждут вас» (hub #1232, #1225): the toolbar icon's number and the popup's line over «Мои смены» with 0, 1 and
// 5 matters on the fake hub, then a shift not handed in: the button reads «Сдать смену» and opens that shift's screen
// through the one-time link. The icon's number comes first from the beat alone (no popup asked yet); its text is read
// from the browser itself (`action.getBadgeText`) on an extension page and printed (`cg-see badge …`), and the toolbar
// is pictured from the chrome context. `hub-calls.json` holds each `authWebLink` with its `next`.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type FakeMatter } from '../../../src/fake-hub/types';
import { inChrome } from '../../support/background';
import { TEST_GECKO_ID } from '../../support/constants';
import { openPopup, press, waitForPopup } from '../../support/pages';
import { scenario, type See } from '../kit';

const HOUR = 3_600_000;
const ONE: readonly FakeMatter[] = [{ kind: 'agent.reminder', title: 'Генгар: ответьте в «Обучалке» про смену 10 нояб.', openedAgoMs: 9 * HOUR }];
const FIVE: readonly FakeMatter[] = [
  { kind: 'custom.paid_not_delivered', title: 'Кастом оплачен, не отдан: фото в красном, до пятницы', link: '/workboard/customs', openedAgoMs: 50 * HOUR },
  ...ONE,
  { kind: 'agent.reminder', title: 'Генгар: фан ждёт ответа на вопрос о цене', openedAgoMs: 4 * HOUR },
  { kind: 'agent.reminder', title: 'Генгар: заполните заметку о новом фане', openedAgoMs: 2 * HOUR },
  { kind: 'agent.reminder', title: 'Генгар: проверьте личное сообщение от владельца', openedAgoMs: HOUR },
];
const SHIFT: FakeMatter = { kind: 'shift.report.missing', title: 'Сдайте смену 11 нояб., 18:14–02:36', link: '/workboard/my/shifts/4127', openedAgoMs: 3 * HOUR };

/** The icon's text as the browser holds it ('' — no number), read on the extension page in front. */
async function badge(s: See): Promise<string> {
  return s.browser.execute(() => (globalThis as unknown as { browser: { action: { getBadgeText(details: object): Promise<string> } } }).browser.action.getBadgeText({}));
}

/**
 * The browser's toolbar around our icon, as Firefox draws it (the chrome context): the icon is pinned to the toolbar
 * first (in this run's profile only, as a person pins it), then the toolbar's right end is cut out beside the run's
 * pictures.
 */
async function toolbar(s: See, name: string): Promise<void> {
  const shot = await inChrome(async (driver) => {
    const box = (await driver.executeScript(
      `const id = arguments[0].toLowerCase().replace(/[^a-z0-9_-]/g, '_') + '-browser-action';
       if (CustomizableUI.getPlacementOfWidget(id)?.area !== CustomizableUI.AREA_NAVBAR) CustomizableUI.addWidgetToArea(id, CustomizableUI.AREA_NAVBAR);
       const r = document.getElementById(id).getBoundingClientRect();
       return { x: r.x, y: r.y, width: r.width, height: r.height, dpr: window.devicePixelRatio, right: window.innerWidth };`,
      [TEST_GECKO_ID],
    )) as { x: number; y: number; width: number; height: number; dpr: number; right: number };
    const png = await (driver as unknown as { takeScreenshot(): Promise<string> }).takeScreenshot();
    return { box, png };
  });
  const full = join(s.out, `${name}-full.png`);
  writeFileSync(full, Buffer.from(shot.png, 'base64'));
  const { box } = shot;
  const left = Math.max(0, Math.round((box.x - 240) * box.dpr));
  const top = Math.max(0, Math.round((box.y - 10) * box.dpr));
  const width = Math.round((box.right - box.x + 240) * box.dpr);
  const height = Math.round((box.height + 20) * box.dpr);
  execFileSync('sips', ['-c', String(height), String(width), '--cropOffset', String(top), String(left), full, '--out', join(s.out, `${name}.png`)], { stdio: 'ignore' });
  console.log(`cg-see toolbar: ${name}.png`);
}

/** The popup of a signed-in person with the hub's matters as they are now; its picture and the icon's number. */
async function popupWith(s: See, matters: readonly FakeMatter[], name: string): Promise<void> {
  await s.hub.command({ op: 'config', patch: { matters: [...matters] } });
  await s.toPages();
  await openPopup();
  await waitForPopup((state) => state.view === 'ready', 'the popup of a signed-in person');
  // The line comes with the hub's answer a moment after the popup is drawn.
  await s.browser.waitUntil(async () => (await badge(s)) === (matters.length === 0 ? '' : String(matters.length)), { timeout: 10_000, timeoutMsg: `the icon's number is not ${String(matters.length)}` });
  await s.wait(300);
  await s.shot(name);
  const box = await s.rect('page', '.pg-popup');
  if (box !== null) await s.shot(`${name}-alone`, { clip: box });
  console.log(`cg-see badge (${name}): «${await badge(s)}»`);
}

/** Presses a popup button that opens Workboard; the address of the tab it opened, its code hidden. */
async function opened(s: See, label: string): Promise<string> {
  const popup = await s.browser.getWindowHandle();
  const before = await s.browser.getWindowHandles();
  await press(label);
  await s.browser.waitUntil(async () => (await s.browser.getWindowHandles()).length > before.length, { timeout: 20_000, timeoutMsg: `«${label}» opened no tab` });
  const tab = (await s.browser.getWindowHandles()).find((handle) => !before.includes(handle));
  if (tab === undefined) throw new Error(`«${label}»: no new tab`);
  await s.browser.switchToWindow(tab);
  await s.browser.waitUntil(async () => (await s.browser.getUrl()) !== 'about:blank', { timeout: 10_000, timeoutMsg: 'the new tab has no address' });
  const url = (await s.browser.getUrl()).replace(/code=[^&]+/, 'code=<code>');
  await s.browser.closeWindow();
  await s.browser.switchToWindow(popup);
  return url;
}

scenario(
  'waiting',
  async (s) => {
    await s.ready();
    // The first bound tab beats at once: its answer alone sets the number, before any popup asks.
    await s.toPages();
    await s.browser.url(s.page('options.html#status'));
    await s.browser.waitUntil(async () => (await badge(s)) === '1', { timeout: 15_000, timeoutMsg: 'the beat set no number' });
    console.log(`cg-see badge (after the beat, no popup yet): «${await badge(s)}»`);
    await toolbar(s, 'toolbar-1');
    await popupWith(s, [], 'popup-0');
    await toolbar(s, 'toolbar-0');
    await popupWith(s, ONE, 'popup-1');
    await popupWith(s, FIVE, 'popup-5');
    await toolbar(s, 'toolbar-5');
    console.log(`cg-see opened («Ждут вас»): ${await opened(s, 'Ждут вас')}`);
    await popupWith(s, [...FIVE, SHIFT], 'popup-shift');
    await toolbar(s, 'toolbar-6');
    console.log(`cg-see opened («Сдать смену»): ${await opened(s, 'Сдать смену')}`);
    await s.toChat();
  },
  {
    before: async ({ hub }) => {
      await hub.command({ op: 'config', patch: { matters: [...ONE] } });
    },
  },
);
