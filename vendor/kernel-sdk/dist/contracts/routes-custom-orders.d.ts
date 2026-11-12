export declare const customOrderRouteSchemas: {
    readonly customOrdersBoard: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "The board «Кастомы»: open custom orders by step, the given of the last week, and sales that look like a custom with no order";
        readonly description: string;
        readonly querystring: import("zod").ZodObject<{
            pageLabel: import("zod").ZodOptional<import("zod").ZodString>;
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
            readonly 200: import("zod").ZodObject<{
                viewer: import("zod").ZodObject<{
                    lead: import("zod").ZodBoolean;
                    owner: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>;
                leads: import("zod").ZodArray<import("zod").ZodString>;
                orders: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    code: import("zod").ZodString;
                    pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                    platform: import("zod").ZodNullable<import("zod").ZodString>;
                    model: import("zod").ZodNullable<import("zod").ZodString>;
                    fan: import("zod").ZodNullable<import("zod").ZodObject<{
                        platform: import("zod").ZodString;
                        fanRef: import("zod").ZodString;
                        username: import("zod").ZodNullable<import("zod").ZodString>;
                        displayName: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    buyer: import("zod").ZodNullable<import("zod").ZodString>;
                    fanErased: import("zod").ZodBoolean;
                    card: import("zod").ZodObject<{
                        date: import("zod").ZodOptional<import("zod").ZodString>;
                        name: import("zod").ZodOptional<import("zod").ZodString>;
                        price: import("zod").ZodOptional<import("zod").ZodString>;
                        duration: import("zod").ZodOptional<import("zod").ZodString>;
                        task: import("zod").ZodOptional<import("zod").ZodString>;
                        photos: import("zod").ZodOptional<import("zod").ZodString>;
                        clothes: import("zod").ZodOptional<import("zod").ZodString>;
                        face: import("zod").ZodOptional<import("zod").ZodString>;
                        notes: import("zod").ZodOptional<import("zod").ZodString>;
                        urgency: import("zod").ZodOptional<import("zod").ZodString>;
                        deadlineNote: import("zod").ZodOptional<import("zod").ZodString>;
                        attachments: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                        nameInVideo: import("zod").ZodOptional<import("zod").ZodEnum<{
                            unknown: "unknown";
                            yes: "yes";
                            no: "no";
                        }>>;
                        wantsVideo: import("zod").ZodOptional<import("zod").ZodBoolean>;
                        wantsPhotos: import("zod").ZodOptional<import("zod").ZodNumber>;
                    }, import("zod/v4/core").$strict>;
                    what: import("zod").ZodString;
                    deadlineOn: import("zod").ZodNullable<import("zod").ZodString>;
                    state: import("zod").ZodEnum<{
                        cancelled: "cancelled";
                        paid: "paid";
                        recorded: "recorded";
                        revision: "revision";
                        refused: "refused";
                        closed: "closed";
                        at_model: "at_model";
                        partly: "partly";
                        shot: "shot";
                        given: "given";
                    }>;
                    stateAt: import("zod").ZodString;
                    stateNote: import("zod").ZodNullable<import("zod").ZodString>;
                    stateRef: import("zod").ZodNullable<import("zod").ZodString>;
                    paidGrossMills: import("zod").ZodNumber;
                    paidNetMills: import("zod").ZodNumber;
                    payments: import("zod").ZodNumber;
                    givenAt: import("zod").ZodNullable<import("zod").ZodString>;
                    givenMessageRef: import("zod").ZodNullable<import("zod").ZodString>;
                    acceptedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    acceptedByName: import("zod").ZodNullable<import("zod").ZodString>;
                    telegramRefs: import("zod").ZodArray<import("zod").ZodString>;
                    contentopsRef: import("zod").ZodNullable<import("zod").ZodString>;
                    origin: import("zod").ZodEnum<{
                        agent: "agent";
                        extension: "extension";
                        import: "import";
                        workboard: "workboard";
                    }>;
                    overdueDays: import("zod").ZodNullable<import("zod").ZodNumber>;
                    partsDone: import("zod").ZodArray<import("zod").ZodEnum<{
                        video: "video";
                        photos: "photos";
                    }>>;
                    openRevisions: import("zod").ZodNumber;
                    version: import("zod").ZodNumber;
                    createdAt: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                capped: import("zod").ZodBoolean;
                lookalikes: import("zod").ZodArray<import("zod").ZodObject<{
                    transactionRef: import("zod").ZodString;
                    pageLabel: import("zod").ZodString;
                    fan: import("zod").ZodNullable<import("zod").ZodObject<{
                        platform: import("zod").ZodString;
                        fanRef: import("zod").ZodString;
                        username: import("zod").ZodNullable<import("zod").ZodString>;
                        displayName: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    kind: import("zod").ZodEnum<{
                        tier: "tier";
                        tip_note: "tip_note";
                    }>;
                    detail: import("zod").ZodNullable<import("zod").ZodString>;
                    grossMills: import("zod").ZodNumber;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly customOrder: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "One custom order: its card, payments with «Это оплата?», delivery hints, history and what the viewer may do";
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
                order: import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    code: import("zod").ZodString;
                    pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                    platform: import("zod").ZodNullable<import("zod").ZodString>;
                    model: import("zod").ZodNullable<import("zod").ZodString>;
                    fan: import("zod").ZodNullable<import("zod").ZodObject<{
                        platform: import("zod").ZodString;
                        fanRef: import("zod").ZodString;
                        username: import("zod").ZodNullable<import("zod").ZodString>;
                        displayName: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    buyer: import("zod").ZodNullable<import("zod").ZodString>;
                    fanErased: import("zod").ZodBoolean;
                    card: import("zod").ZodObject<{
                        date: import("zod").ZodOptional<import("zod").ZodString>;
                        name: import("zod").ZodOptional<import("zod").ZodString>;
                        price: import("zod").ZodOptional<import("zod").ZodString>;
                        duration: import("zod").ZodOptional<import("zod").ZodString>;
                        task: import("zod").ZodOptional<import("zod").ZodString>;
                        photos: import("zod").ZodOptional<import("zod").ZodString>;
                        clothes: import("zod").ZodOptional<import("zod").ZodString>;
                        face: import("zod").ZodOptional<import("zod").ZodString>;
                        notes: import("zod").ZodOptional<import("zod").ZodString>;
                        urgency: import("zod").ZodOptional<import("zod").ZodString>;
                        deadlineNote: import("zod").ZodOptional<import("zod").ZodString>;
                        attachments: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                        nameInVideo: import("zod").ZodOptional<import("zod").ZodEnum<{
                            unknown: "unknown";
                            yes: "yes";
                            no: "no";
                        }>>;
                        wantsVideo: import("zod").ZodOptional<import("zod").ZodBoolean>;
                        wantsPhotos: import("zod").ZodOptional<import("zod").ZodNumber>;
                    }, import("zod/v4/core").$strict>;
                    what: import("zod").ZodString;
                    deadlineOn: import("zod").ZodNullable<import("zod").ZodString>;
                    state: import("zod").ZodEnum<{
                        cancelled: "cancelled";
                        paid: "paid";
                        recorded: "recorded";
                        revision: "revision";
                        refused: "refused";
                        closed: "closed";
                        at_model: "at_model";
                        partly: "partly";
                        shot: "shot";
                        given: "given";
                    }>;
                    stateAt: import("zod").ZodString;
                    stateNote: import("zod").ZodNullable<import("zod").ZodString>;
                    stateRef: import("zod").ZodNullable<import("zod").ZodString>;
                    paidGrossMills: import("zod").ZodNumber;
                    paidNetMills: import("zod").ZodNumber;
                    payments: import("zod").ZodNumber;
                    givenAt: import("zod").ZodNullable<import("zod").ZodString>;
                    givenMessageRef: import("zod").ZodNullable<import("zod").ZodString>;
                    acceptedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    acceptedByName: import("zod").ZodNullable<import("zod").ZodString>;
                    telegramRefs: import("zod").ZodArray<import("zod").ZodString>;
                    contentopsRef: import("zod").ZodNullable<import("zod").ZodString>;
                    origin: import("zod").ZodEnum<{
                        agent: "agent";
                        extension: "extension";
                        import: "import";
                        workboard: "workboard";
                    }>;
                    overdueDays: import("zod").ZodNullable<import("zod").ZodNumber>;
                    partsDone: import("zod").ZodArray<import("zod").ZodEnum<{
                        video: "video";
                        photos: "photos";
                    }>>;
                    openRevisions: import("zod").ZodNumber;
                    version: import("zod").ZodNumber;
                    createdAt: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>;
                cardText: import("zod").ZodString;
                sourceText: import("zod").ZodNullable<import("zod").ZodString>;
                messages: import("zod").ZodArray<import("zod").ZodObject<{
                    telegramRef: import("zod").ZodNullable<import("zod").ZodString>;
                    eventRef: import("zod").ZodNullable<import("zod").ZodString>;
                    ordinal: import("zod").ZodNumber;
                    kind: import("zod").ZodEnum<{
                        note: "note";
                        revision: "revision";
                        delivery: "delivery";
                        repost: "repost";
                        confirmation: "confirmation";
                    }>;
                    part: import("zod").ZodNullable<import("zod").ZodEnum<{
                        video: "video";
                        photos: "photos";
                    }>>;
                    complete: import("zod").ZodNullable<import("zod").ZodBoolean>;
                    at: import("zod").ZodNullable<import("zod").ZodString>;
                    author: import("zod").ZodNullable<import("zod").ZodString>;
                    excerpt: import("zod").ZodNullable<import("zod").ZodString>;
                    doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                    retractedAt: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                payments: import("zod").ZodArray<import("zod").ZodObject<{
                    transactionRef: import("zod").ZodString;
                    kind: import("zod").ZodString;
                    grossMills: import("zod").ZodNumber;
                    netMills: import("zod").ZodNumber;
                    at: import("zod").ZodString;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                paymentSuggestions: import("zod").ZodArray<import("zod").ZodObject<{
                    transactionRef: import("zod").ZodString;
                    kind: import("zod").ZodString;
                    grossMills: import("zod").ZodNumber;
                    netMills: import("zod").ZodNumber;
                    at: import("zod").ZodString;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                deliverySuggestions: import("zod").ZodArray<import("zod").ZodObject<{
                    messageRef: import("zod").ZodString;
                    at: import("zod").ZodString;
                    mediaCount: import("zod").ZodNumber;
                    priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>>;
                history: import("zod").ZodArray<import("zod").ZodObject<{
                    at: import("zod").ZodString;
                    event: import("zod").ZodString;
                    actor: import("zod").ZodNullable<import("zod").ZodString>;
                    onBehalfOf: import("zod").ZodNullable<import("zod").ZodString>;
                    door: import("zod").ZodString;
                    changes: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>;
                }, import("zod/v4/core").$strip>>;
                actions: import("zod").ZodArray<import("zod").ZodEnum<{
                    cancel: "cancel";
                    revision: "revision";
                    refused: "refused";
                    fan: "fan";
                    edit: "edit";
                    card: "card";
                    at_model: "at_model";
                    partly: "partly";
                    shot: "shot";
                    given: "given";
                    deadline: "deadline";
                    payment: "payment";
                    unpay: "unpay";
                    close: "close";
                }>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly customOrderAct: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: string;
        readonly description: string;
        readonly params: import("zod").ZodObject<{
            code: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"edit">;
            card: import("zod").ZodObject<{
                date: import("zod").ZodOptional<import("zod").ZodString>;
                name: import("zod").ZodOptional<import("zod").ZodString>;
                price: import("zod").ZodOptional<import("zod").ZodString>;
                duration: import("zod").ZodOptional<import("zod").ZodString>;
                task: import("zod").ZodOptional<import("zod").ZodString>;
                photos: import("zod").ZodOptional<import("zod").ZodString>;
                clothes: import("zod").ZodOptional<import("zod").ZodString>;
                face: import("zod").ZodOptional<import("zod").ZodString>;
                notes: import("zod").ZodOptional<import("zod").ZodString>;
                urgency: import("zod").ZodOptional<import("zod").ZodString>;
                deadlineNote: import("zod").ZodOptional<import("zod").ZodString>;
                attachments: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                nameInVideo: import("zod").ZodOptional<import("zod").ZodEnum<{
                    unknown: "unknown";
                    yes: "yes";
                    no: "no";
                }>>;
                wantsVideo: import("zod").ZodOptional<import("zod").ZodBoolean>;
                wantsPhotos: import("zod").ZodOptional<import("zod").ZodNumber>;
            }, import("zod/v4/core").$strict>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"deadline">;
            deadlineOn: import("zod").ZodNullable<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"fan">;
            pageLabel: import("zod").ZodString;
            fan: import("zod").ZodString;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"card">;
            telegramRef: import("zod").ZodString;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"payment">;
            transactionRef: import("zod").ZodString;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"unpay">;
            transactionRef: import("zod").ZodString;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"at_model">;
            telegramRef: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"partly">;
            note: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"shot">;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"revision">;
            note: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"refused">;
            reason: import("zod").ZodString;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"given">;
            messageRef: import("zod").ZodString;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"close">;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"cancel">;
            reason: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>], "action">;
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
                order: import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    code: import("zod").ZodString;
                    pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                    platform: import("zod").ZodNullable<import("zod").ZodString>;
                    model: import("zod").ZodNullable<import("zod").ZodString>;
                    fan: import("zod").ZodNullable<import("zod").ZodObject<{
                        platform: import("zod").ZodString;
                        fanRef: import("zod").ZodString;
                        username: import("zod").ZodNullable<import("zod").ZodString>;
                        displayName: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    buyer: import("zod").ZodNullable<import("zod").ZodString>;
                    fanErased: import("zod").ZodBoolean;
                    card: import("zod").ZodObject<{
                        date: import("zod").ZodOptional<import("zod").ZodString>;
                        name: import("zod").ZodOptional<import("zod").ZodString>;
                        price: import("zod").ZodOptional<import("zod").ZodString>;
                        duration: import("zod").ZodOptional<import("zod").ZodString>;
                        task: import("zod").ZodOptional<import("zod").ZodString>;
                        photos: import("zod").ZodOptional<import("zod").ZodString>;
                        clothes: import("zod").ZodOptional<import("zod").ZodString>;
                        face: import("zod").ZodOptional<import("zod").ZodString>;
                        notes: import("zod").ZodOptional<import("zod").ZodString>;
                        urgency: import("zod").ZodOptional<import("zod").ZodString>;
                        deadlineNote: import("zod").ZodOptional<import("zod").ZodString>;
                        attachments: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                        nameInVideo: import("zod").ZodOptional<import("zod").ZodEnum<{
                            unknown: "unknown";
                            yes: "yes";
                            no: "no";
                        }>>;
                        wantsVideo: import("zod").ZodOptional<import("zod").ZodBoolean>;
                        wantsPhotos: import("zod").ZodOptional<import("zod").ZodNumber>;
                    }, import("zod/v4/core").$strict>;
                    what: import("zod").ZodString;
                    deadlineOn: import("zod").ZodNullable<import("zod").ZodString>;
                    state: import("zod").ZodEnum<{
                        cancelled: "cancelled";
                        paid: "paid";
                        recorded: "recorded";
                        revision: "revision";
                        refused: "refused";
                        closed: "closed";
                        at_model: "at_model";
                        partly: "partly";
                        shot: "shot";
                        given: "given";
                    }>;
                    stateAt: import("zod").ZodString;
                    stateNote: import("zod").ZodNullable<import("zod").ZodString>;
                    stateRef: import("zod").ZodNullable<import("zod").ZodString>;
                    paidGrossMills: import("zod").ZodNumber;
                    paidNetMills: import("zod").ZodNumber;
                    payments: import("zod").ZodNumber;
                    givenAt: import("zod").ZodNullable<import("zod").ZodString>;
                    givenMessageRef: import("zod").ZodNullable<import("zod").ZodString>;
                    acceptedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    acceptedByName: import("zod").ZodNullable<import("zod").ZodString>;
                    telegramRefs: import("zod").ZodArray<import("zod").ZodString>;
                    contentopsRef: import("zod").ZodNullable<import("zod").ZodString>;
                    origin: import("zod").ZodEnum<{
                        agent: "agent";
                        extension: "extension";
                        import: "import";
                        workboard: "workboard";
                    }>;
                    overdueDays: import("zod").ZodNullable<import("zod").ZodNumber>;
                    partsDone: import("zod").ZodArray<import("zod").ZodEnum<{
                        video: "video";
                        photos: "photos";
                    }>>;
                    openRevisions: import("zod").ZodNumber;
                    version: import("zod").ZodNumber;
                    createdAt: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>;
                cardText: import("zod").ZodString;
                sourceText: import("zod").ZodNullable<import("zod").ZodString>;
                messages: import("zod").ZodArray<import("zod").ZodObject<{
                    telegramRef: import("zod").ZodNullable<import("zod").ZodString>;
                    eventRef: import("zod").ZodNullable<import("zod").ZodString>;
                    ordinal: import("zod").ZodNumber;
                    kind: import("zod").ZodEnum<{
                        note: "note";
                        revision: "revision";
                        delivery: "delivery";
                        repost: "repost";
                        confirmation: "confirmation";
                    }>;
                    part: import("zod").ZodNullable<import("zod").ZodEnum<{
                        video: "video";
                        photos: "photos";
                    }>>;
                    complete: import("zod").ZodNullable<import("zod").ZodBoolean>;
                    at: import("zod").ZodNullable<import("zod").ZodString>;
                    author: import("zod").ZodNullable<import("zod").ZodString>;
                    excerpt: import("zod").ZodNullable<import("zod").ZodString>;
                    doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                    retractedAt: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                payments: import("zod").ZodArray<import("zod").ZodObject<{
                    transactionRef: import("zod").ZodString;
                    kind: import("zod").ZodString;
                    grossMills: import("zod").ZodNumber;
                    netMills: import("zod").ZodNumber;
                    at: import("zod").ZodString;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                paymentSuggestions: import("zod").ZodArray<import("zod").ZodObject<{
                    transactionRef: import("zod").ZodString;
                    kind: import("zod").ZodString;
                    grossMills: import("zod").ZodNumber;
                    netMills: import("zod").ZodNumber;
                    at: import("zod").ZodString;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                deliverySuggestions: import("zod").ZodArray<import("zod").ZodObject<{
                    messageRef: import("zod").ZodString;
                    at: import("zod").ZodString;
                    mediaCount: import("zod").ZodNumber;
                    priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>>;
                history: import("zod").ZodArray<import("zod").ZodObject<{
                    at: import("zod").ZodString;
                    event: import("zod").ZodString;
                    actor: import("zod").ZodNullable<import("zod").ZodString>;
                    onBehalfOf: import("zod").ZodNullable<import("zod").ZodString>;
                    door: import("zod").ZodString;
                    changes: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>;
                }, import("zod/v4/core").$strip>>;
                actions: import("zod").ZodArray<import("zod").ZodEnum<{
                    cancel: "cancel";
                    revision: "revision";
                    refused: "refused";
                    fan: "fan";
                    edit: "edit";
                    card: "card";
                    at_model: "at_model";
                    partly: "partly";
                    shot: "shot";
                    given: "given";
                    deadline: "deadline";
                    payment: "payment";
                    unpay: "unpay";
                    close: "close";
                }>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly customOrderCreate: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "«Записать кастом» on the board: from a sale that looks like a custom, or on a page for a fan";
        readonly body: import("zod").ZodObject<{
            transactionRef: import("zod").ZodOptional<import("zod").ZodString>;
            pageLabel: import("zod").ZodOptional<import("zod").ZodString>;
            fan: import("zod").ZodOptional<import("zod").ZodString>;
            card: import("zod").ZodObject<{
                date: import("zod").ZodOptional<import("zod").ZodString>;
                name: import("zod").ZodOptional<import("zod").ZodString>;
                price: import("zod").ZodOptional<import("zod").ZodString>;
                duration: import("zod").ZodOptional<import("zod").ZodString>;
                task: import("zod").ZodOptional<import("zod").ZodString>;
                photos: import("zod").ZodOptional<import("zod").ZodString>;
                clothes: import("zod").ZodOptional<import("zod").ZodString>;
                face: import("zod").ZodOptional<import("zod").ZodString>;
                notes: import("zod").ZodOptional<import("zod").ZodString>;
                urgency: import("zod").ZodOptional<import("zod").ZodString>;
                deadlineNote: import("zod").ZodOptional<import("zod").ZodString>;
                attachments: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                nameInVideo: import("zod").ZodOptional<import("zod").ZodEnum<{
                    unknown: "unknown";
                    yes: "yes";
                    no: "no";
                }>>;
                wantsVideo: import("zod").ZodOptional<import("zod").ZodBoolean>;
                wantsPhotos: import("zod").ZodOptional<import("zod").ZodNumber>;
            }, import("zod/v4/core").$strict>;
            telegramRef: import("zod").ZodOptional<import("zod").ZodString>;
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
            readonly 200: import("zod").ZodObject<{
                order: import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    code: import("zod").ZodString;
                    pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                    platform: import("zod").ZodNullable<import("zod").ZodString>;
                    model: import("zod").ZodNullable<import("zod").ZodString>;
                    fan: import("zod").ZodNullable<import("zod").ZodObject<{
                        platform: import("zod").ZodString;
                        fanRef: import("zod").ZodString;
                        username: import("zod").ZodNullable<import("zod").ZodString>;
                        displayName: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    buyer: import("zod").ZodNullable<import("zod").ZodString>;
                    fanErased: import("zod").ZodBoolean;
                    card: import("zod").ZodObject<{
                        date: import("zod").ZodOptional<import("zod").ZodString>;
                        name: import("zod").ZodOptional<import("zod").ZodString>;
                        price: import("zod").ZodOptional<import("zod").ZodString>;
                        duration: import("zod").ZodOptional<import("zod").ZodString>;
                        task: import("zod").ZodOptional<import("zod").ZodString>;
                        photos: import("zod").ZodOptional<import("zod").ZodString>;
                        clothes: import("zod").ZodOptional<import("zod").ZodString>;
                        face: import("zod").ZodOptional<import("zod").ZodString>;
                        notes: import("zod").ZodOptional<import("zod").ZodString>;
                        urgency: import("zod").ZodOptional<import("zod").ZodString>;
                        deadlineNote: import("zod").ZodOptional<import("zod").ZodString>;
                        attachments: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                        nameInVideo: import("zod").ZodOptional<import("zod").ZodEnum<{
                            unknown: "unknown";
                            yes: "yes";
                            no: "no";
                        }>>;
                        wantsVideo: import("zod").ZodOptional<import("zod").ZodBoolean>;
                        wantsPhotos: import("zod").ZodOptional<import("zod").ZodNumber>;
                    }, import("zod/v4/core").$strict>;
                    what: import("zod").ZodString;
                    deadlineOn: import("zod").ZodNullable<import("zod").ZodString>;
                    state: import("zod").ZodEnum<{
                        cancelled: "cancelled";
                        paid: "paid";
                        recorded: "recorded";
                        revision: "revision";
                        refused: "refused";
                        closed: "closed";
                        at_model: "at_model";
                        partly: "partly";
                        shot: "shot";
                        given: "given";
                    }>;
                    stateAt: import("zod").ZodString;
                    stateNote: import("zod").ZodNullable<import("zod").ZodString>;
                    stateRef: import("zod").ZodNullable<import("zod").ZodString>;
                    paidGrossMills: import("zod").ZodNumber;
                    paidNetMills: import("zod").ZodNumber;
                    payments: import("zod").ZodNumber;
                    givenAt: import("zod").ZodNullable<import("zod").ZodString>;
                    givenMessageRef: import("zod").ZodNullable<import("zod").ZodString>;
                    acceptedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    acceptedByName: import("zod").ZodNullable<import("zod").ZodString>;
                    telegramRefs: import("zod").ZodArray<import("zod").ZodString>;
                    contentopsRef: import("zod").ZodNullable<import("zod").ZodString>;
                    origin: import("zod").ZodEnum<{
                        agent: "agent";
                        extension: "extension";
                        import: "import";
                        workboard: "workboard";
                    }>;
                    overdueDays: import("zod").ZodNullable<import("zod").ZodNumber>;
                    partsDone: import("zod").ZodArray<import("zod").ZodEnum<{
                        video: "video";
                        photos: "photos";
                    }>>;
                    openRevisions: import("zod").ZodNumber;
                    version: import("zod").ZodNumber;
                    createdAt: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>;
                cardText: import("zod").ZodString;
                sourceText: import("zod").ZodNullable<import("zod").ZodString>;
                messages: import("zod").ZodArray<import("zod").ZodObject<{
                    telegramRef: import("zod").ZodNullable<import("zod").ZodString>;
                    eventRef: import("zod").ZodNullable<import("zod").ZodString>;
                    ordinal: import("zod").ZodNumber;
                    kind: import("zod").ZodEnum<{
                        note: "note";
                        revision: "revision";
                        delivery: "delivery";
                        repost: "repost";
                        confirmation: "confirmation";
                    }>;
                    part: import("zod").ZodNullable<import("zod").ZodEnum<{
                        video: "video";
                        photos: "photos";
                    }>>;
                    complete: import("zod").ZodNullable<import("zod").ZodBoolean>;
                    at: import("zod").ZodNullable<import("zod").ZodString>;
                    author: import("zod").ZodNullable<import("zod").ZodString>;
                    excerpt: import("zod").ZodNullable<import("zod").ZodString>;
                    doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                    retractedAt: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                payments: import("zod").ZodArray<import("zod").ZodObject<{
                    transactionRef: import("zod").ZodString;
                    kind: import("zod").ZodString;
                    grossMills: import("zod").ZodNumber;
                    netMills: import("zod").ZodNumber;
                    at: import("zod").ZodString;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                paymentSuggestions: import("zod").ZodArray<import("zod").ZodObject<{
                    transactionRef: import("zod").ZodString;
                    kind: import("zod").ZodString;
                    grossMills: import("zod").ZodNumber;
                    netMills: import("zod").ZodNumber;
                    at: import("zod").ZodString;
                    note: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                deliverySuggestions: import("zod").ZodArray<import("zod").ZodObject<{
                    messageRef: import("zod").ZodString;
                    at: import("zod").ZodString;
                    mediaCount: import("zod").ZodNumber;
                    priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>>;
                history: import("zod").ZodArray<import("zod").ZodObject<{
                    at: import("zod").ZodString;
                    event: import("zod").ZodString;
                    actor: import("zod").ZodNullable<import("zod").ZodString>;
                    onBehalfOf: import("zod").ZodNullable<import("zod").ZodString>;
                    door: import("zod").ZodString;
                    changes: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>;
                }, import("zod/v4/core").$strip>>;
                actions: import("zod").ZodArray<import("zod").ZodEnum<{
                    cancel: "cancel";
                    revision: "revision";
                    refused: "refused";
                    fan: "fan";
                    edit: "edit";
                    card: "card";
                    at_model: "at_model";
                    partly: "partly";
                    shot: "shot";
                    given: "given";
                    deadline: "deadline";
                    payment: "payment";
                    unpay: "unpay";
                    close: "close";
                }>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly customSaleDismiss: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "«Не кастом»: a sale the custom check pointed at is not a custom; its matter closes";
        readonly params: import("zod").ZodObject<{
            transactionRef: import("zod").ZodString;
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
                dismissed: import("zod").ZodBoolean;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentCustomOrders: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Custom orders of the key's pages and of no known page, with the card text (needs write:customs); no money";
        readonly querystring: import("zod").ZodObject<{
            state: import("zod").ZodDefault<import("zod").ZodEnum<{
                all: "all";
                open: "open";
            }>>;
            code: import("zod").ZodOptional<import("zod").ZodString>;
            telegramRef: import("zod").ZodOptional<import("zod").ZodString>;
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
                orders: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                    platform: import("zod").ZodNullable<import("zod").ZodString>;
                    state: import("zod").ZodEnum<{
                        cancelled: "cancelled";
                        paid: "paid";
                        recorded: "recorded";
                        revision: "revision";
                        refused: "refused";
                        closed: "closed";
                        at_model: "at_model";
                        partly: "partly";
                        shot: "shot";
                        given: "given";
                    }>;
                    createdAt: import("zod").ZodString;
                    code: import("zod").ZodString;
                    origin: import("zod").ZodEnum<{
                        agent: "agent";
                        extension: "extension";
                        import: "import";
                        workboard: "workboard";
                    }>;
                    version: import("zod").ZodNumber;
                    updatedAt: import("zod").ZodString;
                    fan: import("zod").ZodNullable<import("zod").ZodObject<{
                        platform: import("zod").ZodString;
                        fanRef: import("zod").ZodString;
                        username: import("zod").ZodNullable<import("zod").ZodString>;
                        displayName: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    model: import("zod").ZodNullable<import("zod").ZodString>;
                    card: import("zod").ZodObject<{
                        date: import("zod").ZodOptional<import("zod").ZodString>;
                        name: import("zod").ZodOptional<import("zod").ZodString>;
                        price: import("zod").ZodOptional<import("zod").ZodString>;
                        duration: import("zod").ZodOptional<import("zod").ZodString>;
                        task: import("zod").ZodOptional<import("zod").ZodString>;
                        photos: import("zod").ZodOptional<import("zod").ZodString>;
                        clothes: import("zod").ZodOptional<import("zod").ZodString>;
                        face: import("zod").ZodOptional<import("zod").ZodString>;
                        notes: import("zod").ZodOptional<import("zod").ZodString>;
                        urgency: import("zod").ZodOptional<import("zod").ZodString>;
                        deadlineNote: import("zod").ZodOptional<import("zod").ZodString>;
                        attachments: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                        nameInVideo: import("zod").ZodOptional<import("zod").ZodEnum<{
                            unknown: "unknown";
                            yes: "yes";
                            no: "no";
                        }>>;
                        wantsVideo: import("zod").ZodOptional<import("zod").ZodBoolean>;
                        wantsPhotos: import("zod").ZodOptional<import("zod").ZodNumber>;
                    }, import("zod/v4/core").$strict>;
                    what: import("zod").ZodString;
                    stateAt: import("zod").ZodString;
                    buyer: import("zod").ZodNullable<import("zod").ZodString>;
                    fanErased: import("zod").ZodBoolean;
                    deadlineOn: import("zod").ZodNullable<import("zod").ZodString>;
                    stateNote: import("zod").ZodNullable<import("zod").ZodString>;
                    stateRef: import("zod").ZodNullable<import("zod").ZodString>;
                    payments: import("zod").ZodNumber;
                    givenAt: import("zod").ZodNullable<import("zod").ZodString>;
                    givenMessageRef: import("zod").ZodNullable<import("zod").ZodString>;
                    acceptedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    acceptedByName: import("zod").ZodNullable<import("zod").ZodString>;
                    telegramRefs: import("zod").ZodArray<import("zod").ZodString>;
                    contentopsRef: import("zod").ZodNullable<import("zod").ZodString>;
                    overdueDays: import("zod").ZodNullable<import("zod").ZodNumber>;
                    partsDone: import("zod").ZodArray<import("zod").ZodEnum<{
                        video: "video";
                        photos: "photos";
                    }>>;
                    openRevisions: import("zod").ZodNumber;
                    cardText: import("zod").ZodString;
                    sourceText: import("zod").ZodNullable<import("zod").ZodString>;
                    messages: import("zod").ZodArray<import("zod").ZodObject<{
                        telegramRef: import("zod").ZodNullable<import("zod").ZodString>;
                        eventRef: import("zod").ZodNullable<import("zod").ZodString>;
                        ordinal: import("zod").ZodNumber;
                        kind: import("zod").ZodEnum<{
                            note: "note";
                            revision: "revision";
                            delivery: "delivery";
                            repost: "repost";
                            confirmation: "confirmation";
                        }>;
                        part: import("zod").ZodNullable<import("zod").ZodEnum<{
                            video: "video";
                            photos: "photos";
                        }>>;
                        complete: import("zod").ZodNullable<import("zod").ZodBoolean>;
                        at: import("zod").ZodNullable<import("zod").ZodString>;
                        author: import("zod").ZodNullable<import("zod").ZodString>;
                        excerpt: import("zod").ZodNullable<import("zod").ZodString>;
                        doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                        retractedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentCustomOrderCreate: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Create a recorded custom order from the card's fields and the fan's link (needs write:customs)";
        readonly description: string;
        readonly body: import("zod").ZodObject<{
            pageLabel: import("zod").ZodOptional<import("zod").ZodString>;
            fan: import("zod").ZodOptional<import("zod").ZodString>;
            acceptedBy: import("zod").ZodOptional<import("zod").ZodString>;
            card: import("zod").ZodObject<{
                date: import("zod").ZodOptional<import("zod").ZodString>;
                name: import("zod").ZodOptional<import("zod").ZodString>;
                price: import("zod").ZodOptional<import("zod").ZodString>;
                duration: import("zod").ZodOptional<import("zod").ZodString>;
                task: import("zod").ZodOptional<import("zod").ZodString>;
                photos: import("zod").ZodOptional<import("zod").ZodString>;
                clothes: import("zod").ZodOptional<import("zod").ZodString>;
                face: import("zod").ZodOptional<import("zod").ZodString>;
                notes: import("zod").ZodOptional<import("zod").ZodString>;
                urgency: import("zod").ZodOptional<import("zod").ZodString>;
                deadlineNote: import("zod").ZodOptional<import("zod").ZodString>;
                attachments: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                nameInVideo: import("zod").ZodOptional<import("zod").ZodEnum<{
                    unknown: "unknown";
                    yes: "yes";
                    no: "no";
                }>>;
                wantsVideo: import("zod").ZodOptional<import("zod").ZodBoolean>;
                wantsPhotos: import("zod").ZodOptional<import("zod").ZodNumber>;
            }, import("zod/v4/core").$strict>;
            deadlineOn: import("zod").ZodOptional<import("zod").ZodString>;
            telegramRef: import("zod").ZodOptional<import("zod").ZodString>;
            postedAt: import("zod").ZodOptional<import("zod").ZodISODateTime>;
            author: import("zod").ZodOptional<import("zod").ZodString>;
            sourceText: import("zod").ZodOptional<import("zod").ZodString>;
            another: import("zod").ZodOptional<import("zod").ZodBoolean>;
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
                order: import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                    platform: import("zod").ZodNullable<import("zod").ZodString>;
                    state: import("zod").ZodEnum<{
                        cancelled: "cancelled";
                        paid: "paid";
                        recorded: "recorded";
                        revision: "revision";
                        refused: "refused";
                        closed: "closed";
                        at_model: "at_model";
                        partly: "partly";
                        shot: "shot";
                        given: "given";
                    }>;
                    createdAt: import("zod").ZodString;
                    code: import("zod").ZodString;
                    origin: import("zod").ZodEnum<{
                        agent: "agent";
                        extension: "extension";
                        import: "import";
                        workboard: "workboard";
                    }>;
                    version: import("zod").ZodNumber;
                    updatedAt: import("zod").ZodString;
                    fan: import("zod").ZodNullable<import("zod").ZodObject<{
                        platform: import("zod").ZodString;
                        fanRef: import("zod").ZodString;
                        username: import("zod").ZodNullable<import("zod").ZodString>;
                        displayName: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    model: import("zod").ZodNullable<import("zod").ZodString>;
                    card: import("zod").ZodObject<{
                        date: import("zod").ZodOptional<import("zod").ZodString>;
                        name: import("zod").ZodOptional<import("zod").ZodString>;
                        price: import("zod").ZodOptional<import("zod").ZodString>;
                        duration: import("zod").ZodOptional<import("zod").ZodString>;
                        task: import("zod").ZodOptional<import("zod").ZodString>;
                        photos: import("zod").ZodOptional<import("zod").ZodString>;
                        clothes: import("zod").ZodOptional<import("zod").ZodString>;
                        face: import("zod").ZodOptional<import("zod").ZodString>;
                        notes: import("zod").ZodOptional<import("zod").ZodString>;
                        urgency: import("zod").ZodOptional<import("zod").ZodString>;
                        deadlineNote: import("zod").ZodOptional<import("zod").ZodString>;
                        attachments: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                        nameInVideo: import("zod").ZodOptional<import("zod").ZodEnum<{
                            unknown: "unknown";
                            yes: "yes";
                            no: "no";
                        }>>;
                        wantsVideo: import("zod").ZodOptional<import("zod").ZodBoolean>;
                        wantsPhotos: import("zod").ZodOptional<import("zod").ZodNumber>;
                    }, import("zod/v4/core").$strict>;
                    what: import("zod").ZodString;
                    stateAt: import("zod").ZodString;
                    buyer: import("zod").ZodNullable<import("zod").ZodString>;
                    fanErased: import("zod").ZodBoolean;
                    deadlineOn: import("zod").ZodNullable<import("zod").ZodString>;
                    stateNote: import("zod").ZodNullable<import("zod").ZodString>;
                    stateRef: import("zod").ZodNullable<import("zod").ZodString>;
                    payments: import("zod").ZodNumber;
                    givenAt: import("zod").ZodNullable<import("zod").ZodString>;
                    givenMessageRef: import("zod").ZodNullable<import("zod").ZodString>;
                    acceptedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    acceptedByName: import("zod").ZodNullable<import("zod").ZodString>;
                    telegramRefs: import("zod").ZodArray<import("zod").ZodString>;
                    contentopsRef: import("zod").ZodNullable<import("zod").ZodString>;
                    overdueDays: import("zod").ZodNullable<import("zod").ZodNumber>;
                    partsDone: import("zod").ZodArray<import("zod").ZodEnum<{
                        video: "video";
                        photos: "photos";
                    }>>;
                    openRevisions: import("zod").ZodNumber;
                    cardText: import("zod").ZodString;
                    sourceText: import("zod").ZodNullable<import("zod").ZodString>;
                    messages: import("zod").ZodArray<import("zod").ZodObject<{
                        telegramRef: import("zod").ZodNullable<import("zod").ZodString>;
                        eventRef: import("zod").ZodNullable<import("zod").ZodString>;
                        ordinal: import("zod").ZodNumber;
                        kind: import("zod").ZodEnum<{
                            note: "note";
                            revision: "revision";
                            delivery: "delivery";
                            repost: "repost";
                            confirmation: "confirmation";
                        }>;
                        part: import("zod").ZodNullable<import("zod").ZodEnum<{
                            video: "video";
                            photos: "photos";
                        }>>;
                        complete: import("zod").ZodNullable<import("zod").ZodBoolean>;
                        at: import("zod").ZodNullable<import("zod").ZodString>;
                        author: import("zod").ZodNullable<import("zod").ZodString>;
                        excerpt: import("zod").ZodNullable<import("zod").ZodString>;
                        doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                        retractedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>;
                outcome: import("zod").ZodEnum<{
                    changed: "changed";
                    created: "created";
                    unchanged: "unchanged";
                }>;
                event: import("zod").ZodNullable<import("zod").ZodObject<{
                    ref: import("zod").ZodString;
                    result: import("zod").ZodEnum<{
                        stored: "stored";
                        already: "already";
                    }>;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentCustomOrderUpdate: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly params: import("zod").ZodObject<{
            code: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"edit">;
            card: import("zod").ZodType<import("./custom-orders").CustomOrderCardPatch, unknown, import("zod/v4/core").$ZodTypeInternals<import("./custom-orders").CustomOrderCardPatch, unknown>>;
            deadlineOn: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
            sourceText: import("zod").ZodOptional<import("zod").ZodString>;
            ifVersion: import("zod").ZodOptional<import("zod").ZodNumber>;
            onBehalfOf: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"at_model">;
            telegramRef: import("zod").ZodOptional<import("zod").ZodString>;
            onBehalfOf: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"delivery">;
            eventRef: import("zod").ZodOptional<import("zod").ZodString>;
            message: import("zod").ZodObject<{
                telegramRef: import("zod").ZodOptional<import("zod").ZodString>;
                at: import("zod").ZodOptional<import("zod").ZodISODateTime>;
                author: import("zod").ZodOptional<import("zod").ZodString>;
                excerpt: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strict>;
            part: import("zod").ZodOptional<import("zod").ZodEnum<{
                video: "video";
                photos: "photos";
            }>>;
            complete: import("zod").ZodDefault<import("zod").ZodBoolean>;
            onBehalfOf: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"partly">;
            ref: import("zod").ZodString;
            note: import("zod").ZodOptional<import("zod").ZodString>;
            onBehalfOf: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"shot">;
            ref: import("zod").ZodString;
            onBehalfOf: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"revision">;
            eventRef: import("zod").ZodOptional<import("zod").ZodString>;
            message: import("zod").ZodObject<{
                telegramRef: import("zod").ZodOptional<import("zod").ZodString>;
                at: import("zod").ZodOptional<import("zod").ZodISODateTime>;
                author: import("zod").ZodOptional<import("zod").ZodString>;
                excerpt: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strict>;
            ordinal: import("zod").ZodDefault<import("zod").ZodNumber>;
            text: import("zod").ZodString;
            onBehalfOf: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"revision_done">;
            telegramRef: import("zod").ZodOptional<import("zod").ZodString>;
            eventRef: import("zod").ZodOptional<import("zod").ZodString>;
            ordinal: import("zod").ZodDefault<import("zod").ZodNumber>;
            onBehalfOf: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"retract">;
            eventRef: import("zod").ZodString;
            retracts: import("zod").ZodString;
            reason: import("zod").ZodString;
            message: import("zod").ZodOptional<import("zod").ZodObject<{
                telegramRef: import("zod").ZodOptional<import("zod").ZodString>;
                at: import("zod").ZodOptional<import("zod").ZodISODateTime>;
                author: import("zod").ZodOptional<import("zod").ZodString>;
                excerpt: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strict>>;
            onBehalfOf: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"refused">;
            ref: import("zod").ZodString;
            reason: import("zod").ZodString;
            onBehalfOf: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"cancel">;
            reason: import("zod").ZodString;
            onBehalfOf: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"message">;
            kind: import("zod").ZodEnum<{
                note: "note";
                repost: "repost";
                confirmation: "confirmation";
            }>;
            eventRef: import("zod").ZodOptional<import("zod").ZodString>;
            message: import("zod").ZodObject<{
                telegramRef: import("zod").ZodOptional<import("zod").ZodString>;
                at: import("zod").ZodOptional<import("zod").ZodISODateTime>;
                author: import("zod").ZodOptional<import("zod").ZodString>;
                excerpt: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strict>;
            onBehalfOf: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"card">;
            telegramRef: import("zod").ZodString;
            onBehalfOf: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>], "action">;
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
                order: import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    pageLabel: import("zod").ZodNullable<import("zod").ZodString>;
                    platform: import("zod").ZodNullable<import("zod").ZodString>;
                    state: import("zod").ZodEnum<{
                        cancelled: "cancelled";
                        paid: "paid";
                        recorded: "recorded";
                        revision: "revision";
                        refused: "refused";
                        closed: "closed";
                        at_model: "at_model";
                        partly: "partly";
                        shot: "shot";
                        given: "given";
                    }>;
                    createdAt: import("zod").ZodString;
                    code: import("zod").ZodString;
                    origin: import("zod").ZodEnum<{
                        agent: "agent";
                        extension: "extension";
                        import: "import";
                        workboard: "workboard";
                    }>;
                    version: import("zod").ZodNumber;
                    updatedAt: import("zod").ZodString;
                    fan: import("zod").ZodNullable<import("zod").ZodObject<{
                        platform: import("zod").ZodString;
                        fanRef: import("zod").ZodString;
                        username: import("zod").ZodNullable<import("zod").ZodString>;
                        displayName: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    model: import("zod").ZodNullable<import("zod").ZodString>;
                    card: import("zod").ZodObject<{
                        date: import("zod").ZodOptional<import("zod").ZodString>;
                        name: import("zod").ZodOptional<import("zod").ZodString>;
                        price: import("zod").ZodOptional<import("zod").ZodString>;
                        duration: import("zod").ZodOptional<import("zod").ZodString>;
                        task: import("zod").ZodOptional<import("zod").ZodString>;
                        photos: import("zod").ZodOptional<import("zod").ZodString>;
                        clothes: import("zod").ZodOptional<import("zod").ZodString>;
                        face: import("zod").ZodOptional<import("zod").ZodString>;
                        notes: import("zod").ZodOptional<import("zod").ZodString>;
                        urgency: import("zod").ZodOptional<import("zod").ZodString>;
                        deadlineNote: import("zod").ZodOptional<import("zod").ZodString>;
                        attachments: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                        nameInVideo: import("zod").ZodOptional<import("zod").ZodEnum<{
                            unknown: "unknown";
                            yes: "yes";
                            no: "no";
                        }>>;
                        wantsVideo: import("zod").ZodOptional<import("zod").ZodBoolean>;
                        wantsPhotos: import("zod").ZodOptional<import("zod").ZodNumber>;
                    }, import("zod/v4/core").$strict>;
                    what: import("zod").ZodString;
                    stateAt: import("zod").ZodString;
                    buyer: import("zod").ZodNullable<import("zod").ZodString>;
                    fanErased: import("zod").ZodBoolean;
                    deadlineOn: import("zod").ZodNullable<import("zod").ZodString>;
                    stateNote: import("zod").ZodNullable<import("zod").ZodString>;
                    stateRef: import("zod").ZodNullable<import("zod").ZodString>;
                    payments: import("zod").ZodNumber;
                    givenAt: import("zod").ZodNullable<import("zod").ZodString>;
                    givenMessageRef: import("zod").ZodNullable<import("zod").ZodString>;
                    acceptedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    acceptedByName: import("zod").ZodNullable<import("zod").ZodString>;
                    telegramRefs: import("zod").ZodArray<import("zod").ZodString>;
                    contentopsRef: import("zod").ZodNullable<import("zod").ZodString>;
                    overdueDays: import("zod").ZodNullable<import("zod").ZodNumber>;
                    partsDone: import("zod").ZodArray<import("zod").ZodEnum<{
                        video: "video";
                        photos: "photos";
                    }>>;
                    openRevisions: import("zod").ZodNumber;
                    cardText: import("zod").ZodString;
                    sourceText: import("zod").ZodNullable<import("zod").ZodString>;
                    messages: import("zod").ZodArray<import("zod").ZodObject<{
                        telegramRef: import("zod").ZodNullable<import("zod").ZodString>;
                        eventRef: import("zod").ZodNullable<import("zod").ZodString>;
                        ordinal: import("zod").ZodNumber;
                        kind: import("zod").ZodEnum<{
                            note: "note";
                            revision: "revision";
                            delivery: "delivery";
                            repost: "repost";
                            confirmation: "confirmation";
                        }>;
                        part: import("zod").ZodNullable<import("zod").ZodEnum<{
                            video: "video";
                            photos: "photos";
                        }>>;
                        complete: import("zod").ZodNullable<import("zod").ZodBoolean>;
                        at: import("zod").ZodNullable<import("zod").ZodString>;
                        author: import("zod").ZodNullable<import("zod").ZodString>;
                        excerpt: import("zod").ZodNullable<import("zod").ZodString>;
                        doneAt: import("zod").ZodNullable<import("zod").ZodString>;
                        retractedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>;
                outcome: import("zod").ZodEnum<{
                    changed: "changed";
                    created: "created";
                    unchanged: "unchanged";
                }>;
                event: import("zod").ZodNullable<import("zod").ZodObject<{
                    ref: import("zod").ZodString;
                    result: import("zod").ZodEnum<{
                        stored: "stored";
                        already: "already";
                    }>;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentCustomCards: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Report the Telegram cards no order has: each becomes the lead's matter until a card is attached (needs write:customs)";
        readonly body: import("zod").ZodObject<{
            cards: import("zod").ZodArray<import("zod").ZodObject<{
                telegramRef: import("zod").ZodString;
                postedAt: import("zod").ZodOptional<import("zod").ZodString>;
                where: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strict>>;
            complete: import("zod").ZodDefault<import("zod").ZodBoolean>;
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
                matched: import("zod").ZodArray<import("zod").ZodObject<{
                    telegramRef: import("zod").ZodString;
                    code: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                opened: import("zod").ZodNumber;
                closed: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>;
        };
    };
};
