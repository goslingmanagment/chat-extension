// R20 P9e: a preview inserts through P7e and accounts for P7f's gesture-linked
// human sends. No X8 journal or preview send on this host. Whether the fan read
// our newest message is the group's, read by Fansly's background module.
export { openOnlinePreview, type BoardHandover, type BoardResults } from '@cg/core/application/preview';
export { PreviewSendDriver } from '@cg/core/services';
import { createPreviewController as create, type ChatReadPort, type PreviewControllerDeps } from '@cg/core/application/preview';
import { fanslyRequest } from '../../src/composition/tab/hosts/fansly/requests';

/** The group's read state lives behind the background's pacer: a click's read, which may wake the event page first. */
const READ_STATE_TIMEOUT_MS = 15_000;

function fanslyReadState(rpc: PreviewControllerDeps['rpc']): ChatReadPort {
  return {
    async read({ pageId, chat, conversationRef }) {
      if (conversationRef === null) return { ok: false, reason: 'unavailable' };
      const answer = await fanslyRequest(rpc, 'fansly.preview.readState', { pageId, hostAccountId: chat.hostAccountId, fanRef: chat.platformFanId, groupId: conversationRef }, READ_STATE_TIMEOUT_MS);
      return answer.ok && answer.payload.ok ? { ok: true, last: answer.payload.last } : { ok: false, reason: 'unavailable' };
    },
  };
}

export const createPreviewController = (deps: PreviewControllerDeps) => create({ ...deps, previewSend: false, sender: null, readState: fanslyReadState(deps.rpc) });
