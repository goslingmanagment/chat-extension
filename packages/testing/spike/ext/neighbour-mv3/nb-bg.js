'use strict';
browser.runtime.onMessage.addListener(function (m) {
  if (!m || m.op !== 'fetch') return undefined;
  return fetch(m.url, { headers: { authorization: 'nb-replayed-token' } }).then(function (r) { return r.status; }, function (e) { return 'error:' + e.message; });
});
