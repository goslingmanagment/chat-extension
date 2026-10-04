// Where the tab's surfaces are mounted (tab/surfaces.ts): the dock and the
// toasts at once, every overlay with its first show — by R17's OverlayState,
// on the layer of its kind, from its own lazy chunk.

import type { MountDeps, MountSurfaceKind } from '@cg/contracts/vm';
import { createOverlayState } from '@cg/core/application/navigation';
import { OVERLAY_Z, createMountManager, type MountManager } from '@cg/host-chatspace/isolated';
import { afterEach, describe, expect, it } from 'vitest';

import type * as DockChunk from '../../../lazy/entries/dock';
import { LAZY_ENTRIES } from '../../../lazy/entries/names';
import { OVERLAY_MOUNTS, mountSurfaces, type SurfaceMounts } from './surfaces';

interface Loader {
  resolve(module: Record<string, unknown>): void;
  reject(error: Error): void;
}

let mounts: MountManager | null = null;
let surfaces: SurfaceMounts | null = null;
afterEach(() => {
  surfaces?.dispose();
  mounts?.dispose();
  surfaces = null;
  mounts = null;
});

function world() {
  const manager = (mounts = createMountManager(document));
  const overlays = createOverlayState();
  const log: string[] = [];
  const failures: string[] = [];
  const closed: string[] = [];
  const loaders = new Map<string, Loader>();
  const asked: string[] = [];
  /** The layer of the root a surface was mounted into. */
  const layerOf = (root: ShadowRoot): string => {
    if (root === manager.dock.root) return 'dock';
    return String((root.host as HTMLElement).style.zIndex);
  };
  const mount = (kind: MountSurfaceKind, root: ShadowRoot): DockChunk.KitMount => {
    log.push(`mount:${kind}@${layerOf(root)}`);
    return { styleMode: 'adopted', unmount: () => void log.push(`unmount:${kind}`) } as unknown as DockChunk.KitMount;
  };
  const ui = {
    mountDockSurface: (root: ShadowRoot, _deps: MountDeps, options: { parts?: unknown }) => {
      expect(options.parts).toBeDefined();
      return mount('dock', root);
    },
    mountToasts: (root: ShadowRoot) => mount('toasts', root),
    mountKitSurface: (kind: MountSurfaceKind, root: ShadowRoot, _deps: MountDeps, surface: { readonly name: string }) => {
      log.push(`surface:${surface.name}`);
      return mount(kind, root);
    },
  } as unknown as typeof DockChunk;
  const made = (surfaces = mountSurfaces({
    mounts: manager,
    deps: {} as MountDeps,
    ui,
    toasts: {} as DockChunk.ToastHost,
    overlays,
    lazy: <T>(entry: string) =>
      new Promise<T>((resolve, reject) => {
        asked.push(entry);
        loaders.set(entry, { resolve: (module) => resolve(module as T), reject });
      }),
    report: (failure) => void failures.push(`${failure.surface ?? 'none'}:${failure.name}`),
    onLoadFailed: (kind) => void closed.push(kind),
  }));
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  return { overlays, log, failures, closed, loaders, asked, surfaces: made, settle };
}

