/**
 * Стирание фана, the ledger's side: the ledger keeps its own copies of what Hub served it (report lines and their
 * notes, «мимо площадки», the old decisions' and questions' words, its sales' payloads), which Hub's erasure cannot
 * reach. This feed serves, after a cursor, every fan erasure Hub has completed, with what the ledger needs to find its
 * rows — the platform and the fan's ref, exactly as Hub's tombstone (`erasure_log`) keeps them — and nothing more: no
 * name, no sale ids (Hub keeps no list of the erased fan's sales: the anonymized sales are not tied back to him, and a
 * list here would tie them again). The ledger finds his sales by the fan id its own sales carry, and blanks the words.
 */
import { z } from "zod";
export declare const agentErasuresFeedQuerySchema: z.ZodObject<{
    since: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const agentErasuresFeedItemSchema: z.ZodObject<{
    id: z.ZodNumber;
    platform: z.ZodEnum<{
        fansly: "fansly";
        onlyfans: "onlyfans";
    }>;
    fanRef: z.ZodString;
    erasedAt: z.ZodString;
}, z.core.$strip>;
export declare const agentErasuresFeedResponseSchema: z.ZodObject<{
    erasures: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        platform: z.ZodEnum<{
            fansly: "fansly";
            onlyfans: "onlyfans";
        }>;
        fanRef: z.ZodString;
        erasedAt: z.ZodString;
    }, z.core.$strip>>;
    next: z.ZodString;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type AgentErasuresFeedResponse = z.infer<typeof agentErasuresFeedResponseSchema>;
export type AgentErasuresFeedItem = z.infer<typeof agentErasuresFeedItemSchema>;
export declare const erasureRouteSchemas: {
    readonly agentErasuresFeed: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Every fan erasure Hub completed, after a cursor: the platform and the fan's ref, for the ledger to blank its own copies (needs read:team and read:money)";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            since: z.ZodOptional<z.ZodString>;
            limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        }, z.core.$strip>;
        readonly response: {
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
            readonly 404: z.ZodObject<{
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
            readonly 503: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 200: z.ZodObject<{
                erasures: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    platform: z.ZodEnum<{
                        fansly: "fansly";
                        onlyfans: "onlyfans";
                    }>;
                    fanRef: z.ZodString;
                    erasedAt: z.ZodString;
                }, z.core.$strip>>;
                next: z.ZodString;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
};
