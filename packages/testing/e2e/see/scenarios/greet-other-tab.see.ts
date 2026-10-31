// greet-other-tab: «Hi» of a greeting reminder about a fan of another page (2026-10-31; Grisha: «иногда hi в уведомлении
// переключает на вторую вкладку с другой страницей … есть какой то индикатор … я теряюсь»), Fansly, the showcase world
// at 2×. The pictures are `other-tab-*.png` in the run's folder.
//
//   pnpm see greet-other-tab --site fansly
//
// - The stand runs one creator, so no reminder there stands in a tab of another page: the reminder with that page's ear
//   and «Hi в sofia-2 ↗», its red third one, and the card its Hi brings (writing, in the field, sent) are the kit
//   gallery's — the same component, Fansly's palette, both themes.
// - The tab a Hi is handed to: a second stand tab gets the background's `greet.start` from the stand page (probe.ts
//   GREET_START_ATTRIBUTE): the card in the corner, Matt's chat open with the greeting in Fansly's field, Fansly's own
//   Send, then «Назад в sofia-1» bringing the first tab forward.

import { WORLD } from '../../../src/scenarios/hub';
import { writeLocalStorage } from '../../support/extension';
import { QUIET_PAGE } from '../../support/fake-hub';
import { FANSLY_MAIN, fakeFansly } from '../../support/fansly-stand';
import { standOrigin } from '../../support/stand';
import { scenario, showcaseAiTexts, type Box, type See } from '../kit';

/** Matt Riley, Sofia Lane's follower in the showcase world (fixture-fansly/src/showcase.ts). */
const MATT = '930000000000000781';
const GREETING = 'hey you 💛 so glad you followed! what caught your eye first?';
/** The labels the pictures name the two pages by (the stand's page is one; the other is only words here). */
const HERE = 'sofia-2';
const FROM = 'sofia-1';

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

/** The pointer off our buttons: no hint over what a picture shows. */
async function restPointer(s: See): Promise<void> {
  await s.browser.action('pointer').move({ x: 2, y: 2 }).perform();
  await s.wait(300);
}

/** What the tab's probe reports (`<html data-cg-spike>`). */
async function report(s: See): Promise<{ readonly rpc?: { readonly tabSessionId?: string | null } }> {
  const raw = await s.browser.execute(() => document.documentElement.getAttribute('data-cg-spike'));
  return raw === null ? {} : (JSON.parse(raw) as { readonly rpc?: { readonly tabSessionId?: string | null } });
}

/** The toast's box (the ear stands above it) once its slide in ended. */
async function toastBox(s: See): Promise<Box> {
  let found: Box | null = null;
  await s.browser.waitUntil(
    async () => {
      const now = await s.rect('toast', '.cg-toast');
      const still = now !== null && found !== null && Math.abs(now.y - found.y) < 0.5 && Math.abs(now.height - found.height) < 0.5;
      found = now;
      return still;
    },
    { timeout: 10_000, interval: 250, timeoutMsg: 'the card kept moving' },
  );
  if (found === null) throw new Error('no card');
  return found;
}

/** One card of the kit gallery's toasts, by its id, with its ear. */
async function galleryCard(s: See, theme: 'light' | 'dark', id: string, file: string): Promise<void> {
  const host = await s.browser.$('[data-host="gallery"]');
  const nodes = (await host.shadow$$('.cg-toast').getElements()) as unknown as HTMLElement[];
  const rect = await s.browser.execute(
    (want: string, ...all: HTMLElement[]) => {
      for (const node of all) node.style.display = node.getAttribute('data-cg-toast') === want ? '' : 'none';
      const node = all.find((each) => each.getAttribute('data-cg-toast') === want);
      if (node === undefined) return null;
      // Clear of the section's title above it: the ear stands on the card's top edge.
      node.style.marginTop = '64px';
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    },
    id,
    ...nodes,
  );
  if (rect === null) throw new Error(`no ${id} in the gallery`);
  await restPointer(s);
  await s.wait(400);
  await s.shot(`${theme}-${id}`, { file: `other-tab-${file}-${theme}`, clip: box(rect.x - 14, rect.y - 36, rect.width + 28, rect.height + 50) });
}

async function gallery(s: See, theme: 'light' | 'dark'): Promise<void> {
  await s.browser.url(`${standOrigin()}/kit-gallery/?host=fansly&theme=${theme}&lang=ru&section=toasts`);
  const host = await s.browser.$('[data-host="gallery"]');
  await host.waitForExist({ timeout: 15_000 });
  await s.browser.waitUntil(async () => (await host.shadow$$('.cg-toast--away').getElements()).length > 0, { timeout: 15_000, timeoutMsg: 'no card of another page in the gallery' });
  await galleryCard(s, theme, 'g1', 'own-page');
  await galleryCard(s, theme, 'g3', 'away');
  await galleryCard(s, theme, 'g4', 'away-red');
  await galleryCard(s, theme, 'a1', 'arrived-writing');
  await galleryCard(s, theme, 'a2', 'arrived-in-field');
  await galleryCard(s, theme, 'a3', 'arrived-sent');
}

