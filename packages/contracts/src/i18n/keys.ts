// The i18n key catalog (architecture.md §9.7): every user-visible string has a
// typed key; the `ru` (default) and `en` catalogs in core/domain/i18n must
// carry exactly these keys (a missing or extra key is a type error there and
// a failing parity test). Texts never live here, only their names. The CG
// registry texts are not listed: their keys are derived from the code
// (`CG-QUOTA-DAILY` → `cg.quotaDaily.title` / `.body`), so a new code gets
// its keys with no edit here. No imports: errors.ts builds `I18nKey` from
// this module, and the reverse edge would be a cycle.

/** Catalog locales; `ru` is the default (§9.7). The `system` setting resolves to one of them. */
export const LOCALES = ['ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ru';

/**
 * Plural categories each locale's catalog must spell out: what
 * `Intl.PluralRules(locale).resolvedOptions().pluralCategories` reports
 * (integers and fractions together, so Russian needs `other` too).
 */
export const PLURAL_CATEGORIES = {
  ru: ['one', 'few', 'many', 'other'],
  en: ['one', 'other'],
} as const satisfies Record<Locale, readonly Intl.LDMLPluralRule[]>;

/** A plural message: one form per category of the locale; the count is the `{n}` parameter. */
export type PluralMessage<L extends Locale> = { readonly [C in (typeof PLURAL_CATEGORIES)[L][number]]: string };

/** Plain messages; `{name}` marks a parameter. */
export const UI_TEXT_KEYS = [
  'common.copy', 'common.copied', 'common.close', 'common.cancel', 'common.cancelOp', 'common.hide', 'common.again', 'common.retry',
  'common.copyCode', 'common.settings', 'common.openChat', 'common.refreshArchive', 'common.go', 'common.details', 'common.save', 'common.saving',
  'common.saved', 'common.signIn', 'common.signOut', 'common.reloadTab', 'common.loading', 'common.empty', 'common.unknown', 'common.errorSource',
  'common.agoSuffix', 'common.dataAsOf', 'common.dataAsOfCap', 'common.archiveAsOf', 'common.coverage.complete', 'common.coverage.partial',
  'common.coverage.unknown', 'common.seconds', 'common.key.esc', 'common.age.now', 'common.age.minutes', 'common.age.hours', 'common.age.days',
  'common.money.plus', 'common.money.minus',
  'dock.label', 'dock.mark.tooltip', 'dock.action.reply', 'dock.action.fix', 'dock.action.hi', 'dock.action.ping', 'dock.action.review',
  'dock.action.recap', 'dock.action.coach', 'dock.action.more', 'dock.action.tooltip', 'dock.action.unavailable', 'dock.action.busy',
  'dock.action.moreTooltip', 'dock.action.moreUnavailable', 'dock.badge.recapReady', 'dock.reason.quotaZero', 'dock.reason.notSignedIn',
  'dock.reason.hubDown', 'dock.reason.chatLoading', 'dock.reason.reloadNeeded', 'dock.reason.claimedBy', 'dock.reason.claimElsewhere', 'dock.reason.coachBusy',
  'dock.reason.noBinding', 'dock.reason.notGranted', 'dock.reason.noPersona', 'dock.reason.featureDisabled', 'dock.reason.chatBusy',
  'dock.reason.needsDraft', 'dock.reason.noHistory', 'dock.reason.hiGate', 'dock.reason.pingGate', 'dock.reason.language', 'dock.reason.fanBlocked',
  'dock.reason.fanUnknown', 'dock.reason.overlayOpen', 'dock.reason.hostDegraded', 'dock.reason.composerMissing', 'dock.reason.claimExpired',
  'dock.reason.lockedDuringGeneration', 'dock.reason.hotkeyReserved', 'dock.reason.keyInField', 'dock.option.tone',
  'dock.option.toneValue', 'dock.option.toneTooltip', 'dock.option.toneLocked', 'dock.option.toneUnavailable', 'dock.option.toneMenuTitle',
  'dock.option.toneNone', 'dock.tone.casual', 'dock.tone.flirty', 'dock.tone.upsell', 'dock.tone.spicy', 'dock.option.split',
  'dock.option.splitTooltip', 'dock.option.splitLocked', 'dock.option.splitUnavailable', 'dock.option.splitNotMessage', 'dock.persona.tooltip',
  'dock.persona.notSignedIn', 'dock.paletteHint.tooltip', 'dock.quota.low', 'dock.quota.lowShort', 'dock.quota.zero', 'dock.quota.zeroTooltip',
  'dock.status.chatLoading', 'dock.helpRemoved',
  'result.label', 'result.draft', 'result.draftTooltip', 'result.meta.tone', 'result.meta.inserted', 'result.meta.single', 'result.meta.onePart',
  'result.meta.forFan', 'result.meta.byYourDraft', 'result.meta.failed', 'result.meta.notStarted', 'result.meta.unparsed',
  'result.meta.sentProgress', 'result.againTooltip', 'result.againBlocked', 'result.againBlockedUncertain', 'result.hideTooltip',
  'result.timerTooltip', 'result.stage.context',
  'result.stage.thinking', 'result.stage.writing', 'result.stage.retry503', 'result.stage.parsing', 'result.stage.saving', 'result.stale.title',
  'result.stale.body', 'result.keys.part',
  'result.keys.variant', 'result.keys.insert', 'result.keys.copy', 'result.keys.collapse', 'result.keys.hideTooltip',
  'part.aria', 'part.ariaSent', 'part.insert', 'part.insertTooltip', 'part.insertAgain', 'part.copyN', 'part.inserted', 'part.variant',
  'part.oneAtATime',
  'confirm.humanDraft', 'confirm.draftChanged', 'confirm.formatLoss', 'confirm.replace', 'confirm.append',
  'fix.yourText', 'fix.after', 'fix.afterInField', 'fix.replace', 'fix.replaced', 'fix.restore', 'fix.restoreExpired', 'fix.cannotCheck',
  'cg.retryIn', 'cg.quotaDaily.countdown', 'cg.hubUnavailable.banner', 'cg.gateHistory.reply', 'cg.hostContract.banner', 'cg.hostContract.toast',
  'cg.authRequired.action', 'cg.bindingMissing.account', 'cg.personaUnassigned.page', 'cg.personaUnassigned.action', 'cg.runtimeReloaded.versions',
  'cg.runtimeReloaded.action', 'cg.runtimeReloaded.detail', 'cg.opTabLimit.listLabel', 'cg.claimBusy.named', 'cg.claimBusy.release',
  'cg.uiFailed.reload', 'cg.uiFailed.export', 'cg.aiFailedToast',
  'recap.lengthLabel', 'recap.short', 'recap.full', 'recap.copy', 'recap.refresh', 'recap.refreshAria', 'recap.refreshTooltip', 'recap.openLast',
  'recap.madeAgo', 'recap.savedToHub', 'recap.archiveComplete', 'recap.savedToast', 'recap.unsavedToast', 'recap.forFan',
  'recap.checking', 'recap.build.short', 'recap.build.full',
  'review.copy', 'review.againTooltip', 'review.archiveAsOf', 'review.madeNow', 'review.section.verdict', 'review.section.money',
  'review.section.persona', 'review.section.mistakes', 'review.section.works', 'review.section.recommendations',
  'debug.label', 'debug.prompt', 'debug.gutter.cost', 'debug.gutter.ms', 'debug.stage.request', 'debug.stage.meta', 'debug.stage.firstChunk',
  'debug.stage.stream', 'debug.stage.parse', 'debug.stage.render', 'debug.total', 'debug.hubStages', 'debug.profilerAria',
  'spenders.title', 'spenders.boardLabel', 'spenders.period.label', 'spenders.period.lifetime', 'spenders.period.d30', 'spenders.period.month',
  'spenders.period.d7', 'spenders.period.today', 'spenders.search.placeholder', 'spenders.closeTooltip', 'spenders.filter.all',
  'spenders.filter.waiting', 'spenders.filter.new', 'spenders.filter.weWrote', 'spenders.filter.fanWrote', 'spenders.filter.history',
  'spenders.filter.noHistory', 'spenders.sortNote.sum', 'spenders.sortNote.fanAge', 'spenders.col.fan',
  'spenders.col.lastMessage', 'spenders.col.lifetime', 'spenders.col.weWrote', 'spenders.col.weWroteShort', 'spenders.col.fanWrote',
  'spenders.col.fanWroteShort', 'spenders.sort.sumTooltip', 'spenders.sort.fanAgeTooltip', 'spenders.tag.new', 'spenders.tag.deleted',
  'spenders.ourPrefix', 'spenders.waitingTooltip', 'spenders.footerShown', 'spenders.shelfMore', 'spenders.empty', 'spenders.keys.row', 'spenders.resetFilters',
  'stats.title', 'stats.titleFull', 'stats.expand', 'stats.expandTooltip', 'stats.collapse', 'stats.today', 'stats.d7', 'stats.d30', 'stats.payers',
  'stats.avgCheck', 'stats.shelves', 'stats.colFans', 'stats.colPeriod', 'stats.table.shelf', 'stats.table.fans', 'stats.table.lifetime',
  'stats.table.period', 'stats.attention', 'stats.awaiting', 'stats.newPayers', 'stats.silent8to21', 'stats.silentOver21', 'stats.noData',
  'stats.noSilenceData', 'stats.chart.title', 'stats.chart.max', 'stats.chart.axisToday', 'stats.chart.dayTip', 'stats.tile.todaySub',
  'stats.tile.d7Sub', 'stats.tile.payersSub', 'stats.footer', 'stats.footerFull',
  'preview.label', 'preview.moneyIn', 'preview.meta', 'preview.metaFanUnknown', 'preview.closeAria', 'preview.notOpened', 'preview.notOpenedTooltip',
  'preview.notOpenedAfterSend', 'preview.archiveLag', 'preview.fanWroteNew', 'preview.feed.tip', 'preview.feed.bought', 'preview.feed.empty',
  'preview.feed.emptySubscribed', 'preview.draft.placeholder', 'preview.draft.aria', 'preview.empty',
  'send.button', 'send.buttonTooltip', 'send.openAndInsert', 'send.openAndInsertTooltip', 'send.openAndInsertWaiting', 'send.openAndInsertCancel',
  'send.unavailable', 'send.queued', 'send.sending', 'send.accepted', 'send.sent', 'send.rejected', 'send.retry', 'send.retryTooltip',
  'send.rejectedTail', 'send.uncertain', 'send.openToVerify', 'send.uncertainTail', 'send.heldStale', 'send.heldStaleTail', 'send.after',
  'send.heldGroup', 'send.codeLine', 'send.reason.off', 'send.reason.host', 'send.reason.receipt', 'send.reason.activeChat',
  'send.reason.permission', 'send.reason.fan', 'send.reason.mimic', 'send.reason.translator', 'send.reason.freshness', 'send.reason.busy',
  'send.reason.queue', 'send.reason.part', 'send.reason.guard', 'send.reason.claimExpired', 'send.reason.history',
  'send.reason.contextChanged', 'send.reason.claimBusy', 'send.reason.rateLimit', 'send.reason.otherUncertain',
  'newcomers.title', 'newcomers.personaNote', 'newcomers.col.fan', 'newcomers.col.kind', 'newcomers.col.subscription', 'newcomers.col.greeting',
  'newcomers.kind.new', 'newcomers.kind.renewed', 'newcomers.kind.returning', 'newcomers.status.none', 'newcomers.status.claimMine',
  'newcomers.status.claimOther', 'newcomers.status.claimOtherTooltip', 'newcomers.status.claimElsewhere', 'newcomers.status.sending', 'newcomers.status.stopped',
  'newcomers.status.greeted', 'newcomers.hint', 'newcomers.footer', 'newcomers.cardMeta', 'newcomers.stopped', 'newcomers.listLabel',
  'newcomers.cardLabel', 'newcomers.noAutoSend', 'newcomers.tab.todo', 'newcomers.tab.all', 'newcomers.filter.any', 'newcomers.filter.none',
  'newcomers.filter.claimed', 'newcomers.filter.sending', 'newcomers.filter.stopped', 'newcomers.filter.greeted', 'newcomers.claim.renew',
  'newcomers.claim.release', 'newcomers.claim.elsewhere', 'newcomers.incomplete',
  'fanPanel.label', 'fanPanel.tab.fan', 'fanPanel.tab.recap', 'fanPanel.sub', 'fanPanel.spent', 'fanPanel.spentIn', 'fanPanel.byKind.messages',
  'fanPanel.byKind.tips', 'fanPanel.byKind.subscription', 'fanPanel.subscription', 'fanPanel.subscribed', 'fanPanel.autoRenew',
  'fanPanel.autoRenew.on', 'fanPanel.autoRenew.off', 'fanPanel.churn', 'fanPanel.bio', 'fanPanel.lists', 'fanPanel.recap.made', 'fanPanel.recap.hub',
  'fanPanel.recap.hubSaved', 'fanPanel.recap.archive', 'fanPanel.recap.archiveComplete', 'fanPanel.recap.refresh', 'fanPanel.empty.title',
  'fanPanel.empty.body',
  'coach.title', 'coach.sub', 'coach.newDialog', 'coach.newDialogTooltip', 'coach.archiveAsOf', 'coach.refresh', 'coach.who.you', 'coach.who.coach',
  'coach.empty.title', 'coach.empty.body', 'coach.ask.placeholder', 'coach.ask.aria', 'coach.ask.button', 'coach.ask.hint', 'coach.draft',
  'coach.chip.situation', 'coach.chip.offer', 'coach.chip.another', 'coach.chip.shorter', 'coach.chip.refusal',
  'coach.block.situation', 'coach.block.missed', 'coach.block.move', 'coach.block.risk',
  'coach.group.sell', 'coach.group.return', 'coach.group.understand',
  'coach.hint.sell.how', 'coach.hint.sell.price', 'coach.hint.sell.discount',
  'coach.hint.return.revive', 'coach.hint.return.seen', 'coach.hint.return.afterPrice',
  'coach.hint.understand.likes', 'coach.hint.understand.person', 'coach.hint.understand.topics',
  'palette.label', 'palette.placeholder', 'palette.group.actions', 'palette.group.running', 'palette.group.waiting', 'palette.group.chats',
  'palette.group.accounts', 'palette.group.navigation', 'palette.group.online', 'palette.empty', 'palette.foot.hostOnly',
  'palette.item.running', 'palette.item.waiting', 'palette.item.spenders', 'palette.item.newcomers', 'palette.item.tone', 'palette.item.split',
  'palette.item.cheatsheet', 'palette.item.settings', 'palette.foot.select', 'palette.foot.run', 'palette.foot.allKeys',
  'quickJump.title', 'quickJump.empty',
  'cheatsheet.title', 'cheatsheet.group.ai', 'cheatsheet.group.windows', 'cheatsheet.group.before', 'cheatsheet.group.result',
  'cheatsheet.group.navigation', 'cheatsheet.row.fanPanel', 'cheatsheet.row.quickJump',
  'cheatsheet.row.palette', 'cheatsheet.row.spenders', 'cheatsheet.row.self', 'cheatsheet.row.tone', 'cheatsheet.row.split', 'cheatsheet.row.cancel',
  'cheatsheet.row.nextPart', 'cheatsheet.row.insert', 'cheatsheet.row.copy', 'cheatsheet.row.collapse', 'cheatsheet.row.help',
  'cheatsheet.row.chatNext', 'cheatsheet.row.chatPrevious', 'cheatsheet.row.nextUnread', 'cheatsheet.row.search', 'cheatsheet.row.sendNote',
  'cheatsheet.note',
  'toast.aiReady', 'toast.closeAria', 'toast.hubSettingsUpdating', 'toast.splitOn', 'toast.splitOff', 'toast.noUnread',
  'popup.pill.chatspace', 'popup.pill.chatspace.connected', 'popup.pill.chatspace.partial', 'popup.pill.chatspace.copyOnly',
  'popup.pill.chatspace.closed', 'popup.pill.hub', 'popup.pill.hub.online', 'popup.pill.hub.offline', 'popup.persona', 'popup.personaFor',
  'popup.personaNone', 'popup.notConnected', 'popup.account', 'popup.signOut', 'popup.dialog', 'popup.dialogAccount', 'popup.copiedId',
  'popup.quota', 'popup.quotaLeft', 'popup.quotaReset', 'popup.quotaHubDown', 'popup.aiCostToday', 'popup.btn.spenders', 'popup.btn.newcomers',
  'popup.btn.keys', 'popup.btn.settings', 'popup.whatsNew', 'popup.history', 'popup.refreshStatus', 'popup.version',
  'signIn.title', 'signIn.login', 'signIn.password', 'signIn.submit', 'signIn.pending',
  'settings.label',
  'settings.nav.label',
  'settings.section.status', 'settings.section.account', 'settings.section.personas', 'settings.section.accounts', 'settings.section.generation',
  'settings.section.hotkeys', 'settings.section.appearance', 'settings.section.diagnostics',
  'settings.fromError',
  'settings.status.lead', 'settings.status.ready', 'settings.status.unknown', 'settings.status.checkAll', 'settings.status.copyReport',
  'settings.status.reportNote', 'settings.status.row.extension', 'settings.status.row.extensionValue', 'settings.status.row.extensionUpdated',
  'settings.status.row.chatspace', 'settings.status.row.chatspaceValue', 'settings.status.row.chatspaceChecked', 'settings.status.row.hub',
  'settings.status.row.hubValue', 'settings.status.row.hubLatency', 'settings.status.row.account', 'settings.status.row.accountSince',
  'settings.status.row.binding', 'settings.status.row.bindingValue', 'settings.status.row.bindingOthers', 'settings.status.row.persona',
  'settings.status.row.personaFor', 'settings.status.row.quota', 'settings.status.row.quotaReset', 'settings.status.row.running',
  'settings.status.row.lastError', 'settings.status.row.lastErrorValue', 'settings.status.row.contract', 'settings.status.row.previewSend',
  'settings.status.row.sound', 'settings.status.row.consent', 'settings.status.row.spenders', 'settings.status.row.support',
  'settings.status.consentOff', 'settings.status.consentAsk',
  'settings.onboarding.title', 'settings.onboarding.hide', 'settings.onboarding.install', 'settings.onboarding.hosts', 'settings.onboarding.signIn',
  'settings.onboarding.persona', 'settings.onboarding.openChatSpace', 'settings.onboarding.binding', 'settings.onboarding.consent',
  'settings.onboarding.soundAndHotkeys',
  'settings.account.hubAddress', 'settings.account.advanced', 'settings.account.hostAccess', 'settings.account.grantAccess',
  'settings.account.connection', 'settings.account.thisDevice', 'settings.account.signInAgain', 'settings.account.pages',
  'settings.account.compatibility', 'settings.account.hubErrorsToday', 'settings.account.lastDossierSave',
  'settings.personas.catalog', 'settings.personas.readOnly', 'settings.personas.archived', 'settings.personas.pagesOn', 'settings.personas.sync',
  'settings.accounts.title', 'settings.accounts.active', 'settings.accounts.seen', 'settings.accounts.noSessions', 'settings.accounts.label',
  'settings.accounts.hubPage', 'settings.accounts.sound', 'settings.accounts.toTab',
  'settings.generation.windows', 'settings.generation.windowQuick', 'settings.generation.windowPing', 'settings.generation.windowImprove',
  'settings.generation.windowDeep', 'settings.generation.splitDefault', 'settings.generation.coachHistory', 'settings.generation.coachAutoRecap',
  'settings.generation.coachAutoRecap.off', 'settings.generation.coachAutoRecap.short', 'settings.generation.coachAutoRecap.full',
  'settings.generation.debug',
  'settings.hotkeys.reference', 'settings.hotkeys.outsideScheme', 'settings.hotkeys.platform', 'settings.hotkeys.delivery',
  'settings.appearance.lead', 'settings.appearance.theme', 'settings.appearance.themeHint', 'settings.appearance.theme.host',
  'settings.appearance.theme.system', 'settings.appearance.theme.light', 'settings.appearance.theme.dark', 'settings.appearance.theme.systemNow',
  'settings.appearance.locale', 'settings.appearance.locale.system', 'settings.appearance.locale.ru', 'settings.appearance.locale.en',
  'settings.appearance.hints', 'settings.appearance.hintsHint', 'settings.appearance.resultStyle', 'settings.appearance.resultStyleHint',
  'settings.appearance.resultStyle.bare', 'settings.appearance.resultStyle.sheet', 'settings.appearance.notifications',
  'settings.appearance.notificationsHint',
  'settings.appearance.notificationsText', 'settings.appearance.sounds', 'settings.appearance.soundMessage', 'settings.appearance.soundSubscriber',
  'settings.appearance.volume', 'settings.appearance.testSound',
  'sound.tone.chime', 'sound.tone.drop', 'sound.tone.bell', 'sound.tone.arpeggio', 'sound.tone.knock', 'sound.tone.double', 'sound.tone.soft',
  'sound.tone.blip',
  'settings.diagnostics.export', 'settings.diagnostics.size', 'settings.diagnostics.clear', 'settings.diagnostics.clearConfirm',
  'settings.diagnostics.journals',] as const;
export type UiTextKey = (typeof UI_TEXT_KEYS)[number];

/** Plural messages (`PluralMessage`): the form is chosen by `Intl.PluralRules` on `{n}`. */
export const UI_PLURAL_KEYS = [
  'common.minutes', 'common.hours', 'common.days', 'common.messages', 'common.fans', 'common.money.dollars',
  'dock.quota.lowTooltip',
  'result.meta.parts', 'result.meta.variants', 'result.meta.partsEach',
  'recap.archiveLag',
  'review.meta',
  'spenders.footer',
  'stats.tile.d30Sub',
  'fanPanel.footer',
  'coach.archiveLag',
  'palette.foot.chats',
  'settings.status.needActions', 'settings.status.warnings', 'settings.status.row.quotaLeft', 'settings.status.row.runningCount',] as const;
export type UiPluralKey = (typeof UI_PLURAL_KEYS)[number];

type CgWords<S extends string> = S extends `${infer Head}-${infer Tail}`
  ? `${Capitalize<Lowercase<Head>>}${CgWords<Tail>}`
  : Capitalize<Lowercase<S>>;

/** `CG-HUB-HOST-PERMISSION` → `hubHostPermission`. */
export type CgTextBase<C extends string> = C extends `CG-${infer Rest}` ? Uncapitalize<CgWords<Rest>> : never;
export type CgTitleKey<C extends string> = `cg.${CgTextBase<C>}.title`;
export type CgBodyKey<C extends string> = `cg.${CgTextBase<C>}.body`;

export function cgTextBase<C extends string>(code: C): CgTextBase<C> {
  const words = code.replace(/^CG-/, '').toLowerCase().split('-');
  return words.map((word, index) => (index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)).join('') as CgTextBase<C>;
}

export function cgTitleKey<C extends string>(code: C): CgTitleKey<C> {
  return `cg.${cgTextBase(code)}.title`;
}

export function cgBodyKey<C extends string>(code: C): CgBodyKey<C> {
  return `cg.${cgTextBase(code)}.body`;
}
