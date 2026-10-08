// Sentry on the stand (decision X22; ?stand-sentry=1, the sentry-gate e2e).
// ChatSpace 0.195.0 ships the public Sentry browser SDK 10.45.0 through
// @sentry/vue: the SDK's default integrations without BrowserSession, plus
// Vue's; enabled; an environment and a release; no other option — no
// beforeSend, no URL filters (docs/architecture.md §5.3 «Правила MAIN-мира»).
// The stand sets it up the same way, from the same public package, before
// the app mounts, and reports to a collector of its own server: the DSN names
// the page's own loopback origin, the envelopes go to /sentry/api/1/envelope/.
// Nothing here is ChatSpace's code.

import * as Sentry from '@sentry/vue';
import type { App } from 'vue';

import { STAND_SENTRY_PREFIX } from './protocol';

/** Starts the SDK with the app (its Vue error handler too). */
export function startSentry(app: App): void {
  Sentry.init({
    app,
    dsn: `${location.protocol}//standpublickey@${location.host}${STAND_SENTRY_PREFIX}1`,
    enabled: true,
    environment: 'stand',
    release: 'stand@1',
    integrations: (defaults) => defaults.filter((integration) => integration.name !== 'BrowserSession'),
  });
}

/** An error of the page's own code, nobody catching it (Sentry's global handler reports it with its breadcrumbs). */
export function throwFromPage(message: string): void {
  setTimeout(() => {
    throw new Error(message);
  }, 0);
}

/** Sends what the SDK still holds; true — sent. */
export function flushSentry(timeoutMs = 2000): Promise<boolean> {
  return Sentry.flush(timeoutMs);
}
