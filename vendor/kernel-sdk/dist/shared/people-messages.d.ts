/** What a message's stored text becomes when the fan it names is erased (the row, its kind, time and state stay). */
export declare const PEOPLE_MESSAGE_ERASED_TEXT = "\u0442\u0435\u043A\u0441\u0442 \u0441\u0442\u0451\u0440\u0442 \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u0444\u0430\u043D\u043E\u043C";
/** Every kind, in the owner's list order (stop-list М1–М3). */
export declare const PEOPLE_MESSAGE_KINDS: readonly ["shift.report.copy", "custom.card.to_model", "shift.report.missing", "custom.shot.give", "claim.confirm", "payout.text", "newcomer.invite"];
export type PeopleMessageKind = (typeof PEOPLE_MESSAGE_KINDS)[number];
export declare function isPeopleMessageKind(value: string): value is PeopleMessageKind;
/** The turned-on kinds and since when. */
export type PeopleMessageKindsOn = Partial<Record<PeopleMessageKind, Date>>;
/** A chat and, in a forum group, its topic. */
export interface PeopleMessageChat {
    chatId: string;
    topicId: number | null;
}
export interface PeopleMessageModelChats {
    /** «Отчётность»: the chatters' group of the model. */
    reports?: PeopleMessageChat;
    /** Customs: the model's own group. */
    customs?: PeopleMessageChat;
}
export type PeopleMessageChats = Record<string, PeopleMessageModelChats>;
type Parse<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: string;
};
export declare function parsePeopleMessageKinds(text: string): Parse<PeopleMessageKindsOn>;
export declare function parsePeopleMessageChats(text: string): Parse<PeopleMessageChats>;
/** The stored value, parsed; an unset or unparsable one turns nothing on. */
export declare function peopleMessageKindsOf(text: string | undefined): PeopleMessageKindsOn;
/** The stored value, parsed; an unset or unparsable one names no chat. */
export declare function peopleMessageChatsOf(text: string | undefined): PeopleMessageChats;
/** The kinds setting's text with one kind turned on at `at` or off; the others as they were. */
export declare function withPeopleMessageKind(text: string | undefined, kind: PeopleMessageKind, on: boolean, at: Date): string;
export {};
