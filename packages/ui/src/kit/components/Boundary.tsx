// Every surface sits in its own error boundary (architecture.md §9.5 «Сбой
// интерфейса», ER-020): a render error shows the card «ChatGoose ·
// CG-UI-FAILED» — «Сбой интерфейса» — with «Перезагрузить панель» and
// «Выгрузить диагностику», and is reported (class name only, never text).
// A broken part (the stats) does not take down its neighbours (the dock).

import { type ComponentChildren, type JSX } from 'preact';
import { useErrorBoundary } from 'preact/hooks';

import { cgBodyKey, cgTitleKey } from '@cg/contracts/i18n/keys';
import { type MountSurfaceKind } from '@cg/contracts/vm';

import { useDispatch, useI18n, useKit } from '../context';
import { Button } from './Button';
import { ErrorCard } from './ErrorCard';

export interface BoundaryProps {
  /** Which surface «Перезагрузить панель» reloads (ReloadSurface); null for a nested part. */
  readonly surface: MountSurfaceKind | null;
  readonly children?: ComponentChildren;
}

export function Boundary({ surface, children }: BoundaryProps): JSX.Element {
  const env = useKit();
  const i18n = useI18n();
  const dispatch = useDispatch();
  const boundary = useErrorBoundary((failure: unknown) => {
    env.report({ kind: 'render', surface: surface ?? env.surface, code: 'CG-UI-FAILED', name: failure instanceof Error ? failure.name : typeof failure });
  });
  const error: unknown = boundary[0];
  const reset = boundary[1];
  if (error === undefined) return <>{children}</>;
  const name = error instanceof Error ? error.name : 'Error';
  return (
    <div class="cg-boundary" data-cg-surface={surface ?? ''}>
      <ErrorCard
        tone="failure"
        error={{ code: 'CG-UI-FAILED', title: i18n.t(cgTitleKey('CG-UI-FAILED')), body: i18n.t(cgBodyKey('CG-UI-FAILED')), detail: `${name} • ${surface ?? env.surface ?? 'ui'}` }}
      >
        <Button
          label={i18n.t('cg.uiFailed.reload')}
          variant="line"
          onClick={() => {
            const target = surface ?? env.surface;
            if (target !== null) void dispatch({ type: 'ReloadSurface', surface: target });
            reset();
          }}
        />
        <Button label={i18n.t('cg.uiFailed.export')} variant="plain" onClick={() => void dispatch({ type: 'ExportDiagnostics' })} />
      </ErrorCard>
    </div>
  );
}

export const BOUNDARY_CSS = `
.cg-boundary { background: var(--cg-surface); }
`;
