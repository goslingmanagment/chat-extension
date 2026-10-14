// The site's profile for our interface (Project Unite, docs/project-unite/architecture.md §1.5; R20 F5, 1.15.0):
// the panel may look a little different on each site, so what differs is data the site gives, and the shared
// surfaces read it instead of ChatSpace's constants. Where the sites may differ: the colours, the dock's variant
// with its own rules, whole phrases that name the site. Where they may not: a component copied for one site —
// a look that differs more is a surface of the site's own (`ui/src/hosts/<host>/`), registered in its slice.
//
// The profile comes with the application's half of the site's adapter (§1.3): what only the application draws
// with stays out of the early bundle. The one part the early key dispatcher reads — the client of the vendored
// key scheme — is the early half's own (`HostAdapter.hotkeyClient`), not this profile's.
//
// Types and two constant lists only: the dock's first chunk pays for what it reads.

import { type Locale } from '../i18n/keys';
import { type ValueSignal } from './signal';

/**
 * A step of the host's colour scale, as the kit's tokens read it: `--color-om-neutral-900` → "26 24 19", an
 * "R G B" triplet (`ui/kit/tokens.ts`). ChatSpace's page defines them on its <html>; another site's adapter
 * translates its own page variables into them.
 */
export type HostPaletteName = `--color-om-${string}`;
export type HostPalette = Readonly<Record<HostPaletteName, string>>;

/** The dock's variants: its widths and the icons of its chips differ by site, as a sheet keyed on the variant. */
export const DOCK_VARIANTS = ['chatspace', 'fansly'] as const;
export type DockVariant = (typeof DOCK_VARIANTS)[number];

/** Set by the mount on our host element, next to `data-scheme`; a site's sheet keys its rules on it. The page sees it: a neutral name (X22). */
export const DOCK_VARIANT_ATTRIBUTE = 'data-dock-variant';

/** A site's own CSS for our roots, adopted after the kit's and the surface's sheets; the id keys the shared sheet. */
export interface HostSheet {
  readonly id: string;
  readonly css: string;
}

/**
 * Whole phrases that name the site, in one language (§3.4): «в ChatSpace» and «на Fansly» take different
 * prepositions, so a shared text never builds one from a bare name. Shared texts take them as they are.
 */
export interface HostPhrases {
  /** The site as a person calls it: «ChatSpace». */
  readonly site: string;
  /** Where things happen on it: «в ChatSpace», «на Fansly»; «in ChatSpace», «on Fansly». */
  readonly onSite: string;
}

export interface HostUiProfile {
  /**
   * The host's colour scale, live: the mount writes it on our host element and keeps it current. Absent — the
   * page's own `--color-om-*` reach our hosts by inheritance, and nothing is written (ChatSpace).
   */
  readonly palette?: ValueSignal<HostPalette>;
  readonly dock: {
    /** Mirrored as `data-dock-variant` on every host the kit mounts into. */
    readonly variant: DockVariant;
  };
  /** The rules of the site's variant (widths, the icons of its chips): absent — the shared rules alone (ChatSpace). */
  readonly sheet?: HostSheet;
  readonly phrases: Readonly<Record<Locale, HostPhrases>>;
}
