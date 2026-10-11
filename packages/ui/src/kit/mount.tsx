// MountPort helpers (architecture.md §10.2 п. 5, §6.3; EX-012, CS-005): the
// host side creates a closed shadow root (dock host, overlay host) and hands
// it over; the kit adopts the shared sheets, mirrors the scheme on the host
// element as `data-scheme`, renders the surface into one `.cg-root`
// element inside KitRoot, and gives back an Unmount that releases everything
// it took: the Preact tree, the element, the subscriptions, the attributes
// and the sheets. Several surfaces may share one root (the overlay host):
// the sheets and the host's attributes go with the last of them.
// Extension pages (popup, options, debug) mount the same way into a
// container of their own document. Embedding into ChatSpace's DOM is the
// host side's job, never the UI's.

import { render, type FunctionComponent } from 'preact';

import { SCHEME_ATTRIBUTE, type MountDeps, type MountPort, type MountSurfaceKind, type Unmount } from '@cg/contracts/vm';

import { ROOT_CLASS } from './base';
import { createKitEnv, type KitEnv, type KitFailure } from './context';
import { holdAttribute } from './holds';
import { KitRoot } from './root';
import { bindScheme } from './scheme';
import { retainKitStyles } from './sheets';
import { type StyleMode, type StyleSource } from './styles';

/** A surface as the kit mounts it: its root component and its own CSS. */
export interface SurfaceDefinition {
  /** Reads its view models with `useView`; renders inside KitRoot. */
  readonly view: FunctionComponent;
  /** Adopted after the kit's sheets, shared across roots like them. */
  readonly styles?: readonly StyleSource[];
}

export interface KitMountOptions {
  /** Where render, dispatch, clipboard and page failures go (the composition root logs them, R18). */
  readonly report?: (failure: KitFailure) => void;
  /** The clock (the stand's fake clock). */
  readonly now?: () => number;
}

export interface KitMount {
  readonly styleMode: StyleMode;
  readonly env: KitEnv;
  /** The `.cg-root` element the surface renders into. */
  readonly container: HTMLElement;
  /** Idempotent. */
  readonly unmount: Unmount;
}

function envOptions(options: KitMountOptions): { now?: () => number; report?: (failure: KitFailure) => void } {
  return { ...(options.now === undefined ? {} : { now: options.now }), ...(options.report === undefined ? {} : { report: options.report }) };
}

/** Mounts one surface into a closed shadow root the host side created. */
export function mountKitSurface(kind: MountSurfaceKind, root: ShadowRoot, deps: MountDeps, definition: SurfaceDefinition, options: KitMountOptions = {}): KitMount {
  const host = root.host as HTMLElement;
  const styles = retainKitStyles(root, definition.styles ?? []);
  const releaseScheme = holdAttribute(host, SCHEME_ATTRIBUTE, deps.scheme.value);
  const offScheme = bindScheme(host, deps.scheme);
  const container = root.ownerDocument.createElement('div');
  container.className = ROOT_CLASS;
  container.setAttribute('data-cg-surface', kind);
  root.append(container);
  const env = createKitEnv({ deps, root, host, surface: kind, ...envOptions(options) });
  const View = definition.view;
  render(
    <KitRoot env={env} surface={kind}>
      <View />
    </KitRoot>,
    container,
  );
  let released = false;
  const unmount = (): void => {
    if (released) return;
    released = true;
    render(null, container);
    container.remove();
    env.dispose();
    offScheme();
    releaseScheme();
    styles.release();
  };
  return { styleMode: styles.mode, env, container, unmount };
}

/** The UI's MountPort over surface definitions: `mountSurface(kind, root, deps) => Unmount`. */
export function createMountPort(surfaces: Readonly<Partial<Record<MountSurfaceKind, SurfaceDefinition>>>, options: KitMountOptions = {}): MountPort<ShadowRoot> {
  return {
    mountSurface(kind, root, deps) {
      const definition = surfaces[kind];
      if (definition === undefined) throw new Error(`ui/kit: no view for the surface «${kind}»`);
      return mountKitSurface(kind, root, deps, definition, options).unmount;
    },
  };
}

/**
 * An extension page (popup, options, debug): the sheets go to the document,
 * the scheme to <html> (`host` resolves as `system` there, §2.1), the page
 * font (locally installed only, I18-007) to the container. The container
 * names its surface as a shadow root's `.cg-root` does (`data-cg-surface`):
 * a page's sheet sizes its own root by it (the popup's panel, pages/styles).
 */
export function mountKitPage(
  container: HTMLElement,
  deps: MountDeps,
  definition: SurfaceDefinition,
  options: KitMountOptions & { readonly surface?: MountSurfaceKind | null } = {},
): KitMount {
  const document = container.ownerDocument;
  const styles = retainKitStyles(document, definition.styles ?? []);
  const releaseScheme = holdAttribute(document.documentElement, SCHEME_ATTRIBUTE, deps.scheme.value);
  const offScheme = bindScheme(document.documentElement, deps.scheme);
  const surface = options.surface ?? null;
  container.classList.add(ROOT_CLASS, 'cg-root--page');
  if (surface !== null) container.setAttribute('data-cg-surface', surface);
  const env = createKitEnv({ deps, root: document, host: null, surface, ...envOptions(options) });
  const View = definition.view;
  render(
    <KitRoot env={env} surface={surface}>
      <View />
    </KitRoot>,
    container,
  );
  let released = false;
  const unmount = (): void => {
    if (released) return;
    released = true;
    render(null, container);
    container.classList.remove(ROOT_CLASS, 'cg-root--page');
    container.removeAttribute('data-cg-surface');
    env.dispose();
    offScheme();
    releaseScheme();
    styles.release();
  };
  return { styleMode: styles.mode, env, container, unmount };
}

/**
 * ER-021 for our extension pages: an uncaught error or rejection of the page
 * is reported (class name only, never its message: it may quote a draft).
 * Only for documents that are ours — never ChatSpace's window.
 */
export function capturePageErrors(view: Window, report: (failure: KitFailure) => void, surface: MountSurfaceKind | null = null): () => void {
  const nameOf = (value: unknown): string => (value instanceof Error ? value.name : value === null ? 'null' : typeof value);
  const onError = (event: ErrorEvent): void => report({ kind: 'page', surface, code: 'CG-UI-FAILED', name: nameOf(event.error ?? null) });
  const onRejection = (event: PromiseRejectionEvent): void => report({ kind: 'page', surface, code: 'CG-UI-FAILED', name: nameOf(event.reason) });
  view.addEventListener('error', onError);
  view.addEventListener('unhandledrejection', onRejection);
  return () => {
    view.removeEventListener('error', onError);
    view.removeEventListener('unhandledrejection', onRejection);
  };
}
