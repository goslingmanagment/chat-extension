// A second site's own schema, as its bridge registry will be (bridge-messages-fansly.ts): zod, shared with
// ChatSpace's chunks as source, never as a file. Fixture of test/lazy-sites.test.ts.

import { z } from 'zod';

export const SiteFrameSchema = z.strictObject({
  t: z.literal('sitefix.batch'),
  groupId: z.string().regex(/^\d{1,20}$/),
  items: z.array(z.strictObject({ id: z.string(), at: z.number().int().nonnegative() })).max(120),
});
