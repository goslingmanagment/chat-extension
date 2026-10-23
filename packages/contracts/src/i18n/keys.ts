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
  'status.details.tabs',
  'status.details.accountTabs',
  // 1.15.0 P14b2: local per-site diagnostics.
  'popup.siteLabel',
  'status.details.access',
  'status.details.accessValue',
  'status.details.noData',
  'status.details.yes',
  'status.details.no',
  'status.details.build',
  'status.details.anchors',
  'status.details.companion',
  'status.details.companionValue',
  'status.details.wordFilter',
  'status.details.session',
  'status.details.sessionValue',
  'status.details.headerNames',
  'status.details.mode',
  'status.details.background',
  'status.details.relay',
  'status.details.pacer',
  'status.details.pacerPending',
  'status.details.health',
  'status.details.observed',
  'status.details.freshness',
  'status.details.freshnessScope',
  'status.details.persisted',
  'status.details.memory',
  'status.details.freshnessValue',
  'debugPage.generation',

  // 1.15.0 P9a: optional-site activation and per-site status.
  'siteAccess.enable', 'siteAccess.disable', 'siteAccess.reload', 'siteAccess.waiting', 'siteAccess.reloaded', 'settings.status.site.title', 'settings.status.site.closed', 'settings.status.site.closedNote', 'settings.status.site.checking', 'settings.status.site.value', 'settings.status.site.checked', 'settings.status.site.notYetNote', 'settings.status.site.partial', 'settings.status.site.partialNote', 'settings.status.site.copyOnlyNote',
  'common.copy', 'common.copied', 'common.close', 'common.cancel', 'common.cancelOp', 'common.hide', 'common.again', 'common.retry',
  'common.copyCode', 'common.settings', 'common.openChat', 'common.refreshArchive', 'common.go', 'common.details', 'common.save', 'common.saving',
  'common.saved', 'common.signIn', 'common.signOut', 'common.reloadTab', 'common.loading', 'common.empty', 'common.unknown', 'common.errorSource',
  'common.agoSuffix', 'common.dataAsOf', 'common.dataAsOfCap', 'common.archiveAsOf', 'common.coverage.complete', 'common.coverage.partial',
  'common.coverage.unknown', 'common.seconds', 'common.key.esc', 'common.age.now', 'common.age.minutes', 'common.age.hours', 'common.age.days',
  'common.money.plus', 'common.money.minus',
  'dock.label', 'dock.mark.tooltip', 'dock.action.reply', 'dock.action.fix', 'dock.action.hi', 'dock.action.ping', 'dock.action.review',
  'dock.action.recap', 'dock.action.coach', 'dock.action.more', 'dock.action.tooltip', 'dock.action.unavailable', 'dock.action.busy',
  'dock.action.moreTooltip', 'dock.action.moreUnavailable', 'dock.badge.recapReady', 'dock.reason.quotaZero', 'dock.reason.notSignedIn',
  'dock.reason.hubDown', 'dock.reason.chatLoading', 'dock.reason.reloadNeeded', 'dock.reason.claimedBy', 'dock.reason.coachBusy',
  'dock.reason.noBinding', 'dock.reason.notGranted', 'dock.reason.noPersona', 'dock.reason.featureDisabled', 'dock.reason.chatBusy',
  'dock.reason.needsDraft', 'dock.reason.noHistory', 'dock.reason.hiGate', 'dock.reason.hiGreeted', 'dock.reason.pingGate', 'dock.reason.pingFew', 'dock.reason.language', 'dock.reason.fanBlocked',
  'dock.reason.fanUnknown', 'dock.reason.conversationUnknown', 'dock.reason.overlayOpen', 'dock.reason.hostDegraded',
  'dock.reason.composerMissing', 'dock.reason.hostUnidentified',
  'dock.reason.lockedDuringGeneration', 'dock.reason.hotkeyReserved', 'dock.reason.keyInField', 'dock.reason.pageOff', 'dock.reason.hubNotReady',
  'dock.reason.platformUnsupported', 'dock.reason.clientOutdated', 'dock.reason.runtimeUnreachable', 'dock.option.tone',
  'dock.option.toneValue', 'dock.option.toneTooltip', 'dock.option.toneLocked', 'dock.option.toneUnavailable', 'dock.option.toneMenuTitle',
  'dock.option.toneNone', 'dock.tone.casual', 'dock.tone.flirty', 'dock.tone.upsell', 'dock.tone.spicy', 'dock.option.split',
  'dock.option.splitTooltip', 'dock.option.splitLocked', 'dock.option.splitUnavailable', 'dock.option.splitNotMessage', 'dock.persona.tooltip',
  'dock.persona.notSignedIn', 'dock.paletteHint.tooltip', 'dock.quota.low', 'dock.quota.lowShort', 'dock.quota.zero', 'dock.quota.zeroTooltip',
  'dock.status.chatLoading', 'dock.status.pageOff', 'dock.helpRemoved', 'dock.fixRunning',
  // 2026-10-22: the copy-only line of the page's `insertion` switch; the persona picker of the «Нет персоны» banner.
  'dock.status.insertOff', 'dock.status.insertOffBody', 'dock.persona.menu',
  // 1.13.0 (decision X28): one sentence under a control's name in its hover hint — what the button does, in the chatter's own language.
  'dock.hint.reply', 'dock.hint.replyAs', 'dock.hint.fix', 'dock.hint.hi', 'dock.hint.ping', 'dock.hint.recap', 'dock.hint.coach',
  'dock.hint.tone.casual', 'dock.hint.tone.flirty', 'dock.hint.tone.upsell', 'dock.hint.tone.spicy', 'dock.hint.toneOff', 'dock.hint.split',
  'dock.hint.spenders', 'dock.hint.newcomers',
  'result.label', 'result.own', 'result.draft', 'result.draftTooltip', 'result.meta.tone', 'result.meta.inserted', 'result.meta.single', 'result.meta.onePart',
  'result.meta.forFan', 'result.meta.byYourDraft', 'result.meta.draftChanged', 'result.meta.failed', 'result.meta.notStarted', 'result.meta.unparsed',
  'result.meta.sentProgress', 'result.againTooltip', 'result.againBlocked', 'result.hideTooltip',
  'result.timerTooltip', 'result.stage.context',
  'result.stage.thinking', 'result.stage.writing', 'result.stage.retry503', 'result.stage.parsing', 'result.stage.saving',
  // 2026-10-22: «✨ Дополнить из чата» of «Заметки» (Fansly): the stage of its answer.
  'result.stage.fillForm', 'result.stale.title',
  'result.stale.body', 'result.keys.part',
  // 2026-10-22: Split was asked and one message came (the old Fansly extension's note).
  'result.splitOne.title', 'result.splitOne.body',
  'result.keys.variant', 'result.keys.insert', 'result.keys.copy', 'result.keys.collapse', 'result.keys.hideTooltip',
  'result.expand', 'result.collapse', 'result.announce.stage', 'result.announce.canRetry',
  'part.aria', 'part.ariaSent', 'part.insert', 'part.insertTooltip', 'part.insertAgain', 'part.copyN', 'part.edit', 'part.editTooltip', 'part.revert', 'part.editAria', 'part.inserted', 'part.variant',
  'part.oneAtATime',
  'confirm.humanDraft', 'confirm.draftChanged', 'confirm.formatLoss', 'confirm.replace', 'confirm.append',
  'fix.yourText', 'fix.after', 'fix.afterInField', 'fix.replace', 'fix.replaced', 'fix.restore', 'fix.restoreExpired', 'fix.cannotCheck',
  'cg.retryIn', 'cg.quotaDaily.countdown', 'cg.hubUnavailable.banner', 'cg.gateHistory.reply', 'cg.hostContract.banner', 'cg.hostContract.toast',
  'cg.authRequired.action', 'cg.bindingMissing.account', 'cg.personaUnassigned.page', 'cg.personaUnassigned.action', 'cg.runtimeReloaded.versions',
  'cg.runtimeReloaded.action', 'cg.runtimeReloaded.detail', 'cg.opTabLimit.listLabel', 'cg.claimBusy.named', 'cg.claimBusy.release',
  'cg.uiFailed.reload', 'cg.uiFailed.export', 'cg.aiFailedToast', 'cg.recapSave.line', 'cg.recapSave.action', 'cg.recapSave.actionTooltip',
  'recap.lengthLabel', 'recap.short', 'recap.full', 'recap.copy', 'recap.refresh', 'recap.refreshAria', 'recap.refreshTooltip', 'recap.openLast',
  'recap.madeAgo', 'recap.savedToHub', 'recap.archiveComplete', 'recap.unsavedToast', 'recap.forFan',
  'recap.checking', 'recap.build.short', 'recap.build.full',
  // 1.20.0 (X47): the sections of the hub's fan profile and of a full Recap, named in the reader's language.
  'recap.section.dossier', 'recap.section.portrait', 'recap.section.stage', 'recap.section.communication', 'recap.section.money',
  'recap.section.openLoops', 'recap.section.strategy',
  // 2026-10-22: the short Recap's sections (the hub's WHO … NEXT MOVE), what it covers, a failed «Обновить» under the kept text.
  'recap.section.who', 'recap.section.spend', 'recap.section.triggers', 'recap.section.boundaries', 'recap.section.threads',
  'recap.section.nextMove', 'recap.newAfterSome', 'recap.coverage.window', 'result.notRefreshed',
  'review.copy', 'review.againTooltip', 'review.madeNow', 'review.section.verdict', 'review.section.money',
  'review.section.persona', 'review.section.mistakes', 'review.section.works', 'review.section.recommendations', 'review.example',
  'debug.label', 'debug.prompt', 'debug.gutter.cost', 'debug.gutter.ms', 'debug.stage.request', 'debug.stage.meta', 'debug.stage.firstChunk',
  'debug.stage.stream', 'debug.stage.parse', 'debug.stage.render', 'debug.total', 'debug.hubStages', 'debug.profilerAria',
  'spenders.title', 'spenders.boardLabel', 'spenders.period.label', 'spenders.period.lifetime', 'spenders.period.d30', 'spenders.period.month',
  'spenders.period.d7', 'spenders.period.today', 'spenders.search.placeholder', 'spenders.closeTooltip', 'spenders.filter.all',
  'spenders.filter.waiting', 'spenders.filter.new', 'spenders.filter.weWrote', 'spenders.filter.fanWrote', 'spenders.filter.history',
  'spenders.filter.noHistory', 'spenders.sortNote.sum', 'spenders.sortNote.fanAge', 'spenders.col.fan',
  'spenders.col.lastMessage', 'spenders.col.lifetime', 'spenders.col.lifetimeShort', 'spenders.col.weWrote', 'spenders.col.weWroteShort', 'spenders.col.fanWrote',
  'spenders.col.fanWroteShort', 'spenders.sort.sumTooltip', 'spenders.sort.fanAgeTooltip', 'spenders.tag.deleted',
  'spenders.ourPrefix', 'spenders.waitingTooltip', 'spenders.footerShown', 'spenders.shelfMore', 'spenders.empty', 'spenders.keys.row', 'spenders.resetFilters',
  'spenders.shelf.from', 'spenders.shelf.range', 'spenders.shelf.none', 'spenders.truncated', 'spenders.truncatedNoTotal', 'spenders.waitingLocal',
  'spenders.refresh', 'spenders.refreshTooltip',
  // 1.37.0 (X65): the list's «Ждёт» column — the fan's wait, or ours — and the border of the preview under the list.
  'spenders.col.waits', 'spenders.wait.ours', 'spenders.previewSplit',
  // 1.38.0 (X67): the old extension's tier chips and shelf names, the fan's wait as a chip of the row, the filters' menu.
  'spenders.tiers', 'spenders.tier.whale', 'spenders.tier.top', 'spenders.tier.prime', 'spenders.tier.base', 'spenders.tier.low', 'spenders.tier.micro',
  'spenders.filter.menu',
  // 2026-10-22: the old Fansly board's chat chip of a row whose chat is not known yet.
  'spenders.chat.find', 'spenders.chat.findHint', 'spenders.chat.finding', 'spenders.chat.missing', 'spenders.chat.missingHint',
  'stats.title', 'stats.titleFull', 'stats.expand', 'stats.collapse', 'stats.today', 'stats.d7', 'stats.d30', 'stats.payers',
  'stats.avgCheck', 'stats.shelves', 'stats.colFans', 'stats.colPeriod', 'stats.table.shelf',
  'stats.attention', 'stats.awaiting', 'stats.silent8to21', 'stats.silentOver21', 'stats.noData',
  'stats.chart.title', 'stats.chart.max', 'stats.chart.axisToday', 'stats.chart.dayTip', 'stats.tile.todaySub',
  'stats.tile.payersSub', 'stats.footer', 'stats.footerFull', 'stats.regionLabel', 'stats.shelf.untiered', 'stats.shelf.unattributed',
  // 1.26.0 (X55): a known zero of the period in words, as the rows and the fan panel say it.
  'stats.none',
  // 1.44.0: the board as a table — its columns, the groups of a sort, the batch's row; the statistics in the model's net,
  // a rail by default, «Кому написать».
  'spenders.col.waiting', 'spenders.col.spent', 'spenders.col.tier', 'spenders.noChat', 'spenders.sort.by', 'spenders.group.waiting',
  'spenders.group.waitingNote', 'spenders.group.rest', 'spenders.group.restNote', 'spenders.filter.silent8to21', 'spenders.filter.silentOver21',
  'spenders.batch.picked', 'spenders.batch.write', 'spenders.batch.unpick', 'spenders.batch.hint',
  'stats.open', 'stats.close', 'stats.netCap', 'stats.paid', 'stats.fee', 'stats.d7Same', 'stats.d7Change', 'stats.byTier', 'stats.colNet',
  'stats.show', 'stats.monthNote',
  'preview.label', 'preview.moneyIn', 'preview.meta', 'preview.metaFanUnknown', 'preview.metaOurUnknown', 'preview.closeAria', 'preview.notOpened',
  'preview.notOpenedTooltip', 'preview.notOpenedAfterSend', 'preview.notOpenedAfterSendTooltip', 'preview.readByCheck', 'preview.readByCheckTooltip', 'preview.archiveLag', 'preview.fanWroteNew', 'preview.feed.tip', 'preview.feed.bought', 'preview.feed.empty',
  'preview.feed.emptySubscribed', 'preview.feed.label', 'preview.feed.fanPrefix', 'preview.feed.deleted', 'preview.feed.automatic', 'preview.feed.priced',
  'preview.feed.notBought', 'preview.feed.older', 'preview.ping.segment', 'preview.ping.segmentNoDays', 'preview.ping.active', 'preview.ping.unknown',
  'preview.draft.placeholder', 'preview.draft.aria', 'preview.draft.send', 'preview.draft.sendTooltip', 'preview.draft.sendEmpty', 'preview.empty', 'preview.emptyNewcomers',
  // 1.37.0 (X65): the preview under the list — the neighbouring fans in its header, the row's last message while the archive has none.
  'preview.previousFan', 'preview.nextFan', 'preview.feed.lastOnly',
  // Whether the fan read our newest message, live from the site: under its bubble, or beside the header's ages.
  'preview.seen.read', 'preview.seen.readAt', 'preview.seen.unread',
  // 1.30.0 (X53): the media picker of a preview.
  'preview.media.button', 'preview.media.buttonTooltip', 'preview.media.label', 'preview.media.close', 'preview.media.all', 'preview.media.foldersMore',
  'preview.media.more', 'preview.media.loading', 'preview.media.empty', 'preview.media.notReady', 'preview.media.fan.paid', 'preview.media.fan.unpaid',
  'preview.media.fan.free', 'preview.media.fanTip.paid', 'preview.media.fanTip.unpaid', 'preview.media.fanTip.free', 'preview.media.type.photo',
  'preview.media.type.video', 'preview.media.type.anim', 'preview.media.type.audio', 'preview.media.pickedAria', 'preview.media.free', 'preview.media.locked',
  'preview.media.freeTooltip', 'preview.media.lockedTooltip', 'preview.media.price', 'preview.media.pricePlaceholder', 'preview.media.price.format',
  'preview.media.price.decimals', 'preview.media.price.min', 'preview.media.price.max', 'preview.media.allFree', 'preview.media.blocked.price',
  'preview.media.blocked.allFree', 'preview.media.blocked.tagsLoading', 'preview.media.tagsLoading',
  'preview.media.tagsFailed', 'preview.media.retry', 'preview.media.clear', 'preview.media.hint', 'preview.media.attachedHint', 'preview.media.summaryFree',
  'preview.media.summaryPaid', 'preview.media.summaryPaidPreviews', 'send.buttonMedia', 'send.buttonMediaPaid', 'send.buttonMediaTooltip', 'send.reason.media', 'send.reason.pace',
  'send.button', 'send.buttonTooltip', 'send.openAndInsert', 'send.openAndInsertTooltip', 'send.openAndInsertWaiting', 'send.openAndInsertCancel',
  'send.unavailable', 'send.unavailableReason', 'send.queued', 'send.sending', 'send.accepted', 'send.sent', 'send.rejected', 'send.retry', 'send.retryTooltip',
  'send.rejectedTail', 'send.uncertain', 'send.openToVerify', 'send.uncertainTail', 'send.uncertainRetryTooltip', 'send.heldStale', 'send.heldStaleTail', 'send.unverified', 'send.unverifiedTail', 'send.anyway', 'send.anywayTooltip', 'send.after',
  'send.codeLine', 'send.reason.off', 'send.reason.host', 'send.reason.hostNotYet', 'send.reason.receipt', 'send.reason.activeChat',
  'send.reason.permission', 'send.reason.fan', 'send.reason.mimic', 'send.reason.translator', 'send.reason.freshness', 'send.reason.busy',
  'send.reason.queue', 'send.reason.part', 'send.reason.otherVariant', 'send.reason.guard',
  'send.reason.contextChanged', 'send.reason.claimBusy', 'send.reason.rateLimit', 'send.reason.otherUncertain',
  'batch.pick', 'batch.pickAll', 'batch.picked', 'batch.generate', 'batch.generateTooltip', 'batch.unpick', 'batch.stop', 'batch.clear', 'batch.progress', 'batch.failedCount', 'batch.hint', 'batch.max', 'batch.state.queued', 'batch.state.generating', 'batch.state.ready', 'batch.state.sent', 'batch.state.failed',
  'outreach.button', 'outreach.buttonTooltip', 'outreach.title', 'outreach.text', 'outreach.textPlaceholder', 'outreach.items', 'outreach.item.bundle', 'outreach.item.media', 'outreach.noItems', 'outreach.mediaHint', 'outreach.refresh', 'outreach.hint', 'outreach.sent', 'outreach.close', 'outreach.send', 'outreach.sendTooltip', 'outreach.state.sending', 'outreach.state.sent', 'outreach.state.uncertain', 'outreach.state.failed',
  'newcomers.title', 'newcomers.personaNote', 'newcomers.col.fan', 'newcomers.col.kind', 'newcomers.col.subscription', 'newcomers.col.greeting',
  'newcomers.kind.new', 'newcomers.kind.renewed', 'newcomers.kind.returning', 'newcomers.status.none', 'newcomers.status.sendingOther',
  'newcomers.status.sending', 'newcomers.status.stopped',
  'newcomers.status.greeted', 'newcomers.status.replied', 'newcomers.hint', 'newcomers.range', 'newcomers.cardMeta', 'newcomers.stopped', 'newcomers.listLabel',
  'newcomers.cardLabel', 'newcomers.noAutoSend', 'newcomers.tab.todo', 'newcomers.tab.all', 'newcomers.filter.any', 'newcomers.filter.none',
  'newcomers.filter.sending', 'newcomers.filter.stopped', 'newcomers.filter.greeted', 'newcomers.filter.replied', 'newcomers.claim.renew',
  'newcomers.claim.release', 'newcomers.claim.mine', 'newcomers.incomplete', 'newcomers.incomplete.body', 'newcomers.draft', 'newcomers.draftStale',
  'newcomers.scanProgress', 'newcomers.window.label', 'newcomers.greetingDraft.placeholder', 'newcomers.greetingDraft.aria',
  'newcomers.period', 'newcomers.refresh', 'newcomers.pickAll', 'newcomers.pickTooltip', 'newcomers.batch.picked', 'newcomers.batch.generate',
  'newcomers.batch.generating', 'newcomers.batch.ready', 'newcomers.batch.sent', 'newcomers.batch.failed', 'newcomers.batch.review',
  'newcomers.card.label', 'newcomers.card.placeholder', 'newcomers.card.generate', 'newcomers.card.generating', 'newcomers.card.send',
  'newcomers.card.ai', 'newcomers.card.aiTooltip', 'newcomers.card.notDrafted', 'newcomers.card.part', 'newcomers.card.empty',
  'newcomers.row.send', 'newcomers.row.sendTooltip', 'newcomers.row.sendBlocked', 'newcomers.row.sendPaused', 'newcomers.row.failed',
  'fanPanel.label', 'fanPanel.tab.fan', 'fanPanel.tab.recap', 'fanPanel.sub', 'fanPanel.spent', 'fanPanel.spentIn', 'fanPanel.spentNone', 'fanPanel.byKind.messages',
  'fanPanel.byKind.tips', 'fanPanel.byKind.subscription', 'fanPanel.subscription', 'fanPanel.subscribed', 'fanPanel.autoRenew',
  'fanPanel.autoRenew.on', 'fanPanel.autoRenew.off', 'fanPanel.churn', 'fanPanel.bio', 'fanPanel.lists', 'fanPanel.recap.made', 'fanPanel.recap.hub',
  'fanPanel.recap.hubSaved', 'fanPanel.recap.archive', 'fanPanel.recap.archiveComplete', 'fanPanel.recap.refresh', 'fanPanel.empty.title',
  'fanPanel.empty.body', 'fanPanel.subscribedLabel', 'fanPanel.subscribedValue', 'fanPanel.subscribedMonths', 'fanPanel.subscribedSince',
  'fanPanel.churn.low', 'fanPanel.churn.medium', 'fanPanel.churn.high', 'fanPanel.churn.unknown', 'fanPanel.byKind.posts', 'fanPanel.byKind.other',
  'fanPanel.subOnline', 'fanPanel.lastSeen', 'fanPanel.online', 'fanPanel.buyingPower', 'fanPanel.recap.archivePartial',
  'coach.title', 'coach.sub', 'coach.newDialog', 'coach.newDialogTooltip', 'coach.archiveAsOf', 'coach.refresh', 'coach.who.you', 'coach.who.coach',
  'coach.empty.title', 'coach.empty.body', 'coach.ask.placeholder', 'coach.ask.aria', 'coach.ask.button', 'coach.ask.hint', 'coach.draft',
  'coach.chip.situation', 'coach.chip.offer', 'coach.chip.another', 'coach.chip.shorter', 'coach.chip.refusal',
  'coach.block.situation', 'coach.block.missed', 'coach.block.move', 'coach.block.risk',
  'coach.group.sell', 'coach.group.return', 'coach.group.understand',
  'coach.hint.sell.how', 'coach.hint.sell.price', 'coach.hint.sell.discount',
  'coach.hint.return.revive', 'coach.hint.return.seen', 'coach.hint.return.afterPrice',
  'coach.hint.understand.likes', 'coach.hint.understand.person', 'coach.hint.understand.topics',
  'coach.attachDraft', 'coach.sentToCoach', 'coach.memoryBoundary',
  // 1.36.0 (X63): the old window's Coach — the draft card's title, the attached reply under a question, the line under
  // «Приложить мой ответ», a turn the person stopped.
  'coach.draftOne', 'coach.attached', 'coach.attachHint', 'coach.canceled',
  'coach.draft.calm', 'coach.draft.flirt', 'coach.recapStep.full', 'coach.recapStep.short', 'coach.recapRunning',
  // 2026-10-22: what Coach stands on, said in its topbar and under every answer; what a Reply or a Ping stood on.
  'coach.recap.use', 'coach.recap.age', 'coach.recap.ageBoth', 'coach.recap.ageShort', 'coach.turn.recapOff', 'result.meta.recapOff',
  'recap.tick', 'recap.tick.onHint', 'recap.tick.offHint', 'recap.usedBy.off', 'result.recap.onHint', 'result.recap.offHint', 'coach.recap.noneSome', 'coach.recap.ahead', 'coach.recap.aheadShort',
  'coach.recap.aheadRefresh', 'coach.recap.building', 'coach.recap.build', 'coach.recap.refresh', 'coach.recap.buildFull',
  'coach.turn.recap', 'coach.turn.recapBoth', 'coach.turn.recapShort', 'coach.turn.noRecap', 'result.meta.recap',
  'recap.usedBy.full', 'recap.usedBy.short', 'recap.usedBy.one', 'recap.usedBy.some', 'recap.picker.explain', 'coach.newDialog.confirm', 'coach.newDialog.keep',
  // The old card's line under a Coach draft in Cyrillic for a fan who does not write Cyrillic: neither Insert nor Copy.
  'coach.draftLanguage',
  // 1.51.0: Review is a turn of Coach — its chip and hint by the ready questions, the window of a page whose Coach is off.
  'coach.chip.review', 'coach.chip.reviewHint', 'coach.reviewOnly.title', 'coach.reviewOnly.body', 'coach.reviewOnly.placeholder',
  'palette.label', 'palette.placeholder', 'palette.group.actions', 'palette.group.running', 'palette.group.waiting', 'palette.group.chats',
  'palette.group.accounts', 'palette.group.navigation', 'palette.group.online', 'palette.empty', 'palette.foot.hostOnly',
  'palette.item.running', 'palette.item.waiting', 'palette.item.spenders', 'palette.item.newcomers', 'palette.item.tone', 'palette.item.split',
  'palette.item.cheatsheet', 'palette.item.settings', 'palette.foot.select', 'palette.foot.run', 'palette.foot.allKeys', 'palette.partial',
  'quickJump.title', 'quickJump.empty',
  'cheatsheet.title', 'cheatsheet.group.ai', 'cheatsheet.group.windows', 'cheatsheet.group.before', 'cheatsheet.group.result',
  'cheatsheet.group.navigation', 'cheatsheet.row.fanPanel', 'cheatsheet.row.quickJump',
  'cheatsheet.row.palette', 'cheatsheet.row.spenders', 'cheatsheet.row.self', 'cheatsheet.row.tone', 'cheatsheet.row.split', 'cheatsheet.row.cancel',
  'cheatsheet.row.nextPart', 'cheatsheet.row.insert', 'cheatsheet.row.copy', 'cheatsheet.row.collapse', 'cheatsheet.row.help',
  'cheatsheet.row.chatNext', 'cheatsheet.row.chatPrevious', 'cheatsheet.row.nextUnread', 'cheatsheet.row.search', 'cheatsheet.row.sendNote', 'cheatsheet.row.notes', 'cheatsheet.row.applyFix',
  'cheatsheet.note',
  // 2026-10-22: the sheet's one-line descriptions, as the old Fansly sheet had them.
  'cheatsheet.row.reply', 'cheatsheet.row.fix', 'cheatsheet.row.hi', 'cheatsheet.row.ping', 'cheatsheet.row.review', 'cheatsheet.row.recap',
  'cheatsheet.row.coach', 'cheatsheet.row.spendersBoard', 'cheatsheet.row.newcomers', 'cheatsheet.row.splitSeries',
  'toast.aiReady', 'toast.closeAria', 'toast.hubSettingsUpdating', 'toast.splitOn', 'toast.splitOff', 'toast.noUnread',
  'popup.pill.chatspace', 'popup.pill.chatspace.connected', 'popup.pill.chatspace.partial', 'popup.pill.chatspace.copyOnly',
  'popup.pill.chatspace.closed', 'popup.pill.hub', 'popup.pill.hub.online', 'popup.pill.hub.offline', 'popup.persona', 'popup.personaFor',
  'popup.personaNone', 'popup.notConnected', 'popup.account', 'popup.signOut', 'popup.dialog', 'popup.dialogAccount', 'popup.copiedId', 'popup.copyChatId',
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
  'settings.diagnostics.journals',
  // ── Extension pages: popup, options, debug (R16, contracts 1.2.0) ──
  'popup.pill.chatspace.unknown', 'popup.pill.hub.unknown', 'popup.fanId', 'popup.dialogNone', 'popup.needsChatSpace', 'popup.newcomersTooltip',
  'popup.copyAccountId', 'popup.copyCreatorId', 'popup.quotaUnknown', 'popup.quotaAfterFirst', 'popup.refreshing', 'popup.signInLead',
  'popup.openSettings', 'popup.problems', 'signIn.lead', 'signIn.help', 'signIn.accessNote', 'signIn.signedOut', 'signIn.signOutUnconfirmed',
  'signIn.againLead', 'signIn.sound', 'settings.save.saved', 'settings.save.failed', 'settings.nav.problem', 'settings.nav.new',
  'settings.onboarding.lead', 'settings.onboarding.progress', 'settings.onboarding.stepDone', 'settings.onboarding.stepTodo',
  // 1.26.0 (X55): the team lead's steps folded under «Ещё»; «Размер текста» of «Вид и звук».
  'settings.onboarding.more', 'settings.appearance.textSize', 'settings.appearance.textSizeHint', 'settings.appearance.textSizeLarge',
  'settings.appearance.textSizeNote',
  'settings.status.warningOne', 'settings.status.warning.staleTabs', 'settings.status.row.extensionUpdatedToday',
  'settings.status.row.extensionUpdatedOn', 'settings.status.row.extensionStaleTabs', 'settings.status.leadPending', 'settings.status.checking',
  'settings.status.checkAllTooltip', 'settings.status.warning.quotaLow', 'settings.status.warning.quotaZero', 'settings.status.warning.sendUncertain',
  'settings.status.warning.hostPartial', 'settings.status.warning.hostModule', 'settings.status.go.account', 'settings.status.go.accounts', 'settings.status.go.personas',
  'settings.status.fanId', 'settings.status.consentOn', 'settings.status.consentNote', 'settings.status.row.chatspaceClosed',
  'settings.status.row.chatspaceClosedNote', 'settings.status.row.chatspaceChecking', 'settings.status.row.chatspacePartial',
  'settings.status.row.chatspacePartialNote', 'settings.status.row.chatspaceCopyOnlyNote', 'settings.status.row.chatspaceNotYetNote', 'settings.status.row.hubNoAccess', 'settings.status.row.hubDown', 'settings.status.row.hubUnknown',
  'settings.status.row.hubRefused', 'settings.status.row.accountNone', 'settings.status.row.accountNote', 'settings.status.row.bindingNoAccount',
  'settings.status.row.bindingNoAccountNote', 'settings.status.row.bindingChecking', 'settings.status.row.bindingMissing',
  'settings.status.row.bindingOnly', 'settings.status.row.personaNoPage', 'settings.status.row.personaNone', 'settings.status.row.personaArchived',
  'settings.status.row.personaReplace', 'settings.status.row.quotaUnknown', 'settings.status.row.quotaUnknownNote', 'settings.status.row.runningNone',
  'settings.status.row.runningItem', 'settings.status.row.soundOff', 'settings.status.row.soundNoTabs', 'settings.status.row.soundOn',
  'settings.status.row.soundNever', 'settings.status.row.soundLast', 'settings.status.row.contractValue', 'settings.status.row.contractOk',
  'settings.status.row.contractMissing', 'settings.status.row.contractNotYet', 'settings.status.row.previewSendOn', 'settings.status.row.previewSendOff',
  'settings.status.row.previewSendNote', 'settings.status.row.previewSendExact', 'settings.status.row.previewSendAnyBuild',
  'settings.status.row.previewSendAnyBuildNote', 'settings.status.row.contractReceiptExact', 'settings.status.row.contractReceiptAnyBuild',
  'settings.status.row.spendersOn', 'settings.status.row.spendersOff', 'settings.status.row.supportValue',
  'settings.status.row.supportNote', 'settings.role.owner', 'settings.role.teamLead', 'settings.role.chatter', 'settings.role.unknown',
  'settings.account.lead', 'settings.account.zone.connection', 'settings.account.zone.account', 'settings.account.zone.signIn',
  'settings.account.zone.diagnostics', 'settings.account.signedInAs', 'settings.account.signOut', 'settings.account.signOutTitle',
  'settings.account.signOutBody', 'settings.account.hubAddressLocked', 'settings.account.hubAddressHint', 'settings.account.hubAddressSave',
  'settings.account.access.granted', 'settings.account.access.missing', 'settings.account.connection.ok', 'settings.account.connection.down',
  'settings.account.connection.unknown', 'settings.account.connectionMeta', 'settings.account.connectionChecked', 'settings.account.checkConnection',
  'settings.account.deviceSignedIn', 'settings.account.deviceSince', 'settings.account.noPages', 'settings.account.noPersona',
  'settings.account.sdk.compatible', 'settings.account.sdk.incompatible', 'settings.account.sdk.unknown', 'settings.account.sdkHash',
  'settings.account.hubErrorsNone', 'settings.account.hubAccount', 'settings.account.hubAccountHint', 'settings.personas.lead',
  'settings.personas.pages', 'settings.personas.none', 'settings.personas.notFound', 'settings.personas.choose', 'settings.personas.emptyCatalog',
  'settings.personas.emptyPages', 'settings.personas.unavailable', 'settings.personas.loading', 'settings.personas.syncedAt',
  'settings.personas.syncNever', 'settings.personas.syncNow', 'settings.personas.toAccounts', 'settings.personas.onIt', 'settings.personas.unused',
  'settings.personas.archivedTag', 'settings.accounts.lead', 'settings.accounts.count', 'settings.accounts.empty',
  'settings.accounts.labelPlaceholder', 'settings.accounts.labelHint', 'settings.accounts.pageNone', 'settings.accounts.persona',
  'settings.accounts.soundOn', 'settings.accounts.copyId', 'settings.accounts.toTabUnavailable', 'settings.accounts.noSessionsHint',
  'settings.accounts.workingHint', 'settings.accounts.group.working', 'settings.accounts.group.seen', 'settings.accounts.group.noSessions',
  'settings.generation.lead', 'settings.generation.windowsHint', 'settings.generation.savedAs', 'settings.generation.deepClipped',
  'settings.generation.range', 'settings.generation.less', 'settings.generation.more', 'settings.generation.splitHint', 'settings.generation.on',
  'settings.generation.coachHistoryHint', 'settings.generation.coachAutoRecapHint', 'settings.generation.coachAutoRecapFullNote',
  'settings.generation.debugTitle', 'settings.generation.debugHint', 'settings.generation.renderTrace', 'settings.generation.renderTraceHint',
  // 1.18.0 (decision X45): «Помнить тон в чате» and its hint.
  'settings.generation.rememberTone', 'settings.generation.rememberToneHint', 'settings.generation.recapDefault', 'settings.generation.recapHint',
  'settings.hotkeys.lead', 'settings.hotkeys.platform.mac', 'settings.hotkeys.platform.win', 'settings.hotkeys.col.action',
  'settings.hotkeys.col.keys', 'settings.hotkeys.col.delivery', 'settings.hotkeys.delivery.delivered', 'settings.hotkeys.delivery.cancelable',
  'settings.hotkeys.delivery.reserved', 'settings.hotkeys.delivery.unverified', 'settings.hotkeys.deliveryNote', 'settings.hotkeys.fallback',
  'settings.hotkeys.removed', 'settings.hotkeys.buttonOnly', 'settings.appearance.scheme.light', 'settings.appearance.scheme.dark',
  'settings.appearance.localeHint', 'settings.appearance.hintsOn', 'settings.appearance.hintsNote', 'settings.appearance.soundOn',
  'settings.appearance.soundMessageHint', 'settings.appearance.soundSubscriberHint', 'settings.appearance.toneLabel',
  'settings.appearance.volumeHint', 'settings.appearance.soundState', 'settings.appearance.soundStateHint', 'settings.appearance.soundStateOk',
  'settings.appearance.soundStateNoTabs', 'settings.appearance.soundStateOff', 'settings.appearance.soundStateUnknown',
  'settings.appearance.soundFailed', 'settings.appearance.muteNote', 'settings.diagnostics.lead', 'settings.diagnostics.exportLabel',
  'settings.diagnostics.exportHint', 'settings.diagnostics.exported', 'settings.diagnostics.sizeLabel', 'settings.diagnostics.sizeHint',
  'settings.diagnostics.caches', 'settings.diagnostics.logs', 'settings.diagnostics.kb', 'settings.diagnostics.mb', 'settings.diagnostics.clearTitle',
  'settings.diagnostics.cleared', 'settings.diagnostics.counters', 'settings.diagnostics.countersNone', 'settings.diagnostics.journalsHint',
  'settings.diagnostics.journalsOff', 'journal.kind.operations', 'journal.kind.hubCalls', 'journal.kind.sendAttempts', 'journal.kind.newcomersCheck',
  // 1.20.0 (X47): «Аккаунт → Дополнительно» (DB-027) and the AI spend by feature (DB-022), debug only.
  'settings.account.advanced.signIn', 'settings.account.advanced.signInValue', 'settings.account.advanced.noExpiry',
  'settings.account.advanced.host', 'settings.account.advanced.hostValue', 'settings.account.advanced.noHosts',
  'settings.account.advanced.contract.ok', 'settings.account.advanced.contract.broken', 'settings.account.advanced.app',
  'settings.account.advanced.hint', 'settings.diagnostics.aiSpend', 'settings.diagnostics.aiSpendHint', 'settings.diagnostics.aiSpend.today',
  'settings.diagnostics.aiSpend.week', 'settings.diagnostics.aiSpend.feature', 'settings.diagnostics.aiSpend.runs',
  'settings.diagnostics.aiSpend.inserts', 'settings.diagnostics.aiSpend.tokens', 'settings.diagnostics.aiSpend.cache',
  'settings.diagnostics.aiSpend.cost', 'settings.diagnostics.aiSpend.total', 'settings.diagnostics.aiSpend.none',
  'debugPage.prompt.title', 'debugPage.prompt.lead', 'debugPage.prompt.copy', 'debugPage.prompt.source.echo', 'debugPage.prompt.source.cache',
  'debugPage.prompt.captured', 'debugPage.prompt.expires', 'debugPage.prompt.truncated', 'debugPage.prompt.manifest', 'debugPage.prompt.blocks',
  'debugPage.prompt.expiredTitle', 'debugPage.prompt.expiredBody', 'debugPage.prompt.echoOff', 'debugPage.prompt.fromCache',
  'debugPage.prompt.debugOff', 'debugPage.journal.title', 'debugPage.journal.lead', 'debugPage.journal.save', 'debugPage.journal.refresh',
  'debugPage.journal.empty', 'debugPage.journal.truncated', 'debugPage.journal.runs', 'debugPage.journal.run', 'debugPage.journal.kinds',
  'debugPage.journal.col.time', 'debugPage.journal.col.level', 'debugPage.journal.col.scope', 'debugPage.journal.col.text',
  'debugPage.journal.debugOff',
  // The journal's filters, pages and auto-refresh (NF-029), the stored deep window above the hub's limit, a sentence-case row of the reference.
  'debugPage.journal.filterAll', 'debugPage.journal.filterNone', 'debugPage.journal.matched', 'debugPage.journal.page', 'debugPage.journal.prev',
  'debugPage.journal.next', 'debugPage.journal.auto', 'settings.generation.deepOver', 'settings.hotkeys.row.variant',
  // 1.35.0 (X61): the popup's stage — the verdict, what to fix and its remedy; a site's switch in its own quiet row.
  'popup.verdict.readyLine', 'popup.verdict.checking', 'popup.alert.reloadOne', 'popup.alert.reloadMany', 'popup.alert.openTitle',
  'popup.alert.openBody', 'popup.alert.openFix', 'popup.alert.recheck', 'popup.alert.personaFix', 'popup.site.on', 'popup.site.off',
  'popup.alert.reloadShort', 'popup.alert.reloadTitleOne', 'popup.alert.reloadTitleMany', 'popup.alert.reloadBody',
  // 2026-10-21: «Скачать лог» (the popup and the dock)
  'log.download', 'log.downloadHint', 'log.downloaded', 'log.downloadFailed',
  // 1.47.0: Voice — the chip, its studio in the dock's sheet, its takes and their handover into the chat's field.
  'dock.action.voice', 'dock.hint.voice', 'dock.badge.voiceReady',
  'voice.label', 'voice.forFan', 'voice.hide', 'voice.empty.title', 'voice.empty.body', 'voice.empty.write', 'voice.source',
  'voice.tone.label', 'voice.tone.calm', 'voice.tone.warm', 'voice.tone.playful', 'voice.hint.tone.calm', 'voice.hint.tone.warm',
  'voice.hint.tone.playful', 'voice.rewrite', 'voice.rewriteTooltip', 'voice.writing', 'voice.cancel', 'voice.script.label',
  'voice.script.placeholder', 'voice.script.revert', 'voice.script.counter', 'voice.script.tooLong', 'voice.script.badTag',
  'voice.script.markup', 'voice.script.empty', 'voice.script.edited', 'voice.tags', 'voice.tagsTooltip', 'voice.tag.warmly',
  'voice.tag.cheerfully', 'voice.tag.thoughtful', 'voice.tag.excited', 'voice.tag.whispers', 'voice.tag.chuckles', 'voice.tag.giggles',
  'voice.tag.sighs', 'voice.tag.shortPause', 'voice.tag.longPause', 'voice.make', 'voice.makeTooltip', 'voice.makeAgain',
  'voice.makeAgainTooltip', 'voice.makeNew', 'voice.attach', 'voice.attachNoName', 'voice.attachTooltip', 'voice.attach.handing',
  'voice.attach.waiting', 'voice.attach.attached', 'voice.attach.unknown', 'voice.attach.again', 'voice.attach.againLead',
  'voice.attach.againQuestion', 'voice.attach.failed', 'voice.leftover', 'voice.leftoverClear', 'voice.leftoverCleared', 'voice.leftoverRestore', 'voice.download', 'voice.downloaded',
  'voice.takes.label', 'voice.take', 'voice.take.working', 'voice.take.slow', 'voice.take.stale', 'voice.take.attached',
  'voice.take.attachedUnknown', 'voice.take.play', 'voice.take.pause', 'voice.take.seek', 'voice.take.check', 'voice.take.checkTooltip',
  'voice.take.select', 'voice.take.selected', 'voice.take.playFailed', 'voice.take.loading', 'voice.take.charged',
  'voice.take.notCharged', 'voice.take.maybeCharged', 'voice.restart', 'voice.restartTooltip', 'voice.confirm.unattached',
  'voice.confirm.working', 'voice.confirm.question', 'voice.confirm.yes', 'voice.reason.writing',
  'voice.reason.noScript', 'voice.reason.issue', 'voice.reason.working', 'voice.reason.attachOff', 'voice.reason.takesFull',
  'voice.reason.attaching', 'voice.reason.creating',
  // 1.49.0: the day's allowance beside «Озвучить» (the left and short lines are plural keys).
  'voice.allowance.out',
  // ── end of the extension pages ──
] as const;
export type UiTextKey = (typeof UI_TEXT_KEYS)[number];

