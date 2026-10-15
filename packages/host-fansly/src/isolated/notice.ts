// A closed-root notice, without a socket tap, page reads or network access.
// Recognise only our old closed-host shape. Foreign data-host values and any
// node with light-DOM children stay untouched (host-kit/X22).
import { NOTICE_TEXT } from './i18n/notice';
import { NOTICE_STYLE } from './notice-style';
import { removeStaleHosts } from '@cg/host-kit/isolated/hosts';

export function showReloadNotice(doc: Document): void {
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
  text.textContent = NOTICE_TEXT.message;
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = NOTICE_TEXT.reload;

  button.addEventListener('click', () => doc.defaultView?.location.reload());
  panel.append(text, button);
  root.append(style, panel);
  doc.documentElement.append(host);
}
