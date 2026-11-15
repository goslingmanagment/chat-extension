/**
 * The NARROW web session (ecosystem plan §3.2 p.4): the one the chat extension
 * opens in the browser from its device token, without a password
 * (`authWebLink` → `authSsoAccept`). Its row carries the device token it lives
 * by (`auth_sessions.narrow_device_token_id`); it stops signing in the moment
 * that token is revoked or expires.
 *
 * It opens only the team's place: the API server refuses every route outside
 * this list with a reason-less 403, whatever the person's role — an owner's
 * device included — and `requireDashboardUser` refuses it, so no owner or team
 * route, stream, export, screen or document opens with it. Routes that take no
 * principal (`public`, `hmac`) are not subject to it: sign-out works.
 *
 * The list is what the chatter's part of Workboard reads and does (`apps/workboard`:
 * «Мои смены» and a shift's report, «Кастомы», «Начало»): every operation a
 * screen of the chatter's menu or name menu calls is either here or on
 * NARROW_WEB_SESSION_PASSWORD_ONLY below, and the screen says so — the test
 * `tests/narrow-session-screens.test.ts` walks the screens' code and fails on
 * anything else. Never on it: a route of the account's credentials (devices,
 * password), where a person is paid, any owner or team-lead route, the
 * hand-off's own mint (a narrow session never travels to another name).
 * A read on it that could carry where a person is paid leaves it out for a
 * narrow session (the hand-off's integration test walks every read of the
 * list for it). Services read a narrow session as a chatter whatever the role.
 */
export declare const NARROW_WEB_SESSION_OPERATIONS: readonly ["me", "accountChatterStats", "accountShiftNumbers", "accountReports", "mattersList", "mattersWaiting", "accountShifts", "workboardToday", "shiftReport", "shiftReportsList", "shiftReportClaimable", "shiftReportLineSet", "shiftReportCommentSet", "shiftReportOffPlatformAdd", "shiftReportOffPlatformWithdraw", "shiftReportSubmit", "shiftReportCurrent", "shiftReportConfirm", "shiftReportReopen", "shiftReportReopenCancel", "shiftReportResend", "shiftReportAsk", "shiftReportAskWithdraw", "shiftReportProposalAnswer", "shiftReportSightingAdd", "shiftReportPostCopied", "saleClaimAnswer", "saleChain", "accountPay", "shiftReportNotes", "customOrdersBoard", "customOrder", "customOrderCreate", "customOrderAct", "customSaleDismiss", "pages", "accountStart", "teamPeople", "teamShifts", "teamShiftSales", "teamChatterStats", "teamChatterNumbers", "teamAuthorship", "teamSalesPpv", "teamSalesReplies", "teamSalesList", "teamQuestions", "teamQuestionAsk", "teamSwaps", "teamQuestionClose", "learnPages", "learnPage", "teamEmptyHours", "teamGreetings", "teamWinBackResults", "teamShiftReview", "reviewNotes", "spenders", "spenderDetail", "spenderSeries", "spenderBatch", "pageSpenderAutoLists", "pageSpenderAutoListDetail", "pageSubscribers", "pageFollowers", "pageDeletedFans", "pageFanCard", "pageFanDetail", "pageFanProfile", "pageFanProfileVersions", "pageFanProfileVersion", "pageFanTransactions", "pageFanWorkedWith", "crossPageFanDetail", "crossPageFanTransactions", "pageConversationPreview", "fanPages"];
/**
 * What a screen of the chatter's part calls and a narrow session must NOT do:
 * a change that needs the person's password behind it. The screen shows the
 * person the way in instead (Workboard's `PasswordWayIn`: «чтобы изменить,
 * войдите на сайте с паролем»), never an error. Not one of these is on the
 * list above.
 */
export declare const NARROW_WEB_SESSION_PASSWORD_ONLY: readonly ["accountPayoutDetailsSet", "authListDevices", "authRevokeDevice", "authRevokeAllDevices", "authChangePassword", "authMyUsage", "reviewNoteAdd", "teamSwapRevoke", "createFanNote", "teamQuestionAnswer", "learnPageApprove"];
/** Whether a narrow web session may call the route with this key. */
export declare function narrowWebSessionAllows(operationKey: string): boolean;
