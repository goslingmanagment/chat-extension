export declare const peopleRouteSchemas: {
    readonly accountStart: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "«Начало»: the caller's own way from the invitation to the first shift, each step closed by what Hub sees";
        readonly description: string;
        readonly response: {
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
            readonly 200: import("zod").ZodObject<{
                person: import("zod").ZodNullable<import("zod").ZodObject<{
                    code: import("zod").ZodString;
                    displayName: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                username: import("zod").ZodString;
                start: import("zod").ZodNullable<import("zod").ZodObject<{
                    newcomer: import("zod").ZodBoolean;
                    signedUp: import("zod").ZodBoolean;
                    steps: import("zod").ZodArray<import("zod").ZodObject<{
                        step: import("zod").ZodEnum<{
                            pages: "pages";
                            install: "install";
                            extension: "extension";
                            activity: "activity";
                            payout: "payout";
                        }>;
                        done: import("zod").ZodBoolean;
                        doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    done: import("zod").ZodNumber;
                    total: import("zod").ZodNumber;
                    current: import("zod").ZodNullable<import("zod").ZodEnum<{
                        pages: "pages";
                        install: "install";
                        extension: "extension";
                        activity: "activity";
                        payout: "payout";
                    }>>;
                    since: import("zod").ZodNullable<import("zod").ZodString>;
                    stuck: import("zod").ZodBoolean;
                    extension: import("zod").ZodNullable<import("zod").ZodObject<{
                        label: import("zod").ZodString;
                        signedInAt: import("zod").ZodString;
                        active: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                    pages: import("zod").ZodArray<import("zod").ZodObject<{
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        modelName: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    firstActivity: import("zod").ZodNullable<import("zod").ZodObject<{
                        at: import("zod").ZodString;
                        pageLabel: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
                payoutDetails: import("zod").ZodNullable<import("zod").ZodObject<{
                    text: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                submitsShift: import("zod").ZodBoolean;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly accountPayoutDetailsSet: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Write where the caller's own payouts go (free text; empty clears it)";
        readonly description: string;
        readonly body: import("zod").ZodObject<{
            text: import("zod").ZodString;
        }, import("zod/v4/core").$strict>;
        readonly response: {
            readonly 409: import("zod").ZodObject<{
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
            readonly 200: import("zod").ZodObject<{
                payoutDetails: import("zod").ZodNullable<import("zod").ZodObject<{
                    text: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly teamPeople: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: string;
        readonly description: string;
        readonly response: {
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
            readonly 200: import("zod").ZodObject<{
                people: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    code: import("zod").ZodString;
                    displayName: import("zod").ZodString;
                    kind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                        service: "service";
                    }>;
                    role: import("zod").ZodEnum<{
                        owner: "owner";
                        team_lead: "team_lead";
                        chatter: "chatter";
                        agent: "agent";
                        contractor: "contractor";
                        service: "service";
                        content_manager: "content_manager";
                    }>;
                    state: import("zod").ZodEnum<{
                        left: "left";
                        invited: "invited";
                        set_up: "set_up";
                        working: "working";
                    }>;
                    leftOn: import("zod").ZodNullable<import("zod").ZodString>;
                    telegram: import("zod").ZodObject<{
                        userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        handle: import("zod").ZodNullable<import("zod").ZodString>;
                        reportTag: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>;
                    logins: import("zod").ZodArray<import("zod").ZodObject<{
                        userId: import("zod").ZodNumber;
                        username: import("zod").ZodString;
                        role: import("zod").ZodEnum<{
                            owner: "owner";
                            team_lead: "team_lead";
                            chatter: "chatter";
                        }>;
                        state: import("zod").ZodEnum<{
                            active: "active";
                            deleted: "deleted";
                            disabled: "disabled";
                            invited: "invited";
                        }>;
                        lastSeenAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    agentKeys: import("zod").ZodArray<import("zod").ZodObject<{
                        agentKeyId: import("zod").ZodNumber;
                        name: import("zod").ZodString;
                        state: import("zod").ZodEnum<{
                            active: "active";
                            expired: "expired";
                            revoked: "revoked";
                        }>;
                    }, import("zod/v4/core").$strip>>;
                    workingPages: import("zod").ZodArray<import("zod").ZodObject<{
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        modelSlug: import("zod").ZodString;
                        modelName: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    schedule: import("zod").ZodNullable<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        personId: import("zod").ZodNumber;
                        pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                        startMinute: import("zod").ZodNumber;
                        endMinute: import("zod").ZodNumber;
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>;
                        validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                        validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    pageSchedules: import("zod").ZodArray<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        personId: import("zod").ZodNumber;
                        pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                        startMinute: import("zod").ZodNumber;
                        endMinute: import("zod").ZodNumber;
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>;
                        validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                        validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    rights: import("zod").ZodArray<import("zod").ZodObject<{
                        right: import("zod").ZodEnum<{
                            customs_lead: "customs_lead";
                            records_customs: "records_customs";
                            submits_shift: "submits_shift";
                            sees_own_pay: "sees_own_pay";
                        }>;
                        grantedAt: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    onboarding: import("zod").ZodArray<import("zod").ZodObject<{
                        step: import("zod").ZodString;
                        doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                        note: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                    importNotes: import("zod").ZodArray<import("zod").ZodObject<{
                        code: import("zod").ZodString;
                        text: import("zod").ZodString;
                        settledAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    origin: import("zod").ZodEnum<{
                        owner: "owner";
                        import: "import";
                        proposal: "proposal";
                    }>;
                    openProposals: import("zod").ZodNumber;
                    createdAt: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                unlinkedLogins: import("zod").ZodArray<import("zod").ZodObject<{
                    userId: import("zod").ZodNumber;
                    username: import("zod").ZodString;
                    role: import("zod").ZodEnum<{
                        owner: "owner";
                        team_lead: "team_lead";
                        chatter: "chatter";
                    }>;
                    state: import("zod").ZodEnum<{
                        active: "active";
                        deleted: "deleted";
                        disabled: "disabled";
                        invited: "invited";
                    }>;
                    lastSeenAt: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPerson: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "One person with everything: the record, every schedule slot, the pay terms and the agents' proposals";
        readonly params: import("zod").ZodObject<{
            code: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
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
            readonly 200: import("zod").ZodObject<{
                person: import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    code: import("zod").ZodString;
                    displayName: import("zod").ZodString;
                    kind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                        service: "service";
                    }>;
                    role: import("zod").ZodEnum<{
                        owner: "owner";
                        team_lead: "team_lead";
                        chatter: "chatter";
                        agent: "agent";
                        contractor: "contractor";
                        service: "service";
                        content_manager: "content_manager";
                    }>;
                    state: import("zod").ZodEnum<{
                        left: "left";
                        invited: "invited";
                        set_up: "set_up";
                        working: "working";
                    }>;
                    leftOn: import("zod").ZodNullable<import("zod").ZodString>;
                    telegram: import("zod").ZodObject<{
                        userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        handle: import("zod").ZodNullable<import("zod").ZodString>;
                        reportTag: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>;
                    logins: import("zod").ZodArray<import("zod").ZodObject<{
                        userId: import("zod").ZodNumber;
                        username: import("zod").ZodString;
                        role: import("zod").ZodEnum<{
                            owner: "owner";
                            team_lead: "team_lead";
                            chatter: "chatter";
                        }>;
                        state: import("zod").ZodEnum<{
                            active: "active";
                            deleted: "deleted";
                            disabled: "disabled";
                            invited: "invited";
                        }>;
                        lastSeenAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    agentKeys: import("zod").ZodArray<import("zod").ZodObject<{
                        agentKeyId: import("zod").ZodNumber;
                        name: import("zod").ZodString;
                        state: import("zod").ZodEnum<{
                            active: "active";
                            expired: "expired";
                            revoked: "revoked";
                        }>;
                    }, import("zod/v4/core").$strip>>;
                    workingPages: import("zod").ZodArray<import("zod").ZodObject<{
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        modelSlug: import("zod").ZodString;
                        modelName: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    schedule: import("zod").ZodNullable<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        personId: import("zod").ZodNumber;
                        pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                        startMinute: import("zod").ZodNumber;
                        endMinute: import("zod").ZodNumber;
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>;
                        validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                        validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    pageSchedules: import("zod").ZodArray<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        personId: import("zod").ZodNumber;
                        pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                        startMinute: import("zod").ZodNumber;
                        endMinute: import("zod").ZodNumber;
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>;
                        validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                        validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    rights: import("zod").ZodArray<import("zod").ZodObject<{
                        right: import("zod").ZodEnum<{
                            customs_lead: "customs_lead";
                            records_customs: "records_customs";
                            submits_shift: "submits_shift";
                            sees_own_pay: "sees_own_pay";
                        }>;
                        grantedAt: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    onboarding: import("zod").ZodArray<import("zod").ZodObject<{
                        step: import("zod").ZodString;
                        doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                        note: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                    importNotes: import("zod").ZodArray<import("zod").ZodObject<{
                        code: import("zod").ZodString;
                        text: import("zod").ZodString;
                        settledAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    origin: import("zod").ZodEnum<{
                        owner: "owner";
                        import: "import";
                        proposal: "proposal";
                    }>;
                    openProposals: import("zod").ZodNumber;
                    createdAt: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>;
                scheduleSlots: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    personId: import("zod").ZodNumber;
                    pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                    startMinute: import("zod").ZodNumber;
                    endMinute: import("zod").ZodNumber;
                    start: import("zod").ZodString;
                    end: import("zod").ZodString;
                    weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                        mon: "mon";
                        tue: "tue";
                        wed: "wed";
                        thu: "thu";
                        fri: "fri";
                        sat: "sat";
                        sun: "sun";
                    }>>>;
                    validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                    validTo: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                payTerms: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    modelSlug: import("zod").ZodString;
                    modelName: import("zod").ZodString;
                    validFrom: import("zod").ZodString;
                    validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    shareBasisPoints: import("zod").ZodNumber;
                    fixPerShiftMills: import("zod").ZodNumber;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                proposals: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    kind: import("zod").ZodEnum<{
                        update: "update";
                        create: "create";
                    }>;
                    personCode: import("zod").ZodString;
                    change: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>;
                    reason: import("zod").ZodString;
                    requestedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    sourceRef: import("zod").ZodNullable<import("zod").ZodString>;
                    agentKeyName: import("zod").ZodString;
                    state: import("zod").ZodEnum<{
                        rejected: "rejected";
                        withdrawn: "withdrawn";
                        open: "open";
                        accepted: "accepted";
                    }>;
                    createdAt: import("zod").ZodString;
                    decidedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    decisionNote: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                start: import("zod").ZodNullable<import("zod").ZodObject<{
                    newcomer: import("zod").ZodBoolean;
                    signedUp: import("zod").ZodBoolean;
                    steps: import("zod").ZodArray<import("zod").ZodObject<{
                        step: import("zod").ZodEnum<{
                            pages: "pages";
                            install: "install";
                            extension: "extension";
                            activity: "activity";
                            payout: "payout";
                        }>;
                        done: import("zod").ZodBoolean;
                        doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    done: import("zod").ZodNumber;
                    total: import("zod").ZodNumber;
                    current: import("zod").ZodNullable<import("zod").ZodEnum<{
                        pages: "pages";
                        install: "install";
                        extension: "extension";
                        activity: "activity";
                        payout: "payout";
                    }>>;
                    since: import("zod").ZodNullable<import("zod").ZodString>;
                    stuck: import("zod").ZodBoolean;
                    extension: import("zod").ZodNullable<import("zod").ZodObject<{
                        label: import("zod").ZodString;
                        signedInAt: import("zod").ZodString;
                        active: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                    pages: import("zod").ZodArray<import("zod").ZodObject<{
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        modelName: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    firstActivity: import("zod").ZodNullable<import("zod").ZodObject<{
                        at: import("zod").ZodString;
                        pageLabel: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
                payoutDetails: import("zod").ZodNullable<import("zod").ZodObject<{
                    text: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPersonCreate: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Create a person, and with `invite` their login and invite link, with `payTerms` their pay terms, in the same transaction";
        readonly description: string;
        readonly body: import("zod").ZodObject<{
            state: import("zod").ZodOptional<import("zod").ZodEnum<{
                left: "left";
                invited: "invited";
                set_up: "set_up";
                working: "working";
            }>>;
            leftOn: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
            telegram: import("zod").ZodOptional<import("zod").ZodObject<{
                userId: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodNumber>>;
                handle: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                reportTag: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
            }, import("zod/v4/core").$strip>>;
            workingPageLabels: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
            schedule: import("zod").ZodOptional<import("zod").ZodObject<{
                pageLabel: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                from: import("zod").ZodNullable<import("zod").ZodString>;
                slot: import("zod").ZodNullable<import("zod").ZodObject<{
                    start: import("zod").ZodString;
                    end: import("zod").ZodString;
                    weekdays: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                        mon: "mon";
                        tue: "tue";
                        wed: "wed";
                        thu: "thu";
                        fri: "fri";
                        sat: "sat";
                        sun: "sun";
                    }>>>>;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>>;
            rights: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodEnum<{
                customs_lead: "customs_lead";
                records_customs: "records_customs";
                submits_shift: "submits_shift";
                sees_own_pay: "sees_own_pay";
            }>>>;
            onboarding: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                step: import("zod").ZodString;
                doneAt: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodISODateTime>>;
                note: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
            }, import("zod/v4/core").$strip>>>;
            note: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
            logins: import("zod").ZodOptional<import("zod").ZodObject<{
                add: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodNumber>>;
                remove: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodNumber>>;
            }, import("zod/v4/core").$strip>>;
            agentKeys: import("zod").ZodOptional<import("zod").ZodObject<{
                add: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodNumber>>;
                remove: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodNumber>>;
            }, import("zod/v4/core").$strip>>;
            invite: import("zod").ZodOptional<import("zod").ZodObject<{
                username: import("zod").ZodString;
                role: import("zod").ZodOptional<import("zod").ZodEnum<{
                    team_lead: "team_lead";
                    chatter: "chatter";
                }>>;
                pageLabels: import("zod").ZodArray<import("zod").ZodString>;
                expiresInHours: import("zod").ZodOptional<import("zod").ZodNumber>;
            }, import("zod/v4/core").$strip>>;
            payTerms: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                modelSlug: import("zod").ZodString;
                validFrom: import("zod").ZodString;
                shareBasisPoints: import("zod").ZodNumber;
                fixPerShiftMills: import("zod").ZodNumber;
                note: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
            }, import("zod/v4/core").$strip>>>;
            displayName: import("zod").ZodString;
            role: import("zod").ZodEnum<{
                owner: "owner";
                team_lead: "team_lead";
                chatter: "chatter";
                agent: "agent";
                contractor: "contractor";
                service: "service";
                content_manager: "content_manager";
            }>;
            code: import("zod").ZodString;
            kind: import("zod").ZodOptional<import("zod").ZodEnum<{
                human: "human";
                agent: "agent";
                service: "service";
            }>>;
        }, import("zod/v4/core").$strip>;
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
            readonly 200: import("zod").ZodObject<{
                person: import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    code: import("zod").ZodString;
                    displayName: import("zod").ZodString;
                    kind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                        service: "service";
                    }>;
                    role: import("zod").ZodEnum<{
                        owner: "owner";
                        team_lead: "team_lead";
                        chatter: "chatter";
                        agent: "agent";
                        contractor: "contractor";
                        service: "service";
                        content_manager: "content_manager";
                    }>;
                    state: import("zod").ZodEnum<{
                        left: "left";
                        invited: "invited";
                        set_up: "set_up";
                        working: "working";
                    }>;
                    leftOn: import("zod").ZodNullable<import("zod").ZodString>;
                    telegram: import("zod").ZodObject<{
                        userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        handle: import("zod").ZodNullable<import("zod").ZodString>;
                        reportTag: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>;
                    logins: import("zod").ZodArray<import("zod").ZodObject<{
                        userId: import("zod").ZodNumber;
                        username: import("zod").ZodString;
                        role: import("zod").ZodEnum<{
                            owner: "owner";
                            team_lead: "team_lead";
                            chatter: "chatter";
                        }>;
                        state: import("zod").ZodEnum<{
                            active: "active";
                            deleted: "deleted";
                            disabled: "disabled";
                            invited: "invited";
                        }>;
                        lastSeenAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    agentKeys: import("zod").ZodArray<import("zod").ZodObject<{
                        agentKeyId: import("zod").ZodNumber;
                        name: import("zod").ZodString;
                        state: import("zod").ZodEnum<{
                            active: "active";
                            expired: "expired";
                            revoked: "revoked";
                        }>;
                    }, import("zod/v4/core").$strip>>;
                    workingPages: import("zod").ZodArray<import("zod").ZodObject<{
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        modelSlug: import("zod").ZodString;
                        modelName: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    schedule: import("zod").ZodNullable<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        personId: import("zod").ZodNumber;
                        pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                        startMinute: import("zod").ZodNumber;
                        endMinute: import("zod").ZodNumber;
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>;
                        validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                        validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    pageSchedules: import("zod").ZodArray<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        personId: import("zod").ZodNumber;
                        pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                        startMinute: import("zod").ZodNumber;
                        endMinute: import("zod").ZodNumber;
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>;
                        validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                        validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    rights: import("zod").ZodArray<import("zod").ZodObject<{
                        right: import("zod").ZodEnum<{
                            customs_lead: "customs_lead";
                            records_customs: "records_customs";
                            submits_shift: "submits_shift";
                            sees_own_pay: "sees_own_pay";
                        }>;
                        grantedAt: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    onboarding: import("zod").ZodArray<import("zod").ZodObject<{
                        step: import("zod").ZodString;
                        doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                        note: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                    importNotes: import("zod").ZodArray<import("zod").ZodObject<{
                        code: import("zod").ZodString;
                        text: import("zod").ZodString;
                        settledAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    origin: import("zod").ZodEnum<{
                        owner: "owner";
                        import: "import";
                        proposal: "proposal";
                    }>;
                    openProposals: import("zod").ZodNumber;
                    createdAt: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>;
                scheduleSlots: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    personId: import("zod").ZodNumber;
                    pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                    startMinute: import("zod").ZodNumber;
                    endMinute: import("zod").ZodNumber;
                    start: import("zod").ZodString;
                    end: import("zod").ZodString;
                    weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                        mon: "mon";
                        tue: "tue";
                        wed: "wed";
                        thu: "thu";
                        fri: "fri";
                        sat: "sat";
                        sun: "sun";
                    }>>>;
                    validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                    validTo: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                payTerms: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    modelSlug: import("zod").ZodString;
                    modelName: import("zod").ZodString;
                    validFrom: import("zod").ZodString;
                    validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    shareBasisPoints: import("zod").ZodNumber;
                    fixPerShiftMills: import("zod").ZodNumber;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                proposals: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    kind: import("zod").ZodEnum<{
                        update: "update";
                        create: "create";
                    }>;
                    personCode: import("zod").ZodString;
                    change: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>;
                    reason: import("zod").ZodString;
                    requestedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    sourceRef: import("zod").ZodNullable<import("zod").ZodString>;
                    agentKeyName: import("zod").ZodString;
                    state: import("zod").ZodEnum<{
                        rejected: "rejected";
                        withdrawn: "withdrawn";
                        open: "open";
                        accepted: "accepted";
                    }>;
                    createdAt: import("zod").ZodString;
                    decidedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    decisionNote: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                start: import("zod").ZodNullable<import("zod").ZodObject<{
                    newcomer: import("zod").ZodBoolean;
                    signedUp: import("zod").ZodBoolean;
                    steps: import("zod").ZodArray<import("zod").ZodObject<{
                        step: import("zod").ZodEnum<{
                            pages: "pages";
                            install: "install";
                            extension: "extension";
                            activity: "activity";
                            payout: "payout";
                        }>;
                        done: import("zod").ZodBoolean;
                        doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    done: import("zod").ZodNumber;
                    total: import("zod").ZodNumber;
                    current: import("zod").ZodNullable<import("zod").ZodEnum<{
                        pages: "pages";
                        install: "install";
                        extension: "extension";
                        activity: "activity";
                        payout: "payout";
                    }>>;
                    since: import("zod").ZodNullable<import("zod").ZodString>;
                    stuck: import("zod").ZodBoolean;
                    extension: import("zod").ZodNullable<import("zod").ZodObject<{
                        label: import("zod").ZodString;
                        signedInAt: import("zod").ZodString;
                        active: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                    pages: import("zod").ZodArray<import("zod").ZodObject<{
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        modelName: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    firstActivity: import("zod").ZodNullable<import("zod").ZodObject<{
                        at: import("zod").ZodString;
                        pageLabel: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
                payoutDetails: import("zod").ZodNullable<import("zod").ZodObject<{
                    text: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
                invite: import("zod").ZodNullable<import("zod").ZodObject<{
                    userId: import("zod").ZodNumber;
                    username: import("zod").ZodString;
                    link: import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        keyPrefix: import("zod").ZodString;
                        token: import("zod").ZodString;
                        expiresAt: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPersonUpdate: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Change a person: the record, logins and keys linked, working pages, a new schedule from a day, rights, onboarding";
        readonly description: string;
        readonly params: import("zod").ZodObject<{
            code: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{
            displayName: import("zod").ZodOptional<import("zod").ZodString>;
            role: import("zod").ZodOptional<import("zod").ZodEnum<{
                owner: "owner";
                team_lead: "team_lead";
                chatter: "chatter";
                agent: "agent";
                contractor: "contractor";
                service: "service";
                content_manager: "content_manager";
            }>>;
            state: import("zod").ZodOptional<import("zod").ZodEnum<{
                left: "left";
                invited: "invited";
                set_up: "set_up";
                working: "working";
            }>>;
            leftOn: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
            telegram: import("zod").ZodOptional<import("zod").ZodObject<{
                userId: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodNumber>>;
                handle: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                reportTag: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
            }, import("zod/v4/core").$strip>>;
            workingPageLabels: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
            schedule: import("zod").ZodOptional<import("zod").ZodObject<{
                pageLabel: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                from: import("zod").ZodNullable<import("zod").ZodString>;
                slot: import("zod").ZodNullable<import("zod").ZodObject<{
                    start: import("zod").ZodString;
                    end: import("zod").ZodString;
                    weekdays: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                        mon: "mon";
                        tue: "tue";
                        wed: "wed";
                        thu: "thu";
                        fri: "fri";
                        sat: "sat";
                        sun: "sun";
                    }>>>>;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>>;
            rights: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodEnum<{
                customs_lead: "customs_lead";
                records_customs: "records_customs";
                submits_shift: "submits_shift";
                sees_own_pay: "sees_own_pay";
            }>>>;
            onboarding: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                step: import("zod").ZodString;
                doneAt: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodISODateTime>>;
                note: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
            }, import("zod/v4/core").$strip>>>;
            note: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
            logins: import("zod").ZodOptional<import("zod").ZodObject<{
                add: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodNumber>>;
                remove: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodNumber>>;
            }, import("zod/v4/core").$strip>>;
            agentKeys: import("zod").ZodOptional<import("zod").ZodObject<{
                add: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodNumber>>;
                remove: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodNumber>>;
            }, import("zod/v4/core").$strip>>;
        }, import("zod/v4/core").$strip>;
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
            readonly 200: import("zod").ZodObject<{
                person: import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    code: import("zod").ZodString;
                    displayName: import("zod").ZodString;
                    kind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                        service: "service";
                    }>;
                    role: import("zod").ZodEnum<{
                        owner: "owner";
                        team_lead: "team_lead";
                        chatter: "chatter";
                        agent: "agent";
                        contractor: "contractor";
                        service: "service";
                        content_manager: "content_manager";
                    }>;
                    state: import("zod").ZodEnum<{
                        left: "left";
                        invited: "invited";
                        set_up: "set_up";
                        working: "working";
                    }>;
                    leftOn: import("zod").ZodNullable<import("zod").ZodString>;
                    telegram: import("zod").ZodObject<{
                        userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        handle: import("zod").ZodNullable<import("zod").ZodString>;
                        reportTag: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>;
                    logins: import("zod").ZodArray<import("zod").ZodObject<{
                        userId: import("zod").ZodNumber;
                        username: import("zod").ZodString;
                        role: import("zod").ZodEnum<{
                            owner: "owner";
                            team_lead: "team_lead";
                            chatter: "chatter";
                        }>;
                        state: import("zod").ZodEnum<{
                            active: "active";
                            deleted: "deleted";
                            disabled: "disabled";
                            invited: "invited";
                        }>;
                        lastSeenAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    agentKeys: import("zod").ZodArray<import("zod").ZodObject<{
                        agentKeyId: import("zod").ZodNumber;
                        name: import("zod").ZodString;
                        state: import("zod").ZodEnum<{
                            active: "active";
                            expired: "expired";
                            revoked: "revoked";
                        }>;
                    }, import("zod/v4/core").$strip>>;
                    workingPages: import("zod").ZodArray<import("zod").ZodObject<{
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        modelSlug: import("zod").ZodString;
                        modelName: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    schedule: import("zod").ZodNullable<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        personId: import("zod").ZodNumber;
                        pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                        startMinute: import("zod").ZodNumber;
                        endMinute: import("zod").ZodNumber;
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>;
                        validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                        validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    pageSchedules: import("zod").ZodArray<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        personId: import("zod").ZodNumber;
                        pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                        startMinute: import("zod").ZodNumber;
                        endMinute: import("zod").ZodNumber;
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>;
                        validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                        validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    rights: import("zod").ZodArray<import("zod").ZodObject<{
                        right: import("zod").ZodEnum<{
                            customs_lead: "customs_lead";
                            records_customs: "records_customs";
                            submits_shift: "submits_shift";
                            sees_own_pay: "sees_own_pay";
                        }>;
                        grantedAt: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    onboarding: import("zod").ZodArray<import("zod").ZodObject<{
                        step: import("zod").ZodString;
                        doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                        note: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                    importNotes: import("zod").ZodArray<import("zod").ZodObject<{
                        code: import("zod").ZodString;
                        text: import("zod").ZodString;
                        settledAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    origin: import("zod").ZodEnum<{
                        owner: "owner";
                        import: "import";
                        proposal: "proposal";
                    }>;
                    openProposals: import("zod").ZodNumber;
                    createdAt: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>;
                scheduleSlots: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    personId: import("zod").ZodNumber;
                    pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                    startMinute: import("zod").ZodNumber;
                    endMinute: import("zod").ZodNumber;
                    start: import("zod").ZodString;
                    end: import("zod").ZodString;
                    weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                        mon: "mon";
                        tue: "tue";
                        wed: "wed";
                        thu: "thu";
                        fri: "fri";
                        sat: "sat";
                        sun: "sun";
                    }>>>;
                    validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                    validTo: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                payTerms: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    modelSlug: import("zod").ZodString;
                    modelName: import("zod").ZodString;
                    validFrom: import("zod").ZodString;
                    validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    shareBasisPoints: import("zod").ZodNumber;
                    fixPerShiftMills: import("zod").ZodNumber;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                proposals: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    kind: import("zod").ZodEnum<{
                        update: "update";
                        create: "create";
                    }>;
                    personCode: import("zod").ZodString;
                    change: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>;
                    reason: import("zod").ZodString;
                    requestedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    sourceRef: import("zod").ZodNullable<import("zod").ZodString>;
                    agentKeyName: import("zod").ZodString;
                    state: import("zod").ZodEnum<{
                        rejected: "rejected";
                        withdrawn: "withdrawn";
                        open: "open";
                        accepted: "accepted";
                    }>;
                    createdAt: import("zod").ZodString;
                    decidedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    decisionNote: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                start: import("zod").ZodNullable<import("zod").ZodObject<{
                    newcomer: import("zod").ZodBoolean;
                    signedUp: import("zod").ZodBoolean;
                    steps: import("zod").ZodArray<import("zod").ZodObject<{
                        step: import("zod").ZodEnum<{
                            pages: "pages";
                            install: "install";
                            extension: "extension";
                            activity: "activity";
                            payout: "payout";
                        }>;
                        done: import("zod").ZodBoolean;
                        doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    done: import("zod").ZodNumber;
                    total: import("zod").ZodNumber;
                    current: import("zod").ZodNullable<import("zod").ZodEnum<{
                        pages: "pages";
                        install: "install";
                        extension: "extension";
                        activity: "activity";
                        payout: "payout";
                    }>>;
                    since: import("zod").ZodNullable<import("zod").ZodString>;
                    stuck: import("zod").ZodBoolean;
                    extension: import("zod").ZodNullable<import("zod").ZodObject<{
                        label: import("zod").ZodString;
                        signedInAt: import("zod").ZodString;
                        active: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                    pages: import("zod").ZodArray<import("zod").ZodObject<{
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        modelName: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    firstActivity: import("zod").ZodNullable<import("zod").ZodObject<{
                        at: import("zod").ZodString;
                        pageLabel: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
                payoutDetails: import("zod").ZodNullable<import("zod").ZodObject<{
                    text: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPersonPayTermSet: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Set a person's pay terms on a model from a day: share and fix per shift; the same day again corrects it";
        readonly description: string;
        readonly params: import("zod").ZodObject<{
            code: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{
            modelSlug: import("zod").ZodString;
            validFrom: import("zod").ZodString;
            shareBasisPoints: import("zod").ZodNumber;
            fixPerShiftMills: import("zod").ZodNumber;
            note: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
        }, import("zod/v4/core").$strip>;
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
            readonly 200: import("zod").ZodObject<{
                person: import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    code: import("zod").ZodString;
                    displayName: import("zod").ZodString;
                    kind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                        service: "service";
                    }>;
                    role: import("zod").ZodEnum<{
                        owner: "owner";
                        team_lead: "team_lead";
                        chatter: "chatter";
                        agent: "agent";
                        contractor: "contractor";
                        service: "service";
                        content_manager: "content_manager";
                    }>;
                    state: import("zod").ZodEnum<{
                        left: "left";
                        invited: "invited";
                        set_up: "set_up";
                        working: "working";
                    }>;
                    leftOn: import("zod").ZodNullable<import("zod").ZodString>;
                    telegram: import("zod").ZodObject<{
                        userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        handle: import("zod").ZodNullable<import("zod").ZodString>;
                        reportTag: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>;
                    logins: import("zod").ZodArray<import("zod").ZodObject<{
                        userId: import("zod").ZodNumber;
                        username: import("zod").ZodString;
                        role: import("zod").ZodEnum<{
                            owner: "owner";
                            team_lead: "team_lead";
                            chatter: "chatter";
                        }>;
                        state: import("zod").ZodEnum<{
                            active: "active";
                            deleted: "deleted";
                            disabled: "disabled";
                            invited: "invited";
                        }>;
                        lastSeenAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    agentKeys: import("zod").ZodArray<import("zod").ZodObject<{
                        agentKeyId: import("zod").ZodNumber;
                        name: import("zod").ZodString;
                        state: import("zod").ZodEnum<{
                            active: "active";
                            expired: "expired";
                            revoked: "revoked";
                        }>;
                    }, import("zod/v4/core").$strip>>;
                    workingPages: import("zod").ZodArray<import("zod").ZodObject<{
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        modelSlug: import("zod").ZodString;
                        modelName: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    schedule: import("zod").ZodNullable<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        personId: import("zod").ZodNumber;
                        pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                        startMinute: import("zod").ZodNumber;
                        endMinute: import("zod").ZodNumber;
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>;
                        validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                        validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    pageSchedules: import("zod").ZodArray<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        personId: import("zod").ZodNumber;
                        pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                        startMinute: import("zod").ZodNumber;
                        endMinute: import("zod").ZodNumber;
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>;
                        validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                        validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    rights: import("zod").ZodArray<import("zod").ZodObject<{
                        right: import("zod").ZodEnum<{
                            customs_lead: "customs_lead";
                            records_customs: "records_customs";
                            submits_shift: "submits_shift";
                            sees_own_pay: "sees_own_pay";
                        }>;
                        grantedAt: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    onboarding: import("zod").ZodArray<import("zod").ZodObject<{
                        step: import("zod").ZodString;
                        doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                        note: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                    importNotes: import("zod").ZodArray<import("zod").ZodObject<{
                        code: import("zod").ZodString;
                        text: import("zod").ZodString;
                        settledAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    origin: import("zod").ZodEnum<{
                        owner: "owner";
                        import: "import";
                        proposal: "proposal";
                    }>;
                    openProposals: import("zod").ZodNumber;
                    createdAt: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>;
                scheduleSlots: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    personId: import("zod").ZodNumber;
                    pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                    startMinute: import("zod").ZodNumber;
                    endMinute: import("zod").ZodNumber;
                    start: import("zod").ZodString;
                    end: import("zod").ZodString;
                    weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                        mon: "mon";
                        tue: "tue";
                        wed: "wed";
                        thu: "thu";
                        fri: "fri";
                        sat: "sat";
                        sun: "sun";
                    }>>>;
                    validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                    validTo: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                payTerms: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    modelSlug: import("zod").ZodString;
                    modelName: import("zod").ZodString;
                    validFrom: import("zod").ZodString;
                    validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    shareBasisPoints: import("zod").ZodNumber;
                    fixPerShiftMills: import("zod").ZodNumber;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                proposals: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    kind: import("zod").ZodEnum<{
                        update: "update";
                        create: "create";
                    }>;
                    personCode: import("zod").ZodString;
                    change: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>;
                    reason: import("zod").ZodString;
                    requestedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    sourceRef: import("zod").ZodNullable<import("zod").ZodString>;
                    agentKeyName: import("zod").ZodString;
                    state: import("zod").ZodEnum<{
                        rejected: "rejected";
                        withdrawn: "withdrawn";
                        open: "open";
                        accepted: "accepted";
                    }>;
                    createdAt: import("zod").ZodString;
                    decidedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    decisionNote: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                start: import("zod").ZodNullable<import("zod").ZodObject<{
                    newcomer: import("zod").ZodBoolean;
                    signedUp: import("zod").ZodBoolean;
                    steps: import("zod").ZodArray<import("zod").ZodObject<{
                        step: import("zod").ZodEnum<{
                            pages: "pages";
                            install: "install";
                            extension: "extension";
                            activity: "activity";
                            payout: "payout";
                        }>;
                        done: import("zod").ZodBoolean;
                        doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    done: import("zod").ZodNumber;
                    total: import("zod").ZodNumber;
                    current: import("zod").ZodNullable<import("zod").ZodEnum<{
                        pages: "pages";
                        install: "install";
                        extension: "extension";
                        activity: "activity";
                        payout: "payout";
                    }>>;
                    since: import("zod").ZodNullable<import("zod").ZodString>;
                    stuck: import("zod").ZodBoolean;
                    extension: import("zod").ZodNullable<import("zod").ZodObject<{
                        label: import("zod").ZodString;
                        signedInAt: import("zod").ZodString;
                        active: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                    pages: import("zod").ZodArray<import("zod").ZodObject<{
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        modelName: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    firstActivity: import("zod").ZodNullable<import("zod").ZodObject<{
                        at: import("zod").ZodString;
                        pageLabel: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
                payoutDetails: import("zod").ZodNullable<import("zod").ZodObject<{
                    text: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPersonImportNoteSettle: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Mark one of a person's import notes «Сверено» (or take it back): the owner looked into the disagreement";
        readonly description: "The note is named by its place in the list and its code; 409 when they no longer match. Audited.";
        readonly params: import("zod").ZodObject<{
            code: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{
            index: import("zod").ZodNumber;
            code: import("zod").ZodString;
            settled: import("zod").ZodBoolean;
        }, import("zod/v4/core").$strip>;
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
            readonly 200: import("zod").ZodObject<{
                person: import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    code: import("zod").ZodString;
                    displayName: import("zod").ZodString;
                    kind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                        service: "service";
                    }>;
                    role: import("zod").ZodEnum<{
                        owner: "owner";
                        team_lead: "team_lead";
                        chatter: "chatter";
                        agent: "agent";
                        contractor: "contractor";
                        service: "service";
                        content_manager: "content_manager";
                    }>;
                    state: import("zod").ZodEnum<{
                        left: "left";
                        invited: "invited";
                        set_up: "set_up";
                        working: "working";
                    }>;
                    leftOn: import("zod").ZodNullable<import("zod").ZodString>;
                    telegram: import("zod").ZodObject<{
                        userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        handle: import("zod").ZodNullable<import("zod").ZodString>;
                        reportTag: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>;
                    logins: import("zod").ZodArray<import("zod").ZodObject<{
                        userId: import("zod").ZodNumber;
                        username: import("zod").ZodString;
                        role: import("zod").ZodEnum<{
                            owner: "owner";
                            team_lead: "team_lead";
                            chatter: "chatter";
                        }>;
                        state: import("zod").ZodEnum<{
                            active: "active";
                            deleted: "deleted";
                            disabled: "disabled";
                            invited: "invited";
                        }>;
                        lastSeenAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    agentKeys: import("zod").ZodArray<import("zod").ZodObject<{
                        agentKeyId: import("zod").ZodNumber;
                        name: import("zod").ZodString;
                        state: import("zod").ZodEnum<{
                            active: "active";
                            expired: "expired";
                            revoked: "revoked";
                        }>;
                    }, import("zod/v4/core").$strip>>;
                    workingPages: import("zod").ZodArray<import("zod").ZodObject<{
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        modelSlug: import("zod").ZodString;
                        modelName: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    schedule: import("zod").ZodNullable<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        personId: import("zod").ZodNumber;
                        pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                        startMinute: import("zod").ZodNumber;
                        endMinute: import("zod").ZodNumber;
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>;
                        validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                        validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    pageSchedules: import("zod").ZodArray<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        personId: import("zod").ZodNumber;
                        pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                        startMinute: import("zod").ZodNumber;
                        endMinute: import("zod").ZodNumber;
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>;
                        validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                        validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    rights: import("zod").ZodArray<import("zod").ZodObject<{
                        right: import("zod").ZodEnum<{
                            customs_lead: "customs_lead";
                            records_customs: "records_customs";
                            submits_shift: "submits_shift";
                            sees_own_pay: "sees_own_pay";
                        }>;
                        grantedAt: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    onboarding: import("zod").ZodArray<import("zod").ZodObject<{
                        step: import("zod").ZodString;
                        doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                        note: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                    importNotes: import("zod").ZodArray<import("zod").ZodObject<{
                        code: import("zod").ZodString;
                        text: import("zod").ZodString;
                        settledAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    origin: import("zod").ZodEnum<{
                        owner: "owner";
                        import: "import";
                        proposal: "proposal";
                    }>;
                    openProposals: import("zod").ZodNumber;
                    createdAt: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>;
                scheduleSlots: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    personId: import("zod").ZodNumber;
                    pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                    startMinute: import("zod").ZodNumber;
                    endMinute: import("zod").ZodNumber;
                    start: import("zod").ZodString;
                    end: import("zod").ZodString;
                    weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                        mon: "mon";
                        tue: "tue";
                        wed: "wed";
                        thu: "thu";
                        fri: "fri";
                        sat: "sat";
                        sun: "sun";
                    }>>>;
                    validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                    validTo: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                payTerms: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    modelSlug: import("zod").ZodString;
                    modelName: import("zod").ZodString;
                    validFrom: import("zod").ZodString;
                    validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    shareBasisPoints: import("zod").ZodNumber;
                    fixPerShiftMills: import("zod").ZodNumber;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                proposals: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    kind: import("zod").ZodEnum<{
                        update: "update";
                        create: "create";
                    }>;
                    personCode: import("zod").ZodString;
                    change: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>;
                    reason: import("zod").ZodString;
                    requestedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    sourceRef: import("zod").ZodNullable<import("zod").ZodString>;
                    agentKeyName: import("zod").ZodString;
                    state: import("zod").ZodEnum<{
                        rejected: "rejected";
                        withdrawn: "withdrawn";
                        open: "open";
                        accepted: "accepted";
                    }>;
                    createdAt: import("zod").ZodString;
                    decidedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    decisionNote: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                start: import("zod").ZodNullable<import("zod").ZodObject<{
                    newcomer: import("zod").ZodBoolean;
                    signedUp: import("zod").ZodBoolean;
                    steps: import("zod").ZodArray<import("zod").ZodObject<{
                        step: import("zod").ZodEnum<{
                            pages: "pages";
                            install: "install";
                            extension: "extension";
                            activity: "activity";
                            payout: "payout";
                        }>;
                        done: import("zod").ZodBoolean;
                        doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    done: import("zod").ZodNumber;
                    total: import("zod").ZodNumber;
                    current: import("zod").ZodNullable<import("zod").ZodEnum<{
                        pages: "pages";
                        install: "install";
                        extension: "extension";
                        activity: "activity";
                        payout: "payout";
                    }>>;
                    since: import("zod").ZodNullable<import("zod").ZodString>;
                    stuck: import("zod").ZodBoolean;
                    extension: import("zod").ZodNullable<import("zod").ZodObject<{
                        label: import("zod").ZodString;
                        signedInAt: import("zod").ZodString;
                        active: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                    pages: import("zod").ZodArray<import("zod").ZodObject<{
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        modelName: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    firstActivity: import("zod").ZodNullable<import("zod").ZodObject<{
                        at: import("zod").ZodString;
                        pageLabel: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
                payoutDetails: import("zod").ZodNullable<import("zod").ZodObject<{
                    text: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPeopleProposals: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "The agents' proposals about people, newest first (by default the open ones)";
        readonly querystring: import("zod").ZodObject<{
            state: import("zod").ZodOptional<import("zod").ZodEnum<{
                rejected: "rejected";
                withdrawn: "withdrawn";
                open: "open";
                accepted: "accepted";
            }>>;
        }, import("zod/v4/core").$strip>;
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
            readonly 200: import("zod").ZodObject<{
                proposals: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    kind: import("zod").ZodEnum<{
                        update: "update";
                        create: "create";
                    }>;
                    personCode: import("zod").ZodString;
                    change: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>;
                    reason: import("zod").ZodString;
                    requestedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    sourceRef: import("zod").ZodNullable<import("zod").ZodString>;
                    agentKeyName: import("zod").ZodString;
                    state: import("zod").ZodEnum<{
                        rejected: "rejected";
                        withdrawn: "withdrawn";
                        open: "open";
                        accepted: "accepted";
                    }>;
                    createdAt: import("zod").ZodString;
                    decidedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    decisionNote: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPersonProposalDecide: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Accept an agent's proposal (the change goes through the owner's own edit) or reject it";
        readonly description: "409 when it is decided already, or when the change no longer applies (then it stays open).";
        readonly params: import("zod").ZodObject<{
            proposalId: import("zod").ZodCoercedNumber<unknown>;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{
            decision: import("zod").ZodEnum<{
                reject: "reject";
                accept: "accept";
            }>;
            note: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strip>;
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
            readonly 200: import("zod").ZodObject<{
                proposal: import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    kind: import("zod").ZodEnum<{
                        update: "update";
                        create: "create";
                    }>;
                    personCode: import("zod").ZodString;
                    change: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>;
                    reason: import("zod").ZodString;
                    requestedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    sourceRef: import("zod").ZodNullable<import("zod").ZodString>;
                    agentKeyName: import("zod").ZodString;
                    state: import("zod").ZodEnum<{
                        rejected: "rejected";
                        withdrawn: "withdrawn";
                        open: "open";
                        accepted: "accepted";
                    }>;
                    createdAt: import("zod").ZodString;
                    decidedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    decisionNote: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>;
                person: import("zod").ZodNullable<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    code: import("zod").ZodString;
                    displayName: import("zod").ZodString;
                    kind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                        service: "service";
                    }>;
                    role: import("zod").ZodEnum<{
                        owner: "owner";
                        team_lead: "team_lead";
                        chatter: "chatter";
                        agent: "agent";
                        contractor: "contractor";
                        service: "service";
                        content_manager: "content_manager";
                    }>;
                    state: import("zod").ZodEnum<{
                        left: "left";
                        invited: "invited";
                        set_up: "set_up";
                        working: "working";
                    }>;
                    leftOn: import("zod").ZodNullable<import("zod").ZodString>;
                    telegram: import("zod").ZodObject<{
                        userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        handle: import("zod").ZodNullable<import("zod").ZodString>;
                        reportTag: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>;
                    logins: import("zod").ZodArray<import("zod").ZodObject<{
                        userId: import("zod").ZodNumber;
                        username: import("zod").ZodString;
                        role: import("zod").ZodEnum<{
                            owner: "owner";
                            team_lead: "team_lead";
                            chatter: "chatter";
                        }>;
                        state: import("zod").ZodEnum<{
                            active: "active";
                            deleted: "deleted";
                            disabled: "disabled";
                            invited: "invited";
                        }>;
                        lastSeenAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    agentKeys: import("zod").ZodArray<import("zod").ZodObject<{
                        agentKeyId: import("zod").ZodNumber;
                        name: import("zod").ZodString;
                        state: import("zod").ZodEnum<{
                            active: "active";
                            expired: "expired";
                            revoked: "revoked";
                        }>;
                    }, import("zod/v4/core").$strip>>;
                    workingPages: import("zod").ZodArray<import("zod").ZodObject<{
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        modelSlug: import("zod").ZodString;
                        modelName: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    schedule: import("zod").ZodNullable<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        personId: import("zod").ZodNumber;
                        pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                        startMinute: import("zod").ZodNumber;
                        endMinute: import("zod").ZodNumber;
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>;
                        validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                        validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    pageSchedules: import("zod").ZodArray<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        personId: import("zod").ZodNumber;
                        pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                        startMinute: import("zod").ZodNumber;
                        endMinute: import("zod").ZodNumber;
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>;
                        validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                        validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    rights: import("zod").ZodArray<import("zod").ZodObject<{
                        right: import("zod").ZodEnum<{
                            customs_lead: "customs_lead";
                            records_customs: "records_customs";
                            submits_shift: "submits_shift";
                            sees_own_pay: "sees_own_pay";
                        }>;
                        grantedAt: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    onboarding: import("zod").ZodArray<import("zod").ZodObject<{
                        step: import("zod").ZodString;
                        doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                        note: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                    importNotes: import("zod").ZodArray<import("zod").ZodObject<{
                        code: import("zod").ZodString;
                        text: import("zod").ZodString;
                        settledAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    origin: import("zod").ZodEnum<{
                        owner: "owner";
                        import: "import";
                        proposal: "proposal";
                    }>;
                    openProposals: import("zod").ZodNumber;
                    createdAt: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentPeople: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly description: string;
        readonly querystring: import("zod").ZodObject<{
            since: import("zod").ZodOptional<import("zod").ZodISODateTime>;
        }, import("zod/v4/core").$strip>;
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
            readonly 503: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                people: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    code: import("zod").ZodString;
                    displayName: import("zod").ZodString;
                    kind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                        service: "service";
                    }>;
                    role: import("zod").ZodEnum<{
                        owner: "owner";
                        team_lead: "team_lead";
                        chatter: "chatter";
                        agent: "agent";
                        contractor: "contractor";
                        service: "service";
                        content_manager: "content_manager";
                    }>;
                    state: import("zod").ZodEnum<{
                        left: "left";
                        invited: "invited";
                        set_up: "set_up";
                        working: "working";
                    }>;
                    leftOn: import("zod").ZodNullable<import("zod").ZodString>;
                    telegram: import("zod").ZodObject<{
                        userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        handle: import("zod").ZodNullable<import("zod").ZodString>;
                        reportTag: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>;
                    logins: import("zod").ZodArray<import("zod").ZodObject<{
                        userId: import("zod").ZodNumber;
                        username: import("zod").ZodString;
                        active: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                    agentKeys: import("zod").ZodArray<import("zod").ZodObject<{
                        name: import("zod").ZodString;
                        active: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                    workingPages: import("zod").ZodArray<import("zod").ZodObject<{
                        pageLabel: import("zod").ZodString;
                        modelSlug: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    schedule: import("zod").ZodNullable<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        personId: import("zod").ZodNumber;
                        pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                        startMinute: import("zod").ZodNumber;
                        endMinute: import("zod").ZodNumber;
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>;
                        validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                        validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    scheduleSlots: import("zod").ZodArray<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        personId: import("zod").ZodNumber;
                        pageId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                        startMinute: import("zod").ZodNumber;
                        endMinute: import("zod").ZodNumber;
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>;
                        validFrom: import("zod").ZodNullable<import("zod").ZodString>;
                        validTo: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    rights: import("zod").ZodArray<import("zod").ZodEnum<{
                        customs_lead: "customs_lead";
                        records_customs: "records_customs";
                        submits_shift: "submits_shift";
                        sees_own_pay: "sees_own_pay";
                    }>>;
                    updatedAt: import("zod").ZodString;
                    payTerms: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        modelSlug: import("zod").ZodString;
                        modelName: import("zod").ZodString;
                        validFrom: import("zod").ZodString;
                        validTo: import("zod").ZodNullable<import("zod").ZodString>;
                        shareBasisPoints: import("zod").ZodNumber;
                        fixPerShiftMills: import("zod").ZodNumber;
                        note: import("zod").ZodNullable<import("zod").ZodString>;
                        updatedAt: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>>;
                }, import("zod/v4/core").$strip>>;
                payTermsIncluded: import("zod").ZodBoolean;
                keyGrantExcludedPages: import("zod").ZodNumber;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentPersonProposalCreate: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Propose a change about a person, or a new person (needs propose:people): it waits for the owner; nothing changes now";
        readonly description: string;
        readonly body: import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
            kind: import("zod").ZodLiteral<"update">;
            personCode: import("zod").ZodString;
            change: import("zod").ZodObject<{
                displayName: import("zod").ZodOptional<import("zod").ZodString>;
                role: import("zod").ZodOptional<import("zod").ZodEnum<{
                    owner: "owner";
                    team_lead: "team_lead";
                    chatter: "chatter";
                    agent: "agent";
                    contractor: "contractor";
                    service: "service";
                    content_manager: "content_manager";
                }>>;
                state: import("zod").ZodOptional<import("zod").ZodEnum<{
                    left: "left";
                    invited: "invited";
                    set_up: "set_up";
                    working: "working";
                }>>;
                leftOn: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                telegram: import("zod").ZodOptional<import("zod").ZodObject<{
                    userId: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodNumber>>;
                    handle: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                    reportTag: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                }, import("zod/v4/core").$strip>>;
                workingPageLabels: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                schedule: import("zod").ZodOptional<import("zod").ZodObject<{
                    pageLabel: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                    from: import("zod").ZodNullable<import("zod").ZodString>;
                    slot: import("zod").ZodNullable<import("zod").ZodObject<{
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>>;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
                rights: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodEnum<{
                    customs_lead: "customs_lead";
                    records_customs: "records_customs";
                    submits_shift: "submits_shift";
                    sees_own_pay: "sees_own_pay";
                }>>>;
                onboarding: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                    step: import("zod").ZodString;
                    doneAt: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodISODateTime>>;
                    note: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                }, import("zod/v4/core").$strip>>>;
                note: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                logins: import("zod").ZodOptional<import("zod").ZodObject<{
                    add: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodNumber>>;
                    remove: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodNumber>>;
                }, import("zod/v4/core").$strip>>;
                agentKeys: import("zod").ZodOptional<import("zod").ZodObject<{
                    add: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodNumber>>;
                    remove: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodNumber>>;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
            reason: import("zod").ZodString;
            requestedBy: import("zod").ZodOptional<import("zod").ZodString>;
            sourceRef: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strip>, import("zod").ZodObject<{
            kind: import("zod").ZodLiteral<"create">;
            person: import("zod").ZodObject<{
                telegram: import("zod").ZodOptional<import("zod").ZodObject<{
                    userId: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodNumber>>;
                    handle: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                    reportTag: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                }, import("zod/v4/core").$strip>>;
                displayName: import("zod").ZodString;
                state: import("zod").ZodOptional<import("zod").ZodEnum<{
                    left: "left";
                    invited: "invited";
                    set_up: "set_up";
                    working: "working";
                }>>;
                note: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                kind: import("zod").ZodOptional<import("zod").ZodEnum<{
                    human: "human";
                    agent: "agent";
                    service: "service";
                }>>;
                code: import("zod").ZodString;
                onboarding: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                    step: import("zod").ZodString;
                    doneAt: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodISODateTime>>;
                    note: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                }, import("zod/v4/core").$strip>>>;
                role: import("zod").ZodEnum<{
                    owner: "owner";
                    team_lead: "team_lead";
                    chatter: "chatter";
                    agent: "agent";
                    contractor: "contractor";
                    service: "service";
                    content_manager: "content_manager";
                }>;
                leftOn: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                logins: import("zod").ZodOptional<import("zod").ZodObject<{
                    add: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodNumber>>;
                    remove: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodNumber>>;
                }, import("zod/v4/core").$strip>>;
                agentKeys: import("zod").ZodOptional<import("zod").ZodObject<{
                    add: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodNumber>>;
                    remove: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodNumber>>;
                }, import("zod/v4/core").$strip>>;
                schedule: import("zod").ZodOptional<import("zod").ZodObject<{
                    pageLabel: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                    from: import("zod").ZodNullable<import("zod").ZodString>;
                    slot: import("zod").ZodNullable<import("zod").ZodObject<{
                        start: import("zod").ZodString;
                        end: import("zod").ZodString;
                        weekdays: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodEnum<{
                            mon: "mon";
                            tue: "tue";
                            wed: "wed";
                            thu: "thu";
                            fri: "fri";
                            sat: "sat";
                            sun: "sun";
                        }>>>>;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
                rights: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodEnum<{
                    customs_lead: "customs_lead";
                    records_customs: "records_customs";
                    submits_shift: "submits_shift";
                    sees_own_pay: "sees_own_pay";
                }>>>;
                workingPageLabels: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
            }, import("zod/v4/core").$strip>;
            reason: import("zod").ZodString;
            requestedBy: import("zod").ZodOptional<import("zod").ZodString>;
            sourceRef: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strip>], "kind">;
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
            readonly 503: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                proposal: import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    reason: import("zod").ZodString;
                    state: import("zod").ZodEnum<{
                        rejected: "rejected";
                        withdrawn: "withdrawn";
                        open: "open";
                        accepted: "accepted";
                    }>;
                    createdAt: import("zod").ZodString;
                    kind: import("zod").ZodEnum<{
                        update: "update";
                        create: "create";
                    }>;
                    requestedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    decidedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    personCode: import("zod").ZodString;
                    change: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>;
                    sourceRef: import("zod").ZodNullable<import("zod").ZodString>;
                    decisionNote: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentPersonProposals: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "This key's proposals about people and what the owner decided (needs propose:people)";
        readonly querystring: import("zod").ZodObject<{
            since: import("zod").ZodOptional<import("zod").ZodISODateTime>;
        }, import("zod/v4/core").$strip>;
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
            readonly 503: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                proposals: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    reason: import("zod").ZodString;
                    state: import("zod").ZodEnum<{
                        rejected: "rejected";
                        withdrawn: "withdrawn";
                        open: "open";
                        accepted: "accepted";
                    }>;
                    createdAt: import("zod").ZodString;
                    kind: import("zod").ZodEnum<{
                        update: "update";
                        create: "create";
                    }>;
                    requestedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    decidedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    personCode: import("zod").ZodString;
                    change: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>;
                    sourceRef: import("zod").ZodNullable<import("zod").ZodString>;
                    decisionNote: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
};
