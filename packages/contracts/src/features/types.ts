// The feature manifest (R20, docs/project-unite/architecture.md §1.4): what a
// feature is whichever site shows it (`FeatureCommon`) and what it needs on
// one site (`FeatureOnHost`). Data in three files — `common.ts` and one file
// per site (`chatspace.ts`, `fansly.ts`); a site's composition root imports
// the common file and its OWN site file, so the slice is cut by the module
// graph at build time and a bundle of one site carries no entry of the other.
// A site file is imported by its subpath only, never from the root.
//
// Types and three small vocabularies; no zod, and nothing of another module at
// run time (`import type` only): any world may import it. Who reads a slice is
// `admission` of core (`core/src/domain/features/admission.ts`).

import type { HostCapability } from '../host';
import type { ClientFeatureFlag, ClientHubCapability } from '../hub/wire';
import type { DockChipGroup, DockIconId } from '../vm/dock';
import type { MountSurfaceKind } from '../vm/selectors';

/** What kind of thing a feature is: a generation, a window with a list, a panel, an action in the site's page, a service nobody sees. */
export const FEATURE_KINDS = ['ai', 'board', 'panel', 'host-action', 'service'] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];

/**
 * The actions of the vendored `@chatgoose/hotkeys` scheme, repeated here: contracts import only zod. A test of
 * `core/src/domain/hotkeys` holds the list to the vendored scheme, both ways.
 */
export const HOTKEY_ACTION_IDS = ['reply', 'fix', 'hi', 'ping', 'cancel', 'help', 'recap', 'tone', 'review', 'split', 'spenders', 'coach', 'notes'] as const;
export type HotkeyActionId = (typeof HOTKEY_ACTION_IDS)[number];

/** What a person does with a feature, each admitted on its own: start a generation, put a result into the site's field, send it to the fan. */
export const ADMISSION_ACTIONS = ['generate', 'insert', 'send'] as const;
export type AdmissionAction = (typeof ADMISSION_ACTIONS)[number];

/** The chip of a feature in the dock's bar: its group, its place in the group (ascending), the icon a narrow bar shows instead of the word (null — the word stays). */
export interface FeatureChip {
  readonly group: DockChipGroup;
  readonly priority: number;
  readonly icon: DockIconId | null;
}

/** What a feature is on every site that has it. No word about a site here. */
export interface FeatureCommon {
  readonly kind: FeatureKind;
  readonly chip?: FeatureChip;
  /** The scheme action that carries the feature's key. */
  readonly hotkey?: HotkeyActionId;
}

/**
 * What must hold, all of it (AND). `F`, `C` — the switches and the capabilities a site's file may name: the shared
 * vocabularies by default; a site ahead of them widens its own (features/fansly.ts).
 */
export interface Requirement<F extends string = ClientFeatureFlag, C extends string = HostCapability> {
  /** The owner's switches of the page (`pages[].features[flag]` of the bootstrap). The hub has already weighed the platform and what it serves there. */
  readonly flags: readonly F[];
  /** Capabilities of the site's contract report. */
  readonly hostCapabilities: readonly C[];
  /** What this client's own calls need of the hub on top of the hub's decision about the page (the transport: a request header, a frame). */
  readonly clientNeeds?: readonly ClientHubCapability[];
}

/** Where a feature's data come from on a site: the hub, a pass of the background over the site's API, the page itself. */
export type FeatureSource = 'hub' | 'host-pass' | 'page';

/** A feature on one site. */
export interface FeatureOnHost<F extends string = ClientFeatureFlag, C extends string = HostCapability, S extends string = MountSurfaceKind> {
  /** Needed whatever is done with the feature. */
  readonly base: Requirement<F, C>;
  /** What an action needs on top of `base`. An action that is not listed does not exist for the feature on this site. */
  readonly actions: Readonly<Partial<Record<AdmissionAction, Requirement<F, C>>>>;
  readonly surfaces: readonly S[];
  readonly source?: FeatureSource;
}

/** A feature of a site's slice: its common part and its part on that site. */
export interface FeatureEntry<F extends string = ClientFeatureFlag, C extends string = HostCapability, S extends string = MountSurfaceKind> extends FeatureCommon, FeatureOnHost<F, C, S> {}

/**
 * A site's slice of the manifest by feature key, as shared code reads it: the names are open strings there — a
 * switch the hub does not list for a page reads `flag_off`, a capability the site's report does not carry reads off.
 * A feature that is not in the slice does not exist on the site (`absent`).
 */
export type FeatureSlice = Readonly<Record<string, FeatureEntry<string, string, string>>>;
