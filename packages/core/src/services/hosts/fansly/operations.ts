// R20 P12a: Fansly's own operation driver, in its own chunk — «Заполнить из
// чата» (`notes-fill`). The voice script is every site's since 1.47.0
// (services/voice/script-driver.ts); the background's core adds it to each
// site's operations.
import { FanslyOpViewSchema, FanslyStartOpSchema } from '@cg/contracts/ops-fansly';
import type { SiteOperations } from '../../../domain/ops/site';
import { NOTES_FILL_DRIVER } from '../../notes/fill-driver';

/**
 * Fansly's operations: «Заполнить из чата». The core adds the voice script to them, as to every site's. The fill is the
 * shared driver's request (services/notes/fill-driver.ts), its start held to a Fansly chat; its end is `fansly.ops.done`.
 */
export function createFanslyOperations(done: SiteOperations['done']): SiteOperations {
  return {
    host: 'fansly-web',
    drivers: { 'notes-fill': { ...NOTES_FILL_DRIVER, prepare: (start) => NOTES_FILL_DRIVER.prepare(FanslyStartOpSchema.parse(start)) } },
    readView(value) { const parsed = FanslyOpViewSchema.safeParse(value); return parsed.success ? parsed.data : null; },
    done,
  };
}
