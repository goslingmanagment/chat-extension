export declare const PUBLICATION_KINDS: readonly ["fyp_post", "subscriber_post", "paid_post", "story", "vault_album"];
export type PublicationKind = (typeof PUBLICATION_KINDS)[number];
/** Who may reply to a Fansly post ("Lock Replies", the contract §12.4): any of
 *  these; none named, everyone. Followers are the model's followers. */
export declare const PUBLICATION_REPLY_LOCKS: readonly ["followers", "subscribers"];
export type PublicationReplyLock = (typeof PUBLICATION_REPLY_LOCKS)[number];
/** What each platform can publish: OnlyFans has no FYP (spec §6); a vault
 *  album is Fansly's (0323): its text is the album's title, its files the
 *  album as it should be, in order. */
export declare const PUBLICATION_PLATFORM_KINDS: {
    readonly fansly: readonly ["fyp_post", "subscriber_post", "paid_post", "story", "vault_album"];
    readonly onlyfans: readonly ["subscriber_post", "paid_post", "story"];
};
/** spec §4, in the order a publication lives through them. */
export declare const PUBLICATION_STATUSES: readonly ["draft", "approved", "submitting", "scheduled", "processing", "published", "not_published", "rejected", "unknown", "missed", "withdrawn", "cancelled"];
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];
/** Who wrote a publication. */
export declare const PUBLICATION_AUTHOR_KINDS: readonly ["human", "agent"];
export type PublicationAuthorKind = (typeof PUBLICATION_AUTHOR_KINDS)[number];
/** Who moved its status: a person, an agent key, or Hub itself. */
export declare const PUBLICATION_ACTOR_KINDS: readonly ["human", "agent", "hub"];
export type PublicationActorKind = (typeof PUBLICATION_ACTOR_KINDS)[number];
/**
 * Every allowed status change and who may make it (spec §4, §8.2). A status
 * that is not a key here, or a target it does not list, is refused.
 *
 * - draft → approved: a person's, or an agent's whose key the owner gave
 *   `approve:publications` (owner 2026-10-27: the agent approves after the
 *   owner's «да» in the chat).
 * - draft / approved → cancelled: a person's, or an agent's of a publication
 *   its own key drafted (owner 2026-10-29: ContentOps cancels its own while
 *   Hub has not handed it to the platform; later only the owner, in Hub).
 * - approved → draft: an edit (person or agent), or Hub's check before
 *   dispatch finding the account, binding or model changed (spec §3.3).
 * - approved → submitting / missed and everything after submitting are Hub's:
 *   the sender and the read that confirms the outcome.
 * - unknown is answered by a read (Hub) or by a person (spec §8.2): "it went
 *   out" (scheduled / published) or "it did not" (not_published, and a new
 *   publication linked to this one is drafted). Hub never concludes "it did
 *   not" by itself: absence from a read proves nothing.
 */
export declare const PUBLICATION_TRANSITIONS: Readonly<Record<PublicationStatus, Readonly<Partial<Record<PublicationStatus, readonly PublicationActorKind[]>>>>>;
export declare function canTransitionPublication(from: PublicationStatus, to: PublicationStatus, actor: PublicationActorKind): boolean;
/** Statuses whose content may still change (an edit of an approved one returns it to draft). */
export declare const PUBLICATION_EDITABLE_STATUSES: readonly PublicationStatus[];
/**
 * Statuses in which a publication occupies its media and its day on the page:
 * approved and on the way, on the platform, or possibly on it (unknown).
 * Drafts, and the statuses where it surely did not go out, do not.
 */
export declare const PUBLICATION_ACTIVE_STATUSES: readonly PublicationStatus[];
/** The codes of the draft checks (spec §8.1). Severity is decided per finding. */
export declare const PUBLICATION_FINDING_CODES: readonly ["publish_time_past", "file_of_another_model", "file_deleted", "media_not_on_page", "repost_within_threshold", "posted_before", "price_range_not_set", "price_out_of_range", "paid_post_off_on_onlyfans", "volume_high", "daily_limit_exceeded", "wall_not_on_page", "wall_default_unknown", "tier_not_on_page", "onlyfans_file_upload_unsupported", "onlyfans_file_too_large", "fansly_file_upload_unsupported", "fansly_several_tiers_unsupported", "platform_schedule_incomplete"];
export type PublicationFindingCode = (typeof PUBLICATION_FINDING_CODES)[number];
export declare const PUBLICATION_FINDING_SEVERITIES: readonly ["blocking", "warning", "info"];
export type PublicationFindingSeverity = (typeof PUBLICATION_FINDING_SEVERITIES)[number];
/** Defaults of a page's publishing settings (a page without a settings row has these). */
export declare const PUBLICATION_DEFAULT_REPOST_THRESHOLD_DAYS = 30;
/** The volume warning's floor: a page's "usual" day is never fewer posts than this. */
export declare const PUBLICATION_VOLUME_USUAL_FLOOR_PER_DAY = 3;
/** The volume warning fires at this multiple of the usual day. */
export declare const PUBLICATION_VOLUME_WARNING_FACTOR = 2;
/** The window the usual day is averaged over. */
export declare const PUBLICATION_VOLUME_BASELINE_DAYS = 30;
/**
 * Paid posts on OnlyFans: OnlyFansAPI's post create has no documented price
 * field, and setting the price by an edit after creation would make the post
 * free for a moment. Off until the "save for later" check of plan stage 2
 * shows a price at creation is accepted (spec §6, §12).
 */
