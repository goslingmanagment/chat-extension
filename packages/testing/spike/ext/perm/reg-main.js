// Registered MAIN script (document_start): leaves its place in the order and a version marker.
(function () {
  var h = document.documentElement;
  h.dataset.order = (h.dataset.order || '') + 'main,';
  window.__cgReg = { at: performance.now(), readyState: document.readyState, version: '__VERSION__' };
})();
