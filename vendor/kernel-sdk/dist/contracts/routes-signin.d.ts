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
 *   To ContentOps both answers carry the `person` (products plan §4.1): enough
 *   to make, change and close its own person without a second registry; and
 *   `authSsoWaiting` reads what waits in Hub for a person signed in that way.
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
    monitor: "monitor";
    taskindex: "taskindex";
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
        content_manager: "content_manager";
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
            content_manager: "content_manager";
        }>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const authSsoRedeemBodySchema: z.ZodObject<{
    client: z.ZodEnum<{
        contentops: "contentops";
        monitor: "monitor";
        taskindex: "taskindex";
    }>;
    code: z.ZodString;
}, z.core.$strict>;
/**
 * The person behind a sign-in, as ContentOps needs it (products plan §4.1): the registry's code, name, role and state;
 * the models of their working pages (lower-case slugs); the models where they lead customs («ведёт кастомы»); the
 * products `auth/me` gives them (the frame's switcher). null — the login is nobody's in the registry. Sent to ContentOps
 * only.
 */
export declare const signinPersonSchema: z.ZodNullable<z.ZodObject<{
    code: z.ZodString;
    displayName: z.ZodString;
    role: z.ZodString;
    state: z.ZodString;
    models: z.ZodArray<z.ZodString>;
    customsModels: z.ZodArray<z.ZodString>;
    products: z.ZodArray<z.ZodEnum<{
        hub: "hub";
        workboard: "workboard";
        contentops: "contentops";
        tasks: "tasks";
        monitor: "monitor";
    }>>;
}, z.core.$strip>>;
export declare const authSsoRedeemResponseSchema: z.ZodObject<{
    user: z.ZodObject<{
        id: z.ZodNumber;
        username: z.ZodString;
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
            content_manager: "content_manager";
        }>;
    }, z.core.$strip>;
    owner: z.ZodBoolean;
    grant: z.ZodString;
    expiresAt: z.ZodString;
    person: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        code: z.ZodString;
        displayName: z.ZodString;
        role: z.ZodString;
        state: z.ZodString;
        models: z.ZodArray<z.ZodString>;
        customsModels: z.ZodArray<z.ZodString>;
        products: z.ZodArray<z.ZodEnum<{
            hub: "hub";
            workboard: "workboard";
            contentops: "contentops";
            tasks: "tasks";
            monitor: "monitor";
        }>>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const authSsoCheckBodySchema: z.ZodObject<{
    client: z.ZodEnum<{
        contentops: "contentops";
        monitor: "monitor";
        taskindex: "taskindex";
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
            content_manager: "content_manager";
        }>;
    }, z.core.$strip>;
    owner: z.ZodBoolean;
    expiresAt: z.ZodString;
    person: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        code: z.ZodString;
        displayName: z.ZodString;
        role: z.ZodString;
        state: z.ZodString;
        models: z.ZodArray<z.ZodString>;
        customsModels: z.ZodArray<z.ZodString>;
        products: z.ZodArray<z.ZodEnum<{
            hub: "hub";
            workboard: "workboard";
            contentops: "contentops";
            tasks: "tasks";
            monitor: "monitor";
        }>>;
    }, z.core.$strip>>>;
}, z.core.$strip>, z.ZodObject<{
    active: z.ZodLiteral<false>;
}, z.core.$strip>], "active">;
export declare const authSsoWaitingBodySchema: z.ZodObject<{
    client: z.ZodEnum<{
        contentops: "contentops";
        monitor: "monitor";
        taskindex: "taskindex";
    }>;
    grant: z.ZodString;
}, z.core.$strict>;
/** One open matter of the person, as ContentOps lists it: it opens where it is decided (`link`). */
export declare const signinWaitingMatterSchema: z.ZodObject<{
    id: z.ZodNumber;
    kind: z.ZodString;
    title: z.ZodString;
    link: z.ZodNullable<z.ZodString>;
    pageLabels: z.ZodArray<z.ZodString>;
    models: z.ZodOptional<z.ZodArray<z.ZodString>>;
    object: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        type: z.ZodString;
        id: z.ZodString;
    }, z.core.$strip>>>;
    openedAt: z.ZodString;
}, z.core.$strip>;
export declare const authSsoWaitingResponseSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    active: z.ZodLiteral<true>;
    matters: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        kind: z.ZodString;
        title: z.ZodString;
        link: z.ZodNullable<z.ZodString>;
        pageLabels: z.ZodArray<z.ZodString>;
        models: z.ZodOptional<z.ZodArray<z.ZodString>>;
        object: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            type: z.ZodString;
            id: z.ZodString;
        }, z.core.$strip>>>;
        openedAt: z.ZodString;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    active: z.ZodLiteral<false>;
}, z.core.$strip>], "active">;
export declare const authSsoPasswordBodySchema: z.ZodObject<{
    ip: z.ZodOptional<z.ZodString>;
    userAgent: z.ZodOptional<z.ZodString>;
    client: z.ZodEnum<{
        contentops: "contentops";
        monitor: "monitor";
        taskindex: "taskindex";
    }>;
    username: z.ZodString;
    password: z.ZodString;
}, z.core.$strict>;
/**
 * Why a sign-in on another service's page was refused, in one word each: `wrong` — an unknown login or a wrong
 * password, one answer for both; `locked` — too many tries, wait; `owner` — the owner's password never passes through
 * another service: the owner enters through Hub; `no_access` — the person has no ContentOps; `link_unknown`,
 * `link_used`, `link_expired`, `link_revoked` — an invitation or a new password's link that cannot be used;
 * `not_here` — a link of a login that opens elsewhere; `weak` — a password Hub does not take (`message` says why).
 */
