// ui/kit — the base every surface builds on (architecture.md §10.1, §10.2;
// ui-design §1–§6, §12; R13): tokens and themes as shared constructable
// sheets, the MountPort helpers, `useView` (AppClient → @preact/signals),
// I18n and the other ports as hooks, focus utilities, reduced motion, and the
// atoms and shared molecules of ui-design §4. Rules: no browser.*, no fetch,
// no postMessage, no host DOM, no timers in idle faster than 1 Hz (§4, §11).

// ── theme, styles, layers ──
export {
  BASE_TOKENS_CSS,
  DARK_SCOPE,
  FAMILY_TRIPLETS,
  LINE_HEIGHTS,
  SITE_BLUE_FALLBACK,
  THEME_CSS,
  TOKEN_VALUES,
  blue,
  dark,
  family,
  paletteSource,
  tokenValue,
  type BlueStep,
  type FamilyStep,
  type TokenValue,
} from './tokens';
export { adoptSheets, adoptStyles, sharedSheet, type StyleMode, type StyleSource } from './styles';
export { BASE_CSS, KIT_CONTAINER, ROOT_CLASS } from './base';
export { BASE_SOURCE, COMPONENTS_SOURCE, KIT_STYLE_SOURCES, TOKENS_SOURCE, adoptKitStyles, retainKitStyles, type RetainedStyles } from './sheets';
export { attributeHolds, holdAttribute } from './holds';
export {
  SettableSignal,
  bindScheme,
  bindTextSize,
  mediaSchemeSignal,
  resolveScheme,
  resolvedSchemeSignal,
  type MediaQuerySource,
  type OwnedSignal,
  type SchemeInputs,
} from './scheme';
export { DISMISSIBLE_OPEN_ATTRIBUTE, LAYERS, MOTION, prefersReducedMotion, type LayerName } from './layers';

// ── environment, ports as hooks, mounting ──
export {
  Hints,
  KitProvider,
  createKitEnv,
  useAnnounce,
  useDismissibleOpen,
  useDispatch,
  useGeometry,
  useHints,
  useI18n,
  useKit,
  useKitEnv,
  useNowFn,
  useReducedMotion,
  useScheme,
  useT,
  useView,
  windowOf,
  type KitEnv,
  type KitEnvOptions,
  type KitFailure,
  type KitProviderProps,
} from './context';
export { fromValueSignal, useValueSignal, useViewFrom, viewKey, viewSignal, type OwnedReadonlySignal } from './signals';
export { KitRoot, LiveRegion, useResultCap, type KitRootProps } from './root';
export {
  capturePageErrors,
  createMountPort,
  mountKitPage,
  mountKitSurface,
  type KitMount,
  type KitMountOptions,
  type SurfaceDefinition,
} from './mount';
export { activeIn, containsFocus, focusQuietly, isComposing, isHeldKey, rovingIndex, swallowHeldEnter, tabbables, trapTab, type RovingOrientation } from './focus';
export {
  HOUR,
  MINUTE,
  SECOND,
  countdownDelay,
  countdownParts,
  elapsedDelay,
  minuteListenerCount,
  onMinute,
  useCountdown,
  useElapsed,
  useMinuteClock,
  useRenderAfter,
} from './clock';
export { TOOLTIP_TIMING, TooltipManager, type TooltipState } from './tooltip-manager';

// ── atoms and shared molecules (ui-design §4) ──
export {
  ActionButton,
  Button,
  Divider,
  Kbd,
  StripButton,
  hotkeyText,
  type ButtonProps,
  type ButtonRole,
  type ButtonVariant,
  type StripButtonProps,
} from './components/Button';
export { TOOLTIP_GAP_PX, TooltipLayer, useTooltip, type TooltipBinding, type TooltipTriggerProps } from './components/Tooltip';
export { CheckGlyph, GooseMark, ICON_NAMES, Icon, type IconName, type IconProps } from './components/Icon';
export { DOCK_GROUP_SLOT, type DockIcon } from './chips';
export { ACCENT_USES, Caret, Dot, ReadyBadge, Spinner, type AccentUse, type DotProps } from './components/Indicators';
export { Menu, MenuAnchor, menuTriggerKeys, type MenuItem, type MenuProps } from './components/Menu';
export {
  ConfirmDialog,
  Dialog,
  OverlayLayer,
  SidePanel,
  WINDOW_FALLBACK_INSETS,
  type DialogProps,
  type DialogSize,
  type SidePanelProps,
} from './components/Dialog';
export { TOAST_MAX, ToastItem, ToastStack, type ToastItemProps } from './components/Toast';
export {
  CodeLine,
  CopyCodeButton,
  DETAIL_MAX_CHARS,
  ErrorCard,
  StatusBanner,
  technicalLine,
  type ErrorCardProps,
  type ErrorTone,
  type StatusBannerProps,
} from './components/ErrorCard';
export { PartRow, type PartRowProps } from './components/PartRow';
export { StageLine } from './components/StageLine';
export { KeysFooter, type KeyHint, type KeysFooterProps } from './components/KeysFooter';
export { Checkbox, Segmented, Tabs, type CheckboxProps, type ChoiceOption, type SegmentedProps, type TabsProps } from './components/Choice';
export { SEARCH_DEBOUNCE_MS, SearchBox, TextField, type SearchBoxProps, type TextFieldProps } from './components/Field';
export {
  MAX_DOM_ROWS,
  VirtualList,
  rowAt,
  rowOffsets,
  visibleRange,
  type VirtualListHandle,
  type VirtualListProps,
} from './components/VirtualList';
export { Age, Countdown, Duration, ElapsedTimer, Money, Time, useCountdownText, useSpokenMoney, type MoneyProps } from './components/Values';
export { ViewState, remedyLabelKey, type ViewStateProps } from './components/ViewState';
export { Boundary, type BoundaryProps } from './components/Boundary';
export { Markdown, MarkdownView, type MarkdownProps } from './markdown/Markdown';
export { MD_MAX_CHARS, MD_MAX_DEPTH, MD_MAX_SPAN, markdownText, parseInline, parseMarkdown, safeHref, type MdBlock, type MdInline } from './markdown/parse';
