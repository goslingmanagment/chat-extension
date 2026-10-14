// The fictitious entry of a second site's lazy build that carries that site's profile for our interface, as
// Fansly's application half will (docs/project-unite/architecture.md §1.5): its palette and its variant's sheet,
// handed to the shared mount of the kit. Fixture of test/feature-slices.test.ts.

import type { HostUiProfile, MountDeps } from '@cg/contracts/vm';
import { mountKitSurface, type KitMount, type SurfaceDefinition } from '@cg/ui/kit';

export const SITE_UI: HostUiProfile = {
  palette: { value: { '--color-om-brand-500': '10 128 114' }, subscribe: () => () => undefined },
  dock: { variant: 'fansly' },
  sheet: { id: 'sitefix-variant', css: ':host([data-dock-variant="fansly"]) .cg-root { --cg-r-pill: 4px; }' },
  phrases: { ru: { site: 'Sitefix', onSite: 'на Sitefix' }, en: { site: 'Sitefix', onSite: 'on Sitefix' } },
};

/** A surface of the site, mounted as its tab mounts every surface: with its profile. */
export const mountOnSite = (root: ShadowRoot, deps: MountDeps, definition: SurfaceDefinition): KitMount => mountKitSurface('dock', root, { ...deps, profile: SITE_UI }, definition);
