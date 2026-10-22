// UI actions (architecture.md §10.2 «Действия UI»): the only way the UI asks
// for anything. The UI holds opaque handles and operation/part numbers, never
// a target, a persona, a model or a provider address; the controller fills in
// the target and the policy and re-checks ownership of every result, variant
// and part before an insert or a send. Objects are strict: an extra key is a
// rejection, so the UserOptions allowlist holds at run time too.

import * as z from 'zod/mini';

import { CgCodeSchema, SettingsRouteSchema } from '../errors';
import { FeatureIdSchema, ToneSchema } from '../features';
import { MediaFolderIdSchema } from '../send-media';
import { NativeIdSchema, PersonaKeySchema, UuidSchema, boundedText, displayText } from '../primitives';
import { SettingsV1Schema, UI_TEXT_SIZES } from '../settings';
import type { VoiceTone } from '../voice';
import { AI_REQUEST_LIMITS, COACH_LIMITS, PART_LIMITS, SEND_LIMITS, SIGN_IN_LIMITS } from '../limits';
import { type SpendersPeriodSchema } from '../tab-messages';
import { BATCH_LISTS } from './batch';

/** The old Fansly extension's persona export may carry the old local persona texts too: a generous bound. */
export const LEGACY_PERSONAS_MAX_CHARS = 4_000_000;
import { HandleSchema, JOURNAL_KINDS, MOUNT_SURFACES, OVERLAY_SURFACES, ViewSelectorSchema } from './selectors';

const ui = SettingsV1Schema.shape.ui.shape;
const generation = SettingsV1Schema.shape.generation.shape;
const sound = SettingsV1Schema.shape.sound.shape;
const debug = SettingsV1Schema.shape.debug.shape;
const onboarding = SettingsV1Schema.shape.onboarding.shape;

/**
 * Settings the UI changes directly with SetPreference, by their path in
 * SettingsV1, each with the value schema of that setting. Maps (account
 * labels, muted accounts, persona per page) have their own actions; the
 * background owns the write and answers with a revision (ST-013…ST-015).
 * `hub.*` and `debug.*` are written only from the options page
 * (`settings.patchRestricted`); a tab's controller refuses them.
 */
export const PREFERENCE_VALUE_SCHEMAS = {
  'hub.baseUrl': SettingsV1Schema.shape.hub.shape.baseUrl,
  'ui.theme': ui.theme,
  'ui.locale': ui.locale,
  'ui.hints': ui.hints,
  'ui.resultStyle': ui.resultStyle,
  // 1.26.0 (X55): stored as optional (absent — normal), set as one of the two sizes.
  'ui.textSize': z.enum(UI_TEXT_SIZES),
  'generation.split': generation.split,
  // 1.18.0 (X45): stored as optional (absent — on), set as a plain boolean.
  'generation.rememberTone': z.boolean(),
  'generation.windows.quick': generation.windows.shape.quick,
  'generation.windows.ping': generation.windows.shape.ping,
  'generation.windows.improve': generation.windows.shape.improve,
  'generation.windows.deep': generation.windows.shape.deep,
  'generation.coach.historyLimit': generation.coach.shape.historyLimit,
  'generation.coach.autoRecap': generation.coach.shape.autoRecap,
  'sound.messages.on': sound.messages.shape.on,
  'sound.messages.tone': sound.messages.shape.tone,
  'sound.subscribers.on': sound.subscribers.shape.on,
  'sound.subscribers.tone': sound.subscribers.shape.tone,
  'sound.volume': sound.volume,
  'debug.enabled': debug.enabled,
  'debug.renderTrace': debug.renderTrace,
  'onboarding.checklistDismissed': onboarding.checklistDismissed,
  'onboarding.keysFooter.dismissed': onboarding.keysFooter.shape.dismissed,
} as const;

export type PreferenceKey = keyof typeof PREFERENCE_VALUE_SCHEMAS;
export const PREFERENCE_KEYS = Object.keys(PREFERENCE_VALUE_SCHEMAS) as PreferenceKey[];
export const PreferenceKeySchema = z.enum(PREFERENCE_KEYS as [PreferenceKey, ...PreferenceKey[]]);
export type PreferenceValues = { readonly [K in PreferenceKey]: z.infer<(typeof PREFERENCE_VALUE_SCHEMAS)[K]> };

