// Registered ISOLATED script (document_start): its place in the order; on demand, imports through
// web_accessible_resources (and one file that is not one), and whether its extension context is still alive.
'use strict';
(function () {
  var h = document.documentElement;
  h.dataset.order = (h.dataset.order || '') + 'iso,';
  h.dataset.isoVersion = '__VERSION__';
  document.addEventListener('cg-spike-iso', function () {
    var out = { version: '__VERSION__' };
    try {
      out.alive = typeof browser.runtime.id === 'string';
    } catch (e) {
      out.alive = 'dead:' + e.message;
    }
    var paths = ['lazy/probe.mjs', 'nowar/probe.mjs'];
    Promise.all(
      paths.map(function (p) {
        var t = performance.now();
        return import(browser.runtime.getURL(p)).then(
          function (m) {
            return p + '=ok:' + m.value + ':' + (performance.now() - t).toFixed(2) + 'ms';
          },
          function (e) {
            return p + '=error:' + e.message;
          },
        );
      }),
    ).then(function (r) {
      out.imports = r;
      h.dataset.isoResult = JSON.stringify(out);
    });
  });
})();
