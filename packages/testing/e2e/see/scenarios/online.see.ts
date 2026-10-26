// «Онлайн» — who of the page came online, why to write to each now, one click per fan (2026-10-26), on both sites:
// «Онлайн N» on the bar; the window with the fans by why (who waits for an answer first) and the first fan's card with
// their conversation and «Reply · Hi · Ping · Шаблон», nothing written (2026-10-26); the advised one pressed — the text;
// «Отправить →» — the next fan's card opens by itself, again with nothing written; «Пропустить»; «Все онлайн» with the
// set aside and the reasonless; a fan with nothing to write about.

import { SEE_AI_TEXTS, scenario, showcaseAiTexts, type See } from '../kit';

/** Texts that fit any fan of the list: the stand's hub writes no prose, and «Онлайн» shows several fans' texts at once. */
const ONLINE_TEXTS = {
  'fast-reply': 'haha poor you 😅 I’m just lying in bed thinking about you… what are you up to tonight?',
  ping: 'hey you 👋 I was just scrolling through our old chats and smiled. how have you been?',
} as const;

/** The card's advised «Reply» / «Hi» / «Ping» / «Шаблон» (else the first one it offers) pressed, and its text waited for. */
async function write(s: See): Promise<void> {
  await s.browser.waitUntil(() => s.has('modal', '[data-cg-online-pick] .cg-btn'), { timeout: 30_000, interval: 300, timeoutMsg: 'the card offers nothing to write' });
  const advised = (await s.has('modal', '[data-cg-online-pick] .cg-btn.is-advice:not([aria-disabled="true"])')) ? '.is-advice' : ':not([aria-disabled="true"])';
  await s.h.ours('modal', `[data-cg-online-pick] .cg-btn${advised}`).click();
  await s.browser.waitUntil(() => s.has('modal', '[data-cg-zone="draft"], [data-cg-zone="unwritten"]'), { timeout: 60_000, interval: 300, timeoutMsg: 'the card has no text' });
}

/** The pointer off our window before a picture: no tooltip of the last press stands in it. */
async function shot(s: See, name: string): Promise<void> {
  await s.browser.action('pointer').move({ x: 2, y: 2, origin: 'viewport' }).perform();
  await s.browser.pause(300);
  await s.shot(name);
}

scenario(
  'online',
  async (s) => {
    await s.ready();
    await s.hub.command({ op: 'config', patch: { aiTexts: { ...(s.showcase ? showcaseAiTexts(s.site) : SEE_AI_TEXTS), ...ONLINE_TEXTS } } });
    if (s.site === 'fansly') await s.browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
    else await s.leaveField();

    // The bar's «Онлайн N»: the fans of the page worth a message now, the hub's count.
    await s.browser.waitUntil(() => s.has('dock', '.cg-act__n'), { timeout: 30_000, interval: 300, timeoutMsg: 'no «Онлайн N» on the bar' });
    await shot(s, 'online-bar');

    // The window: the first fan to write to opens with their card and the choice of what to write, nothing written.
    await s.press(/Онлайн/, 'dock', '.cg-strip button');
    await s.see('modal', 'К разбору', 20_000);
    await s.browser.waitUntil(() => s.has('modal', '[data-cg-zone="idle"] [data-cg-online-pick]'), { timeout: 30_000, interval: 300, timeoutMsg: 'the first card offers no choice' });
    await s.browser.pause(1_500);
    await shot(s, 'online-window');
    // The advised one pressed: its text.
    await write(s);
    await s.browser.pause(600);
    await shot(s, 'online-text');

    // The stand's open chat and its fan who takes no messages say why they cannot be sent to: J to a fan who can.
    for (let i = 0; i < 6 && !(await s.has('modal', '.cg-ow__csend:not([aria-disabled="true"])')); i += 1) {
      await s.browser.keys('j');
      await s.browser.pause(900);
      if (await s.has('modal', '[data-cg-zone="idle"]')) await write(s);
      await s.browser.pause(600);
    }
    // «Отправить →»: one message to this fan; a moment later the next fan's card.
    await s.press(/^Отправить/, 'modal', '.cg-ow__csend');
    await s.browser.waitUntil(() => s.has('modal', '[data-cg-zone="sent"]'), { timeout: 30_000, interval: 200, timeoutMsg: 'the text did not go' });
    await shot(s, 'online-sent');
    await s.browser.waitUntil(async () => !(await s.has('modal', '[data-cg-zone="sent"]')), { timeout: 10_000, interval: 200, timeoutMsg: 'the next card did not open' });
    // The next card: nothing written there by itself (a text the person had written for that fan before stays).
    await s.browser.waitUntil(() => s.has('modal', '[data-cg-zone="idle"], [data-cg-zone="draft"]'), { timeout: 30_000, interval: 300, timeoutMsg: 'the next card did not open' });
    await s.browser.pause(1_000);
    await shot(s, 'online-next');

    // «Пропустить» (S): this pass only; the card after it.
    await s.press(/^Пропустить/, 'modal', '.cg-ow__acts .cg-btn');
    await s.browser.pause(900);
    await shot(s, 'online-skipped');

    // «Все онлайн»: the set aside and the reasonless too; a fan with nothing to write about offers the same choice.
    await s.press(/^Все онлайн/, 'modal', '.cg-nw__tab');
    await s.browser.pause(500);
    await shot(s, 'online-all');
    if (await s.has('modal', '[data-cg-online-group="none"]')) {
      await s.h.ours('modal', '[data-cg-online-group="none"] [data-cg-online-row]').click();
      await s.browser.pause(900);
      await shot(s, 'online-none');
    }
  },
  { sites: ['chatspace', 'fansly'], previewSend: true },
);
