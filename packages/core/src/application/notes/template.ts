// «+ Анкета» (FX-008, FS-NOTE-2): the questionnaire the agency's chatters keep about a fan — one regular note, a
// line `Label: value` per field. The entries are the Fansly extension's since 2.11.0 (decision 164, `FAN_NOTE_TEMPLATE_LABELS`),
// in its order and spelling, so a questionnaire started in either client reads the same in the other (R20 P11b2).
// Pure: the panel starts a new note's draft with it; nothing is written before «Создать».

import { noteLabelKey, splitFactDate, type NoteFormPart } from './form';

export { isQuestionnaire } from './form';

export const NOTE_TEMPLATE_TITLE = 'Анкета';
/** The field that names the fan. */
export const NOTE_NAME_LABEL = 'Имя';
/** Where a fact that fits no other field goes. */
export const NOTE_OTHER_LABEL = 'Другое';
export const NOTE_TEMPLATE_LABELS: readonly string[] = [NOTE_NAME_LABEL, 'Локация', 'Возраст', 'Работа', 'График', 'Хобби', 'Планы и даты', 'Фетиши', 'Характеристика', 'Медиа', NOTE_OTHER_LABEL];
/** A name for oneself taken from the questionnaire is a name: a longer fact is a sentence about one. */
export const NOTE_FORM_NAME_MAX_CHARS = 32;

/**
 * 2026-11-16 (a chatter's ask, the owner: «только тех, у кого нет кастомного имени»): the name a questionnaire gives
 * the fan, as the site's name for oneself takes it: the first fact of «Имя» without the Goose's month. null — no
 * questionnaire, nothing written there, no letter in it («?», «-») or a sentence instead of a name.
 */
export function noteFormName(parts: readonly NoteFormPart[] | null): string | null {
  const key = noteLabelKey(NOTE_NAME_LABEL);
  const field = parts?.find((part) => part.kind === 'field' && noteLabelKey(part.label) === key);
  const first = field?.kind === 'field' ? field.facts[0] : undefined;
  const name = first === undefined ? '' : splitFactDate(first).text.trim();
  return name === '' || !/\p{L}/u.test(name) || Array.from(name).length > NOTE_FORM_NAME_MAX_CHARS ? null : name;
}
export const NOTE_TEMPLATE_TEXT = NOTE_TEMPLATE_LABELS.map((label) => `${label}: `).join('\n');

/** 2026-10-29: the fact «Другое» gets with a questionnaire moved from the fan's old account (`from` — its @handle, or its
 * name): the team's notes are in Russian, as the template is. */
export const noteTransferMark = (from: string): string => `старый аккаунт ${from}`;
