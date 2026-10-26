// Where the tab's surfaces are mounted (architecture.md §6.3, §10.1): the
// dock into the dock host's closed root, the toasts into the toast layer
// (960), and every other surface into its overlay layer — side panels 900,
// windows 950 — when it opens, out again when it closes. The one truth about
// what is open is R17's OverlayState: the early dispatcher reads it for its
// key decisions, the hosts mirror it as `data-dismissible-open`, and this
// module mounts by it. Each surface is its own lazy chunk (§11), loaded the
// first time it is shown.
//
// The overlay hosts are children of <html>, outside ChatSpace's application
// root, and our UI takes the host's font (`font-family: inherit`, ui-design
// §2.3): a font ChatSpace sets below <html> would never reach them. So an
// overlay host is given the font of the place the dock sits in — the page's
// body when no dock is on screen — each time a surface is mounted into it.
//
// Every surface sits in the kit's error boundary (ER-020): a render that
// fails shows «Сбой интерфейса» (CG-UI-FAILED) in its own place and reports
// here — the surface and the error's class name, never a text. «Перезагрузить
// панель» comes back as `reload(kind)`: the surface is mounted anew.

import type { MountDeps, MountSurfaceKind } from '@cg/contracts/vm';
import type { OverlayState } from '@cg/core/application/navigation';
import type { OverlayKind } from '@cg/core/domain/hotkeys';

import type * as DockChunk from '../../../lazy/entries/dock';
import type * as AnalysisPartChunk from '../../../lazy/entries/dock-analysis';
import type * as DebugPartChunk from '../../../lazy/entries/dock-debug';
import type * as VoicePartChunk from '../../../lazy/entries/dock-voice';
import type { LazyEntryName } from '../../../lazy/entries/names';
import type { HostMounts, OverlayLayer } from './adapter';

type Surface = DockChunk.SurfaceDefinition;

/** An overlay as it is mounted: the lazy entry that carries its surface, the layer of its host. */
interface OverlaySpec {
  readonly kind: MountSurfaceKind;
  readonly layer: OverlayLayer;
  readonly entry: LazyEntryName;
  /** The surface inside the entry's module. */
  readonly pick: (module: Record<string, unknown>) => Surface;
  /** Mounted only while this holds too (the overlay alone may stand for a part of another window); absent — always. */
  readonly only?: (overlays: OverlayState) => boolean;
  /**
   * A side panel at the right edge of the container (the fan panel): it takes the panel geometry, which ends above a
   * dock under its 320 px, and the toasts stand left of it. Coach is a window centred over the chat (X63): neither.
   */
  readonly edge?: true;
}

const surfaceOf = (module: Record<string, unknown>): Surface => module['surface'] as Surface;

/**
 * What OverlayState calls open → what is mounted for it. A dialog is a part of another surface, and so is a
 * preview from Spenders or «Новые»; a preview from the palette's «Онлайн» is a window of its own (CS-030, X24).
 */
export const OVERLAY_MOUNTS: Readonly<Partial<Record<OverlayKind, OverlaySpec>>> = {
  coach: { kind: 'coach', layer: 'panel', entry: 'coach', pick: surfaceOf },
  'fan-panel': { kind: 'fan-panel', layer: 'panel', entry: 'fan-panel', pick: surfaceOf, edge: true },
  spenders: { kind: 'spenders', layer: 'modal', entry: 'spenders', pick: surfaceOf },
  newcomers: { kind: 'newcomers', layer: 'modal', entry: 'newcomers', pick: surfaceOf },
  outreach: { kind: 'outreach', layer: 'modal', entry: 'outreach', pick: surfaceOf },
  online: { kind: 'online', layer: 'modal', entry: 'online', pick: surfaceOf },
  preview: { kind: 'preview', layer: 'modal', entry: 'preview', pick: surfaceOf, only: (overlays) => overlays.previewFrom() === 'palette' },
  palette: { kind: 'palette', layer: 'modal', entry: 'palette', pick: surfaceOf },
  'quick-jump': { kind: 'quick-jump', layer: 'modal', entry: 'palette', pick: (module) => module['quickJumpSurface'] as Surface },
  cheatsheet: { kind: 'cheatsheet', layer: 'modal', entry: 'cheatsheet', pick: surfaceOf },
  'result-expanded': { kind: 'result-expanded', layer: 'modal', entry: 'result-expanded', pick: surfaceOf },
};

