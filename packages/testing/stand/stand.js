// Stand page script (synthetic). Records, before any page code could have run,
// what the extension's document_start scripts left behind, so the e2e can
// prove timing without reaching into the extension.
(function () {
  var html = document.documentElement;
  var tapKey = Symbol.for('wsTap');
  html.setAttribute('data-stand-ready-state-at-head', document.readyState);
  html.setAttribute('data-stand-ws-tap-at-head', String(Object.prototype.hasOwnProperty.call(window, tapKey)));
  window.addEventListener('message', function (event) {
    if (event.source === window && event.data && event.data.tag === 'main-ready') {
      html.setAttribute('data-stand-saw-main-ready', '1');
    }
  });
  document.addEventListener('DOMContentLoaded', function () {
    var native;
    try {
      var socket = new WebSocket('ws://127.0.0.1:9/');
      native =
        socket instanceof WebSocket &&
        Object.getPrototypeOf(socket) === WebSocket.prototype &&
        WebSocket.OPEN === 1 &&
        WebSocket.CONNECTING === 0;
      socket.onerror = function () {};
      socket.close();
    } catch (error) {
      native = 'threw:' + String(error && error.name);
    }
    html.setAttribute('data-stand-ws-native', String(native));
    var tap = Object.prototype.hasOwnProperty.call(window, tapKey) ? window[tapKey] : null;
    html.setAttribute('data-stand-ws-tap-sockets', tap ? String(tap.socketCount()) : 'none');
  });
})();
