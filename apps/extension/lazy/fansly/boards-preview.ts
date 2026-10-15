// R20 P9e: a preview inserts through P7e and accounts for P7f's gesture-linked
// human sends. No X8 journal or preview send on this host.
export { openOnlinePreview, type BoardHandover, type BoardResults } from '@cg/core/application/preview';
export { PreviewSendDriver } from '@cg/core/services';
import { createPreviewController as create, type PreviewControllerDeps } from '@cg/core/application/preview';
export const createPreviewController = (deps: PreviewControllerDeps) => create({ ...deps, previewSend: false, sender: null });
