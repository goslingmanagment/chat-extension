// Keys and navigation of the tab (R17; architecture.md §9.1, §6.9): the
// runner that turns the early dispatcher's commands into UiActions, the
// action catalog (exact keys and labels for the OS), and the controllers of
// chat navigation, the palette, the quick jump and the cheatsheet. Loaded
// with the dock: its buttons print their keys from the catalog.

export { createHotkeyRunner } from '@cg/core/application/hotkeys';
export {
  accountHandle,
  chatHandle,
  createCheatsheetController,
  createNavigationController,
  createPaletteController,
  createQuickJumpController,
  createTalkingController,
  type NavigationController,
  type TalkingController,
} from '@cg/core/application/navigation';
export { createActionCatalog } from '@cg/core/domain/hotkeys';
