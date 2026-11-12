import { type CustomOrderAction, type CustomOrderCard, type CustomOrderState } from "./custom-orders";
/** The board's steps, and the readers' own: a delivery message, a revision fixed, another message, a delivery taken back. */
export type CustomStepName = CustomOrderAction | "delivery" | "revision_done" | "message" | "retract";
export declare function isBoardAction(step: CustomStepName): step is CustomOrderAction;
/** The states each step may be taken from. A step that moves the order names its new state in `STEP_TO`. */
export declare const STEP_FROM: Readonly<Record<CustomStepName, readonly CustomOrderState[]>>;
/** The states a delivery moves the order from (to «сдан частично», «снят» or back to «правка»). */
export declare const DELIVERY_MOVES_FROM: readonly CustomOrderState[];
export declare const STEP_TO: Partial<Readonly<Record<CustomOrderAction, CustomOrderState>>>;
/**
 * Each state in people's words: the one table for every door that names an order's step — the board «Кастомы»
 * in Workboard and the extension's fan panel (the wire's `stepLabel`, shown as it is).
 */
export declare const CUSTOM_STATE_WORDS: Readonly<Record<CustomOrderState, string>>;
/** Who looks at an order: a person of a role, the lead (the right «ведёт кастомы»), and the pages they reach. */
export interface CustomViewer {
    userId: number;
    role: "owner" | "team_lead" | "chatter";
    /** The pages the person reaches (user_page_assignments). */
    pageIds: readonly number[];
    /** «Ведёт кастомы». */
    lead: boolean;
}
/** The lead's steps belong to the lead, the owner and a team lead. */
export declare function leadsSteps(viewer: CustomViewer): boolean;
/**
 * Whether the viewer sees the order: the lead and the owner every one; a team lead the orders of their pages and
 * those of no known page; a chatter only the orders of the pages they reach.
 */
export declare function seesOrder(viewer: CustomViewer, order: {
    pageId: number | null;
}): boolean;
/** Whether the viewer may take `step` on the order now (its state included). */
export declare function mayTakeStep(viewer: CustomViewer, order: {
    pageId: number | null;
    state: CustomOrderState;
    acceptedByUserId: number | null;
}, step: CustomOrderAction): boolean;
/** The steps the viewer may take on the order now, in the board's order. */
export declare function stepsFor(viewer: CustomViewer, order: {
    pageId: number | null;
    state: CustomOrderState;
    acceptedByUserId: number | null;
}): CustomOrderAction[];
/** The parts the card orders: a video unless it says none, and photos when it names how many. */
export declare function wantedParts(card: CustomOrderCard): Array<"video" | "photos">;
/** Days past the deadline while the model has not delivered it whole (as ContentOps counts «просрочено»); null — not overdue. */
export declare function overdueDaysOf(order: {
    state: CustomOrderState;
    deadlineOn: string | null;
}, now: Date): number | null;
/** The stored card, its known fields only (a field the contract no longer knows is dropped, never served). */
export declare function cardOf(stored: Record<string, unknown>): CustomOrderCard;
/** What the order is, in one line: the task's first line without its number. */
export declare function whatOf(card: CustomOrderCard): string;
/** `YYYY-MM-DD` → `DD.MM.YYYY`. */
export declare function dottedDay(day: string): string;
/** The Moscow day of a moment, `YYYY-MM-DD`. */
export declare function moscowDay(at: Date): string;
/** The deadline is behind: its Moscow day has ended. */
export declare function deadlinePassed(deadlineOn: string | null, now: Date): boolean;
/** The buyer's link as the card prints it: Fansly `…/<username>/posts`, OnlyFans `…/<username>` or `…/u<number>`. */
export declare function buyerLinkOf(fan: {
    platform: string;
    fanRef: string;
    username: string | null;
}): string;
/**
 * «Скопировать карточку»: the card in the exact text of today's card (Gengar's skill `custom-tz`, the team's
 * template), the order's code beside the title. An empty section prints «-», as the team does.
 */
export declare function renderCardText(input: {
    id: number;
    card: CustomOrderCard;
    deadlineOn: string | null;
    createdAt: Date;
    buyer: string | null;
    fan: {
        platform: string;
        fanRef: string;
        username: string | null;
    } | null;
}): string;
