import { type CustomOrderAction, type CustomOrderCard, type CustomOrderState } from "./custom-orders";
/**
 * The board's steps, and the readers' own: a delivery message, a revision fixed, another message, a delivery taken
 * back; and the server's own `settle` — the order put where its kept messages say (an import stores messages
 * without a step).
 */
export type CustomStepName = CustomOrderAction | "delivery" | "revision_done" | "message" | "retract" | "settle";
export declare function isBoardAction(step: CustomStepName): step is CustomOrderAction;
/** The states a delivery moves the order from (to «сдан частично», «снят» or back to «правка»). */
export declare const DELIVERY_MOVES_FROM: readonly CustomOrderState[];
/** The states each step may be taken from. A step that moves the order names its new state in `STEP_TO`. */
export declare const STEP_FROM: Readonly<Record<CustomStepName, readonly CustomOrderState[]>>;
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
    /** The pages whose orders the viewer READS: the team's cut (services/teams.ts) and the login's own pages. */
    pageIds: readonly number[];
    /**
     * The pages the viewer WORKS: the login's own pages (user_page_assignments). A write of the chat's side — «оплата»,
     * «отдан», «Записать кастом» — goes by these (and the step's leader, the owner), never by the team's read cut:
     * «видит команду» of another model reads its orders and changes none. Absent — `pageIds`, as before the cut.
     */
    workPageIds?: readonly number[];
    /** «Ведёт кастомы» (the person right): the steps of an order of no known page. */
    lead: boolean;
    /**
     * The pages whose orders' steps the viewer leads, by phase (products plan §4.5; the one rule is the server's,
     * services/custom-orders/leaders.ts): `check` — «Проверен» and the card's fixes, `shoot` — the content side's steps.
     * Absent: every lead's step by `lead` and the role, as before the rule.
     */
    leads?: {
        check: readonly number[];
        shoot: readonly number[];
    };
    /**
     * The test realm (0414, apps/runtime/src/services/sandbox/realm.ts): whether the viewer is a test person's login, and
     * the test pages. A live viewer never sees a test page's order, a test viewer only those. Absent: no test realm.
     */
    realm?: {
        test: boolean;
        testPageIds: readonly number[];
    };
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
/**
 * The side of an order's step: `check` — recorded, the card checked and given to shooting (the chat's side, Workboard);
 * `shoot` — handed to the model, delivered, revision, refusal, shot (ContentOps «Съёмка»); `give` — given to the fan
 * (the chatter, Workboard). Null — an ended order.
 */
export type CustomPhase = "check" | "shoot" | "give";
export declare function customPhaseOf(state: CustomOrderState): CustomPhase | null;
/** Where a phase is done. */
export declare function customPhaseProduct(phase: CustomPhase): "workboard" | "contentops";
/** Whether the viewer leads a phase of the order (the owner always; an order of no page: the person right, a team lead). */
export declare function leadsPhase(viewer: CustomViewer, order: {
    pageId: number | null;
}, phase: "check" | "shoot"): boolean;
/**
 * Whether the viewer works a page: the owner every page; else the login's own pages (`workPageIds`), or a page whose
 * order's step they lead. An order of no known page: the lead's steps' holders.
 */
export declare function worksOnPage(viewer: CustomViewer, pageId: number | null): boolean;
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
/** The parts the order still waits for: the card orders them and they are not ready in the current round. */
export declare function waitedParts(order: {
    card: CustomOrderCard;
    partsDone: ReadonlyArray<"video" | "photos">;
}): Array<"video" | "photos">;
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