/** Plural messages (`PluralMessage`): the form is chosen by `Intl.PluralRules` on `{n}`. */
export const UI_PLURAL_KEYS = [
  'popup.waitingReload',
  'common.minutes', 'common.hours', 'common.days', 'common.messages', 'common.fans', 'common.money.dollars',
  'dock.quota.lowTooltip',
  'result.meta.parts', 'result.meta.variants', 'result.meta.partsEach', 'result.announce.ready', 'result.announce.retryIn',
  'recap.archiveLag', 'recap.newAfter', 'recap.coverage.whole',
  'spenders.footer', 'spenders.footerNoTotal',
  // 2026-10-22: the Spenders header's count of a list the hub has more fans for than it holds («1000 из 1240 фанов»).
  'spenders.headOf',
  'fanPanel.footer', 'fanPanel.footerCoverage',
  'coach.archiveLag', 'coach.recap.none',
  'palette.foot.chats',
  'quickJump.unread',
  'settings.status.needActions', 'settings.status.warnings', 'settings.status.row.quotaLeft', 'settings.status.row.runningCount',
  // 1.30.0 (X53)
  'preview.media.count', 'preview.media.previews',
  // 1.35.0 (X61)
  'popup.site.reloadBody',
  // 1.49.0: what the page may still voice today; `{chars}` is the count as the studio prints it, the form follows `n`.
  'voice.allowance.left', 'voice.allowance.short',
] as const;
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
