// The browser's enterprise policy for this extension (Firefox `3rdparty.Extensions`, read through storage.managed). The
// agency's always-on ChatSpace tab on its server (hub apps/chatspace-browser) says `serverTab: true` there. A chatter's
// Firefox has no policy for us: the read throws, and the answer is false.

import { defaultBrowser, type BrowserApi } from './browser-api';

/** true — this Firefox is the agency's always-on ChatSpace tab (its policy says so); false — anything else, any failure. */
export async function readServerTab(api: BrowserApi = defaultBrowser()): Promise<boolean> {
  try {
    const managed = api.storage.managed;
    if (managed === undefined) return false;
    const value = await managed.get('serverTab');
    return value.serverTab === true;
  } catch {
    return false;
  }
}