/**
 * What stands over the page while something holds it up, not a window: «Рассылка» folded into its chip. No key of the
 * page is taken for it, and it covers nothing but itself.
 */
export type PinKind = 'outreach-chip';

export const PIN_MOUNTS: Readonly<Record<PinKind, OverlaySpec>> = {
  'outreach-chip': { kind: 'outreach-chip', layer: 'panel', entry: 'outreach', pick: (module) => module['chipSurface'] as Surface },
};

/** Which pins are up: the boards set it (their «Рассылка» folded), the mounts follow it. */
export interface PinState {
  isOn(pin: PinKind): boolean;
  set(pin: PinKind, on: boolean): void;
  subscribe(listener: () => void): () => void;
}

export function createPinState(): PinState {
  const on = new Set<PinKind>();
  const listeners = new Set<() => void>();
  return {
    isOn: (pin) => on.has(pin),
    set(pin, value) {
      if (on.has(pin) === value) return;
      if (value) on.add(pin);
      else on.delete(pin);
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface SurfaceMountsEnv {
  readonly mounts: HostMounts;
  readonly deps: MountDeps;
  /** What the side panels at the edge (`OverlaySpec.edge`) are mounted with: `deps` with their own geometry (tab/panel-geometry.ts). `deps` when absent. */
  readonly panelDeps?: MountDeps;
  readonly ui: typeof DockChunk;
  readonly toasts: DockChunk.ToastHost;
  readonly overlays: OverlayState;
  /** What stands over the page without being a window (PIN_MOUNTS); absent — none. */
  readonly pins?: PinState;
  readonly lazy: <T>(entry: LazyEntryName) => Promise<T>;
  /** A surface failed to render, to dispatch or to load: facts only. */
  readonly report: (failure: DockChunk.KitFailure) => void;
  /** An overlay's chunk did not load: the person is told, the overlay is closed again. */
  readonly onLoadFailed: (kind: MountSurfaceKind) => void;
  /** Test builds only: the failure itself, for the e2e report. */
  readonly debug?: (kind: MountSurfaceKind, error: unknown) => void;
  /** What is on screen changed: a surface was mounted or taken away. */
  readonly onChange?: () => void;
}

export interface SurfaceMounts {
  /** Mounts the surface again («Перезагрузить панель», ER-020); false — it is not on screen. */
  reload(kind: MountSurfaceKind): boolean;
  /** Surfaces on screen now. */
  mounted(): readonly MountSurfaceKind[];
  /** How the dock's sheets were attached (`adopted` — constructable sheets, EX-012). */
  readonly dockStyleMode: string;
  dispose(): void;
}

/** What of ChatSpace's text rendering an overlay host takes over: the font and, in Firefox on macOS, its smoothing. */
const HOST_FONT_PROPERTIES = ['font-family', '-moz-osx-font-smoothing'] as const;

/** The closed root of an overlay layer, its host dressed in ChatSpace's font (see the head of this file). */
export function overlayRoot(mounts: Pick<HostMounts, 'dock' | 'overlay'>, layer: OverlayLayer): ShadowRoot {
  const { host, root } = mounts.overlay(layer);
  const doc = host.ownerDocument;
  const beside = mounts.dock.host.parentElement;
  const from = beside !== null && beside.isConnected ? beside : doc.body;
  const style = doc.defaultView?.getComputedStyle(from) ?? null;
  if (style !== null) {
    for (const property of HOST_FONT_PROPERTIES) {
      const value = style.getPropertyValue(property);
      if (value !== '' && host.style.getPropertyValue(property) !== value) host.style.setProperty(property, value);
    }
  }
  return root;
}

export function mountSurfaces(env: SurfaceMountsEnv): SurfaceMounts {
  const { mounts, deps, ui, overlays } = env;
  const options = { report: env.report };
  /** A surface on screen and how to put it there again. */
  const live = new Map<MountSurfaceKind, { mount: DockChunk.KitMount; again: () => DockChunk.KitMount }>();
  /** Overlays (and pins) whose chunk is on its way; false — it closed meanwhile. */
  const loading = new Map<OverlayKind | PinKind, boolean>();
  let disposed = false;

  const layerRoot = (layer: OverlayLayer): ShadowRoot => overlayRoot(mounts, layer);
  /** The overlay is open and stands for this surface now. */
  const shown = (overlay: OverlayKind, spec: OverlaySpec): boolean => overlays.isOpen(overlay) && (spec.only?.(overlays) ?? true);

  const put = (kind: MountSurfaceKind, again: () => DockChunk.KitMount): DockChunk.KitMount => {
    const mount = again();
    live.set(kind, { mount, again });
    env.onChange?.();
    return mount;
  };

  // The dock: one tree for the life of the tab — its host moves between composers and keeps it (§6.3).
  const dock = put('dock', () =>
    ui.mountDockSurface(mounts.dock.root, deps, {
      ...options,
      // The dock's lazy parts as entries of the extension, with their own budget lines and the loader's one retry.
      parts: {
        analysis: () => env.lazy<typeof AnalysisPartChunk>('dock-analysis').then((module) => module.analysisPart),
        debug: () => env.lazy<typeof DebugPartChunk>('dock-debug').then((module) => module.debugPart),
        voice: () => env.lazy<typeof VoicePartChunk>('dock-voice').then((module) => module.voicePart),
      },
    }),
  );
  // Toasts are not lazy (§10.1): the host's own queue and the background's toasts in one stack.
  put('toasts', () => ui.mountToasts(layerRoot('toast'), deps, { ...options, host: env.toasts }));

  const drop = (kind: MountSurfaceKind): void => {
    const entry = live.get(kind);
    if (entry === undefined) return;
    live.delete(kind);
    entry.mount.unmount();
    env.onChange?.();
  };

  async function open(overlay: OverlayKind | PinKind, spec: OverlaySpec, shownNow: () => boolean = () => shown(overlay as OverlayKind, spec)): Promise<void> {
    if (live.has(spec.kind) || loading.has(overlay)) {
      if (loading.has(overlay)) loading.set(overlay, true);
      return;
    }
    loading.set(overlay, true);
    let surface: Surface;
    try {
      surface = spec.pick(await env.lazy<Record<string, unknown>>(spec.entry));
    } catch (error) {
      loading.delete(overlay);
      env.report({ kind: 'render', surface: spec.kind, code: 'CG-UI-FAILED', name: 'ChunkLoadError' });
      env.onLoadFailed(spec.kind);
      env.debug?.(spec.kind, error);
      return;
    }
    const wanted = loading.get(overlay) === true;
    loading.delete(overlay);
    // Closed, or the tab went away, while the chunk was loading.
    if (!wanted || disposed || !shownNow()) return;
    try {
      put(spec.kind, () => ui.mountKitSurface(spec.kind, layerRoot(spec.layer), spec.edge === true ? (env.panelDeps ?? deps) : deps, surface, options));
    } catch (error) {
      // The mount itself failed (not a render inside its boundary): the window is not there, and says so.
      env.report({ kind: 'render', surface: spec.kind, code: 'CG-UI-FAILED', name: error instanceof Error ? error.name : typeof error });
      env.onLoadFailed(spec.kind);
      env.debug?.(spec.kind, error);
    }
  }

  const sync = (): void => {
    if (disposed) return;
    for (const [overlay, spec] of Object.entries(OVERLAY_MOUNTS) as [OverlayKind, OverlaySpec][]) {
      if (shown(overlay, spec)) void open(overlay, spec);
      else {
        if (loading.has(overlay)) loading.set(overlay, false);
        drop(spec.kind);
      }
    }
    const pins = env.pins;
    for (const [pin, spec] of Object.entries(PIN_MOUNTS) as [PinKind, OverlaySpec][]) {
      const up = (): boolean => pins?.isOn(pin) === true;
      if (up()) void open(pin, spec, up);
      else {
        if (loading.has(pin)) loading.set(pin, false);
        drop(spec.kind);
      }
    }
  };
  const off = overlays.subscribe(sync);
  const offPins = env.pins?.subscribe(sync) ?? null;
  sync();

  return {
    reload(kind) {
      const entry = live.get(kind);
      if (entry === undefined) return false;
      entry.mount.unmount();
      live.set(kind, { mount: entry.again(), again: entry.again });
      return true;
    },
    mounted: () => [...live.keys()],
    dockStyleMode: dock.styleMode,
    dispose() {
      disposed = true;
      off();
      offPins?.();
      for (const kind of [...live.keys()]) drop(kind);
    },
  };
}
