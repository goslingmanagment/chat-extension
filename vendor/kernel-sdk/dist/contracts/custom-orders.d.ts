/**
 * Заказ кастома (ecosystem plan 2026-11-12, package I): one object from the
 * fan's chat to the fan's hands. It is born by Gengar's `/tz` (an agent key
 * with write:customs) or «Записать кастом» in the fan's panel (the existing
 * extension routes, served from these orders), the lead moves it on the board
 * «Кастомы» in Workboard, the reader of the models' groups writes what the model
 * did, a chatter marks «Отдали фану». Every door names the same order by its
 * code `K-<number>`, which the card text carries.
 */
import { z } from "zod";
export declare const CUSTOM_ORDER_STATES: readonly ["recorded", "paid", "at_model", "partly", "shot", "revision", "refused", "given", "closed", "cancelled"];
export type CustomOrderState = (typeof CUSTOM_ORDER_STATES)[number];
/** Still in work: neither given to the fan nor ended. */
export declare const CUSTOM_ORDER_OPEN_STATES: readonly CustomOrderState[];
/** Ended: nothing moves it any more but a person's «правка» after «отдали». */
export declare const CUSTOM_ORDER_FINAL_STATES: readonly CustomOrderState[];
export declare const CUSTOM_ORDER_ORIGINS: readonly ["extension", "agent", "workboard", "import"];
/**
 * The matters the custom checks keep (apps/runtime services/custom-orders/checks.ts), Hub's server the one
 * writer of each: an agent key opens or closes none of them.
 */
export declare const CUSTOM_ORDER_CHECK_KINDS: readonly ["custom.not_at_model", "custom.overdue", "custom.overdue_owner", "custom.shot_not_given", "custom.give_on_shift", "custom.unrecorded", "custom.card_without_order"];
export type CustomOrderCheckKind = (typeof CUSTOM_ORDER_CHECK_KINDS)[number];
export declare function isCustomOrderCheckKind(kind: string): kind is CustomOrderCheckKind;
/** `K-<number>`: what a person says and types, never one of ContentOps' `CUS-217`. */
export declare const CUSTOM_ORDER_CODE_PATTERN: RegExp;
export declare function customOrderCode(id: number): string;
/** The order's number from what a person typed: `K-123`, `к-123` (Cyrillic), `K123`, `#K-123`. Null — no code. */
export declare function parseCustomOrderCode(text: string): number | null;
export declare const customOrderCodeSchema: z.ZodString;
/**
 * A Telegram message, in ContentOps' form `tg:<chat>/<topic>/<message>` (chat
 * without `-100`). Pasted links and the other spellings are read by
 * `parseTelegramRef` (packages/contracts/src/custom-orders.ts).
 */
export declare const TELEGRAM_REF_PATTERN: RegExp;
/**
 * Any spelling of a Telegram message: `https://t.me/c/123/45/678`, `t.me/name/678`,
 * `tg:123/45/678`, `tg-123-45-678` (ContentOps' order address). Null — not a message link.
 */
export declare function parseTelegramRef(text: string): string | null;
export declare const telegramRefInputSchema: z.ZodString;
/**
 * The card «📦 Описание заказа» as the team writes it today, field by field: a
 * small document, every field optional (an empty one prints «-»).
 */
