// core/domain/hotkeys — the keys of ChatGoose as pure data and rules
// (architecture.md §9.1): the key table over the vendored scheme, the one
// resolver of a tab, the ownership policy, the delivery table, the
// ActionCatalog and the cheatsheet. No DOM: the early dispatcher
// (`@cg/core/application/hotkeys`) feeds it what it saw.

export {
  CHATSPACE_KEYS,
  DISPATCHER_COMMAND_IDS,
  EXTRA_KEYS,
  hotkeyPlatformOf,
  isComboLike,
  isModifierKey,
  isJumpModifierKey,
  matchExtraKey,
  printExtraKey,
  printSchemeKey,
  schemeActions,
  type DispatcherCommandId,
  type ExtraKeyDef,
  type ExtraKeyMatch,
  type HotkeyAction,
  type HotkeyClient,
  type HotkeyDef,
  type HotkeyKeyEvent,
  type HotkeyPlatform,
  type KeyPrint,
} from './keymap';
export { createKeyResolver, isImeKey, type KeyResolver, type KeyVerdict } from './resolver';
export {
  COVERING_OVERLAYS,
  FOCUS_KINDS,
  GLOBAL_COMMANDS,
  LIST_COMMANDS,
  PREVIEW_COMMANDS,
  SIDE_PANELS,
  UNDER_COVER_COMMANDS,
  decideKey,
  decideUnmatched,
  type FocusKind,
  type KeyCommand,
  type KeyContext,
  type KeyDecision,
  type KeyRefusal,
  type OverlayKind,
  type RouteKind,
} from './policy';
export { DELIVERY, DELIVERY_KEYS, deliveryOf, type DeliveryKey, type DeliveryOverrides } from './delivery';
export { createActionCatalog, isOutsideScheme, printableHotkey, type CatalogOptions } from './catalog';
export { ROW_FEATURE, cheatsheetGroups, cheatsheetView, hotkeyReferenceRows, rowPresent } from './cheatsheet';
