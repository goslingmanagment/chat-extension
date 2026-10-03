// The dock as a surface of the kit's MountPort (architecture.md §10.2 п. 5):
// `mountSurface('dock', root, deps)` renders it into the closed shadow root
// the host side created above the composer. The lazy entry of the extension
// exports `dockSurface`; nothing here reaches into ChatSpace's DOM.

import { type MountDeps } from '@cg/contracts/vm';

import { mountKitSurface, type KitMount, type KitMountOptions, type SurfaceDefinition } from '../kit';
import { DockView, type DockViewProps } from './Dock';
import { DOCK_STYLE } from './styles';

/** The dock's surface definition; `parts` replaces the loaders of its lazy parts. */
export function createDockSurface(options: DockViewProps = {}): SurfaceDefinition {
  return { view: () => <DockView {...options} />, styles: [DOCK_STYLE] };
}

export const dockSurface: SurfaceDefinition = createDockSurface();

/** Mounts the dock into the closed shadow root of the dock host. */
export function mountDockSurface(root: ShadowRoot, deps: MountDeps, options: KitMountOptions & DockViewProps = {}): KitMount {
  const { parts, ...mount } = options;
  return mountKitSurface('dock', root, deps, parts === undefined ? dockSurface : createDockSurface({ parts }), mount);
}
