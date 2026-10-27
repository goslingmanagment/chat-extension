// The warning marks of a fan (hub `clientFanMarks`, capability `fan-marks-v1`): the agency's Fansly lists labelled
// like «💩 Бомж» the fan is in, on ANY of the agency's Fansly pages (the asked page first), and the posts about the
// fan's username in the Telegram group FANSLY BLOCKLIST (a community blacklist of bad Fansly fans), newest first. A
// read: the hub sends nothing to anyone. Only marks, never a block: the extension shows them as warnings.
//
// The request mirrors the hub's strict query; the answer is open like every hub answer.

import * as z from 'zod/mini';

import { NativeIdSchema } from '../primitives';
import { PageLabelSchema } from './wire';

/** The hub's cap of one blocklist post's text and of the posts it answers. */
export const FAN_MARKS_LIMITS = { postTextMaxChars: 600, postsMax: 5, usernameMaxChars: 64 } as const;

const TimeSchema = z.nullable(z.string());

/** One list of an agency's page the fan is in, with the list's label as Fansly shows it (trimmed). */
export const FanMarksListSchema = z.object({
  pageLabel: z.string(),
  modelName: z.nullable(z.string()),
  /** Whether the person asking works that page; another page is named, nothing else of it. */
  granted: z.boolean(),
  label: z.string(),
  since: TimeSchema,
});
export type FanMarksList = z.infer<typeof FanMarksListSchema>;

/** One post of FANSLY BLOCKLIST about the fan: its text as posted, who posted it, and its link (members of the group only). */
export const FanMarksPostSchema = z.object({
  postedAt: z.string(),
  text: z.string(),
  author: z.nullable(z.string()),
  /** `https://t.me/c/<chat>/<messageId>`: opens only for a member of the group. */
  link: z.string(),
  /** The username the post names (the fan may have had another one then). */
  handle: z.string(),
});
export type FanMarksPost = z.infer<typeof FanMarksPostSchema>;

export const FanMarksSchema = z.object({
  pageLabel: z.string(),
  fanRef: z.string(),
  /** The asked page first. */
  lists: z.array(FanMarksListSchema),
  /** Newest first, at most five. */
  blocklist: z.array(FanMarksPostSchema),
  /** When the hub last read the pages' lists; null — never yet. */
  listsReadAt: TimeSchema,
  /** When the hub last read the group; null — never yet. */
  blocklistReadAt: TimeSchema,
});
export type FanMarks = z.infer<typeof FanMarksSchema>;

/** The fan by their Fansly account id; `username` — their current Fansly username, as the page shows it. */
export const FanMarksQuerySchema = z.strictObject({
  pageLabel: PageLabelSchema,
  fanRef: NativeIdSchema,
  username: z.optional(z.string().check(z.minLength(1), z.maxLength(FAN_MARKS_LIMITS.usernameMaxChars))),
});
export type FanMarksQuery = z.infer<typeof FanMarksQuerySchema>;
