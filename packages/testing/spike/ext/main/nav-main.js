// Item 6 control: the same Navigation API listeners in the page's own world.
(function () {
  var log = [];
  Object.defineProperty(window, '__navMain', { value: log });
  var nav = window.navigation;
  if (!nav) {
    log.push({ type: 'no-navigation-api' });
    return;
  }
  ['navigate', 'currententrychange'].forEach(function (type) {
    nav.addEventListener(type, function (e) {
      log.push({ type: type, path: location.pathname, nav: e.navigationType || null, dest: e.destination ? new URL(e.destination.url).pathname : null });
    });
  });
  addEventListener('popstate', function () {
    log.push({ type: 'popstate', path: location.pathname });
  });
})();
