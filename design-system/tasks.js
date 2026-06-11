/* tasks.js — Flat list view of tasks across the current project. */
(function () {
  'use strict';
  var api = window.__kanban_api;

  var STATE_LABEL = {
    'TODO': { text: 'TODO', icon: 'ph-circle', cls: 'bg-white/5 text-st_todo' },
    'IN_PROGRESS': { text: 'IN_PROGRESS', icon: 'ph-circle-notch', cls: 'bg-st_prog/12 text-st_prog', fill: true },
    'IMPLEMENTED': { text: 'IMPLEMENTED', icon: 'ph-check-circle', cls: 'bg-st_impl/12 text-st_impl', fill: true },
    'EVIDENCE': { text: 'EVIDENCE', icon: 'ph-seal-check', cls: 'bg-st_self/12 text-st_self', fill: true },
    'SELF_CHECK_PASSED': { text: 'SELF_CHECK_PASSED', icon: 'ph-shield-check', cls: 'bg-st_self/12 text-st_self', fill: true },
    'SELF_CHECK_FAILED': { text: 'SELF_CHECK_FAILED', icon: 'ph-warning', cls: 'bg-st_selffail/12 text-st_selffail', fill: true },
    'JUDGE_REJECTED': { text: 'JUDGE_REJECTED', icon: 'ph-x-circle', cls: 'bg-st_reject/12 text-st_reject', fill: true },
    'JUDGE_PASSED': { text: 'JUDGE_PASSED', icon: 'ph-gavel', cls: 'bg-st_human/15 text-st_human', fill: true },
    'DONE': { text: 'DONE', icon: 'ph-check-fat', cls: 'bg-st_done/12 text-st_done', fill: true },
  };

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function relTime(iso) {
    if (!iso) return '';
    var d = new Date(iso), now = new Date(), s = Math.floor((now - d) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  var allItems = []; // {task, project}

  function showOnly(id) {
    ['tasks-loading', 'tasks-error', 'tasks-empty', 'tasks-table-wrap'].forEach(function (x) {
      document.getElementById(x).classList.toggle('hidden', x !== id);
    });
  }

  function render() {
    var filter = document.getElementById('state-filter').value;
    var q = (document.getElementById('task-search').value || '').toLowerCase().trim();
    var rows = allItems.filter(function (it) {
      if (filter && it.task.state !== filter) return false;
      if (q) {
        var hay = (it.task.key + ' ' + it.task.title).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    if (rows.length === 0) { showOnly('tasks-empty'); return; }
    showOnly('tasks-table-wrap');

    var tbody = document.getElementById('tasks-tbody');
    tbody.innerHTML = '';
    rows.forEach(function (it) {
      var t = it.task, slug = it.project;
      var st = STATE_LABEL[t.state] || { text: t.state, icon: 'ph-circle', cls: 'bg-white/5 text-muted' };
      var fill = st.fill ? '-fill' : '';
      var tr = document.createElement('tr');
      tr.setAttribute('role', 'row');
      tr.tabIndex = 0;
      tr.className = 'cursor-pointer border-b border-border/60 hover:bg-white/5 focus:bg-white/5 outline-none';
      tr.setAttribute('aria-label', t.key + ' ' + t.title + ' ' + t.state);
      tr.innerHTML =
        '<td class="py-2.5 pr-3 mono text-[13px] text-muted">' + esc(t.key) + '</td>' +
        '<td class="py-2.5 pr-3 text-[14px]">' + esc(t.title) + '</td>' +
        '<td class="py-2.5 pr-3"><span class="inline-flex items-center gap-1 mono text-[13px] px-1.5 py-0.5 rounded ' + st.cls + '"><i class="ph' + fill + ' ' + st.icon + ' text-[13px]"></i> ' + esc(st.text) + '</span></td>' +
        '<td class="py-2.5 mono text-[13px] text-muted text-right">' + esc(relTime(t.updated_at)) + '</td>';
      tr.addEventListener('click', function () { window.__openDrawer(slug, t.key); });
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.__openDrawer(slug, t.key); }
      });
      tbody.appendChild(tr);
    });
  }

  window.loadTasks = function () {
    if (!api) return;
    showOnly('tasks-loading');
    allItems = [];

    // Scope to the project in the URL path (/<project>/tasks.html), same
    // pattern as the board. tasks.html redirects when there is no prefix.
    var fromPath = window.projectFromPath ? window.projectFromPath() : '';

    api.listProjects().then(function (res) {
      if (!res || !res.projects) { showOnly('tasks-empty'); return; }
      var projects = res.projects;
      if (projects.length === 0) {
        // 0 projects: show an explicit empty state — never leave the
        // loading skeleton up (tasks.html is redirecting to first-run).
        var ps = document.getElementById('tasks-empty').querySelectorAll('p');
        if (ps[0]) ps[0].textContent = 'No projects yet';
        if (ps[1]) ps[1].textContent = 'Create your first project to see tasks here.';
        showOnly('tasks-empty');
        return;
      }
      if (!fromPath) return; // tasks.html inline script is redirecting to /<first>/tasks.html
      var proj = null;
      projects.forEach(function (p) {
        if (p.slug === fromPath || p.id === fromPath) proj = p;
      });
      if (!proj) {
        showOnly('tasks-error');
        document.getElementById('tasks-error-msg').textContent = 'Project not found: ' + fromPath;
        return;
      }
      var slug = proj.slug || proj.id;
      api.listTasks(slug).then(function (tres) {
        if (tres && tres.tasks) {
          tres.tasks.forEach(function (t) { allItems.push({ task: t, project: slug }); });
        }
        render();
      }).catch(function (err) {
        showOnly('tasks-error');
        document.getElementById('tasks-error-msg').textContent = String(err);
      });
    }).catch(function (err) {
      showOnly('tasks-error');
      document.getElementById('tasks-error-msg').textContent = String(err);
    });
  };

  // Hash deep-link: index.html#task=<KEY> opens drawer
  function openFromHash() {
    var m = location.hash.match(/[#&]task=([^&]+)/);
    if (!m) return;
    var key = decodeURIComponent(m[1]);
    // Find matching task in allItems
    var found = allItems.find(function (it) { return it.task.key === key; });
    if (found) window.__openDrawer(found.project, found.task.key);
  }

  // Drawer wiring (mirrors index.html drawer behavior)
  window.__openDrawer = function (project, key) {
    var drawer = document.getElementById('drawer');
    var scrim = document.getElementById('scrim');
    drawer.classList.remove('translate-x-full');
    scrim.classList.remove('opacity-0', 'pointer-events-none');
    document.getElementById('drawer-key').textContent = key;
    document.getElementById('drawer-title').textContent = 'Loading…';
    document.getElementById('drawer-state-badge').innerHTML = '';
    document.getElementById('drawer-project').textContent = project;
    document.getElementById('drawer-updated').textContent = '';
    document.getElementById('drawer-body').innerHTML = '<div class="grid place-items-center py-8 text-muted text-[14px]"><span class="flex items-center gap-2"><i class="ph ph-spinner animate-spin text-[17px]"></i> Loading…</span></div>';

    if (!api) return;
    api.getTask(project, key).then(function (res) {
      if (!res || !res.task) {
        document.getElementById('drawer-body').innerHTML = '<p class="text-ev_fail text-[14px]">Task not found.</p>';
        return;
      }
      var t = res.task;
      document.getElementById('drawer-title').textContent = t.title;
      document.getElementById('drawer-updated').textContent = relTime(t.updated_at);
      var st = STATE_LABEL[t.state] || { text: t.state, icon: 'ph-circle', cls: 'bg-white/5 text-muted' };
      document.getElementById('drawer-state-badge').className = 'inline-flex items-center gap-1 mono text-[13px] px-1.5 py-0.5 rounded ' + st.cls;
      document.getElementById('drawer-state-badge').innerHTML = '<i class="ph' + (st.fill ? '-fill' : '') + ' ' + st.icon + ' text-[13px]"></i>' + esc(st.text);

      var html = '<section><h3 class="text-[13px] uppercase tracking-wider text-muted mb-2 flex items-center gap-1.5"><i class="ph ph-file-text text-[14px]"></i> Spec</h3>';
      html += '<div class="text-text/90 leading-relaxed text-[13px] whitespace-pre-wrap">' + esc(t.body_md || '(no spec)') + '</div></section>';

      if (res.gitrefs && res.gitrefs.length > 0) {
        html += '<section><h3 class="text-[13px] uppercase tracking-wider text-muted mb-2 flex items-center gap-1.5"><i class="ph ph-git-branch text-[14px]"></i> Repos &amp; MR</h3><div class="space-y-2">';
        res.gitrefs.forEach(function (g) {
          html += '<div class="rounded-lg border border-border bg-panel2 p-2.5"><span class="mono text-[13px] font-medium">' + esc(g.repo || '') + '</span>';
          if (g.branch) html += '<div class="mt-1 mono text-[13px] text-muted">' + esc(g.branch) + '</div>';
          if (g.head_sha) html += '<div class="mt-0.5 mono text-[13px] text-muted">' + esc(g.head_sha.substring(0, 7)) + '</div>';
          html += '</div>';
        });
        html += '</div></section>';
      }

      if (res.evidence) {
        html += '<section><h3 class="text-[13px] uppercase tracking-wider text-muted mb-2 flex items-center gap-1.5"><i class="ph ph-seal-check text-[14px]"></i> Evidence</h3>';
        html += '<div class="rounded-lg border border-border bg-panel2 divide-y divide-border">';
        var ev = res.evidence;
        if (ev.build_exit !== undefined) html += '<div class="flex items-center justify-between px-3 py-2"><span class="flex items-center gap-1.5 text-[13px] text-muted"><i class="ph-fill ph-hammer text-[14px]"></i> build</span><span class="mono text-[13px] ' + (ev.build_exit === 0 ? 'text-ev_pass' : 'text-ev_fail') + '">exit ' + ev.build_exit + '</span></div>';
        if (ev.test_exit !== undefined) html += '<div class="flex items-center justify-between px-3 py-2"><span class="flex items-center gap-1.5 text-[13px] text-muted"><i class="ph-fill ph-test-tube text-[14px]"></i> test</span><span class="mono text-[13px] ' + (ev.test_exit === 0 ? 'text-ev_pass' : 'text-ev_fail') + '">exit ' + ev.test_exit + '</span></div>';
        html += '</div></section>';
      }

      document.getElementById('drawer-body').innerHTML = html;
    }).catch(function (err) {
      document.getElementById('drawer-body').innerHTML = '<p class="text-ev_fail text-[14px]">Failed to load task: ' + esc(String(err)) + '</p>';
    });
  };

  window.closeDrawer = function () {
    var drawer = document.getElementById('drawer');
    var scrim = document.getElementById('scrim');
    drawer.classList.add('translate-x-full');
    scrim.classList.add('opacity-0', 'pointer-events-none');
  };

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') window.closeDrawer();
  });

  document.getElementById('state-filter').addEventListener('change', render);
  document.getElementById('task-search').addEventListener('input', render);
  window.addEventListener('hashchange', openFromHash);

  // Init
  loadTasks();
  // Defer hash open until tasks load
  var origRender = render;
  render = function () { origRender(); openFromHash(); };
})();
