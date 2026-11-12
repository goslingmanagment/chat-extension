import { CUSTOM_ORDER_ACTIONS, customOrderCardSchema, customOrderCode, } from "./custom-orders";
/**
 * Заказ кастома: the rules every door shares, pure — who may take which step
 * from which state, the parts an order wants and its overdue days, the card
 * «📦 Описание заказа» as text. Hub's server enforces them
 * (apps/runtime services/custom-orders); Workboard and the demo read them.
 */
const OPEN = ["recorded", "paid", "at_model", "partly", "shot", "revision", "refused"];
const NOT_ENDED = [...OPEN, "given"];
const ALL = [...NOT_ENDED, "closed", "cancelled"];
const BOARD_ACTIONS = new Set(CUSTOM_ORDER_ACTIONS);
export function isBoardAction(step) {
    return BOARD_ACTIONS.has(step);
}
/** The states each step may be taken from. A step that moves the order names its new state in `STEP_TO`. */
export const STEP_FROM = {
    edit: NOT_ENDED,
    deadline: OPEN,
    fan: NOT_ENDED,
    card: ALL,
    // «100$ после готовности»: a payment may come at any step, after «отдали» too; never to a cancelled order.
    payment: [...NOT_ENDED, "closed"],
    unpay: NOT_ENDED,
    at_model: ["recorded", "paid", "refused"],
    partly: ["at_model", "partly", "revision"],
    shot: ["at_model", "partly", "revision"],
    // A fan's complaint after «отдали» is a revision too; one more request while it is in revision as well.
    revision: ["partly", "shot", "revision", "given"],
    refused: ["at_model", "partly", "revision"],
    given: ["recorded", "paid", "at_model", "partly", "shot", "revision"],
    close: ["given"],
    cancel: OPEN,
    // A delivery is kept in every state (its sender must know it is in the hub); it moves the order only from the
    // states before «снят» and from a revision (DELIVERY_MOVES_FROM): it proves the card reached the model.
    delivery: ALL,
    revision_done: NOT_ENDED,
    message: ALL,
    retract: ALL,
};
/** The states a delivery moves the order from (to «сдан частично», «снят» or back to «правка»). */
export const DELIVERY_MOVES_FROM = ["recorded", "paid", "at_model", "partly", "revision"];
export const STEP_TO = {
    at_model: "at_model",
    partly: "partly",
    shot: "shot",
    revision: "revision",
    refused: "refused",
    given: "given",
    close: "closed",
    cancel: "cancelled",
};
/**
 * Each state in people's words: the one table for every door that names an order's step — the board «Кастомы»
 * in Workboard and the extension's fan panel (the wire's `stepLabel`, shown as it is).
 */
export const CUSTOM_STATE_WORDS = {
    recorded: "Записан",
    paid: "Оплачен",
    at_model: "У модели",
    partly: "Сдан частично",
    shot: "Снят",
    revision: "Правка",
    refused: "Отказ модели",
    given: "Отдан фану",
    closed: "Закрыт",
    cancelled: "Отменён",
};
/** The lead's steps belong to the lead, the owner and a team lead. */
export function leadsSteps(viewer) {
    return viewer.lead || viewer.role === "owner" || viewer.role === "team_lead";
}
/**
 * Whether the viewer sees the order: the lead and the owner every one; a team lead the orders of their pages and
 * those of no known page; a chatter only the orders of the pages they reach.
 */
