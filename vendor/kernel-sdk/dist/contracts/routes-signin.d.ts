/**
 * One sign-in for people across the names Hub serves (ecosystem plan §3.2).
 * Cookies stay host-only; a sign-in crosses from one name to another by a
 * one-time code (60 s, single use, bound to the name it was minted for, stored
 * hashed). Hub is the only source of who someone is.
 *
 * - `authSso` (on a name of Hub's own: the console's or the team's) mints a
 *   code for the session of that name and sends the browser to the target's
 *   `authSsoAccept`; without a session, to the one sign-in page and on. A
 *   browser target first binds the code to the browser: `authSsoBegin` on the
 *   target sets a state cookie there and comes back.
 * - `authSsoAccept` (on the target name) plants the SAME session there as a
 *   host-only cookie and leads to `next`, checked against the allow-list of
 *   names and paths. A narrow code (from the extension) opens a narrow session.
 * - `authIntrospect` answers nginx's `auth_request`: 200 with who it is, or
 *   401. Reads only.
 * - `authSsoRedeem` / `authSsoCheck`: another service's server (ContentOps,
 *   TaskIndex, server-monitor) exchanges a code for «who is this» — and whether
 *   it is the owner — with its own agent key (`signin:<client>`), and re-checks
 *   that sign-in later. It never receives a Hub session token.
 * - `authWebLink`: the extension's device token asks for a one-time link into
 *   the team's place (web-link-v1).
 */
import { z } from "zod";
/** How long a minted code may be accepted or redeemed. */
export declare const SIGNIN_CODE_TTL_SECONDS = 60;
/**
 * The services whose servers redeem a code themselves, each by the capability
 * its own agent key holds: a key redeems only its own service's codes. Their
 * callback URLs are WEB_SIGNIN_CLIENTS.
 */
