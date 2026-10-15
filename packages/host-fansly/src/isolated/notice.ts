// A closed-root notice, without a socket tap, page reads or network access.
// Recognise only our old closed-host shape. Foreign data-host values and any
// node with light-DOM children stay untouched (host-kit/X22).
import { removeStaleHosts } from '@cg/host-kit/isolated/hosts';

export function showReloadNotice(doc: Document): void {
  removeStaleHosts(doc);
  if (doc.querySelector('div[data-host="reload-notice"]') !== null) return;
  const host = doc.createElement('div');
  host.setAttribute('data-host', 'reload-notice');
  host.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  const panel = doc.createElement('div');
  panel.style.cssText = 'font:14px/1.5 system-ui,sans-serif;color:#292522;background:#fffaf2;border:1px solid #cbbba8;border-radius:12px;padding:14px 18px;box-shadow:0 4px 20px #0003;display:flex;gap:18px;align-items:center;justify-content:space-between;';
  const text = doc.createElement('span');
  text.textContent = 'ChatGoose: перезагрузите вкладку, чтобы включить расширение на Fansly.';
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = 'Перезагрузить';
  button.style.cssText = 'font:inherit;padding:8px 14px;border:0;border-radius:8px;color:white;background:#a75b42;cursor:pointer;';
  button.addEventListener('click', () => doc.defaultView?.location.reload());
  panel.append(text, button);
  root.append(panel);
  doc.documentElement.append(host);
}