export declare const SIGNIN_REFUSALS: readonly ["wrong", "locked", "owner", "no_access", "link_unknown", "link_used", "link_expired", "link_revoked", "not_here", "weak"];
export declare const authSsoSignedInResponseSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    user: z.ZodObject<{
        id: z.ZodNumber;
        username: z.ZodString;
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
            content_manager: "content_manager";
        }>;
    }, z.core.$strip>;
    owner: z.ZodBoolean;
    grant: z.ZodString;
    expiresAt: z.ZodString;
    person: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        code: z.ZodString;
        displayName: z.ZodString;
        role: z.ZodString;
        state: z.ZodString;
        models: z.ZodArray<z.ZodString>;
        customsModels: z.ZodArray<z.ZodString>;
        products: z.ZodArray<z.ZodEnum<{
            hub: "hub";
            workboard: "workboard";
            contentops: "contentops";
            tasks: "tasks";
            monitor: "monitor";
        }>>;
    }, z.core.$strip>>>;
    result: z.ZodLiteral<"signed_in">;
}, z.core.$strip>, z.ZodObject<{
    result: z.ZodLiteral<"refused">;
    reason: z.ZodEnum<{
        owner: "owner";
        wrong: "wrong";
        locked: "locked";
        no_access: "no_access";
        link_unknown: "link_unknown";
        link_used: "link_used";
        link_expired: "link_expired";
        link_revoked: "link_revoked";
        not_here: "not_here";
        weak: "weak";
    }>;
    message: z.ZodOptional<z.ZodString>;
}, z.core.$strip>], "result">;
export declare const authSsoLinkBodySchema: z.ZodObject<{
    ip: z.ZodOptional<z.ZodString>;
    userAgent: z.ZodOptional<z.ZodString>;
    client: z.ZodEnum<{
        contentops: "contentops";
        monitor: "monitor";
        taskindex: "taskindex";
    }>;
    token: z.ZodString;
    password: z.ZodString;
}, z.core.$strict>;
export declare const authSsoPasswordChangeBodySchema: z.ZodObject<{
    ip: z.ZodOptional<z.ZodString>;
    userAgent: z.ZodOptional<z.ZodString>;
    client: z.ZodEnum<{
        contentops: "contentops";
        monitor: "monitor";
        taskindex: "taskindex";
    }>;
    grant: z.ZodString;
    currentPassword: z.ZodString;
    newPassword: z.ZodString;
}, z.core.$strict>;
export declare const authSsoLogoutBodySchema: z.ZodObject<{
    client: z.ZodEnum<{
        contentops: "contentops";
        monitor: "monitor";
        taskindex: "taskindex";
    }>;
    grant: z.ZodString;
}, z.core.$strict>;
export declare const authSsoLogoutResponseSchema: z.ZodObject<{
    ended: z.ZodBoolean;
}, z.core.$strip>;
export declare const authWebLinkBodySchema: z.ZodObject<{
    next: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const authWebLinkResponseSchema: z.ZodObject<{
    url: z.ZodString;
    expiresAt: z.ZodString;
}, z.core.$strip>;
export type AuthSsoRedeemResponse = z.infer<typeof authSsoRedeemResponseSchema>;
export type AuthSsoCheckResponse = z.infer<typeof authSsoCheckResponseSchema>;
export type SigninPerson = z.infer<typeof signinPersonSchema>;
export type AuthSsoWaitingResponse = z.infer<typeof authSsoWaitingResponseSchema>;
export type AuthSsoSignedInResponse = z.infer<typeof authSsoSignedInResponseSchema>;
export type SigninRefusal = (typeof SIGNIN_REFUSALS)[number];
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
                        content_manager: "content_manager";
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
    readonly authStaticReports: {
        readonly auth: {
            readonly kind: "public";
        };
        readonly tags: readonly ["auth"];
        readonly summary: "For nginx's guard of the static reports on chatgoose. (`/customs/`, `/fyp/`): 204 for a signed-in live person";
        readonly description: string;
        readonly response: {
            readonly 204: z.ZodNull;
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
                monitor: "monitor";
                taskindex: "taskindex";
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
                        content_manager: "content_manager";
                    }>;
                }, z.core.$strip>;
                owner: z.ZodBoolean;
                grant: z.ZodString;
                expiresAt: z.ZodString;
                person: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                    code: z.ZodString;
                    displayName: z.ZodString;
                    role: z.ZodString;
                    state: z.ZodString;
                    models: z.ZodArray<z.ZodString>;
                    customsModels: z.ZodArray<z.ZodString>;
                    products: z.ZodArray<z.ZodEnum<{
                        hub: "hub";
                        workboard: "workboard";
                        contentops: "contentops";
                        tasks: "tasks";
                        monitor: "monitor";
                    }>>;
                }, z.core.$strip>>>;
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
                monitor: "monitor";
                taskindex: "taskindex";
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
                        content_manager: "content_manager";
                    }>;
                }, z.core.$strip>;
                owner: z.ZodBoolean;
                expiresAt: z.ZodString;
                person: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                    code: z.ZodString;
                    displayName: z.ZodString;
                    role: z.ZodString;
                    state: z.ZodString;
                    models: z.ZodArray<z.ZodString>;
                    customsModels: z.ZodArray<z.ZodString>;
                    products: z.ZodArray<z.ZodEnum<{
                        hub: "hub";
                        workboard: "workboard";
                        contentops: "contentops";
                        tasks: "tasks";
                        monitor: "monitor";
                    }>>;
                }, z.core.$strip>>>;
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
    readonly authSsoWaiting: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["auth"];
        readonly summary: "What waits in Hub for the person of a live sign-in, for ContentOps' «Ждут вас» (needs signin:contentops)";
        readonly description: string;
        readonly body: z.ZodObject<{
            client: z.ZodEnum<{
                contentops: "contentops";
                monitor: "monitor";
                taskindex: "taskindex";
            }>;
            grant: z.ZodString;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodDiscriminatedUnion<[z.ZodObject<{
                active: z.ZodLiteral<true>;
                matters: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    kind: z.ZodString;
                    title: z.ZodString;
                    link: z.ZodNullable<z.ZodString>;
                    pageLabels: z.ZodArray<z.ZodString>;
                    models: z.ZodOptional<z.ZodArray<z.ZodString>>;
                    object: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                        type: z.ZodString;
                        id: z.ZodString;
                    }, z.core.$strip>>>;
                    openedAt: z.ZodString;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly authSsoPassword: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["auth"];
        readonly summary: "ContentOps' own page signs a person in by login and password (needs signin:contentops)";
        readonly description: string;
        readonly body: z.ZodObject<{
            ip: z.ZodOptional<z.ZodString>;
            userAgent: z.ZodOptional<z.ZodString>;
            client: z.ZodEnum<{
                contentops: "contentops";
                monitor: "monitor";
                taskindex: "taskindex";
            }>;
            username: z.ZodString;
            password: z.ZodString;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodDiscriminatedUnion<[z.ZodObject<{
                user: z.ZodObject<{
                    id: z.ZodNumber;
                    username: z.ZodString;
                    role: z.ZodEnum<{
                        owner: "owner";
                        team_lead: "team_lead";
                        chatter: "chatter";
                        content_manager: "content_manager";
                    }>;
                }, z.core.$strip>;
                owner: z.ZodBoolean;
                grant: z.ZodString;
                expiresAt: z.ZodString;
                person: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                    code: z.ZodString;
                    displayName: z.ZodString;
                    role: z.ZodString;
                    state: z.ZodString;
                    models: z.ZodArray<z.ZodString>;
                    customsModels: z.ZodArray<z.ZodString>;
                    products: z.ZodArray<z.ZodEnum<{
                        hub: "hub";
                        workboard: "workboard";
                        contentops: "contentops";
                        tasks: "tasks";
                        monitor: "monitor";
                    }>>;
                }, z.core.$strip>>>;
                result: z.ZodLiteral<"signed_in">;
            }, z.core.$strip>, z.ZodObject<{
                result: z.ZodLiteral<"refused">;
                reason: z.ZodEnum<{
                    owner: "owner";
                    wrong: "wrong";
                    locked: "locked";
                    no_access: "no_access";
                    link_unknown: "link_unknown";
                    link_used: "link_used";
                    link_expired: "link_expired";
                    link_revoked: "link_revoked";
                    not_here: "not_here";
                    weak: "weak";
                }>;
                message: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>], "result">;
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
    readonly authSsoLink: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["auth"];
        readonly summary: "ContentOps' own page sets the password of an invitation or a reset link and signs the person in (needs signin:contentops)";
        readonly description: string;
        readonly body: z.ZodObject<{
            ip: z.ZodOptional<z.ZodString>;
            userAgent: z.ZodOptional<z.ZodString>;
            client: z.ZodEnum<{
                contentops: "contentops";
                monitor: "monitor";
                taskindex: "taskindex";
            }>;
            token: z.ZodString;
            password: z.ZodString;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodDiscriminatedUnion<[z.ZodObject<{
                user: z.ZodObject<{
                    id: z.ZodNumber;
                    username: z.ZodString;
                    role: z.ZodEnum<{
                        owner: "owner";
                        team_lead: "team_lead";
                        chatter: "chatter";
                        content_manager: "content_manager";
                    }>;
                }, z.core.$strip>;
                owner: z.ZodBoolean;
                grant: z.ZodString;
                expiresAt: z.ZodString;
                person: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                    code: z.ZodString;
                    displayName: z.ZodString;
                    role: z.ZodString;
                    state: z.ZodString;
                    models: z.ZodArray<z.ZodString>;
                    customsModels: z.ZodArray<z.ZodString>;
                    products: z.ZodArray<z.ZodEnum<{
                        hub: "hub";
                        workboard: "workboard";
                        contentops: "contentops";
                        tasks: "tasks";
                        monitor: "monitor";
                    }>>;
                }, z.core.$strip>>>;
                result: z.ZodLiteral<"signed_in">;
            }, z.core.$strip>, z.ZodObject<{
                result: z.ZodLiteral<"refused">;
                reason: z.ZodEnum<{
                    owner: "owner";
                    wrong: "wrong";
                    locked: "locked";
                    no_access: "no_access";
                    link_unknown: "link_unknown";
                    link_used: "link_used";
                    link_expired: "link_expired";
                    link_revoked: "link_revoked";
                    not_here: "not_here";
                    weak: "weak";
                }>;
                message: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>], "result">;
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
    readonly authSsoPasswordChange: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["auth"];
        readonly summary: "A person changes their password from ContentOps' profile (needs signin:contentops)";
        readonly description: string;
        readonly body: z.ZodObject<{
            ip: z.ZodOptional<z.ZodString>;
            userAgent: z.ZodOptional<z.ZodString>;
            client: z.ZodEnum<{
                contentops: "contentops";
                monitor: "monitor";
                taskindex: "taskindex";
            }>;
            grant: z.ZodString;
            currentPassword: z.ZodString;
            newPassword: z.ZodString;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodDiscriminatedUnion<[z.ZodObject<{
                user: z.ZodObject<{
                    id: z.ZodNumber;
                    username: z.ZodString;
                    role: z.ZodEnum<{
                        owner: "owner";
                        team_lead: "team_lead";
                        chatter: "chatter";
                        content_manager: "content_manager";
                    }>;
                }, z.core.$strip>;
                owner: z.ZodBoolean;
                grant: z.ZodString;
                expiresAt: z.ZodString;
                person: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                    code: z.ZodString;
                    displayName: z.ZodString;
                    role: z.ZodString;
                    state: z.ZodString;
                    models: z.ZodArray<z.ZodString>;
                    customsModels: z.ZodArray<z.ZodString>;
                    products: z.ZodArray<z.ZodEnum<{
                        hub: "hub";
                        workboard: "workboard";
                        contentops: "contentops";
                        tasks: "tasks";
                        monitor: "monitor";
                    }>>;
                }, z.core.$strip>>>;
                result: z.ZodLiteral<"signed_in">;
            }, z.core.$strip>, z.ZodObject<{
                result: z.ZodLiteral<"refused">;
                reason: z.ZodEnum<{
                    owner: "owner";
                    wrong: "wrong";
                    locked: "locked";
                    no_access: "no_access";
                    link_unknown: "link_unknown";
                    link_used: "link_used";
                    link_expired: "link_expired";
                    link_revoked: "link_revoked";
                    not_here: "not_here";
                    weak: "weak";
                }>;
                message: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>], "result">;
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
    readonly authSsoLogout: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["auth"];
        readonly summary: "ContentOps' «Выйти»: ends the Hub session its own page opened (needs signin:contentops)";
        readonly description: "A session the person opened in Hub or Workboard themselves stays. Idempotent.";
        readonly body: z.ZodObject<{
            client: z.ZodEnum<{
                contentops: "contentops";
                monitor: "monitor";
                taskindex: "taskindex";
            }>;
            grant: z.ZodString;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                ended: z.ZodBoolean;
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
