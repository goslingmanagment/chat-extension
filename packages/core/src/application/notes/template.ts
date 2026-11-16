// «+ Анкета» (FX-008, FS-NOTE-2): the questionnaire the agency's chatters keep about a fan — one regular note, a
// line `Label: value` per field. The entries are the Fansly extension's since 2.11.0 (decision 164, `FAN_NOTE_TEMPLATE_LABELS`),
// in its order and spelling, so a questionnaire started in either client reads the same in the other (R20 P11b2).
// Pure: the panel starts a new note's draft with it; nothing is written before «Создать».

import { noteLabelKey, splitFactDate, type NoteFormPart } from './form';
import { knownPlace, type KnownPlace } from './places';

export { isQuestionnaire } from './form';

export const NOTE_TEMPLATE_TITLE = 'Анкета';
/** The field that names the fan. */
export const NOTE_NAME_LABEL = 'Имя';
const NOTE_PLACE_LABEL = 'Локация';
const NOTE_AGE_LABEL = 'Возраст';
/** Where a fact that fits no other field goes. */
export const NOTE_OTHER_LABEL = 'Другое';
export const NOTE_TEMPLATE_LABELS: readonly string[] = [NOTE_NAME_LABEL, NOTE_PLACE_LABEL, NOTE_AGE_LABEL, 'Работа', 'График', 'Хобби', 'Планы и даты', 'Фетиши', 'Характеристика', 'Медиа', NOTE_OTHER_LABEL];
/** A part of a fan's name for oneself is a word or two: a longer fact is a sentence about one. */
const NAME_PART_MAX_CHARS = 24;
const NAME_PART_MAX_WORDS = 2;

/** A field's first fact, without the Goose's month; undefined — no such field or nothing in it. */
function firstFact(parts: readonly NoteFormPart[], label: string): string | undefined {
  const key = noteLabelKey(label);
  const field = parts.find((part) => part.kind === 'field' && noteLabelKey(part.label) === key);
  const first = field?.kind === 'field' ? field.facts[0] : undefined;
  return first === undefined ? undefined : splitFactDate(first).text.trim();
}

/** A fact before its explanation: «George (Petri George, судя по Instagram)» is «George». */
const headOf = (fact: string, cut: RegExp): string => (fact.split(cut)[0] ?? '').replace(/^["«']+|["»']+$/g, '').trim();

const isNamePart = (text: string): boolean => text !== '' && /\p{L}/u.test(text) && text.split(/\s+/).length <= NAME_PART_MAX_WORDS && Array.from(text).length <= NAME_PART_MAX_CHARS;

/** «Isaac, неважно, как его называют», «Jim (Джим). Просил…», «Sam или sammy», «Roman Aguero» name Isaac, Jim, Sam
 * and Roman (the team's names carry the first name alone); «не называет, просит…», «попросил называть его Джо» name
 * nobody: two words are a name only when both start with a capital. */
function nameOf(fact: string): string | null {
  const head = headOf(fact, /[(/,.;]|\s(?:или|or)\s/iu);
  const words = head.split(/\s+/);
  return isNamePart(head) && (words.length === 1 || words.every((word) => /^\p{Lu}/u.test(word))) ? (words[0] ?? null) : null;
}

/**
 * «Германия (10.2026)», «Остин, Техас, США», «US/denver», «запад США» — the place as the team's names carry it
 * («Germany», «US»): a country before a US state or city, a part before a word inside one (a two-letter word only in
 * capitals: «West US»). A single place the list does not know stays as written («Baku»), a longer story gives none.
 */
function placeOf(fact: string): string | null {
  const places = headOf(fact, /[(:;]/)
    .split(/[,/]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const words = places.flatMap((place) => place.split(/\s+/)).filter((word) => Array.from(word).length > 2 || word === word.toUpperCase());
  const hits = [...places, ...words].map(knownPlace).filter((known): known is KnownPlace => known !== null);
  const hit = hits.find((known) => known.country) ?? hits[0];
  if (hit !== undefined) return hit.name;
  const only = places.length === 1 ? (places[0] ?? '') : '';
  return isNamePart(only) && !/\d/.test(only) ? only : null;
}

/** «37 лет (день рождения 23 июля)» is 37; «средних лет», «25-30» give none. */
function ageOf(fact: string): string | null {
  const age = /^(\d{2})(?=$|[\s(,;])/.exec(fact)?.[1];
  return age !== undefined && Number(age) >= 18 ? age : null;
}

/**
 * 2026-11-16 (a chatter's ask, the owner: «только тех, у кого нет кастомного имени»; «у нас ведь и возраст в кастом
 * именах и страна пишется»): the name for oneself a questionnaire gives the fan, as the team writes those (hub prod:
 * «Anton/Germany/26», «Sam/US», «Jude/UK/22»): «Имя», then the place of «Локация», then «Возраст», by «/», each from its
 * field's first fact without the Goose's month; a part not known is left out. The name stays as written there. null —
 * no questionnaire, no name in «Имя», no letter in it («?», «-») or a sentence instead of a name.
 */
export function noteFormName(parts: readonly NoteFormPart[] | null): string | null {
  if (parts === null) return null;
  const name = nameOf(firstFact(parts, NOTE_NAME_LABEL) ?? '');
  if (name === null) return null;
  const place = firstFact(parts, NOTE_PLACE_LABEL);
  const age = firstFact(parts, NOTE_AGE_LABEL);
  return [name, place === undefined ? null : placeOf(place), age === undefined ? null : ageOf(age)].filter((part) => part !== null).join('/');
}
export const NOTE_TEMPLATE_TEXT = NOTE_TEMPLATE_LABELS.map((label) => `${label}: `).join('\n');

/** 2026-10-29: the fact «Другое» gets with a questionnaire moved from the fan's old account (`from` — its @handle, or its
 * name): the team's notes are in Russian, as the template is. */
export const noteTransferMark = (from: string): string => `старый аккаунт ${from}`;
