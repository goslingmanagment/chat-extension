// @cg/ui/overlays/result-expanded — «Развернуть ↗» (ui-design §10, UI-014,
// UI-015, UI-017): the result of the open chat in a window like the
// cheatsheet (min(720px, 100vw − 32px), layer 950) without the sheet's
// height limit — a full Recap, a Review, or a draft result with its parts
// and, in debug mode, the debug footer. «Свернуть Esc» returns it to the
// dock sheet, which keeps showing it. The window holds focus and gives it
// back; a press on the scrim collapses it. Nothing is shown unless a view
// model says `expanded`. A lazy overlay.

import { type JSX } from 'preact';

import { type MountDeps } from '@cg/contracts/vm';

import {
  Button,
  Dialog,
  OverlayLayer,
  Spinner,
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
  /** Loaders of the dock's lazy parts (Recap and Review, the debug footer). */
  readonly parts?: Partial<DockParts>;
}

export function ExpandedView({ parts }: ExpandedViewProps): JSX.Element | null {
  const i18n = useI18n();
  const { deps, root } = useKit();
  const dispatch = useDispatch();
  const raw = useView({ of: 'dock' });
  const dock = useSteadyView(raw).value;
  const recap = useSteadyView(useView({ of: 'recap.view' })).value;
  const review = useSteadyView(useView({ of: 'review' })).value;
  const streamText = useStreamText(raw, (view) => view.result?.streamText ?? null);
  const all: DockParts = { ...DEFAULT_PARTS, ...parts };
  const result = dock.result !== null && dock.result.expanded && dock.result.state !== 'canceled' ? dock.result : null;
  const which = recap.expanded ? 'recap' : review.expanded ? 'review' : null;
  if (which === null && result === null) return null;

  const collapse = (): void => {
    if (which !== null) void dispatch({ type: 'ShowAnalysis', view: which, mode: 'sheet' });
    else if (result !== null) void dispatch({ type: 'ExpandResult', operationId: result.opId, expanded: false });
  };
  const title = i18n.t(which !== null ? featureKey(which) : result !== null ? featureKey(result.feature) : 'result.label');
  return (
    <OverlayLayer>
      <Dialog
        open
        label={`${i18n.t('result.label')}: ${title}`}
        size="wide"
        class="cg-xdlg"
        onClose={collapse}
        // Focus opens on «Свернуть», not on the first icon of the head (whose tooltip would pop up by itself).
        initialFocus={() => root.querySelector<HTMLElement>('.cg-xdlg .cg-collapse')}
      >
        {which !== null ? (
          <Analysis loader={all.analysis} which={which} debugPart={all.debug} />
        ) : result === null ? null : (
          <ResultContent
            result={result}
            mode={dock.mode}
            keysFooter={false}
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
