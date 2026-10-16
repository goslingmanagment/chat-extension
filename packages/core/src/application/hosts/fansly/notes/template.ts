// «+ По шаблону» (FX-008, FS-NOTE-2): the questionnaire the agency's chatters keep about a fan — one regular note, a
// line `Label: value` per field. Pure: the panel starts a new note's draft with it; nothing is written before «Создать».

export const NOTE_TEMPLATE_TITLE = 'Анкета';
export const NOTE_TEMPLATE_LABELS: readonly string[] = ['Имя', 'Локация', 'Возраст', 'Работа', 'Хобби', 'Фетиши', 'Характеристика', 'Медиа'];
export const NOTE_TEMPLATE_TEXT = NOTE_TEMPLATE_LABELS.map((label) => `${label}: `).join('\n');

const LABEL_KEYS = new Set(NOTE_TEMPLATE_LABELS.map((label) => label.toLocaleLowerCase('ru')));

/** A note that already is the questionnaire: at least two of its lines start with one of its labels. One per fan. */
export function isQuestionnaire(text: string): boolean {
  let fields = 0;
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0 && LABEL_KEYS.has(line.slice(0, colon).trim().toLocaleLowerCase('ru'))) fields += 1;
    if (fields >= 2) return true;
  }
  return false;
}