/**
 * The allowlist of what a person may choose for one generation (§10.2):
 * tone (Reply only, one-off, Б1), Split (Б7), the message window (clamped by
 * the controller to settings and bootstrap `deepMax`), the variant count (Hi),
 * the Coach question, preset and «приложить мой ответ». The Recap mode is the
 * feature itself (`recap` / `recap-short`). No persona, model or provider.
 */
export const UserOptionsSchema = z.strictObject({
  tone: z.optional(z.nullable(ToneSchema)),
  split: z.optional(z.boolean()),
  window: z.optional(z.int().check(z.gte(AI_REQUEST_LIMITS.messageCountMin), z.lte(AI_REQUEST_LIMITS.messageCountMax))),
  variants: z.optional(z.union([z.literal(1), z.literal(3)])),
  question: z.optional(boundedText(COACH_LIMITS.questionMaxChars)),
  preset: z.optional(z.literal('situation')),
  attachMyDraft: z.optional(z.boolean()),
});
export type UserOptions = z.infer<typeof UserOptionsSchema>;

/** Where Navigate goes. Host navigation happens only on a human click or key, through the dispatcher (§6.9). */
export const NavigationTargetSchema = z.discriminatedUnion('kind', [
  /** Open a fan's chat in ChatSpace: «Открыть чат», «Перейти», a palette or quick-jump row, a toast. */
  z.strictObject({ kind: z.literal('chat'), targetHandle: HandleSchema }),
  /** J / K over the chat list the person sees. */
  z.strictObject({ kind: z.literal('chat-step'), direction: z.enum(['next', 'previous']) }),
  /** ⌘U / Ctrl+U. */
  z.strictObject({ kind: z.literal('next-unread') }),
  /** ⌘1–9: the N-th chat of the visible list. */
  z.strictObject({ kind: z.literal('chat-slot'), slot: z.int().check(z.gte(1), z.lte(9)) }),
  /** «к вкладке» of an OnlyMonster account (Б13). */
  z.strictObject({ kind: z.literal('account'), accountHandle: HandleSchema }),
  z.strictObject({ kind: z.literal('surface'), surface: z.enum(OVERLAY_SURFACES), open: z.boolean() }),
  z.strictObject({ kind: z.literal('page'), page: z.enum(['whats-new', 'changelog']) }),
  /** 1.35.0 (X61): the popup's «Открыть ChatSpace» — the build's own site in a new tab, at its address of the manifest. */
  z.strictObject({ kind: z.literal('site-home') }),
  /** debug-prompt.html with the snapshot's opaque token (DB-007). */
  z.strictObject({ kind: z.literal('debug-prompt'), promptHandle: HandleSchema }),
  z.strictObject({ kind: z.literal('journal'), journal: z.enum(JOURNAL_KINDS) }),
]);
export type NavigationTarget = z.infer<typeof NavigationTargetSchema>;

export type SpendersPeriod = z.infer<typeof SpendersPeriodSchema>;
/** The board periods (same list as the `spenders.board` request, pinned by a test); kept local so actions do not load the tab registry. */
const SpendersPeriodChoiceSchema = z.enum(['lifetime', '30d', 'mtd', '7d', 'today'] as const satisfies readonly SpendersPeriod[]);
/**
 * Board filters (SP-008…SP-010): one pressed at a time per group, the controller decides the grouping. 1.44.0: the
 * fans silent 8–21 and more than 21 full days since their last message (§8.7 «Молчание»; the statistics' «Кому
 * написать» opens them).
 */
export const SPENDERS_FILTERS = ['all', 'waiting', 'new', 'we-wrote', 'fan-wrote', 'history', 'no-history', 'silent-8-21', 'silent-over-21'] as const;
export type SpendersFilter = (typeof SPENDERS_FILTERS)[number];
/**
 * 1.44.0: a click on a column's header. `sum` — «Потратил», by the lifetime under the tiers' headers; `waiting` — «Ждёт
 * ответа», the fans who wait first, the longest waiting on top, then the rest by the lifetime; `we-wrote` — «Мы
 * писали», the longest since our last message first; `period` — the period's column. The last two are one flat list.
 */
export const SPENDERS_SORTS = ['sum', 'waiting', 'we-wrote', 'period'] as const;
export type SpendersSort = (typeof SPENDERS_SORTS)[number];

