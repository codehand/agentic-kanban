/* Agentic Kanban - shared Tailwind (Play CDN) theme. Loaded after cdn.tailwindcss.com. */

/* ---- Apply-before-paint: set theme before first render (no flash) ---- */
(function () {
  'use strict';
  var KEY = 'ak-theme';
  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (_) {}
  var prefersDark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = stored || (prefersDark ? 'dark' : 'light'); // no stored choice: follow the OS preference
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  window.__kanbanTheme = { key: KEY, get: function () { return document.documentElement.classList.contains('dark') ? 'dark' : 'light'; } };
})();

/* ---- Tailwind config — colors reference CSS vars so toggling .dark re-themes ---- */
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        bg:       'var(--bg)',
        panel:    'var(--panel)',
        panel2:   'var(--panel2)',
        border:   'var(--border)',
        borderlt: 'var(--borderlt)',
        text:     'var(--text)',
        muted:    'var(--muted)',
        accent:   'var(--accent)',
        // semantic workflow-state hues (one hue per state, used everywhere)
        st_todo:     'var(--st_todo)',
        st_prog:     'var(--st_prog)',
        st_impl:     'var(--st_impl)',
        st_self:     'var(--st_self)',
        st_selffail: 'var(--st_selffail)',
        st_human:    'var(--st_human)',
        st_reject:   'var(--st_reject)',
        st_done:     'var(--st_done)',
        // evidence semantics
        ev_pass: 'var(--ev_pass)',
        ev_fail: 'var(--ev_fail)',
        ev_warn: 'var(--ev_warn)',
      },
    },
  },
};

/* ---- Wire CTA toggle once DOM is ready ---- */
document.addEventListener('DOMContentLoaded', function () {
  'use strict';
  var btn = document.getElementById('theme-toggle');
  if (!btn) return;

  function syncIcon() {
    var icon = btn.querySelector('i');
    if (!icon) return;
    var isDark = document.documentElement.classList.contains('dark');
    icon.className = isDark ? 'ph ph-moon text-[15px]' : 'ph ph-sun text-[15px]';
    btn.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
  }

  btn.addEventListener('click', function () {
    document.documentElement.classList.toggle('dark');
    var isDark = document.documentElement.classList.contains('dark');
    try { localStorage.setItem(window.__kanbanTheme.key, isDark ? 'dark' : 'light'); } catch (_) {}
    syncIcon();
  });

  syncIcon();

  // Also react to OS-level theme changes when user hasn't manually chosen
  if (typeof matchMedia !== 'undefined') {
    var mq = matchMedia('(prefers-color-scheme: dark)');
    var handler = function () {
      var stored = null;
      try { stored = localStorage.getItem(window.__kanbanTheme.key); } catch (_) {}
      if (stored) return; // user has manual preference — ignore OS
      if (mq.matches) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
      syncIcon();
    };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  }
});
