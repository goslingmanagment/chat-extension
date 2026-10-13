// Granting and revoking the TEST build's optional permissions with no prompt
// and no person (docs/project-unite/architecture.md §13 «автоматическая выдача
// и отзыв прав», R20 P6a). Two ways, both proven by fansly-stand-permissions.e2e.ts:
// - `grantOptional` / `revokeOptional`: through WebDriver's chrome context,
//   Firefox's own ExtensionPermissions store with the running extension as the
//   emitter — what the add-on manager's permission switch does: the add-on's
//   policy changes at once and `permissions.onAdded` / `onRemoved` fire. No
//   extension code is needed, so a spec of a site that has no «Включить» yet
//   (P7a0) can switch its permissions on and off;
// - a person's way, as «Включить Fansly» will ask (P9a): `permissions.request`
//   inside a trusted click, answered without Firefox's question
//   (`setOptionalPermissionPrompts(false)`, support/background.ts), and
//   `permissions.remove` from an extension page.

import { inChrome } from './background';
import { TEST_GECKO_ID } from './constants';

export interface OptionalPermissions {
  readonly origins?: readonly string[];
  readonly permissions?: readonly string[];
}

export interface GrantedState {
  /** Whether the add-on's policy now lets it reach this URL (its allowed origins). */
  readonly reaches: boolean;
  readonly permissions: readonly string[];
}

async function change(kind: 'add' | 'remove', wanted: OptionalPermissions, id: string): Promise<void> {
  const answer = await inChrome((driver) =>
    driver.executeAsyncScript(
      `const [kind, id, origins, permissions, done] = arguments;
       const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
       const policy = WebExtensionPolicy.getByID(id);
       if (!policy) { done({ error: 'no add-on ' + id }); return; }
       ExtensionPermissions[kind](id, { origins, permissions }, policy.extension).then(() => done({ ok: true }), (error) => done({ error: String(error) }));`,
      [kind, id, [...(wanted.origins ?? [])], [...(wanted.permissions ?? [])]],
    ),
  );
  const result = answer as { ok?: boolean; error?: string };
  if (result.ok !== true) throw new Error(`ExtensionPermissions.${kind}: ${result.error ?? 'no answer'}`);
}

/** Grants optional permissions the manifest declares, as the add-on manager's switch does. */
export async function grantOptional(wanted: OptionalPermissions, id: string = TEST_GECKO_ID): Promise<void> {
  await change('add', wanted, id);
}

/** Takes them back the same way. */
export async function revokeOptional(wanted: OptionalPermissions, id: string = TEST_GECKO_ID): Promise<void> {
  await change('remove', wanted, id);
}

/** What Firefox itself holds for the add-on: can its policy reach `url`, which API permissions does it have. */
export async function grantedState(url: string, id: string = TEST_GECKO_ID): Promise<GrantedState> {
  const answer = await inChrome((driver) =>
    driver.executeScript(
      `const [id, url] = arguments;
       const policy = WebExtensionPolicy.getByID(id);
       return { reaches: policy.canAccessURI(Services.io.newURI(url)), permissions: [...policy.permissions] };`,
      [id, url],
    ),
  );
  return answer as GrantedState;
}
