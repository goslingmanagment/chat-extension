import { z } from "zod";
/**
 * «Начало» (ecosystem plan 2026-11-12, §5 «Новый чаттер», package J): a new
 * chatter's way from the invitation to the first shift, as Hub sees it. Every
 * step closes by itself when its fact appears — nobody ticks anything:
 *
 * - `install`   — the extension is installed: seen when it signs in (Hub cannot see an install alone);
 * - `extension` — the extension signed in: a device sign-in of one of the person's logins;
 * - `pages`     — a page is opened to the person's login (the owner assigns it);
 * - `activity`  — the first active minute on a page in the extension (the platform account's access is the owner's);
 * - `payout`    — the person wrote where their payouts go.
 *
 * The path is a newcomer's: a human chatter of the people registry who is not
 * working yet (state invited or set up) and holds a login. The person reads it
 * on Workboard's «Начало», the owner on the person's card («Ввод: 3 из 5»).
 * Where payouts go is money-adjacent: the person's own session and the owner's
 * only, never a team lead's, another chatter's, or an agent key's.
 */
export declare const PERSON_START_STEPS: readonly ["install", "extension", "pages", "activity", "payout"];
export type PersonStartStepId = (typeof PERSON_START_STEPS)[number];
/** How long a newcomer stays on one step before the owner gets a matter. */
export declare const PERSON_START_STUCK_HOURS = 48;
/** Where payouts go: one free text, at most this long. */
export declare const PAYOUT_DETAILS_MAX_LENGTH = 500;
export declare const personStartStepEnum: z.ZodEnum<{
    pages: "pages";
    install: "install";
    extension: "extension";
    activity: "activity";
    payout: "payout";
}>;
export declare const personStartStepSchema: z.ZodObject<{
    step: z.ZodEnum<{
        pages: "pages";
        install: "install";
        extension: "extension";
        activity: "activity";
        payout: "payout";
    }>;
    done: z.ZodBoolean;
    doneAt: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const personStartSchema: z.ZodObject<{
    newcomer: z.ZodBoolean;
    signedUp: z.ZodBoolean;
    steps: z.ZodArray<z.ZodObject<{
        step: z.ZodEnum<{
            pages: "pages";
            install: "install";
            extension: "extension";
            activity: "activity";
            payout: "payout";
        }>;
        done: z.ZodBoolean;
        doneAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    done: z.ZodNumber;
    total: z.ZodNumber;
    current: z.ZodNullable<z.ZodEnum<{
        pages: "pages";
        install: "install";
        extension: "extension";
        activity: "activity";
        payout: "payout";
    }>>;
    since: z.ZodNullable<z.ZodString>;
    stuck: z.ZodBoolean;
    extension: z.ZodNullable<z.ZodObject<{
        label: z.ZodString;
        signedInAt: z.ZodString;
        active: z.ZodBoolean;
    }, z.core.$strip>>;
    pages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        platform: z.ZodEnum<{
            fansly: "fansly";
            onlyfans: "onlyfans";
            telegram: "telegram";
        }>;
        modelName: z.ZodString;
    }, z.core.$strip>>;
    firstActivity: z.ZodNullable<z.ZodObject<{
        at: z.ZodString;
        pageLabel: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** Where the person's payouts go, as they wrote it; null — not written. */
export declare const payoutDetailsSchema: z.ZodNullable<z.ZodObject<{
    text: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>>;
export declare const accountStartResponseSchema: z.ZodObject<{
    person: z.ZodNullable<z.ZodObject<{
        code: z.ZodString;
        displayName: z.ZodString;
    }, z.core.$strip>>;
    username: z.ZodString;
    start: z.ZodNullable<z.ZodObject<{
        newcomer: z.ZodBoolean;
        signedUp: z.ZodBoolean;
        steps: z.ZodArray<z.ZodObject<{
            step: z.ZodEnum<{
                pages: "pages";
                install: "install";
                extension: "extension";
                activity: "activity";
                payout: "payout";
            }>;
            done: z.ZodBoolean;
            doneAt: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        done: z.ZodNumber;
        total: z.ZodNumber;
        current: z.ZodNullable<z.ZodEnum<{
            pages: "pages";
            install: "install";
            extension: "extension";
            activity: "activity";
            payout: "payout";
        }>>;
        since: z.ZodNullable<z.ZodString>;
        stuck: z.ZodBoolean;
        extension: z.ZodNullable<z.ZodObject<{
            label: z.ZodString;
            signedInAt: z.ZodString;
            active: z.ZodBoolean;
        }, z.core.$strip>>;
        pages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            platform: z.ZodEnum<{
                fansly: "fansly";
                onlyfans: "onlyfans";
                telegram: "telegram";
            }>;
            modelName: z.ZodString;
        }, z.core.$strip>>;
        firstActivity: z.ZodNullable<z.ZodObject<{
            at: z.ZodString;
            pageLabel: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    payoutDetails: z.ZodNullable<z.ZodObject<{
        text: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>>;
    submitsShift: z.ZodBoolean;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const accountPayoutDetailsBodySchema: z.ZodObject<{
    text: z.ZodString;
}, z.core.$strict>;
export declare const accountPayoutDetailsResponseSchema: z.ZodObject<{
    payoutDetails: z.ZodNullable<z.ZodObject<{
        text: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PersonStart = z.infer<typeof personStartSchema>;
export type PersonStartStep = z.infer<typeof personStartStepSchema>;
export type PayoutDetails = z.infer<typeof payoutDetailsSchema>;
export type AccountStartResponse = z.infer<typeof accountStartResponseSchema>;
export type AccountPayoutDetailsBody = z.infer<typeof accountPayoutDetailsBodySchema>;
export type AccountPayoutDetailsResponse = z.infer<typeof accountPayoutDetailsResponseSchema>;
