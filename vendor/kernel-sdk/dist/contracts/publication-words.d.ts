/** A status as one word (the journal, a refusal «уже другой статус»). */
export declare const PUBLICATION_STATUS_WORDS: Readonly<Record<string, string>>;
/** A status's reason (or a journal row's) in words; null — no reason. */
export declare function statusReasonWords(reason: string | null): string | null;
export declare function autostopReasonWords(reason: string | null): string | null;
/** Why Hub refused to approve one publication. */
export declare function approveRefusalWords(reason: string | null): string;
/** Why a platform's schedule was read incompletely, in words (the permanent «whole list unverified» left out). */
export declare function queueIncompleteWords(reasons: readonly string[]): string;
/** One withdrawal's outcome in words. */
export declare function withdrawResultWords(result: {
    outcome: string;
    reason: string | null;
}): string;
/** One deletion's answer in words. */
export declare function deleteResultWords(result: {
    outcome: string;
    reason: string | null;
}): string;
/**
 * What happened to the withdrawal or the deletion Hub sent, while the status alone does not say it: a withdrawal of a
 * post still «В расписании», a deletion of a post still «Вышел». Null — nothing to say.
 */
export declare function commandNoteWords(publication: {
    status: string;
    platform: string;
    withdrawal: {
        state: string;
    } | null;
    deletion: {
        state: string;
    } | null;
}): string | null;
export interface FindingLike {
    code: string;
    severity: string;
    mediaKey: string | null;
    at: string | null;
    publicationId: number | null;
    detail: Readonly<Record<string, number | string | null>>;
}
export interface MediaLike {
    role: string;
    position: number;
    source: string;
    mediaRef?: string | null;
    fileId?: number | null;
    name?: string | null;
}
export declare function bytesWords(bytes: number): string;
/** One check of a draft as a person reads it. */
export declare function findingWords(finding: FindingLike, media?: readonly MediaLike[]): string;
export declare function albumStopWords(code: string | null): string;
export interface AlbumReasonPart {
    text: string;
    /** The files it names, by name. */
    names: string[];
}
/** An album's reason in parts, or null when it is not an album's. */
export declare function albumReasonParts(reason: string | null): AlbumReasonPart[] | null;
/** An album's reason as one line: its first part, and how many more. */
export declare function albumReasonLine(reason: string | null): string | null;
export declare function creditsWords(value: number): string;
/** «≈ $8,17»: dollars of credits (display only). */
export declare function creditsUsdWords(credits: number, centsPer1000: number): string;
export interface AlbumRunLike {
    step: string | null;
    files: number;
    done: number;
    reused: number;
    refused: number;
    unknown: number;
    notTried: number;
    tooBig: number;
    currentFile: string | null;
    estimateCredits: number;
    spentCredits: number;
    stopReason: string | null;
    fileList: ReadonlyArray<{
        name: string;
        bytes: number;
        state: string;
        credits: number;
    }>;
    account: {
        dailyCredits: number;
        spentToday: number;
        left: number;
        balance: number | null;
        centsPer1000: number;
    } | null;
    linkMaxBytes: number;
}
/** A vault album's run as a person reads it: the progress, the files left out, the price and the day's ceiling. */
export interface AlbumRunWords {
    /** «Залито 31 из 87», or «87 файлов» before it starts. */
    landed: string;
    /** The file going up now. */
    current: string | null;
    /** «Отказ 2 · Исход неизвестен 1 · Руками, больше 1 ГБ 1 · Не пробовали 3». */
    missing: string | null;
    /** Why the uploads stopped. */
    stop: string | null;
    /** «Цена 5 486 кредитов ≈ $8,17» before, «Потрачено 1 200 из 5 486 кредитов» after it starts. */
    price: string;
    /** «Потолок альбомов в сутки 20 000 кредитов · потрачено сегодня 3 000 · осталось 17 000». */
    ceiling: string | null;
    files: Array<{
        name: string;
        size: string;
        state: string;
    }>;
}
export declare function albumRunWords(run: AlbumRunLike): AlbumRunWords;
