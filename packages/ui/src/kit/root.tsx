// The frame of every surface (architecture.md §10.1, §10.2 п. 5; ui-design
// §6.2): the kit environment, the error boundary (ER-020), the root's one
// tooltip bubble and its one polite live region. A surface renders inside
// KitRoot and never builds these itself.

import { type ComponentChildren, type JSX } from 'preact';

import { type UiResultStyle } from '@cg/contracts/settings';
import { resultCap, type MountSurfaceKind } from '@cg/contracts/vm';

import { Hints, KitProvider, useGeometry, useKit, type KitEnv } from './context';
import { Boundary } from './components/Boundary';
import { TooltipLayer } from './components/Tooltip';

/** The hidden `aria-live="polite"` region of a root: stages, «Вставлено», «Скопировано», «Показано 7». */
export function LiveRegion(): JSX.Element {
  const { announcement } = useKit();
  const { seq, text } = announcement.value;
  return (
    <div class="cg-sr" aria-live="polite" aria-atomic="true" data-cg-live="">
      {/* A new node per announcement: the same words said twice are heard twice. */}
      {text === '' ? null : <span key={seq}>{text}</span>}
    </div>
  );
}

export interface KitRootProps {
  readonly env: KitEnv;
  /** The surface «Перезагрузить панель» reloads. */
  readonly surface: MountSurfaceKind | null;
  /** `ui.hints` (ST-125); the surface passes its view model's value. */
  readonly hints?: boolean;
  readonly children?: ComponentChildren;
}

export function KitRoot({ env, surface, hints = true, children }: KitRootProps): JSX.Element {
  return (
    <KitProvider env={env}>
      <Hints value={hints}>
        <Boundary surface={surface}>{children}</Boundary>
      </Hints>
      <TooltipLayer />
      <LiveRegion />
    </KitProvider>
  );
}

/**
 * The result sheet's height limit for the current geometry (ui-design §3.2,
 * owner's ruling): `resultCap` of the contract, live with MountPort's
 * geometry. `style` carries it as `--cg-cap` for the sheet's `max-height`.
 */
export function useResultCap(resultStyle: UiResultStyle): { readonly cap: number; readonly style: Readonly<Record<'--cg-cap', string>> } {
  const geometry = useGeometry().value;
  const cap = resultCap(geometry, resultStyle);
  return { cap, style: { '--cg-cap': `${cap}px` } };
}
