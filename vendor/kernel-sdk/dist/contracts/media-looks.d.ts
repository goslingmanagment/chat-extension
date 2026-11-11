import { z } from "zod";
/** The longest edge of a frame, in pixels: a frame is never larger. */
export declare const MEDIA_LOOK_FRAME_MAX_EDGE_PX = 512;
/** At most this many frames in one look (an 11×11 sheet holds 121). */
export declare const MEDIA_LOOK_FRAMES_MAX = 256;
/** The highest attachment index a look names (0-based, a post's files in order). */
export declare const MEDIA_LOOK_INDEX_MAX = 99;
/**
 * How much of the media the frames show — a sample, never the whole of a video:
 * - `per_second`: a video, one frame for each second (the platform's own sheet);
 * - `sampled`: a video, frames evenly spaced `frameIntervalMs` apart — what is
 *   between them is not seen;
 * - `cover_only`: a video, its cover alone (one picture of the platform's
 *   choosing) — the video itself is not seen;
 * - `whole_image`: a photo, all of it, downscaled;
 * - `first_frame`: an animated image (GIF), its first frame only.
 */
export declare const mediaLookCoverageSchema: z.ZodEnum<{
    per_second: "per_second";
    sampled: "sampled";
    cover_only: "cover_only";
    whole_image: "whole_image";
    first_frame: "first_frame";
}>;
/** `ready`: the frames are here; `queued`: the page's engine has not answered yet (its read of the post or
 *  the vault page, or the image) — read it again by its id;
 *  `failed`: no frames (`failure` says why). */
export declare const mediaLookStatusSchema: z.ZodEnum<{
    ready: "ready";
    failed: "failed";
    queued: "queued";
}>;
export declare const mediaLookFramesModeSchema: z.ZodEnum<{
    none: "none";
    inline: "inline";
}>;
export declare const mediaLookPageParamsSchema: z.ZodObject<{
    pageLabel: z.ZodString;
}, z.core.$strip>;
export declare const mediaLookParamsSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    lookId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const agentMediaLookCreateBodySchema: z.ZodObject<{
    publicationId: z.ZodOptional<z.ZodNumber>;
    postRef: z.ZodOptional<z.ZodString>;
    mediaRef: z.ZodOptional<z.ZodString>;
    index: z.ZodDefault<z.ZodNumber>;
    cover: z.ZodDefault<z.ZodBoolean>;
    fresh: z.ZodDefault<z.ZodBoolean>;
    frames: z.ZodDefault<z.ZodEnum<{
        none: "none";
        inline: "inline";
    }>>;
}, z.core.$strict>;
export declare const agentMediaLookGetQuerySchema: z.ZodObject<{
    frames: z.ZodDefault<z.ZodEnum<{
        none: "none";
        inline: "inline";
    }>>;
}, z.core.$strict>;
export declare const mediaLookFrameSchema: z.ZodObject<{
    index: z.ZodNumber;
    atMs: z.ZodNullable<z.ZodNumber>;
    width: z.ZodNumber;
    height: z.ZodNumber;
    jpegBase64: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const mediaLookSchema: z.ZodObject<{
    lookId: z.ZodNumber;
    status: z.ZodEnum<{
        ready: "ready";
        failed: "failed";
        queued: "queued";
    }>;
    failure: z.ZodNullable<z.ZodString>;
    target: z.ZodObject<{
        publicationId: z.ZodNullable<z.ZodNumber>;
        postRef: z.ZodNullable<z.ZodString>;
        index: z.ZodNullable<z.ZodNumber>;
        mediaRef: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    source: z.ZodEnum<{
        schedule_read: "schedule_read";
        post_read: "post_read";
        vault_read: "vault_read";
    }>;
    requestsSent: z.ZodNumber;
    media: z.ZodObject<{
        type: z.ZodNullable<z.ZodEnum<{
            image: "image";
            video: "video";
        }>>;
        durationMs: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    coverage: z.ZodNullable<z.ZodEnum<{
        per_second: "per_second";
        sampled: "sampled";
        cover_only: "cover_only";
        whole_image: "whole_image";
        first_frame: "first_frame";
    }>>;
    frameIntervalMs: z.ZodNullable<z.ZodNumber>;
    coverageNote: z.ZodNullable<z.ZodString>;
    frames: z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        atMs: z.ZodNullable<z.ZodNumber>;
        width: z.ZodNumber;
        height: z.ZodNumber;
        jpegBase64: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    cached: z.ZodBoolean;
    budget: z.ZodObject<{
        usedToday: z.ZodNumber;
        limit: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export type MediaLookCoverage = z.infer<typeof mediaLookCoverageSchema>;
export type MediaLookStatus = z.infer<typeof mediaLookStatusSchema>;
export type MediaLookFramesMode = z.infer<typeof mediaLookFramesModeSchema>;
export type AgentMediaLookCreateBody = z.infer<typeof agentMediaLookCreateBodySchema>;
export type MediaLookFrame = z.infer<typeof mediaLookFrameSchema>;
export type MediaLook = z.infer<typeof mediaLookSchema>;