scenario(
  'greet-other-tab',
  async (s) => {
    await s.ready();
    // The checks of followers ask the stand's API (bg/fansly/api-probe.ts).
    await s.toPages();
    await s.browser.url(s.page('popup.html'));
    await writeLocalStorage({ 'dev.fanslyApi.origin': fakeFansly().apiOrigin });
    await s.browser.url(s.page(QUIET_PAGE));
    await s.toChat();
    await s.ready();
    const first = await s.browser.getWindowHandle();
    const firstSession = (await report(s)).rpc?.tabSessionId ?? null;
    if (firstSession === null) throw new Error('the first tab has no session');

    // The second tab of the stand: Sofia Lane's inbox with Jamie's chat, as the first.
    await s.browser.newWindow(await s.browser.getUrl(), { type: 'tab' });
    await s.ready();
    await restPointer(s);

    // The reminder's Hi about Matt, pressed in the first tab, handed here with Matt as that reminder showed him (his
    // picture is the fake Fansly's CDN address, drawn by e2e/see/avatars.ts).
    const fan = { label: 'Matt Riley', username: 'matt84', avatarUrl: `https://cdn3.fansly.com/${MATT}/avatar.jpeg`, since: new Date(Date.now() - 11 * 60_000).toISOString() };
    const start = { pageId: WORLD.pages.fansly.pageId, fanRef: MATT, pageLabel: HERE, from: { tabSessionId: firstSession, pageId: WORLD.pages.fansly.pageId + 1, pageLabel: FROM }, fan };
    await s.browser.execute((payload: string) => document.documentElement.setAttribute('data-cg-spike-greet', payload), JSON.stringify(start));
    await s.see('toast', 'Вы во вкладке', 15_000);
    await s.browser.waitUntil(async () => ((await s.browser.$(FANSLY_MAIN.field).getValue().catch(() => '')) as string).trim() !== '', { timeout: 90_000, timeoutMsg: 'the greeting did not land in the field' });
    await s.see('toast', 'Hi в поле', 15_000);
    await restPointer(s);
    await s.wait(600);
    const card = await toastBox(s);
    await s.shot('arrived-in-field', { file: 'other-tab-stand-in-field', clip: box(0, 0, 1440, 900) });
    await s.shot('arrived-in-field-card', { file: 'other-tab-stand-in-field-card', clip: box(card.x - 14, card.y - 38, card.width + 28, card.height + 52) });

    // Fansly's own Send: the fan got the greeting from this chat.
    await (await s.browser.$(FANSLY_MAIN.send)).click();
    await s.see('toast', 'Отправлено', 15_000);
    await restPointer(s);
    await s.wait(600);
    await s.shot('arrived-sent', { file: 'other-tab-stand-sent', clip: box(0, 0, 1440, 900) });

    // «Назад в sofia-1»: the first tab comes forward; this one's card goes, and no «закрыта» is said.
    await s.press(/^Назад в/, 'toast', '.cg-toast__acts button');
    await s.wait(1200);
    const gone = !(await s.has('toast', '.cg-toast'));
    const visible = await s.browser.execute(() => document.visibilityState);
    await s.browser.switchToWindow(first);
    const firstVisible = await s.browser.execute(() => document.visibilityState);
    console.log(`see: after «Назад»: the card gone ${String(gone)}, the second tab ${visible}, the first tab ${firstVisible}`);
    await restPointer(s);
    await s.shot('back', { file: 'other-tab-stand-back', clip: box(0, 0, 1440, 900) });

    await gallery(s, 'light');
    await gallery(s, 'dark');
  },
  {
    sites: ['fansly'],
    showcase: true,
    timeout: 300_000,
    before: async ({ hub }) => {
      // Matt's chat, empty, and the hub's capture of it.
      const created = await fakeFansly().command({ op: 'conversation', fanId: MATT });
      if (created.groupId === undefined) throw new Error('no greeting group');
      await hub.command({ op: 'thread', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: created.groupId, fanRef: MATT });
      await hub.command({ op: 'archiveConversation', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: created.groupId, messages: [] });
      await hub.command({ op: 'config', patch: { aiTexts: { ...showcaseAiTexts('fansly'), 'hi-greeting': GREETING } } });
    },
  },
);
