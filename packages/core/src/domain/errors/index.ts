// core/domain/errors — the CG registry at work (architecture.md §5.7, §9.5,
// Appendix A): wire → view in the current language, recovery and retry
// rules, the deadline countdown, toast kinds, settings deep links, list
// error states. The hub failure → CG resolver (`hub-map.ts`) belongs to R08.

export {
  UNKNOWN_CODE,
  cgError,
  codeAndTitle,
  codeInText,
  detailLine,
  entryOf,
  errorSourceLine,
  errorView,
  normalizeCode,
  parseSettingsHash,
  readWire,
  settingsHref,
  settingsRouteOf,
  technicalDetail,
  usesDeadline,
  viewOfCode,
  type ErrorFacts,
} from './view';
export {
  LONG_TOASTS,
  TOAST_TIMING,
  errorTone,
  isP1,
  listViewState,
  mayRetryAutomatically,
  recoveryActions,
  retryVerdict,
  toastKey,
  toastKindOf,
  toastLifetimeMs,
  type ListOutcome,
  type RecoveryAction,
  type RecoveryActionKind,
  type RetryVerdict,
  type ToastKind,
} from './recovery';
export {
  COUNTDOWN_TICK_MS,
  countdown,
  deadlineFrom,
  formatCountdown,
  nextUtcMidnight,
  quotaCountdownText,
  retryInText,
  type Countdown,
  type CountdownStyle,
} from './countdown';
