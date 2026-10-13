// An FBuddy-like page hook (S5 §2.3, §2.6), loaded asynchronously after our MAIN: it takes
// `OriginalXHR = window.XMLHttpRequest` (our Proxy, if we stood first), patches open/send/setRequestHeader on
// `OriginalXHR.prototype` (the native prototype through the Proxy), adds its listeners at send time, posts every
// API response body to `window` with "*", and — the restricted-words guard — SWALLOWS a POST /message whose
// content has a restricted word: no native send, so no loadstart and no other XHR event; the text goes back into
// the composer with an untrusted input event on the next frame.
(function () {
  if (window.__FBUDDY_NETWORK_HOOK__) return;
  window.__FBUDDY_NETWORK_HOOK__ = true;
  var OriginalXHR = window.XMLHttpRequest;
  var proto = OriginalXHR.prototype;
  var open = proto.open;
  var send = proto.send;
  var setHeader = proto.setRequestHeader;
  var WORDS = ['forbidden'];
  proto.open = function (method, url) {
    this.__fbuddyRequestInfo = { method: String(method), url: String(url) };
    this.__fbuddyShouldCheck = /POST/i.test(method) && /apiv3\.fansly\.(?:com|test)(?::\d+)?\/api\/v1\/message/i.test(String(url));
    return open.apply(this, arguments);
  };
  proto.setRequestHeader = function (name, value) {
    return setHeader.apply(this, arguments);
  };
  proto.send = function (body) {
    var xhr = this;
    if (xhr.__fbuddyShouldCheck && typeof body === 'string') {
      var content = '';
      try {
        content = JSON.parse(body).content || '';
      } catch (e) {
        content = body;
      }
      for (var i = 0; i < WORDS.length; i += 1) {
        if (new RegExp('\\b' + WORDS[i] + '\\b', 'i').test(content)) {
          window.__nbSwallowed = (window.__nbSwallowed || 0) + 1;
          requestAnimationFrame(function () {
            var ta = document.querySelector('textarea.message-input');
            if (!ta) return;
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, content);
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
          });
          return undefined;
        }
      }
    }
    if (xhr.__fbuddyRequestInfo) {
      var done = function () {
        try {
          window.postMessage({ marker: 'fbuddy', name: 'fbuddy:network-event', payload: { url: xhr.responseURL, status: xhr.status, body: xhr.responseType === '' || xhr.responseType === 'text' ? xhr.responseText : null } }, '*');
        } catch (e) {
          // ignore
        }
      };
      xhr.addEventListener('load', done);
    }
    return send.apply(this, arguments);
  };
})();
