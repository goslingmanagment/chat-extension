// Run by the background in every open Telegram Web A tab on install and update (site-access.ts `sync`). An update kills
// the previous isolated realm but leaves its closed DOM: the dock stays in Telegram's composer while the `window` key
// hold that kept Enter from Telegram's send listener died with the realm, so Enter on a dead button sent the field
// (2026-10-29 review). Our dead hosts go; the tab waits for its reload. Nothing of the page is read.
import { removeDeadHosts } from '@cg/host-telegram/isolated/notice';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

export default defineUnlistedScript(() => {
  removeDeadHosts(document);
});
