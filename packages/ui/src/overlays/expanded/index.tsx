// @cg/ui/overlays/result-expanded — «Развернуть ↗» (ui-design §10, UI-014,
// UI-015, UI-017): the result of the open chat in a window like the
// cheatsheet (min(720px, 100vw − 32px), layer 950) without the sheet's
// height limit — a Recap, or a draft result with its parts and, in debug
// mode, the debug footer. A Recap closes with one Esc, a press on the scrim
// or × «Скрыть», window and sheet at once (the old Fansly extension's
// overlay); «Свернуть» returns it to the dock sheet, which keeps showing it.
// A draft result folds back into its sheet. The window holds focus and gives
// it back. Nothing is shown unless a view model says `expanded`. Review has
// no window since 1.51.0: it is a turn of Coach's dialog. A lazy overlay.

import { type JSX } from 'preact';
import { useLayoutEffect } from 'preact/hooks';

import { type MountDeps } from '@cg/contracts/vm';

import {
  Boundary,
  Button,
  Dialog,
  OverlayLayer,
  Spinner,
  focusQuietly,
  mountKitSurface,
  useDispatch,
  useI18n,
  useKit,
  useView,
  type KitMount,
  type KitMountOptions,
  type StyleSource,
  type SurfaceDefinition,
} from '../../kit';
import { Head } from '../../dock/Head';
import { DEFAULT_PARTS } from '../../dock/lazy';
import { useLazyPart, type AnalysisProps, type DebugProps, type DockParts, type PartLoader } from '../../dock/lazy-part';
import { featureKey, isRunning } from '../../dock/model';
import { ResultContent } from '../../dock/Result';
import { useSteadyView, useStreamText } from '../../dock/Stream';
import { DOCK_STYLE } from '../../dock/styles';
import { overlayRootCss } from '../layer';

function Analysis({ loader, which, debugPart }: { readonly loader: PartLoader<AnalysisProps>; readonly which: AnalysisProps['which']; readonly debugPart: PartLoader<DebugProps> }): JSX.Element {
  const i18n = useI18n();
  const part = useLazyPart(loader);
  if (part === null) return <Head title={i18n.t(featureKey(which))} gutter={<Spinner label={i18n.t('common.loading')} />} />;
  const View = part.view;
  return <View which={which} place="dialog" debugPart={debugPart} />;
}

export interface ExpandedViewProps {
  /** Loaders of the dock's lazy parts (Recap, the debug footer). */
  readonly parts?: Partial<DockParts>;
}

export function ExpandedView({ parts }: ExpandedViewProps): JSX.Element | null {
  const i18n = useI18n();
  const { deps, root } = useKit();
  const dispatch = useDispatch();
  const raw = useView({ of: 'dock' });
  const dock = useSteadyView(raw).value;
  const recap = useSteadyView(useView({ of: 'recap.view' })).value;
  const streamText = useStreamText(raw, (view) => view.result?.streamText ?? null);
  const all: DockParts = { ...DEFAULT_PARTS, ...parts };
  const result = dock.result !== null && dock.result.expanded && dock.result.state !== 'canceled' ? dock.result : null;
  const which = recap.expanded ? 'recap' : null;
  const open = which !== null || result !== null;
  // A Recap that finished in the window took its «Отменить» with it (X55: it opens here): the focus fell to the page's
  // body — it goes to «Свернуть», so the keys stay the window's. Focus anywhere else is left alone.
  useLayoutEffect(() => {
    if (!open || root.activeElement !== null) return;
    const page = root.ownerDocument;
    if (page === null || (page.activeElement !== null && page.activeElement !== page.body)) return;
    focusQuietly(root.querySelector<HTMLElement>('.cg-xdlg .cg-collapse'));
  });
  if (!open) return null;

  const collapse = (): void => {
    if (result !== null) void dispatch({ type: 'ExpandResult', operationId: result.opId, expanded: false });
  };
  // Esc and the scrim: a Recap goes away whole, as its × «Скрыть»; a draft result folds into its sheet.
  const close = (): void => {
    if (which !== null) void dispatch({ type: 'ShowAnalysis', view: which, mode: 'hidden' });
    else collapse();
  };
  const title = i18n.t(which !== null ? featureKey(which) : result !== null ? featureKey(result.feature) : 'result.label');
  return (
    <OverlayLayer>
      <Dialog
        open
        label={`${i18n.t('result.label')}: ${title}`}
        size="wide"
        class="cg-xdlg"
        onClose={close}
        // Focus opens on «Свернуть», not on the first icon of the head (whose tooltip would pop up by itself) nor on a
        // running Recap's «Отменить» (a stray Enter must not cancel a paid run); without one — the window itself.
        initialFocus={() => root.querySelector<HTMLElement>('.cg-xdlg .cg-collapse') ?? root.querySelector<HTMLElement>('.cg-xdlg')}
      >
        {/* A part that fails here (a chunk that did not load) shows its card inside the window, which stays and collapses as before. */}
        <Boundary surface={null}>
          {which !== null ? (
            <Analysis loader={all.analysis} which={which} debugPart={all.debug} />
          ) : result === null ? null : (
            <ResultContent
              result={result}
              mode={dock.mode}
              quiet
              streamText={streamText}
              debugPart={all.debug}
              close={
                isRunning(result.state) ? null : (
                  <Button
                    label={i18n.t('result.collapse')}
                    icon="collapse"
                    variant="quiet"
                    class="cg-collapse"
                    hotkey={deps.catalog.entry('close').hotkey ?? i18n.t('common.key.esc')}
                    onClick={collapse}
                  />
                )
              }
            />
          )}
        </Boundary>
      </Dialog>
    </OverlayLayer>
  );
}

export const EXPANDED_CSS = `
${overlayRootCss('result-expanded', 'window')}
.cg-xdlg { container: cg / inline-size; }
.cg-xdlg .cg-head { min-height: 44px; padding-right: 8px; }
.cg-collapse .cg-ico { display: none; }
`;
export const EXPANDED_STYLE: StyleSource = { id: 'cg-result-expanded', css: EXPANDED_CSS };

/** The window's surface; `parts` replaces the loaders of the dock's lazy parts. */
export function createExpandedSurface(options: ExpandedViewProps = {}): SurfaceDefinition {
  return { view: () => <ExpandedView {...options} />, styles: [DOCK_STYLE, EXPANDED_STYLE] };
}

export const expandedSurface: SurfaceDefinition = createExpandedSurface();

export function mountExpanded(root: ShadowRoot, deps: MountDeps, options: KitMountOptions & ExpandedViewProps = {}): KitMount {
  const { parts, ...mount } = options;
  return mountKitSurface('result-expanded', root, deps, parts === undefined ? expandedSurface : createExpandedSurface({ parts }), mount);
}
