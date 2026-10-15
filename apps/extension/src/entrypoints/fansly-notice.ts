// Late documents need a reload, never a late MAIN injection (§4, FS-IDN-4).
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { showReloadNotice } from '@cg/host-fansly/isolated/notice';

export default defineUnlistedScript(() => showReloadNotice(document));
