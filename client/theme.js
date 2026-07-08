(function (global) {
  var KEY = 'donut-theme';
  var META = { light: '#f8f4ee', dark: '#15171c' };

  function preferred() {
    return global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function get() {
    var stored = localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : preferred();
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', META[theme] || META.light);
  }

  function set(theme) {
    localStorage.setItem(KEY, theme);
    apply(theme);
    document.dispatchEvent(new CustomEvent('donut-theme', { detail: theme }));
  }

  function toggle() {
    set(get() === 'dark' ? 'light' : 'dark');
  }

  function updateButtons() {
    var dark = get() === 'dark';
    document.querySelectorAll('.btn-theme').forEach(function (btn) {
      btn.textContent = dark ? '☀' : '☾';
      btn.setAttribute('aria-label', dark ? 'Light mode' : 'Dark mode');
      btn.setAttribute('title', dark ? 'Light mode' : 'Dark mode');
    });
  }

  function bind() {
    document.querySelectorAll('.btn-theme').forEach(function (btn) {
      if (btn.dataset.themeBound) return;
      btn.dataset.themeBound = '1';
      btn.addEventListener('click', toggle);
    });
    updateButtons();
  }

  apply(get());

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
  document.addEventListener('donut-theme', updateButtons);

  global.DonutTheme = { get: get, set: set, toggle: toggle };
})(window);