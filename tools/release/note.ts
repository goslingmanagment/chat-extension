// The release note: docs/releases/<version>.md. What only a person can check
// before a release (architecture.md §12 п. 8, §13 п. 1) is a line with a tick
// box there; `preflight` refuses to pass while a required line is unticked.
// The note is committed, so the ticks stay as the evidence of the release. The
// lines «После выкладки» are filled once the feed serves the version; the gate
// does not read them. No I/O here.

export interface NoteItem {
  readonly id: string;
  /** Russian: the owner reads and ticks it. */
  readonly text: string;
}

/** Required before signing. */
export const BEFORE_SIGNING: readonly NoteItem[] = [
  { id: 'smoke', text: 'Ручная проверка на тестовом чате пройдена по чек-листу `docs/pilot-readiness.md`, раздел 6. Сборка ChatSpace и дата: …' },
  { id: 'e2e', text: '`pnpm e2e` зелёный на коде этого выпуска — локально или джоба e2e в CI.' },
  { id: 'perf', text: '`pnpm perf` зелёный на коде этого выпуска.' },
  { id: 'hub-383', text: 'Исправление доступа к персонам (PR хаба #383) стоит в проде, отрицательные проверки пройдены.' },
  { id: 'hub-state', text: 'Bootstrap, возможности и флаги прод-хаба соответствуют этой сборке.' },
  { id: 'bindings', text: 'Привязки пилотных страниц сверены: аккаунт OnlyMonster → страница хаба.' },
  { id: 'texts', text: 'Тексты прочитаны: «Что нового», история версий, руководство, «Как начать», страница о данных.' },
];

/** Filled after the feed serves the version: the evidence that the release reached a browser. */
export const AFTER_PUBLISHING: readonly NoteItem[] = [
  { id: 'update', text: 'Установленное расширение обновилось из фида: `about:addons` → шестерёнка → «Проверить наличие обновлений»; в «Статусе» новая версия.' },
  { id: 'install', text: 'Чистая установка со страницы установки прошла: Firefox принял подпись.' },
  { id: 'tabs', text: 'Вкладки ChatSpace, открытые до обновления, попросили перезагрузку.' },
];

export function renderNote(version: string): string {
  const line = (item: NoteItem): string => `- [ ] \`${item.id}\` — ${item.text}`;
  return [
    `# Выпуск ${version}`,
    '',
    'Заметка выпуска: что проверено руками. Отмеченная строка выглядит так: `- [x]`. После',
    'текста строки можно дописать, что увидели. Пока в разделе «Перед подписью» есть строка',
    'без галочки, `pnpm release preflight` выпуск не пропускает. Порядок выпуска —',
    '`docs/release.md`.',
    '',
    '## Перед подписью',
    '',
    ...BEFORE_SIGNING.map(line),
    '',
    '## После выкладки',
    '',
    ...AFTER_PUBLISHING.map(line),
    '',
  ].join('\n');
}

const ITEM_RE = /^- \[([ xXхХ])\] `([a-z0-9-]+)`/;

/** id → ticked, for every tick-box line of the note (a Cyrillic «х» in the box counts as a tick too). */
export function readNote(text: string): Map<string, boolean> {
  const items = new Map<string, boolean>();
  for (const line of text.split('\n')) {
    const match = ITEM_RE.exec(line.trim());
    if (match?.[2] !== undefined) items.set(match[2], match[1] !== ' ');
  }
  return items;
}

/** Why the note does not allow signing; [] — it does. `text` is null when the file does not exist. */
export function noteProblems(text: string | null, version: string): string[] {
  if (text === null) return [`no release note for ${version} — create it with \`pnpm release note\`, tick what is checked, commit`];
  if (!text.startsWith(`# Выпуск ${version}\n`)) return [`the note does not start with «# Выпуск ${version}»: it is the note of another version`];
  const items = readNote(text);
  return BEFORE_SIGNING.flatMap((item) => {
    if (!items.has(item.id)) return [`the line \`${item.id}\` is missing from the note`];
    return items.get(item.id) === true ? [] : [`not ticked: \`${item.id}\``];
  });
}