describe('the surfaces of a tab', () => {
  it('[EX-012] the dock goes into the dock host’s root and the toasts on layer 960, at once — with the dock’s lazy parts as entries of the extension', () => {
    const w = world();
    expect(w.log).toEqual(['mount:dock@dock', `mount:toasts@${OVERLAY_Z.toast}`]);
    expect(w.surfaces.mounted()).toEqual(['dock', 'toasts']);
    expect(w.surfaces.dockStyleMode).toBe('adopted');
    expect(w.asked).toEqual([]);
  });

  it('[EX-009] an overlay is loaded with its first show and mounted on its layer: side panels 900, windows 950', async () => {
    const w = world();
    w.overlays.set('coach', true);
    w.overlays.set('spenders', true);
    expect(w.asked).toEqual(['coach', 'spenders']);
    expect(w.surfaces.mounted()).toEqual(['dock', 'toasts']);
    w.loaders.get('coach')?.resolve({ surface: { name: 'coach' } });
    w.loaders.get('spenders')?.resolve({ surface: { name: 'spenders' } });
    await w.settle();
    expect(w.log.slice(2)).toEqual(['surface:coach', `mount:coach@${OVERLAY_Z.panel}`, 'surface:spenders', `mount:spenders@${OVERLAY_Z.modal}`]);
    w.overlays.set('coach', false);
    expect(w.log.at(-1)).toBe('unmount:coach');
    expect(w.surfaces.mounted()).toEqual(['dock', 'toasts', 'spenders']);
  });

  it('the quick jump is the palette chunk’s second surface; a preview and a dialog mount nothing of their own', async () => {
    const w = world();
    w.overlays.set('quick-jump', true);
    w.overlays.setPreview('spenders');
    w.overlays.set('dialog', true);
    expect(w.asked).toEqual(['palette']);
    w.loaders.get('palette')?.resolve({ surface: { name: 'palette' }, quickJumpSurface: { name: 'quick-jump' } });
    await w.settle();
    expect(w.log.slice(2)).toEqual(['surface:quick-jump', `mount:quick-jump@${OVERLAY_Z.modal}`]);
  });

  it('an overlay closed while its chunk was loading is not mounted; opened again, it is', async () => {
    const w = world();
    w.overlays.set('cheatsheet', true);
    w.overlays.set('cheatsheet', false);
    w.loaders.get('cheatsheet')?.resolve({ surface: { name: 'cheatsheet' } });
    await w.settle();
    expect(w.surfaces.mounted()).toEqual(['dock', 'toasts']);
    w.overlays.set('cheatsheet', true);
    w.loaders.get('cheatsheet')?.resolve({ surface: { name: 'cheatsheet' } });
    await w.settle();
    expect(w.surfaces.mounted()).toEqual(['dock', 'toasts', 'cheatsheet']);
  });

  it('[ER-020] a chunk that does not load is reported — the surface and a class name — and the overlay is given back', async () => {
    const w = world();
    w.overlays.set('newcomers', true);
    w.loaders.get('newcomers')?.reject(new TypeError('error loading dynamically imported module'));
    await w.settle();
    expect(w.failures).toEqual(['newcomers:ChunkLoadError']);
    expect(w.closed).toEqual(['newcomers']);
    expect(w.surfaces.mounted()).toEqual(['dock', 'toasts']);
  });

  it('[ER-020] «Перезагрузить панель» mounts the surface again in its place; a surface that is not on screen is not reloaded', async () => {
    const w = world();
    expect(w.surfaces.reload('dock')).toBe(true);
    expect(w.log.slice(2)).toEqual(['unmount:dock', 'mount:dock@dock']);
    expect(w.surfaces.reload('coach')).toBe(false);
    w.overlays.set('fan-panel', true);
    w.loaders.get('fan-panel')?.resolve({ surface: { name: 'fan-panel' } });
    await w.settle();
    expect(w.surfaces.reload('fan-panel')).toBe(true);
    expect(w.log.slice(-3)).toEqual(['unmount:fan-panel', 'surface:fan-panel', `mount:fan-panel@${OVERLAY_Z.panel}`]);
  });

  it('dispose unmounts everything and follows the overlays no more', () => {
    const w = world();
    w.surfaces.dispose();
    expect(w.log.slice(2).sort()).toEqual(['unmount:dock', 'unmount:toasts']);
    w.overlays.set('palette', true);
    expect(w.asked).toEqual([]);
  });

  it('every overlay names a lazy entry of the build', () => {
    for (const spec of Object.values(OVERLAY_MOUNTS)) expect(Object.keys(LAZY_ENTRIES)).toContain(spec.entry);
    // Surfaces the contracts know and no overlay state opens here are mounted elsewhere: the dock, the toasts, the pages.
    expect(Object.keys(OVERLAY_MOUNTS).sort()).toEqual(['cheatsheet', 'coach', 'fan-panel', 'newcomers', 'palette', 'quick-jump', 'result-expanded', 'spenders']);
  });
});
