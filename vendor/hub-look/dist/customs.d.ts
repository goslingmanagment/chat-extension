/** «осталось 2 дня, до 17.11», «сегодня последний день», «просрочен на 3 дня», or nothing without a deadline. */
export declare function customDeadlineWords(order: {
    readonly deadlineOn: string | null;
    readonly overdueDays: number | null;
    readonly state: string;
}, serverNow: string): {
    text: string;
    late: boolean;
} | null;
/** «У кого сейчас»: who leads the order's current step, and where («в ContentOps» for the shooting); null — nobody named. */
export declare function customLeaderWords(leader: {
    readonly name: string | null;
    readonly product: string;
} | null): string | null;
