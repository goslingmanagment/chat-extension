// «Заметки»: the fan's old account (2026-10-29, the owner: «старые заметки… надо бы импортировать»). The fan of the
// stand's first chat has the team's Monster notes (a questionnaire of «Поле: значение» lines and the section notes);
// the second chat is the same person's new account, with none. In the old chat «Перенести на новый аккаунт фана»
// copies them; in the new one the card offers them, «Вставить сюда» creates the notes there and puts the old
// questionnaire's facts in the rows, «Принять все» writes them. `--site fansly`: the stand's first chat has the
// Fansly notes, the second is the new account; the same panel.

import { createWorld } from '../../../fixture-fansly/src/data';
import { STAND_IDS } from '../../../src/stand/dataset';
import { PAGE, WORLD } from '../../../src/scenarios/hub';
import { callFansly, fakeFansly } from '../../support/fansly-stand';
import { callStand } from '../../support/stand';
import { SEE_AI_TEXTS, around, scenario, type See } from '../kit';

const ACC = STAND_IDS.accounts.a;
const NEW = STAND_IDS.fans.a2;
/** The Fansly stand's first fan: the old account, with the team's notes. */
const FANSLY_OLD = createWorld().groups[0]?.fan.id ?? '';
const DAY = 86_400_000;

/** The panel alone, a little room around it. */
async function panel(s: See, name: string): Promise<void> {
  await s.shot(name, { clip: around([await s.rect('panel', '.cg-notes')], 12) });
}

/** Opens the notes of the chat on the route: the button in ChatSpace's header, ⌘⇧K on Fansly. */
async function openNotes(s: See): Promise<void> {
  if (s.site === 'fansly') {
    await s.keys(s.MOD, s.Key.Shift, 'k');
    return;
  }
  const slot = s.browser.$('[data-host="header-slot"]');
  await slot.waitForExist({ timeout: 20_000 });
  const button = slot.shadow$('.cg-nb__button');
  await button.waitForDisplayed({ timeout: 20_000 });
  await button.click();
}

scenario(
  'notes-transfer',
  async (s) => {
    await s.ready();
    if (s.site === 'chatspace') await callStand('setSidePanel', 'open');
    await openNotes(s);
    await s.see('panel', /Анкета/);
    await s.wait(400);
    // The old account: its notes, and «Перенести на новый аккаунт фана» under them.
    await (await s.h.ours('panel', '.cg-notes__transfer-foot')).scrollIntoView({ block: 'end' });
    await s.wait(300);
    await panel(s, 'old-account');
    await s.press(/^Перенести на новый аккаунт/, 'panel');
    await s.see('panel', /Скопировано/);
    await (await s.h.ours('panel', '[data-notes-transfer]')).scrollIntoView({ block: 'start' });
    await s.wait(400);
    await panel(s, 'copied');

    // The new account's chat: nothing of its own, the copy offered.
    if (s.site === 'fansly') {
      await callFansly('open', WORLD.fansly.chats.b.group, 'link');
      await s.wait(1500);
      await s.press(/^Обновить/, 'panel').catch(() => undefined);
    } else await s.openChat(NEW);
    await s.wait(1200);
    await s.see('panel', /Вставить сюда/, 20_000);
    await s.wait(400);
    await panel(s, 'offer');
    await s.press(/^Вставить сюда/, 'panel');
    await s.see('panel', /Со старого аккаунта/, 20_000);
    await s.wait(800);
    await panel(s, 'pasted');
    await s.press(/^Принять все/, 'panel');
    await s.see('panel', /Анкета создана/, 20_000);
    await s.wait(800);
    await panel(s, 'written');
    await (await s.h.ours('panel', '.cg-notes__list')).scrollIntoView({ block: 'start' });
    await s.wait(300);
    await panel(s, 'notes-moved');
    if (s.site === 'chatspace') {
      const kept = await s.stand.notes(ACC, NEW);
      console.log(`cg-see new account notes: ${kept.map((note) => `${String(note['id'])}:${String(note['title'] ?? '')}`).join(', ')}`);
    }
  },
  {
    sites: ['chatspace', 'fansly'],
    viewport: { width: 1440, height: 1000 },
    timeout: 240_000,
    before: async ({ hub, site }) => {
      await hub.command({ op: 'config', patch: { aiTexts: SEE_AI_TEXTS, pageFlags: { [PAGE]: { notes: true, notesFill: true } } } });
      if (site !== 'fansly') return;
      // What the team keeps on Fansly about the old account: the questionnaire and two notes signed by their authors.
      const note = (title: string, text: string, days: number) => fakeFansly().command({ op: 'note', fanId: FANSLY_OLD, title, note: text, createdAt: Date.now() - days * DAY });
      await note('Анкета', 'Имя: Маркус\nЛокация: Техас, Остин\nВозраст: 41\nРабота: инженер на буровой\nХобби: рыбалка; барбекю\nФетиши: \nДругое: ', 12);
      await note('kate', 'берёт видео, фото не любит', 9);
      await note('max', 'просил не писать по воскресеньям', 4);
    },
  },
);
