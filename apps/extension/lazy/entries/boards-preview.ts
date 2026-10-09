// The preview controller (R12): the view `preview` of a fan from Spenders,
// «Новые» or the palette — the archive feed, the local draft, generation,
// «Отправить» (X8) and «Открыть и вставить» — and the tab side of an X8 send
// (R10's driver: preflight in MAIN, `send.begin`, one queue call, the states
// MAIN observes), and the palette's «Онлайн» choice opening a preview in its
// own window (X24). Loaded together with `boards`.

export { createPreviewController, openOnlinePreview, type BoardHandover, type BoardResults } from '@cg/core/application/preview';
export { PreviewSendDriver } from '@cg/core/services';
