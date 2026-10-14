// Sign-in, sign-out, `me` and `health` (architecture.md §8.1, §8.2; hub
// H-1b, H-3). Existing SDK operations: shapes mirror the vendored SDK
// (`authIssueDeviceTokenWithPassword`, `authRevokeCurrentDeviceToken`, `me`,
// `health`) plus the additive H-1b/H-3 fields. The issued token is a secret:
// it never leaves the background and never reaches a log or a tab.

import * as z from 'zod/mini';

import { KNOWN_PLATFORMS, KNOWN_ROLES } from '../ids';
import { SIGN_IN_LIMITS } from '../limits';
import { HubIntIdSchema, IsoTimestampSchema, boundedText } from '../primitives';

/** The client name a narrow token is issued for (H-3); the hub echoes it back. */
export const CHAT_EXTENSION_CLIENT = 'chat-extension';

export const DEVICE_TOKEN_ISSUE_MODES = ['active', 'pending'] as const;

/**
 * `authIssueDeviceTokenWithPassword` body. The extension always asks for an
 * active token for `client: 'chat-extension'`; `pending` is the desktop's
 * two-step custody. The hub's body is not strict, so a hub without H-3 drops
 * `client` silently — hence the echo check on the response (PR 9 rule).
 */
export const DeviceTokenIssueRequestSchema = z
  .strictObject({
    username: boundedText(SIGN_IN_LIMITS.loginMaxChars),
    password: boundedText(SIGN_IN_LIMITS.passwordMaxChars),
    /** «Firefox · OS · ChatGoose» (§8.2; it named ChatSpace before R20 F9b — free text, the hub reads nothing in it). */
    label: boundedText(120),
    mode: z.enum(DEVICE_TOKEN_ISSUE_MODES),
    client: z.optional(z.literal(CHAT_EXTENSION_CLIENT)),
  })
  .check(z.refine((body) => body.client === undefined || body.mode === 'active', { message: '`client` requires mode active' }));
export type DeviceTokenIssueRequest = z.infer<typeof DeviceTokenIssueRequestSchema>;

/** Answer of the sign-in route: an active token (with the H-3 `client` echo) or a pending reservation. */
export const DeviceTokenIssueResponseSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('active'),
    token: z.string(),
    id: HubIntIdSchema,
    label: z.string(),
    keyPrefix: z.string(),
    expiresAt: IsoTimestampSchema,
    /** H-3 echo: `chat-extension` for a narrow token, null for a full one; absent on a hub without H-3. */
    client: z.optional(z.nullable(boundedText(64))),
  }),
  z.object({
    mode: z.literal('pending'),
    token: z.string(),
    reservationId: HubIntIdSchema,
    label: z.string(),
    keyPrefix: z.string(),
    reservationExpiresAt: IsoTimestampSchema,
  }),
]);
export type DeviceTokenIssueResponse = z.infer<typeof DeviceTokenIssueResponseSchema>;

/** `authRevokeCurrentDeviceToken`: revokes exactly the bearer of the request. */
export const DeviceTokenRevokeResponseSchema = z.object({ revoked: z.literal(true) });

/** Sign-out outcome (§8.2: wipe → revoke within 5 s → wipe again). `null`: the hub did not answer; the local sign-in is gone anyway. */
export const SignOutOutcomeSchema = z.strictObject({ serverRevoked: z.nullable(z.boolean()) });
export type SignOutOutcome = z.infer<typeof SignOutOutcomeSchema>;

/**
 * Roles and platforms as the existing SDK operations declare them: closed
 * enums there, the client's known values (ids.ts); bootstrap and the new
 * routes carry open tokens instead.
 */
export const HUB_USER_ROLES = KNOWN_ROLES;
export const HUB_PLATFORMS = KNOWN_PLATFORMS;

/** A page as the hub's existing routes reference it (`pageRefSchema`). */
export const HubPageRefSchema = z.object({
  id: HubIntIdSchema,
  label: z.string(),
  platform: z.enum(HUB_PLATFORMS),
  modelSlug: z.string(),
  modelName: z.string(),
});
export type HubPageRef = z.infer<typeof HubPageRefSchema>;

/** `me` (`authStateSchema`): who the bearer is. */
export const HubAuthStateSchema = z.object({
  authMethod: z.enum(['session', 'device_token']),
  user: z.object({
    id: HubIntIdSchema,
    username: z.string(),
    role: z.enum(HUB_USER_ROLES),
    /** Retired wire constant `false` (hub Decision 370); kept because frozen SDKs require it. */
    mustChangePassword: z.boolean(),
    assignedPages: z.array(HubPageRefSchema),
  }),
});
export type HubAuthState = z.infer<typeof HubAuthStateSchema>;

export const CONTRACT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const ContractHashSchema = z.string().check(z.regex(CONTRACT_HASH_PATTERN));

/**
 * `health` (200 and 503 share the shape). `capabilities` is the hub's closed
 * legacy list — untouched; H-1b adds the open `compatibleClientSdks`: the
 * vendored SDK's hash must be in it before a release ships (§13).
 */
export const HubHealthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  timestamp: IsoTimestampSchema,
  contractHash: ContractHashSchema,
  capabilities: z.array(z.literal('desktop-lifecycle-v2')),
  checks: z.object({
    api: z.object({ status: z.literal('ok') }),
    database: z.object({
      status: z.enum(['ok', 'error']),
      latencyMs: z.nullable(z.int().check(z.gte(0))),
      error: z.nullable(z.string()),
    }),
  }),
  compatibleClientSdks: z.optional(z.array(ContractHashSchema).check(z.maxLength(64))),
});
export type HubHealth = z.infer<typeof HubHealthSchema>;
