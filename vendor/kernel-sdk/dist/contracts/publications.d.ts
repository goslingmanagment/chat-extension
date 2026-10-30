import { z } from "zod";
export declare const publicationKindSchema: z.ZodEnum<{
    story: "story";
    fyp_post: "fyp_post";
    subscriber_post: "subscriber_post";
    paid_post: "paid_post";
    vault_album: "vault_album";
}>;
export declare const publicationStatusSchema: z.ZodEnum<{
    unknown: "unknown";
    cancelled: "cancelled";
    scheduled: "scheduled";
    draft: "draft";
    approved: "approved";
    submitting: "submitting";
    processing: "processing";
    published: "published";
    not_published: "not_published";
    rejected: "rejected";
    missed: "missed";
    withdrawn: "withdrawn";
}>;
/** A file of the page's vault (the platform's media id) or one uploaded to Hub. */
export declare const publicationMediaInputSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    source: z.ZodLiteral<"vault">;
    mediaRef: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    source: z.ZodLiteral<"file">;
    fileId: z.ZodNumber;
}, z.core.$strict>], "source">;
/**
 * An extra attachment of a Fansly post, after the post's own (the contract
 * §12.2: one per "Upload" window, each with its own audience): `everyone`;
 * `subscribers` (of `tierRefs`, or of every tier; with `priceMills`, anyone
 * else buys it); `paid` (`priceMills`; only subscribers buy it with
 * `subscribersOnly`, of `tierRefs` or of every tier). Previews belong to one
 * with a price, `previews[i]` to `media[i]`.
 */
export declare const publicationExtraAttachmentInputSchema: z.ZodObject<{
    access: z.ZodEnum<{
        subscribers: "subscribers";
        everyone: "everyone";
        paid: "paid";
    }>;
    media: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        source: z.ZodLiteral<"vault">;
        mediaRef: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        source: z.ZodLiteral<"file">;
        fileId: z.ZodNumber;
    }, z.core.$strict>], "source">>;
    previews: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        source: z.ZodLiteral<"vault">;
        mediaRef: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        source: z.ZodLiteral<"file">;
        fileId: z.ZodNumber;
    }, z.core.$strict>], "source">>>;
    tierRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    priceMills: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    subscribersOnly: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
/**
 * What a draft says. Kind decides the rest: a vault album (Fansly) is its title
 * in `text` and its files in order, up to PUBLICATION_VAULT_ALBUM_MEDIA_MAX,
 * nothing else; a post has at most PUBLICATION_MEDIA_MAX; a story is one file; previews and a
 * price are a paid post's, or a Fansly subscriber post's that anyone else may
 * buy (its subscribers see it free); FYP, walls, pins, reply locks and tiers
 * exist on Fansly only, and a Fansly paid post may be for subscribers only. An empty
 * `wallRefs` on Fansly means the page's default wall, resolved when the draft
 * is saved so the approval freezes it.
 */
export declare const publicationContentSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        story: "story";
        fyp_post: "fyp_post";
        subscriber_post: "subscriber_post";
        paid_post: "paid_post";
        vault_album: "vault_album";
    }>;
    text: z.ZodDefault<z.ZodString>;
    media: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        source: z.ZodLiteral<"vault">;
        mediaRef: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        source: z.ZodLiteral<"file">;
        fileId: z.ZodNumber;
    }, z.core.$strict>], "source">>;
    previews: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        source: z.ZodLiteral<"vault">;
        mediaRef: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        source: z.ZodLiteral<"file">;
        fileId: z.ZodNumber;
    }, z.core.$strict>], "source">>>;
    publishAt: z.ZodISODateTime;
    expiresAt: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    wallRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    tierRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    priceMills: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    repost: z.ZodDefault<z.ZodBoolean>;
    pinWallRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    replyLock: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        subscribers: "subscribers";
        followers: "followers";
    }>>>;
    subscribersOnly: z.ZodDefault<z.ZodBoolean>;
    extraAttachments: z.ZodDefault<z.ZodArray<z.ZodObject<{
        access: z.ZodEnum<{
            subscribers: "subscribers";
            everyone: "everyone";
            paid: "paid";
        }>;
        media: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            source: z.ZodLiteral<"vault">;
            mediaRef: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            source: z.ZodLiteral<"file">;
            fileId: z.ZodNumber;
        }, z.core.$strict>], "source">>;
        previews: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            source: z.ZodLiteral<"vault">;
            mediaRef: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            source: z.ZodLiteral<"file">;
            fileId: z.ZodNumber;
        }, z.core.$strict>], "source">>>;
        tierRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
        priceMills: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        subscribersOnly: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export type PublicationContentBody = z.infer<typeof publicationContentSchema>;
