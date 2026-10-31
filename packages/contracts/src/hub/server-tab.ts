// The always-on ChatSpace tab (hub apps/chatspace-browser, `chatspace-tab-state-v1`; `clientChatspaceTabState`): a
// Firefox on the agency's server keeps ChatSpace open with the OnlyFans accounts all the time, so its socket — the
// hub's OnlyFans feed — goes on at night. Its enterprise policy tells the extension so (managed storage `serverTab`).
//
// There the background reports once a minute what only the tab sees: the view it sits on (`none` — no ChatSpace tab:
// OnlyMonster's sign-in lives on onlymonster.ai, where the extension does not run, or the tab crashed) and, for each
// OnlyMonster account ChatSpace loaded, whether its socket covers the account now. The hub keeps the report of its
// server user alone and pages the owner when the reports stop, the tab is not on ChatSpace, a page's account is not
// covered, or the tab sits in a fan's chat. A report of what is, never owed: a lost one is just lost.
//
// The request mirrors the hub's strict body exactly; the answer is open like every hub answer.

import * as z from 'zod/mini';

import { IsoTimestampSchema } from '../primitives';
import { PageLabelSchema } from './wire';

export const SERVER_TAB_LIMITS = {
  /** How often the server's tab reports (hub CHATSPACE_TAB_REPORT_SECONDS). */
  reportMs: 60_000,
  /** OnlyMonster accounts one report may name (hub CHATSPACE_TAB_MAX_ACCOUNTS). */
  maxAccounts: 20,
} as const;

/** Where the tab sits (hub chatspaceTabRouteSchema). */
export const SERVER_TAB_ROUTES = ['overview', 'list', 'chat', 'sign-in', 'other', 'none'] as const;
export type ServerTabRoute = (typeof SERVER_TAB_ROUTES)[number];

export const ServerTabStateRequestSchema = z.strictObject({
  instanceId: z.string().check(z.regex(/^[A-Za-z0-9_-]{8,64}$/)),
  extensionVersion: z.string().check(z.minLength(1), z.maxLength(32)),
  route: z.enum(SERVER_TAB_ROUTES),
  accounts: z
    .array(
      z.strictObject({
        /** OnlyMonster's account id. */
        hostAccountId: z.string().check(z.regex(/^[0-9]{1,30}$/)),
        /** The hub page the account is bound to; null — none of this user's. */
        pageLabel: z.nullable(PageLabelSchema),
        /** ChatSpace's socket covers it now: authenticated, subscribed, its frames coming. */
        covered: z.boolean(),
        /** Since when `covered` holds (this browser's clock). */
        since: IsoTimestampSchema,
        /** 2026-11-01 (`chatspace-tab-state-v2`): ChatSpace has subscribed it on its socket (its own subscription set). */
        subscribed: z.optional(z.boolean()),
      }),
    )
    .check(z.maxLength(SERVER_TAB_LIMITS.maxAccounts)),
  /**
   * 2026-11-01 (`chatspace-tab-state-v2`): ChatSpace's socket itself, no traffic needed: connecting, open or closed and
   * since when, authenticated or not; `observable` false — its subscription set could not be read. Absent — no tab said.
   */
  socket: z.optional(
    z.strictObject({
      state: z.enum(['connecting', 'open', 'closed']),
      since: IsoTimestampSchema,
      authed: z.boolean(),
      observable: z.boolean(),
    }),
  ),
});
export type ServerTabStateRequest = z.infer<typeof ServerTabStateRequestSchema>;

export const ServerTabStateResultSchema = z.object({ recorded: z.boolean(), serverNow: z.string() });
export type ServerTabStateResult = z.infer<typeof ServerTabStateResultSchema>;
