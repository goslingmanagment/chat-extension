// Hash routes of the options page (architecture.md §9.5, §9.9; ST-003,
// ST-007…ST-010): `options.html#<section>` and `#<section>:<CODE>`. Garbage
// opens «Статус»; a code alone opens the section its registry entry names;
// a section with a code keeps the section the link named.

import { SETTINGS_SECTIONS, isCgCode, type CgCode, type SettingsRoute, type SettingsSection } from '@cg/contracts/errors';

import { settingsRouteOf } from '../../domain/errors';

export const DEFAULT_SECTION: SettingsSection = 'status';

function isSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/** The section an error code deep-links to (ST-007): its registry section, «Статус» for the rest. */
export function sectionOfCode(code: CgCode): SettingsSection {
  return settingsRouteOf(code)?.section ?? DEFAULT_SECTION;
}

/** `#account:CG-HUB-URL`, `account`, `#CG-HUB-URL`, garbage → a route that always exists. */
export function routeOfHash(hash: string): SettingsRoute {
  let fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    // a broken escape is garbage like any other
  }
  const [head = '', tail, extra] = fragment.split(':');
  if (extra !== undefined) return { section: DEFAULT_SECTION };
  if (isSection(head)) return tail !== undefined && isCgCode(tail) ? { section: head, code: tail } : { section: head };
  // A code without a section: `#CG-…` or `#:CG-…`.
  const code = head === '' ? tail : tail === undefined ? head : undefined;
  if (code !== undefined && isCgCode(code)) return { section: sectionOfCode(code), code };
  return { section: DEFAULT_SECTION };
}

/** `status`, `account:CG-HUB-URL` — the hash without `#`. */
export function hashOfRoute(route: SettingsRoute): string {
  return route.code === undefined ? route.section : `${route.section}:${route.code}`;
}
