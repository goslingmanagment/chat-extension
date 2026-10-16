// «+ Анкета» (FX-008, FS-NOTE-2): the questionnaire the agency's chatters keep about a fan — one regular note, a
// line `Label: value` per field. The entries are the Fansly extension's since 2.11.0 (E164, `FAN_NOTE_TEMPLATE_LABELS`),
// in its order and spelling, so a questionnaire started in either client reads the same in the other (R20 P11b2).
// Pure: the panel starts a new note's draft with it; nothing is written before «Создать».

export { isQuestionnaire } from './form';

export const NOTE_TEMPLATE_TITLE = 'Анкета';
/** Where a fact that fits no other field goes. */
export const NOTE_OTHER_LABEL = 'Другое';
export const NOTE_TEMPLATE_LABELS: readonly string[] = ['Имя', 'Локация', 'Возраст', 'Работа', 'График', 'Хобби', 'Планы и даты', 'Фетиши', 'Характеристика', 'Медиа', NOTE_OTHER_LABEL];
export const NOTE_TEMPLATE_TEXT = NOTE_TEMPLATE_LABELS.map((label) => `${label}: `).join('\n');
