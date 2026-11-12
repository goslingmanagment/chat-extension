import { z } from "zod";
/**
 * The people registry (ecosystem plan 2026-11-12, package A), in shadow: one
 * record per person of the agency — a human and an agent are the same kind of
 * record, and so is the holder of service and test logins (kind `service`).
 * A login is not a person: one person holds any number of Hub logins
 * (the owner: a console login and a chatter login), an agent person holds agent keys,
 * and a model or a contractor holds none. The code is the one ledger and /OS
 * already use (the card's file name), a field of its own: nothing here ever
 * renames or changes a login (`users.username`) — scripts match chatters by it.
 *
 * Working pages are what a person works, in order (the first is the main
 * one): NOT access. Who may open a page stays the logins' page assignments.
 *
 * Pay terms are money: only the owner writes them, only the owner's session
 * reads them (`adminPerson`), and an agent key reads them only with
 * `read:pay_terms`. The team's list (`teamPeople`) has no field for them.
 *
 * An agent key never changes a person: it proposes (`agentPersonProposalCreate`,
 * needs `propose:people`) and the proposal waits for the owner, who accepts it
 * (the change goes through the same edit as the owner's own) or rejects it.
 */
/** human; agent (an agent key's holder); service — a server-side or test login with no person behind it, so that
 *  checks about people («a sign-in without a person», «a shift without a report») never raise anything on it. */
export declare const PERSON_KINDS: readonly ["human", "agent", "service"];
/** An agent's only role is `agent`, a service's only role is `service`, and only they have them. */
export declare const PERSON_ROLES: readonly ["owner", "team_lead", "chatter", "content_manager", "contractor", "agent", "service"];
/** invited → set_up (оформлен) → working → left. */
export declare const PERSON_STATES: readonly ["invited", "set_up", "working", "left"];
/** Narrow rights beside the role. customs_lead — «ведёт кастомы». */
export declare const PERSON_RIGHTS: readonly ["customs_lead"];
export declare const PERSON_WEEKDAYS: readonly ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
/** Where a record came from: the owner's screen, the one-off import, an agent's accepted proposal. */
export declare const PERSON_ORIGINS: readonly ["owner", "import", "proposal"];
export declare const PERSON_PROPOSAL_STATES: readonly ["open", "accepted", "rejected", "withdrawn"];
/** A person's code: lowercase latin letters, digits and dashes, as ledger and the /OS card file name. */
export declare const PERSON_CODE_PATTERN: RegExp;
/** A slot's edge by Moscow time: `HH:MM`; an end may be `24:00`. */
export declare const PERSON_SLOT_TIME_PATTERN: RegExp;
/** A shift lasts an hour to sixteen hours (as /OS scripts/people_roster.py reads it). */
export declare const PERSON_SLOT_MIN_MINUTES = 60;
export declare const PERSON_SLOT_MAX_MINUTES: number;
export declare const personKindEnum: z.ZodEnum<{
    human: "human";
    agent: "agent";
    service: "service";
}>;
export declare const personRoleEnum: z.ZodEnum<{
    owner: "owner";
    team_lead: "team_lead";
    chatter: "chatter";
    agent: "agent";
    contractor: "contractor";
    service: "service";
    content_manager: "content_manager";
}>;
export declare const personStateEnum: z.ZodEnum<{
    left: "left";
    invited: "invited";
    set_up: "set_up";
    working: "working";
}>;
export declare const personRightEnum: z.ZodEnum<{
    customs_lead: "customs_lead";
}>;
export declare const personWeekdayEnum: z.ZodEnum<{
    mon: "mon";
    tue: "tue";
    wed: "wed";
    thu: "thu";
    fri: "fri";
    sat: "sat";
    sun: "sun";
}>;
export declare const personOriginEnum: z.ZodEnum<{
    owner: "owner";
    import: "import";
    proposal: "proposal";
}>;
export declare const personProposalStateEnum: z.ZodEnum<{
    rejected: "rejected";
    withdrawn: "withdrawn";
    open: "open";
    accepted: "accepted";
}>;
export declare const personCodeSchema: z.ZodString;
export declare const personCodeParamsSchema: z.ZodObject<{
    code: z.ZodString;
}, z.core.$strip>;
/**
 * A schedule slot: person × page (null — every page of the person; a page's own line overrides it on that page)
 * × start and end minute of the Moscow day (end before start — the slot crosses midnight) × valid from / to.
 * One of the inputs of the «whose sale» rule at a shift junction (owner 2026-11-12): the shift whose slot runs.
 */