export declare const SIGNIN_CLIENT_CAPABILITIES: {
    readonly contentops: "signin:contentops";
    readonly taskindex: "signin:taskindex";
    readonly monitor: "signin:monitor";
};
export type SigninClient = keyof typeof SIGNIN_CLIENT_CAPABILITIES;
export declare const SIGNIN_CLIENTS: SigninClient[];
export declare function isSigninClient(value: string): value is SigninClient;
/** A server client's name (`contentops`, `taskindex`, `monitor`). */
export declare const signinClientNameSchema: z.ZodEnum<{
    contentops: "contentops";
    taskindex: "taskindex";
    monitor: "monitor";
}>;
export declare const authSsoQuerySchema: z.ZodObject<{
    to: z.ZodString;
    next: z.ZodOptional<z.ZodString>;
    state: z.ZodOptional<z.ZodString>;
    silent: z.ZodOptional<z.ZodLiteral<"1">>;
}, z.core.$strip>;
export declare const authSsoBeginQuerySchema: z.ZodObject<{
    from: z.ZodString;
    next: z.ZodOptional<z.ZodString>;
    silent: z.ZodOptional<z.ZodLiteral<"1">>;
}, z.core.$strip>;
export declare const authSsoAcceptQuerySchema: z.ZodObject<{
    code: z.ZodString;
}, z.core.$strip>;
export declare const signinUserSchema: z.ZodObject<{
    id: z.ZodNumber;
    username: z.ZodString;
    role: z.ZodEnum<{
        owner: "owner";
        team_lead: "team_lead";
        chatter: "chatter";
    }>;
}, z.core.$strip>;
export declare const authIntrospectResponseSchema: z.ZodObject<{
    user: z.ZodObject<{
        id: z.ZodNumber;
        username: z.ZodString;
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
        }>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const authSsoRedeemBodySchema: z.ZodObject<{
    client: z.ZodEnum<{
        contentops: "contentops";
        taskindex: "taskindex";
        monitor: "monitor";
    }>;
    code: z.ZodString;
}, z.core.$strict>;
export declare const authSsoRedeemResponseSchema: z.ZodObject<{
    user: z.ZodObject<{
        id: z.ZodNumber;
        username: z.ZodString;
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
        }>;
    }, z.core.$strip>;
    owner: z.ZodBoolean;
    grant: z.ZodString;
    expiresAt: z.ZodString;
}, z.core.$strip>;
export declare const authSsoCheckBodySchema: z.ZodObject<{
    client: z.ZodEnum<{
        contentops: "contentops";
        taskindex: "taskindex";
        monitor: "monitor";
    }>;
    grant: z.ZodString;
}, z.core.$strict>;
export declare const authSsoCheckResponseSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    active: z.ZodLiteral<true>;
    user: z.ZodObject<{
        id: z.ZodNumber;
        username: z.ZodString;
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
        }>;
    }, z.core.$strip>;
    owner: z.ZodBoolean;
    expiresAt: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    active: z.ZodLiteral<false>;
}, z.core.$strip>], "active">;
export declare const authWebLinkBodySchema: z.ZodObject<{
    next: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const authWebLinkResponseSchema: z.ZodObject<{
    url: z.ZodString;
    expiresAt: z.ZodString;
}, z.core.$strip>;
export type AuthSsoRedeemResponse = z.infer<typeof authSsoRedeemResponseSchema>;
export type AuthSsoCheckResponse = z.infer<typeof authSsoCheckResponseSchema>;
export type AuthWebLinkResponse = z.infer<typeof authWebLinkResponseSchema>;
export declare const signinRouteSchemas: {
    readonly authSso: {
        readonly auth: {
            readonly kind: "public";
        };
        readonly tags: readonly ["auth"];
        readonly summary: "Sign in on another name: mint a one-time code for this name's session and go to the target's accept";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            to: z.ZodString;
            next: z.ZodOptional<z.ZodString>;
            state: z.ZodOptional<z.ZodString>;
            silent: z.ZodOptional<z.ZodLiteral<"1">>;
        }, z.core.$strip>;
        readonly response: {
            readonly 302: z.ZodUnknown;
            readonly 400: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 429: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
    readonly authSsoBegin: {
        readonly auth: {
            readonly kind: "public";
        };
        readonly tags: readonly ["auth"];
        readonly summary: "On the target name: set the browser's state cookie and go back to `authSso` on the name with the session";
        readonly querystring: z.ZodObject<{
            from: z.ZodString;
            next: z.ZodOptional<z.ZodString>;
            silent: z.ZodOptional<z.ZodLiteral<"1">>;
        }, z.core.$strip>;
        readonly response: {
            readonly 302: z.ZodUnknown;
            readonly 400: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 429: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
    readonly authSsoAccept: {
        readonly auth: {
            readonly kind: "public";
        };
        readonly tags: readonly ["auth"];
        readonly summary: "On the target name: redeem a one-time code, set the session as this name's host-only cookie, go to `next`";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            code: z.ZodString;
        }, z.core.$strip>;
        readonly response: {
            readonly 302: z.ZodUnknown;
            readonly 400: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 429: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
    readonly authIntrospect: {
        readonly auth: {
            readonly kind: "public";
        };
        readonly tags: readonly ["auth"];
        readonly summary: "For nginx `auth_request`: who this name's cookie session is (headers x-hub-user, x-hub-login, x-hub-role), or 401";
        readonly description: "Reads only (no last-seen write); a cookie session only — a bearer and a narrow web session are 401.";
        readonly response: {
            readonly 200: z.ZodObject<{
                user: z.ZodObject<{
                    id: z.ZodNumber;
                    username: z.ZodString;
                    role: z.ZodEnum<{
                        owner: "owner";
                        team_lead: "team_lead";
                        chatter: "chatter";
                    }>;
                }, z.core.$strip>;
            }, z.core.$strip>;
            readonly 401: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
    readonly authSsoRedeem: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["auth"];
        readonly summary: "Another service's server exchanges a one-time code for who signed in and whether it is the owner (needs signin:<client>)";
        readonly description: string;
        readonly body: z.ZodObject<{
            client: z.ZodEnum<{
                contentops: "contentops";
                taskindex: "taskindex";
                monitor: "monitor";
            }>;
            code: z.ZodString;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                user: z.ZodObject<{
                    id: z.ZodNumber;
                    username: z.ZodString;
                    role: z.ZodEnum<{
                        owner: "owner";
                        team_lead: "team_lead";
                        chatter: "chatter";
                    }>;
                }, z.core.$strip>;
                owner: z.ZodBoolean;
                grant: z.ZodString;
                expiresAt: z.ZodString;
            }, z.core.$strip>;
            readonly 400: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 401: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 403: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 409: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 429: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
    readonly authSsoCheck: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["auth"];
        readonly summary: "Whether a sign-in redeemed by `authSsoRedeem` is still alive (needs signin:<client>)";
        readonly description: "Reads only. Inactive once the Hub session is signed out, revoked or expired, or the person deactivated.";
        readonly body: z.ZodObject<{
            client: z.ZodEnum<{
                contentops: "contentops";
                taskindex: "taskindex";
                monitor: "monitor";
            }>;
            grant: z.ZodString;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodDiscriminatedUnion<[z.ZodObject<{
                active: z.ZodLiteral<true>;
                user: z.ZodObject<{
                    id: z.ZodNumber;
                    username: z.ZodString;
                    role: z.ZodEnum<{
                        owner: "owner";
                        team_lead: "team_lead";
                        chatter: "chatter";
                    }>;
                }, z.core.$strip>;
                owner: z.ZodBoolean;
                expiresAt: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                active: z.ZodLiteral<false>;
            }, z.core.$strip>], "active">;
            readonly 400: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 401: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 403: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 429: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
    readonly authWebLink: {
        readonly auth: {
            readonly kind: "device-token";
        };
        readonly tags: readonly ["auth"];
        readonly summary: "A one-time link into the team's place for this device's person: it opens a narrow web session (web-link-v1)";
        readonly description: string;
        readonly body: z.ZodObject<{
            next: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                url: z.ZodString;
                expiresAt: z.ZodString;
            }, z.core.$strip>;
            readonly 400: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 401: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 403: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 429: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
};