export const NEWCOMERS_TABS = ['todo', 'all'] as const;
export type NewcomersTab = (typeof NEWCOMERS_TABS)[number];
/** Greeting status filters with counters (NF-008). */
export const GREETING_FILTERS = ['any', 'none', 'sending', 'stopped', 'greeted', 'replied'] as const;
export type GreetingFilter = (typeof GREETING_FILTERS)[number];
/** «Новые» window, hours (§8.5: quick 24/48/72/168, any 1–720 within bootstrap `audienceWindowHours`). */
export const NEWCOMERS_WINDOW_HOURS = { min: 1, max: 720, quick: [1, 3, 6, 12, 24, 48, 72, 168, 336, 720], default: 48 } as const;

/**
 * 1.15.0 (R20 P10a): the status filters of a list a background pass checks (NF-006; `NewcomersVM.pass`): «Не писали»,
 * «В очереди», «Ждёт ответа», «Не проверены», «Нельзя написать», «Уже писали».
 */
export const NEWCOMER_CHECK_FILTERS = ['any', 'ready', 'pending', 'reply', 'unchecked', 'dm-closed', 'contacted'] as const;
export type NewcomerCheckFilter = (typeof NEWCOMER_CHECK_FILTERS)[number];

export const RECAP_LENGTHS = ['short', 'full'] as const;
export type RecapLength = (typeof RECAP_LENGTHS)[number];

/** Recap and Review of the open chat: the two analysis views of the dock sheet (ui-design §4.11). */
export const ANALYSIS_VIEWS = ['recap', 'review'] as const;
export type AnalysisView = (typeof ANALYSIS_VIEWS)[number];
/** Where an analysis view is shown: the dock sheet, the «Развернуть ↗» dialog (UI-014), or hidden (kept). */
export const ANALYSIS_MODES = ['sheet', 'expanded', 'hidden'] as const;
export type AnalysisMode = (typeof ANALYSIS_MODES)[number];

/**
 * The studio's presets and the bound of the script it edits (voice.ts `VOICE_TONES` and the script cap of its limits),
 * repeated here so the UI's actions load no schema of the voice module (the dock's first chunk); a test holds both.
 */
export const VOICE_ACTION_TONES = ['calm', 'warm', 'playful'] as const satisfies readonly VoiceTone[];
export const VOICE_ACTION_SCRIPT_MAX_CHARS = 5_000;

const part = z.int().check(z.gte(0), z.lte(PART_LIMITS.maxParts - 1));
const variant = z.optional(z.int().check(z.gte(0), z.lte(PART_LIMITS.maxVariants - 1)));
const act = <T extends string, S extends z.core.$ZodLooseShape>(type: T, shape: S) => z.strictObject({ type: z.literal(type), ...shape });

const GenerateActionSchema = act('Generate', {
  targetHandle: HandleSchema,
  feature: FeatureIdSchema,
  options: UserOptionsSchema,
}).check(
  z.refine((a) => a.options.tone === undefined || a.options.tone === null || a.feature === 'reply', {
    message: 'a tone belongs to Reply only',
  }),
  z.refine((a) => a.options.variants === undefined || a.feature === 'hi', { message: 'variants belong to Hi only' }),
  z.refine(
    (a) => (a.options.question === undefined && a.options.preset === undefined && a.options.attachMyDraft === undefined) || a.feature === 'coach',
    { message: 'question, preset and attachMyDraft belong to Coach only' },
  ),
  z.refine((a) => a.options.split !== true || (a.feature !== 'recap' && a.feature !== 'recap-short' && a.feature !== 'review'), {
    message: 'Recap and Review are not messages to the fan: no Split',
  }),
);

const SetPreferenceActionSchema = act('SetPreference', { key: PreferenceKeySchema, value: z.unknown() }).check(
  z.refine((a) => PREFERENCE_VALUE_SCHEMAS[a.key].safeParse(a.value).success, { message: 'value does not fit the preference' }),
);

