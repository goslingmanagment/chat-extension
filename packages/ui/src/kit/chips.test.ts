// The kit shows every group and every icon the contracts name for a chip of the dock's bar (R20 F4): the
// vocabularies are the contracts' (`DockChipGroup`, `DockIconId` — contracts import only zod and cannot name the
// kit's icons), the drawing is the kit's, and this holds the two together.

import { describe, expect, expectTypeOf, it } from 'vitest';

import { DOCK_CHIP_GROUPS, DOCK_ICON_IDS, type DockIconId } from '@cg/contracts/vm';

import { DOCK_GROUP_SLOT, type DockIcon } from './chips';
import { ICON_NAMES, type IconName } from './components/Icon';

describe('[R20-F4] the kit draws the chips’ groups and icons', () => {
  it('every group of the contracts has its slot, and the kit has no slot for a group the contracts do not name', () => {
    expect(Object.keys(DOCK_GROUP_SLOT)).toEqual([...DOCK_CHIP_GROUPS]);
    for (const group of DOCK_CHIP_GROUPS) expect(DOCK_GROUP_SLOT[group].split(' ')[0], group).toBe('cg-slot');
    // A group's own class, where it has one: the classes the bar's sheet folds a narrow bar by (dock/styles.ts).
    expect(DOCK_CHIP_GROUPS.flatMap((group) => DOCK_GROUP_SLOT[group].split(' ').slice(1))).toEqual(['cg-slot--reply', 'cg-slot--two', 'cg-slot--boards']);
  });

  it('every icon id of a chip is an icon the kit draws, by the same name', () => {
    expect(DOCK_ICON_IDS.length).toBeGreaterThan(0);
    for (const id of DOCK_ICON_IDS) expect(ICON_NAMES as readonly string[], id).toContain(id);
    expectTypeOf<DockIcon>().toEqualTypeOf<DockIconId>();
    expectTypeOf<DockIconId>().toMatchTypeOf<IconName>();
  });
});
