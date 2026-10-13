// How the kit shows the chips of the dock's bar that come as data (R20 F4;
// docs/project-unite/architecture.md §1.4, §1.5): the slot of each group of
// chips and the icon of a chip. The vocabularies — `DockChipGroup`,
// `DockIconId` — are the contracts' (contracts import only zod, so they cannot
// name the kit's icons): a group without a row here, or an icon id the kit
// does not draw, fails the typecheck, and chips.test.ts holds the lists.

import { type DockChipGroup, type DockIconId } from '@cg/contracts/vm';

import { type IconName } from './components/Icon';

/**
 * The slot class of a chip, by its group; the bar's sheet folds a narrow bar by these (dock/styles.ts): a
 * `cg-slot--two` chip is its icon below 610 px and goes into «Ещё» below 500, the `cg-slot--boards` ones are icons
 * below 690 and go with them. Reply's slot carries what is left of a low quota.
 */
export const DOCK_GROUP_SLOT: Readonly<Record<DockChipGroup, string>> = {
  reply: 'cg-slot cg-slot--reply',
  draft: 'cg-slot',
  openers: 'cg-slot',
  analysis: 'cg-slot cg-slot--two',
  windows: 'cg-slot cg-slot--boards',
};

/**
 * The icon of a chip is the kit's own icon of that name: the bar hands a chip's `icon` to `Icon` as it is, so an id
 * the kit does not draw does not typecheck there (dock/Strip.tsx) — and chips.test.ts holds the list at run time.
 */
export type DockIcon = DockIconId & IconName;
