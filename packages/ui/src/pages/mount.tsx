import { render } from 'preact';

import { type MountDeps, type MountSurfaceKind } from '@cg/contracts/vm';

import { mountKitPage, type KitMount, type KitMountOptions } from '../kit/mount';
import { PagePlaceholder, type PlaceholderProps } from './Placeholder';
import { TEMP_PAGES_STYLES, TempOptions, TempPopup, type TempPagePort } from './TempPages';

/** The debug pages until R16 builds them. */
export function mountPagePlaceholder(container: HTMLElement, props: PlaceholderProps): void {
  render(<PagePlaceholder {...props} />, container);
}

/** TEMPORARY (M1): the minimal options page or the status popup, in the kit's page frame. */
export function mountTempPage(page: Extract<MountSurfaceKind, 'options' | 'popup'>, container: HTMLElement, deps: MountDeps, port: TempPagePort, options: KitMountOptions = {}): KitMount {
  const view = page === 'options' ? () => <TempOptions port={port} /> : () => <TempPopup port={port} />;
  return mountKitPage(container, deps, { view, styles: [TEMP_PAGES_STYLES] }, { ...options, surface: page });
}
