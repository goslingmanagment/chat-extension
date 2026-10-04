// The seven view states every model carries (architecture.md §10.2 п. 1):
// a surface shows loading as loading, an empty answer as its own text, a
// failed read as an error card with «Повторить» (never an empty list,
// ER-025, SP-029), a missing right with its remedy, the hub away as offline
// over the last good data, and partial data with its gaps. The UI works
// before the hub answers (AU-018): loading and offline need nothing from it.

import { type ComponentChildren, type JSX } from 'preact';

import { type I18nKey } from '@cg/contracts/errors';
import { type ActionButtonVM, type PartialGap, type UiAction, type VmView } from '@cg/contracts/vm';

import { useI18n } from '../context';
import { ErrorCard } from './ErrorCard';
import { Spinner } from './Indicators';

/** The label of a retry or remedy button by what it does. */
const REMEDY_LABELS: Partial<Record<UiAction['type'], I18nKey>> = {
  OpenSettings: 'common.settings',
  ReloadTab: 'common.reloadTab',
  Navigate: 'common.openChat',
  SignIn: 'common.signIn',
};

export function remedyLabelKey(action: UiAction): I18nKey {
  return REMEDY_LABELS[action.type] ?? 'common.retry';
}

function asButton(action: UiAction | null): ActionButtonVM[] {
  return action === null ? [] : [{ label: { key: remedyLabelKey(action) }, action, enabled: true, reason: null, hotkey: null }];
}

/** A gap of a `partial` view in words, when the kit knows one (surfaces add their own). */
function gapKey(gap: PartialGap): I18nKey | null {
  if (gap.kind === 'coverage') return gap.level === 'unknown' ? 'common.coverage.unknown' : 'common.coverage.partial';
  return null;
}

export interface ViewStateProps {
  readonly view: VmView;
  /** The data part: rendered for ready and partial, and under offline (cached data with its age). */
  readonly children?: ComponentChildren;
  /** Keep showing the children while loading (a refresh over shown data). */
  readonly keepWhileLoading?: boolean;
}

export function ViewState({ view, children, keepWhileLoading = false }: ViewStateProps): JSX.Element {
  const i18n = useI18n();
  switch (view.s) {
    case 'ready':
      return <>{children}</>;
    case 'loading':
      return keepWhileLoading ? (
        <>{children}</>
      ) : (
        <div class="cg-state cg-state--loading" role="status" aria-busy="true">
          <Spinner />
          <span>{view.stage === null ? i18n.t('common.loading') : i18n.text(view.stage)}</span>
        </div>
      );
    case 'empty':
      return (
        <div class="cg-state cg-state--empty" role="status">
          {i18n.text(view.why)}
        </div>
      );
    case 'partial': {
      const notes = view.gaps.map(gapKey).filter((key): key is I18nKey => key !== null);
      return (
        <>
          {children}
          {notes.length === 0 ? null : <div class="cg-state cg-state--gaps">{[...new Set(notes)].map((key) => i18n.t(key)).join(' · ')}</div>}
        </>
      );
    }
    case 'error':
      return <ErrorCard tone="failure" error={view.error} actions={asButton(view.retry)} />;
    case 'forbidden':
      return <ErrorCard tone="state" error={view.error} actions={asButton(view.remedy)} />;
    case 'offline':
      return (
        <>
          <ErrorCard tone="failure" error={view.error} actions={asButton(view.retry)} />
          {children}
        </>
      );
  }
}

export const VIEW_STATE_CSS = `
.cg-state { display: flex; align-items: center; gap: 8px; padding: 12px 16px; color: var(--cg-ink-muted); font-size: var(--cg-text-base); line-height: 18px; }
.cg-state--empty { justify-content: center; padding: 24px 20px; text-align: center; }
.cg-state--gaps { padding: 6px 16px; font-size: var(--cg-text-sm); }
`;
