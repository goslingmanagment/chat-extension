// The reload banner (fansly-notice.js, architecture §4): injected by executeScript into tabs that were open
// before the update or the grant. Cleans up OUR orphaned hosts only, by data-host.
(function () {
  var removed = 0;
  document.querySelectorAll('[data-host="cg-dock"]').forEach(function (n) {
    n.remove();
    removed += 1;
  });
  var d = document.createElement('div');
  d.setAttribute('data-host', 'cg-notice');
  d.textContent = 'ChatGoose обновился — перезагрузите вкладку';
  (document.body || document.documentElement).appendChild(d);
  var page = window.wrappedJSObject || {};
  return { banner: true, removed: removed, order: document.documentElement.dataset.order || null, oldMain: page.__cgReg ? page.__cgReg.version : null, isoVersion: document.documentElement.dataset.isoVersion || null };
})();