export declare const customOrderCardSchema: z.ZodObject<{
    date: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    price: z.ZodOptional<z.ZodString>;
    duration: z.ZodOptional<z.ZodString>;
    task: z.ZodOptional<z.ZodString>;
    photos: z.ZodOptional<z.ZodString>;
    clothes: z.ZodOptional<z.ZodString>;
    face: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
    urgency: z.ZodOptional<z.ZodString>;
    deadlineNote: z.ZodOptional<z.ZodString>;
    attachments: z.ZodOptional<z.ZodArray<z.ZodString>>;
    nameInVideo: z.ZodOptional<z.ZodEnum<{
        unknown: "unknown";
        yes: "yes";
        no: "no";
    }>>;
    wantsVideo: z.ZodOptional<z.ZodBoolean>;
    wantsPhotos: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export type CustomOrderCard = z.infer<typeof customOrderCardSchema>;
export declare const customOrderFanSchema: z.ZodObject<{
    platform: z.ZodString;
    fanRef: z.ZodString;
    username: z.ZodNullable<z.ZodString>;
    displayName: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** One order as every session door reads it. */
export declare const customOrderSchema: z.ZodObject<{
    id: z.ZodNumber;
    code: z.ZodString;
    pageLabel: z.ZodNullable<z.ZodString>;
    platform: z.ZodNullable<z.ZodString>;
    model: z.ZodNullable<z.ZodString>;
    fan: z.ZodNullable<z.ZodObject<{
        platform: z.ZodString;
        fanRef: z.ZodString;
        username: z.ZodNullable<z.ZodString>;
        displayName: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    buyer: z.ZodNullable<z.ZodString>;
    fanErased: z.ZodBoolean;
    card: z.ZodObject<{
        date: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        price: z.ZodOptional<z.ZodString>;
        duration: z.ZodOptional<z.ZodString>;
        task: z.ZodOptional<z.ZodString>;
        photos: z.ZodOptional<z.ZodString>;
        clothes: z.ZodOptional<z.ZodString>;
        face: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
        urgency: z.ZodOptional<z.ZodString>;
        deadlineNote: z.ZodOptional<z.ZodString>;
        attachments: z.ZodOptional<z.ZodArray<z.ZodString>>;
        nameInVideo: z.ZodOptional<z.ZodEnum<{
            unknown: "unknown";
            yes: "yes";
            no: "no";
        }>>;
        wantsVideo: z.ZodOptional<z.ZodBoolean>;
        wantsPhotos: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
    what: z.ZodString;
    deadlineOn: z.ZodNullable<z.ZodString>;
    state: z.ZodEnum<{
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
    stateAt: z.ZodString;
    stateNote: z.ZodNullable<z.ZodString>;
    stateRef: z.ZodNullable<z.ZodString>;
    paidGrossMills: z.ZodNumber;
    paidNetMills: z.ZodNumber;
    payments: z.ZodNumber;
    givenAt: z.ZodNullable<z.ZodString>;
    givenMessageRef: z.ZodNullable<z.ZodString>;
    acceptedBy: z.ZodNullable<z.ZodString>;
    acceptedByName: z.ZodNullable<z.ZodString>;
    telegramRefs: z.ZodArray<z.ZodString>;
    contentopsRef: z.ZodNullable<z.ZodString>;
    origin: z.ZodEnum<{
        agent: "agent";
        extension: "extension";
        import: "import";
        workboard: "workboard";
    }>;
    overdueDays: z.ZodNullable<z.ZodNumber>;
    partsDone: z.ZodArray<z.ZodEnum<{
        video: "video";
        photos: "photos";
    }>>;
    openRevisions: z.ZodNumber;
    version: z.ZodNumber;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type CustomOrder = z.infer<typeof customOrderSchema>;
export declare const CUSTOM_ORDER_MESSAGE_KINDS: readonly ["repost", "delivery", "revision", "confirmation", "note"];
/**
 * A significant message of the order: a Telegram message the reader of the models' groups records (known by its
 * link and ordinal), or an event of a sender with its own id of it (ContentOps' delivery, known by `eventRef`).
 */
export declare const customOrderMessageSchema: z.ZodObject<{
    telegramRef: z.ZodNullable<z.ZodString>;
    eventRef: z.ZodNullable<z.ZodString>;
    ordinal: z.ZodNumber;
    kind: z.ZodEnum<{
        note: "note";
        revision: "revision";
        delivery: "delivery";
        repost: "repost";
        confirmation: "confirmation";
    }>;
    part: z.ZodNullable<z.ZodEnum<{
        video: "video";
        photos: "photos";
    }>>;
    complete: z.ZodNullable<z.ZodBoolean>;
    at: z.ZodNullable<z.ZodString>;
    author: z.ZodNullable<z.ZodString>;
    excerpt: z.ZodNullable<z.ZodString>;
    doneAt: z.ZodNullable<z.ZodString>;
    retractedAt: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * An event's own id, as its sender keeps it: `<sender>:<kind>:<id>` (`contentops:delivery:7d0c…`), unique per
 * order. Never a Telegram link: a link is the event's evidence (`message.telegramRef`).
 */
export declare const CUSTOM_ORDER_EVENT_REF_PATTERN: RegExp;
export declare const customOrderEventRefSchema: z.ZodString;
/** A sale that looks like a custom with no order: a tier that includes one, or a tip whose note says so. */
export declare const customLookalikeSaleSchema: z.ZodObject<{
    transactionRef: z.ZodString;
    pageLabel: z.ZodString;
    fan: z.ZodNullable<z.ZodObject<{
        platform: z.ZodString;
        fanRef: z.ZodString;
        username: z.ZodNullable<z.ZodString>;
        displayName: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    kind: z.ZodEnum<{
        tier: "tier";
        tip_note: "tip_note";
    }>;
    detail: z.ZodNullable<z.ZodString>;
    grossMills: z.ZodNumber;
    at: z.ZodString;
}, z.core.$strip>;
export declare const CUSTOM_ORDER_ACTIONS: readonly ["edit", "deadline", "fan", "card", "payment", "unpay", "at_model", "partly", "shot", "revision", "refused", "given", "close", "cancel"];
export type CustomOrderAction = (typeof CUSTOM_ORDER_ACTIONS)[number];
export declare const customOrdersBoardQuerySchema: z.ZodObject<{
    pageLabel: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const customOrdersBoardResponseSchema: z.ZodObject<{
    viewer: z.ZodObject<{
        lead: z.ZodBoolean;
        owner: z.ZodBoolean;
    }, z.core.$strip>;
    leads: z.ZodArray<z.ZodString>;
    orders: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        code: z.ZodString;
        pageLabel: z.ZodNullable<z.ZodString>;
        platform: z.ZodNullable<z.ZodString>;
        model: z.ZodNullable<z.ZodString>;
        fan: z.ZodNullable<z.ZodObject<{
            platform: z.ZodString;
            fanRef: z.ZodString;
            username: z.ZodNullable<z.ZodString>;
            displayName: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        buyer: z.ZodNullable<z.ZodString>;
        fanErased: z.ZodBoolean;
        card: z.ZodObject<{
            date: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
            price: z.ZodOptional<z.ZodString>;
            duration: z.ZodOptional<z.ZodString>;
            task: z.ZodOptional<z.ZodString>;
            photos: z.ZodOptional<z.ZodString>;
            clothes: z.ZodOptional<z.ZodString>;
            face: z.ZodOptional<z.ZodString>;
            notes: z.ZodOptional<z.ZodString>;
            urgency: z.ZodOptional<z.ZodString>;
            deadlineNote: z.ZodOptional<z.ZodString>;
            attachments: z.ZodOptional<z.ZodArray<z.ZodString>>;
            nameInVideo: z.ZodOptional<z.ZodEnum<{
                unknown: "unknown";
                yes: "yes";
                no: "no";
            }>>;
            wantsVideo: z.ZodOptional<z.ZodBoolean>;
            wantsPhotos: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        what: z.ZodString;
        deadlineOn: z.ZodNullable<z.ZodString>;
        state: z.ZodEnum<{
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
        stateAt: z.ZodString;
        stateNote: z.ZodNullable<z.ZodString>;
        stateRef: z.ZodNullable<z.ZodString>;
        paidGrossMills: z.ZodNumber;
        paidNetMills: z.ZodNumber;
        payments: z.ZodNumber;
        givenAt: z.ZodNullable<z.ZodString>;
        givenMessageRef: z.ZodNullable<z.ZodString>;
        acceptedBy: z.ZodNullable<z.ZodString>;
        acceptedByName: z.ZodNullable<z.ZodString>;
        telegramRefs: z.ZodArray<z.ZodString>;
        contentopsRef: z.ZodNullable<z.ZodString>;
        origin: z.ZodEnum<{
            agent: "agent";
            extension: "extension";
            import: "import";
            workboard: "workboard";
        }>;
        overdueDays: z.ZodNullable<z.ZodNumber>;
        partsDone: z.ZodArray<z.ZodEnum<{
            video: "video";
            photos: "photos";
        }>>;
        openRevisions: z.ZodNumber;
        version: z.ZodNumber;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>>;
    capped: z.ZodBoolean;
    lookalikes: z.ZodArray<z.ZodObject<{
        transactionRef: z.ZodString;
        pageLabel: z.ZodString;
        fan: z.ZodNullable<z.ZodObject<{
            platform: z.ZodString;
            fanRef: z.ZodString;
            username: z.ZodNullable<z.ZodString>;
            displayName: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        kind: z.ZodEnum<{
            tier: "tier";
            tip_note: "tip_note";
        }>;
        detail: z.ZodNullable<z.ZodString>;
        grossMills: z.ZodNumber;
        at: z.ZodString;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const customOrderParamsSchema: z.ZodObject<{
    code: z.ZodString;
}, z.core.$strip>;
export declare const customOrderPaymentSchema: z.ZodObject<{
    transactionRef: z.ZodString;
    kind: z.ZodString;
    grossMills: z.ZodNumber;
    netMills: z.ZodNumber;
    at: z.ZodString;
    note: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const customOrderHistoryItemSchema: z.ZodObject<{
    at: z.ZodString;
    event: z.ZodString;
    actor: z.ZodNullable<z.ZodString>;
    onBehalfOf: z.ZodNullable<z.ZodString>;
    door: z.ZodString;
    changes: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, z.core.$strip>;
export declare const customOrderDetailResponseSchema: z.ZodObject<{
    order: z.ZodObject<{
        id: z.ZodNumber;
        code: z.ZodString;
        pageLabel: z.ZodNullable<z.ZodString>;
        platform: z.ZodNullable<z.ZodString>;
        model: z.ZodNullable<z.ZodString>;
        fan: z.ZodNullable<z.ZodObject<{
            platform: z.ZodString;
            fanRef: z.ZodString;
            username: z.ZodNullable<z.ZodString>;
            displayName: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        buyer: z.ZodNullable<z.ZodString>;
        fanErased: z.ZodBoolean;
        card: z.ZodObject<{
            date: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
            price: z.ZodOptional<z.ZodString>;
            duration: z.ZodOptional<z.ZodString>;
            task: z.ZodOptional<z.ZodString>;
            photos: z.ZodOptional<z.ZodString>;
            clothes: z.ZodOptional<z.ZodString>;
            face: z.ZodOptional<z.ZodString>;
            notes: z.ZodOptional<z.ZodString>;
            urgency: z.ZodOptional<z.ZodString>;
            deadlineNote: z.ZodOptional<z.ZodString>;
            attachments: z.ZodOptional<z.ZodArray<z.ZodString>>;
            nameInVideo: z.ZodOptional<z.ZodEnum<{
                unknown: "unknown";
                yes: "yes";
                no: "no";
            }>>;
            wantsVideo: z.ZodOptional<z.ZodBoolean>;
            wantsPhotos: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        what: z.ZodString;
        deadlineOn: z.ZodNullable<z.ZodString>;
        state: z.ZodEnum<{
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
        stateAt: z.ZodString;
        stateNote: z.ZodNullable<z.ZodString>;
        stateRef: z.ZodNullable<z.ZodString>;
        paidGrossMills: z.ZodNumber;
        paidNetMills: z.ZodNumber;
        payments: z.ZodNumber;
        givenAt: z.ZodNullable<z.ZodString>;
        givenMessageRef: z.ZodNullable<z.ZodString>;
        acceptedBy: z.ZodNullable<z.ZodString>;
        acceptedByName: z.ZodNullable<z.ZodString>;
        telegramRefs: z.ZodArray<z.ZodString>;
        contentopsRef: z.ZodNullable<z.ZodString>;
        origin: z.ZodEnum<{
            agent: "agent";
            extension: "extension";
            import: "import";
            workboard: "workboard";
        }>;
        overdueDays: z.ZodNullable<z.ZodNumber>;
        partsDone: z.ZodArray<z.ZodEnum<{
            video: "video";
            photos: "photos";
        }>>;
        openRevisions: z.ZodNumber;
        version: z.ZodNumber;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>;
    cardText: z.ZodString;
    sourceText: z.ZodNullable<z.ZodString>;
    messages: z.ZodArray<z.ZodObject<{
        telegramRef: z.ZodNullable<z.ZodString>;
        eventRef: z.ZodNullable<z.ZodString>;
        ordinal: z.ZodNumber;
        kind: z.ZodEnum<{
            note: "note";
            revision: "revision";
            delivery: "delivery";
            repost: "repost";
            confirmation: "confirmation";
        }>;
        part: z.ZodNullable<z.ZodEnum<{
            video: "video";
            photos: "photos";
        }>>;
        complete: z.ZodNullable<z.ZodBoolean>;
        at: z.ZodNullable<z.ZodString>;
        author: z.ZodNullable<z.ZodString>;
        excerpt: z.ZodNullable<z.ZodString>;
        doneAt: z.ZodNullable<z.ZodString>;
        retractedAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    payments: z.ZodArray<z.ZodObject<{
        transactionRef: z.ZodString;
        kind: z.ZodString;
        grossMills: z.ZodNumber;
        netMills: z.ZodNumber;
        at: z.ZodString;
        note: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    paymentSuggestions: z.ZodArray<z.ZodObject<{
        transactionRef: z.ZodString;
        kind: z.ZodString;
        grossMills: z.ZodNumber;
        netMills: z.ZodNumber;
        at: z.ZodString;
        note: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    deliverySuggestions: z.ZodArray<z.ZodObject<{
        messageRef: z.ZodString;
        at: z.ZodString;
        mediaCount: z.ZodNumber;
        priceMills: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    history: z.ZodArray<z.ZodObject<{
        at: z.ZodString;
        event: z.ZodString;
        actor: z.ZodNullable<z.ZodString>;
        onBehalfOf: z.ZodNullable<z.ZodString>;
        door: z.ZodString;
        changes: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, z.core.$strip>>;
    actions: z.ZodArray<z.ZodEnum<{
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
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const customOrderActionBodySchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    action: z.ZodLiteral<"edit">;
    card: z.ZodObject<{
        date: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        price: z.ZodOptional<z.ZodString>;
        duration: z.ZodOptional<z.ZodString>;
        task: z.ZodOptional<z.ZodString>;
        photos: z.ZodOptional<z.ZodString>;
        clothes: z.ZodOptional<z.ZodString>;
        face: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
        urgency: z.ZodOptional<z.ZodString>;
        deadlineNote: z.ZodOptional<z.ZodString>;
        attachments: z.ZodOptional<z.ZodArray<z.ZodString>>;
        nameInVideo: z.ZodOptional<z.ZodEnum<{
            unknown: "unknown";
            yes: "yes";
            no: "no";
        }>>;
        wantsVideo: z.ZodOptional<z.ZodBoolean>;
        wantsPhotos: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"deadline">;
    deadlineOn: z.ZodNullable<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"fan">;
    pageLabel: z.ZodString;
    fan: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"card">;
    telegramRef: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"payment">;
    transactionRef: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"unpay">;
    transactionRef: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"at_model">;
    telegramRef: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"partly">;
    note: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"shot">;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"revision">;
    note: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"refused">;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"given">;
    messageRef: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"close">;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"cancel">;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strict>], "action">;
export type CustomOrderActionBody = z.infer<typeof customOrderActionBodySchema>;
/** «Записать кастом» on the board: from a sale that looks like a custom (its page and fan), or on a page for a fan. */
export declare const customOrderCreateBodySchema: z.ZodObject<{
    transactionRef: z.ZodOptional<z.ZodString>;
    pageLabel: z.ZodOptional<z.ZodString>;
    fan: z.ZodOptional<z.ZodString>;
    card: z.ZodObject<{
        date: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        price: z.ZodOptional<z.ZodString>;
        duration: z.ZodOptional<z.ZodString>;
        task: z.ZodOptional<z.ZodString>;
        photos: z.ZodOptional<z.ZodString>;
        clothes: z.ZodOptional<z.ZodString>;
        face: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
        urgency: z.ZodOptional<z.ZodString>;
        deadlineNote: z.ZodOptional<z.ZodString>;
        attachments: z.ZodOptional<z.ZodArray<z.ZodString>>;
        nameInVideo: z.ZodOptional<z.ZodEnum<{
            unknown: "unknown";
            yes: "yes";
            no: "no";
        }>>;
        wantsVideo: z.ZodOptional<z.ZodBoolean>;
        wantsPhotos: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
    telegramRef: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const customSaleParamsSchema: z.ZodObject<{
    transactionRef: z.ZodString;
}, z.core.$strip>;
export declare const customSaleDismissResponseSchema: z.ZodObject<{
    dismissed: z.ZodBoolean;
}, z.core.$strip>;
/** An order as an agent key reads it: no money but the card's own price line. */
export declare const agentCustomOrderSchema: z.ZodObject<{
    id: z.ZodNumber;
    pageLabel: z.ZodNullable<z.ZodString>;
    platform: z.ZodNullable<z.ZodString>;
    state: z.ZodEnum<{
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
    createdAt: z.ZodString;
    code: z.ZodString;
    origin: z.ZodEnum<{
        agent: "agent";
        extension: "extension";
        import: "import";
        workboard: "workboard";
    }>;
    version: z.ZodNumber;
    updatedAt: z.ZodString;
    fan: z.ZodNullable<z.ZodObject<{
        platform: z.ZodString;
        fanRef: z.ZodString;
        username: z.ZodNullable<z.ZodString>;
        displayName: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    model: z.ZodNullable<z.ZodString>;
    card: z.ZodObject<{
        date: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        price: z.ZodOptional<z.ZodString>;
        duration: z.ZodOptional<z.ZodString>;
        task: z.ZodOptional<z.ZodString>;
        photos: z.ZodOptional<z.ZodString>;
        clothes: z.ZodOptional<z.ZodString>;
        face: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
        urgency: z.ZodOptional<z.ZodString>;
        deadlineNote: z.ZodOptional<z.ZodString>;
        attachments: z.ZodOptional<z.ZodArray<z.ZodString>>;
        nameInVideo: z.ZodOptional<z.ZodEnum<{
            unknown: "unknown";
            yes: "yes";
            no: "no";
        }>>;
        wantsVideo: z.ZodOptional<z.ZodBoolean>;
        wantsPhotos: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
    what: z.ZodString;
    stateAt: z.ZodString;
    buyer: z.ZodNullable<z.ZodString>;
    fanErased: z.ZodBoolean;
    deadlineOn: z.ZodNullable<z.ZodString>;
    stateNote: z.ZodNullable<z.ZodString>;
    stateRef: z.ZodNullable<z.ZodString>;
    payments: z.ZodNumber;
    givenAt: z.ZodNullable<z.ZodString>;
    givenMessageRef: z.ZodNullable<z.ZodString>;
    acceptedBy: z.ZodNullable<z.ZodString>;
    acceptedByName: z.ZodNullable<z.ZodString>;
    telegramRefs: z.ZodArray<z.ZodString>;
    contentopsRef: z.ZodNullable<z.ZodString>;
    overdueDays: z.ZodNullable<z.ZodNumber>;
    partsDone: z.ZodArray<z.ZodEnum<{
        video: "video";
        photos: "photos";
    }>>;
    openRevisions: z.ZodNumber;
    cardText: z.ZodString;
    sourceText: z.ZodNullable<z.ZodString>;
    messages: z.ZodArray<z.ZodObject<{
        telegramRef: z.ZodNullable<z.ZodString>;
        eventRef: z.ZodNullable<z.ZodString>;
        ordinal: z.ZodNumber;
        kind: z.ZodEnum<{
            note: "note";
            revision: "revision";
            delivery: "delivery";
            repost: "repost";
            confirmation: "confirmation";
        }>;
        part: z.ZodNullable<z.ZodEnum<{
            video: "video";
            photos: "photos";
        }>>;
        complete: z.ZodNullable<z.ZodBoolean>;
        at: z.ZodNullable<z.ZodString>;
        author: z.ZodNullable<z.ZodString>;
        excerpt: z.ZodNullable<z.ZodString>;
        doneAt: z.ZodNullable<z.ZodString>;
        retractedAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const agentCustomOrdersQuerySchema: z.ZodObject<{
    state: z.ZodDefault<z.ZodEnum<{
        all: "all";
        open: "open";
    }>>;
    code: z.ZodOptional<z.ZodString>;
    telegramRef: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strict>;
export declare const agentCustomOrdersResponseSchema: z.ZodObject<{
    orders: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        pageLabel: z.ZodNullable<z.ZodString>;
        platform: z.ZodNullable<z.ZodString>;
        state: z.ZodEnum<{
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
        createdAt: z.ZodString;
        code: z.ZodString;
        origin: z.ZodEnum<{
            agent: "agent";
            extension: "extension";
            import: "import";
            workboard: "workboard";
        }>;
        version: z.ZodNumber;
        updatedAt: z.ZodString;
        fan: z.ZodNullable<z.ZodObject<{
            platform: z.ZodString;
            fanRef: z.ZodString;
            username: z.ZodNullable<z.ZodString>;
            displayName: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        model: z.ZodNullable<z.ZodString>;
        card: z.ZodObject<{
            date: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
            price: z.ZodOptional<z.ZodString>;
            duration: z.ZodOptional<z.ZodString>;
            task: z.ZodOptional<z.ZodString>;
            photos: z.ZodOptional<z.ZodString>;
            clothes: z.ZodOptional<z.ZodString>;
            face: z.ZodOptional<z.ZodString>;
            notes: z.ZodOptional<z.ZodString>;
            urgency: z.ZodOptional<z.ZodString>;
            deadlineNote: z.ZodOptional<z.ZodString>;
            attachments: z.ZodOptional<z.ZodArray<z.ZodString>>;
            nameInVideo: z.ZodOptional<z.ZodEnum<{
                unknown: "unknown";
                yes: "yes";
                no: "no";
            }>>;
            wantsVideo: z.ZodOptional<z.ZodBoolean>;
            wantsPhotos: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        what: z.ZodString;
        stateAt: z.ZodString;
        buyer: z.ZodNullable<z.ZodString>;
        fanErased: z.ZodBoolean;
        deadlineOn: z.ZodNullable<z.ZodString>;
        stateNote: z.ZodNullable<z.ZodString>;
        stateRef: z.ZodNullable<z.ZodString>;
        payments: z.ZodNumber;
        givenAt: z.ZodNullable<z.ZodString>;
        givenMessageRef: z.ZodNullable<z.ZodString>;
        acceptedBy: z.ZodNullable<z.ZodString>;
        acceptedByName: z.ZodNullable<z.ZodString>;
        telegramRefs: z.ZodArray<z.ZodString>;
        contentopsRef: z.ZodNullable<z.ZodString>;
        overdueDays: z.ZodNullable<z.ZodNumber>;
        partsDone: z.ZodArray<z.ZodEnum<{
            video: "video";
            photos: "photos";
        }>>;
        openRevisions: z.ZodNumber;
        cardText: z.ZodString;
        sourceText: z.ZodNullable<z.ZodString>;
        messages: z.ZodArray<z.ZodObject<{
            telegramRef: z.ZodNullable<z.ZodString>;
            eventRef: z.ZodNullable<z.ZodString>;
            ordinal: z.ZodNumber;
            kind: z.ZodEnum<{
                note: "note";
                revision: "revision";
                delivery: "delivery";
                repost: "repost";
                confirmation: "confirmation";
            }>;
            part: z.ZodNullable<z.ZodEnum<{
                video: "video";
                photos: "photos";
            }>>;
            complete: z.ZodNullable<z.ZodBoolean>;
            at: z.ZodNullable<z.ZodString>;
            author: z.ZodNullable<z.ZodString>;
            excerpt: z.ZodNullable<z.ZodString>;
            doneAt: z.ZodNullable<z.ZodString>;
            retractedAt: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const agentCustomOrderCreateBodySchema: z.ZodObject<{
    pageLabel: z.ZodOptional<z.ZodString>;
    fan: z.ZodOptional<z.ZodString>;
    acceptedBy: z.ZodOptional<z.ZodString>;
    card: z.ZodObject<{
        date: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        price: z.ZodOptional<z.ZodString>;
        duration: z.ZodOptional<z.ZodString>;
        task: z.ZodOptional<z.ZodString>;
        photos: z.ZodOptional<z.ZodString>;
        clothes: z.ZodOptional<z.ZodString>;
        face: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
        urgency: z.ZodOptional<z.ZodString>;
        deadlineNote: z.ZodOptional<z.ZodString>;
        attachments: z.ZodOptional<z.ZodArray<z.ZodString>>;
        nameInVideo: z.ZodOptional<z.ZodEnum<{
            unknown: "unknown";
            yes: "yes";
            no: "no";
        }>>;
        wantsVideo: z.ZodOptional<z.ZodBoolean>;
        wantsPhotos: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
    deadlineOn: z.ZodOptional<z.ZodString>;
    telegramRef: z.ZodOptional<z.ZodString>;
    postedAt: z.ZodOptional<z.ZodISODateTime>;
    author: z.ZodOptional<z.ZodString>;
    sourceText: z.ZodOptional<z.ZodString>;
    another: z.ZodOptional<z.ZodBoolean>;
    onBehalfOf: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** Only the fields that changed: a value sets it, `null` empties it, an absent key stays as it is. */
export type CustomOrderCardPatch = {
    [K in keyof CustomOrderCard]?: Exclude<CustomOrderCard[K], undefined> | null;
};
export declare const agentCustomOrderUpdateBodySchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    action: z.ZodLiteral<"edit">;
    card: z.ZodType<CustomOrderCardPatch, unknown, z.core.$ZodTypeInternals<CustomOrderCardPatch, unknown>>;
    deadlineOn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    sourceText: z.ZodOptional<z.ZodString>;
    ifVersion: z.ZodOptional<z.ZodNumber>;
    onBehalfOf: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"at_model">;
    telegramRef: z.ZodOptional<z.ZodString>;
    onBehalfOf: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"delivery">;
    eventRef: z.ZodOptional<z.ZodString>;
    message: z.ZodObject<{
        telegramRef: z.ZodOptional<z.ZodString>;
        at: z.ZodOptional<z.ZodISODateTime>;
        author: z.ZodOptional<z.ZodString>;
        excerpt: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    part: z.ZodOptional<z.ZodEnum<{
        video: "video";
        photos: "photos";
    }>>;
    complete: z.ZodDefault<z.ZodBoolean>;
    onBehalfOf: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"partly">;
    ref: z.ZodString;
    note: z.ZodOptional<z.ZodString>;
    onBehalfOf: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"shot">;
    ref: z.ZodString;
    onBehalfOf: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"revision">;
    eventRef: z.ZodOptional<z.ZodString>;
    message: z.ZodObject<{
        telegramRef: z.ZodOptional<z.ZodString>;
        at: z.ZodOptional<z.ZodISODateTime>;
        author: z.ZodOptional<z.ZodString>;
        excerpt: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    ordinal: z.ZodDefault<z.ZodNumber>;
    text: z.ZodString;
    onBehalfOf: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"revision_done">;
    telegramRef: z.ZodOptional<z.ZodString>;
    eventRef: z.ZodOptional<z.ZodString>;
    ordinal: z.ZodDefault<z.ZodNumber>;
    onBehalfOf: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"retract">;
    eventRef: z.ZodString;
    retracts: z.ZodString;
    reason: z.ZodString;
    message: z.ZodOptional<z.ZodObject<{
        telegramRef: z.ZodOptional<z.ZodString>;
        at: z.ZodOptional<z.ZodISODateTime>;
        author: z.ZodOptional<z.ZodString>;
        excerpt: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    onBehalfOf: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"refused">;
    ref: z.ZodString;
    reason: z.ZodString;
    onBehalfOf: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"cancel">;
    reason: z.ZodString;
    onBehalfOf: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"message">;
    kind: z.ZodEnum<{
        note: "note";
        repost: "repost";
        confirmation: "confirmation";
    }>;
    eventRef: z.ZodOptional<z.ZodString>;
    message: z.ZodObject<{
        telegramRef: z.ZodOptional<z.ZodString>;
        at: z.ZodOptional<z.ZodISODateTime>;
        author: z.ZodOptional<z.ZodString>;
        excerpt: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    onBehalfOf: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"card">;
    telegramRef: z.ZodString;
    onBehalfOf: z.ZodOptional<z.ZodString>;
}, z.core.$strict>], "action">;
/** The event a message step names, and what the hub did with it. */
export declare const agentCustomOrderEventSchema: z.ZodObject<{
    ref: z.ZodString;
    result: z.ZodEnum<{
        stored: "stored";
        already: "already";
    }>;
}, z.core.$strip>;
export declare const agentCustomOrderResponseSchema: z.ZodObject<{
    order: z.ZodObject<{
        id: z.ZodNumber;
        pageLabel: z.ZodNullable<z.ZodString>;
        platform: z.ZodNullable<z.ZodString>;
        state: z.ZodEnum<{
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
        createdAt: z.ZodString;
        code: z.ZodString;
        origin: z.ZodEnum<{
            agent: "agent";
            extension: "extension";
            import: "import";
            workboard: "workboard";
        }>;
        version: z.ZodNumber;
        updatedAt: z.ZodString;
        fan: z.ZodNullable<z.ZodObject<{
            platform: z.ZodString;
            fanRef: z.ZodString;
            username: z.ZodNullable<z.ZodString>;
            displayName: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        model: z.ZodNullable<z.ZodString>;
        card: z.ZodObject<{
            date: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
            price: z.ZodOptional<z.ZodString>;
            duration: z.ZodOptional<z.ZodString>;
            task: z.ZodOptional<z.ZodString>;
            photos: z.ZodOptional<z.ZodString>;
            clothes: z.ZodOptional<z.ZodString>;
            face: z.ZodOptional<z.ZodString>;
            notes: z.ZodOptional<z.ZodString>;
            urgency: z.ZodOptional<z.ZodString>;
            deadlineNote: z.ZodOptional<z.ZodString>;
            attachments: z.ZodOptional<z.ZodArray<z.ZodString>>;
            nameInVideo: z.ZodOptional<z.ZodEnum<{
                unknown: "unknown";
                yes: "yes";
                no: "no";
            }>>;
            wantsVideo: z.ZodOptional<z.ZodBoolean>;
            wantsPhotos: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        what: z.ZodString;
        stateAt: z.ZodString;
        buyer: z.ZodNullable<z.ZodString>;
        fanErased: z.ZodBoolean;
        deadlineOn: z.ZodNullable<z.ZodString>;
        stateNote: z.ZodNullable<z.ZodString>;
        stateRef: z.ZodNullable<z.ZodString>;
        payments: z.ZodNumber;
        givenAt: z.ZodNullable<z.ZodString>;
        givenMessageRef: z.ZodNullable<z.ZodString>;
        acceptedBy: z.ZodNullable<z.ZodString>;
        acceptedByName: z.ZodNullable<z.ZodString>;
        telegramRefs: z.ZodArray<z.ZodString>;
        contentopsRef: z.ZodNullable<z.ZodString>;
        overdueDays: z.ZodNullable<z.ZodNumber>;
        partsDone: z.ZodArray<z.ZodEnum<{
            video: "video";
            photos: "photos";
        }>>;
        openRevisions: z.ZodNumber;
        cardText: z.ZodString;
        sourceText: z.ZodNullable<z.ZodString>;
        messages: z.ZodArray<z.ZodObject<{
            telegramRef: z.ZodNullable<z.ZodString>;
            eventRef: z.ZodNullable<z.ZodString>;
            ordinal: z.ZodNumber;
            kind: z.ZodEnum<{
                note: "note";
                revision: "revision";
                delivery: "delivery";
                repost: "repost";
                confirmation: "confirmation";
            }>;
            part: z.ZodNullable<z.ZodEnum<{
                video: "video";
                photos: "photos";
            }>>;
            complete: z.ZodNullable<z.ZodBoolean>;
            at: z.ZodNullable<z.ZodString>;
            author: z.ZodNullable<z.ZodString>;
            excerpt: z.ZodNullable<z.ZodString>;
            doneAt: z.ZodNullable<z.ZodString>;
            retractedAt: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    outcome: z.ZodEnum<{
        changed: "changed";
        created: "created";
        unchanged: "unchanged";
    }>;
    event: z.ZodNullable<z.ZodObject<{
        ref: z.ZodString;
        result: z.ZodEnum<{
            stored: "stored";
            already: "already";
        }>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** The reader of the models' groups: the cards it found that no order has, for the lead. */
export declare const agentCustomCardsBodySchema: z.ZodObject<{
    cards: z.ZodArray<z.ZodObject<{
        telegramRef: z.ZodString;
        postedAt: z.ZodOptional<z.ZodString>;
        where: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    complete: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
export declare const agentCustomCardsResponseSchema: z.ZodObject<{
    matched: z.ZodArray<z.ZodObject<{
        telegramRef: z.ZodString;
        code: z.ZodString;
    }, z.core.$strip>>;
    opened: z.ZodNumber;
    closed: z.ZodNumber;
}, z.core.$strip>;
export type CustomOrdersBoardResponse = z.infer<typeof customOrdersBoardResponseSchema>;
export type CustomOrderDetailResponse = z.infer<typeof customOrderDetailResponseSchema>;
export type CustomOrderCreateBody = z.infer<typeof customOrderCreateBodySchema>;
export type CustomLookalikeSale = z.infer<typeof customLookalikeSaleSchema>;
export type CustomOrderPayment = z.infer<typeof customOrderPaymentSchema>;
export type CustomOrderMessage = z.infer<typeof customOrderMessageSchema>;
export type AgentCustomOrder = z.infer<typeof agentCustomOrderSchema>;
export type AgentCustomOrdersQuery = z.infer<typeof agentCustomOrdersQuerySchema>;
export type AgentCustomOrderCreateBody = z.infer<typeof agentCustomOrderCreateBodySchema>;
export type AgentCustomOrderUpdateBody = z.infer<typeof agentCustomOrderUpdateBodySchema>;
export type AgentCustomCardsBody = z.infer<typeof agentCustomCardsBodySchema>;
