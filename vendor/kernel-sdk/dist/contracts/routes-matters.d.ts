export declare const matterRouteSchemas: {
    readonly mattersList: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "The caller's matters: the owner's every one, by kind; a team lead's own and their role's on their pages; a chatter's own";
        readonly description: string;
        readonly querystring: import("zod").ZodObject<{
            state: import("zod").ZodDefault<import("zod").ZodEnum<{
                open: "open";
                closed: "closed";
            }>>;
            kind: import("zod").ZodOptional<import("zod").ZodString>;
            pageLabel: import("zod").ZodOptional<import("zod").ZodString>;
            limit: import("zod").ZodDefault<import("zod").ZodCoercedNumber<unknown>>;
        }, import("zod/v4/core").$strict>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                matters: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    key: import("zod").ZodString;
                    kind: import("zod").ZodString;
                    source: import("zod").ZodEnum<{
                        agent: "agent";
                        person: "person";
                        ledger: "ledger";
                        server: "server";
                        contentops: "contentops";
                    }>;
                    state: import("zod").ZodEnum<{
                        open: "open";
                        closed: "closed";
                    }>;
                    closedHow: import("zod").ZodNullable<import("zod").ZodEnum<{
                        withdrawn: "withdrawn";
                        resolved: "resolved";
                        cause_gone: "cause_gone";
                    }>>;
                    title: import("zod").ZodString;
                    object: import("zod").ZodNullable<import("zod").ZodObject<{
                        type: import("zod").ZodString;
                        id: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    pageLabels: import("zod").ZodArray<import("zod").ZodString>;
                    owner: import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
                        kind: import("zod").ZodLiteral<"user">;
                        userId: import("zod").ZodNumber;
                        username: import("zod").ZodString;
                        displayName: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>, import("zod").ZodObject<{
                        kind: import("zod").ZodLiteral<"role">;
                        role: import("zod").ZodEnum<{
                            owner: "owner";
                            team_lead: "team_lead";
                            chatter: "chatter";
                        }>;
                    }, import("zod/v4/core").$strip>], "kind">;
                    watcherUserIds: import("zod").ZodArray<import("zod").ZodNumber>;
                    mine: import("zod").ZodBoolean;
                    money: import("zod").ZodBoolean;
                    evidence: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>;
                    link: import("zod").ZodNullable<import("zod").ZodString>;
                    openedAt: import("zod").ZodString;
                    lastSeenAt: import("zod").ZodString;
                    closedAt: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                kinds: import("zod").ZodArray<import("zod").ZodObject<{
                    kind: import("zod").ZodString;
                    open: import("zod").ZodNumber;
                    checked: import("zod").ZodEnum<{
                        yes: "yes";
                        no: "no";
                        not_mirrored: "not_mirrored";
                    }>;
                    checkedAt: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly mattersWaiting: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "«Ждут вас» read from matters, by the list's groups (waiting-groups.ts): the chips, the menu's number and the list's counts";
        readonly description: string;
        readonly querystring: import("zod").ZodObject<{}, import("zod/v4/core").$strict>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                active: import("zod").ZodBoolean;
                groups: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodEnum<{
                        other: "other";
                        info: "info";
                        reports: "reports";
                        customs: "customs";
                        content: "content";
                        system: "system";
                        publications: "publications";
                        held: "held";
                        ledger: "ledger";
                        people: "people";
                        questions: "questions";
                    }>;
                    title: import("zod").ZodString;
                    count: import("zod").ZodNumber;
                    checked: import("zod").ZodBoolean;
                    tone: import("zod").ZodNullable<import("zod").ZodEnum<{
                        warn: "warn";
                        bad: "bad";
                    }>>;
                    to: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                total: import("zod").ZodNumber;
                failed: import("zod").ZodArray<import("zod").ZodEnum<{
                    other: "other";
                    info: "info";
                    reports: "reports";
                    customs: "customs";
                    content: "content";
                    system: "system";
                    publications: "publications";
                    held: "held";
                    ledger: "ledger";
                    people: "people";
                    questions: "questions";
                }>>;
                customOrders: import("zod").ZodNumber;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly clientMatters: {
        readonly auth: {
            readonly kind: "apiKey";
        };
        readonly tags: readonly ["client"];
        readonly summary: "How many matters wait for the person, and the newest 50 of them: titles and links, no evidence";
        readonly description: string;
        readonly response: {
            readonly 200: import("zod").ZodObject<{
                count: import("zod").ZodNumber;
                matters: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    kind: import("zod").ZodString;
                    title: import("zod").ZodString;
                    link: import("zod").ZodNullable<import("zod").ZodString>;
                    pageLabels: import("zod").ZodArray<import("zod").ZodString>;
                    openedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentMatterOpen: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly description: string;
        readonly body: import("zod").ZodObject<{
            key: import("zod").ZodString;
            kind: import("zod").ZodString;
            title: import("zod").ZodString;
            owner: import("zod").ZodUnion<readonly [import("zod").ZodObject<{
                user: import("zod").ZodString;
            }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                role: import("zod").ZodEnum<{
                    owner: "owner";
                    team_lead: "team_lead";
                    chatter: "chatter";
                }>;
            }, import("zod/v4/core").$strict>]>;
            watchers: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
            object: import("zod").ZodOptional<import("zod").ZodObject<{
                type: import("zod").ZodString;
                id: import("zod").ZodString;
            }, import("zod/v4/core").$strict>>;
            pageLabels: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
            evidence: import("zod").ZodOptional<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
            money: import("zod").ZodOptional<import("zod").ZodBoolean>;
            link: import("zod").ZodOptional<import("zod").ZodString>;
            onBehalfOf: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 429: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 503: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                matter: import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    key: import("zod").ZodString;
                    kind: import("zod").ZodString;
                    state: import("zod").ZodEnum<{
                        open: "open";
                        closed: "closed";
                    }>;
                    closedHow: import("zod").ZodNullable<import("zod").ZodEnum<{
                        withdrawn: "withdrawn";
                        resolved: "resolved";
                        cause_gone: "cause_gone";
                    }>>;
                }, import("zod/v4/core").$strip>;
                transition: import("zod").ZodEnum<{
                    updated: "updated";
                    closed: "closed";
                    unchanged: "unchanged";
                    opened: "opened";
                    reopened: "reopened";
                }>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentMatterClose: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly body: import("zod").ZodObject<{
            key: import("zod").ZodString;
            how: import("zod").ZodEnum<{
                withdrawn: "withdrawn";
                resolved: "resolved";
                cause_gone: "cause_gone";
            }>;
            note: import("zod").ZodOptional<import("zod").ZodString>;
            onBehalfOf: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 429: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 503: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                matter: import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    key: import("zod").ZodString;
                    kind: import("zod").ZodString;
                    state: import("zod").ZodEnum<{
                        open: "open";
                        closed: "closed";
                    }>;
                    closedHow: import("zod").ZodNullable<import("zod").ZodEnum<{
                        withdrawn: "withdrawn";
                        resolved: "resolved";
                        cause_gone: "cause_gone";
                    }>>;
                }, import("zod/v4/core").$strip>;
                transition: import("zod").ZodEnum<{
                    updated: "updated";
                    closed: "closed";
                    unchanged: "unchanged";
                    opened: "opened";
                    reopened: "reopened";
                }>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentMatterComment: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Comment a matter by its key, in its history (needs write:matters)";
        readonly body: import("zod").ZodObject<{
            key: import("zod").ZodString;
            text: import("zod").ZodString;
            onBehalfOf: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 429: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 503: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                matter: import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    key: import("zod").ZodString;
                    kind: import("zod").ZodString;
                    state: import("zod").ZodEnum<{
                        open: "open";
                        closed: "closed";
                    }>;
                    closedHow: import("zod").ZodNullable<import("zod").ZodEnum<{
                        withdrawn: "withdrawn";
                        resolved: "resolved";
                        cause_gone: "cause_gone";
                    }>>;
                }, import("zod/v4/core").$strip>;
                eventId: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>;
        };
    };
};
