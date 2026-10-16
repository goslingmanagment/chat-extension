// A closed-root notice, without a socket tap, page reads or network access.
// Recognise only our old closed-host shape. Foreign data-host values and any
// node with light-DOM children stay untouched (host-kit/X22).
import { hasLegacyDom, INSTANCE_ATTRIBUTE, type StopReason } from './legacy-markers';
import { NOTICE_TEXT } from './i18n/notice';
import { NOTICE_STYLE } from './notice-style';
import { removeStaleHosts } from '@cg/host-kit/isolated/hosts';

/**
 * Why a reload, when the caller does not say (the background's `fansly-notice.js`, FS-IDN-4): the old extension's
 * marks — switch it off first; a copy of ours ran in this document (its `data-fx-instance`) — the extension was
 * updated (R20 P14c, UP-009); else — Fansly was just switched on.
 */
export function noticeReason(doc: Document): StopReason | 'message' {
  if (hasLegacyDom(doc)) return 'legacy';
  return doc.documentElement?.hasAttribute(INSTANCE_ATTRIBUTE) === true ? 'update' : 'message';
}

export function showReloadNotice(doc: Document, reason?: StopReason): void {
  removeStaleHosts(doc);
  // An update kills the previous isolated realm, but leaves its closed DOM.
  // Recreate even a same-instance notice so a dead listener never survives.
  for (const node of doc.querySelectorAll('div[data-host="reload-notice"]')) if (node.childNodes.length === 0) node.remove();
  const host = doc.createElement('div');
  host.setAttribute('data-host', 'reload-notice');

  const root = host.attachShadow({ mode: 'closed' });
  const panel = doc.createElement('div');
  const style = doc.createElement('style');
  style.textContent = NOTICE_STYLE;
  const text = doc.createElement('span');
  text.textContent = NOTICE_TEXT[reason ?? noticeReason(doc)];
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = NOTICE_TEXT.reload;

  button.addEventListener('click', () => doc.defaultView?.location.reload());
  panel.append(text, button);
  root.append(style, panel);
  doc.documentElement.append(host);
}
