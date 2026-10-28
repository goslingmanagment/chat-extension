// OnlyMonster's fan notes on the stand (2026-10-28): what `GET`/`POST api/v0/accounts/{acc}/fans/{fan}/notes` and
// `PUT`/`DELETE …/notes/{id}` keep, in memory per account and fan, in the API's own shape as ChatSpace reads it
// (0.233.0) and a live read of the agency's notes showed it: plain text, no colour — the team's section notes, one per
// section, and an older untitled note of «Поле: значение» lines. Every text is invented here.

import { chatKey, STAND_IDS } from './dataset';

export interface StandNote {
  readonly id: number;
  title: string | null;
  /** The body: plain text, or HTML of ChatSpace's editor (`<p>…`). */
  note: string;
  /** null, or a value of ChatSpace's palette (`#480a09` red, `#332700` yellow, `#001f4b` blue, `#122314` green). */
  color: string | null;
  readonly createdAt: string;
  updatedAt: string;
}

/** The first id the stand gives a note created on it. */
export const STAND_NOTE_FIRST_ID = 8900;

/** Fan a1 of account a (the showcase's Jamie Carter) has the team's notes; every other fan has none. */
export function seedNotes(): Map<string, StandNote[]> {
  const note = (id: number, title: string | null, body: string, at: string): StandNote => ({ id, title, note: body, color: null, createdAt: at, updatedAt: at });
  return new Map([
    [
      chatKey(STAND_IDS.accounts.a, STAND_IDS.fans.a1),
      [
        note(8801, null, 'Имя: Джейми\nЛокация: Манчестер\nВозраст: 34\nРабота: инженер\nХобби: футбол, спортзал', '2026-02-14T18:20:00.000Z'),
        note(8802, 'Важная информация', 'Берёт эксклюзив, торгуется только по пятницам\nНе любит, когда торопят', '2026-08-28T10:05:00.000Z'),
        note(8803, 'Характеристика', 'Спокойный, с юмором\nПишет по вечерам после работы', '2026-08-28T10:07:00.000Z'),
        note(8804, 'Фетиши', 'Ножки\nЧулки', '2026-09-11T16:40:00.000Z'),
      ],
    ],
  ]);
}

/** A note as the API answers it (the live read's keys). */
export function rawNote(accountId: string, fanId: string, userId: string, note: StandNote): Record<string, unknown> {
  return {
    id: note.id,
    organisation_id: 1,
    fan_id: Number(fanId),
    account_id: Number(accountId),
    updated_by_user_id: Number(userId),
    title: note.title,
    note: note.note,
    color: note.color,
    pinned: false,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
  };
}

/** A write's body as ChatSpace's editor sends it (`{title?, note, color}`); null — not a note the API takes. */
export function noteFields(body: unknown): Pick<StandNote, 'title' | 'note' | 'color'> | null {
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const title = fields['title'] ?? null;
  const color = fields['color'] ?? null;
  const text = fields['note'];
  if (typeof text !== 'string' || text.trim() === '' || (title !== null && typeof title !== 'string') || (color !== null && typeof color !== 'string')) return null;
  return { title: title as string | null, note: text, color: color as string | null };
}