export function seesOrder(viewer, order) {
    if (viewer.lead || viewer.role === "owner")
        return true;
    if (order.pageId === null)
        return viewer.role === "team_lead";
    return viewer.pageIds.includes(order.pageId);
}
/** A chatter's steps: a payment, «отдали»; on their own order also its card, its fan and «отменить». */
const CHATTER_STEPS = new Set(["payment", "given"]);
const OWN_ORDER_STEPS = new Set(["edit", "fan", "unpay", "cancel"]);
/** Whether the viewer may take `step` on the order now (its state included). */
export function mayTakeStep(viewer, order, step) {
    if (!seesOrder(viewer, order))
        return false;
    if (!STEP_FROM[step].includes(order.state))
        return false;
    if (leadsSteps(viewer))
        return true;
    if (CHATTER_STEPS.has(step))
        return true;
    return OWN_ORDER_STEPS.has(step) && order.acceptedByUserId === viewer.userId;
}
/** The steps the viewer may take on the order now, in the board's order. */
export function stepsFor(viewer, order) {
    return CUSTOM_ORDER_ACTIONS.filter((step) => mayTakeStep(viewer, order, step));
}
/** The parts the card orders: a video unless it says none, and photos when it names how many. */
export function wantedParts(card) {
    const parts = [];
    if (card.wantsVideo !== false)
        parts.push("video");
    if ((card.wantsPhotos ?? 0) > 0)
        parts.push("photos");
    return parts.length === 0 ? ["photos"] : parts;
}
/** Days past the deadline while the model has not delivered it whole (as ContentOps counts «просрочено»); null — not overdue. */
export function overdueDaysOf(order, now) {
    if (!["recorded", "paid", "at_model", "partly", "revision"].includes(order.state) || order.deadlineOn === null)
        return null;
    const today = moscowDay(now);
    if (today <= order.deadlineOn)
        return null;
    return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${order.deadlineOn}T00:00:00Z`)) / 86_400_000);
}
// ── The card ────────────────────────────────────────────────────────────────
/** The stored card, its known fields only (a field the contract no longer knows is dropped, never served). */
export function cardOf(stored) {
    const card = {};
    for (const key of Object.keys(customOrderCardSchema.shape)) {
        const value = stored[key];
        if (value !== undefined && value !== null && value !== "")
            card[key] = value;
    }
    const parsed = customOrderCardSchema.safeParse(card);
    if (parsed.success)
        return parsed.data;
    // A field past today's limits (an older import): each field alone, the bad ones out.
    const kept = {};
    for (const [key, value] of Object.entries(card)) {
        if (customOrderCardSchema.safeParse({ [key]: value }).success)
            kept[key] = value;
    }
    return customOrderCardSchema.parse(kept);
}
/** What the order is, in one line: the task's first line without its number. */
export function whatOf(card) {
    const first = (card.task ?? card.photos ?? "").split("\n").map((line) => line.trim()).find((line) => line.length > 0 && line !== "-");
    const text = (first ?? card.duration ?? "").replace(/^\d+[.)]\s*/u, "").trim();
    if (text === "")
        return "Без описания";
    const chars = [...text];
    return chars.length > 140 ? `${chars.slice(0, 139).join("").trimEnd()}…` : text;
}
const MSK_OFFSET_MS = 3 * 3_600_000;
/** `YYYY-MM-DD` → `DD.MM.YYYY`. */
export function dottedDay(day) {
    const [year, month, date] = day.split("-");
    return `${date}.${month}.${year}`;
}
/** The Moscow day of a moment, `YYYY-MM-DD`. */
export function moscowDay(at) {
    return new Date(at.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}
/** The deadline is behind: its Moscow day has ended. */
export function deadlinePassed(deadlineOn, now) {
    return deadlineOn !== null && moscowDay(now) > deadlineOn;
}
/** The buyer's link as the card prints it: Fansly `…/<username>/posts`, OnlyFans `…/<username>` or `…/u<number>`. */
export function buyerLinkOf(fan) {
    if (fan.platform === "fansly")
        return fan.username ? `https://fansly.com/${fan.username}/posts` : `https://fansly.com/${fan.fanRef}`;
    return fan.username ? `https://onlyfans.com/${fan.username}` : `https://onlyfans.com/u${fan.fanRef}`;
}
const dash = (value) => (value === undefined || value.trim() === "" ? "-" : value.trim());
/**
 * «Скопировать карточку»: the card in the exact text of today's card (Gengar's skill `custom-tz`, the team's
 * template), the order's code beside the title. An empty section prints «-», as the team does.
 */
export function renderCardText(input) {
    const { card } = input;
    const photoSet = card.duration !== undefined && /фото/iu.test(card.duration) && !/мин|min/iu.test(card.duration);
    const lines = [
        `📦 Описание заказа ${customOrderCode(input.id)}`,
        `Дата: ${card.date ?? dottedDay(moscowDay(input.createdAt))}`,
        `Покупатель: ${input.fan !== null ? buyerLinkOf(input.fan) : dash(input.buyer ?? undefined)}`,
    ];
    if (card.name)
        lines.push(`Имя: ${card.name}`);
    lines.push(`Оплата: ${dash(card.price)}`, `Длительность: ${dash(card.duration)}`, "");
    lines.push(`${photoSet ? "📸" : "🎥"} Описание задания:`, dash(card.task), "");
    if (card.photos)
        lines.push("📸 Фото:", card.photos, "");
    lines.push("👗 Одежда:", dash(card.clothes), "");
    if (card.face)
        lines.push(`🙈 Лицо: ${card.face}`, "");
    lines.push("🗒 Заметки:", dash(card.notes), "");
    lines.push(`🔥Срочность: ${dash(card.urgency)}`);
    lines.push(`⏳Сроки: ${input.deadlineOn !== null ? `До ${dottedDay(input.deadlineOn)}` : dash(card.deadlineNote)}`);
    if (card.attachments && card.attachments.length > 0)
        lines.push("", ...card.attachments);
    return lines.join("\n");
}
