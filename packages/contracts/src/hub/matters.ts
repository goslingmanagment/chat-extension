// «Ждут вас» (hub ecosystem K, #1210 and #1232): what waits for the person in the hub — a matter, the hub's one list
// of it. The extension only shows how many and opens Workboard, where it is done.
//
// - The number: the beat's answer (`clientActivity`) carries `matters`, the person's open matters (their own, never
//   one with money, never one that only informs). A hub that does not send it: no number.
// - The popup: `clientMatters` (no capability; since hub #1210) — the count and the longest-waiting 50, titles and
//   links, no evidence. A matter of kind `shift.report.missing` is the person's shift not handed in two hours after it
//   closed; the hub opens it only for a person with the switch «сдаёт смену в системе» on, and closes it on the hand-in
//   or when the switch goes off.

import * as z from 'zod/mini';

import { CountSchema, HubIntIdSchema, IsoTimestampSchema } from '../primitives';

/** The hub's kind of «the shift is not handed in» (hub `SHIFT_REPORT_MISSING_KIND`); its link is the shift's screen. */
export const SHIFT_REPORT_MISSING_KIND = 'shift.report.missing';
/** Workboard's paths: the only links of a matter the popup opens (the one-time link takes a path of the team's place). */
export const WORKBOARD_PATH_PREFIX = '/workboard/';

export const ClientMattersSchema = z.object({
  count: CountSchema,
  matters: z.array(
    z.object({
      id: HubIntIdSchema,
      kind: z.string(),
      title: z.string(),
      /** Where it is done: a path of the hub's names (`/workboard/…` is Workboard's); null — nowhere to open. */
      link: z.nullable(z.string()),
      pageLabels: z.array(z.string()),
      openedAt: IsoTimestampSchema,
    }),
  ),
  serverNow: z.string(),
});
export type ClientMatters = z.infer<typeof ClientMattersSchema>;
