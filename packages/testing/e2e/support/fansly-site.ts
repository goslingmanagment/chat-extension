// The Fansly site of the TEST build on its stand (R20 P7a0; docs/project-unite/
// architecture.md §4). Neither flavor declares Fansly's scripts in its
// manifest: Firefox grants every match of a manifest content script at install,
// and the stand — like fansly.com — is optional, granted on request only
// (R20 P6a). Its two scripts are registered as the background will register
// them after «Включить Fansly» (P9a): one call, MAIN first, at
// document_start, top frame only. The test grants only the optional bundle;
// the production background owns registration, persistence and ordering
// (the grant itself is support/site-grant.ts, one helper for every optional site).

import { OPTIONAL_STAND_SITES, switchSiteOnForTheStand } from './site-grant';

export { FANSLY_STAND_PATTERN, registeredScripts } from './site-grant';

/** Fansly's scripts as the registry declares them (apps/extension/src/hosts/fansly.ts), in the order they register: MAIN first. */
export const FANSLY_SCRIPTS = [
  { id: 'fansly-main', js: ['fansly-main.js'], world: 'MAIN' },
  { id: 'fansly', js: ['fansly.js'], world: 'ISOLATED' },
] as const;

/** The person switched Fansly on, as far as the stand goes: its origins and webRequest granted, its scripts registered. */
export async function switchFanslyOnForTheStand(): Promise<void> {
  await switchSiteOnForTheStand(OPTIONAL_STAND_SITES.fansly);
}
