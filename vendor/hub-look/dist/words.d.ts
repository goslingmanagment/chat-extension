/**
 * The dictionary: one word for one thing in every product (ecosystem plan §4
 * «Слова»). A screen, a message or a vendored client that names one of these
 * things takes the word from here; a new word for an old thing is a change of
 * this file, not of one screen.
 *
 * The forms that go with the words (plan §4): money «$1,234.56», dates
 * «12 нояб., 06:27», time is Moscow's and says so where the reader may be in
 * another zone («по Москве», see format.ts), the reader is addressed as «вы»
 * on every screen (Генгар in a chat speaks as he speaks), no long dash and no
 * arrows in what people read.
 */
/** The things of the agency's work, as a person reads them (capitalised; lower-case them inside a sentence). */
export declare const WORDS: {
    /** Money of the pages after the platform's commission, a Moscow day at a time. */
    readonly income: "Доход";
    /** One operation of a platform (a fan's purchase). */
    readonly sale: "Продажа";
    readonly sales: "Продажи";
    /** Money a fan spent: before the commission, always said so. */
    readonly fanSpend: "Траты фана";
    /** A chatter's work: from 2 h and 50 messages. */
    readonly shift: "Смена";
    readonly shifts: "Смены";
    /** Work shorter than a shift. */
    readonly visit: "Заход";
    /** What a chatter hands in after a shift, and the action of handing it in. */
    readonly shiftReport: "Отчёт смены";
    readonly submitShift: "Сдать смену";
    /** Money of a person. */
    readonly accrued: "Начислено";
    readonly toPay: "К выплате";
    readonly paid: "Выплачено";
    /** A fan's order for a shoot, and who leads it to delivery. */
    readonly custom: "Кастом";
    readonly customs: "Кастомы";
    readonly customsLead: "Ведущий кастомы";
    /** What waits for the person reading (in code: a matter). */
    readonly waitingForYou: "Ждут вас";
    /** Monday to Sunday, Moscow. */
    readonly week: "Неделя";
};
/** The places, by their own names. */
export declare const PLACES: {
    /** The owner's place. */
    readonly hub: "Hub";
    /** The team's place. */
    readonly workboard: "Workboard";
    /** The content's product (a КМ's, the owner's). */
    readonly contentops: "ContentOps";
    /** The owner's outside tools, at the foot of the products' switcher. */
    readonly tasks: "Задачи";
    readonly monitor: "Монитор";
    /** The extension. */
    readonly chatgoose: "ChatGoose";
    /** The team's agent in Telegram. */
    readonly gengar: "Генгар";
};
/**
 * The name of a failure (a notification incident) by its kind: the console's «Система → Сбои» and the list «Ждут
 * вас» say the same words (design/ia.md §5.2). The console checks that every kind of the contract has one.
 */
export declare const INCIDENT_KIND_WORDS: {
    readonly auth_blocked: "Вход заблокирован";
    readonly proxy_failed: "Прокси не работает";
    readonly proxy_missing: "Нет прокси";
    readonly stream_failed_threshold: "Сбор падает 3 раза подряд";
    readonly ofapi_auth: "OnlyFans API: доступ отклонён";
    readonly ofapi_binding_conflict: "OnlyFans API: конфликт привязки";
    readonly ofapi_low_credit: "Мало кредитов OnlyFans API";
    readonly ofapi_webhook_silence: "События OnlyFans API замолчали";
    readonly ofapi_burn_rate: "Кредиты сгорают необычно быстро";
    readonly db_disk_usage: "База: мало места";
    readonly observations_partitions: "База: разделы журнала";
    readonly wrong_transactions_writer: "Операции пишет не тот процесс";
    readonly read_gateway_capture: "Сбор: шлюз чтения";
    readonly golden_signal_lag: "Отставание ключевых метрик";
    readonly scheduler_silent: "Планировщик молчит";
    readonly ops_sampler_silent: "Сбор метрик молчит";
    readonly sync_silent: "Сбор Fansly молчит";
    readonly fansly_sync_engine: "Сбор Fansly: сбой";
    readonly ofapi_chargebacks_reconcile_failed: "Сверка возвратов OnlyFans";
    readonly ofapi_link_stats_reconcile_failed: "Сверка статистики ссылок OnlyFans";
    readonly ai_provider_billing: "ИИ: проблема с оплатой";
    readonly ai_provider_failed: "ИИ: поставщик не отвечает";
    readonly capture_payload_parity: "Расхождение сохранённых данных";
    readonly publishing_stopped: "Hub остановил публикацию";
    readonly publication_not_published: "Пост не вышел";
    readonly ofapi_platform_notice: "OnlyFans написал странице";
    readonly chatspace_tab: "Вкладка ChatSpace на сервере";
};
/** A failure's name by its kind; null — a kind the dictionary does not know (say its code, never nothing). */
export declare function incidentKindWord(kind: string): string | null;
/** The AI buttons: proper names, the same everywhere, never translated. */
export declare const AI_BUTTONS: readonly ["Reply", "Fix", "Hi", "Ping", "Recap", "Coach"];
export type AiButton = (typeof AI_BUTTONS)[number];
/**
 * A Russian first name «кому»: Алекс → Алексу, Андрей → Андрею, Никита → Никите, Катя → Кате, Мария → Марии.
 * Only the first word, only a Cyrillic name with a known ending; null otherwise (a Latin name, a name ending in
 * «ь», «о», «е»…): the caller then says it without the case («Отправить в Telegram: Rick»).
 */
export declare function nameToWhom(name: string): string | null;
