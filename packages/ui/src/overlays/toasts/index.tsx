// @cg/ui/overlays/toasts — the toast host of the overlay root (architecture.md
// §9.5, §10.1: not lazy; ui-design §3.9, §4.22): top right, 12 px under
// ChatSpace's top bar, never over its Send; newest first, at most three. It
// draws the controller's toasts (the `toasts` view: «AI готово · fan», errors
// of operations) and the UI's own (ToastPort, `createToastHost`). Toasts never
// take focus; their buttons are reachable with Tab; errors are alerts.

import { type JSX } from 'preact';

import { type MountDeps, type ToastVM } from '@cg/contracts/vm';

import { TOAST_MAX, ToastItem, mountKitSurface, useDispatch, useI18n, useKit, useView, type KitMount, type KitMountOptions, type StyleSource, type SurfaceDefinition } from '../../kit';
import { overlayRootCss } from '../layer';
import { type LocalToast, type ToastHost } from './store';

export { TOAST_LIFETIME_MS, TOAST_LIMIT, createToastHost, type LocalToast, type ToastHost, type ToastHostOptions } from './store';

/** Under ChatSpace's top bar by this much (ui-design §3.9). */
const TOP_GAP_PX = 12;

export interface ToastsViewProps {
  /** The UI's own queue; its toasts stand above the controller's. */
  readonly host?: ToastHost;
}

export function ToastsView({ host }: ToastsViewProps): JSX.Element {
  const i18n = useI18n();
  const { geometry } = useKit();
  const dispatch = useDispatch();
  const view = useView({ of: 'toasts' }).value;
  const local: readonly LocalToast[] = host?.toasts.value ?? [];
  const own: { readonly toast: ToastVM; readonly local: boolean }[] = local.map((toast) => ({
    local: true,
    toast: {
      id: toast.id,
      kind: toast.kind,
      code: toast.code,
      title: i18n.text(toast.title),
      body: toast.body === null ? null : i18n.text(toast.body),
      actions: [],
      copyCode: toast.kind === 'error' && toast.code !== null,
      expiresAt: toast.expiresAt,
    },
  }));
  const all = [...own, ...view.toasts.map((toast) => ({ toast, local: false }))].slice(0, TOAST_MAX);
  const box = geometry.value.container;
  return (
    <div class="cg-toasts" aria-live="polite" style={box === null ? undefined : { top: `${box.top + TOP_GAP_PX}px` }}>
      {all.map(({ toast, local: mine }) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => (mine ? host?.dismiss(toast.id) : void dispatch({ type: 'DismissToast', toastId: toast.id }))}
          onHold={(hold) => (mine ? host?.hold(toast.id, hold) : void dispatch({ type: 'HoldToast', toastId: toast.id, hold }))}
        />
      ))}
    </div>
  );
}

export const TOASTS_CSS = overlayRootCss('toasts', 'toast');
export const TOASTS_STYLE: StyleSource = { id: 'cg-toasts', css: TOASTS_CSS };

/** The toasts surface; with a `host` it also shows what the UI raised through ToastPort. */
export function createToastsSurface(host?: ToastHost): SurfaceDefinition {
  return { view: () => <ToastsView {...(host === undefined ? {} : { host })} />, styles: [TOASTS_STYLE] };
}

export const toastsSurface: SurfaceDefinition = createToastsSurface();

/** Mounts the toast host into the overlay root. */
export function mountToasts(root: ShadowRoot, deps: MountDeps, options: KitMountOptions & ToastsViewProps = {}): KitMount {
  const { host, ...mount } = options;
  return mountKitSurface('toasts', root, deps, createToastsSurface(host), mount);
}
