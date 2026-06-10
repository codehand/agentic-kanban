/* Agentic Kanban - shared app shell. Injects the left rail (consistent everywhere).
 * Each page sets:
 *   <body data-active="board|projects|tokens" data-project="opf-hub" data-awaiting="2">
 * and provides <aside id="rail"></aside> as the mount point.  */
(function () {
  const body = document.body;
  const active = body.dataset.active || '';
  const awaiting = body.dataset.awaiting ?? '2';

  /* projectFromPath() — current project read from the URL path.
   * '/<project-id>/index.html' -> '<project-id>'. Page files at the root
   * ('/index.html', '/tasks.html', …) have no project prefix -> ''. */
  function projectFromPath() {
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    if (!seg || seg.indexOf('.') !== -1) return '';
    return decodeURIComponent(seg);
  }
  window.projectFromPath = projectFromPath;

  const project = projectFromPath() || body.dataset.project || '—';

  const nav = (key, href, icon, label) => {
    const on = key === active;
    return `<a href="${href}" class="flex items-center gap-2.5 rounded-md px-2.5 py-2 ${
      on ? 'bg-accent/12 text-text font-medium' : 'text-muted hover:bg-white/5 hover:text-text'
    }"><i class="ph${on ? '-fill' : ''} ph-${icon} text-[17px] ${on ? 'text-accent' : ''}"></i> ${label}</a>`;
  };

  const rail = document.getElementById('rail');
  if (rail) {
    rail.className = 'hidden lg:flex w-[244px] shrink-0 flex-col border-r border-border bg-panel';
    rail.innerHTML = `
      <div class="flex items-center gap-2.5 px-4 h-14 border-b border-border">
        <span class="grid place-items-center w-7 h-7 rounded-md bg-accent/15 text-accent"><i class="ph-fill ph-kanban text-[18px]"></i></span>
        <div class="leading-tight">
          <div class="text-[14px] font-semibold tracking-tight">Agentic Kanban</div>
          <div class="text-[13px] text-muted mono">mission control</div>
        </div>
      </div>

      <div class="px-3 pt-3 relative">
        <button id="project-switcher" aria-haspopup="menu" aria-expanded="false" aria-label="Switch project"
          class="w-full flex items-center justify-between gap-2 rounded-md border border-border bg-panel2 px-2.5 py-2 text-left hover:border-borderlt">
          <span class="flex items-center gap-2 min-w-0">
            <span class="w-2 h-2 rounded-sm bg-accent shrink-0"></span>
            <span id="project-switcher-label" class="text-[13px] font-medium truncate">${project}</span>
          </span>
          <i class="ph ph-caret-up-down text-muted text-[15px]"></i>
        </button>
        <div id="project-menu" role="menu" aria-label="Projects"
          class="hidden absolute left-3 right-3 top-full mt-1 z-50 rounded-md border border-border bg-panel2 shadow-lg py-1 max-h-64 overflow-y-auto">
          <span class="block px-2.5 py-2 text-[13px] text-muted">Loading projects&hellip;</span>
        </div>
      </div>

      <nav class="px-2 pt-3 space-y-0.5 text-[14px]">
        ${nav('board', 'index.html', 'squares-four', 'Board')}
        ${nav('tasks', 'tasks.html', 'list-checks', 'Tasks')}
        ${nav('projects', 'projects.html', 'folders', 'Projects')}
        ${nav('tokens', 'tokens.html', 'key', 'Tokens')}
      </nav>

      <div class="px-3 mt-4">
        <a href="index.html#col-human" class="block w-full rounded-lg border border-st_human/40 bg-st_human/10 glow-human-soft px-3 py-2.5 text-left hover:bg-st_human/15">
          <div class="flex items-center justify-between">
            <span class="flex items-center gap-2 text-[13px] font-medium text-st_human"><i class="ph-fill ph-hand-tap text-[16px]"></i> Awaiting You</span>
            <span class="mono text-[14px] font-semibold text-st_human">${awaiting}</span>
          </div>
          <p class="mt-1 text-[13px] text-muted leading-snug">Tasks the gate cleared and only you can mark Done.</p>
        </a>
      </div>

      <div class="mt-auto px-3 pb-3">
        <div class="rounded-md border border-border bg-panel2 px-2.5 py-2 text-[13px]">
          <div class="flex items-center justify-between">
            <span class="flex items-center gap-1.5 text-muted"><span class="w-1.5 h-1.5 rounded-full bg-ev_pass heartbeat"></span> Connected</span>
            <span class="mono text-muted">SSE</span>
          </div>
          <div class="mt-1.5 flex items-center justify-between text-muted">
            <span class="flex items-center gap-1.5"><i class="ph ph-user-circle text-[15px]"></i> operator</span>
            <span class="mono text-[13px] px-1.5 py-0.5 rounded bg-white/5">human</span>
          </div>
        </div>
      </div>`;

    /* Project switcher: real dropdown backed by GET /api/projects. */
    const btn = document.getElementById('project-switcher');
    const menu = document.getElementById('project-menu');
    const current = projectFromPath();

    function closeMenu() {
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    }
    function openMenu() {
      menu.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      const first = menu.querySelector('a');
      if (first) first.focus();
    }
    btn.addEventListener('click', () => {
      menu.classList.contains('hidden') ? openMenu() : closeMenu();
    });
    document.addEventListener('click', (e) => {
      if (!btn.contains(e.target) && !menu.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });

    function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function renderMenu(projects) {
      if (!projects.length) {
        menu.innerHTML = '<a href="/first-run.html" role="menuitem" class="flex items-center gap-2 px-2.5 py-2 text-[13px] text-accent hover:bg-white/5"><i class="ph ph-plus text-[14px]"></i> Create first project</a>';
        return;
      }
      menu.innerHTML = projects.map((p) => {
        const slug = p.slug || p.id;
        const on = slug === current;
        return `<a href="/${encodeURIComponent(slug)}/index.html" role="menuitem" ${on ? 'aria-current="true"' : ''}
          class="flex items-center justify-between gap-2 px-2.5 py-2 text-[13px] ${on ? 'text-text font-medium bg-accent/12' : 'text-muted hover:bg-white/5 hover:text-text'}">
          <span class="flex items-center gap-2 min-w-0"><span class="w-2 h-2 rounded-sm ${on ? 'bg-accent' : 'bg-border'} shrink-0"></span><span class="truncate">${escHtml(slug)}</span></span>
          ${on ? '<i class="ph-fill ph-check text-accent text-[14px]"></i>' : ''}
        </a>`;
      }).join('');
    }

    if (window.__kanban_api && window.__kanban_api.listProjects) {
      window.__kanban_api.listProjects().then((res) => {
        const projects = (res && res.projects) || [];
        renderMenu(projects);
        // No project prefix in the URL yet: show the first real project name.
        const label = document.getElementById('project-switcher-label');
        if (!current && projects.length && label) label.textContent = projects[0].slug || projects[0].id;
      }).catch(() => {});
    }
  }
})();
