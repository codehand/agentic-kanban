/* Agentic Kanban - shared app shell. Injects the left rail (consistent everywhere)
 * and a floating prototype screen-switcher. Each page sets:
 *   <body data-active="board|projects|tokens" data-project="opf-hub" data-awaiting="2">
 * and provides <aside id="rail"></aside> as the mount point.  */
(function () {
  const body = document.body;
  const active = body.dataset.active || '';
  const project = body.dataset.project || 'opf-hub';
  const awaiting = body.dataset.awaiting ?? '2';

  const nav = (key, href, icon, label) => {
    const on = key === active;
    return `<a href="${href}" class="flex items-center gap-2.5 rounded-md px-2.5 py-2 ${
      on ? 'bg-accent/12 text-text font-medium' : 'text-muted hover:bg-white/5 hover:text-text'
    }"><i class="ph${on ? '-fill' : ''} ph-${icon} text-[16px] ${on ? 'text-accent' : ''}"></i> ${label}</a>`;
  };

  const rail = document.getElementById('rail');
  if (rail) {
    rail.className = 'hidden lg:flex w-[244px] shrink-0 flex-col border-r border-border bg-panel';
    rail.innerHTML = `
      <div class="flex items-center gap-2.5 px-4 h-14 border-b border-border">
        <span class="grid place-items-center w-7 h-7 rounded-md bg-accent/15 text-accent"><i class="ph-fill ph-kanban text-[17px]"></i></span>
        <div class="leading-tight">
          <div class="text-[13px] font-semibold tracking-tight">Agentic Kanban</div>
          <div class="text-[10px] text-muted mono">mission control</div>
        </div>
      </div>

      <div class="px-3 pt-3">
        <button class="w-full flex items-center justify-between gap-2 rounded-md border border-border bg-panel2 px-2.5 py-2 text-left hover:border-borderlt">
          <span class="flex items-center gap-2 min-w-0">
            <span class="w-2 h-2 rounded-sm bg-accent shrink-0"></span>
            <span class="text-[12.5px] font-medium truncate">${project}</span>
          </span>
          <i class="ph ph-caret-up-down text-muted text-[14px]"></i>
        </button>
      </div>

      <nav class="px-2 pt-3 space-y-0.5 text-[13px]">
        ${nav('board', 'index.html', 'squares-four', 'Board')}
        ${nav('tasks', 'index.html', 'list-checks', 'Tasks')}
        ${nav('projects', 'projects.html', 'folders', 'Projects')}
        ${nav('tokens', 'tokens.html', 'key', 'Tokens')}
      </nav>

      <div class="px-3 mt-4">
        <a href="index.html#col-human" class="block w-full rounded-lg border border-st_human/40 bg-st_human/10 glow-human-soft px-3 py-2.5 text-left hover:bg-st_human/15">
          <div class="flex items-center justify-between">
            <span class="flex items-center gap-2 text-[12px] font-medium text-st_human"><i class="ph-fill ph-hand-tap text-[15px]"></i> Awaiting You</span>
            <span class="mono text-[13px] font-semibold text-st_human">${awaiting}</span>
          </div>
          <p class="mt-1 text-[10.5px] text-muted leading-snug">Tasks the gate cleared and only you can mark Done.</p>
        </a>
      </div>

      <div class="mt-auto px-3 pb-3">
        <div class="rounded-md border border-border bg-panel2 px-2.5 py-2 text-[11px]">
          <div class="flex items-center justify-between">
            <span class="flex items-center gap-1.5 text-muted"><span class="w-1.5 h-1.5 rounded-full bg-ev_pass heartbeat"></span> Connected</span>
            <span class="mono text-muted">SSE</span>
          </div>
          <div class="mt-1.5 flex items-center justify-between text-muted">
            <span class="flex items-center gap-1.5"><i class="ph ph-user-circle text-[14px]"></i> operator</span>
            <span class="mono text-[10px] px-1.5 py-0.5 rounded bg-white/5">human</span>
          </div>
        </div>
      </div>`;
  }

  // ---- prototype screen-switcher (floating, bottom-right) ----
  const screens = [
    ['index.html', 'squares-four', 'S1 Board + S2 Detail'],
    ['projects.html', 'folders', 'S3 Projects Overview'],
    ['new-task.html', 'plus-circle', 'S4 Create Task'],
    ['evidence.html', 'seal-check', 'S6 Evidence Detail'],
    ['tokens.html', 'key', 'S7 Token Management'],
    ['signin.html', 'sign-in', 'S5 Token Gate'],
    ['first-run.html', 'sparkle', 'S8 First-run / States'],
  ];
  const here = location.pathname.split('/').pop() || 'index.html';
  const sw = document.createElement('div');
  sw.className = 'fixed bottom-4 right-4 z-[80]';
  sw.innerHTML = `
    <div id="sw-panel" class="hidden mb-2 w-60 rounded-xl border border-border bg-panel p-1.5 shadow-2xl">
      <p class="px-2 pt-1 pb-1.5 text-[10px] uppercase tracking-wider text-muted">Prototype screens</p>
      ${screens.map(([href, icon, label]) => {
        const on = href === here;
        return `<a href="${href}" class="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] ${
          on ? 'bg-accent/12 text-text' : 'text-muted hover:bg-white/5 hover:text-text'
        }"><i class="ph ph-${icon} text-[14px] ${on ? 'text-accent' : ''}"></i> ${label}</a>`;
      }).join('')}
    </div>
    <button id="sw-btn" class="ml-auto flex items-center gap-1.5 rounded-full border border-border bg-panel2 pl-3 pr-3.5 h-10 text-[12px] text-text shadow-xl hover:border-borderlt">
      <i class="ph ph-stack text-[15px] text-accent"></i> Screens
    </button>`;
  body.appendChild(sw);
  const panel = sw.querySelector('#sw-panel');
  sw.querySelector('#sw-btn').addEventListener('click', () => panel.classList.toggle('hidden'));
  document.addEventListener('click', (e) => { if (!sw.contains(e.target)) panel.classList.add('hidden'); });
})();