export declare const personScheduleSlotSchema: z.ZodObject<{
    id: z.ZodNumber;
    personId: z.ZodNumber;
    pageId: z.ZodNullable<z.ZodNumber>;
    pageLabel: z.ZodNullable<z.ZodString>;
    startMinute: z.ZodNumber;
    endMinute: z.ZodNumber;
    start: z.ZodString;
    end: z.ZodString;
    weekdays: z.ZodNullable<z.ZodArray<z.ZodEnum<{
        mon: "mon";
        tue: "tue";
        wed: "wed";
        thu: "thu";
        fri: "fri";
        sat: "sat";
        sun: "sun";
    }>>>;
    validFrom: z.ZodNullable<z.ZodString>;
    validTo: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const personLoginSchema: z.ZodObject<{
    userId: z.ZodNumber;
    username: z.ZodString;
    role: z.ZodEnum<{
        owner: "owner";
        team_lead: "team_lead";
        chatter: "chatter";
    }>;
    state: z.ZodEnum<{
        active: "active";
        deleted: "deleted";
        disabled: "disabled";
        invited: "invited";
    }>;
}, z.core.$strip>;
export declare const personAgentKeySchema: z.ZodObject<{
    agentKeyId: z.ZodNumber;
    name: z.ZodString;
    state: z.ZodEnum<{
        active: "active";
        expired: "expired";
        revoked: "revoked";
    }>;
}, z.core.$strip>;
export declare const personWorkingPageSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    platform: z.ZodEnum<{
        fansly: "fansly";
        onlyfans: "onlyfans";
        telegram: "telegram";
    }>;
    modelSlug: z.ZodString;
    modelName: z.ZodString;
}, z.core.$strip>;
export declare const personRightSchema: z.ZodObject<{
    right: z.ZodEnum<{
        customs_lead: "customs_lead";
    }>;
    grantedAt: z.ZodString;
}, z.core.$strip>;
export declare const personOnboardingStepSchema: z.ZodObject<{
    step: z.ZodString;
    doneAt: z.ZodNullable<z.ZodString>;
    note: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** One disagreement the import found between the sources about this person. */
export declare const personImportNoteSchema: z.ZodObject<{
    code: z.ZodString;
    text: z.ZodString;
}, z.core.$strip>;
export declare const personTelegramSchema: z.ZodObject<{
    userId: z.ZodNullable<z.ZodNumber>;
    handle: z.ZodNullable<z.ZodString>;
    reportTag: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const personSchema: z.ZodObject<{
    id: z.ZodNumber;
    code: z.ZodString;
    displayName: z.ZodString;
    kind: z.ZodEnum<{
        human: "human";
        agent: "agent";
        service: "service";
    }>;
    role: z.ZodEnum<{
        owner: "owner";
        team_lead: "team_lead";
        chatter: "chatter";
        agent: "agent";
        contractor: "contractor";
        service: "service";
        content_manager: "content_manager";
    }>;
    state: z.ZodEnum<{
        left: "left";
        invited: "invited";
        set_up: "set_up";
        working: "working";
    }>;
    leftOn: z.ZodNullable<z.ZodString>;
    telegram: z.ZodObject<{
        userId: z.ZodNullable<z.ZodNumber>;
        handle: z.ZodNullable<z.ZodString>;
        reportTag: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    logins: z.ZodArray<z.ZodObject<{
        userId: z.ZodNumber;
        username: z.ZodString;
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
        }>;
        state: z.ZodEnum<{
            active: "active";
            deleted: "deleted";
            disabled: "disabled";
            invited: "invited";
        }>;
    }, z.core.$strip>>;
    agentKeys: z.ZodArray<z.ZodObject<{
        agentKeyId: z.ZodNumber;
        name: z.ZodString;
        state: z.ZodEnum<{
            active: "active";
            expired: "expired";
            revoked: "revoked";
        }>;
    }, z.core.$strip>>;
    workingPages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        platform: z.ZodEnum<{
            fansly: "fansly";
            onlyfans: "onlyfans";
            telegram: "telegram";
        }>;
        modelSlug: z.ZodString;
        modelName: z.ZodString;
    }, z.core.$strip>>;
    schedule: z.ZodNullable<z.ZodObject<{
        id: z.ZodNumber;
        personId: z.ZodNumber;
        pageId: z.ZodNullable<z.ZodNumber>;
        pageLabel: z.ZodNullable<z.ZodString>;
        startMinute: z.ZodNumber;
        endMinute: z.ZodNumber;
        start: z.ZodString;
        end: z.ZodString;
        weekdays: z.ZodNullable<z.ZodArray<z.ZodEnum<{
            mon: "mon";
            tue: "tue";
            wed: "wed";
            thu: "thu";
            fri: "fri";
            sat: "sat";
            sun: "sun";
        }>>>;
        validFrom: z.ZodNullable<z.ZodString>;
        validTo: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    pageSchedules: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        personId: z.ZodNumber;
        pageId: z.ZodNullable<z.ZodNumber>;
        pageLabel: z.ZodNullable<z.ZodString>;
        startMinute: z.ZodNumber;
        endMinute: z.ZodNumber;
        start: z.ZodString;
        end: z.ZodString;
        weekdays: z.ZodNullable<z.ZodArray<z.ZodEnum<{
            mon: "mon";
            tue: "tue";
            wed: "wed";
            thu: "thu";
            fri: "fri";
            sat: "sat";
            sun: "sun";
        }>>>;
        validFrom: z.ZodNullable<z.ZodString>;
        validTo: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    rights: z.ZodArray<z.ZodObject<{
        right: z.ZodEnum<{
            customs_lead: "customs_lead";
        }>;
        grantedAt: z.ZodString;
    }, z.core.$strip>>;
    onboarding: z.ZodArray<z.ZodObject<{
        step: z.ZodString;
        doneAt: z.ZodNullable<z.ZodString>;
        note: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    note: z.ZodNullable<z.ZodString>;
    importNotes: z.ZodArray<z.ZodObject<{
        code: z.ZodString;
        text: z.ZodString;
    }, z.core.$strip>>;
    origin: z.ZodEnum<{
        owner: "owner";
        import: "import";
        proposal: "proposal";
    }>;
    openProposals: z.ZodNumber;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export declare const personPayTermSchema: z.ZodObject<{
    id: z.ZodNumber;
    modelSlug: z.ZodString;
    modelName: z.ZodString;
    validFrom: z.ZodString;
    validTo: z.ZodNullable<z.ZodString>;
    shareBasisPoints: z.ZodNumber;
    fixPerShiftMills: z.ZodNumber;
    note: z.ZodNullable<z.ZodString>;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export declare const personScheduleInputSchema: z.ZodObject<{
    pageLabel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    from: z.ZodNullable<z.ZodString>;
    slot: z.ZodNullable<z.ZodObject<{
        start: z.ZodString;
        end: z.ZodString;
        weekdays: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
            mon: "mon";
            tue: "tue";
            wed: "wed";
            thu: "thu";
            fri: "fri";
            sat: "sat";
            sun: "sun";
        }>>>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const personTelegramInputSchema: z.ZodObject<{
    userId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    handle: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    reportTag: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
/** An invitation made with the person in the same call: the login (no password yet), its pages, the link. */
export declare const personInviteInputSchema: z.ZodObject<{
    username: z.ZodString;
    role: z.ZodOptional<z.ZodEnum<{
        team_lead: "team_lead";
        chatter: "chatter";
    }>>;
    pageLabels: z.ZodArray<z.ZodString>;
    expiresInHours: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const adminPersonCreateBodySchema: z.ZodObject<{
    state: z.ZodOptional<z.ZodEnum<{
        left: "left";
        invited: "invited";
        set_up: "set_up";
        working: "working";
    }>>;
    leftOn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    telegram: z.ZodOptional<z.ZodObject<{
        userId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        handle: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        reportTag: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    workingPageLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
    schedule: z.ZodOptional<z.ZodObject<{
        pageLabel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        from: z.ZodNullable<z.ZodString>;
        slot: z.ZodNullable<z.ZodObject<{
            start: z.ZodString;
            end: z.ZodString;
            weekdays: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                mon: "mon";
                tue: "tue";
                wed: "wed";
                thu: "thu";
                fri: "fri";
                sat: "sat";
                sun: "sun";
            }>>>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    rights: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        customs_lead: "customs_lead";
    }>>>;
    onboarding: z.ZodOptional<z.ZodArray<z.ZodObject<{
        step: z.ZodString;
        doneAt: z.ZodOptional<z.ZodNullable<z.ZodISODateTime>>;
        note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>>;
    note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    logins: z.ZodOptional<z.ZodObject<{
        add: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        remove: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
    }, z.core.$strip>>;
    agentKeys: z.ZodOptional<z.ZodObject<{
        add: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        remove: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
    }, z.core.$strip>>;
    invite: z.ZodOptional<z.ZodObject<{
        username: z.ZodString;
        role: z.ZodOptional<z.ZodEnum<{
            team_lead: "team_lead";
            chatter: "chatter";
        }>>;
        pageLabels: z.ZodArray<z.ZodString>;
        expiresInHours: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    displayName: z.ZodString;
    role: z.ZodEnum<{
        owner: "owner";
        team_lead: "team_lead";
        chatter: "chatter";
        agent: "agent";
        contractor: "contractor";
        service: "service";
        content_manager: "content_manager";
    }>;
    code: z.ZodString;
    kind: z.ZodOptional<z.ZodEnum<{
        human: "human";
        agent: "agent";
        service: "service";
    }>>;
}, z.core.$strip>;
export declare const adminPersonUpdateBodySchema: z.ZodObject<{
    displayName: z.ZodOptional<z.ZodString>;
    role: z.ZodOptional<z.ZodEnum<{
        owner: "owner";
        team_lead: "team_lead";
        chatter: "chatter";
        agent: "agent";
        contractor: "contractor";
        service: "service";
        content_manager: "content_manager";
    }>>;
    state: z.ZodOptional<z.ZodEnum<{
        left: "left";
        invited: "invited";
        set_up: "set_up";
        working: "working";
    }>>;
    leftOn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    telegram: z.ZodOptional<z.ZodObject<{
        userId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        handle: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        reportTag: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    workingPageLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
    schedule: z.ZodOptional<z.ZodObject<{
        pageLabel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        from: z.ZodNullable<z.ZodString>;
        slot: z.ZodNullable<z.ZodObject<{
            start: z.ZodString;
            end: z.ZodString;
            weekdays: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                mon: "mon";
                tue: "tue";
                wed: "wed";
                thu: "thu";
                fri: "fri";
                sat: "sat";
                sun: "sun";
            }>>>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    rights: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        customs_lead: "customs_lead";
    }>>>;
    onboarding: z.ZodOptional<z.ZodArray<z.ZodObject<{
        step: z.ZodString;
        doneAt: z.ZodOptional<z.ZodNullable<z.ZodISODateTime>>;
        note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>>;
    note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    logins: z.ZodOptional<z.ZodObject<{
        add: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        remove: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
    }, z.core.$strip>>;
    agentKeys: z.ZodOptional<z.ZodObject<{
        add: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        remove: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const adminPersonPayTermBodySchema: z.ZodObject<{
    modelSlug: z.ZodString;
    validFrom: z.ZodString;
    shareBasisPoints: z.ZodNumber;
    fixPerShiftMills: z.ZodNumber;
    note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
/** What a proposal changes: the owner's edit of an existing person, or a new person (never an invitation). */
export declare const personProposalChangeSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"update">;
    personCode: z.ZodString;
    change: z.ZodObject<{
        displayName: z.ZodOptional<z.ZodString>;
        role: z.ZodOptional<z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
            agent: "agent";
            contractor: "contractor";
            service: "service";
            content_manager: "content_manager";
        }>>;
        state: z.ZodOptional<z.ZodEnum<{
            left: "left";
            invited: "invited";
            set_up: "set_up";
            working: "working";
        }>>;
        leftOn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        telegram: z.ZodOptional<z.ZodObject<{
            userId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            handle: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            reportTag: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>;
        workingPageLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        schedule: z.ZodOptional<z.ZodObject<{
            pageLabel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            from: z.ZodNullable<z.ZodString>;
            slot: z.ZodNullable<z.ZodObject<{
                start: z.ZodString;
                end: z.ZodString;
                weekdays: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                    mon: "mon";
                    tue: "tue";
                    wed: "wed";
                    thu: "thu";
                    fri: "fri";
                    sat: "sat";
                    sun: "sun";
                }>>>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        rights: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            customs_lead: "customs_lead";
        }>>>;
        onboarding: z.ZodOptional<z.ZodArray<z.ZodObject<{
            step: z.ZodString;
            doneAt: z.ZodOptional<z.ZodNullable<z.ZodISODateTime>>;
            note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>>;
        note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logins: z.ZodOptional<z.ZodObject<{
            add: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
            remove: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        }, z.core.$strip>>;
        agentKeys: z.ZodOptional<z.ZodObject<{
            add: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
            remove: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"create">;
    person: z.ZodObject<{
        telegram: z.ZodOptional<z.ZodObject<{
            userId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            handle: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            reportTag: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>;
        displayName: z.ZodString;
        state: z.ZodOptional<z.ZodEnum<{
            left: "left";
            invited: "invited";
            set_up: "set_up";
            working: "working";
        }>>;
        note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        kind: z.ZodOptional<z.ZodEnum<{
            human: "human";
            agent: "agent";
            service: "service";
        }>>;
        code: z.ZodString;
        onboarding: z.ZodOptional<z.ZodArray<z.ZodObject<{
            step: z.ZodString;
            doneAt: z.ZodOptional<z.ZodNullable<z.ZodISODateTime>>;
            note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>>;
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
            agent: "agent";
            contractor: "contractor";
            service: "service";
            content_manager: "content_manager";
        }>;
        schedule: z.ZodOptional<z.ZodObject<{
            pageLabel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            from: z.ZodNullable<z.ZodString>;
            slot: z.ZodNullable<z.ZodObject<{
                start: z.ZodString;
                end: z.ZodString;
                weekdays: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                    mon: "mon";
                    tue: "tue";
                    wed: "wed";
                    thu: "thu";
                    fri: "fri";
                    sat: "sat";
                    sun: "sun";
                }>>>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        leftOn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logins: z.ZodOptional<z.ZodObject<{
            add: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
            remove: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        }, z.core.$strip>>;
        agentKeys: z.ZodOptional<z.ZodObject<{
            add: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
            remove: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        }, z.core.$strip>>;
        rights: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            customs_lead: "customs_lead";
        }>>>;
        workingPageLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
}, z.core.$strip>], "kind">;
export declare const agentPersonProposalBodySchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"update">;
    personCode: z.ZodString;
    change: z.ZodObject<{
        displayName: z.ZodOptional<z.ZodString>;
        role: z.ZodOptional<z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
            agent: "agent";
            contractor: "contractor";
            service: "service";
            content_manager: "content_manager";
        }>>;
        state: z.ZodOptional<z.ZodEnum<{
            left: "left";
            invited: "invited";
            set_up: "set_up";
            working: "working";
        }>>;
        leftOn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        telegram: z.ZodOptional<z.ZodObject<{
            userId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            handle: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            reportTag: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>;
        workingPageLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        schedule: z.ZodOptional<z.ZodObject<{
            pageLabel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            from: z.ZodNullable<z.ZodString>;
            slot: z.ZodNullable<z.ZodObject<{
                start: z.ZodString;
                end: z.ZodString;
                weekdays: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                    mon: "mon";
                    tue: "tue";
                    wed: "wed";
                    thu: "thu";
                    fri: "fri";
                    sat: "sat";
                    sun: "sun";
                }>>>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        rights: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            customs_lead: "customs_lead";
        }>>>;
        onboarding: z.ZodOptional<z.ZodArray<z.ZodObject<{
            step: z.ZodString;
            doneAt: z.ZodOptional<z.ZodNullable<z.ZodISODateTime>>;
            note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>>;
        note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logins: z.ZodOptional<z.ZodObject<{
            add: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
            remove: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        }, z.core.$strip>>;
        agentKeys: z.ZodOptional<z.ZodObject<{
            add: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
            remove: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    reason: z.ZodString;
    requestedBy: z.ZodOptional<z.ZodString>;
    sourceRef: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"create">;
    person: z.ZodObject<{
        telegram: z.ZodOptional<z.ZodObject<{
            userId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            handle: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            reportTag: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>;
        displayName: z.ZodString;
        state: z.ZodOptional<z.ZodEnum<{
            left: "left";
            invited: "invited";
            set_up: "set_up";
            working: "working";
        }>>;
        note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        kind: z.ZodOptional<z.ZodEnum<{
            human: "human";
            agent: "agent";
            service: "service";
        }>>;
        code: z.ZodString;
        onboarding: z.ZodOptional<z.ZodArray<z.ZodObject<{
            step: z.ZodString;
            doneAt: z.ZodOptional<z.ZodNullable<z.ZodISODateTime>>;
            note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>>;
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
            agent: "agent";
            contractor: "contractor";
            service: "service";
            content_manager: "content_manager";
        }>;
        schedule: z.ZodOptional<z.ZodObject<{
            pageLabel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            from: z.ZodNullable<z.ZodString>;
            slot: z.ZodNullable<z.ZodObject<{
                start: z.ZodString;
                end: z.ZodString;
                weekdays: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
                    mon: "mon";
                    tue: "tue";
                    wed: "wed";
                    thu: "thu";
                    fri: "fri";
                    sat: "sat";
                    sun: "sun";
                }>>>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        leftOn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logins: z.ZodOptional<z.ZodObject<{
            add: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
            remove: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        }, z.core.$strip>>;
        agentKeys: z.ZodOptional<z.ZodObject<{
            add: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
            remove: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        }, z.core.$strip>>;
        rights: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            customs_lead: "customs_lead";
        }>>>;
        workingPageLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
    reason: z.ZodString;
    requestedBy: z.ZodOptional<z.ZodString>;
    sourceRef: z.ZodOptional<z.ZodString>;
}, z.core.$strip>], "kind">;
export declare const personProposalSchema: z.ZodObject<{
    id: z.ZodNumber;
    kind: z.ZodEnum<{
        update: "update";
        create: "create";
    }>;
    personCode: z.ZodString;
    change: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    reason: z.ZodString;
    requestedBy: z.ZodNullable<z.ZodString>;
    sourceRef: z.ZodNullable<z.ZodString>;
    agentKeyName: z.ZodString;
    state: z.ZodEnum<{
        rejected: "rejected";
        withdrawn: "withdrawn";
        open: "open";
        accepted: "accepted";
    }>;
    createdAt: z.ZodString;
    decidedAt: z.ZodNullable<z.ZodString>;
    decisionNote: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const adminPeopleProposalsQuerySchema: z.ZodObject<{
    state: z.ZodOptional<z.ZodEnum<{
        rejected: "rejected";
        withdrawn: "withdrawn";
        open: "open";
        accepted: "accepted";
    }>>;
}, z.core.$strip>;
export declare const adminPersonProposalParamsSchema: z.ZodObject<{
    proposalId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const adminPersonProposalDecideBodySchema: z.ZodObject<{
    decision: z.ZodEnum<{
        reject: "reject";
        accept: "accept";
    }>;
    note: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const teamPeopleResponseSchema: z.ZodObject<{
    people: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        code: z.ZodString;
        displayName: z.ZodString;
        kind: z.ZodEnum<{
            human: "human";
            agent: "agent";
            service: "service";
        }>;
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
            agent: "agent";
            contractor: "contractor";
            service: "service";
            content_manager: "content_manager";
        }>;
        state: z.ZodEnum<{
            left: "left";
            invited: "invited";
            set_up: "set_up";
            working: "working";
        }>;
        leftOn: z.ZodNullable<z.ZodString>;
        telegram: z.ZodObject<{
            userId: z.ZodNullable<z.ZodNumber>;
            handle: z.ZodNullable<z.ZodString>;
            reportTag: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        logins: z.ZodArray<z.ZodObject<{
            userId: z.ZodNumber;
            username: z.ZodString;
            role: z.ZodEnum<{
                owner: "owner";
                team_lead: "team_lead";
                chatter: "chatter";
            }>;
            state: z.ZodEnum<{
                active: "active";
                deleted: "deleted";
                disabled: "disabled";
                invited: "invited";
            }>;
        }, z.core.$strip>>;
        agentKeys: z.ZodArray<z.ZodObject<{
            agentKeyId: z.ZodNumber;
            name: z.ZodString;
            state: z.ZodEnum<{
                active: "active";
                expired: "expired";
                revoked: "revoked";
            }>;
        }, z.core.$strip>>;
        workingPages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            platform: z.ZodEnum<{
                fansly: "fansly";
                onlyfans: "onlyfans";
                telegram: "telegram";
            }>;
            modelSlug: z.ZodString;
            modelName: z.ZodString;
        }, z.core.$strip>>;
        schedule: z.ZodNullable<z.ZodObject<{
            id: z.ZodNumber;
            personId: z.ZodNumber;
            pageId: z.ZodNullable<z.ZodNumber>;
            pageLabel: z.ZodNullable<z.ZodString>;
            startMinute: z.ZodNumber;
            endMinute: z.ZodNumber;
            start: z.ZodString;
            end: z.ZodString;
            weekdays: z.ZodNullable<z.ZodArray<z.ZodEnum<{
                mon: "mon";
                tue: "tue";
                wed: "wed";
                thu: "thu";
                fri: "fri";
                sat: "sat";
                sun: "sun";
            }>>>;
            validFrom: z.ZodNullable<z.ZodString>;
            validTo: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        pageSchedules: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            personId: z.ZodNumber;
            pageId: z.ZodNullable<z.ZodNumber>;
            pageLabel: z.ZodNullable<z.ZodString>;
            startMinute: z.ZodNumber;
            endMinute: z.ZodNumber;
            start: z.ZodString;
            end: z.ZodString;
            weekdays: z.ZodNullable<z.ZodArray<z.ZodEnum<{
                mon: "mon";
                tue: "tue";
                wed: "wed";
                thu: "thu";
                fri: "fri";
                sat: "sat";
                sun: "sun";
            }>>>;
            validFrom: z.ZodNullable<z.ZodString>;
            validTo: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        rights: z.ZodArray<z.ZodObject<{
            right: z.ZodEnum<{
                customs_lead: "customs_lead";
            }>;
            grantedAt: z.ZodString;
        }, z.core.$strip>>;
        onboarding: z.ZodArray<z.ZodObject<{
            step: z.ZodString;
            doneAt: z.ZodNullable<z.ZodString>;
            note: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        note: z.ZodNullable<z.ZodString>;
        importNotes: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            text: z.ZodString;
        }, z.core.$strip>>;
        origin: z.ZodEnum<{
            owner: "owner";
            import: "import";
            proposal: "proposal";
        }>;
        openProposals: z.ZodNumber;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>>;
    unlinkedLogins: z.ZodArray<z.ZodObject<{
        userId: z.ZodNumber;
        username: z.ZodString;
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
        }>;
        state: z.ZodEnum<{
            active: "active";
            deleted: "deleted";
            disabled: "disabled";
            invited: "invited";
        }>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const adminPersonResponseSchema: z.ZodObject<{
    person: z.ZodObject<{
        id: z.ZodNumber;
        code: z.ZodString;
        displayName: z.ZodString;
        kind: z.ZodEnum<{
            human: "human";
            agent: "agent";
            service: "service";
        }>;
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
            agent: "agent";
            contractor: "contractor";
            service: "service";
            content_manager: "content_manager";
        }>;
        state: z.ZodEnum<{
            left: "left";
            invited: "invited";
            set_up: "set_up";
            working: "working";
        }>;
        leftOn: z.ZodNullable<z.ZodString>;
        telegram: z.ZodObject<{
            userId: z.ZodNullable<z.ZodNumber>;
            handle: z.ZodNullable<z.ZodString>;
            reportTag: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        logins: z.ZodArray<z.ZodObject<{
            userId: z.ZodNumber;
            username: z.ZodString;
            role: z.ZodEnum<{
                owner: "owner";
                team_lead: "team_lead";
                chatter: "chatter";
            }>;
            state: z.ZodEnum<{
                active: "active";
                deleted: "deleted";
                disabled: "disabled";
                invited: "invited";
            }>;
        }, z.core.$strip>>;
        agentKeys: z.ZodArray<z.ZodObject<{
            agentKeyId: z.ZodNumber;
            name: z.ZodString;
            state: z.ZodEnum<{
                active: "active";
                expired: "expired";
                revoked: "revoked";
            }>;
        }, z.core.$strip>>;
        workingPages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            platform: z.ZodEnum<{
                fansly: "fansly";
                onlyfans: "onlyfans";
                telegram: "telegram";
            }>;
            modelSlug: z.ZodString;
            modelName: z.ZodString;
        }, z.core.$strip>>;
        schedule: z.ZodNullable<z.ZodObject<{
            id: z.ZodNumber;
            personId: z.ZodNumber;
            pageId: z.ZodNullable<z.ZodNumber>;
            pageLabel: z.ZodNullable<z.ZodString>;
            startMinute: z.ZodNumber;
            endMinute: z.ZodNumber;
            start: z.ZodString;
            end: z.ZodString;
            weekdays: z.ZodNullable<z.ZodArray<z.ZodEnum<{
                mon: "mon";
                tue: "tue";
                wed: "wed";
                thu: "thu";
                fri: "fri";
                sat: "sat";
                sun: "sun";
            }>>>;
            validFrom: z.ZodNullable<z.ZodString>;
            validTo: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        pageSchedules: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            personId: z.ZodNumber;
            pageId: z.ZodNullable<z.ZodNumber>;
            pageLabel: z.ZodNullable<z.ZodString>;
            startMinute: z.ZodNumber;
            endMinute: z.ZodNumber;
            start: z.ZodString;
            end: z.ZodString;
            weekdays: z.ZodNullable<z.ZodArray<z.ZodEnum<{
                mon: "mon";
                tue: "tue";
                wed: "wed";
                thu: "thu";
                fri: "fri";
                sat: "sat";
                sun: "sun";
            }>>>;
            validFrom: z.ZodNullable<z.ZodString>;
            validTo: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        rights: z.ZodArray<z.ZodObject<{
            right: z.ZodEnum<{
                customs_lead: "customs_lead";
            }>;
            grantedAt: z.ZodString;
        }, z.core.$strip>>;
        onboarding: z.ZodArray<z.ZodObject<{
            step: z.ZodString;
            doneAt: z.ZodNullable<z.ZodString>;
            note: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        note: z.ZodNullable<z.ZodString>;
        importNotes: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            text: z.ZodString;
        }, z.core.$strip>>;
        origin: z.ZodEnum<{
            owner: "owner";
            import: "import";
            proposal: "proposal";
        }>;
        openProposals: z.ZodNumber;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>;
    scheduleSlots: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        personId: z.ZodNumber;
        pageId: z.ZodNullable<z.ZodNumber>;
        pageLabel: z.ZodNullable<z.ZodString>;
        startMinute: z.ZodNumber;
        endMinute: z.ZodNumber;
        start: z.ZodString;
        end: z.ZodString;
        weekdays: z.ZodNullable<z.ZodArray<z.ZodEnum<{
            mon: "mon";
            tue: "tue";
            wed: "wed";
            thu: "thu";
            fri: "fri";
            sat: "sat";
            sun: "sun";
        }>>>;
        validFrom: z.ZodNullable<z.ZodString>;
        validTo: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    payTerms: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        modelSlug: z.ZodString;
        modelName: z.ZodString;
        validFrom: z.ZodString;
        validTo: z.ZodNullable<z.ZodString>;
        shareBasisPoints: z.ZodNumber;
        fixPerShiftMills: z.ZodNumber;
        note: z.ZodNullable<z.ZodString>;
        updatedAt: z.ZodString;
    }, z.core.$strip>>;
    proposals: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        kind: z.ZodEnum<{
            update: "update";
            create: "create";
        }>;
        personCode: z.ZodString;
        change: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        reason: z.ZodString;
        requestedBy: z.ZodNullable<z.ZodString>;
        sourceRef: z.ZodNullable<z.ZodString>;
        agentKeyName: z.ZodString;
        state: z.ZodEnum<{
            rejected: "rejected";
            withdrawn: "withdrawn";
            open: "open";
            accepted: "accepted";
        }>;
        createdAt: z.ZodString;
        decidedAt: z.ZodNullable<z.ZodString>;
        decisionNote: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const adminPersonCreateResponseSchema: z.ZodObject<{
    person: z.ZodObject<{
        id: z.ZodNumber;
        code: z.ZodString;
        displayName: z.ZodString;
        kind: z.ZodEnum<{
            human: "human";
            agent: "agent";
            service: "service";
        }>;
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
            agent: "agent";
            contractor: "contractor";
            service: "service";
            content_manager: "content_manager";
        }>;
        state: z.ZodEnum<{
            left: "left";
            invited: "invited";
            set_up: "set_up";
            working: "working";
        }>;
        leftOn: z.ZodNullable<z.ZodString>;
        telegram: z.ZodObject<{
            userId: z.ZodNullable<z.ZodNumber>;
            handle: z.ZodNullable<z.ZodString>;
            reportTag: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        logins: z.ZodArray<z.ZodObject<{
            userId: z.ZodNumber;
            username: z.ZodString;
            role: z.ZodEnum<{
                owner: "owner";
                team_lead: "team_lead";
                chatter: "chatter";
            }>;
            state: z.ZodEnum<{
                active: "active";
                deleted: "deleted";
                disabled: "disabled";
                invited: "invited";
            }>;
        }, z.core.$strip>>;
        agentKeys: z.ZodArray<z.ZodObject<{
            agentKeyId: z.ZodNumber;
            name: z.ZodString;
            state: z.ZodEnum<{
                active: "active";
                expired: "expired";
                revoked: "revoked";
            }>;
        }, z.core.$strip>>;
        workingPages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            platform: z.ZodEnum<{
                fansly: "fansly";
                onlyfans: "onlyfans";
                telegram: "telegram";
            }>;
            modelSlug: z.ZodString;
            modelName: z.ZodString;
        }, z.core.$strip>>;
        schedule: z.ZodNullable<z.ZodObject<{
            id: z.ZodNumber;
            personId: z.ZodNumber;
            pageId: z.ZodNullable<z.ZodNumber>;
            pageLabel: z.ZodNullable<z.ZodString>;
            startMinute: z.ZodNumber;
            endMinute: z.ZodNumber;
            start: z.ZodString;
            end: z.ZodString;
            weekdays: z.ZodNullable<z.ZodArray<z.ZodEnum<{
                mon: "mon";
                tue: "tue";
                wed: "wed";
                thu: "thu";
                fri: "fri";
                sat: "sat";
                sun: "sun";
            }>>>;
            validFrom: z.ZodNullable<z.ZodString>;
            validTo: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        pageSchedules: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            personId: z.ZodNumber;
            pageId: z.ZodNullable<z.ZodNumber>;
            pageLabel: z.ZodNullable<z.ZodString>;
            startMinute: z.ZodNumber;
            endMinute: z.ZodNumber;
            start: z.ZodString;
            end: z.ZodString;
            weekdays: z.ZodNullable<z.ZodArray<z.ZodEnum<{
                mon: "mon";
                tue: "tue";
                wed: "wed";
                thu: "thu";
                fri: "fri";
                sat: "sat";
                sun: "sun";
            }>>>;
            validFrom: z.ZodNullable<z.ZodString>;
            validTo: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        rights: z.ZodArray<z.ZodObject<{
            right: z.ZodEnum<{
                customs_lead: "customs_lead";
            }>;
            grantedAt: z.ZodString;
        }, z.core.$strip>>;
        onboarding: z.ZodArray<z.ZodObject<{
            step: z.ZodString;
            doneAt: z.ZodNullable<z.ZodString>;
            note: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        note: z.ZodNullable<z.ZodString>;
        importNotes: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            text: z.ZodString;
        }, z.core.$strip>>;
        origin: z.ZodEnum<{
            owner: "owner";
            import: "import";
            proposal: "proposal";
        }>;
        openProposals: z.ZodNumber;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>;
    scheduleSlots: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        personId: z.ZodNumber;
        pageId: z.ZodNullable<z.ZodNumber>;
        pageLabel: z.ZodNullable<z.ZodString>;
        startMinute: z.ZodNumber;
        endMinute: z.ZodNumber;
        start: z.ZodString;
        end: z.ZodString;
        weekdays: z.ZodNullable<z.ZodArray<z.ZodEnum<{
            mon: "mon";
            tue: "tue";
            wed: "wed";
            thu: "thu";
            fri: "fri";
            sat: "sat";
            sun: "sun";
        }>>>;
        validFrom: z.ZodNullable<z.ZodString>;
        validTo: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    payTerms: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        modelSlug: z.ZodString;
        modelName: z.ZodString;
        validFrom: z.ZodString;
        validTo: z.ZodNullable<z.ZodString>;
        shareBasisPoints: z.ZodNumber;
        fixPerShiftMills: z.ZodNumber;
        note: z.ZodNullable<z.ZodString>;
        updatedAt: z.ZodString;
    }, z.core.$strip>>;
    proposals: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        kind: z.ZodEnum<{
            update: "update";
            create: "create";
        }>;
        personCode: z.ZodString;
        change: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        reason: z.ZodString;
        requestedBy: z.ZodNullable<z.ZodString>;
        sourceRef: z.ZodNullable<z.ZodString>;
        agentKeyName: z.ZodString;
        state: z.ZodEnum<{
            rejected: "rejected";
            withdrawn: "withdrawn";
            open: "open";
            accepted: "accepted";
        }>;
        createdAt: z.ZodString;
        decidedAt: z.ZodNullable<z.ZodString>;
        decisionNote: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
    invite: z.ZodNullable<z.ZodObject<{
        userId: z.ZodNumber;
        username: z.ZodString;
        link: z.ZodObject<{
            id: z.ZodNumber;
            keyPrefix: z.ZodString;
            token: z.ZodString;
            expiresAt: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const adminPeopleProposalsResponseSchema: z.ZodObject<{
    proposals: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        kind: z.ZodEnum<{
            update: "update";
            create: "create";
        }>;
        personCode: z.ZodString;
        change: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        reason: z.ZodString;
        requestedBy: z.ZodNullable<z.ZodString>;
        sourceRef: z.ZodNullable<z.ZodString>;
        agentKeyName: z.ZodString;
        state: z.ZodEnum<{
            rejected: "rejected";
            withdrawn: "withdrawn";
            open: "open";
            accepted: "accepted";
        }>;
        createdAt: z.ZodString;
        decidedAt: z.ZodNullable<z.ZodString>;
        decisionNote: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const adminPersonProposalDecideResponseSchema: z.ZodObject<{
    proposal: z.ZodObject<{
        id: z.ZodNumber;
        kind: z.ZodEnum<{
            update: "update";
            create: "create";
        }>;
        personCode: z.ZodString;
        change: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        reason: z.ZodString;
        requestedBy: z.ZodNullable<z.ZodString>;
        sourceRef: z.ZodNullable<z.ZodString>;
        agentKeyName: z.ZodString;
        state: z.ZodEnum<{
            rejected: "rejected";
            withdrawn: "withdrawn";
            open: "open";
            accepted: "accepted";
        }>;
        createdAt: z.ZodString;
        decidedAt: z.ZodNullable<z.ZodString>;
        decisionNote: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    person: z.ZodNullable<z.ZodObject<{
        id: z.ZodNumber;
        code: z.ZodString;
        displayName: z.ZodString;
        kind: z.ZodEnum<{
            human: "human";
            agent: "agent";
            service: "service";
        }>;
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
            agent: "agent";
            contractor: "contractor";
            service: "service";
            content_manager: "content_manager";
        }>;
        state: z.ZodEnum<{
            left: "left";
            invited: "invited";
            set_up: "set_up";
            working: "working";
        }>;
        leftOn: z.ZodNullable<z.ZodString>;
        telegram: z.ZodObject<{
            userId: z.ZodNullable<z.ZodNumber>;
            handle: z.ZodNullable<z.ZodString>;
            reportTag: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        logins: z.ZodArray<z.ZodObject<{
            userId: z.ZodNumber;
            username: z.ZodString;
            role: z.ZodEnum<{
                owner: "owner";
                team_lead: "team_lead";
                chatter: "chatter";
            }>;
            state: z.ZodEnum<{
                active: "active";
                deleted: "deleted";
                disabled: "disabled";
                invited: "invited";
            }>;
        }, z.core.$strip>>;
        agentKeys: z.ZodArray<z.ZodObject<{
            agentKeyId: z.ZodNumber;
            name: z.ZodString;
            state: z.ZodEnum<{
                active: "active";
                expired: "expired";
                revoked: "revoked";
            }>;
        }, z.core.$strip>>;
        workingPages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            platform: z.ZodEnum<{
                fansly: "fansly";
                onlyfans: "onlyfans";
                telegram: "telegram";
            }>;
            modelSlug: z.ZodString;
            modelName: z.ZodString;
        }, z.core.$strip>>;
        schedule: z.ZodNullable<z.ZodObject<{
            id: z.ZodNumber;
            personId: z.ZodNumber;
            pageId: z.ZodNullable<z.ZodNumber>;
            pageLabel: z.ZodNullable<z.ZodString>;
            startMinute: z.ZodNumber;
            endMinute: z.ZodNumber;
            start: z.ZodString;
            end: z.ZodString;
            weekdays: z.ZodNullable<z.ZodArray<z.ZodEnum<{
                mon: "mon";
                tue: "tue";
                wed: "wed";
                thu: "thu";
                fri: "fri";
                sat: "sat";
                sun: "sun";
            }>>>;
            validFrom: z.ZodNullable<z.ZodString>;
            validTo: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        pageSchedules: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            personId: z.ZodNumber;
            pageId: z.ZodNullable<z.ZodNumber>;
            pageLabel: z.ZodNullable<z.ZodString>;
            startMinute: z.ZodNumber;
            endMinute: z.ZodNumber;
            start: z.ZodString;
            end: z.ZodString;
            weekdays: z.ZodNullable<z.ZodArray<z.ZodEnum<{
                mon: "mon";
                tue: "tue";
                wed: "wed";
                thu: "thu";
                fri: "fri";
                sat: "sat";
                sun: "sun";
            }>>>;
            validFrom: z.ZodNullable<z.ZodString>;
            validTo: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        rights: z.ZodArray<z.ZodObject<{
            right: z.ZodEnum<{
                customs_lead: "customs_lead";
            }>;
            grantedAt: z.ZodString;
        }, z.core.$strip>>;
        onboarding: z.ZodArray<z.ZodObject<{
            step: z.ZodString;
            doneAt: z.ZodNullable<z.ZodString>;
            note: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        note: z.ZodNullable<z.ZodString>;
        importNotes: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            text: z.ZodString;
        }, z.core.$strip>>;
        origin: z.ZodEnum<{
            owner: "owner";
            import: "import";
            proposal: "proposal";
        }>;
        openProposals: z.ZodNumber;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const agentPeopleQuerySchema: z.ZodObject<{
    since: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$strip>;
export declare const agentPersonSchema: z.ZodObject<{
    id: z.ZodNumber;
    code: z.ZodString;
    displayName: z.ZodString;
    kind: z.ZodEnum<{
        human: "human";
        agent: "agent";
        service: "service";
    }>;
    role: z.ZodEnum<{
        owner: "owner";
        team_lead: "team_lead";
        chatter: "chatter";
        agent: "agent";
        contractor: "contractor";
        service: "service";
        content_manager: "content_manager";
    }>;
    state: z.ZodEnum<{
        left: "left";
        invited: "invited";
        set_up: "set_up";
        working: "working";
    }>;
    leftOn: z.ZodNullable<z.ZodString>;
    telegram: z.ZodObject<{
        userId: z.ZodNullable<z.ZodNumber>;
        handle: z.ZodNullable<z.ZodString>;
        reportTag: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    logins: z.ZodArray<z.ZodObject<{
        userId: z.ZodNumber;
        username: z.ZodString;
        active: z.ZodBoolean;
    }, z.core.$strip>>;
    agentKeys: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        active: z.ZodBoolean;
    }, z.core.$strip>>;
    workingPages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        modelSlug: z.ZodString;
    }, z.core.$strip>>;
    schedule: z.ZodNullable<z.ZodObject<{
        id: z.ZodNumber;
        personId: z.ZodNumber;
        pageId: z.ZodNullable<z.ZodNumber>;
        pageLabel: z.ZodNullable<z.ZodString>;
        startMinute: z.ZodNumber;
        endMinute: z.ZodNumber;
        start: z.ZodString;
        end: z.ZodString;
        weekdays: z.ZodNullable<z.ZodArray<z.ZodEnum<{
            mon: "mon";
            tue: "tue";
            wed: "wed";
            thu: "thu";
            fri: "fri";
            sat: "sat";
            sun: "sun";
        }>>>;
        validFrom: z.ZodNullable<z.ZodString>;
        validTo: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    scheduleSlots: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        personId: z.ZodNumber;
        pageId: z.ZodNullable<z.ZodNumber>;
        pageLabel: z.ZodNullable<z.ZodString>;
        startMinute: z.ZodNumber;
        endMinute: z.ZodNumber;
        start: z.ZodString;
        end: z.ZodString;
        weekdays: z.ZodNullable<z.ZodArray<z.ZodEnum<{
            mon: "mon";
            tue: "tue";
            wed: "wed";
            thu: "thu";
            fri: "fri";
            sat: "sat";
            sun: "sun";
        }>>>;
        validFrom: z.ZodNullable<z.ZodString>;
        validTo: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    rights: z.ZodArray<z.ZodEnum<{
        customs_lead: "customs_lead";
    }>>;
    updatedAt: z.ZodString;
    payTerms: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        modelSlug: z.ZodString;
        modelName: z.ZodString;
        validFrom: z.ZodString;
        validTo: z.ZodNullable<z.ZodString>;
        shareBasisPoints: z.ZodNumber;
        fixPerShiftMills: z.ZodNumber;
        note: z.ZodNullable<z.ZodString>;
        updatedAt: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const agentPeopleResponseSchema: z.ZodObject<{
    people: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        code: z.ZodString;
        displayName: z.ZodString;
        kind: z.ZodEnum<{
            human: "human";
            agent: "agent";
            service: "service";
        }>;
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
            agent: "agent";
            contractor: "contractor";
            service: "service";
            content_manager: "content_manager";
        }>;
        state: z.ZodEnum<{
            left: "left";
            invited: "invited";
            set_up: "set_up";
            working: "working";
        }>;
        leftOn: z.ZodNullable<z.ZodString>;
        telegram: z.ZodObject<{
            userId: z.ZodNullable<z.ZodNumber>;
            handle: z.ZodNullable<z.ZodString>;
            reportTag: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        logins: z.ZodArray<z.ZodObject<{
            userId: z.ZodNumber;
            username: z.ZodString;
            active: z.ZodBoolean;
        }, z.core.$strip>>;
        agentKeys: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            active: z.ZodBoolean;
        }, z.core.$strip>>;
        workingPages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            modelSlug: z.ZodString;
        }, z.core.$strip>>;
        schedule: z.ZodNullable<z.ZodObject<{
            id: z.ZodNumber;
            personId: z.ZodNumber;
            pageId: z.ZodNullable<z.ZodNumber>;
            pageLabel: z.ZodNullable<z.ZodString>;
            startMinute: z.ZodNumber;
            endMinute: z.ZodNumber;
            start: z.ZodString;
            end: z.ZodString;
            weekdays: z.ZodNullable<z.ZodArray<z.ZodEnum<{
                mon: "mon";
                tue: "tue";
                wed: "wed";
                thu: "thu";
                fri: "fri";
                sat: "sat";
                sun: "sun";
            }>>>;
            validFrom: z.ZodNullable<z.ZodString>;
            validTo: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        scheduleSlots: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            personId: z.ZodNumber;
            pageId: z.ZodNullable<z.ZodNumber>;
            pageLabel: z.ZodNullable<z.ZodString>;
            startMinute: z.ZodNumber;
            endMinute: z.ZodNumber;
            start: z.ZodString;
            end: z.ZodString;
            weekdays: z.ZodNullable<z.ZodArray<z.ZodEnum<{
                mon: "mon";
                tue: "tue";
                wed: "wed";
                thu: "thu";
                fri: "fri";
                sat: "sat";
                sun: "sun";
            }>>>;
            validFrom: z.ZodNullable<z.ZodString>;
            validTo: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        rights: z.ZodArray<z.ZodEnum<{
            customs_lead: "customs_lead";
        }>>;
        updatedAt: z.ZodString;
        payTerms: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            modelSlug: z.ZodString;
            modelName: z.ZodString;
            validFrom: z.ZodString;
            validTo: z.ZodNullable<z.ZodString>;
            shareBasisPoints: z.ZodNumber;
            fixPerShiftMills: z.ZodNumber;
            note: z.ZodNullable<z.ZodString>;
            updatedAt: z.ZodString;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    payTermsIncluded: z.ZodBoolean;
    keyGrantExcludedPages: z.ZodNumber;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const agentPersonProposalSchema: z.ZodObject<{
    id: z.ZodNumber;
    reason: z.ZodString;
    state: z.ZodEnum<{
        rejected: "rejected";
        withdrawn: "withdrawn";
        open: "open";
        accepted: "accepted";
    }>;
    createdAt: z.ZodString;
    kind: z.ZodEnum<{
        update: "update";
        create: "create";
    }>;
    requestedBy: z.ZodNullable<z.ZodString>;
    decidedAt: z.ZodNullable<z.ZodString>;
    personCode: z.ZodString;
    change: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    sourceRef: z.ZodNullable<z.ZodString>;
    decisionNote: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const agentPersonProposalResponseSchema: z.ZodObject<{
    proposal: z.ZodObject<{
        id: z.ZodNumber;
        reason: z.ZodString;
        state: z.ZodEnum<{
            rejected: "rejected";
            withdrawn: "withdrawn";
            open: "open";
            accepted: "accepted";
        }>;
        createdAt: z.ZodString;
        kind: z.ZodEnum<{
            update: "update";
            create: "create";
        }>;
        requestedBy: z.ZodNullable<z.ZodString>;
        decidedAt: z.ZodNullable<z.ZodString>;
        personCode: z.ZodString;
        change: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        sourceRef: z.ZodNullable<z.ZodString>;
        decisionNote: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const agentPersonProposalsQuerySchema: z.ZodObject<{
    since: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$strip>;
export declare const agentPersonProposalsResponseSchema: z.ZodObject<{
    proposals: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        reason: z.ZodString;
        state: z.ZodEnum<{
            rejected: "rejected";
            withdrawn: "withdrawn";
            open: "open";
            accepted: "accepted";
        }>;
        createdAt: z.ZodString;
        kind: z.ZodEnum<{
            update: "update";
            create: "create";
        }>;
        requestedBy: z.ZodNullable<z.ZodString>;
        decidedAt: z.ZodNullable<z.ZodString>;
        personCode: z.ZodString;
        change: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        sourceRef: z.ZodNullable<z.ZodString>;
        decisionNote: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PersonKind = z.infer<typeof personKindEnum>;
export type PersonRole = z.infer<typeof personRoleEnum>;
export type PersonState = z.infer<typeof personStateEnum>;
export type PersonRight = z.infer<typeof personRightEnum>;
export type PersonWeekday = z.infer<typeof personWeekdayEnum>;
export type Person = z.infer<typeof personSchema>;
export type PersonLogin = z.infer<typeof personLoginSchema>;
export type PersonScheduleSlot = z.infer<typeof personScheduleSlotSchema>;
export type PersonPayTerm = z.infer<typeof personPayTermSchema>;
export type PersonProposal = z.infer<typeof personProposalSchema>;
export type PersonScheduleInput = z.infer<typeof personScheduleInputSchema>;
export type AdminPersonCreateBody = z.infer<typeof adminPersonCreateBodySchema>;
export type AdminPersonUpdateBody = z.infer<typeof adminPersonUpdateBodySchema>;
export type AdminPersonPayTermBody = z.infer<typeof adminPersonPayTermBodySchema>;
export type PersonProposalChange = z.infer<typeof personProposalChangeSchema>;
export type AgentPersonProposalBody = z.infer<typeof agentPersonProposalBodySchema>;
export type AgentPerson = z.infer<typeof agentPersonSchema>;
export type TeamPeopleResponse = z.infer<typeof teamPeopleResponseSchema>;
export type AdminPersonResponse = z.infer<typeof adminPersonResponseSchema>;
export type AgentPeopleResponse = z.infer<typeof agentPeopleResponseSchema>;
