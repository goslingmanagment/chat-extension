import { z } from "zod";
export declare const pageFanWorkedWithResponseSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    messages: z.ZodNumber;
    authors: z.ZodArray<z.ZodObject<{
        userId: z.ZodNumber;
        username: z.ZodString;
        messages: z.ZodNumber;
        priced: z.ZodNumber;
        firstAt: z.ZodString;
        lastAt: z.ZodString;
        shifts: z.ZodNumber;
    }, z.core.$strip>>;
    shifts: z.ZodArray<z.ZodObject<{
        shiftId: z.ZodNullable<z.ZodNumber>;
        userId: z.ZodNumber;
        username: z.ZodString;
        startedAt: z.ZodString;
        endedAt: z.ZodString;
        messages: z.ZodNumber;
        priced: z.ZodNumber;
    }, z.core.$strip>>;
    shiftsTotal: z.ZodNumber;
}, z.core.$strip>;
export type PageFanWorkedWithResponse = z.infer<typeof pageFanWorkedWithResponseSchema>;
/** How many shifts the card lists. */
export declare const FAN_WORKED_WITH_SHIFTS_SHOWN = 20;
export declare const fanRouteSchemas: {
    readonly pageFanWorkedWith: {
        readonly auth: {
            readonly kind: "any-session";
            readonly scope: "page";
        };
        readonly tags: readonly ["fans"];
        readonly summary: "Кто с ним работал: who wrote to a fan on a page and in which shifts";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
            platformUserId: z.ZodString;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                pageLabel: z.ZodString;
                messages: z.ZodNumber;
                authors: z.ZodArray<z.ZodObject<{
                    userId: z.ZodNumber;
                    username: z.ZodString;
                    messages: z.ZodNumber;
                    priced: z.ZodNumber;
                    firstAt: z.ZodString;
                    lastAt: z.ZodString;
                    shifts: z.ZodNumber;
                }, z.core.$strip>>;
                shifts: z.ZodArray<z.ZodObject<{
                    shiftId: z.ZodNullable<z.ZodNumber>;
                    userId: z.ZodNumber;
                    username: z.ZodString;
                    startedAt: z.ZodString;
                    endedAt: z.ZodString;
                    messages: z.ZodNumber;
                    priced: z.ZodNumber;
                }, z.core.$strip>>;
                shiftsTotal: z.ZodNumber;
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
            readonly 404: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
};
