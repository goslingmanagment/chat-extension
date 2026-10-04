// What the background does when the extension is installed or updated
// (architecture.md §7 «Фон и выгрузка»; UP-008): it logs, and nothing talks
// to the hub — after an install or an update the hub is first asked when the
// person signs in or opens a surface that needs it. An install offers the
// onboarding; an update does not.

export function onInstalledPlan(reason: 'install' | 'update' | 'browser_update' | 'other'): { readonly log: true; readonly contactHub: false; readonly openOnboarding: boolean } {
  return { log: true, contactHub: false, openOnboarding: reason === 'install' };
}
