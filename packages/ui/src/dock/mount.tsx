// TEMPORARY (integration step M1): mounts the status row of TempDockStatus
// into the dock host's closed shadow root through the kit's MountPort helper
// (shared sheets, scheme attribute, error boundary). R14's dock replaces it.

import { type MountDeps, type ValueSignal } from '@cg/contracts/vm';

import { mountKitSurface, type KitMount, type KitMountOptions } from '../kit/mount';
import { TEMP_DOCK_STYLES, TempDockStatus, type TempDockSmokeModel } from './TempDockStatus';

export function mountTempDock(root: ShadowRoot, deps: MountDeps, smoke: ValueSignal<TempDockSmokeModel>, options: KitMountOptions = {}): KitMount {
  return mountKitSurface('dock', root, deps, { view: () => <TempDockStatus smoke={smoke} />, styles: [TEMP_DOCK_STYLES] }, options);
}
