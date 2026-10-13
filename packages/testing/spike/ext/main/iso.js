// The isolated peer of the MAIN prototype: the host-kit handshake (iso-hello / main-ready / connect with a port),
// acks every fx.batch (credits), counts what arrives; on demand asks for a generation snapshot. Item 6: Navigation
// API listeners from the isolated world (Xray to window.navigation).
'use strict';
(function () {
  var q = new URLSearchParams(location.search);
  var slow = q.get('slow') === '1';
  var h = document.documentElement;
  var stats = { connected: false, batches: 0, events: {}, sent: [], gaps: 0, res: 0, snapshots: [], firstBatchAt: null };
  var nav = [];
  var port = null;
  var id = 0;
  var seq = 0;
  var pending = {};
  function request(t, payload) {
    id += 1;
    var my = id;
    var at = performance.now();
    port.postMessage({ v: 1, kind: 'req', id: my, t: t, documentEpoch: null, seq: seq++, payload: payload || {} });
    return new Promise(function (ok) {
      pending[my] = function (r) {
        ok({ r: r, ms: performance.now() - at });
      };
    });
  }
  function onPort(e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.kind === 'res') {
      stats.res += 1;
      var cb = pending[d.id];
      delete pending[d.id];
      if (cb) cb(d);
      return;
    }
    if (d.kind !== 'evt') return;
    if (d.t === 'fx.gap') {
      stats.gaps += 1;
      return;
    }
    if (d.t !== 'fx.batch') return;
    stats.batches += 1;
    if (stats.firstBatchAt === null) stats.firstBatchAt = performance.now();
    var evs = (d.payload && d.payload.events) || [];
    for (var i = 0; i < evs.length; i += 1) {
      var ev = evs[i];
      stats.events[ev.t] = (stats.events[ev.t] || 0) + 1;
      if (ev.t === 'fx.sent') stats.sent.push(ev.p);
    }
    if (!slow) request('fx.ack', { n: d.payload.n });
  }
  function connect() {
    if (port) return;
    var ch = new MessageChannel();
    port = ch.port1;
    port.onmessage = onPort;
    window.postMessage({ tag: 'connect', v: 1, nonce: Math.random().toString(36).slice(2) }, location.origin, [ch.port2]);
    stats.connected = true;
    request('fx.state', {});
  }
  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.v !== 1) return;
    if (e.data.tag === 'main-ready') connect();
  });
  window.postMessage({ tag: 'iso-hello', v: 1 }, location.origin);

  if (window.navigation) {
    ['navigate', 'currententrychange'].forEach(function (type) {
      window.navigation.addEventListener(type, function (e) {
        nav.push({ type: type, path: location.pathname, nav: e.navigationType || null, dest: e.destination ? new URL(e.destination.url).pathname : null });
      });
    });
  } else {
    nav.push({ type: 'no-navigation-api' });
  }
  window.addEventListener('popstate', function () {
    nav.push({ type: 'popstate', path: location.pathname });
  });

  document.addEventListener('cg-spike-dump', function () {
    h.dataset.isoDump = JSON.stringify({ stats: stats, nav: nav });
  });
  document.addEventListener('cg-spike-snapshot', function (e) {
    var gid = h.dataset.snapGroup;
    request('fx.generationSnapshot', { groupId: gid, feature: h.dataset.snapFeature || 'reply', window: 100, withText: true }).then(function (out) {
      var data = out.r && out.r.data;
      stats.snapshots.push({ roundTripMs: out.ms, mainMs: data && data.ms, completeness: data && data.completeness, gap: data && data.gap, window: data && data.window && data.window.length, tail: data && data.tail && data.tail.length, bytes: JSON.stringify(data || null).length });
      h.dataset.snapDone = String(stats.snapshots.length);
    });
  });
})();
