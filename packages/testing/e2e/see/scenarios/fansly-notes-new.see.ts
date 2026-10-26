// Fansly «Заметки» of a fan with no questionnaire yet (2026-10-27, the owner: filling it from the chat is the main
// way): the card with «✨ Заполнить из чата» first, «Заполнить вручную» behind it; the stage line; the Goose's draft in
// the questionnaire's table; «Сохранить анкету» creates «Анкета» in one press. Each picture is the panel alone.

import { WORLD } from '../../../src/scenarios/hub';
import { SHOWCASE } from '../../../src/showcase';
import { SEE_AI_TEXTS, around, scenario, showcaseAiTexts, type See } from '../kit';

/** The hub's answer for a fan with no questionnaire: the stand's second fan, or the showcase's Daniel. */
const FILL = (
  SHOWCASE
    ? [
        'Имя: Дэниел',
        '> «Dan is fine, only my mom calls me Daniel»',
        'Локация: Остин, Техас (10.2026)',
        '> «Austin, born and raised»',
        'Возраст: 38',
        'Работа: тренер в спортзале (10.2026)',
        'График: пишет по утрам, до тренировок',
        '> «morning gorgeous ☀️»',
        'Хобби: спортзал; кофе',
        'Планы и даты: день рождения 14 ноября',
        '> «my bday is nov 14 btw»',
        'Фетиши: =',
        'Характеристика: шутит, любит, когда отвечают быстро',
        'Медиа: купил два сета за неделю (10.2026)',
        'Другое: =',
      ]
    : [
        'Имя: Маркус',
        '> «call me Marcus»',
        'Локация: Техас, Остин (10.2026)',
        '> «Austin, born and raised»',
        'Возраст: 41',
        'Работа: инженер в нефтяной компании, часто в разъездах (10.2026)',
        '> «back on the rig next week»',
        'График: пишет по ночам, когда на вахте',
        'Хобби: рыбалка; барбекю',
        'Планы и даты: день рождения 14 ноября',
        '> «my bday is nov 14 btw»',
        'Фетиши: =',
        'Характеристика: щедрый, любит комплименты',
        'Медиа: =',
        'Другое: =',
      ]
).join('\n');

async function panel(s: See, name: string): Promise<void> {
  await s.shot(name, { clip: around([await s.rect('panel', '.cg-notes')], 12) });
}

scenario(
  'fansly-notes-new',
  async (s) => {
    await s.ready();
    await s.keys(s.MOD, s.Key.Shift, 'k');
    await s.see('panel', /Анкеты пока нет/);
    await s.wait(300);
    await panel(s, 'new-side');
    await (await s.h.ours('panel', 'button[aria-label="Где показывать"]')).click();
    await s.press('Окно по центру', 'panel');
    await s.wait(400);
    await panel(s, 'new-none');
    await s.press(/^Заполнить вручную/, 'panel');
    await s.wait(300);
    await panel(s, 'new-manual');
    await s.hub.command({ op: 'config', patch: { aiChunkDelayMs: 120 } });
    await s.press(/Заполнить из чата/, 'panel');
    await s.see('panel', /Читаю переписку|Заполняю анкету/);
    await s.wait(600);
    await panel(s, 'new-running');
    await s.see('panel', /Лишнее уберите/, 60_000);
    await s.wait(400);
    await panel(s, 'new-found');
    await s.press(/^Сохранить анкету/, 'panel', '[data-notes-apply]');
    await s.see('panel', /Дополнить из чата/);
    await s.wait(600);
    await panel(s, 'new-written');
  },
  {
    sites: ['fansly'],
    viewport: { width: 1440, height: 1000 },
    fanslyGroup: WORLD.fansly.chats.b.group,
    before: async ({ hub, site }) => {
      await hub.command({ op: 'config', patch: { aiTexts: { ...(SHOWCASE ? showcaseAiTexts(site) : SEE_AI_TEXTS), 'fan-notes-fill': FILL } } });
    },
  },
);
