// Where the tab's surfaces are mounted (architecture.md §6.3, §10.1): the
// dock into the dock host's closed root, the toasts into the toast layer
// (960), and every other surface into its overlay layer — side panels 900,
// windows 950 — when it opens, out again when it closes. The one truth about
// what is open is R17's OverlayState: the early dispatcher reads it for its
// key decisions, the hosts mirror it as `data-dismissible-open`, and this
// module mounts by it. Each surface is its own lazy chunk (§11), loaded the
// first time it is shown.
//
// Every surface sits in the kit's error boundary (ER-020): a render that
// fails shows «Сбой интерфейса» (CG-UI-FAILED) in its own place and reports
// here — the surface and the error's class name, never a text. «Перезагрузить
// панель» comes back as `reload(kind)`: the surface is mounted anew.

import type { MountDeps, MountSurfaceKind } from '@cg/contracts/vm';
import type { OverlayState } from '@cg/core/application/navigation';
import type { OverlayKind } from '@cg/core/domain/hotkeys';
import type { MountManager, OverlayLayer } from '@cg/host-chatspace/isolated';

import type * as DockChunk from '../../../lazy/entries/dock';
import type * as AnalysisPartChunk from '../../../lazy/entries/dock-analysis';
import type * as DebugPartChunk from '../../../lazy/entries/dock-debug';
import type { LazyEntryName } from '../../../lazy/entries/names';

type Surface = DockChunk.SurfaceDefinition;

/** An overlay as it is mounted: the lazy entry that carries its surface, the layer of its host. */
interface OverlaySpec {
  readonly kind: MountSurfaceKind;
  readonly layer: OverlayLayer;
  readonly entry: LazyEntryName;
  /** The surface inside the entry's module. */
  readonly pick: (module: Record<string, unknown>) => Surface;
}

const surfaceOf = (module: Record<string, unknown>): Surface => module['surface'] as Surface;

/** What OverlayState calls open → what is mounted for it. A preview and a dialog are parts of other surfaces. */
export const OVERLAY_MOUNTS: Readonly<Partial<Record<OverlayKind, OverlaySpec>>> = {
  coach: { kind: 'coach', layer: 'panel', entry: 'coach', pick: surfaceOf },
  'fan-panel': { kind: 'fan-panel', layer: 'panel', entry: 'fan-panel', pick: surfaceOf },
  spenders: { kind: 'spenders', layer: 'modal', entry: 'spenders', pick: surfaceOf },
  newcomers: { kind: 'newcomers', layer: 'modal', entry: 'newcomers', pick: surfaceOf },
  palette: { kind: 'palette', layer: 'modal', entry: 'palette', pick: surfaceOf },
  'quick-jump': { kind: 'quick-jump', layer: 'modal', entry: 'palette', pick: (module) => module['quickJumpSurface'] as Surface },
  cheatsheet: { kind: 'cheatsheet', layer: 'modal', entry: 'cheatsheet', pick: surfaceOf },
  'result-expanded': { kind: 'result-expanded', layer: 'modal', entry: 'result-expanded', pick: surfaceOf },
};

export interface SurfaceMountsEnv {
  readonly mounts: MountManager;
  readonly deps: MountDeps;
  readonly ui: typeof DockChunk;
  readonly toasts: DockChunk.ToastHost;
  readonly overlays: OverlayState;
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

export function mountSurfaces(env: SurfaceMountsEnv): SurfaceMounts {
  const { mounts, deps, ui, overlays } = env;
  const options = { report: env.report };
  /** A surface on screen and how to put it there again. */
  const live = new Map<MountSurfaceKind, { mount: DockChunk.KitMount; again: () => DockChunk.KitMount }>();
  /** Overlays whose chunk is on its way; false — it closed meanwhile. */
  const loading = new Map<OverlayKind, boolean>();
  let disposed = false;

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
      },
    }),
  );
  // Toasts are not lazy (§10.1): the host's own queue and the background's toasts in one stack.
  put('toasts', () => ui.mountToasts(mounts.overlay('toast').root, deps, { ...options, host: env.toasts }));

  const drop = (kind: MountSurfaceKind): void => {
    const entry = live.get(kind);
    if (entry === undefined) return;
    live.delete(kind);
    entry.mount.unmount();
    env.onChange?.();
  };

  async function open(overlay: OverlayKind, spec: OverlaySpec): Promise<void> {
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
    if (!wanted || disposed || !overlays.isOpen(overlay)) return;
    try {
      put(spec.kind, () => ui.mountKitSurface(spec.kind, mounts.overlay(spec.layer).root, deps, surface, options));
    } catch (error) {
      // The mount itself failed (not a render inside its boundary): the window is not there, and says so.
      env.report({ kind: 'render', surface: spec.kind, code: 'CG-UI-FAILED', name: error instanceof Error ? error.name : typeof error });
      env.onLoadFailed(spec.kind);
      env.debug?.(spec.kind, error);
    }
  }

  const sync = (): void => {
    if (disposed) return;
    const now = new Set(overlays.list());
    for (const [overlay, spec] of Object.entries(OVERLAY_MOUNTS) as [OverlayKind, OverlaySpec][]) {
      if (now.has(overlay)) void open(overlay, spec);
      else {
        if (loading.has(overlay)) loading.set(overlay, false);
        drop(spec.kind);
      }
    }
  };
  const off = overlays.subscribe(sync);
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
      for (const kind of [...live.keys()]) drop(kind);
    },
  };
}
