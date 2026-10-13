// Fansly in the host registry (docs/project-unite/architecture.md §1.2) — for
// now only its stand: what a TEST build carries for the Fansly-like page on
// loopback (§13; R20 P6a). The site's own entry — its scripts, lazy build,
// permissions, budgets, contract check — is P7a0's and takes `FANSLY_TEST` as
// its `test`; until then a test build carries the stand alone
// (`pendingStandsOf`, ./index.ts). Build data: nothing that ships imports it.

import { FANSLY_STAND_MATCHES } from './runtime/index.ts';
import type { HostPermissions, TestHostConfig } from './types.ts';

/** The Fansly stand: its own loopback name, `localhost` (ChatSpace's stand is `127.0.0.1`). */
export const FANSLY_TEST: TestHostConfig = { pageMatches: FANSLY_STAND_MATCHES };

/**
 * What a test build lets the extension ask for on the stand: the permissions Fansly itself asks for (§4, А12) — the
 * stand's origins (its page, API and socket share its loopback name; a match pattern has no port) and `webRequest` —
 * OPTIONAL, as the site's own. Nothing is granted at install: the e2e grants and revokes them with no prompt and no
 * person (packages/testing/e2e/support/permissions.ts), as «Включить Fansly» and the add-on manager's switch do.
 */
export const FANSLY_STAND_PERMISSIONS: HostPermissions = { origins: FANSLY_TEST.pageMatches, optional: true, api: ['webRequest'] };