export declare const publicationCreateBodySchema: z.ZodObject<{
    kind: z.ZodEnum<{
        story: "story";
        fyp_post: "fyp_post";
        subscriber_post: "subscriber_post";
        paid_post: "paid_post";
        vault_album: "vault_album";
    }>;
    text: z.ZodDefault<z.ZodString>;
    media: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        source: z.ZodLiteral<"vault">;
        mediaRef: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        source: z.ZodLiteral<"file">;
        fileId: z.ZodNumber;
    }, z.core.$strict>], "source">>;
    previews: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        source: z.ZodLiteral<"vault">;
        mediaRef: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        source: z.ZodLiteral<"file">;
        fileId: z.ZodNumber;
    }, z.core.$strict>], "source">>>;
    publishAt: z.ZodISODateTime;
    expiresAt: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    wallRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    tierRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    priceMills: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    repost: z.ZodDefault<z.ZodBoolean>;
    pinWallRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    replyLock: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        subscribers: "subscribers";
        followers: "followers";
    }>>>;
    subscribersOnly: z.ZodDefault<z.ZodBoolean>;
    extraAttachments: z.ZodDefault<z.ZodArray<z.ZodObject<{
        access: z.ZodEnum<{
            subscribers: "subscribers";
            everyone: "everyone";
            paid: "paid";
        }>;
        media: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            source: z.ZodLiteral<"vault">;
            mediaRef: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            source: z.ZodLiteral<"file">;
            fileId: z.ZodNumber;
        }, z.core.$strict>], "source">>;
        previews: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            source: z.ZodLiteral<"vault">;
            mediaRef: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            source: z.ZodLiteral<"file">;
            fileId: z.ZodNumber;
        }, z.core.$strict>], "source">>>;
        tierRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
        priceMills: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        subscribersOnly: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>>;
    pageLabel: z.ZodString;
}, z.core.$strict>;
export type PublicationCreateBody = z.infer<typeof publicationCreateBodySchema>;
export declare const publicationUpdateBodySchema: z.ZodObject<{
    kind: z.ZodEnum<{
        story: "story";
        fyp_post: "fyp_post";
        subscriber_post: "subscriber_post";
        paid_post: "paid_post";
        vault_album: "vault_album";
    }>;
    text: z.ZodDefault<z.ZodString>;
    media: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        source: z.ZodLiteral<"vault">;
        mediaRef: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        source: z.ZodLiteral<"file">;
        fileId: z.ZodNumber;
    }, z.core.$strict>], "source">>;
    previews: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        source: z.ZodLiteral<"vault">;
        mediaRef: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        source: z.ZodLiteral<"file">;
        fileId: z.ZodNumber;
    }, z.core.$strict>], "source">>>;
    publishAt: z.ZodISODateTime;
    expiresAt: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    wallRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    tierRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    priceMills: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    repost: z.ZodDefault<z.ZodBoolean>;
    pinWallRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    replyLock: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        subscribers: "subscribers";
        followers: "followers";
    }>>>;
    subscribersOnly: z.ZodDefault<z.ZodBoolean>;
    extraAttachments: z.ZodDefault<z.ZodArray<z.ZodObject<{
        access: z.ZodEnum<{
            subscribers: "subscribers";
            everyone: "everyone";
            paid: "paid";
        }>;
        media: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            source: z.ZodLiteral<"vault">;
            mediaRef: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            source: z.ZodLiteral<"file">;
            fileId: z.ZodNumber;
        }, z.core.$strict>], "source">>;
        previews: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            source: z.ZodLiteral<"vault">;
            mediaRef: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            source: z.ZodLiteral<"file">;
            fileId: z.ZodNumber;
        }, z.core.$strict>], "source">>>;
        tierRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
        priceMills: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        subscribersOnly: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>>;
    version: z.ZodNumber;
}, z.core.$strict>;
export type PublicationUpdateBody = z.infer<typeof publicationUpdateBodySchema>;
export declare const agentPublicationCreateBodySchema: z.ZodObject<{
    kind: z.ZodEnum<{
        story: "story";
        fyp_post: "fyp_post";
        subscriber_post: "subscriber_post";
        paid_post: "paid_post";
        vault_album: "vault_album";
    }>;
    text: z.ZodDefault<z.ZodString>;
    media: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        source: z.ZodLiteral<"vault">;
        mediaRef: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        source: z.ZodLiteral<"file">;
        fileId: z.ZodNumber;
    }, z.core.$strict>], "source">>;
    previews: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        source: z.ZodLiteral<"vault">;
        mediaRef: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        source: z.ZodLiteral<"file">;
        fileId: z.ZodNumber;
    }, z.core.$strict>], "source">>>;
    publishAt: z.ZodISODateTime;
    expiresAt: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    wallRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    tierRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    priceMills: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    repost: z.ZodDefault<z.ZodBoolean>;
    pinWallRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    replyLock: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        subscribers: "subscribers";
        followers: "followers";
    }>>>;
    subscribersOnly: z.ZodDefault<z.ZodBoolean>;
    extraAttachments: z.ZodDefault<z.ZodArray<z.ZodObject<{
        access: z.ZodEnum<{
            subscribers: "subscribers";
            everyone: "everyone";
            paid: "paid";
        }>;
        media: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            source: z.ZodLiteral<"vault">;
            mediaRef: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            source: z.ZodLiteral<"file">;
            fileId: z.ZodNumber;
        }, z.core.$strict>], "source">>;
        previews: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            source: z.ZodLiteral<"vault">;
            mediaRef: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            source: z.ZodLiteral<"file">;
            fileId: z.ZodNumber;
        }, z.core.$strict>], "source">>>;
        tierRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
        priceMills: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        subscribersOnly: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>>;
    idempotencyKey: z.ZodString;
}, z.core.$strict>;
export type AgentPublicationCreateBody = z.infer<typeof agentPublicationCreateBodySchema>;
export declare const publicationFindingSchema: z.ZodObject<{
    code: z.ZodEnum<{
        publish_time_past: "publish_time_past";
        file_of_another_model: "file_of_another_model";
        file_deleted: "file_deleted";
        media_not_on_page: "media_not_on_page";
        repost_within_threshold: "repost_within_threshold";
        posted_before: "posted_before";
        price_range_not_set: "price_range_not_set";
        price_out_of_range: "price_out_of_range";
        paid_post_off_on_onlyfans: "paid_post_off_on_onlyfans";
        volume_high: "volume_high";
        daily_limit_exceeded: "daily_limit_exceeded";
        wall_not_on_page: "wall_not_on_page";
        wall_default_unknown: "wall_default_unknown";
        tier_not_on_page: "tier_not_on_page";
        onlyfans_file_upload_unsupported: "onlyfans_file_upload_unsupported";
        onlyfans_file_too_large: "onlyfans_file_too_large";
        fansly_file_upload_unsupported: "fansly_file_upload_unsupported";
        fansly_several_tiers_unsupported: "fansly_several_tiers_unsupported";
        platform_schedule_incomplete: "platform_schedule_incomplete";
    }>;
    severity: z.ZodEnum<{
        info: "info";
        blocking: "blocking";
        warning: "warning";
    }>;
    mediaKey: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    at: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    postRef: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    publicationId: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    detail: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodNumber, z.ZodString, z.ZodNull]>>>;
}, z.core.$strip>;
export type PublicationFinding = z.infer<typeof publicationFindingSchema>;
export declare const publicationMediaSchema: z.ZodObject<{
    role: z.ZodEnum<{
        media: "media";
        preview: "preview";
    }>;
    position: z.ZodNumber;
    source: z.ZodEnum<{
        file: "file";
        vault: "vault";
    }>;
    mediaRef: z.ZodNullable<z.ZodString>;
    fileId: z.ZodNullable<z.ZodNumber>;
    attachment: z.ZodNumber;
}, z.core.$strip>;
export declare const publicationExtraAttachmentSchema: z.ZodObject<{
    attachment: z.ZodNumber;
    access: z.ZodEnum<{
        subscribers: "subscribers";
        everyone: "everyone";
        paid: "paid";
    }>;
    tierRefs: z.ZodArray<z.ZodString>;
    priceMills: z.ZodNullable<z.ZodNumber>;
    subscribersOnly: z.ZodBoolean;
}, z.core.$strip>;
export declare const publicationSchema: z.ZodObject<{
    id: z.ZodNumber;
    pageLabel: z.ZodString;
    platform: z.ZodEnum<{
        fansly: "fansly";
        onlyfans: "onlyfans";
        telegram: "telegram";
    }>;
    kind: z.ZodEnum<{
        story: "story";
        fyp_post: "fyp_post";
        subscriber_post: "subscriber_post";
        paid_post: "paid_post";
        vault_album: "vault_album";
    }>;
    status: z.ZodEnum<{
        unknown: "unknown";
        cancelled: "cancelled";
        scheduled: "scheduled";
        draft: "draft";
        approved: "approved";
        submitting: "submitting";
        processing: "processing";
        published: "published";
        not_published: "not_published";
        rejected: "rejected";
        missed: "missed";
        withdrawn: "withdrawn";
    }>;
    version: z.ZodNumber;
    text: z.ZodString;
    publishAt: z.ZodString;
    expiresAt: z.ZodNullable<z.ZodString>;
    wallRefs: z.ZodArray<z.ZodString>;
    tierRefs: z.ZodArray<z.ZodString>;
    priceMills: z.ZodNullable<z.ZodNumber>;
    repost: z.ZodBoolean;
    pinWallRefs: z.ZodArray<z.ZodString>;
    replyLock: z.ZodArray<z.ZodEnum<{
        subscribers: "subscribers";
        followers: "followers";
    }>>;
    subscribersOnly: z.ZodBoolean;
    extraAttachments: z.ZodArray<z.ZodObject<{
        attachment: z.ZodNumber;
        access: z.ZodEnum<{
            subscribers: "subscribers";
            everyone: "everyone";
            paid: "paid";
        }>;
        tierRefs: z.ZodArray<z.ZodString>;
        priceMills: z.ZodNullable<z.ZodNumber>;
        subscribersOnly: z.ZodBoolean;
    }, z.core.$strip>>;
    media: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<{
            media: "media";
            preview: "preview";
        }>;
        position: z.ZodNumber;
        source: z.ZodEnum<{
            file: "file";
            vault: "vault";
        }>;
        mediaRef: z.ZodNullable<z.ZodString>;
        fileId: z.ZodNullable<z.ZodNumber>;
        attachment: z.ZodNumber;
    }, z.core.$strip>>;
    findings: z.ZodArray<z.ZodObject<{
        code: z.ZodEnum<{
            publish_time_past: "publish_time_past";
            file_of_another_model: "file_of_another_model";
            file_deleted: "file_deleted";
            media_not_on_page: "media_not_on_page";
            repost_within_threshold: "repost_within_threshold";
            posted_before: "posted_before";
            price_range_not_set: "price_range_not_set";
            price_out_of_range: "price_out_of_range";
            paid_post_off_on_onlyfans: "paid_post_off_on_onlyfans";
            volume_high: "volume_high";
            daily_limit_exceeded: "daily_limit_exceeded";
            wall_not_on_page: "wall_not_on_page";
            wall_default_unknown: "wall_default_unknown";
            tier_not_on_page: "tier_not_on_page";
            onlyfans_file_upload_unsupported: "onlyfans_file_upload_unsupported";
            onlyfans_file_too_large: "onlyfans_file_too_large";
            fansly_file_upload_unsupported: "fansly_file_upload_unsupported";
            fansly_several_tiers_unsupported: "fansly_several_tiers_unsupported";
            platform_schedule_incomplete: "platform_schedule_incomplete";
        }>;
        severity: z.ZodEnum<{
            info: "info";
            blocking: "blocking";
            warning: "warning";
        }>;
        mediaKey: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        at: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        postRef: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        publicationId: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        detail: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodNumber, z.ZodString, z.ZodNull]>>>;
    }, z.core.$strip>>;
    blocked: z.ZodBoolean;
    author: z.ZodObject<{
        kind: z.ZodEnum<{
            human: "human";
            agent: "agent";
        }>;
        userId: z.ZodNullable<z.ZodNumber>;
        agentKeyId: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    approvedRevisionId: z.ZodNullable<z.ZodNumber>;
    platformPostRef: z.ZodNullable<z.ZodString>;
    vaultAlbumRef: z.ZodNullable<z.ZodString>;
    statusReason: z.ZodNullable<z.ZodString>;
    previousPublicationId: z.ZodNullable<z.ZodNumber>;
    withdrawal: z.ZodNullable<z.ZodObject<{
        state: z.ZodString;
        errorCode: z.ZodNullable<z.ZodString>;
        at: z.ZodString;
    }, z.core.$strip>>;
    deletion: z.ZodNullable<z.ZodObject<{
        state: z.ZodString;
        errorCode: z.ZodNullable<z.ZodString>;
        at: z.ZodString;
    }, z.core.$strip>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    statusChangedAt: z.ZodString;
}, z.core.$strip>;
export type PublicationWire = z.infer<typeof publicationSchema>;
export declare const publicationStatusEventSchema: z.ZodObject<{
    fromStatus: z.ZodNullable<z.ZodEnum<{
        unknown: "unknown";
        cancelled: "cancelled";
        scheduled: "scheduled";
        draft: "draft";
        approved: "approved";
        submitting: "submitting";
        processing: "processing";
        published: "published";
        not_published: "not_published";
        rejected: "rejected";
        missed: "missed";
        withdrawn: "withdrawn";
    }>>;
    toStatus: z.ZodEnum<{
        unknown: "unknown";
        cancelled: "cancelled";
        scheduled: "scheduled";
        draft: "draft";
        approved: "approved";
        submitting: "submitting";
        processing: "processing";
        published: "published";
        not_published: "not_published";
        rejected: "rejected";
        missed: "missed";
        withdrawn: "withdrawn";
    }>;
    actorKind: z.ZodEnum<{
        human: "human";
        agent: "agent";
        hub: "hub";
    }>;
    actorUserId: z.ZodNullable<z.ZodNumber>;
    actorAgentKeyId: z.ZodNullable<z.ZodNumber>;
    reason: z.ZodNullable<z.ZodString>;
    at: z.ZodString;
}, z.core.$strip>;
export declare const publicationDetailSchema: z.ZodObject<{
    id: z.ZodNumber;
    pageLabel: z.ZodString;
    platform: z.ZodEnum<{
        fansly: "fansly";
        onlyfans: "onlyfans";
        telegram: "telegram";
    }>;
    kind: z.ZodEnum<{
        story: "story";
        fyp_post: "fyp_post";
        subscriber_post: "subscriber_post";
        paid_post: "paid_post";
        vault_album: "vault_album";
    }>;
    status: z.ZodEnum<{
        unknown: "unknown";
        cancelled: "cancelled";
        scheduled: "scheduled";
        draft: "draft";
        approved: "approved";
        submitting: "submitting";
        processing: "processing";
        published: "published";
        not_published: "not_published";
        rejected: "rejected";
        missed: "missed";
        withdrawn: "withdrawn";
    }>;
    version: z.ZodNumber;
    text: z.ZodString;
    publishAt: z.ZodString;
    expiresAt: z.ZodNullable<z.ZodString>;
    wallRefs: z.ZodArray<z.ZodString>;
    tierRefs: z.ZodArray<z.ZodString>;
    priceMills: z.ZodNullable<z.ZodNumber>;
    repost: z.ZodBoolean;
    pinWallRefs: z.ZodArray<z.ZodString>;
    replyLock: z.ZodArray<z.ZodEnum<{
        subscribers: "subscribers";
        followers: "followers";
    }>>;
    subscribersOnly: z.ZodBoolean;
    extraAttachments: z.ZodArray<z.ZodObject<{
        attachment: z.ZodNumber;
        access: z.ZodEnum<{
            subscribers: "subscribers";
            everyone: "everyone";
            paid: "paid";
        }>;
        tierRefs: z.ZodArray<z.ZodString>;
        priceMills: z.ZodNullable<z.ZodNumber>;
        subscribersOnly: z.ZodBoolean;
    }, z.core.$strip>>;
    media: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<{
            media: "media";
            preview: "preview";
        }>;
        position: z.ZodNumber;
        source: z.ZodEnum<{
            file: "file";
            vault: "vault";
        }>;
        mediaRef: z.ZodNullable<z.ZodString>;
        fileId: z.ZodNullable<z.ZodNumber>;
        attachment: z.ZodNumber;
    }, z.core.$strip>>;
    findings: z.ZodArray<z.ZodObject<{
        code: z.ZodEnum<{
            publish_time_past: "publish_time_past";
            file_of_another_model: "file_of_another_model";
            file_deleted: "file_deleted";
            media_not_on_page: "media_not_on_page";
            repost_within_threshold: "repost_within_threshold";
            posted_before: "posted_before";
            price_range_not_set: "price_range_not_set";
            price_out_of_range: "price_out_of_range";
            paid_post_off_on_onlyfans: "paid_post_off_on_onlyfans";
            volume_high: "volume_high";
            daily_limit_exceeded: "daily_limit_exceeded";
            wall_not_on_page: "wall_not_on_page";
            wall_default_unknown: "wall_default_unknown";
            tier_not_on_page: "tier_not_on_page";
            onlyfans_file_upload_unsupported: "onlyfans_file_upload_unsupported";
            onlyfans_file_too_large: "onlyfans_file_too_large";
            fansly_file_upload_unsupported: "fansly_file_upload_unsupported";
            fansly_several_tiers_unsupported: "fansly_several_tiers_unsupported";
            platform_schedule_incomplete: "platform_schedule_incomplete";
        }>;
        severity: z.ZodEnum<{
            info: "info";
            blocking: "blocking";
            warning: "warning";
        }>;
        mediaKey: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        at: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        postRef: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        publicationId: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        detail: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodNumber, z.ZodString, z.ZodNull]>>>;
    }, z.core.$strip>>;
    blocked: z.ZodBoolean;
    author: z.ZodObject<{
        kind: z.ZodEnum<{
            human: "human";
            agent: "agent";
        }>;
        userId: z.ZodNullable<z.ZodNumber>;
        agentKeyId: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    approvedRevisionId: z.ZodNullable<z.ZodNumber>;
    platformPostRef: z.ZodNullable<z.ZodString>;
    vaultAlbumRef: z.ZodNullable<z.ZodString>;
    statusReason: z.ZodNullable<z.ZodString>;
    previousPublicationId: z.ZodNullable<z.ZodNumber>;
    withdrawal: z.ZodNullable<z.ZodObject<{
        state: z.ZodString;
        errorCode: z.ZodNullable<z.ZodString>;
        at: z.ZodString;
    }, z.core.$strip>>;
    deletion: z.ZodNullable<z.ZodObject<{
        state: z.ZodString;
        errorCode: z.ZodNullable<z.ZodString>;
        at: z.ZodString;
    }, z.core.$strip>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    statusChangedAt: z.ZodString;
    events: z.ZodArray<z.ZodObject<{
        fromStatus: z.ZodNullable<z.ZodEnum<{
            unknown: "unknown";
            cancelled: "cancelled";
            scheduled: "scheduled";
            draft: "draft";
            approved: "approved";
            submitting: "submitting";
            processing: "processing";
            published: "published";
            not_published: "not_published";
            rejected: "rejected";
            missed: "missed";
            withdrawn: "withdrawn";
        }>>;
        toStatus: z.ZodEnum<{
            unknown: "unknown";
            cancelled: "cancelled";
            scheduled: "scheduled";
            draft: "draft";
            approved: "approved";
            submitting: "submitting";
            processing: "processing";
            published: "published";
            not_published: "not_published";
            rejected: "rejected";
            missed: "missed";
            withdrawn: "withdrawn";
        }>;
        actorKind: z.ZodEnum<{
            human: "human";
            agent: "agent";
            hub: "hub";
        }>;
        actorUserId: z.ZodNullable<z.ZodNumber>;
        actorAgentKeyId: z.ZodNullable<z.ZodNumber>;
        reason: z.ZodNullable<z.ZodString>;
        at: z.ZodString;
    }, z.core.$strip>>;
    revision: z.ZodNullable<z.ZodObject<{
        id: z.ZodNumber;
        fingerprint: z.ZodString;
        approvedByUserId: z.ZodNumber;
        approvedAt: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PublicationDetail = z.infer<typeof publicationDetailSchema>;
export declare const publicationListQuerySchema: z.ZodObject<{
    pageLabel: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        unknown: "unknown";
        cancelled: "cancelled";
        scheduled: "scheduled";
        draft: "draft";
        approved: "approved";
        submitting: "submitting";
        processing: "processing";
        published: "published";
        not_published: "not_published";
        rejected: "rejected";
        missed: "missed";
        withdrawn: "withdrawn";
    }>>;
    from: z.ZodOptional<z.ZodISODateTime>;
    to: z.ZodOptional<z.ZodISODateTime>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const agentPublicationListQuerySchema: z.ZodObject<{
    from: z.ZodOptional<z.ZodISODateTime>;
    to: z.ZodOptional<z.ZodISODateTime>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    status: z.ZodOptional<z.ZodEnum<{
        unknown: "unknown";
        cancelled: "cancelled";
        scheduled: "scheduled";
        draft: "draft";
        approved: "approved";
        submitting: "submitting";
        processing: "processing";
        published: "published";
        not_published: "not_published";
        rejected: "rejected";
        missed: "missed";
        withdrawn: "withdrawn";
    }>>;
}, z.core.$strip>;
export declare const publicationListResponseSchema: z.ZodObject<{
    publications: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        pageLabel: z.ZodString;
        platform: z.ZodEnum<{
            fansly: "fansly";
            onlyfans: "onlyfans";
            telegram: "telegram";
        }>;
        kind: z.ZodEnum<{
            story: "story";
            fyp_post: "fyp_post";
            subscriber_post: "subscriber_post";
            paid_post: "paid_post";
            vault_album: "vault_album";
        }>;
        status: z.ZodEnum<{
            unknown: "unknown";
            cancelled: "cancelled";
            scheduled: "scheduled";
            draft: "draft";
            approved: "approved";
            submitting: "submitting";
            processing: "processing";
            published: "published";
            not_published: "not_published";
            rejected: "rejected";
            missed: "missed";
            withdrawn: "withdrawn";
        }>;
        version: z.ZodNumber;
        text: z.ZodString;
        publishAt: z.ZodString;
        expiresAt: z.ZodNullable<z.ZodString>;
        wallRefs: z.ZodArray<z.ZodString>;
        tierRefs: z.ZodArray<z.ZodString>;
        priceMills: z.ZodNullable<z.ZodNumber>;
        repost: z.ZodBoolean;
        pinWallRefs: z.ZodArray<z.ZodString>;
        replyLock: z.ZodArray<z.ZodEnum<{
            subscribers: "subscribers";
            followers: "followers";
        }>>;
        subscribersOnly: z.ZodBoolean;
        extraAttachments: z.ZodArray<z.ZodObject<{
            attachment: z.ZodNumber;
            access: z.ZodEnum<{
                subscribers: "subscribers";
                everyone: "everyone";
                paid: "paid";
            }>;
            tierRefs: z.ZodArray<z.ZodString>;
            priceMills: z.ZodNullable<z.ZodNumber>;
            subscribersOnly: z.ZodBoolean;
        }, z.core.$strip>>;
        media: z.ZodArray<z.ZodObject<{
            role: z.ZodEnum<{
                media: "media";
                preview: "preview";
            }>;
            position: z.ZodNumber;
            source: z.ZodEnum<{
                file: "file";
                vault: "vault";
            }>;
            mediaRef: z.ZodNullable<z.ZodString>;
            fileId: z.ZodNullable<z.ZodNumber>;
            attachment: z.ZodNumber;
        }, z.core.$strip>>;
        findings: z.ZodArray<z.ZodObject<{
            code: z.ZodEnum<{
                publish_time_past: "publish_time_past";
                file_of_another_model: "file_of_another_model";
                file_deleted: "file_deleted";
                media_not_on_page: "media_not_on_page";
                repost_within_threshold: "repost_within_threshold";
                posted_before: "posted_before";
                price_range_not_set: "price_range_not_set";
                price_out_of_range: "price_out_of_range";
                paid_post_off_on_onlyfans: "paid_post_off_on_onlyfans";
                volume_high: "volume_high";
                daily_limit_exceeded: "daily_limit_exceeded";
                wall_not_on_page: "wall_not_on_page";
                wall_default_unknown: "wall_default_unknown";
                tier_not_on_page: "tier_not_on_page";
                onlyfans_file_upload_unsupported: "onlyfans_file_upload_unsupported";
                onlyfans_file_too_large: "onlyfans_file_too_large";
                fansly_file_upload_unsupported: "fansly_file_upload_unsupported";
                fansly_several_tiers_unsupported: "fansly_several_tiers_unsupported";
                platform_schedule_incomplete: "platform_schedule_incomplete";
            }>;
            severity: z.ZodEnum<{
                info: "info";
                blocking: "blocking";
                warning: "warning";
            }>;
            mediaKey: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            at: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            postRef: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            publicationId: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
            detail: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodNumber, z.ZodString, z.ZodNull]>>>;
        }, z.core.$strip>>;
        blocked: z.ZodBoolean;
        author: z.ZodObject<{
            kind: z.ZodEnum<{
                human: "human";
                agent: "agent";
            }>;
            userId: z.ZodNullable<z.ZodNumber>;
            agentKeyId: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        approvedRevisionId: z.ZodNullable<z.ZodNumber>;
        platformPostRef: z.ZodNullable<z.ZodString>;
        vaultAlbumRef: z.ZodNullable<z.ZodString>;
        statusReason: z.ZodNullable<z.ZodString>;
        previousPublicationId: z.ZodNullable<z.ZodNumber>;
        withdrawal: z.ZodNullable<z.ZodObject<{
            state: z.ZodString;
            errorCode: z.ZodNullable<z.ZodString>;
            at: z.ZodString;
        }, z.core.$strip>>;
        deletion: z.ZodNullable<z.ZodObject<{
            state: z.ZodString;
            errorCode: z.ZodNullable<z.ZodString>;
            at: z.ZodString;
        }, z.core.$strip>>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
        statusChangedAt: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * The key's own publications whose `updatedAt` is at or after `since`, oldest
 * change first (owner 2026-10-29: ContentOps reads its statuses every 10
 * minutes). `updatedAt` moves with every status change, its reason, the
 * platform's post or album and every edit. Keep the greatest `updatedAt` you
 * saw and ask again from it minus an overlap; a row may come again.
 */
export declare const agentPublicationChangesQuerySchema: z.ZodObject<{
    since: z.ZodOptional<z.ZodISODateTime>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    cursor: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const agentPublicationChangesResponseSchema: z.ZodObject<{
    publications: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        pageLabel: z.ZodString;
        platform: z.ZodEnum<{
            fansly: "fansly";
            onlyfans: "onlyfans";
            telegram: "telegram";
        }>;
        kind: z.ZodEnum<{
            story: "story";
            fyp_post: "fyp_post";
            subscriber_post: "subscriber_post";
            paid_post: "paid_post";
            vault_album: "vault_album";
        }>;
        status: z.ZodEnum<{
            unknown: "unknown";
            cancelled: "cancelled";
            scheduled: "scheduled";
            draft: "draft";
            approved: "approved";
            submitting: "submitting";
            processing: "processing";
            published: "published";
            not_published: "not_published";
            rejected: "rejected";
            missed: "missed";
            withdrawn: "withdrawn";
        }>;
        version: z.ZodNumber;
        text: z.ZodString;
        publishAt: z.ZodString;
        expiresAt: z.ZodNullable<z.ZodString>;
        wallRefs: z.ZodArray<z.ZodString>;
        tierRefs: z.ZodArray<z.ZodString>;
        priceMills: z.ZodNullable<z.ZodNumber>;
        repost: z.ZodBoolean;
        pinWallRefs: z.ZodArray<z.ZodString>;
        replyLock: z.ZodArray<z.ZodEnum<{
            subscribers: "subscribers";
            followers: "followers";
        }>>;
        subscribersOnly: z.ZodBoolean;
        extraAttachments: z.ZodArray<z.ZodObject<{
            attachment: z.ZodNumber;
            access: z.ZodEnum<{
                subscribers: "subscribers";
                everyone: "everyone";
                paid: "paid";
            }>;
            tierRefs: z.ZodArray<z.ZodString>;
            priceMills: z.ZodNullable<z.ZodNumber>;
            subscribersOnly: z.ZodBoolean;
        }, z.core.$strip>>;
        media: z.ZodArray<z.ZodObject<{
            role: z.ZodEnum<{
                media: "media";
                preview: "preview";
            }>;
            position: z.ZodNumber;
            source: z.ZodEnum<{
                file: "file";
                vault: "vault";
            }>;
            mediaRef: z.ZodNullable<z.ZodString>;
            fileId: z.ZodNullable<z.ZodNumber>;
            attachment: z.ZodNumber;
        }, z.core.$strip>>;
        findings: z.ZodArray<z.ZodObject<{
            code: z.ZodEnum<{
                publish_time_past: "publish_time_past";
                file_of_another_model: "file_of_another_model";
                file_deleted: "file_deleted";
                media_not_on_page: "media_not_on_page";
                repost_within_threshold: "repost_within_threshold";
                posted_before: "posted_before";
                price_range_not_set: "price_range_not_set";
                price_out_of_range: "price_out_of_range";
                paid_post_off_on_onlyfans: "paid_post_off_on_onlyfans";
                volume_high: "volume_high";
                daily_limit_exceeded: "daily_limit_exceeded";
                wall_not_on_page: "wall_not_on_page";
                wall_default_unknown: "wall_default_unknown";
                tier_not_on_page: "tier_not_on_page";
                onlyfans_file_upload_unsupported: "onlyfans_file_upload_unsupported";
                onlyfans_file_too_large: "onlyfans_file_too_large";
                fansly_file_upload_unsupported: "fansly_file_upload_unsupported";
                fansly_several_tiers_unsupported: "fansly_several_tiers_unsupported";
                platform_schedule_incomplete: "platform_schedule_incomplete";
            }>;
            severity: z.ZodEnum<{
                info: "info";
                blocking: "blocking";
                warning: "warning";
            }>;
            mediaKey: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            at: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            postRef: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            publicationId: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
            detail: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodNumber, z.ZodString, z.ZodNull]>>>;
        }, z.core.$strip>>;
        blocked: z.ZodBoolean;
        author: z.ZodObject<{
            kind: z.ZodEnum<{
                human: "human";
                agent: "agent";
            }>;
            userId: z.ZodNullable<z.ZodNumber>;
            agentKeyId: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        approvedRevisionId: z.ZodNullable<z.ZodNumber>;
        platformPostRef: z.ZodNullable<z.ZodString>;
        vaultAlbumRef: z.ZodNullable<z.ZodString>;
        statusReason: z.ZodNullable<z.ZodString>;
        previousPublicationId: z.ZodNullable<z.ZodNumber>;
        withdrawal: z.ZodNullable<z.ZodObject<{
            state: z.ZodString;
            errorCode: z.ZodNullable<z.ZodString>;
            at: z.ZodString;
        }, z.core.$strip>>;
        deletion: z.ZodNullable<z.ZodObject<{
            state: z.ZodString;
            errorCode: z.ZodNullable<z.ZodString>;
            at: z.ZodString;
        }, z.core.$strip>>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
        statusChangedAt: z.ZodString;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const publicationIdParamsSchema: z.ZodObject<{
    id: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const publicationApproveBodySchema: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        version: z.ZodNumber;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const publicationApproveResponseSchema: z.ZodObject<{
    results: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        outcome: z.ZodEnum<{
            approved: "approved";
            refused: "refused";
        }>;
        reason: z.ZodNullable<z.ZodString>;
        publication: z.ZodNullable<z.ZodObject<{
            id: z.ZodNumber;
            pageLabel: z.ZodString;
            platform: z.ZodEnum<{
                fansly: "fansly";
                onlyfans: "onlyfans";
                telegram: "telegram";
            }>;
            kind: z.ZodEnum<{
                story: "story";
                fyp_post: "fyp_post";
                subscriber_post: "subscriber_post";
                paid_post: "paid_post";
                vault_album: "vault_album";
            }>;
            status: z.ZodEnum<{
                unknown: "unknown";
                cancelled: "cancelled";
                scheduled: "scheduled";
                draft: "draft";
                approved: "approved";
                submitting: "submitting";
                processing: "processing";
                published: "published";
                not_published: "not_published";
                rejected: "rejected";
                missed: "missed";
                withdrawn: "withdrawn";
            }>;
            version: z.ZodNumber;
            text: z.ZodString;
            publishAt: z.ZodString;
            expiresAt: z.ZodNullable<z.ZodString>;
            wallRefs: z.ZodArray<z.ZodString>;
            tierRefs: z.ZodArray<z.ZodString>;
            priceMills: z.ZodNullable<z.ZodNumber>;
            repost: z.ZodBoolean;
            pinWallRefs: z.ZodArray<z.ZodString>;
            replyLock: z.ZodArray<z.ZodEnum<{
                subscribers: "subscribers";
                followers: "followers";
            }>>;
            subscribersOnly: z.ZodBoolean;
            extraAttachments: z.ZodArray<z.ZodObject<{
                attachment: z.ZodNumber;
                access: z.ZodEnum<{
                    subscribers: "subscribers";
                    everyone: "everyone";
                    paid: "paid";
                }>;
                tierRefs: z.ZodArray<z.ZodString>;
                priceMills: z.ZodNullable<z.ZodNumber>;
                subscribersOnly: z.ZodBoolean;
            }, z.core.$strip>>;
            media: z.ZodArray<z.ZodObject<{
                role: z.ZodEnum<{
                    media: "media";
                    preview: "preview";
                }>;
                position: z.ZodNumber;
                source: z.ZodEnum<{
                    file: "file";
                    vault: "vault";
                }>;
                mediaRef: z.ZodNullable<z.ZodString>;
                fileId: z.ZodNullable<z.ZodNumber>;
                attachment: z.ZodNumber;
            }, z.core.$strip>>;
            findings: z.ZodArray<z.ZodObject<{
                code: z.ZodEnum<{
                    publish_time_past: "publish_time_past";
                    file_of_another_model: "file_of_another_model";
                    file_deleted: "file_deleted";
                    media_not_on_page: "media_not_on_page";
                    repost_within_threshold: "repost_within_threshold";
                    posted_before: "posted_before";
                    price_range_not_set: "price_range_not_set";
                    price_out_of_range: "price_out_of_range";
                    paid_post_off_on_onlyfans: "paid_post_off_on_onlyfans";
                    volume_high: "volume_high";
                    daily_limit_exceeded: "daily_limit_exceeded";
                    wall_not_on_page: "wall_not_on_page";
                    wall_default_unknown: "wall_default_unknown";
                    tier_not_on_page: "tier_not_on_page";
                    onlyfans_file_upload_unsupported: "onlyfans_file_upload_unsupported";
                    onlyfans_file_too_large: "onlyfans_file_too_large";
                    fansly_file_upload_unsupported: "fansly_file_upload_unsupported";
                    fansly_several_tiers_unsupported: "fansly_several_tiers_unsupported";
                    platform_schedule_incomplete: "platform_schedule_incomplete";
                }>;
                severity: z.ZodEnum<{
                    info: "info";
                    blocking: "blocking";
                    warning: "warning";
                }>;
                mediaKey: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                at: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                postRef: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                publicationId: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
                detail: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodNumber, z.ZodString, z.ZodNull]>>>;
            }, z.core.$strip>>;
            blocked: z.ZodBoolean;
            author: z.ZodObject<{
                kind: z.ZodEnum<{
                    human: "human";
                    agent: "agent";
                }>;
                userId: z.ZodNullable<z.ZodNumber>;
                agentKeyId: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>;
            approvedRevisionId: z.ZodNullable<z.ZodNumber>;
            platformPostRef: z.ZodNullable<z.ZodString>;
            vaultAlbumRef: z.ZodNullable<z.ZodString>;
            statusReason: z.ZodNullable<z.ZodString>;
            previousPublicationId: z.ZodNullable<z.ZodNumber>;
            withdrawal: z.ZodNullable<z.ZodObject<{
                state: z.ZodString;
                errorCode: z.ZodNullable<z.ZodString>;
                at: z.ZodString;
            }, z.core.$strip>>;
            deletion: z.ZodNullable<z.ZodObject<{
                state: z.ZodString;
                errorCode: z.ZodNullable<z.ZodString>;
                at: z.ZodString;
            }, z.core.$strip>>;
            createdAt: z.ZodString;
            updatedAt: z.ZodString;
            statusChangedAt: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** The person's answer to "unknown" (spec §8.2). */
export declare const publicationResolveBodySchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    outcome: z.ZodLiteral<"went_out">;
    state: z.ZodEnum<{
        scheduled: "scheduled";
        published: "published";
    }>;
    platformPostRef: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    outcome: z.ZodLiteral<"did_not_go_out">;
}, z.core.$strict>], "outcome">;
export declare const publicationResolveResponseSchema: z.ZodObject<{
    publication: z.ZodObject<{
        id: z.ZodNumber;
        pageLabel: z.ZodString;
        platform: z.ZodEnum<{
            fansly: "fansly";
            onlyfans: "onlyfans";
            telegram: "telegram";
        }>;
        kind: z.ZodEnum<{
            story: "story";
            fyp_post: "fyp_post";
            subscriber_post: "subscriber_post";
            paid_post: "paid_post";
            vault_album: "vault_album";
        }>;
        status: z.ZodEnum<{
            unknown: "unknown";
            cancelled: "cancelled";
            scheduled: "scheduled";
            draft: "draft";
            approved: "approved";
            submitting: "submitting";
            processing: "processing";
            published: "published";
            not_published: "not_published";
            rejected: "rejected";
            missed: "missed";
            withdrawn: "withdrawn";
        }>;
        version: z.ZodNumber;
        text: z.ZodString;
        publishAt: z.ZodString;
        expiresAt: z.ZodNullable<z.ZodString>;
        wallRefs: z.ZodArray<z.ZodString>;
        tierRefs: z.ZodArray<z.ZodString>;
        priceMills: z.ZodNullable<z.ZodNumber>;
        repost: z.ZodBoolean;
        pinWallRefs: z.ZodArray<z.ZodString>;
        replyLock: z.ZodArray<z.ZodEnum<{
            subscribers: "subscribers";
            followers: "followers";
        }>>;
        subscribersOnly: z.ZodBoolean;
        extraAttachments: z.ZodArray<z.ZodObject<{
            attachment: z.ZodNumber;
            access: z.ZodEnum<{
                subscribers: "subscribers";
                everyone: "everyone";
                paid: "paid";
            }>;
            tierRefs: z.ZodArray<z.ZodString>;
            priceMills: z.ZodNullable<z.ZodNumber>;
            subscribersOnly: z.ZodBoolean;
        }, z.core.$strip>>;
        media: z.ZodArray<z.ZodObject<{
            role: z.ZodEnum<{
                media: "media";
                preview: "preview";
            }>;
            position: z.ZodNumber;
            source: z.ZodEnum<{
                file: "file";
                vault: "vault";
            }>;
            mediaRef: z.ZodNullable<z.ZodString>;
            fileId: z.ZodNullable<z.ZodNumber>;
            attachment: z.ZodNumber;
        }, z.core.$strip>>;
        findings: z.ZodArray<z.ZodObject<{
            code: z.ZodEnum<{
                publish_time_past: "publish_time_past";
                file_of_another_model: "file_of_another_model";
                file_deleted: "file_deleted";
                media_not_on_page: "media_not_on_page";
                repost_within_threshold: "repost_within_threshold";
                posted_before: "posted_before";
                price_range_not_set: "price_range_not_set";
                price_out_of_range: "price_out_of_range";
                paid_post_off_on_onlyfans: "paid_post_off_on_onlyfans";
                volume_high: "volume_high";
                daily_limit_exceeded: "daily_limit_exceeded";
                wall_not_on_page: "wall_not_on_page";
                wall_default_unknown: "wall_default_unknown";
                tier_not_on_page: "tier_not_on_page";
                onlyfans_file_upload_unsupported: "onlyfans_file_upload_unsupported";
                onlyfans_file_too_large: "onlyfans_file_too_large";
                fansly_file_upload_unsupported: "fansly_file_upload_unsupported";
                fansly_several_tiers_unsupported: "fansly_several_tiers_unsupported";
                platform_schedule_incomplete: "platform_schedule_incomplete";
            }>;
            severity: z.ZodEnum<{
                info: "info";
                blocking: "blocking";
                warning: "warning";
            }>;
            mediaKey: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            at: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            postRef: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            publicationId: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
            detail: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodNumber, z.ZodString, z.ZodNull]>>>;
        }, z.core.$strip>>;
        blocked: z.ZodBoolean;
        author: z.ZodObject<{
            kind: z.ZodEnum<{
                human: "human";
                agent: "agent";
            }>;
            userId: z.ZodNullable<z.ZodNumber>;
            agentKeyId: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        approvedRevisionId: z.ZodNullable<z.ZodNumber>;
        platformPostRef: z.ZodNullable<z.ZodString>;
        vaultAlbumRef: z.ZodNullable<z.ZodString>;
        statusReason: z.ZodNullable<z.ZodString>;
        previousPublicationId: z.ZodNullable<z.ZodNumber>;
        withdrawal: z.ZodNullable<z.ZodObject<{
            state: z.ZodString;
            errorCode: z.ZodNullable<z.ZodString>;
            at: z.ZodString;
        }, z.core.$strip>>;
        deletion: z.ZodNullable<z.ZodObject<{
            state: z.ZodString;
            errorCode: z.ZodNullable<z.ZodString>;
            at: z.ZodString;
        }, z.core.$strip>>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
        statusChangedAt: z.ZodString;
    }, z.core.$strip>;
    replacement: z.ZodNullable<z.ZodObject<{
        id: z.ZodNumber;
        pageLabel: z.ZodString;
        platform: z.ZodEnum<{
            fansly: "fansly";
            onlyfans: "onlyfans";
            telegram: "telegram";
        }>;
        kind: z.ZodEnum<{
            story: "story";
            fyp_post: "fyp_post";
            subscriber_post: "subscriber_post";
            paid_post: "paid_post";
            vault_album: "vault_album";
        }>;
        status: z.ZodEnum<{
            unknown: "unknown";
            cancelled: "cancelled";
            scheduled: "scheduled";
            draft: "draft";
            approved: "approved";
            submitting: "submitting";
            processing: "processing";
            published: "published";
            not_published: "not_published";
            rejected: "rejected";
            missed: "missed";
            withdrawn: "withdrawn";
        }>;
        version: z.ZodNumber;
        text: z.ZodString;
        publishAt: z.ZodString;
        expiresAt: z.ZodNullable<z.ZodString>;
        wallRefs: z.ZodArray<z.ZodString>;
        tierRefs: z.ZodArray<z.ZodString>;
        priceMills: z.ZodNullable<z.ZodNumber>;
        repost: z.ZodBoolean;
        pinWallRefs: z.ZodArray<z.ZodString>;
        replyLock: z.ZodArray<z.ZodEnum<{
            subscribers: "subscribers";
            followers: "followers";
        }>>;
        subscribersOnly: z.ZodBoolean;
        extraAttachments: z.ZodArray<z.ZodObject<{
            attachment: z.ZodNumber;
            access: z.ZodEnum<{
                subscribers: "subscribers";
                everyone: "everyone";
                paid: "paid";
            }>;
            tierRefs: z.ZodArray<z.ZodString>;
            priceMills: z.ZodNullable<z.ZodNumber>;
            subscribersOnly: z.ZodBoolean;
        }, z.core.$strip>>;
        media: z.ZodArray<z.ZodObject<{
            role: z.ZodEnum<{
                media: "media";
                preview: "preview";
            }>;
            position: z.ZodNumber;
            source: z.ZodEnum<{
                file: "file";
                vault: "vault";
            }>;
            mediaRef: z.ZodNullable<z.ZodString>;
            fileId: z.ZodNullable<z.ZodNumber>;
            attachment: z.ZodNumber;
        }, z.core.$strip>>;
        findings: z.ZodArray<z.ZodObject<{
            code: z.ZodEnum<{
                publish_time_past: "publish_time_past";
                file_of_another_model: "file_of_another_model";
                file_deleted: "file_deleted";
                media_not_on_page: "media_not_on_page";
                repost_within_threshold: "repost_within_threshold";
                posted_before: "posted_before";
                price_range_not_set: "price_range_not_set";
                price_out_of_range: "price_out_of_range";
                paid_post_off_on_onlyfans: "paid_post_off_on_onlyfans";
                volume_high: "volume_high";
                daily_limit_exceeded: "daily_limit_exceeded";
                wall_not_on_page: "wall_not_on_page";
                wall_default_unknown: "wall_default_unknown";
                tier_not_on_page: "tier_not_on_page";
                onlyfans_file_upload_unsupported: "onlyfans_file_upload_unsupported";
                onlyfans_file_too_large: "onlyfans_file_too_large";
                fansly_file_upload_unsupported: "fansly_file_upload_unsupported";
                fansly_several_tiers_unsupported: "fansly_several_tiers_unsupported";
                platform_schedule_incomplete: "platform_schedule_incomplete";
            }>;
            severity: z.ZodEnum<{
                info: "info";
                blocking: "blocking";
                warning: "warning";
            }>;
            mediaKey: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            at: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            postRef: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            publicationId: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
            detail: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodNumber, z.ZodString, z.ZodNull]>>>;
        }, z.core.$strip>>;
        blocked: z.ZodBoolean;
        author: z.ZodObject<{
            kind: z.ZodEnum<{
                human: "human";
                agent: "agent";
            }>;
            userId: z.ZodNullable<z.ZodNumber>;
            agentKeyId: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        approvedRevisionId: z.ZodNullable<z.ZodNumber>;
        platformPostRef: z.ZodNullable<z.ZodString>;
        vaultAlbumRef: z.ZodNullable<z.ZodString>;
        statusReason: z.ZodNullable<z.ZodString>;
        previousPublicationId: z.ZodNullable<z.ZodNumber>;
        withdrawal: z.ZodNullable<z.ZodObject<{
            state: z.ZodString;
            errorCode: z.ZodNullable<z.ZodString>;
            at: z.ZodString;
        }, z.core.$strip>>;
        deletion: z.ZodNullable<z.ZodObject<{
            state: z.ZodString;
            errorCode: z.ZodNullable<z.ZodString>;
            at: z.ZodString;
        }, z.core.$strip>>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
        statusChangedAt: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const publicationSettingsSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    platform: z.ZodEnum<{
        fansly: "fansly";
        onlyfans: "onlyfans";
        telegram: "telegram";
    }>;
    enabled: z.ZodBoolean;
    autostopReason: z.ZodNullable<z.ZodString>;
    autostoppedAt: z.ZodNullable<z.ZodString>;
    paidPriceMinMills: z.ZodNullable<z.ZodNumber>;
    paidPriceMaxMills: z.ZodNullable<z.ZodNumber>;
    repostThresholdDays: z.ZodNumber;
    dailyLimit: z.ZodNullable<z.ZodNumber>;
    updatedAt: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const publicationSettingsListResponseSchema: z.ZodObject<{
    globalEnabled: z.ZodBoolean;
    pages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        platform: z.ZodEnum<{
            fansly: "fansly";
            onlyfans: "onlyfans";
            telegram: "telegram";
        }>;
        enabled: z.ZodBoolean;
        autostopReason: z.ZodNullable<z.ZodString>;
        autostoppedAt: z.ZodNullable<z.ZodString>;
        paidPriceMinMills: z.ZodNullable<z.ZodNumber>;
        paidPriceMaxMills: z.ZodNullable<z.ZodNumber>;
        repostThresholdDays: z.ZodNumber;
        dailyLimit: z.ZodNullable<z.ZodNumber>;
        updatedAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const publicationSettingsUpdateBodySchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    paidPriceMinMills: z.ZodNullable<z.ZodNumber>;
    paidPriceMaxMills: z.ZodNullable<z.ZodNumber>;
    repostThresholdDays: z.ZodNumber;
    dailyLimit: z.ZodNullable<z.ZodNumber>;
}, z.core.$strict>;
export declare const publicationPageParamsSchema: z.ZodObject<{
    pageLabel: z.ZodString;
}, z.core.$strip>;
export declare const publicationWithdrawResultSchema: z.ZodObject<{
    id: z.ZodNumber;
    outcome: z.ZodEnum<{
        unknown: "unknown";
        rejected: "rejected";
        withdrawn: "withdrawn";
        refused: "refused";
        accepted: "accepted";
        not_sent: "not_sent";
    }>;
    reason: z.ZodNullable<z.ZodString>;
    publication: z.ZodNullable<z.ZodObject<{
        id: z.ZodNumber;
        pageLabel: z.ZodString;
        platform: z.ZodEnum<{
            fansly: "fansly";
            onlyfans: "onlyfans";
            telegram: "telegram";
        }>;
        kind: z.ZodEnum<{
            story: "story";
            fyp_post: "fyp_post";
            subscriber_post: "subscriber_post";
            paid_post: "paid_post";
            vault_album: "vault_album";
        }>;
        status: z.ZodEnum<{
            unknown: "unknown";
            cancelled: "cancelled";
            scheduled: "scheduled";
            draft: "draft";
            approved: "approved";
            submitting: "submitting";
            processing: "processing";
            published: "published";
            not_published: "not_published";
            rejected: "rejected";
            missed: "missed";
            withdrawn: "withdrawn";
        }>;
        version: z.ZodNumber;
        text: z.ZodString;
        publishAt: z.ZodString;
        expiresAt: z.ZodNullable<z.ZodString>;
        wallRefs: z.ZodArray<z.ZodString>;
        tierRefs: z.ZodArray<z.ZodString>;
        priceMills: z.ZodNullable<z.ZodNumber>;
        repost: z.ZodBoolean;
        pinWallRefs: z.ZodArray<z.ZodString>;
        replyLock: z.ZodArray<z.ZodEnum<{
            subscribers: "subscribers";
            followers: "followers";
        }>>;
        subscribersOnly: z.ZodBoolean;
        extraAttachments: z.ZodArray<z.ZodObject<{
            attachment: z.ZodNumber;
            access: z.ZodEnum<{
                subscribers: "subscribers";
                everyone: "everyone";
                paid: "paid";
            }>;
            tierRefs: z.ZodArray<z.ZodString>;
            priceMills: z.ZodNullable<z.ZodNumber>;
            subscribersOnly: z.ZodBoolean;
        }, z.core.$strip>>;
        media: z.ZodArray<z.ZodObject<{
            role: z.ZodEnum<{
                media: "media";
                preview: "preview";
            }>;
            position: z.ZodNumber;
            source: z.ZodEnum<{
                file: "file";
                vault: "vault";
            }>;
            mediaRef: z.ZodNullable<z.ZodString>;
            fileId: z.ZodNullable<z.ZodNumber>;
            attachment: z.ZodNumber;
        }, z.core.$strip>>;
        findings: z.ZodArray<z.ZodObject<{
            code: z.ZodEnum<{
                publish_time_past: "publish_time_past";
                file_of_another_model: "file_of_another_model";
                file_deleted: "file_deleted";
                media_not_on_page: "media_not_on_page";
                repost_within_threshold: "repost_within_threshold";
                posted_before: "posted_before";
                price_range_not_set: "price_range_not_set";
                price_out_of_range: "price_out_of_range";
                paid_post_off_on_onlyfans: "paid_post_off_on_onlyfans";
                volume_high: "volume_high";
                daily_limit_exceeded: "daily_limit_exceeded";
                wall_not_on_page: "wall_not_on_page";
                wall_default_unknown: "wall_default_unknown";
                tier_not_on_page: "tier_not_on_page";
                onlyfans_file_upload_unsupported: "onlyfans_file_upload_unsupported";
                onlyfans_file_too_large: "onlyfans_file_too_large";
                fansly_file_upload_unsupported: "fansly_file_upload_unsupported";
                fansly_several_tiers_unsupported: "fansly_several_tiers_unsupported";
                platform_schedule_incomplete: "platform_schedule_incomplete";
            }>;
            severity: z.ZodEnum<{
                info: "info";
                blocking: "blocking";
                warning: "warning";
            }>;
            mediaKey: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            at: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            postRef: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            publicationId: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
            detail: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodNumber, z.ZodString, z.ZodNull]>>>;
        }, z.core.$strip>>;
        blocked: z.ZodBoolean;
        author: z.ZodObject<{
            kind: z.ZodEnum<{
                human: "human";
                agent: "agent";
            }>;
            userId: z.ZodNullable<z.ZodNumber>;
            agentKeyId: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        approvedRevisionId: z.ZodNullable<z.ZodNumber>;
        platformPostRef: z.ZodNullable<z.ZodString>;
        vaultAlbumRef: z.ZodNullable<z.ZodString>;
        statusReason: z.ZodNullable<z.ZodString>;
        previousPublicationId: z.ZodNullable<z.ZodNumber>;
        withdrawal: z.ZodNullable<z.ZodObject<{
            state: z.ZodString;
            errorCode: z.ZodNullable<z.ZodString>;
            at: z.ZodString;
        }, z.core.$strip>>;
        deletion: z.ZodNullable<z.ZodObject<{
            state: z.ZodString;
            errorCode: z.ZodNullable<z.ZodString>;
            at: z.ZodString;
        }, z.core.$strip>>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
        statusChangedAt: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PublicationWithdrawResult = z.infer<typeof publicationWithdrawResultSchema>;
export declare const publicationWithdrawResponseSchema: z.ZodObject<{
    results: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        outcome: z.ZodEnum<{
            unknown: "unknown";
            rejected: "rejected";
            withdrawn: "withdrawn";
            refused: "refused";
            accepted: "accepted";
            not_sent: "not_sent";
        }>;
        reason: z.ZodNullable<z.ZodString>;
        publication: z.ZodNullable<z.ZodObject<{
            id: z.ZodNumber;
            pageLabel: z.ZodString;
            platform: z.ZodEnum<{
                fansly: "fansly";
                onlyfans: "onlyfans";
                telegram: "telegram";
            }>;
            kind: z.ZodEnum<{
                story: "story";
                fyp_post: "fyp_post";
                subscriber_post: "subscriber_post";
                paid_post: "paid_post";
                vault_album: "vault_album";
            }>;
            status: z.ZodEnum<{
                unknown: "unknown";
                cancelled: "cancelled";
                scheduled: "scheduled";
                draft: "draft";
                approved: "approved";
                submitting: "submitting";
                processing: "processing";
                published: "published";
                not_published: "not_published";
                rejected: "rejected";
                missed: "missed";
                withdrawn: "withdrawn";
            }>;
            version: z.ZodNumber;
            text: z.ZodString;
            publishAt: z.ZodString;
            expiresAt: z.ZodNullable<z.ZodString>;
            wallRefs: z.ZodArray<z.ZodString>;
            tierRefs: z.ZodArray<z.ZodString>;
            priceMills: z.ZodNullable<z.ZodNumber>;
            repost: z.ZodBoolean;
            pinWallRefs: z.ZodArray<z.ZodString>;
            replyLock: z.ZodArray<z.ZodEnum<{
                subscribers: "subscribers";
                followers: "followers";
            }>>;
            subscribersOnly: z.ZodBoolean;
            extraAttachments: z.ZodArray<z.ZodObject<{
                attachment: z.ZodNumber;
                access: z.ZodEnum<{
                    subscribers: "subscribers";
                    everyone: "everyone";
                    paid: "paid";
                }>;
                tierRefs: z.ZodArray<z.ZodString>;
                priceMills: z.ZodNullable<z.ZodNumber>;
                subscribersOnly: z.ZodBoolean;
            }, z.core.$strip>>;
            media: z.ZodArray<z.ZodObject<{
                role: z.ZodEnum<{
                    media: "media";
                    preview: "preview";
                }>;
                position: z.ZodNumber;
                source: z.ZodEnum<{
                    file: "file";
                    vault: "vault";
                }>;
                mediaRef: z.ZodNullable<z.ZodString>;
                fileId: z.ZodNullable<z.ZodNumber>;
                attachment: z.ZodNumber;
            }, z.core.$strip>>;
            findings: z.ZodArray<z.ZodObject<{
                code: z.ZodEnum<{
                    publish_time_past: "publish_time_past";
                    file_of_another_model: "file_of_another_model";
                    file_deleted: "file_deleted";
                    media_not_on_page: "media_not_on_page";
                    repost_within_threshold: "repost_within_threshold";
                    posted_before: "posted_before";
                    price_range_not_set: "price_range_not_set";
                    price_out_of_range: "price_out_of_range";
                    paid_post_off_on_onlyfans: "paid_post_off_on_onlyfans";
                    volume_high: "volume_high";
                    daily_limit_exceeded: "daily_limit_exceeded";
                    wall_not_on_page: "wall_not_on_page";
                    wall_default_unknown: "wall_default_unknown";
                    tier_not_on_page: "tier_not_on_page";
                    onlyfans_file_upload_unsupported: "onlyfans_file_upload_unsupported";
                    onlyfans_file_too_large: "onlyfans_file_too_large";
                    fansly_file_upload_unsupported: "fansly_file_upload_unsupported";
                    fansly_several_tiers_unsupported: "fansly_several_tiers_unsupported";
                    platform_schedule_incomplete: "platform_schedule_incomplete";
                }>;
                severity: z.ZodEnum<{
                    info: "info";
                    blocking: "blocking";
                    warning: "warning";
                }>;
                mediaKey: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                at: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                postRef: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                publicationId: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
                detail: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodNumber, z.ZodString, z.ZodNull]>>>;
            }, z.core.$strip>>;
            blocked: z.ZodBoolean;
            author: z.ZodObject<{
                kind: z.ZodEnum<{
                    human: "human";
                    agent: "agent";
                }>;
                userId: z.ZodNullable<z.ZodNumber>;
                agentKeyId: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>;
            approvedRevisionId: z.ZodNullable<z.ZodNumber>;
            platformPostRef: z.ZodNullable<z.ZodString>;
            vaultAlbumRef: z.ZodNullable<z.ZodString>;
            statusReason: z.ZodNullable<z.ZodString>;
            previousPublicationId: z.ZodNullable<z.ZodNumber>;
            withdrawal: z.ZodNullable<z.ZodObject<{
                state: z.ZodString;
                errorCode: z.ZodNullable<z.ZodString>;
                at: z.ZodString;
            }, z.core.$strip>>;
            deletion: z.ZodNullable<z.ZodObject<{
                state: z.ZodString;
                errorCode: z.ZodNullable<z.ZodString>;
                at: z.ZodString;
            }, z.core.$strip>>;
            createdAt: z.ZodString;
            updatedAt: z.ZodString;
            statusChangedAt: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const publicationWithdrawPageBodySchema: z.ZodObject<{
    pageLabel: z.ZodString;
}, z.core.$strict>;
export declare const publicationQueueEntrySchema: z.ZodObject<{
    queueId: z.ZodString;
    postRef: z.ZodNullable<z.ZodString>;
    publishAt: z.ZodNullable<z.ZodString>;
    text: z.ZodString;
    mediaCount: z.ZodNullable<z.ZodNumber>;
    publicationId: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const publicationQueueSnapshotSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    platform: z.ZodEnum<{
        fansly: "fansly";
        onlyfans: "onlyfans";
    }>;
    readAt: z.ZodNullable<z.ZodString>;
    windowFrom: z.ZodNullable<z.ZodString>;
    windowTo: z.ZodNullable<z.ZodString>;
    complete: z.ZodBoolean;
    incompleteReasons: z.ZodArray<z.ZodString>;
    stale: z.ZodBoolean;
    postsPerDay: z.ZodRecord<z.ZodString, z.ZodNumber>;
    refreshRequestedAt: z.ZodNullable<z.ZodString>;
    lastFailure: z.ZodNullable<z.ZodString>;
    lastFailedAt: z.ZodNullable<z.ZodString>;
    entries: z.ZodArray<z.ZodObject<{
        queueId: z.ZodString;
        postRef: z.ZodNullable<z.ZodString>;
        publishAt: z.ZodNullable<z.ZodString>;
        text: z.ZodString;
        mediaCount: z.ZodNullable<z.ZodNumber>;
        publicationId: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PublicationQueueSnapshotWire = z.infer<typeof publicationQueueSnapshotSchema>;
export declare const publicationQueueListResponseSchema: z.ZodObject<{
    pages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        platform: z.ZodEnum<{
            fansly: "fansly";
            onlyfans: "onlyfans";
        }>;
        readAt: z.ZodNullable<z.ZodString>;
        windowFrom: z.ZodNullable<z.ZodString>;
        windowTo: z.ZodNullable<z.ZodString>;
        complete: z.ZodBoolean;
        incompleteReasons: z.ZodArray<z.ZodString>;
        stale: z.ZodBoolean;
        postsPerDay: z.ZodRecord<z.ZodString, z.ZodNumber>;
        refreshRequestedAt: z.ZodNullable<z.ZodString>;
        lastFailure: z.ZodNullable<z.ZodString>;
        lastFailedAt: z.ZodNullable<z.ZodString>;
        entries: z.ZodArray<z.ZodObject<{
            queueId: z.ZodString;
            postRef: z.ZodNullable<z.ZodString>;
            publishAt: z.ZodNullable<z.ZodString>;
            text: z.ZodString;
            mediaCount: z.ZodNullable<z.ZodNumber>;
            publicationId: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const publicationQueueRefreshBodySchema: z.ZodObject<{
    pageLabel: z.ZodString;
}, z.core.$strict>;
export declare const publicationQueueRefreshResponseSchema: z.ZodObject<{
    requestedAt: z.ZodString;
}, z.core.$strip>;
/** What a file is, as far as Hub knows. */
export declare const publicationMediaTypeSchema: z.ZodEnum<{
    image: "image";
    video: "video";
    audio: "audio";
}>;
export declare const agentPublicationMediaQuerySchema: z.ZodObject<{
    type: z.ZodOptional<z.ZodEnum<{
        image: "image";
        video: "video";
        audio: "audio";
    }>>;
    publishAt: z.ZodOptional<z.ZodISODateTime>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    cursor: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const publicationPageMediaSchema: z.ZodObject<{
    mediaRef: z.ZodString;
    type: z.ZodNullable<z.ZodEnum<{
        image: "image";
        video: "video";
        audio: "audio";
    }>>;
    mimeType: z.ZodNullable<z.ZodString>;
    width: z.ZodNullable<z.ZodNumber>;
    height: z.ZodNullable<z.ZodNumber>;
    durationMs: z.ZodNullable<z.ZodNumber>;
    byteSize: z.ZodNullable<z.ZodNumber>;
    filename: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodNullable<z.ZodString>;
    lastPost: z.ZodNullable<z.ZodObject<{
        at: z.ZodString;
        postRef: z.ZodString;
    }, z.core.$strip>>;
    nearestPublication: z.ZodNullable<z.ZodObject<{
        id: z.ZodNumber;
        publishAt: z.ZodString;
        status: z.ZodEnum<{
            unknown: "unknown";
            cancelled: "cancelled";
            scheduled: "scheduled";
            draft: "draft";
            approved: "approved";
            submitting: "submitting";
            processing: "processing";
            published: "published";
            not_published: "not_published";
            rejected: "rejected";
            missed: "missed";
            withdrawn: "withdrawn";
        }>;
    }, z.core.$strip>>;
    platformSchedule: z.ZodNullable<z.ZodObject<{
        at: z.ZodString;
        postRef: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    repostWithinThreshold: z.ZodBoolean;
}, z.core.$strip>;
export type PublicationPageMediaWire = z.infer<typeof publicationPageMediaSchema>;
export declare const agentPublicationMediaResponseSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    platform: z.ZodEnum<{
        fansly: "fansly";
        onlyfans: "onlyfans";
        telegram: "telegram";
    }>;
    publishAt: z.ZodString;
    repostThresholdDays: z.ZodNumber;
    media: z.ZodArray<z.ZodObject<{
        mediaRef: z.ZodString;
        type: z.ZodNullable<z.ZodEnum<{
            image: "image";
            video: "video";
            audio: "audio";
        }>>;
        mimeType: z.ZodNullable<z.ZodString>;
        width: z.ZodNullable<z.ZodNumber>;
        height: z.ZodNullable<z.ZodNumber>;
        durationMs: z.ZodNullable<z.ZodNumber>;
        byteSize: z.ZodNullable<z.ZodNumber>;
        filename: z.ZodNullable<z.ZodString>;
        createdAt: z.ZodNullable<z.ZodString>;
        lastPost: z.ZodNullable<z.ZodObject<{
            at: z.ZodString;
            postRef: z.ZodString;
        }, z.core.$strip>>;
        nearestPublication: z.ZodNullable<z.ZodObject<{
            id: z.ZodNumber;
            publishAt: z.ZodString;
            status: z.ZodEnum<{
                unknown: "unknown";
                cancelled: "cancelled";
                scheduled: "scheduled";
                draft: "draft";
                approved: "approved";
                submitting: "submitting";
                processing: "processing";
                published: "published";
                not_published: "not_published";
                rejected: "rejected";
                missed: "missed";
                withdrawn: "withdrawn";
            }>;
        }, z.core.$strip>>;
        platformSchedule: z.ZodNullable<z.ZodObject<{
            at: z.ZodString;
            postRef: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        repostWithinThreshold: z.ZodBoolean;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type AgentPublicationMediaResponse = z.infer<typeof agentPublicationMediaResponseSchema>;
/**
 * Where a draft of the page can go and who sees it: its Fansly walls and
 * subscription tiers as Hub last read them, by name — no prices (owner
 * 2026-10-29: a key without read:money names the audience of a post).
 * `wallRefs` and `tierRefs` of a draft name these; an empty `wallRefs` is the
 * default wall. OnlyFans has neither: both lists are empty.
 */
export declare const agentPublicationTargetsResponseSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    platform: z.ZodEnum<{
        fansly: "fansly";
        onlyfans: "onlyfans";
        telegram: "telegram";
    }>;
    walls: z.ZodArray<z.ZodObject<{
        wallRef: z.ZodString;
        name: z.ZodNullable<z.ZodString>;
        defaultWall: z.ZodBoolean;
        mainWall: z.ZodBoolean;
    }, z.core.$strip>>;
    tiers: z.ZodArray<z.ZodObject<{
        tierRef: z.ZodString;
        name: z.ZodNullable<z.ZodString>;
        pos: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AgentPublicationTargetsResponse = z.infer<typeof agentPublicationTargetsResponseSchema>;
