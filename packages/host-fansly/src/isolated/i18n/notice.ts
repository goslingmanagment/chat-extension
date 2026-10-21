// The tiny pre-handshake notice uses the extension's default language (ru).
// No application/catalog import: this independent entry is capped at 2 KiB.
export const NOTICE_TEXT = {
  message: 'ChatGoose: перезагрузите вкладку, чтобы включить расширение на Fansly.',
  // Both add-ons are called «ChatGoose» in Firefox: the old one is told by its version and its English description.
  legacy: 'ChatGoose: мешает старое расширение для Fansly. Выключите его: меню Firefox ☰ → «Дополнения и темы» → ChatGoose версии 2.x («AI-powered chat assistant for Fansly.com»). Потом перезагрузите вкладку.',
  update: 'ChatGoose обновлён: перезагрузите вкладку, чтобы продолжить работу на Fansly.',
  reload: 'Перезагрузить',
} as const;
