/**
 * Проверки (ecosystem plan §6, package K): the checks Hub's server keeps as
 * matters besides the mirrors of package D — people and access, and the
 * ledger's own checks. Each kind has one writer, the server: an agent key
 * opens or closes none of them. Each closes itself when its cause goes away;
 * a source that does not answer leaves its kind «не проверено».
 */
/** The kinds of package K, each with how often its source is asked. */
export declare const MATTER_CHECK_KIND_PERIODS: {
    /** A person who left, with a living login, a device token or an agent key. */
    readonly "people.left_with_access": 10;
    /** A living login no person holds (service and test logins are people of kind `service`). */
    readonly "people.login_unlinked": 10;
    /** A working chatter or team lead with no pay terms in force (never the terms themselves). */
    readonly "people.no_pay_terms": 10;
    /** A working chatter or team lead with no working page. */
    readonly "people.no_working_page": 10;
    /** A person works a page none of their living logins may open. */
    readonly "people.page_without_access": 10;
    /** Access to pages a person neither works nor touched for 30 days: information, one line, read once a week. */
    readonly "people.access_idle": number;
    /** An agent key that expires within 7 days (or expired and nobody revoked it). */
    readonly "people.agent_key_expiring": 10;
    /** A check of the ledger red longer than its threshold (one per check key), in the ledger's own sentence. */
    readonly "ledger.check": 15;
    /** The payout tabs someone works with no column for tomorrow: one matter listing them (the ledger's notice). */
    readonly "ledger.sheet_column": 15;
    /** An off-platform sale («мимо площадки») still not in a report N days after it was said. */
    readonly "ledger.off_platform": 15;
};
export type MatterCheckKind = keyof typeof MATTER_CHECK_KIND_PERIODS;
export declare const MATTER_CHECK_KINDS: MatterCheckKind[];
export declare function isMatterCheckKind(kind: string): kind is MatterCheckKind;
/** The people checks: a person or a login, read from the people registry and the logins. */
export declare const PEOPLE_CHECK_KINDS: ("people.left_with_access" | "people.login_unlinked" | "people.no_pay_terms" | "people.no_working_page" | "people.page_without_access" | "people.access_idle" | "people.agent_key_expiring" | "ledger.check" | "ledger.sheet_column" | "ledger.off_platform")[];
/** The ledger's: its checks, its notice about the payout tabs, its off-platform sales. */
export declare const LEDGER_CHECK_KINDS: readonly ["ledger.check", "ledger.sheet_column", "ledger.off_platform"];
/**
 * Kinds that only inform: they wait for nobody, are not counted in «Ждут вас»
 * or on the extension's icon, and the list shows them apart («Для сведения»).
 */
export declare const MATTER_INFO_KINDS: readonly string[];
export declare function isMatterInfoKind(kind: string): boolean;
/** How long a ledger check stays red (its `failingSince`) before it becomes a matter: an urgent one two of its hourly runs, any other a day. */
export declare const LEDGER_CHECK_RED_HOURS: {
    readonly urgent: 2;
    readonly other: 24;
};
/** How many days an off-platform sale may wait for its report before it is the owner's matter. */
export declare const LEDGER_OFF_PLATFORM_DAYS = 7;
/** How many days without a touch make access to a page that is not worked idle. */
export declare const PEOPLE_ACCESS_IDLE_DAYS = 30;
/** How many days before its end an agent key is said to expire. */
export declare const AGENT_KEY_EXPIRING_DAYS = 7;
