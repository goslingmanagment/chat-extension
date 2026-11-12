import type { PeopleMessageKind } from "../shared/index";
/**
 * Сообщения людям (package S): the kinds, one row of code and words each — to
 * whom, when, the exact template, the day's cap per recipient and the quiet
 * hours. Not a table the owner edits: what the owner decides is whether a kind
 * is on (the live setting peopleMessageKinds) and where the work chats are
 * (peopleMessageChats). The group kinds' texts are exactly today's formats:
 * the ledger's post reader parses the report's post.
 */
export type PeopleMessageSpecAudience = "group" | "person" | "press";
export interface PeopleMessageKindSpec {
    kind: PeopleMessageKind;
    title: string;
    audience: PeopleMessageSpecAudience;
    toWhom: string;
    when: string;
    /** The exact text with its places in «‹…›». */
    template: string;
    /** At most this many a Moscow day to one recipient (a person, or a chat's topic). */
    cap: number;
    /** Personal reminders wait out the people's night: none is made 23:00–10:00 Moscow time. */
    quiet: boolean;
    /** `false`: the kind and its words are here, the event that fires it comes with its package. */
    connected: boolean;
    triggerNote: string | null;
    needs: readonly string[];
    /** What starts happening when it is turned on. */
    onSentence: string;
}
/** The people's night by Moscow time: a personal reminder is not made from 23:00 to 10:00. */
export declare const PEOPLE_MESSAGE_QUIET_FROM_HOUR = 23;
export declare const PEOPLE_MESSAGE_QUIET_TO_HOUR = 10;
export declare const PEOPLE_MESSAGE_KIND_SPECS: readonly PeopleMessageKindSpec[];
export declare function peopleMessageKindSpec(kind: PeopleMessageKind): PeopleMessageKindSpec;
export declare function peopleMessageQuietWords(spec: PeopleMessageKindSpec): string;
export declare function peopleMessageCapWords(spec: PeopleMessageKindSpec): string;
type PressHeldReason = "kind_off" | "no_token" | "no_telegram" | "no_chat" | "cap" | "before_on";
export type PeopleMessageRefusal = "never_wrote" | "blocked";
/** The press's button, to whom: «Отправить Алексу в Telegram»; a name without its case: «Отправить в Telegram: Rick». */
export declare function peopleMessagePressLabel(name: string, toWhom: string | null): string;
/** The one quiet line in place of the button: why the press cannot reach the person. */
export declare function peopleMessageCannotLine(why: "no_telegram" | PeopleMessageRefusal): string;
/** What became of the press, in one sentence: never a silent success. `toWhom` — «Алексу», else the name. */
export declare function peopleMessagePressWords(outcome: {
    state: "held" | "sending" | "sent" | "failed" | "unknown" | "duplicate";
    reason: PressHeldReason | null;
    refusal?: PeopleMessageRefusal | undefined;
}, toWhom: string): string;
export {};
