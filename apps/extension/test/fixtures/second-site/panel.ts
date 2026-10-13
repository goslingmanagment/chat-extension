// The fictitious entry of a second site's lazy build: a panel of its own over the shared contracts, with its own
// error and its own schema. Fixture of test/lazy-sites.test.ts.

import { BRIDGE_LIMITS, CgCodeSchema } from '@cg/contracts';

import { isSiteError, SITE_ERRORS } from './errors.ts';
import { SiteFrameSchema } from './schema.ts';

export { SITE_ERRORS, SiteFrameSchema };

/** What the panel shows for a frame: its own error when the frame or the code is not one of its own. */
export function panelText(frame: unknown, code: string): string {
  const parsed = SiteFrameSchema.safeParse(frame);
  if (!parsed.success || !isSiteError(code)) return SITE_ERRORS[0];
  return `${CgCodeSchema.safeParse(code).success ? 'shared' : 'own'}:${parsed.data.items.length}/${BRIDGE_LIMITS.maxSnapshotMessages}`;
}
