export declare const publicationRouteSchemas: {
    readonly adminPublicationList: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Publications of every page (or one) by publish time, with their draft-check findings";
        readonly querystring: import("zod").ZodObject<{
            pageLabel: import("zod").ZodOptional<import("zod").ZodString>;
            status: import("zod").ZodOptional<import("zod").ZodEnum<{
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
            from: import("zod").ZodOptional<import("zod").ZodISODateTime>;
            to: import("zod").ZodOptional<import("zod").ZodISODateTime>;
            limit: import("zod").ZodDefault<import("zod").ZodCoercedNumber<unknown>>;
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
                publications: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    pageLabel: import("zod").ZodString;
                    platform: import("zod").ZodEnum<{
                        fansly: "fansly";
                        onlyfans: "onlyfans";
                        telegram: "telegram";
                    }>;
                    kind: import("zod").ZodEnum<{
                        story: "story";
                        fyp_post: "fyp_post";
                        subscriber_post: "subscriber_post";
                        paid_post: "paid_post";
                        vault_album: "vault_album";
                    }>;
                    status: import("zod").ZodEnum<{
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
                    version: import("zod").ZodNumber;
                    text: import("zod").ZodString;
                    publishAt: import("zod").ZodString;
                    expiresAt: import("zod").ZodNullable<import("zod").ZodString>;
                    wallRefs: import("zod").ZodArray<import("zod").ZodString>;
                    tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                    priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    repost: import("zod").ZodBoolean;
                    pinWallRefs: import("zod").ZodArray<import("zod").ZodString>;
                    replyLock: import("zod").ZodArray<import("zod").ZodEnum<{
                        subscribers: "subscribers";
                        followers: "followers";
                    }>>;
                    subscribersOnly: import("zod").ZodBoolean;
                    extraAttachments: import("zod").ZodArray<import("zod").ZodObject<{
                        attachment: import("zod").ZodNumber;
                        access: import("zod").ZodEnum<{
                            subscribers: "subscribers";
                            everyone: "everyone";
                            paid: "paid";
                        }>;
                        tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                        priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                        subscribersOnly: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                    media: import("zod").ZodArray<import("zod").ZodObject<{
                        role: import("zod").ZodEnum<{
                            media: "media";
                            preview: "preview";
                        }>;
                        position: import("zod").ZodNumber;
                        source: import("zod").ZodEnum<{
                            file: "file";
                            vault: "vault";
                        }>;
                        mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                        fileId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        attachment: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                    findings: import("zod").ZodArray<import("zod").ZodObject<{
                        code: import("zod").ZodEnum<{
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
                        severity: import("zod").ZodEnum<{
                            info: "info";
                            blocking: "blocking";
                            warning: "warning";
                        }>;
                        mediaKey: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                        at: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                        postRef: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                        publicationId: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                        detail: import("zod").ZodDefault<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString, import("zod").ZodNull]>>>;
                    }, import("zod/v4/core").$strip>>;
                    blocked: import("zod").ZodBoolean;
                    author: import("zod").ZodObject<{
                        kind: import("zod").ZodEnum<{
                            human: "human";
                            agent: "agent";
                        }>;
                        userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        agentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    }, import("zod/v4/core").$strip>;
                    approvedRevisionId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    platformPostRef: import("zod").ZodNullable<import("zod").ZodString>;
                    vaultAlbumRef: import("zod").ZodNullable<import("zod").ZodString>;
                    statusReason: import("zod").ZodNullable<import("zod").ZodString>;
                    previousPublicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    withdrawal: import("zod").ZodNullable<import("zod").ZodObject<{
                        state: import("zod").ZodString;
                        errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                        at: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    deletion: import("zod").ZodNullable<import("zod").ZodObject<{
                        state: import("zod").ZodString;
                        errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                        at: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    createdAt: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                    statusChangedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPublicationCreate: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Draft a publication as the owner; it is checked at once and approved separately";
        readonly body: import("zod").ZodObject<{
            kind: import("zod").ZodEnum<{
                story: "story";
                fyp_post: "fyp_post";
                subscriber_post: "subscriber_post";
                paid_post: "paid_post";
                vault_album: "vault_album";
            }>;
            text: import("zod").ZodDefault<import("zod").ZodString>;
            media: import("zod").ZodArray<import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
                source: import("zod").ZodLiteral<"vault">;
                mediaRef: import("zod").ZodString;
            }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                source: import("zod").ZodLiteral<"file">;
                fileId: import("zod").ZodNumber;
            }, import("zod/v4/core").$strict>], "source">>;
            previews: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
                source: import("zod").ZodLiteral<"vault">;
                mediaRef: import("zod").ZodString;
            }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                source: import("zod").ZodLiteral<"file">;
                fileId: import("zod").ZodNumber;
            }, import("zod/v4/core").$strict>], "source">>>;
            publishAt: import("zod").ZodISODateTime;
            expiresAt: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodISODateTime>>;
            wallRefs: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
            tierRefs: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
            priceMills: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
            repost: import("zod").ZodDefault<import("zod").ZodBoolean>;
            pinWallRefs: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
            replyLock: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodEnum<{
                subscribers: "subscribers";
                followers: "followers";
            }>>>;
            subscribersOnly: import("zod").ZodDefault<import("zod").ZodBoolean>;
            extraAttachments: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodObject<{
                access: import("zod").ZodEnum<{
                    subscribers: "subscribers";
                    everyone: "everyone";
                    paid: "paid";
                }>;
                media: import("zod").ZodArray<import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
                    source: import("zod").ZodLiteral<"vault">;
                    mediaRef: import("zod").ZodString;
                }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                    source: import("zod").ZodLiteral<"file">;
                    fileId: import("zod").ZodNumber;
                }, import("zod/v4/core").$strict>], "source">>;
                previews: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
                    source: import("zod").ZodLiteral<"vault">;
                    mediaRef: import("zod").ZodString;
                }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                    source: import("zod").ZodLiteral<"file">;
                    fileId: import("zod").ZodNumber;
                }, import("zod/v4/core").$strict>], "source">>>;
                tierRefs: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
                priceMills: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                subscribersOnly: import("zod").ZodDefault<import("zod").ZodBoolean>;
            }, import("zod/v4/core").$strict>>>;
            pageLabel: import("zod").ZodString;
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
                id: import("zod").ZodNumber;
                pageLabel: import("zod").ZodString;
                platform: import("zod").ZodEnum<{
                    fansly: "fansly";
                    onlyfans: "onlyfans";
                    telegram: "telegram";
                }>;
                kind: import("zod").ZodEnum<{
                    story: "story";
                    fyp_post: "fyp_post";
                    subscriber_post: "subscriber_post";
                    paid_post: "paid_post";
                    vault_album: "vault_album";
                }>;
                status: import("zod").ZodEnum<{
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
                version: import("zod").ZodNumber;
                text: import("zod").ZodString;
                publishAt: import("zod").ZodString;
                expiresAt: import("zod").ZodNullable<import("zod").ZodString>;
                wallRefs: import("zod").ZodArray<import("zod").ZodString>;
                tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                repost: import("zod").ZodBoolean;
                pinWallRefs: import("zod").ZodArray<import("zod").ZodString>;
                replyLock: import("zod").ZodArray<import("zod").ZodEnum<{
                    subscribers: "subscribers";
                    followers: "followers";
                }>>;
                subscribersOnly: import("zod").ZodBoolean;
                extraAttachments: import("zod").ZodArray<import("zod").ZodObject<{
                    attachment: import("zod").ZodNumber;
                    access: import("zod").ZodEnum<{
                        subscribers: "subscribers";
                        everyone: "everyone";
                        paid: "paid";
                    }>;
                    tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                    priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    subscribersOnly: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>>;
                media: import("zod").ZodArray<import("zod").ZodObject<{
                    role: import("zod").ZodEnum<{
                        media: "media";
                        preview: "preview";
                    }>;
                    position: import("zod").ZodNumber;
                    source: import("zod").ZodEnum<{
                        file: "file";
                        vault: "vault";
                    }>;
                    mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                    fileId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    attachment: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>>;
                findings: import("zod").ZodArray<import("zod").ZodObject<{
                    code: import("zod").ZodEnum<{
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
                    severity: import("zod").ZodEnum<{
                        info: "info";
                        blocking: "blocking";
                        warning: "warning";
                    }>;
                    mediaKey: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    at: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    postRef: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    publicationId: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                    detail: import("zod").ZodDefault<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString, import("zod").ZodNull]>>>;
                }, import("zod/v4/core").$strip>>;
                blocked: import("zod").ZodBoolean;
                author: import("zod").ZodObject<{
                    kind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                    }>;
                    userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    agentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>;
                approvedRevisionId: import("zod").ZodNullable<import("zod").ZodNumber>;
                platformPostRef: import("zod").ZodNullable<import("zod").ZodString>;
                vaultAlbumRef: import("zod").ZodNullable<import("zod").ZodString>;
                statusReason: import("zod").ZodNullable<import("zod").ZodString>;
                previousPublicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                withdrawal: import("zod").ZodNullable<import("zod").ZodObject<{
                    state: import("zod").ZodString;
                    errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                deletion: import("zod").ZodNullable<import("zod").ZodObject<{
                    state: import("zod").ZodString;
                    errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                createdAt: import("zod").ZodString;
                updatedAt: import("zod").ZodString;
                statusChangedAt: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPublicationGet: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "One publication with its findings re-checked, its status journal and its approval";
        readonly params: import("zod").ZodObject<{
            id: import("zod").ZodCoercedNumber<unknown>;
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
                id: import("zod").ZodNumber;
                pageLabel: import("zod").ZodString;
                platform: import("zod").ZodEnum<{
                    fansly: "fansly";
                    onlyfans: "onlyfans";
                    telegram: "telegram";
                }>;
                kind: import("zod").ZodEnum<{
                    story: "story";
                    fyp_post: "fyp_post";
                    subscriber_post: "subscriber_post";
                    paid_post: "paid_post";
                    vault_album: "vault_album";
                }>;
                status: import("zod").ZodEnum<{
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
                version: import("zod").ZodNumber;
                text: import("zod").ZodString;
                publishAt: import("zod").ZodString;
                expiresAt: import("zod").ZodNullable<import("zod").ZodString>;
                wallRefs: import("zod").ZodArray<import("zod").ZodString>;
                tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                repost: import("zod").ZodBoolean;
                pinWallRefs: import("zod").ZodArray<import("zod").ZodString>;
                replyLock: import("zod").ZodArray<import("zod").ZodEnum<{
                    subscribers: "subscribers";
                    followers: "followers";
                }>>;
                subscribersOnly: import("zod").ZodBoolean;
                extraAttachments: import("zod").ZodArray<import("zod").ZodObject<{
                    attachment: import("zod").ZodNumber;
                    access: import("zod").ZodEnum<{
                        subscribers: "subscribers";
                        everyone: "everyone";
                        paid: "paid";
                    }>;
                    tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                    priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    subscribersOnly: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>>;
                media: import("zod").ZodArray<import("zod").ZodObject<{
                    role: import("zod").ZodEnum<{
                        media: "media";
                        preview: "preview";
                    }>;
                    position: import("zod").ZodNumber;
                    source: import("zod").ZodEnum<{
                        file: "file";
                        vault: "vault";
                    }>;
                    mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                    fileId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    attachment: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>>;
                findings: import("zod").ZodArray<import("zod").ZodObject<{
                    code: import("zod").ZodEnum<{
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
                    severity: import("zod").ZodEnum<{
                        info: "info";
                        blocking: "blocking";
                        warning: "warning";
                    }>;
                    mediaKey: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    at: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    postRef: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    publicationId: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                    detail: import("zod").ZodDefault<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString, import("zod").ZodNull]>>>;
                }, import("zod/v4/core").$strip>>;
                blocked: import("zod").ZodBoolean;
                author: import("zod").ZodObject<{
                    kind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                    }>;
                    userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    agentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>;
                approvedRevisionId: import("zod").ZodNullable<import("zod").ZodNumber>;
                platformPostRef: import("zod").ZodNullable<import("zod").ZodString>;
                vaultAlbumRef: import("zod").ZodNullable<import("zod").ZodString>;
                statusReason: import("zod").ZodNullable<import("zod").ZodString>;
                previousPublicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                withdrawal: import("zod").ZodNullable<import("zod").ZodObject<{
                    state: import("zod").ZodString;
                    errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                deletion: import("zod").ZodNullable<import("zod").ZodObject<{
                    state: import("zod").ZodString;
                    errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                createdAt: import("zod").ZodString;
                updatedAt: import("zod").ZodString;
                statusChangedAt: import("zod").ZodString;
                events: import("zod").ZodArray<import("zod").ZodObject<{
                    fromStatus: import("zod").ZodNullable<import("zod").ZodEnum<{
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
                    toStatus: import("zod").ZodEnum<{
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
                    actorKind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                        hub: "hub";
                    }>;
                    actorUserId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    actorAgentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    reason: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                revision: import("zod").ZodNullable<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    fingerprint: import("zod").ZodString;
                    approvedByUserId: import("zod").ZodNumber;
                    approvedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPublicationUpdate: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Edit a draft or an approved publication (compare-and-set on version); an approved one returns to draft";
        readonly params: import("zod").ZodObject<{
            id: import("zod").ZodCoercedNumber<unknown>;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{
            kind: import("zod").ZodEnum<{
                story: "story";
                fyp_post: "fyp_post";
                subscriber_post: "subscriber_post";
                paid_post: "paid_post";
                vault_album: "vault_album";
            }>;
            text: import("zod").ZodDefault<import("zod").ZodString>;
            media: import("zod").ZodArray<import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
                source: import("zod").ZodLiteral<"vault">;
                mediaRef: import("zod").ZodString;
            }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                source: import("zod").ZodLiteral<"file">;
                fileId: import("zod").ZodNumber;
            }, import("zod/v4/core").$strict>], "source">>;
            previews: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
                source: import("zod").ZodLiteral<"vault">;
                mediaRef: import("zod").ZodString;
            }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                source: import("zod").ZodLiteral<"file">;
                fileId: import("zod").ZodNumber;
            }, import("zod/v4/core").$strict>], "source">>>;
            publishAt: import("zod").ZodISODateTime;
            expiresAt: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodISODateTime>>;
            wallRefs: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
            tierRefs: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
            priceMills: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
            repost: import("zod").ZodDefault<import("zod").ZodBoolean>;
            pinWallRefs: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
            replyLock: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodEnum<{
                subscribers: "subscribers";
                followers: "followers";
            }>>>;
            subscribersOnly: import("zod").ZodDefault<import("zod").ZodBoolean>;
            extraAttachments: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodObject<{
                access: import("zod").ZodEnum<{
                    subscribers: "subscribers";
                    everyone: "everyone";
                    paid: "paid";
                }>;
                media: import("zod").ZodArray<import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
                    source: import("zod").ZodLiteral<"vault">;
                    mediaRef: import("zod").ZodString;
                }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                    source: import("zod").ZodLiteral<"file">;
                    fileId: import("zod").ZodNumber;
                }, import("zod/v4/core").$strict>], "source">>;
                previews: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
                    source: import("zod").ZodLiteral<"vault">;
                    mediaRef: import("zod").ZodString;
                }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                    source: import("zod").ZodLiteral<"file">;
                    fileId: import("zod").ZodNumber;
                }, import("zod/v4/core").$strict>], "source">>>;
                tierRefs: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
                priceMills: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                subscribersOnly: import("zod").ZodDefault<import("zod").ZodBoolean>;
            }, import("zod/v4/core").$strict>>>;
            version: import("zod").ZodNumber;
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
                id: import("zod").ZodNumber;
                pageLabel: import("zod").ZodString;
                platform: import("zod").ZodEnum<{
                    fansly: "fansly";
                    onlyfans: "onlyfans";
                    telegram: "telegram";
                }>;
                kind: import("zod").ZodEnum<{
                    story: "story";
                    fyp_post: "fyp_post";
                    subscriber_post: "subscriber_post";
                    paid_post: "paid_post";
                    vault_album: "vault_album";
                }>;
                status: import("zod").ZodEnum<{
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
                version: import("zod").ZodNumber;
                text: import("zod").ZodString;
                publishAt: import("zod").ZodString;
                expiresAt: import("zod").ZodNullable<import("zod").ZodString>;
                wallRefs: import("zod").ZodArray<import("zod").ZodString>;
                tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                repost: import("zod").ZodBoolean;
                pinWallRefs: import("zod").ZodArray<import("zod").ZodString>;
                replyLock: import("zod").ZodArray<import("zod").ZodEnum<{
                    subscribers: "subscribers";
                    followers: "followers";
                }>>;
                subscribersOnly: import("zod").ZodBoolean;
                extraAttachments: import("zod").ZodArray<import("zod").ZodObject<{
                    attachment: import("zod").ZodNumber;
                    access: import("zod").ZodEnum<{
                        subscribers: "subscribers";
                        everyone: "everyone";
                        paid: "paid";
                    }>;
                    tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                    priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    subscribersOnly: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>>;
                media: import("zod").ZodArray<import("zod").ZodObject<{
                    role: import("zod").ZodEnum<{
                        media: "media";
                        preview: "preview";
                    }>;
                    position: import("zod").ZodNumber;
                    source: import("zod").ZodEnum<{
                        file: "file";
                        vault: "vault";
                    }>;
                    mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                    fileId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    attachment: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>>;
                findings: import("zod").ZodArray<import("zod").ZodObject<{
                    code: import("zod").ZodEnum<{
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
                    severity: import("zod").ZodEnum<{
                        info: "info";
                        blocking: "blocking";
                        warning: "warning";
                    }>;
                    mediaKey: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    at: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    postRef: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    publicationId: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                    detail: import("zod").ZodDefault<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString, import("zod").ZodNull]>>>;
                }, import("zod/v4/core").$strip>>;
                blocked: import("zod").ZodBoolean;
                author: import("zod").ZodObject<{
                    kind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                    }>;
                    userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    agentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>;
                approvedRevisionId: import("zod").ZodNullable<import("zod").ZodNumber>;
                platformPostRef: import("zod").ZodNullable<import("zod").ZodString>;
                vaultAlbumRef: import("zod").ZodNullable<import("zod").ZodString>;
                statusReason: import("zod").ZodNullable<import("zod").ZodString>;
                previousPublicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                withdrawal: import("zod").ZodNullable<import("zod").ZodObject<{
                    state: import("zod").ZodString;
                    errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                deletion: import("zod").ZodNullable<import("zod").ZodObject<{
                    state: import("zod").ZodString;
                    errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                createdAt: import("zod").ZodString;
                updatedAt: import("zod").ZodString;
                statusChangedAt: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPublicationApprove: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Approve one or many drafts in order; each is checked again and refused on a blocking finding";
        readonly body: import("zod").ZodObject<{
            items: import("zod").ZodArray<import("zod").ZodObject<{
                id: import("zod").ZodNumber;
                version: import("zod").ZodNumber;
            }, import("zod/v4/core").$strict>>;
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
                results: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    outcome: import("zod").ZodEnum<{
                        approved: "approved";
                        refused: "refused";
                    }>;
                    reason: import("zod").ZodNullable<import("zod").ZodString>;
                    publication: import("zod").ZodNullable<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        kind: import("zod").ZodEnum<{
                            story: "story";
                            fyp_post: "fyp_post";
                            subscriber_post: "subscriber_post";
                            paid_post: "paid_post";
                            vault_album: "vault_album";
                        }>;
                        status: import("zod").ZodEnum<{
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
                        version: import("zod").ZodNumber;
                        text: import("zod").ZodString;
                        publishAt: import("zod").ZodString;
                        expiresAt: import("zod").ZodNullable<import("zod").ZodString>;
                        wallRefs: import("zod").ZodArray<import("zod").ZodString>;
                        tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                        priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                        repost: import("zod").ZodBoolean;
                        pinWallRefs: import("zod").ZodArray<import("zod").ZodString>;
                        replyLock: import("zod").ZodArray<import("zod").ZodEnum<{
                            subscribers: "subscribers";
                            followers: "followers";
                        }>>;
                        subscribersOnly: import("zod").ZodBoolean;
                        extraAttachments: import("zod").ZodArray<import("zod").ZodObject<{
                            attachment: import("zod").ZodNumber;
                            access: import("zod").ZodEnum<{
                                subscribers: "subscribers";
                                everyone: "everyone";
                                paid: "paid";
                            }>;
                            tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                            priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                            subscribersOnly: import("zod").ZodBoolean;
                        }, import("zod/v4/core").$strip>>;
                        media: import("zod").ZodArray<import("zod").ZodObject<{
                            role: import("zod").ZodEnum<{
                                media: "media";
                                preview: "preview";
                            }>;
                            position: import("zod").ZodNumber;
                            source: import("zod").ZodEnum<{
                                file: "file";
                                vault: "vault";
                            }>;
                            mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                            fileId: import("zod").ZodNullable<import("zod").ZodNumber>;
                            attachment: import("zod").ZodNumber;
                        }, import("zod/v4/core").$strip>>;
                        findings: import("zod").ZodArray<import("zod").ZodObject<{
                            code: import("zod").ZodEnum<{
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
                            severity: import("zod").ZodEnum<{
                                info: "info";
                                blocking: "blocking";
                                warning: "warning";
                            }>;
                            mediaKey: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                            at: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                            postRef: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                            publicationId: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                            detail: import("zod").ZodDefault<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString, import("zod").ZodNull]>>>;
                        }, import("zod/v4/core").$strip>>;
                        blocked: import("zod").ZodBoolean;
                        author: import("zod").ZodObject<{
                            kind: import("zod").ZodEnum<{
                                human: "human";
                                agent: "agent";
                            }>;
                            userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                            agentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        }, import("zod/v4/core").$strip>;
                        approvedRevisionId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        platformPostRef: import("zod").ZodNullable<import("zod").ZodString>;
                        vaultAlbumRef: import("zod").ZodNullable<import("zod").ZodString>;
                        statusReason: import("zod").ZodNullable<import("zod").ZodString>;
                        previousPublicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        withdrawal: import("zod").ZodNullable<import("zod").ZodObject<{
                            state: import("zod").ZodString;
                            errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                            at: import("zod").ZodString;
                        }, import("zod/v4/core").$strip>>;
                        deletion: import("zod").ZodNullable<import("zod").ZodObject<{
                            state: import("zod").ZodString;
                            errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                            at: import("zod").ZodString;
                        }, import("zod/v4/core").$strip>>;
                        createdAt: import("zod").ZodString;
                        updatedAt: import("zod").ZodString;
                        statusChangedAt: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPublicationCancel: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Cancel a draft or an approved publication before Hub sends it";
        readonly params: import("zod").ZodObject<{
            id: import("zod").ZodCoercedNumber<unknown>;
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
                id: import("zod").ZodNumber;
                pageLabel: import("zod").ZodString;
                platform: import("zod").ZodEnum<{
                    fansly: "fansly";
                    onlyfans: "onlyfans";
                    telegram: "telegram";
                }>;
                kind: import("zod").ZodEnum<{
                    story: "story";
                    fyp_post: "fyp_post";
                    subscriber_post: "subscriber_post";
                    paid_post: "paid_post";
                    vault_album: "vault_album";
                }>;
                status: import("zod").ZodEnum<{
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
                version: import("zod").ZodNumber;
                text: import("zod").ZodString;
                publishAt: import("zod").ZodString;
                expiresAt: import("zod").ZodNullable<import("zod").ZodString>;
                wallRefs: import("zod").ZodArray<import("zod").ZodString>;
                tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                repost: import("zod").ZodBoolean;
                pinWallRefs: import("zod").ZodArray<import("zod").ZodString>;
                replyLock: import("zod").ZodArray<import("zod").ZodEnum<{
                    subscribers: "subscribers";
                    followers: "followers";
                }>>;
                subscribersOnly: import("zod").ZodBoolean;
                extraAttachments: import("zod").ZodArray<import("zod").ZodObject<{
                    attachment: import("zod").ZodNumber;
                    access: import("zod").ZodEnum<{
                        subscribers: "subscribers";
                        everyone: "everyone";
                        paid: "paid";
                    }>;
                    tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                    priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    subscribersOnly: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>>;
                media: import("zod").ZodArray<import("zod").ZodObject<{
                    role: import("zod").ZodEnum<{
                        media: "media";
                        preview: "preview";
                    }>;
                    position: import("zod").ZodNumber;
                    source: import("zod").ZodEnum<{
                        file: "file";
                        vault: "vault";
                    }>;
                    mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                    fileId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    attachment: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>>;
                findings: import("zod").ZodArray<import("zod").ZodObject<{
                    code: import("zod").ZodEnum<{
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
                    severity: import("zod").ZodEnum<{
                        info: "info";
                        blocking: "blocking";
                        warning: "warning";
                    }>;
                    mediaKey: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    at: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    postRef: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    publicationId: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                    detail: import("zod").ZodDefault<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString, import("zod").ZodNull]>>>;
                }, import("zod/v4/core").$strip>>;
                blocked: import("zod").ZodBoolean;
                author: import("zod").ZodObject<{
                    kind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                    }>;
                    userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    agentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>;
                approvedRevisionId: import("zod").ZodNullable<import("zod").ZodNumber>;
                platformPostRef: import("zod").ZodNullable<import("zod").ZodString>;
                vaultAlbumRef: import("zod").ZodNullable<import("zod").ZodString>;
                statusReason: import("zod").ZodNullable<import("zod").ZodString>;
                previousPublicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                withdrawal: import("zod").ZodNullable<import("zod").ZodObject<{
                    state: import("zod").ZodString;
                    errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                deletion: import("zod").ZodNullable<import("zod").ZodObject<{
                    state: import("zod").ZodString;
                    errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                createdAt: import("zod").ZodString;
                updatedAt: import("zod").ZodString;
                statusChangedAt: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPublicationResolve: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Answer an unknown outcome: it went out (the platform post), or it did not (a linked new draft)";
        readonly params: import("zod").ZodObject<{
            id: import("zod").ZodCoercedNumber<unknown>;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
            outcome: import("zod").ZodLiteral<"went_out">;
            state: import("zod").ZodEnum<{
                scheduled: "scheduled";
                published: "published";
            }>;
            platformPostRef: import("zod").ZodString;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            outcome: import("zod").ZodLiteral<"did_not_go_out">;
        }, import("zod/v4/core").$strict>], "outcome">;
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
                publication: import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    pageLabel: import("zod").ZodString;
                    platform: import("zod").ZodEnum<{
                        fansly: "fansly";
                        onlyfans: "onlyfans";
                        telegram: "telegram";
                    }>;
                    kind: import("zod").ZodEnum<{
                        story: "story";
                        fyp_post: "fyp_post";
                        subscriber_post: "subscriber_post";
                        paid_post: "paid_post";
                        vault_album: "vault_album";
                    }>;
                    status: import("zod").ZodEnum<{
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
                    version: import("zod").ZodNumber;
                    text: import("zod").ZodString;
                    publishAt: import("zod").ZodString;
                    expiresAt: import("zod").ZodNullable<import("zod").ZodString>;
                    wallRefs: import("zod").ZodArray<import("zod").ZodString>;
                    tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                    priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    repost: import("zod").ZodBoolean;
                    pinWallRefs: import("zod").ZodArray<import("zod").ZodString>;
                    replyLock: import("zod").ZodArray<import("zod").ZodEnum<{
                        subscribers: "subscribers";
                        followers: "followers";
                    }>>;
                    subscribersOnly: import("zod").ZodBoolean;
                    extraAttachments: import("zod").ZodArray<import("zod").ZodObject<{
                        attachment: import("zod").ZodNumber;
                        access: import("zod").ZodEnum<{
                            subscribers: "subscribers";
                            everyone: "everyone";
                            paid: "paid";
                        }>;
                        tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                        priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                        subscribersOnly: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                    media: import("zod").ZodArray<import("zod").ZodObject<{
                        role: import("zod").ZodEnum<{
                            media: "media";
                            preview: "preview";
                        }>;
                        position: import("zod").ZodNumber;
                        source: import("zod").ZodEnum<{
                            file: "file";
                            vault: "vault";
                        }>;
                        mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                        fileId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        attachment: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                    findings: import("zod").ZodArray<import("zod").ZodObject<{
                        code: import("zod").ZodEnum<{
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
                        severity: import("zod").ZodEnum<{
                            info: "info";
                            blocking: "blocking";
                            warning: "warning";
                        }>;
                        mediaKey: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                        at: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                        postRef: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                        publicationId: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                        detail: import("zod").ZodDefault<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString, import("zod").ZodNull]>>>;
                    }, import("zod/v4/core").$strip>>;
                    blocked: import("zod").ZodBoolean;
                    author: import("zod").ZodObject<{
                        kind: import("zod").ZodEnum<{
                            human: "human";
                            agent: "agent";
                        }>;
                        userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        agentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    }, import("zod/v4/core").$strip>;
                    approvedRevisionId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    platformPostRef: import("zod").ZodNullable<import("zod").ZodString>;
                    vaultAlbumRef: import("zod").ZodNullable<import("zod").ZodString>;
                    statusReason: import("zod").ZodNullable<import("zod").ZodString>;
                    previousPublicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    withdrawal: import("zod").ZodNullable<import("zod").ZodObject<{
                        state: import("zod").ZodString;
                        errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                        at: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    deletion: import("zod").ZodNullable<import("zod").ZodObject<{
                        state: import("zod").ZodString;
                        errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                        at: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    createdAt: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                    statusChangedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>;
                replacement: import("zod").ZodNullable<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    pageLabel: import("zod").ZodString;
                    platform: import("zod").ZodEnum<{
                        fansly: "fansly";
                        onlyfans: "onlyfans";
                        telegram: "telegram";
                    }>;
                    kind: import("zod").ZodEnum<{
                        story: "story";
                        fyp_post: "fyp_post";
                        subscriber_post: "subscriber_post";
                        paid_post: "paid_post";
                        vault_album: "vault_album";
                    }>;
                    status: import("zod").ZodEnum<{
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
                    version: import("zod").ZodNumber;
                    text: import("zod").ZodString;
                    publishAt: import("zod").ZodString;
                    expiresAt: import("zod").ZodNullable<import("zod").ZodString>;
                    wallRefs: import("zod").ZodArray<import("zod").ZodString>;
                    tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                    priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    repost: import("zod").ZodBoolean;
                    pinWallRefs: import("zod").ZodArray<import("zod").ZodString>;
                    replyLock: import("zod").ZodArray<import("zod").ZodEnum<{
                        subscribers: "subscribers";
                        followers: "followers";
                    }>>;
                    subscribersOnly: import("zod").ZodBoolean;
                    extraAttachments: import("zod").ZodArray<import("zod").ZodObject<{
                        attachment: import("zod").ZodNumber;
                        access: import("zod").ZodEnum<{
                            subscribers: "subscribers";
                            everyone: "everyone";
                            paid: "paid";
                        }>;
                        tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                        priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                        subscribersOnly: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                    media: import("zod").ZodArray<import("zod").ZodObject<{
                        role: import("zod").ZodEnum<{
                            media: "media";
                            preview: "preview";
                        }>;
                        position: import("zod").ZodNumber;
                        source: import("zod").ZodEnum<{
                            file: "file";
                            vault: "vault";
                        }>;
                        mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                        fileId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        attachment: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                    findings: import("zod").ZodArray<import("zod").ZodObject<{
                        code: import("zod").ZodEnum<{
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
                        severity: import("zod").ZodEnum<{
                            info: "info";
                            blocking: "blocking";
                            warning: "warning";
                        }>;
                        mediaKey: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                        at: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                        postRef: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                        publicationId: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                        detail: import("zod").ZodDefault<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString, import("zod").ZodNull]>>>;
                    }, import("zod/v4/core").$strip>>;
                    blocked: import("zod").ZodBoolean;
                    author: import("zod").ZodObject<{
                        kind: import("zod").ZodEnum<{
                            human: "human";
                            agent: "agent";
                        }>;
                        userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        agentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    }, import("zod/v4/core").$strip>;
                    approvedRevisionId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    platformPostRef: import("zod").ZodNullable<import("zod").ZodString>;
                    vaultAlbumRef: import("zod").ZodNullable<import("zod").ZodString>;
                    statusReason: import("zod").ZodNullable<import("zod").ZodString>;
                    previousPublicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    withdrawal: import("zod").ZodNullable<import("zod").ZodObject<{
                        state: import("zod").ZodString;
                        errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                        at: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    deletion: import("zod").ZodNullable<import("zod").ZodObject<{
                        state: import("zod").ZodString;
                        errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                        at: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    createdAt: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                    statusChangedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPublicationWithdraw: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: string;
        readonly params: import("zod").ZodObject<{
            id: import("zod").ZodCoercedNumber<unknown>;
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
                results: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    outcome: import("zod").ZodEnum<{
                        unknown: "unknown";
                        rejected: "rejected";
                        withdrawn: "withdrawn";
                        refused: "refused";
                        accepted: "accepted";
                        not_sent: "not_sent";
                    }>;
                    reason: import("zod").ZodNullable<import("zod").ZodString>;
                    publication: import("zod").ZodNullable<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        kind: import("zod").ZodEnum<{
                            story: "story";
                            fyp_post: "fyp_post";
                            subscriber_post: "subscriber_post";
                            paid_post: "paid_post";
                            vault_album: "vault_album";
                        }>;
                        status: import("zod").ZodEnum<{
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
                        version: import("zod").ZodNumber;
                        text: import("zod").ZodString;
                        publishAt: import("zod").ZodString;
                        expiresAt: import("zod").ZodNullable<import("zod").ZodString>;
                        wallRefs: import("zod").ZodArray<import("zod").ZodString>;
                        tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                        priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                        repost: import("zod").ZodBoolean;
                        pinWallRefs: import("zod").ZodArray<import("zod").ZodString>;
                        replyLock: import("zod").ZodArray<import("zod").ZodEnum<{
                            subscribers: "subscribers";
                            followers: "followers";
                        }>>;
                        subscribersOnly: import("zod").ZodBoolean;
                        extraAttachments: import("zod").ZodArray<import("zod").ZodObject<{
                            attachment: import("zod").ZodNumber;
                            access: import("zod").ZodEnum<{
                                subscribers: "subscribers";
                                everyone: "everyone";
                                paid: "paid";
                            }>;
                            tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                            priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                            subscribersOnly: import("zod").ZodBoolean;
                        }, import("zod/v4/core").$strip>>;
                        media: import("zod").ZodArray<import("zod").ZodObject<{
                            role: import("zod").ZodEnum<{
                                media: "media";
                                preview: "preview";
                            }>;
                            position: import("zod").ZodNumber;
                            source: import("zod").ZodEnum<{
                                file: "file";
                                vault: "vault";
                            }>;
                            mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                            fileId: import("zod").ZodNullable<import("zod").ZodNumber>;
                            attachment: import("zod").ZodNumber;
                        }, import("zod/v4/core").$strip>>;
                        findings: import("zod").ZodArray<import("zod").ZodObject<{
                            code: import("zod").ZodEnum<{
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
                            severity: import("zod").ZodEnum<{
                                info: "info";
                                blocking: "blocking";
                                warning: "warning";
                            }>;
                            mediaKey: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                            at: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                            postRef: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                            publicationId: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                            detail: import("zod").ZodDefault<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString, import("zod").ZodNull]>>>;
                        }, import("zod/v4/core").$strip>>;
                        blocked: import("zod").ZodBoolean;
                        author: import("zod").ZodObject<{
                            kind: import("zod").ZodEnum<{
                                human: "human";
                                agent: "agent";
                            }>;
                            userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                            agentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        }, import("zod/v4/core").$strip>;
                        approvedRevisionId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        platformPostRef: import("zod").ZodNullable<import("zod").ZodString>;
                        vaultAlbumRef: import("zod").ZodNullable<import("zod").ZodString>;
                        statusReason: import("zod").ZodNullable<import("zod").ZodString>;
                        previousPublicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        withdrawal: import("zod").ZodNullable<import("zod").ZodObject<{
                            state: import("zod").ZodString;
                            errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                            at: import("zod").ZodString;
                        }, import("zod/v4/core").$strip>>;
                        deletion: import("zod").ZodNullable<import("zod").ZodObject<{
                            state: import("zod").ZodString;
                            errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                            at: import("zod").ZodString;
                        }, import("zod/v4/core").$strip>>;
                        createdAt: import("zod").ZodString;
                        updatedAt: import("zod").ZodString;
                        statusChangedAt: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPublicationDeletePost: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: string;
        readonly params: import("zod").ZodObject<{
            id: import("zod").ZodCoercedNumber<unknown>;
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
                results: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    outcome: import("zod").ZodEnum<{
                        unknown: "unknown";
                        rejected: "rejected";
                        withdrawn: "withdrawn";
                        refused: "refused";
                        accepted: "accepted";
                        not_sent: "not_sent";
                    }>;
                    reason: import("zod").ZodNullable<import("zod").ZodString>;
                    publication: import("zod").ZodNullable<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        kind: import("zod").ZodEnum<{
                            story: "story";
                            fyp_post: "fyp_post";
                            subscriber_post: "subscriber_post";
                            paid_post: "paid_post";
                            vault_album: "vault_album";
                        }>;
                        status: import("zod").ZodEnum<{
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
                        version: import("zod").ZodNumber;
                        text: import("zod").ZodString;
                        publishAt: import("zod").ZodString;
                        expiresAt: import("zod").ZodNullable<import("zod").ZodString>;
                        wallRefs: import("zod").ZodArray<import("zod").ZodString>;
                        tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                        priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                        repost: import("zod").ZodBoolean;
                        pinWallRefs: import("zod").ZodArray<import("zod").ZodString>;
                        replyLock: import("zod").ZodArray<import("zod").ZodEnum<{
                            subscribers: "subscribers";
                            followers: "followers";
                        }>>;
                        subscribersOnly: import("zod").ZodBoolean;
                        extraAttachments: import("zod").ZodArray<import("zod").ZodObject<{
                            attachment: import("zod").ZodNumber;
                            access: import("zod").ZodEnum<{
                                subscribers: "subscribers";
                                everyone: "everyone";
                                paid: "paid";
                            }>;
                            tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                            priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                            subscribersOnly: import("zod").ZodBoolean;
                        }, import("zod/v4/core").$strip>>;
                        media: import("zod").ZodArray<import("zod").ZodObject<{
                            role: import("zod").ZodEnum<{
                                media: "media";
                                preview: "preview";
                            }>;
                            position: import("zod").ZodNumber;
                            source: import("zod").ZodEnum<{
                                file: "file";
                                vault: "vault";
                            }>;
                            mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                            fileId: import("zod").ZodNullable<import("zod").ZodNumber>;
                            attachment: import("zod").ZodNumber;
                        }, import("zod/v4/core").$strip>>;
                        findings: import("zod").ZodArray<import("zod").ZodObject<{
                            code: import("zod").ZodEnum<{
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
                            severity: import("zod").ZodEnum<{
                                info: "info";
                                blocking: "blocking";
                                warning: "warning";
                            }>;
                            mediaKey: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                            at: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                            postRef: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                            publicationId: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                            detail: import("zod").ZodDefault<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString, import("zod").ZodNull]>>>;
                        }, import("zod/v4/core").$strip>>;
                        blocked: import("zod").ZodBoolean;
                        author: import("zod").ZodObject<{
                            kind: import("zod").ZodEnum<{
                                human: "human";
                                agent: "agent";
                            }>;
                            userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                            agentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        }, import("zod/v4/core").$strip>;
                        approvedRevisionId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        platformPostRef: import("zod").ZodNullable<import("zod").ZodString>;
                        vaultAlbumRef: import("zod").ZodNullable<import("zod").ZodString>;
                        statusReason: import("zod").ZodNullable<import("zod").ZodString>;
                        previousPublicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        withdrawal: import("zod").ZodNullable<import("zod").ZodObject<{
                            state: import("zod").ZodString;
                            errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                            at: import("zod").ZodString;
                        }, import("zod/v4/core").$strip>>;
                        deletion: import("zod").ZodNullable<import("zod").ZodObject<{
                            state: import("zod").ZodString;
                            errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                            at: import("zod").ZodString;
                        }, import("zod/v4/core").$strip>>;
                        createdAt: import("zod").ZodString;
                        updatedAt: import("zod").ZodString;
                        statusChangedAt: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPublicationWithdrawPage: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Withdraw every post Hub put in the page's OnlyFans schedule, one command per post, each its own outcome";
        readonly body: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
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
                results: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    outcome: import("zod").ZodEnum<{
                        unknown: "unknown";
                        rejected: "rejected";
                        withdrawn: "withdrawn";
                        refused: "refused";
                        accepted: "accepted";
                        not_sent: "not_sent";
                    }>;
                    reason: import("zod").ZodNullable<import("zod").ZodString>;
                    publication: import("zod").ZodNullable<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        kind: import("zod").ZodEnum<{
                            story: "story";
                            fyp_post: "fyp_post";
                            subscriber_post: "subscriber_post";
                            paid_post: "paid_post";
                            vault_album: "vault_album";
                        }>;
                        status: import("zod").ZodEnum<{
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
                        version: import("zod").ZodNumber;
                        text: import("zod").ZodString;
                        publishAt: import("zod").ZodString;
                        expiresAt: import("zod").ZodNullable<import("zod").ZodString>;
                        wallRefs: import("zod").ZodArray<import("zod").ZodString>;
                        tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                        priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                        repost: import("zod").ZodBoolean;
                        pinWallRefs: import("zod").ZodArray<import("zod").ZodString>;
                        replyLock: import("zod").ZodArray<import("zod").ZodEnum<{
                            subscribers: "subscribers";
                            followers: "followers";
                        }>>;
                        subscribersOnly: import("zod").ZodBoolean;
                        extraAttachments: import("zod").ZodArray<import("zod").ZodObject<{
                            attachment: import("zod").ZodNumber;
                            access: import("zod").ZodEnum<{
                                subscribers: "subscribers";
                                everyone: "everyone";
                                paid: "paid";
                            }>;
                            tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                            priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                            subscribersOnly: import("zod").ZodBoolean;
                        }, import("zod/v4/core").$strip>>;
                        media: import("zod").ZodArray<import("zod").ZodObject<{
                            role: import("zod").ZodEnum<{
                                media: "media";
                                preview: "preview";
                            }>;
                            position: import("zod").ZodNumber;
                            source: import("zod").ZodEnum<{
                                file: "file";
                                vault: "vault";
                            }>;
                            mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                            fileId: import("zod").ZodNullable<import("zod").ZodNumber>;
                            attachment: import("zod").ZodNumber;
                        }, import("zod/v4/core").$strip>>;
                        findings: import("zod").ZodArray<import("zod").ZodObject<{
                            code: import("zod").ZodEnum<{
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
                            severity: import("zod").ZodEnum<{
                                info: "info";
                                blocking: "blocking";
                                warning: "warning";
                            }>;
                            mediaKey: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                            at: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                            postRef: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                            publicationId: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                            detail: import("zod").ZodDefault<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString, import("zod").ZodNull]>>>;
                        }, import("zod/v4/core").$strip>>;
                        blocked: import("zod").ZodBoolean;
                        author: import("zod").ZodObject<{
                            kind: import("zod").ZodEnum<{
                                human: "human";
                                agent: "agent";
                            }>;
                            userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                            agentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        }, import("zod/v4/core").$strip>;
                        approvedRevisionId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        platformPostRef: import("zod").ZodNullable<import("zod").ZodString>;
                        vaultAlbumRef: import("zod").ZodNullable<import("zod").ZodString>;
                        statusReason: import("zod").ZodNullable<import("zod").ZodString>;
                        previousPublicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        withdrawal: import("zod").ZodNullable<import("zod").ZodObject<{
                            state: import("zod").ZodString;
                            errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                            at: import("zod").ZodString;
                        }, import("zod/v4/core").$strip>>;
                        deletion: import("zod").ZodNullable<import("zod").ZodObject<{
                            state: import("zod").ZodString;
                            errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                            at: import("zod").ZodString;
                        }, import("zod/v4/core").$strip>>;
                        createdAt: import("zod").ZodString;
                        updatedAt: import("zod").ZodString;
                        statusChangedAt: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPublicationReplace: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Draft a replacement of a withdrawn publication (only after a confirmed withdrawal); it is approved again";
        readonly params: import("zod").ZodObject<{
            id: import("zod").ZodCoercedNumber<unknown>;
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
                id: import("zod").ZodNumber;
                pageLabel: import("zod").ZodString;
                platform: import("zod").ZodEnum<{
                    fansly: "fansly";
                    onlyfans: "onlyfans";
                    telegram: "telegram";
                }>;
                kind: import("zod").ZodEnum<{
                    story: "story";
                    fyp_post: "fyp_post";
                    subscriber_post: "subscriber_post";
                    paid_post: "paid_post";
                    vault_album: "vault_album";
                }>;
                status: import("zod").ZodEnum<{
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
                version: import("zod").ZodNumber;
                text: import("zod").ZodString;
                publishAt: import("zod").ZodString;
                expiresAt: import("zod").ZodNullable<import("zod").ZodString>;
                wallRefs: import("zod").ZodArray<import("zod").ZodString>;
                tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                repost: import("zod").ZodBoolean;
                pinWallRefs: import("zod").ZodArray<import("zod").ZodString>;
                replyLock: import("zod").ZodArray<import("zod").ZodEnum<{
                    subscribers: "subscribers";
                    followers: "followers";
                }>>;
                subscribersOnly: import("zod").ZodBoolean;
                extraAttachments: import("zod").ZodArray<import("zod").ZodObject<{
                    attachment: import("zod").ZodNumber;
                    access: import("zod").ZodEnum<{
                        subscribers: "subscribers";
                        everyone: "everyone";
                        paid: "paid";
                    }>;
                    tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                    priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    subscribersOnly: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>>;
                media: import("zod").ZodArray<import("zod").ZodObject<{
                    role: import("zod").ZodEnum<{
                        media: "media";
                        preview: "preview";
                    }>;
                    position: import("zod").ZodNumber;
                    source: import("zod").ZodEnum<{
                        file: "file";
                        vault: "vault";
                    }>;
                    mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                    fileId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    attachment: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>>;
                findings: import("zod").ZodArray<import("zod").ZodObject<{
                    code: import("zod").ZodEnum<{
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
                    severity: import("zod").ZodEnum<{
                        info: "info";
                        blocking: "blocking";
                        warning: "warning";
                    }>;
                    mediaKey: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    at: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    postRef: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    publicationId: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                    detail: import("zod").ZodDefault<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString, import("zod").ZodNull]>>>;
                }, import("zod/v4/core").$strip>>;
                blocked: import("zod").ZodBoolean;
                author: import("zod").ZodObject<{
                    kind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                    }>;
                    userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    agentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>;
                approvedRevisionId: import("zod").ZodNullable<import("zod").ZodNumber>;
                platformPostRef: import("zod").ZodNullable<import("zod").ZodString>;
                vaultAlbumRef: import("zod").ZodNullable<import("zod").ZodString>;
                statusReason: import("zod").ZodNullable<import("zod").ZodString>;
                previousPublicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                withdrawal: import("zod").ZodNullable<import("zod").ZodObject<{
                    state: import("zod").ZodString;
                    errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                deletion: import("zod").ZodNullable<import("zod").ZodObject<{
                    state: import("zod").ZodString;
                    errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                createdAt: import("zod").ZodString;
                updatedAt: import("zod").ZodString;
                statusChangedAt: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPublicationQueueList: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: string;
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
                pages: import("zod").ZodArray<import("zod").ZodObject<{
                    pageLabel: import("zod").ZodString;
                    platform: import("zod").ZodEnum<{
                        fansly: "fansly";
                        onlyfans: "onlyfans";
                    }>;
                    readAt: import("zod").ZodNullable<import("zod").ZodString>;
                    windowFrom: import("zod").ZodNullable<import("zod").ZodString>;
                    windowTo: import("zod").ZodNullable<import("zod").ZodString>;
                    complete: import("zod").ZodBoolean;
                    incompleteReasons: import("zod").ZodArray<import("zod").ZodString>;
                    stale: import("zod").ZodBoolean;
                    postsPerDay: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodNumber>;
                    refreshRequestedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    lastFailure: import("zod").ZodNullable<import("zod").ZodString>;
                    lastFailedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    entries: import("zod").ZodArray<import("zod").ZodObject<{
                        queueId: import("zod").ZodString;
                        postRef: import("zod").ZodNullable<import("zod").ZodString>;
                        publishAt: import("zod").ZodNullable<import("zod").ZodString>;
                        text: import("zod").ZodString;
                        mediaCount: import("zod").ZodNullable<import("zod").ZodNumber>;
                        publicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPublicationQueueRefresh: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Read the page's OnlyFans schedule again within a minute (spends OnlyFansAPI credits)";
        readonly body: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
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
                requestedAt: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPublicationSettingsList: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "The global switch and every page's publishing settings (off by default)";
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
                globalEnabled: import("zod").ZodBoolean;
                pages: import("zod").ZodArray<import("zod").ZodObject<{
                    pageLabel: import("zod").ZodString;
                    platform: import("zod").ZodEnum<{
                        fansly: "fansly";
                        onlyfans: "onlyfans";
                        telegram: "telegram";
                    }>;
                    enabled: import("zod").ZodBoolean;
                    autostopReason: import("zod").ZodNullable<import("zod").ZodString>;
                    autostoppedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    paidPriceMinMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    paidPriceMaxMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    repostThresholdDays: import("zod").ZodNumber;
                    dailyLimit: import("zod").ZodNullable<import("zod").ZodNumber>;
                    updatedAt: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPublicationSettingsUpdate: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Set one page's publishing: on/off, paid price range (mills), repeat threshold, daily limit";
        readonly params: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{
            enabled: import("zod").ZodBoolean;
            paidPriceMinMills: import("zod").ZodNullable<import("zod").ZodNumber>;
            paidPriceMaxMills: import("zod").ZodNullable<import("zod").ZodNumber>;
            repostThresholdDays: import("zod").ZodNumber;
            dailyLimit: import("zod").ZodNullable<import("zod").ZodNumber>;
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
                pageLabel: import("zod").ZodString;
                platform: import("zod").ZodEnum<{
                    fansly: "fansly";
                    onlyfans: "onlyfans";
                    telegram: "telegram";
                }>;
                enabled: import("zod").ZodBoolean;
                autostopReason: import("zod").ZodNullable<import("zod").ZodString>;
                autostoppedAt: import("zod").ZodNullable<import("zod").ZodString>;
                paidPriceMinMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                paidPriceMaxMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                repostThresholdDays: import("zod").ZodNumber;
                dailyLimit: import("zod").ZodNullable<import("zod").ZodNumber>;
                updatedAt: import("zod").ZodNullable<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentPublicationCreate: {
        readonly auth: {
            readonly kind: "agentKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly params: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{
            kind: import("zod").ZodEnum<{
                story: "story";
                fyp_post: "fyp_post";
                subscriber_post: "subscriber_post";
                paid_post: "paid_post";
                vault_album: "vault_album";
            }>;
            text: import("zod").ZodDefault<import("zod").ZodString>;
            media: import("zod").ZodArray<import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
                source: import("zod").ZodLiteral<"vault">;
                mediaRef: import("zod").ZodString;
            }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                source: import("zod").ZodLiteral<"file">;
                fileId: import("zod").ZodNumber;
            }, import("zod/v4/core").$strict>], "source">>;
            previews: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
                source: import("zod").ZodLiteral<"vault">;
                mediaRef: import("zod").ZodString;
            }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                source: import("zod").ZodLiteral<"file">;
                fileId: import("zod").ZodNumber;
            }, import("zod/v4/core").$strict>], "source">>>;
            publishAt: import("zod").ZodISODateTime;
            expiresAt: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodISODateTime>>;
            wallRefs: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
            tierRefs: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
            priceMills: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
            repost: import("zod").ZodDefault<import("zod").ZodBoolean>;
            pinWallRefs: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
            replyLock: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodEnum<{
                subscribers: "subscribers";
                followers: "followers";
            }>>>;
            subscribersOnly: import("zod").ZodDefault<import("zod").ZodBoolean>;
            extraAttachments: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodObject<{
                access: import("zod").ZodEnum<{
                    subscribers: "subscribers";
                    everyone: "everyone";
                    paid: "paid";
                }>;
                media: import("zod").ZodArray<import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
                    source: import("zod").ZodLiteral<"vault">;
                    mediaRef: import("zod").ZodString;
                }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                    source: import("zod").ZodLiteral<"file">;
                    fileId: import("zod").ZodNumber;
                }, import("zod/v4/core").$strict>], "source">>;
                previews: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
                    source: import("zod").ZodLiteral<"vault">;
                    mediaRef: import("zod").ZodString;
                }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                    source: import("zod").ZodLiteral<"file">;
                    fileId: import("zod").ZodNumber;
                }, import("zod/v4/core").$strict>], "source">>>;
                tierRefs: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
                priceMills: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                subscribersOnly: import("zod").ZodDefault<import("zod").ZodBoolean>;
            }, import("zod/v4/core").$strict>>>;
            idempotencyKey: import("zod").ZodString;
        }, import("zod/v4/core").$strict>;
        readonly response: {
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
                id: import("zod").ZodNumber;
                pageLabel: import("zod").ZodString;
                platform: import("zod").ZodEnum<{
                    fansly: "fansly";
                    onlyfans: "onlyfans";
                    telegram: "telegram";
                }>;
                kind: import("zod").ZodEnum<{
                    story: "story";
                    fyp_post: "fyp_post";
                    subscriber_post: "subscriber_post";
                    paid_post: "paid_post";
                    vault_album: "vault_album";
                }>;
                status: import("zod").ZodEnum<{
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
                version: import("zod").ZodNumber;
                text: import("zod").ZodString;
                publishAt: import("zod").ZodString;
                expiresAt: import("zod").ZodNullable<import("zod").ZodString>;
                wallRefs: import("zod").ZodArray<import("zod").ZodString>;
                tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                repost: import("zod").ZodBoolean;
                pinWallRefs: import("zod").ZodArray<import("zod").ZodString>;
                replyLock: import("zod").ZodArray<import("zod").ZodEnum<{
                    subscribers: "subscribers";
                    followers: "followers";
                }>>;
                subscribersOnly: import("zod").ZodBoolean;
                extraAttachments: import("zod").ZodArray<import("zod").ZodObject<{
                    attachment: import("zod").ZodNumber;
                    access: import("zod").ZodEnum<{
                        subscribers: "subscribers";
                        everyone: "everyone";
                        paid: "paid";
                    }>;
                    tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                    priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    subscribersOnly: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>>;
                media: import("zod").ZodArray<import("zod").ZodObject<{
                    role: import("zod").ZodEnum<{
                        media: "media";
                        preview: "preview";
                    }>;
                    position: import("zod").ZodNumber;
                    source: import("zod").ZodEnum<{
                        file: "file";
                        vault: "vault";
                    }>;
                    mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                    fileId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    attachment: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>>;
                findings: import("zod").ZodArray<import("zod").ZodObject<{
                    code: import("zod").ZodEnum<{
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
                    severity: import("zod").ZodEnum<{
                        info: "info";
                        blocking: "blocking";
                        warning: "warning";
                    }>;
                    mediaKey: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    at: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    postRef: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    publicationId: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                    detail: import("zod").ZodDefault<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString, import("zod").ZodNull]>>>;
                }, import("zod/v4/core").$strip>>;
                blocked: import("zod").ZodBoolean;
                author: import("zod").ZodObject<{
                    kind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                    }>;
                    userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    agentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>;
                approvedRevisionId: import("zod").ZodNullable<import("zod").ZodNumber>;
                platformPostRef: import("zod").ZodNullable<import("zod").ZodString>;
                vaultAlbumRef: import("zod").ZodNullable<import("zod").ZodString>;
                statusReason: import("zod").ZodNullable<import("zod").ZodString>;
                previousPublicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                withdrawal: import("zod").ZodNullable<import("zod").ZodObject<{
                    state: import("zod").ZodString;
                    errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                deletion: import("zod").ZodNullable<import("zod").ZodObject<{
                    state: import("zod").ZodString;
                    errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                createdAt: import("zod").ZodString;
                updatedAt: import("zod").ZodString;
                statusChangedAt: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentPublicationList: {
        readonly auth: {
            readonly kind: "agentKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "The page's publications and their statuses and findings (needs write:publication_drafts)";
        readonly params: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        readonly querystring: import("zod").ZodObject<{
            from: import("zod").ZodOptional<import("zod").ZodISODateTime>;
            to: import("zod").ZodOptional<import("zod").ZodISODateTime>;
            limit: import("zod").ZodDefault<import("zod").ZodCoercedNumber<unknown>>;
            status: import("zod").ZodOptional<import("zod").ZodEnum<{
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
        }, import("zod/v4/core").$strip>;
        readonly response: {
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
                publications: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    pageLabel: import("zod").ZodString;
                    platform: import("zod").ZodEnum<{
                        fansly: "fansly";
                        onlyfans: "onlyfans";
                        telegram: "telegram";
                    }>;
                    kind: import("zod").ZodEnum<{
                        story: "story";
                        fyp_post: "fyp_post";
                        subscriber_post: "subscriber_post";
                        paid_post: "paid_post";
                        vault_album: "vault_album";
                    }>;
                    status: import("zod").ZodEnum<{
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
                    version: import("zod").ZodNumber;
                    text: import("zod").ZodString;
                    publishAt: import("zod").ZodString;
                    expiresAt: import("zod").ZodNullable<import("zod").ZodString>;
                    wallRefs: import("zod").ZodArray<import("zod").ZodString>;
                    tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                    priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    repost: import("zod").ZodBoolean;
                    pinWallRefs: import("zod").ZodArray<import("zod").ZodString>;
                    replyLock: import("zod").ZodArray<import("zod").ZodEnum<{
                        subscribers: "subscribers";
                        followers: "followers";
                    }>>;
                    subscribersOnly: import("zod").ZodBoolean;
                    extraAttachments: import("zod").ZodArray<import("zod").ZodObject<{
                        attachment: import("zod").ZodNumber;
                        access: import("zod").ZodEnum<{
                            subscribers: "subscribers";
                            everyone: "everyone";
                            paid: "paid";
                        }>;
                        tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                        priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                        subscribersOnly: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                    media: import("zod").ZodArray<import("zod").ZodObject<{
                        role: import("zod").ZodEnum<{
                            media: "media";
                            preview: "preview";
                        }>;
                        position: import("zod").ZodNumber;
                        source: import("zod").ZodEnum<{
                            file: "file";
                            vault: "vault";
                        }>;
                        mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                        fileId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        attachment: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                    findings: import("zod").ZodArray<import("zod").ZodObject<{
                        code: import("zod").ZodEnum<{
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
                        severity: import("zod").ZodEnum<{
                            info: "info";
                            blocking: "blocking";
                            warning: "warning";
                        }>;
                        mediaKey: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                        at: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                        postRef: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                        publicationId: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                        detail: import("zod").ZodDefault<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString, import("zod").ZodNull]>>>;
                    }, import("zod/v4/core").$strip>>;
                    blocked: import("zod").ZodBoolean;
                    author: import("zod").ZodObject<{
                        kind: import("zod").ZodEnum<{
                            human: "human";
                            agent: "agent";
                        }>;
                        userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        agentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    }, import("zod/v4/core").$strip>;
                    approvedRevisionId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    platformPostRef: import("zod").ZodNullable<import("zod").ZodString>;
                    vaultAlbumRef: import("zod").ZodNullable<import("zod").ZodString>;
                    statusReason: import("zod").ZodNullable<import("zod").ZodString>;
                    previousPublicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    withdrawal: import("zod").ZodNullable<import("zod").ZodObject<{
                        state: import("zod").ZodString;
                        errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                        at: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    deletion: import("zod").ZodNullable<import("zod").ZodObject<{
                        state: import("zod").ZodString;
                        errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                        at: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    createdAt: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                    statusChangedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentPublicationMedia: {
        readonly auth: {
            readonly kind: "agentKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly params: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        readonly querystring: import("zod").ZodObject<{
            type: import("zod").ZodOptional<import("zod").ZodEnum<{
                image: "image";
                video: "video";
                audio: "audio";
            }>>;
            publishAt: import("zod").ZodOptional<import("zod").ZodISODateTime>;
            limit: import("zod").ZodDefault<import("zod").ZodCoercedNumber<unknown>>;
            cursor: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>;
        readonly response: {
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
                pageLabel: import("zod").ZodString;
                platform: import("zod").ZodEnum<{
                    fansly: "fansly";
                    onlyfans: "onlyfans";
                    telegram: "telegram";
                }>;
                publishAt: import("zod").ZodString;
                repostThresholdDays: import("zod").ZodNumber;
                media: import("zod").ZodArray<import("zod").ZodObject<{
                    mediaRef: import("zod").ZodString;
                    type: import("zod").ZodNullable<import("zod").ZodEnum<{
                        image: "image";
                        video: "video";
                        audio: "audio";
                    }>>;
                    mimeType: import("zod").ZodNullable<import("zod").ZodString>;
                    width: import("zod").ZodNullable<import("zod").ZodNumber>;
                    height: import("zod").ZodNullable<import("zod").ZodNumber>;
                    durationMs: import("zod").ZodNullable<import("zod").ZodNumber>;
                    byteSize: import("zod").ZodNullable<import("zod").ZodNumber>;
                    filename: import("zod").ZodNullable<import("zod").ZodString>;
                    createdAt: import("zod").ZodNullable<import("zod").ZodString>;
                    lastPost: import("zod").ZodNullable<import("zod").ZodObject<{
                        at: import("zod").ZodString;
                        postRef: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    nearestPublication: import("zod").ZodNullable<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        publishAt: import("zod").ZodString;
                        status: import("zod").ZodEnum<{
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
                    }, import("zod/v4/core").$strip>>;
                    platformSchedule: import("zod").ZodNullable<import("zod").ZodObject<{
                        at: import("zod").ZodString;
                        postRef: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    repostWithinThreshold: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>>;
                nextCursor: import("zod").ZodNullable<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentPublicationGet: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "One publication of a granted page with its status journal (needs write:publication_drafts)";
        readonly params: import("zod").ZodObject<{
            id: import("zod").ZodCoercedNumber<unknown>;
        }, import("zod/v4/core").$strip>;
        readonly response: {
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
                id: import("zod").ZodNumber;
                pageLabel: import("zod").ZodString;
                platform: import("zod").ZodEnum<{
                    fansly: "fansly";
                    onlyfans: "onlyfans";
                    telegram: "telegram";
                }>;
                kind: import("zod").ZodEnum<{
                    story: "story";
                    fyp_post: "fyp_post";
                    subscriber_post: "subscriber_post";
                    paid_post: "paid_post";
                    vault_album: "vault_album";
                }>;
                status: import("zod").ZodEnum<{
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
                version: import("zod").ZodNumber;
                text: import("zod").ZodString;
                publishAt: import("zod").ZodString;
                expiresAt: import("zod").ZodNullable<import("zod").ZodString>;
                wallRefs: import("zod").ZodArray<import("zod").ZodString>;
                tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                repost: import("zod").ZodBoolean;
                pinWallRefs: import("zod").ZodArray<import("zod").ZodString>;
                replyLock: import("zod").ZodArray<import("zod").ZodEnum<{
                    subscribers: "subscribers";
                    followers: "followers";
                }>>;
                subscribersOnly: import("zod").ZodBoolean;
                extraAttachments: import("zod").ZodArray<import("zod").ZodObject<{
                    attachment: import("zod").ZodNumber;
                    access: import("zod").ZodEnum<{
                        subscribers: "subscribers";
                        everyone: "everyone";
                        paid: "paid";
                    }>;
                    tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                    priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    subscribersOnly: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>>;
                media: import("zod").ZodArray<import("zod").ZodObject<{
                    role: import("zod").ZodEnum<{
                        media: "media";
                        preview: "preview";
                    }>;
                    position: import("zod").ZodNumber;
                    source: import("zod").ZodEnum<{
                        file: "file";
                        vault: "vault";
                    }>;
                    mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                    fileId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    attachment: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>>;
                findings: import("zod").ZodArray<import("zod").ZodObject<{
                    code: import("zod").ZodEnum<{
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
                    severity: import("zod").ZodEnum<{
                        info: "info";
                        blocking: "blocking";
                        warning: "warning";
                    }>;
                    mediaKey: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    at: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    postRef: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    publicationId: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                    detail: import("zod").ZodDefault<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString, import("zod").ZodNull]>>>;
                }, import("zod/v4/core").$strip>>;
                blocked: import("zod").ZodBoolean;
                author: import("zod").ZodObject<{
                    kind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                    }>;
                    userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    agentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>;
                approvedRevisionId: import("zod").ZodNullable<import("zod").ZodNumber>;
                platformPostRef: import("zod").ZodNullable<import("zod").ZodString>;
                vaultAlbumRef: import("zod").ZodNullable<import("zod").ZodString>;
                statusReason: import("zod").ZodNullable<import("zod").ZodString>;
                previousPublicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                withdrawal: import("zod").ZodNullable<import("zod").ZodObject<{
                    state: import("zod").ZodString;
                    errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                deletion: import("zod").ZodNullable<import("zod").ZodObject<{
                    state: import("zod").ZodString;
                    errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                createdAt: import("zod").ZodString;
                updatedAt: import("zod").ZodString;
                statusChangedAt: import("zod").ZodString;
                events: import("zod").ZodArray<import("zod").ZodObject<{
                    fromStatus: import("zod").ZodNullable<import("zod").ZodEnum<{
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
                    toStatus: import("zod").ZodEnum<{
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
                    actorKind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                        hub: "hub";
                    }>;
                    actorUserId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    actorAgentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    reason: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                revision: import("zod").ZodNullable<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    fingerprint: import("zod").ZodString;
                    approvedByUserId: import("zod").ZodNumber;
                    approvedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentPublicationApprove: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly body: import("zod").ZodObject<{
            items: import("zod").ZodArray<import("zod").ZodObject<{
                id: import("zod").ZodNumber;
                version: import("zod").ZodNumber;
            }, import("zod/v4/core").$strict>>;
        }, import("zod/v4/core").$strict>;
        readonly response: {
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
                results: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    outcome: import("zod").ZodEnum<{
                        approved: "approved";
                        refused: "refused";
                    }>;
                    reason: import("zod").ZodNullable<import("zod").ZodString>;
                    publication: import("zod").ZodNullable<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodEnum<{
                            fansly: "fansly";
                            onlyfans: "onlyfans";
                            telegram: "telegram";
                        }>;
                        kind: import("zod").ZodEnum<{
                            story: "story";
                            fyp_post: "fyp_post";
                            subscriber_post: "subscriber_post";
                            paid_post: "paid_post";
                            vault_album: "vault_album";
                        }>;
                        status: import("zod").ZodEnum<{
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
                        version: import("zod").ZodNumber;
                        text: import("zod").ZodString;
                        publishAt: import("zod").ZodString;
                        expiresAt: import("zod").ZodNullable<import("zod").ZodString>;
                        wallRefs: import("zod").ZodArray<import("zod").ZodString>;
                        tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                        priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                        repost: import("zod").ZodBoolean;
                        pinWallRefs: import("zod").ZodArray<import("zod").ZodString>;
                        replyLock: import("zod").ZodArray<import("zod").ZodEnum<{
                            subscribers: "subscribers";
                            followers: "followers";
                        }>>;
                        subscribersOnly: import("zod").ZodBoolean;
                        extraAttachments: import("zod").ZodArray<import("zod").ZodObject<{
                            attachment: import("zod").ZodNumber;
                            access: import("zod").ZodEnum<{
                                subscribers: "subscribers";
                                everyone: "everyone";
                                paid: "paid";
                            }>;
                            tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                            priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                            subscribersOnly: import("zod").ZodBoolean;
                        }, import("zod/v4/core").$strip>>;
                        media: import("zod").ZodArray<import("zod").ZodObject<{
                            role: import("zod").ZodEnum<{
                                media: "media";
                                preview: "preview";
                            }>;
                            position: import("zod").ZodNumber;
                            source: import("zod").ZodEnum<{
                                file: "file";
                                vault: "vault";
                            }>;
                            mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                            fileId: import("zod").ZodNullable<import("zod").ZodNumber>;
                            attachment: import("zod").ZodNumber;
                        }, import("zod/v4/core").$strip>>;
                        findings: import("zod").ZodArray<import("zod").ZodObject<{
                            code: import("zod").ZodEnum<{
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
                            severity: import("zod").ZodEnum<{
                                info: "info";
                                blocking: "blocking";
                                warning: "warning";
                            }>;
                            mediaKey: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                            at: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                            postRef: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                            publicationId: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                            detail: import("zod").ZodDefault<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString, import("zod").ZodNull]>>>;
                        }, import("zod/v4/core").$strip>>;
                        blocked: import("zod").ZodBoolean;
                        author: import("zod").ZodObject<{
                            kind: import("zod").ZodEnum<{
                                human: "human";
                                agent: "agent";
                            }>;
                            userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                            agentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        }, import("zod/v4/core").$strip>;
                        approvedRevisionId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        platformPostRef: import("zod").ZodNullable<import("zod").ZodString>;
                        vaultAlbumRef: import("zod").ZodNullable<import("zod").ZodString>;
                        statusReason: import("zod").ZodNullable<import("zod").ZodString>;
                        previousPublicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                        withdrawal: import("zod").ZodNullable<import("zod").ZodObject<{
                            state: import("zod").ZodString;
                            errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                            at: import("zod").ZodString;
                        }, import("zod/v4/core").$strip>>;
                        deletion: import("zod").ZodNullable<import("zod").ZodObject<{
                            state: import("zod").ZodString;
                            errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                            at: import("zod").ZodString;
                        }, import("zod/v4/core").$strip>>;
                        createdAt: import("zod").ZodString;
                        updatedAt: import("zod").ZodString;
                        statusChangedAt: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentPublicationUpdate: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Edit a publication this key drafted; an approved one returns to draft and is approved again";
        readonly params: import("zod").ZodObject<{
            id: import("zod").ZodCoercedNumber<unknown>;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{
            kind: import("zod").ZodEnum<{
                story: "story";
                fyp_post: "fyp_post";
                subscriber_post: "subscriber_post";
                paid_post: "paid_post";
                vault_album: "vault_album";
            }>;
            text: import("zod").ZodDefault<import("zod").ZodString>;
            media: import("zod").ZodArray<import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
                source: import("zod").ZodLiteral<"vault">;
                mediaRef: import("zod").ZodString;
            }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                source: import("zod").ZodLiteral<"file">;
                fileId: import("zod").ZodNumber;
            }, import("zod/v4/core").$strict>], "source">>;
            previews: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
                source: import("zod").ZodLiteral<"vault">;
                mediaRef: import("zod").ZodString;
            }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                source: import("zod").ZodLiteral<"file">;
                fileId: import("zod").ZodNumber;
            }, import("zod/v4/core").$strict>], "source">>>;
            publishAt: import("zod").ZodISODateTime;
            expiresAt: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodISODateTime>>;
            wallRefs: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
            tierRefs: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
            priceMills: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
            repost: import("zod").ZodDefault<import("zod").ZodBoolean>;
            pinWallRefs: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
            replyLock: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodEnum<{
                subscribers: "subscribers";
                followers: "followers";
            }>>>;
            subscribersOnly: import("zod").ZodDefault<import("zod").ZodBoolean>;
            extraAttachments: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodObject<{
                access: import("zod").ZodEnum<{
                    subscribers: "subscribers";
                    everyone: "everyone";
                    paid: "paid";
                }>;
                media: import("zod").ZodArray<import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
                    source: import("zod").ZodLiteral<"vault">;
                    mediaRef: import("zod").ZodString;
                }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                    source: import("zod").ZodLiteral<"file">;
                    fileId: import("zod").ZodNumber;
                }, import("zod/v4/core").$strict>], "source">>;
                previews: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
                    source: import("zod").ZodLiteral<"vault">;
                    mediaRef: import("zod").ZodString;
                }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                    source: import("zod").ZodLiteral<"file">;
                    fileId: import("zod").ZodNumber;
                }, import("zod/v4/core").$strict>], "source">>>;
                tierRefs: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
                priceMills: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                subscribersOnly: import("zod").ZodDefault<import("zod").ZodBoolean>;
            }, import("zod/v4/core").$strict>>>;
            version: import("zod").ZodNumber;
        }, import("zod/v4/core").$strict>;
        readonly response: {
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
                id: import("zod").ZodNumber;
                pageLabel: import("zod").ZodString;
                platform: import("zod").ZodEnum<{
                    fansly: "fansly";
                    onlyfans: "onlyfans";
                    telegram: "telegram";
                }>;
                kind: import("zod").ZodEnum<{
                    story: "story";
                    fyp_post: "fyp_post";
                    subscriber_post: "subscriber_post";
                    paid_post: "paid_post";
                    vault_album: "vault_album";
                }>;
                status: import("zod").ZodEnum<{
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
                version: import("zod").ZodNumber;
                text: import("zod").ZodString;
                publishAt: import("zod").ZodString;
                expiresAt: import("zod").ZodNullable<import("zod").ZodString>;
                wallRefs: import("zod").ZodArray<import("zod").ZodString>;
                tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                repost: import("zod").ZodBoolean;
                pinWallRefs: import("zod").ZodArray<import("zod").ZodString>;
                replyLock: import("zod").ZodArray<import("zod").ZodEnum<{
                    subscribers: "subscribers";
                    followers: "followers";
                }>>;
                subscribersOnly: import("zod").ZodBoolean;
                extraAttachments: import("zod").ZodArray<import("zod").ZodObject<{
                    attachment: import("zod").ZodNumber;
                    access: import("zod").ZodEnum<{
                        subscribers: "subscribers";
                        everyone: "everyone";
                        paid: "paid";
                    }>;
                    tierRefs: import("zod").ZodArray<import("zod").ZodString>;
                    priceMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    subscribersOnly: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>>;
                media: import("zod").ZodArray<import("zod").ZodObject<{
                    role: import("zod").ZodEnum<{
                        media: "media";
                        preview: "preview";
                    }>;
                    position: import("zod").ZodNumber;
                    source: import("zod").ZodEnum<{
                        file: "file";
                        vault: "vault";
                    }>;
                    mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                    fileId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    attachment: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>>;
                findings: import("zod").ZodArray<import("zod").ZodObject<{
                    code: import("zod").ZodEnum<{
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
                    severity: import("zod").ZodEnum<{
                        info: "info";
                        blocking: "blocking";
                        warning: "warning";
                    }>;
                    mediaKey: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    at: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    postRef: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodString>>;
                    publicationId: import("zod").ZodDefault<import("zod").ZodNullable<import("zod").ZodNumber>>;
                    detail: import("zod").ZodDefault<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString, import("zod").ZodNull]>>>;
                }, import("zod/v4/core").$strip>>;
                blocked: import("zod").ZodBoolean;
                author: import("zod").ZodObject<{
                    kind: import("zod").ZodEnum<{
                        human: "human";
                        agent: "agent";
                    }>;
                    userId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    agentKeyId: import("zod").ZodNullable<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>;
                approvedRevisionId: import("zod").ZodNullable<import("zod").ZodNumber>;
                platformPostRef: import("zod").ZodNullable<import("zod").ZodString>;
                vaultAlbumRef: import("zod").ZodNullable<import("zod").ZodString>;
                statusReason: import("zod").ZodNullable<import("zod").ZodString>;
                previousPublicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                withdrawal: import("zod").ZodNullable<import("zod").ZodObject<{
                    state: import("zod").ZodString;
                    errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                deletion: import("zod").ZodNullable<import("zod").ZodObject<{
                    state: import("zod").ZodString;
                    errorCode: import("zod").ZodNullable<import("zod").ZodString>;
                    at: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                createdAt: import("zod").ZodString;
                updatedAt: import("zod").ZodString;
                statusChangedAt: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
};
