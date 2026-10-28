// core/application/pages — the controllers of the extension pages
// (architecture.md §9.9, §10.2; R16): the popup, the options page with its
// eight sections and the sign-in screen, the prompt echo and the journals.
// `createPagesClient` is the AppClient a page mounts with; everything it
// needs from the browser comes through the ports in ./ports, which have the
// shapes of @cg/platform's adapters.

export { createPagesClient, normalizeHubOrigin, BINDING_RESOLVE_CONCURRENCY, BINDING_RETRY_MS, BINDING_RETRY_TRIES, FOCUS_RECHECK_MIN_INTERVAL_MS, POPUP_NEWCOMERS_WINDOW_HOURS, RECHECK_MIN_INTERVAL_MS, SIGN_IN_TIMEOUT_MS, SOUND_STATE_POLL_MS, type PagesClient } from './client';
export {
  type OptionsLocation,
  type PageAnswer,
  type PageClipboardResult,
  type PageClock,
  type PageConsent,
  type PageDownload,
  type PageEnv,
  type PageLanguageSwitch,
  type PageLinks,
  type PageOpener,
  type PagePermissions,
  type PagePorts,
  type PageRequestType,
  type PageRpc,
  type PageSite,
  type PageSiteAccounts,
  type PageTimers,
  type PageWindow,
  type SiteAccountsFacts,
  type SiteSessionFact,
} from './ports';
export { DEFAULT_SECTION, hashOfRoute, routeOfHash, sectionOfCode } from './route';
export { AUTOSAVE_DEBOUNCE_MS, SettingsWriter, mergeSettingsPatch, ridesAlong, settingsWithPending, type SaveStatus, type SettingsWriterDeps, type WriteMode, type WriteOutcome } from './settings-writer';
export { SCHEME_ACTIONS, hotkeyOf, hotkeyRows, inScheme, outsideSchemeHotkey, schemeHotkey } from './hotkeys';
export { QUOTA_LOW, type PagesModel, type Slot } from './model';
export { createSiteAccessControl, offeredSiteAccess } from './site-access';
