'use strict';
// The driver's hands inside the extension: commands to the background, and the «Включить Fansly» button whose
// click handler calls permissions.request synchronously (architecture §4).
const ORIGINS = ['http://fansly.test/*', 'http://apiv3.fansly.test/*'];
window.cmd = (c) => browser.runtime.sendMessage(c);
window.grantResult = null;
document.getElementById('grant').addEventListener('click', () => {
  window.grantResult = 'pending';
  browser.permissions.request({ origins: ORIGINS, permissions: ['webRequest'] }).then(
    (r) => {
      window.grantResult = `ok:${r}`;
    },
    (e) => {
      window.grantResult = `error:${e.message}`;
    },
  );
});
window.requestWithoutGesture = () => browser.permissions.request({ origins: ORIGINS, permissions: ['webRequest'] }).then((r) => `ok:${r}`, (e) => `error:${e.message}`);
window.remove = () => browser.permissions.remove({ origins: ORIGINS, permissions: ['webRequest'] });