export declare const ONLYFANS_PAID_POSTS_ENABLED = false;
/**
 * New files on Fansly: the page's browser uploads them (plan PR 8, the
 * contract §2) — no blocking finding `fansly_file_upload_unsupported` any
 * more; the code stays so findings saved before still read.
 */
export declare const FANSLY_FILE_UPLOAD_ENABLED = true;
/** Limits of a draft's shape; the platforms' own limits are tighter or unknown. */
export declare const PUBLICATION_TEXT_MAX_LENGTH = 5000;
export declare const PUBLICATION_MEDIA_MAX = 20;
export declare const PUBLICATION_PREVIEWS_MAX = 5;
/** A vault album's files at most (0323): all their media ids go in one
 *  request of at most one frame (~21 bytes each). */
export declare const PUBLICATION_VAULT_ALBUM_MEDIA_MAX = 300;
/** A vault album's title at most, in characters. */
export declare const PUBLICATION_VAULT_ALBUM_TITLE_MAX = 120;
/** Who sees an extra attachment of a Fansly post (the contract §12.2):
 *  everyone; the subscribers (with a price, anyone else buys it); or whoever
 *  pays (only subscribers, when it says so). */
export declare const PUBLICATION_ATTACHMENT_ACCESS: readonly ["everyone", "subscribers", "paid"];
export type PublicationAttachmentAccess = (typeof PUBLICATION_ATTACHMENT_ACCESS)[number];
/** Extra attachments a Fansly post may carry beside its own (the site's post
 *  A had four "Upload" windows in all). */
export declare const PUBLICATION_EXTRA_ATTACHMENTS_MAX = 4;
/** The largest new file Hub uploads to OnlyFans (OnlyFansAPI's direct upload, plan PR 4c). */
export declare const ONLYFANS_UPLOAD_MAX_BYTES = 100000000;
/** A story with a new file starts its upload this long before its time; a post when it goes into the schedule. */
export declare const ONLYFANS_STORY_UPLOAD_LEAD_MINUTES = 60;
/** Posts go into the platform's own schedule this far ahead; later ones wait in Hub (spec §3.4). */
export declare const PUBLICATION_SCHEDULE_HORIZON_DAYS = 7;
/** At most this many posts of one page go to the platform in a row... */
export declare const PUBLICATION_BATCH_SIZE = 5;
/** ...and the next batch of the page waits this long (spec §8.3). */
export declare const PUBLICATION_BATCH_GAP_MINUTES = 10;
/**
 * A story is sent at its time; if Hub has not started sending it this many
 * minutes after, it is missed and never goes late (spec §3.5). A post whose
 * time passed this long ago while Hub was down is missed the same way.
 */
export declare const PUBLICATION_START_WINDOW_MINUTES = 30;
/** A post due within this many minutes goes out now instead of into the schedule. */
export declare const PUBLICATION_POST_NOW_LEAD_MINUTES = 2;
/**
 * Did it go out (spec §3.6, plan PR 5): a fresh read of the platform this
 * long after the publish time. A story OnlyFans still prepares is read again
 * these many hours after its time; still not ready at the last one, it waits
 * for a person.
 */
export declare const PUBLICATION_CHECK_DELAY_MINUTES = 10;
export declare const PUBLICATION_PROCESSING_RECHECK_HOURS: readonly [1, 6];
/**
 * An "unknown" publication is looked for by reading only (spec §8.2): fresh
 * platform reads this long after it became unknown, then the posts Hub
 * collected once a day for a week. Never "it did not go out" by Hub alone.
 */
export declare const PUBLICATION_SEARCH_READ_ROUNDS_MINUTES: readonly [10, 60, number, number];
export declare const PUBLICATION_SEARCH_DAYS = 7;
/**
 * Withdrawal of a post from the platform's schedule (spec §6, §8.2): only this
 * long before its time or earlier, and only after a fresh complete read of the
 * schedule shows it still there. OnlyFansAPI's post delete removes live posts
 * too: the margin and the fresh read are the guard against deleting one that
 * already went out.
 */
export declare const PUBLICATION_WITHDRAW_MIN_LEAD_MINUTES = 15;
/** The platform's schedule is read this many days ahead (Hub schedules 7 days ahead, spec §3.4). */
export declare const PUBLICATION_QUEUE_READ_DAYS = 7;
/** ...hourly while the page has Hub posts in it, otherwise daily (and on the owner's button). */
export declare const PUBLICATION_QUEUE_READ_IN_FLIGHT_MINUTES = 60;
export declare const PUBLICATION_QUEUE_READ_IDLE_MINUTES: number;
