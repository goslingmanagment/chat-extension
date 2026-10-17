// MountPort helpers (architecture.md §10.2 п. 5, §6.3; EX-012, CS-005): the
// host side creates a closed shadow root (dock host, overlay host) and hands
// it over; the kit adopts the shared sheets, mirrors the scheme on the host
// element as `data-scheme`, renders the surface into one `.cg-root`
// element inside KitRoot, and gives back an Unmount that releases everything
// it took: the Preact tree, the element, the subscriptions, the attributes
// and the sheets. Several surfaces may share one root (the overlay host):
// the sheets and the host's attributes go with the last of them.
// In a site's tab the surface comes with the site's profile (`deps.profile`,
// Project Unite architecture §1.5; R20 F5): the dock's variant goes on the
// host as `data-dock-variant`, next to `data-scheme`; the site's palette, if
// it gives one, and its variant's sheet are adopted after the surface's own
// sheets, and the palette is kept current. On ChatSpace that is the variant's
// name alone: its palette is the page's own, its rules are the shared ones.
// Extension pages (popup, options, debug) mount the same way into a
// container of their own document. Embedding into ChatSpace's DOM is the
// host side's job, never the UI's.

import { render, type FunctionComponent } from 'preact';

import { DOCK_VARIANT_ATTRIBUTE, SCHEME_ATTRIBUTE, type MountDeps, type MountPort, type MountSurfaceKind, type Unmount } from '@cg/contracts/vm';

import { ROOT_CLASS } from './base';
import { createKitEnv, type KitEnv, type KitFailure } from './context';
import { holdAttribute } from './holds';
import { KitRoot } from './root';
import { bindScheme, bindTextSize } from './scheme';
import { retainKitStyles } from './sheets';
import { adoptSheets, type StyleMode, type StyleSource } from './styles';
import { paletteSource } from './tokens';

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
  const { profile } = deps;
  const palette = profile?.palette;
  const site: StyleSource[] = [];
  if (palette !== undefined) site.push(paletteSource(palette.value));
  if (profile?.sheet !== undefined) site.push(profile.sheet);
  const styles = retainKitStyles(root, [...(definition.styles ?? []), ...site]);
  const releaseScheme = holdAttribute(host, SCHEME_ATTRIBUTE, deps.scheme.value);
  const offScheme = bindScheme(host, deps.scheme);
  const releaseVariant = profile === undefined ? null : holdAttribute(host, DOCK_VARIANT_ATTRIBUTE, profile.dock.variant);
  // A new palette rewrites the one shared sheet (the same id): every root of ours shows it at once.
  const offPalette = palette?.subscribe((value) => adoptSheets(root, [paletteSource(value)]));
  const container = root.ownerDocument.createElement('div');
  container.className = ROOT_CLASS;
  container.setAttribute('data-cg-surface', kind);
  // «Размер текста» on the surface's own root, inside the closed shadow root: never on the host the page sees (X22, X55).
  const offTextSize = bindTextSize(container, deps.textSize);
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
    offTextSize();
    offPalette?.();
    releaseVariant?.();
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
