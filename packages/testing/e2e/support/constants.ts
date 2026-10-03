/** Same id as apps/extension/build/manifest.ts TEST_GECKO_ID (the e2e installs the TEST build). */
export const TEST_GECKO_ID = 'chat-extension-test@gosling.agency';
/** Same id as apps/extension/build/manifest.ts GECKO_ID (release-xpi.e2e.ts installs the release XPI). */
export const RELEASE_GECKO_ID = 'chat-extension@gosling.agency';
/** Fixed through the `extensions.webextensions.uuids` pref. */
export const E2E_ADDON_UUID = '7c0a3b8e-5d2f-4c1b-9a6e-2f4d8c1e0b7a';
export const E2E_RELEASE_ADDON_UUID = '3f1d9c2a-8b7e-4a5c-9d0f-6e2b1a4c7d8e';
/** Same as apps/extension/src/composition/egress-probe.ts (test builds only): the storage.local key that asks for the probe, and its host. */
export const EGRESS_PROBE_KEY = 'cg.test.egressProbe';
export const EGRESS_PROBE_HOST = 'cg-bg-probe.invalid';
/** Same as apps/extension/src/composition/background.ts (test builds only): `pageLabel → creator id` of the dev/compat bootstrap. */
export const DEV_COMPAT_PAGES_KEY = 'dev.compatPageAccounts';
/** Same as apps/extension/build/bundle-timing.ts: the marks around a content-script bundle (test builds only). */
export const BUNDLE_MARKS_KEY = '__cgBundleMarks';
