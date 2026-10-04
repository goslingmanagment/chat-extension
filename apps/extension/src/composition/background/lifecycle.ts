// Why the event page started (LG-016, LG-018). Firefox unloads an idle event
// page and starts it again with the next event, so «started» alone says
// nothing: the record names an install, an update, a browser start, a reload
// of the extension, or a plain wake.
//
// - `runtime.onInstalled` and `runtime.onStartup` say install, update and
//   browser start. They are delivered right after the first run of the
//   background script, so the first start of a session waits a moment for them.
// - storage.session is empty when the extension is loaded (a browser start, an
//   install, an update, a reload, an enable) and survives the event page being
//   unloaded: a counter kept there tells a wake from everything else.

import { type StartFacts } from '@cg/core/domain/logging';
import { type InstallReason } from '@cg/platform';

export type StartReason = NonNullable<StartFacts['reason']>;

/** storage.session: how many times the event page has started since the extension was loaded. */
export const STARTS_KEY = 'bg.starts';

/** How long the first start after a load waits for `onInstalled` / `onStartup` before it calls itself a reload. */
export const LIFECYCLE_EVENT_WAIT_MS = 300;

/** The stored counter as a number of earlier starts: 0 — none (the first start after a load), null — unreadable. */
export function earlierStartsOf(read: { readonly ok: true; readonly value: unknown } | { readonly ok: false }): number | null {
  if (!read.ok) return null;
  if (read.value === undefined) return 0;
  return typeof read.value === 'number' && Number.isInteger(read.value) && read.value > 0 ? read.value : null;
}

export function startReasonOf(facts: {
  /** Starts before this one since the extension was loaded; null — the counter could not be read. */
  readonly earlierStarts: number | null;
  /** `runtime.onInstalled`, when it came. */
  readonly installed: InstallReason | null;
  /** `runtime.onStartup` came. */
  readonly browserStarted: boolean;
}): StartReason {
  if (facts.installed === 'install') return 'install';
  if (facts.installed === 'update') return 'update';
  if (facts.installed === 'browser_update' || facts.browserStarted) return 'browser-start';
  // Loaded anew with no event to say why: the extension was reloaded or enabled again.
  return facts.earlierStarts === 0 ? 'reload' : 'wake';
}
