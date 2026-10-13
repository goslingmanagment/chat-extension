// An FBuddy-like neighbour's own Fansly requests (S5 §2.4, §2.7: content-script fetch with the page's token and
// replayed client headers; its 10-s /message/unread poll). Every way a content script can ask, plus its background.
'use strict';
(function () {
  var MV = 'mv3';
  var API = location.protocol + '//apiv3.' + location.host + '/api/v1/';
  var headers = { authorization: 'nb-replayed-token', 'fansly-client-id': 'nb-client' };
  var url = function (how) {
    return API + 'message/unread?limit=100&ngsw-bypass=true&src=nb-' + MV + '-' + how;
  };
  document.addEventListener('cg-spike-nb', function () {
    var out = {};
    var jobs = [];
    jobs.push(fetch(url('fetch'), { headers: headers }).then(function (r) { out.fetch = r.status; }, function (e) { out.fetch = 'error:' + e.message; }));
    jobs.push(new Promise(function (ok) {
      try {
        var x = new XMLHttpRequest();
        x.open('GET', url('xhr'));
        x.setRequestHeader('authorization', 'nb-replayed-token');
        x.onloadend = function () { out.xhr = x.status; ok(); };
        x.send();
      } catch (e) {
        out.xhr = 'error:' + e.message;
        ok();
      }
    }));
    if (typeof content !== 'undefined' && content.fetch) {
      jobs.push(content.fetch(url('content-fetch'), { headers: headers }).then(function (r) { out.contentFetch = r.status; }, function (e) { out.contentFetch = 'error:' + e.message; }));
    }
    jobs.push(browser.runtime.sendMessage({ op: 'fetch', url: url('background') }).then(function (r) { out.background = r; }, function (e) { out.background = 'error:' + e.message; }));
    Promise.all(jobs).then(function () {
      document.documentElement.setAttribute('data-nb-' + MV, JSON.stringify(out));
    });
  });
})();
