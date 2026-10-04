// What the two list windows share (ui-design §3.5, §3.6, §4.14, §4.17): the
// 52 px header — title, page name, tabs, search, «Закрыть Esc» —, the data
// footer «N из M, охват полный · данные на 09:18», and small helpers of
// every board surface: the coverage word, the unknown mark of the I18n port,
// «is the person typing in one of our fields».

import { type ComponentChildren, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { type I18nKey } from '@cg/contracts/errors';
import { type DataStamp, type I18n } from '@cg/contracts/vm';

import { Button, useDispatch, useHints, useI18n, type StyleSource } from '../kit';

const COVERAGE_KEYS: Readonly<Record<DataStamp['coverage'], I18nKey>> = {
  complete: 'common.coverage.complete',
  partial: 'common.coverage.partial',
  unknown: 'common.coverage.unknown',
};

/** «охват полный» / «охват неполный» / «охват неизвестен». */
export function coverageWord(i18n: I18n, coverage: DataStamp['coverage']): string {
  return i18n.t(COVERAGE_KEYS[coverage]);
}

/** The port's own mark for «unknown» (never a zero): `—`. */
export function unknownMark(i18n: I18n): string {
  return i18n.formatMoneyMills(null);
}

/** «3 ч», «19 д»; unknown — `—`. */
export function ageOrUnknown(i18n: I18n, at: string | number | null): string {
  return at === null ? unknownMark(i18n) : i18n.formatAge(at);
}

/** «09:18»; unknown — `—`. */
export function timeOrUnknown(i18n: I18n, at: string | number | null): string {
  return at === null ? unknownMark(i18n) : i18n.formatTime(at);
}

/** The event comes from a field the person types in: letters, J/K, `/` and arrows are text there (ui-design §6.4). */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** A plain key press: no Ctrl, Alt or ⌘ (Shift is allowed for `/` on some layouts). */
export function isPlainKey(event: KeyboardEvent): boolean {
  return !event.ctrlKey && !event.altKey && !event.metaKey;
}

export interface WindowHeaderProps {
  readonly title: string;
  readonly pageName: string | null;
  readonly onClose: () => void;
  /** Tabs, a `.cg-sp__grow` spacer, search, notes: between the page name and «Закрыть». */
  readonly children?: ComponentChildren;
}

/** The 52 px header of Spenders and «Новые». */
export function WindowHeader({ title, pageName, onClose, children }: WindowHeaderProps): JSX.Element {
  const i18n = useI18n();
  const hints = useHints();
  return (
    <header class="cg-sp__top">
      <h2 class="cg-sp__title">{title}</h2>
      {pageName === null ? null : <span class="cg-sp__page">{pageName}</span>}
      {children}
      <Button
        label={i18n.t('common.close')}
        variant="quiet"
        hotkey={i18n.t('common.key.esc')}
        tooltip={hints ? i18n.t('spenders.closeTooltip') : null}
        class="cg-sp__close"
        onClick={onClose}
      />
    </header>
  );
}

/** A filter of a list with its count: «Ждут ответа 12» (`aria-pressed`, one pressed per group). */
export function FilterChip({ label, count, pressed, onPress }: { readonly label: string; readonly count: number | null; readonly pressed: boolean; readonly onPress: () => void }): JSX.Element {
  return (
    <button
      type="button"
      class="cg-flt"
      aria-pressed={pressed ? 'true' : 'false'}
      onClick={() => {
        if (!pressed) onPress();
      }}
    >
      {label}
      {count === null ? null : <span class="cg-flt__n cg-num">{count}</span>}
    </button>
  );
}

/** Views whose data «Обновить» reads again (the controllers take `ReloadView` for them). */
export type RefreshableView = 'spenders.board' | 'spenders.stats';

/**
 * «Обновить» (SP-024): the hub's data read again past the board's cache. A read, never a generation — the
 * tooltip says so. Quiet and small: it stands next to «данные на 09:18», which it makes newer. Busy until every
 * read answered; a second press meanwhile does nothing.
 */
export function RefreshButton({ views }: { readonly views: readonly RefreshableView[] }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  return (
    <div class="cg-sp__refresh">
      <Button
        label={i18n.t('spenders.refresh')}
        icon="refresh"
        size="sm"
        variant="quiet"
        busy={busy}
        tooltip={i18n.t('spenders.refreshTooltip')}
        onClick={() => {
          if (busy) return;
          setBusy(true);
          const done = (): void => {
            if (alive.current) setBusy(false);
          };
          void Promise.all(views.map((of) => dispatch({ type: 'ReloadView', selector: { of } }))).then(done, done);
        }}
      />
    </div>
  );
}

/** The 32 px footer under a list: what is loaded on the left, «данные на 09:18» — and «Обновить», when the list has one — on the right. */
export function DataFooter({ left, stamp, refresh }: { readonly left: string; readonly stamp: DataStamp; readonly refresh?: readonly RefreshableView[] }): JSX.Element {
  const i18n = useI18n();
  return (
    <div class="cg-sp__foot">
      <span>{left}</span>
      {stamp.asOf === null ? null : <span>{i18n.t('common.dataAsOf', { time: { time: stamp.asOf } })}</span>}
      {refresh === undefined ? null : <RefreshButton views={refresh} />}
    </div>
  );
}

export const WINDOW_CSS = `
.cg-sp { font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink); }
.cg-sp__frame { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.cg-sp__top {
  flex: none; display: flex; align-items: center; gap: 16px; height: 52px; padding: 0 10px 0 20px;
  border-bottom: 1px solid var(--cg-rule); min-width: 0;
}
.cg-sp__title { font-size: var(--cg-text-2xl); line-height: 24px; font-weight: 600; color: var(--cg-ink-strong); letter-spacing: -0.01em; white-space: nowrap; }
.cg-sp__page { color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
.cg-sp__top .cg-tabs { margin-left: 8px; flex: none; }
.cg-sp__tabn { color: var(--cg-ink-muted); font-weight: 400; margin-left: 4px; font-variant-numeric: tabular-nums; }
.cg-sp__grow { flex: 1 1 0; min-width: 0; }
.cg-sp__search { width: 260px; flex: 0 1 auto; min-width: 120px; }
.cg-sp__search input { padding: 0 2px; }
.cg-sp__note { color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
.cg-sp__close { flex: none; }
.cg-sp__tools { flex: none; display: flex; align-items: center; gap: 2px; height: 44px; padding: 0 12px 0 10px; min-width: 0; }
.cg-sp__tools--more { height: 36px; margin-top: -8px; }
.cg-flt { height: 28px; padding: 0 8px; border-radius: var(--cg-r-md); color: var(--cg-ink-muted); white-space: nowrap; flex: none; }
.cg-flt:hover { background: var(--cg-hover); color: var(--cg-ink); }
.cg-flt[aria-pressed="true"] { background: var(--cg-hover); color: var(--cg-ink-strong); font-weight: 500; }
.cg-flt__n { color: var(--cg-ink-muted); margin-left: 4px; font-weight: 400; }
.cg-sp__foot {
  flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 32px; padding: 0 16px 0 20px;
  border-top: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); color: var(--cg-ink-muted); white-space: nowrap;
}
.cg-sp__foot > span { overflow: hidden; text-overflow: ellipsis; }
/* What is loaded takes the room; «данные на 09:18» and «Обновить» stand together at the right. */
.cg-sp__foot > span:first-child { flex: 1 1 auto; min-width: 0; }
.cg-sp__foot > span + span { flex: none; }
.cg-sp__refresh { flex: none; display: inline-flex; margin: 0 -8px; }
.cg-sp__line {
  flex: none; display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 4px 16px 4px 20px;
  border-top: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); line-height: 18px; color: var(--cg-ink-2);
}
.cg-sp__state { flex: 1; min-height: 0; overflow-y: auto; }
@media (max-width: 1360px) { .cg-sp__search { width: 200px; } }
`;

/** The header, the filters and the footer both list windows share. */
export const WINDOW_STYLES: StyleSource = { id: 'cg-window', css: WINDOW_CSS };
