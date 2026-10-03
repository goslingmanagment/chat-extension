// The tab's application (architecture.md §10.2, §11: ≤ 30 KiB on top of the
// dock): the AppClient router, the controllers, the tab's logger and the I18n
// port without a catalog. Loaded with the first composer, never outside a chat.

export { startTabApp, type TabApp, type TabAppEnv } from '../../src/composition/tab/app';
