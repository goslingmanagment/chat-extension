// «Весь трафик через прокси модели» needs Firefox's grant, which only a click on an extension page can ask for: the tab
// says so in a closed-root notice with a way to the settings. A warning the person can pass; nothing is blocked.
import { NOTICE_STYLE } from './notice-style';

const TEXT = {
  message: 'ChatGoose: чтобы весь трафик этой модели шёл через её прокси, нужно разрешение Firefox.',
  allow: 'Разрешить',
  later: 'Позже',
} as const;

// Above the page's own controls, never over the composer and the dock at the bottom.
const OWN_STYLE = ':host { top: 64px; bottom: auto; left: auto; right: 16px; width: 440px; max-width: calc(100vw - 32px); } div { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: 10px; } span { flex: 1 1 100%; } button + button { color: #292522; background: transparent; }';

/** Shows the notice; `allow` opens the settings. One notice a document. */
export function showProxyNotice(doc: Document, allow: () => void): void {
  if (doc.querySelector('div[data-host="proxy-notice"]') !== null) return;
  const host = doc.createElement('div');
  host.setAttribute('data-host', 'proxy-notice');
  const root = host.attachShadow({ mode: 'closed' });
  const panel = doc.createElement('div');
  const style = doc.createElement('style');
  style.textContent = `${NOTICE_STYLE}${OWN_STYLE}`;
  const text = doc.createElement('span');
  text.textContent = TEXT.message;
  const allowButton = doc.createElement('button');
  allowButton.type = 'button';
  allowButton.textContent = TEXT.allow;
  allowButton.addEventListener('click', () => {
    allow();
    host.remove();
  });
  const later = doc.createElement('button');
  later.type = 'button';
  later.textContent = TEXT.later;
  later.addEventListener('click', () => host.remove());
  panel.append(text, allowButton, later);
  root.append(style, panel);
  doc.documentElement.append(host);
}
