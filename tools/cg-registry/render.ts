// Renders docs/error-registry.md (architecture.md §3, Appendix A «Документация
// реестра генерируется из него») from the CG registry and the `ru` catalog.
// Pure: generate.ts writes the file, render.test.ts fails when it is stale.

import type { CgFanslyEntry } from '../../packages/contracts/src/errors-fansly.ts';
import type { CgRecovery, CgRetry, CgSeverity, CgTelemetryClass, SettingsSection } from '../../packages/contracts/src/errors.ts';
import type { CgRegistryEntry } from '../../packages/contracts/src/errors/registry.ts';

export const REGISTRY_DOC_PATH = 'docs/error-registry.md';

const SEVERITY: Readonly<Record<CgSeverity, string>> = { info: 'инфо', warn: 'внимание', error: 'ошибка' };

const RECOVERY: Readonly<Record<CgRecovery, string>> = {
  none: '—',
  retry: 'повторить',
  'new-generation': 'новая генерация',
  'wait-until': 'ждать срока',
  'sign-in': 'войти',
  'open-settings': 'открыть настройки',
  'reload-tab': 'перезагрузить вкладку',
  'update-extension': 'обновить расширение',
  'open-chat': 'открыть чат',
  'contact-owner': 'к тимлиду',
};

const TELEMETRY: Readonly<Record<CgTelemetryClass, string>> = { count: 'счётчик', 'count+sample': 'счётчик + образец', p1: '**P1**' };

export interface RegistryDocInput {
  readonly entries: readonly CgRegistryEntry[];
  /** The Appendix A «Повтор» word of a retry rule. */
  readonly retryWord: (entry: { readonly retry: CgRetry }) => string;
  /** Russian text of an i18n key (the `ru` catalog). */
  readonly ru: (key: CgRegistryEntry['title'] | CgRegistryEntry['body'] | `settings.section.${SettingsSection}`) => string;
  /** 1.15.0: the Fansly codes (errors-fansly.ts) and their Russian texts (the Fansly catalog). */
  readonly fansly: {
    readonly entries: readonly CgFanslyEntry[];
    readonly ru: (key: CgFanslyEntry['title'] | CgFanslyEntry['body']) => string;
  };
}

/** What a row shows of an entry of either registry. */
interface RowEntry {
  readonly code: string;
  readonly kind: string;
  readonly severity: CgSeverity;
  readonly title: string;
  readonly body: string;
  readonly recovery: CgRecovery;
  readonly retry: CgRetry;
  readonly telemetry: CgTelemetryClass;
  readonly settings?: { readonly section: SettingsSection };
  readonly retired?: { readonly at: string; readonly reason: string };
}

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

export function renderRegistryDoc({ entries, retryWord, ru, fansly }: RegistryDocInput): string {
  const live = entries.filter((entry) => entry.retired === undefined);
  const fanslyLive = fansly.entries.filter((entry) => entry.retired === undefined);
  const retired: readonly RowEntry[] = [...entries, ...fansly.entries].filter((entry) => entry.retired !== undefined);
  const p1 = entries.filter((entry) => entry.telemetry === 'p1').map((entry) => entry.code);
  const textOf = (entry: RowEntry, key: string): string =>
    fansly.entries.some((candidate) => candidate.code === entry.code) ? fansly.ru(key as CgFanslyEntry['title']) : ru(key as CgRegistryEntry['title']);
  const row = (entry: RowEntry): string =>
    `| ${[
      entry.code,
      entry.kind,
      SEVERITY[entry.severity],
      cell(textOf(entry, entry.title)),
      cell(textOf(entry, entry.body)),
      RECOVERY[entry.recovery],
      retryWord(entry),
      TELEMETRY[entry.telemetry],
      entry.settings === undefined ? '—' : `${ru(`settings.section.${entry.settings.section}`)} (\`#${entry.settings.section}:${entry.code}\`)`,
    ].join(' | ')} |`;

  return [
    '# Реестр ошибок CG',
    '',
    '<!-- Сгенерировано: node tools/cg-registry/generate.ts. Руками не править. Источник — packages/contracts/src/errors/registry.ts и каталог ru (packages/core/src/domain/i18n/ru.ts), коды Fansly — packages/contracts/src/errors-fansly.ts и их каталог (packages/core/src/domain/hosts/fansly/i18n/ru.ts); тест падает, если файл отстал. -->',
    '',
    'Единый реестр кодов `CG-*` расширения: `architecture.md`, приложение А, §5.7 и §9.5. Порядок — порядок приложения А.',
    'Код и его смысл после первого выпуска не меняются; удалённый код остаётся записью в «Списанных».',
    '',
    'Колонки:',
    '- «Вид» — группа для диагностики;',
    '- «Серьёзность» — инфо, внимание или ошибка;',
    '- «Заголовок» и «Пояснение» — тексты карточки ошибки (русский каталог; английский — с теми же ключами);',
    '- «Восстановление» — что может сделать человек;',
    '- «Повтор» — колонка «Повтор» приложения А: `чтение` — безопасный повтор чтения, `клик` — новое действие человека, `срок` — ждать срока, потом руками, `никогда` — повтор запрещён, `—` — повторять нечего;',
    '- «Телеметрия» — счётчик по коду, счётчик с образцом технических фактов или счётчик P1;',
    '- «Настройки» — раздел, куда ведёт кнопка «Настройки» в карточке и тосте (`options.html#<раздел>:<КОД>`).',
    '',
    `Кодов: ${live.length}. P1: ${p1.length > 0 ? p1.join(', ') : 'нет'}.`,
    '',
    '| Код | Вид | Серьёзность | Заголовок | Пояснение | Восстановление | Повтор | Телеметрия | Настройки |',
    '|---|---|---|---|---|---|---|---|---|',
    ...live.map(row),
    '',
    '## Коды Fansly',
    '',
    'Реестр сайта fansly.com (1.15.0, R20): `packages/contracts/src/errors-fansly.ts`, приложение А «Коды Fansly». С общим он сливается только во вкладке Fansly, на страницах расширения и в `bg/fansly`: бандлы ChatSpace его не несут. Тексты — каталог Fansly (`packages/core/src/domain/hosts/fansly/i18n/ru.ts`).',
    '',
    `Кодов: ${fanslyLive.length}.`,
    '',
    '| Код | Вид | Серьёзность | Заголовок | Пояснение | Восстановление | Повтор | Телеметрия | Настройки |',
    '|---|---|---|---|---|---|---|---|---|',
    ...fanslyLive.map(row),
    '',
    '## Списанные коды',
    '',
    ...(retired.length === 0
      ? ['Нет.']
      : ['| Код | Когда | Почему |', '|---|---|---|', ...retired.map((entry) => `| ${entry.code} | ${entry.retired?.at ?? ''} | ${cell(entry.retired?.reason ?? '')} |`)]),
    '',
  ].join('\n');
}
