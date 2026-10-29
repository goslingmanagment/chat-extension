// The notice script's whole job on Telegram (apps/extension telegram-notice.ts): after an install or update, the previous
// isolated realm's hosts off the page. Their closed DOM outlives the realm, and so would the dock in Web A's composer,
// without the `window` key hold that kept Enter from Telegram's send listener. Nothing of the page is read.
import { removeStaleHosts } from '@cg/host-kit/isolated/hosts';

/** Our dead hosts taken off `doc`; how many went. */
export function removeDeadHosts(doc: Document): number {
  return removeStaleHosts(doc);
}