export const UiActionSchema = z.discriminatedUnion('type', [
  // ── generation and results (§10.2) ──
  GenerateActionSchema,
  /** «Ещё раз»: a new generation with the original's tone, bypassing the result cache (AI-007, AI-128). */
  act('Regenerate', { operationId: UuidSchema }),
  act('CancelGeneration', { operationId: UuidSchema }),
  /** «Скрыть»: collapses, keeps the result; the same click with the same parameters opens it again. */
  act('HideResult', { operationId: UuidSchema }),
  /** «Развернуть ↗» (UI-014). */
  act('ExpandResult', { operationId: UuidSchema, expanded: z.boolean() }),
  /** The one-off tone of the next Reply in this target; «Без тона» = null (AI-005, AI-008). */
  act('SetTone', { targetHandle: HandleSchema, tone: z.nullable(ToneSchema) }),
  /**
   * Split of the dock's next Reply and Fix (2026-10-22, as the old Fansly extension): for this tab's session only, never
   * stored. A new tab starts from the settings' «Split по умолчанию» (`generation.split`, SetPreference).
   */
  act('SetSplit', { split: z.boolean() }),
  act('InsertPart', { operationId: UuidSchema, variant, part }),
  /** Fix: the click is the consent for the revision Fix was made from (Б2). */
  act('ReplaceMyDraft', { operationId: UuidSchema, part }),
  /** «Вернуть мой текст», 30 s after Fix, CAS on the post-Fix revision. */
  act('RestoreMyDraft', { operationId: UuidSchema }),
  act('AnswerConfirm', { confirmationId: UuidSchema, choice: z.enum(['replace', 'append', 'cancel']) }),
  act('OpenAndInsertPart', { operationId: UuidSchema, variant, part }),
  /**
   * X8: a button click only; never a hotkey, never «send all», never the next
   * part by itself. `anyway` — «Отправить всё равно» on a freshness warning.
   */
  act('SendPart', { operationId: UuidSchema, variant, part, anyway: z.optional(z.literal(true)) }),
  /**
   * A preview part the person edits before sending (2026-10-20 audit, row 1): `text` — the part as it is to go (opens
   * the editor), null — back to the AI text. Local only: what «Отправить» then sends is this text.
   */
  act('EditPart', { operationId: UuidSchema, variant, part, text: z.nullable(displayText(SEND_LIMITS.previewDraftMaxChars)) }),
  /** «Отправить» of the preview's draft field: the person's own text, one message, by this click (row 1). */
  act('SendDraft', { targetHandle: HandleSchema }),
  act('OpenChatToVerify', { attemptId: UuidSchema }),
  /** Writes `copied` only after the clipboard write succeeded. */
  act('Copy', { artifactHandle: HandleSchema }),

  // ── previews, archive, Recap, Coach ──
  act('OpenPreview', { targetHandle: HandleSchema }),
  act('RefreshArchive', { targetHandle: HandleSchema }),
  /** Older feed pages by the server cursor when scrolling up (SP-053). */
  act('LoadOlder', { targetHandle: HandleSchema }),
  /** The local draft of a preview (Fix source, a greeting): never goes to ChatSpace by itself. */
  act('SetPreviewDraft', { targetHandle: HandleSchema, text: displayText(SEND_LIMITS.previewDraftMaxChars) }),
  /**
   * 1.30.0 (X53): the media picker of a preview — open or close it; choose a folder; read the next page of the folders
   * or of the folder's media; pick a medium or drop it (the order of the clicks is the message's); mark a pick a free
   * preview or take the mark off; the price as typed; drop every pick; read again what failed. None of it sends: the
   * picks go with the next part whose «Отправить» the person clicks.
   */
  act('SetMediaOpen', { targetHandle: HandleSchema, open: z.boolean() }),
  act('ChooseMediaFolder', { targetHandle: HandleSchema, folder: MediaFolderIdSchema }),
  act('LoadMoreMedia', { targetHandle: HandleSchema, what: z.enum(['folders', 'items']) }),
  act('PickMedia', { targetHandle: HandleSchema, mediaId: NativeIdSchema }),
  act('ToggleMediaFree', { targetHandle: HandleSchema, mediaId: NativeIdSchema }),
  act('SetMediaPrice', { targetHandle: HandleSchema, text: displayText(16) }),
  act('ClearMedia', { targetHandle: HandleSchema }),
  act('RetryMedia', { targetHandle: HandleSchema }),
  /**
   * «Коротко | Полностью», «Открыть последний»: shows a saved slot, never generates. 1.26.0 (X55): the full one opens in
   * the «Развернуть ↗» window; `panel` — asked from the fan panel's Recap tab, which shows it itself: no window over it.
   */
  act('ShowRecap', { length: z.enum(RECAP_LENGTHS), panel: z.optional(z.literal(true)) }),
  /** «↻ Обновить»: a new Recap from the fresh archive, bypassing the cache. `panel` (1.26.0, X55) — as for ShowRecap. */
  act('RefreshRecap', { length: z.enum(RECAP_LENGTHS), panel: z.optional(z.literal(true)) }),
  act('NewCoachDialog', {}),
  /** CG-RECAP-SAVE «Сохранить ещё раз»: the idempotent dossier reference write only, never a new generation. */
  act('RetryRecapSave', { length: z.enum(RECAP_LENGTHS) }),
  /**
   * Where Recap or Review of the open chat is shown (1.2.0): the dock sheet,
   * the «Развернуть ↗» dialog (UI-014) or hidden — kept, the same button opens
   * it again. They follow the open chat and may have no operation (a saved
   * Recap), so HideResult and ExpandResult, which name an operation, cannot
   * address them. Never generates: a Recap sheet with nothing saved shows the
   * picker («Собрать коротко / полностью»).
   */
  act('ShowAnalysis', { view: z.enum(ANALYSIS_VIEWS), mode: z.enum(ANALYSIS_MODES) }),

  // ── voice notes (1.47.0) ──
  /**
   * The Voice chip (`open: true`) and the studio's «Скрыть» (`false`): the chat's studio in the dock's sheet. Opened
   * with nothing written yet and a draft in the field, it writes the script at once (free of characters).
   */
  act('ShowVoice', { targetHandle: HandleSchema, open: z.boolean() }),
  /**
   * A preset or «Переписать»: a new script in this tone (free of characters; the takes stay). `field` — from the draft
   * in the field now (an empty studio, «Новый войс»); `session` — from the draft the session's script came from.
   * `confirmed` — the person agreed to lose their own edits of the script.
   */
  act('WriteVoiceScript', { targetHandle: HandleSchema, tone: z.enum(VOICE_ACTION_TONES), from: z.enum(['field', 'session']), confirmed: z.optional(z.literal(true)) }),
  /** «Отменить» while the script is written. */
  act('CancelVoiceScript', { targetHandle: HandleSchema }),
  /** The person's text of the script, as typed (the controller keeps it and stores it a moment later). */
  act('EditVoiceScript', { targetHandle: HandleSchema, text: displayText(VOICE_ACTION_SCRIPT_MAX_CHARS) }),
  /** «Вернуть текст AI». */
  act('RevertVoiceScript', { targetHandle: HandleSchema }),
  /** «Озвучить» / «Ещё вариант»: a paid take of the script as it stands, by this click. */
  act('MakeVoiceTake', { targetHandle: HandleSchema }),
  /** The take «Прикрепить» puts into the field. */
  act('SelectVoiceTake', { targetHandle: HandleSchema, takeId: UuidSchema }),
  /** «Проверить» of a take: a free read of its state; a create with no answer is asked again by the same id. */
  act('CheckVoiceTake', { targetHandle: HandleSchema, takeId: UuidSchema }),
  /**
   * «Прикрепить»: the take's MP3 into the chat's field, the site's own way; never sent. `again` — the person confirmed
   * a second handover of a take whose first one was not seen.
   */
  act('AttachVoiceTake', { targetHandle: HandleSchema, takeId: UuidSchema, again: z.optional(z.literal(true)) }),
  /** «Скачать MP3». */
  act('DownloadVoiceTake', { targetHandle: HandleSchema, takeId: UuidSchema }),
  /** «Новый войс»: the session goes (the hub keeps its audio); `confirmed` — the person agreed to leave unattached takes. */
  act('NewVoice', { targetHandle: HandleSchema, confirmed: z.optional(z.literal(true)) }),
  /** «Убрать текст» after an attach: the draft's text leaves the chat's field (nothing is sent). */
  act('ClearVoiceDraft', { targetHandle: HandleSchema }),
  /** «Вернуть текст»: the text «Убрать текст» took goes back into the field. */
  act('RestoreVoiceDraft', { targetHandle: HandleSchema }),
  /** The studio's question goes away unanswered («Отмена»). */
  act('DismissVoiceConfirm', { targetHandle: HandleSchema }),

  // ── lists ──
  act('SetSpendersPeriod', { period: SpendersPeriodChoiceSchema }),
  act('SetSpendersFilter', { filter: z.enum(SPENDERS_FILTERS) }),
  act('SetSpendersSort', { sort: z.enum(SPENDERS_SORTS) }),
  /** «Сбросить фильтры». */
  act('ResetFilters', { list: z.enum(['spenders', 'newcomers']) }),
  /**
   * Debounced by the controller (150 ms, IME-safe, SP-019). `now` — Enter in the field: the list follows at once, so the
   * top match the same key opens is the one of what was typed (the old Fansly board's Enter).
   */
  act('Search', { list: z.enum(['spenders', 'newcomers', 'palette']), query: displayText(200), now: z.optional(z.literal(true)) }),
  /** A collapsed shelf «ещё N · показать», or a click on a shelf in the stats (SP-045). */
  act('RevealShelf', { shelfId: HandleSchema }),
  /** 1.38.0 (X67): a tier chip of the board («🐳 Whale 42»): the list shows that shelf alone; null — every shelf. */
  act('SetSpendersShelf', { shelfId: z.nullable(HandleSchema) }),
  act('SetStatsExpanded', { expanded: z.boolean() }),
  /** 1.44.0: the statistics column beside the list (the rail's click, ›, S); false — the rail at the window's edge. */
  act('SetStatsOpen', { open: z.boolean() }),
  act('SetNewcomersTab', { tab: z.enum(NEWCOMERS_TABS) }),
  act('SetNewcomersFilter', { filter: z.enum(GREETING_FILTERS) }),
  /** 1.15.0 (R20 P10a): a status filter of a list a background pass checks. */
  act('SetNewcomersCheckFilter', { filter: z.enum(NEWCOMER_CHECK_FILTERS) }),
  /**
   * 1.15.0 (R20 P10b1): the queue of a background pass (`NewcomersVM.pass.run`, NF-038) — «Пауза» (`false`: it stops
   * after the request in flight) or «Проверить оставшихся» (`true`: it checks the fans left).
   */
  act('SetNewcomersPassRunning', { running: z.boolean() }),
  /** 1.15.0 (R20 P10b1): «Проверить следующим» / «Проверить чат» (NF-038): this fan's chat is checked next, or now. */
  act('CheckNewcomerNext', { targetHandle: HandleSchema }),
  /**
   * 1.15.0 (R20 P10b2): «Исключить из очереди» (`true`) / «Вернуть в очередь» (`false`) of a fan nobody can write to
   * (FS-NEW-2, `NewcomerCardVM.exclude`): out of «К обработке» and back, kept in this browser.
   */
  act('ExcludeNewcomer', { targetHandle: HandleSchema, excluded: z.boolean() }),
  /**
   * 1.15.0 (R20 P10c): «Отправить» on the card of a fan a background pass checked (FS-NEW-3, NF-019): one click, one
   * attempt of the background's send with the hub's custody; the field's content goes, never repeated.
   */
  act('SendNewcomerGreeting', { targetHandle: HandleSchema }),
  /** 1.15.0 (R20 P10c): «Открыть и вставить» of that card: the fan's chat opens with the field's text for the person's own send. */
  act('InsertNewcomerGreeting', { targetHandle: HandleSchema }),
  act('SetNewcomersWindow', { hours: z.int().check(z.gte(NEWCOMERS_WINDOW_HOURS.min), z.lte(NEWCOMERS_WINDOW_HOURS.max)) }),
  act('LoadMore', { list: z.enum(['spenders', 'newcomers']) }),
  /**
   * 1.32.0: ticks (`picked`) or unticks fans of a list for a batch — one row, or every row the list shows; the list keeps
   * at most `BATCH_LIMITS.picks`. Nothing starts.
   */
  act('SetBatchPick', { list: z.enum(BATCH_LISTS), targetHandles: z.array(HandleSchema).check(z.minLength(1), z.maxLength(1000)), picked: z.boolean() }),
  /**
   * 1.32.0: «Сгенерировать для N» — one generation per ticked fan, a few at a time, by this one click. Never a send: each
   * result waits on its fan's card for the person's own «Отправить».
   */
  act('GenerateBatch', { list: z.enum(BATCH_LISTS) }),
  /** 1.32.0: «Остановить» — the fans still waiting their turn are not started; those generating finish. */
  act('StopBatch', { list: z.enum(BATCH_LISTS) }),
  /** 1.32.0: «Очистить» — the rows forget the batch; the results stay on the fans' cards. */
  act('ClearBatch', { list: z.enum(BATCH_LISTS) }),
  /** The lease is taken on Generate; renewing and releasing are explicit (§8.5). */
  act('RenewClaim', { targetHandle: HandleSchema }),
  act('ReleaseClaim', { targetHandle: HandleSchema }),
  act('SetFanPanelTab', { tab: z.enum(['fan', 'recap']) }),

  // ── toasts ──
  act('DismissToast', { toastId: HandleSchema }),
  /** Hover or focus inside a toast holds its timer (ui-design §4.22). */
  act('HoldToast', { toastId: HandleSchema, hold: z.boolean() }),

  // ── navigation and settings ──
  act('Navigate', { to: NavigationTargetSchema }),
  act('OpenSettings', { route: SettingsRouteSchema }),
  SetPreferenceActionSchema,
  act('SetAccountLabel', { accountHandle: HandleSchema, label: z.nullable(boundedText(60)) }),
  act('SetAccountMuted', { accountHandle: HandleSchema, muted: z.boolean() }),
  act('ChoosePersona', { pageHandle: HandleSchema, personaKey: PersonaKeySchema }),
  /**
   * 2026-10-21 (audit №9): the old Fansly extension's persona export as the person pasted or picked it (its Settings →
   * «Персоны» → «Архив локальной персоны»): each Fansly page without a persona gets the one its account had there.
   * Read on the page itself; nothing of the text is stored or sent.
   */
  act('ImportLegacyPersonas', { text: boundedText(LEGACY_PERSONAS_MAX_CHARS) }),
  /** Only from the options page; the password goes to the background and is never stored. */
  act('SignIn', { login: boundedText(SIGN_IN_LIMITS.loginMaxChars), password: boundedText(SIGN_IN_LIMITS.passwordMaxChars) }),
  act('SignOut', {}),
  /** «Проверить всё» (not more often than every 10 s) and the popup's «Обновить статус». */
  act('RecheckStatus', {}),
  /** «Повторить» of a failed read: a safe read of that view only. */
  act('ReloadView', { selector: ViewSelectorSchema }),
  /** CG-RUNTIME-RELOADED «Перезагрузить вкладку». */
  act('ReloadTab', {}),
  /** CG-UI-FAILED «Перезагрузить панель». */
  act('ReloadSurface', { surface: z.enum(MOUNT_SURFACES) }),
  /** «Скопировать отчёт» / «…для тимлида»: a short redacted text, no correspondence, no fan money. */
  act('CopyReport', { scope: z.enum(['status', 'error']), code: z.optional(CgCodeSchema) }),
  act('ExportDiagnostics', {}),
  /**
   * 2026-10-21: «Скачать лог» of the popup and of the dock — the log of the last 24 hours of every tab and of the
   * background, as a TXT to read and a JSON to parse, saved by this one click. Nothing goes to the hub.
   */
  act('DownloadLog', {}),
  /** The UI asks DialogPort first; `confirmed` records that it did. */
  act('ClearLocalData', { confirmed: z.literal(true) }),
  /**
   * 1.11.0 «Сбросить предохранитель» of the X8 row of «Статус» (decision X25): the fuse that turned the preview
   * send off in this browser is cleared; X8 is on again on the same ChatSpace build until it trips again.
   */
  act('ResetSendFuse', {}),
  act('TestSound', { which: z.enum(['messages', 'subscribers']) }),
  /** `permissions.request` inside the click (ST-121, §9.6 consent). */
  act('RequestPermission', { kind: z.enum(['data-collection', 'hub-host', 'chatspace-host']) }),
  /** «не сохранено · Повторить» (ST-015). */
  act('RetrySettingsWrite', {}),
  /** «Сохранить .txt» of a journal (NF-029). */
  act('SaveJournal', { journal: z.enum(JOURNAL_KINDS) }),
]);

type UiActionWire = z.infer<typeof UiActionSchema>;

/** SetPreference with its value typed by the key. */
export type SetPreferenceAction = {
  [K in PreferenceKey]: { readonly type: 'SetPreference'; readonly key: K; readonly value: PreferenceValues[K] };
}[PreferenceKey];

export type UiAction = Exclude<UiActionWire, { type: 'SetPreference' }> | SetPreferenceAction;
export type UiActionType = UiAction['type'];
export type UiActionOf<T extends UiActionType> = Extract<UiAction, { type: T }>;

export const UI_ACTION_TYPES: readonly UiActionType[] = UiActionSchema._zod.def.options.map((option) => option.shape.type._zod.def.values[0] as UiActionType);
