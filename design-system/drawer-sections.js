/* drawer-sections.js — shared task-detail renderers for both task drawers
 * (board index.html + tasks-list tasks.js) and the full-screen task page
 * (task.html, served at /<project>/t/<KEY>).
 *
 * TASK-060: the two drawers each rendered only half of the task-detail payload
 * (board had Timeline, tasks-list had Comments). This module is the single
 * source of truth for BOTH sections so the drawers render identical output and
 * cannot drift again. Loaded via <script src="/drawer-sections.js"> in every
 * page that shows task detail (after /api.js,/shell.js,/md.js, before the
 * page's own script).
 *
 * TASK-073: the remaining board-drawer sections (Attributes display + inline
 * edit, Spec, Depends on, Repos & MR, Evidence), the state badge labels and the
 * state-gated action buttons moved here too, so the board drawer and task.html
 * call the same functions instead of a third copy.
 *
 * Exposes window.__drawerSections = { renderTimeline, renderComments,
 * wireComposer, taskHref, STATE_LABEL, stateLabel, showActions,
 * renderAttributes, populateEditForm, toggleEditAttributes, saveAttributes,
 * renderSpec, renderDependsOn, renderGitrefs, renderEvidence }.
 * Uses the global renderMarkdown (from /md.js) for spec and comment bodies.
 */
(function () {
  'use strict';

  // Also escapes quotes: several renderers put task data inside attribute
  // values (href, data-*), and the public share view (TASK-076) renders them.
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  // Self-contained relative time so the two drawers render identical strings
  // regardless of each page's own relTime helper ("5m ago").
  function relTime(iso) {
    if (!iso) return '';
    var d = new Date(iso), now = new Date(), s = Math.floor((now - d) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function md(text) {
    return (typeof window.renderMarkdown === 'function') ? window.renderMarkdown(text || '') : esc(text || '');
  }

  /* Timeline section: transition history newest-first. Each row shows the
   * actor role and from_state → to_state plus relative time. Omitted entirely
   * when there are no transitions (callers pass res.timeline).
   *
   * TASK-065: each row now renders an agent/user icon BEFORE the role name
   * (different Phosphor icon per actor_role; 'human' gets ph-user, agents get
   * ph-robot / ph-gavel / ph-shield-check / …) and both from_state and
   * to_state are wrapped in colored chips that mirror the state tokens
   * (st_*) used on the board. */
  var ROLE_ICON = {
    'implementer': 'ph-robot',
    'judge':       'ph-gavel',
    'self-check':  'ph-shield-check',
    'runner':      'ph-play-circle',
    'pr-bot':      'ph-git-pull-request',
    'human':       'ph-user',
  };
  var FALLBACK_ROLE_ICON = 'ph-question';

  /* state → Tailwind classes mirroring the st_* tokens on the board.
   * Background uses a low-alpha tint of the state color; text uses the state
   * color itself. Matches STATE_META.cls in design-system/index.html. */
  var STATE_CHIP = {
    'TODO':                'bg-st_todo/15 text-st_todo',
    'IN_PROGRESS':         'bg-st_prog/15 text-st_prog',
    'IMPLEMENTED':         'bg-st_impl/15 text-st_impl',
    'EVIDENCE':            'bg-st_self/15 text-st_self',
    'SELF_CHECK_PASSED':   'bg-st_self/15 text-st_self',
    'SELF_CHECK_FAILED':   'bg-st_selffail/15 text-st_selffail',
    'JUDGE_REJECTED':      'bg-st_reject/15 text-st_reject',
    'JUDGE_PASSED':        'bg-st_human/15 text-st_human',
    'READY_TO_REVIEW':     'bg-st_human/15 text-st_human',
    'DONE':                'bg-st_done/15 text-st_done',
  };
  var DEFAULT_CHIP = 'bg-white/10 text-text/70';

  function stateChipCls(st) {
    return STATE_CHIP[st] || DEFAULT_CHIP;
  }

  function roleIcon(role) {
    return ROLE_ICON[role] || FALLBACK_ROLE_ICON;
  }

  function renderTimeline(timeline) {
    timeline = timeline || [];
    if (!timeline.length) return '';
    var html = '<section data-timeline><h3 class="text-[13px] uppercase tracking-wider text-muted mb-3 flex items-center gap-1.5"><i class="ph ph-clock-counter-clockwise text-[14px]"></i> Timeline</h3>';
    html += '<ol class="relative border-l border-border ml-1.5 space-y-4 pl-4">';
    timeline.slice().reverse().forEach(function (tr) { // newest-first; copy so the original array stays untouched
      var dotColor = tr.to_state === 'DONE' ? 'bg-st_done' : tr.to_state === 'JUDGE_PASSED' ? 'bg-st_human' : tr.actor_role === 'judge' ? 'bg-st_self' : 'bg-border';
      html += '<li class="relative"><span class="absolute -left-[22px] top-1 w-3 h-3 rounded-full ' + dotColor + ' ring-4 ring-panel"></span>';
      html += '<p class="text-[13px] flex items-center gap-1.5 flex-wrap">';
      html += '<i class="ph ' + esc(roleIcon(tr.actor_role)) + ' text-[14px] text-text/60" data-agent-icon></i>';
      html += '<span class="mono px-1.5 py-0.5 rounded bg-white/5 text-text/70">' + esc(tr.actor_role || '') + '</span> ';
      html += '<span class="mono text-[12px] px-1.5 py-0.5 rounded ' + stateChipCls(tr.from_state) + '" data-state-chip>' + esc(tr.from_state || '') + '</span>';
      html += '<span class="text-text/50">&rarr;</span>';
      html += '<span class="mono text-[12px] px-1.5 py-0.5 rounded ' + stateChipCls(tr.to_state) + '" data-state-chip>' + esc(tr.to_state || '') + '</span>';
      html += '</p>';
      if (tr.note) html += '<p class="mt-0.5 text-[13px] text-text/80">' + esc(tr.note) + '</p>';
      html += '<p class="mt-0.5 mono text-[13px] text-muted">' + esc(relTime(tr.at)) + '</p>';
      html += '</li>';
    });
    html += '</ol></section>';
    return html;
  }

  /* Comments section: list each comment (author role, kind, verdict badge,
   * markdown body, relative time) plus a composer. Empty list shows an
   * explicit "no comments" state. TASK-062: render newest-first by sorting
   * a copy on created_at descending — the caller's array is never mutated.
   * Missing/invalid created_at sorts to the bottom; equal timestamps keep
   * their original order (stable sort). */
  function renderComments(comments) {
    comments = comments || [];
    var ordered = comments.slice().sort(function (a, b) {
      var ta = a && a.created_at ? new Date(a.created_at).getTime() : 0;
      var tb = b && b.created_at ? new Date(b.created_at).getTime() : 0;
      if (ta !== ta) ta = 0; // NaN guard
      if (tb !== tb) tb = 0;
      return tb - ta; // descending: newest first
    });
    var html = '<section data-comments><h3 class="text-[13px] uppercase tracking-wider text-muted mb-2 flex items-center gap-1.5"><i class="ph ph-chat-circle-text text-[14px]"></i> Comments</h3>';
    if (!ordered.length) {
      html += '<p data-comments-empty class="text-[13px] text-muted mb-3">No comments yet.</p>';
    } else {
      html += '<ul data-comments-list class="space-y-2 mb-3">';
      ordered.forEach(function (c) {
        html += '<li class="rounded-lg border border-border bg-panel2 p-2.5">';
        html += '<div class="flex items-center gap-2 mb-1">';
        html += '<span class="mono text-[13px] px-1.5 py-0.5 rounded bg-white/5 text-text/70">' + esc(c.author_role || '') + '</span>';
        html += '<span class="mono text-[12px] text-muted">' + esc(c.kind || '') + '</span>';
        if (c.kind === 'verdict' && c.verdict) {
          var vcls = c.verdict === 'PASS' ? 'bg-ev_pass/15 text-ev_pass' : 'bg-ev_fail/15 text-ev_fail';
          html += '<span class="mono text-[12px] px-1.5 py-0.5 rounded ' + vcls + '">' + esc(c.verdict) + '</span>';
        }
        html += '<span class="ml-auto mono text-[12px] text-muted">' + esc(relTime(c.created_at)) + '</span>';
        html += '</div>';
        html += '<div class="text-[13px]">' + md(c.body_md || '') + '</div>';
        html += '</li>';
      });
      html += '</ul>';
    }
    // Composer: textarea + submit. Submit is disabled until there is text.
    html += '<div class="space-y-2">';
    html += '<textarea id="comment-input" rows="3" placeholder="Add a comment…" aria-label="Add a comment" class="w-full rounded-lg border border-border bg-panel2 px-2.5 py-2 text-[13px] outline-none focus:border-accent"></textarea>';
    html += '<p id="comment-error" class="hidden text-[13px] text-ev_fail"></p>';
    html += '<button id="comment-submit" type="button" disabled class="rounded-lg border border-border bg-panel2 px-3 py-1.5 text-[13px] text-accent disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/5">Comment</button>';
    html += '</div></section>';
    return html;
  }

  /* Wire the composer for (project, key). onPosted() is called after a
   * successful post so the page can refresh the open drawer (each drawer owns
   * its own refresh path). */
  function wireComposer(api, project, key, onPosted) {
    var input = document.getElementById('comment-input');
    var submit = document.getElementById('comment-submit');
    var errEl = document.getElementById('comment-error');
    if (!input || !submit) return;
    input.addEventListener('input', function () {
      submit.disabled = input.value.trim().length === 0;
    });
    submit.addEventListener('click', function () {
      var text = input.value.trim();
      if (!text) return; // empty input cannot be submitted
      submit.disabled = true;
      errEl.classList.add('hidden');
      api.addComment(project, key, text).then(function (resp) {
        if (resp && (resp.status === 200 || resp.status === 201)) {
          if (typeof onPosted === 'function') onPosted(); // refresh so the new comment appears
          return;
        }
        var msg = resp && resp.body && resp.body.error ? resp.body.error : 'Failed to add comment';
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
        submit.disabled = false;
      }).catch(function (err) {
        errEl.textContent = 'Failed to add comment: ' + String(err);
        errEl.classList.remove('hidden');
        submit.disabled = false;
      });
    });
  }

  /* ---- TASK-069: drawer fullscreen toggle -------------------------------
   * The drawer is `w-full sm:w-2/3` by default. The [data-drawer-fullscreen]
   * header button toggles `.drawer-fullscreen` on #drawer (width:100%, see
   * theme.css) and persists the choice in localStorage, so the mode survives
   * closing/reopening the drawer AND a page reload, identically on the board
   * and the task-list page (both load this module).
   *
   * Self-wired via a delegated click listener: neither page needs an onclick.
   */
  var FULLSCREEN_KEY = 'kanban_drawer_fullscreen';

  // localStorage can throw (Safari private mode, blocked third-party storage);
  // the toggle must keep working in-session even when persistence is denied.
  function readFullscreen() {
    try { return localStorage.getItem(FULLSCREEN_KEY) === '1'; } catch (e) { return false; }
  }
  function writeFullscreen(on) {
    try { localStorage.setItem(FULLSCREEN_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  function applyFullscreen(on) {
    var drawer = document.getElementById('drawer');
    if (drawer) drawer.classList.toggle('drawer-fullscreen', on);
    var btns = document.querySelectorAll('[data-drawer-fullscreen]');
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', on ? 'Exit drawer fullscreen' : 'Expand drawer to fullscreen');
      var icon = btn.querySelector('i');
      if (icon) {
        icon.classList.toggle('ph-arrows-in', on);
        icon.classList.toggle('ph-arrows-out', !on);
      }
    }
  }

  function initFullscreen() {
    applyFullscreen(readFullscreen()); // restore the stored mode on page load
  }

  document.addEventListener('click', function (ev) {
    var target = ev.target;
    if (!target || typeof target.closest !== 'function') return;
    if (!target.closest('[data-drawer-fullscreen]')) return;
    // Current mode comes from the DOM, not storage, so the toggle still flips
    // both ways when localStorage writes are denied.
    var drawer = document.getElementById('drawer');
    var on = !(drawer && drawer.classList.contains('drawer-fullscreen'));
    writeFullscreen(on);
    applyFullscreen(on);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFullscreen);
  } else {
    initFullscreen();
  }

  /* ---- TASK-073: shared task-detail sections -----------------------------
   * Moved verbatim from the board drawer (index.html) so the drawer's HTML
   * output is unchanged; the only difference is that Depends-on chips are now
   * real links to the full-screen task page instead of drawer-reopen buttons.
   */

  // Returns the URL only if it is an http(s) URL; otherwise '' so callers can
  // neutralize the href (defense against javascript:/data: stored XSS).
  function safeHttpHref(u) { try { return /^https?:$/.test(new URL(u).protocol) ? u : ''; } catch (e) { return ''; } }

  /* Root-relative URL of the full-screen task page: /<project>/t/<KEY>, each
   * segment URL-encoded. Used by every task-key surface (board card, tasks
   * row, drawer header, depends-on chip). */
  function taskHref(project, key) {
    return '/' + encodeURIComponent(project) + '/t/' + encodeURIComponent(key);
  }

  var STATE_LABEL = {
    'TODO': { text: 'TODO', icon: 'ph-circle', cls: 'bg-white/5 text-st_todo' },
    'IN_PROGRESS': { text: 'IN_PROGRESS', icon: 'ph-circle-notch', cls: 'bg-st_prog/12 text-st_prog', fill: true },
    'IMPLEMENTED': { text: 'IMPLEMENTED', icon: 'ph-check-circle', cls: 'bg-st_impl/12 text-st_impl', fill: true },
    'EVIDENCE': { text: 'EVIDENCE', icon: 'ph-seal-check', cls: 'bg-st_self/12 text-st_self', fill: true },
    'SELF_CHECK_PASSED': { text: 'SELF_CHECK_PASSED', icon: 'ph-shield-check', cls: 'bg-st_self/12 text-st_self', fill: true },
    'SELF_CHECK_FAILED': { text: 'SELF_CHECK_FAILED', icon: 'ph-warning', cls: 'bg-st_selffail/12 text-st_selffail', fill: true },
    'JUDGE_REJECTED': { text: 'JUDGE_REJECTED', icon: 'ph-x-circle', cls: 'bg-st_reject/12 text-st_reject', fill: true },
    'JUDGE_PASSED': { text: 'JUDGE_PASSED', icon: 'ph-gavel', cls: 'bg-st_human/15 text-st_human', fill: true },
    'READY_TO_REVIEW': { text: 'READY_TO_REVIEW', icon: 'ph-git-pull-request', cls: 'bg-st_human/15 text-st_human', fill: true },
    'DONE': { text: 'DONE', icon: 'ph-check-fat', cls: 'bg-st_done/12 text-st_done', fill: true },
  };

  function stateLabel(state) {
    return STATE_LABEL[state] || { text: state, icon: 'ph-circle', cls: 'bg-white/5 text-muted' };
  }

  /* Show the human-action buttons (#btn-approve/#btn-reject/#btn-reset/
   * #btn-remove) allowed for `state`. A DONE task is terminal and shows NO
   * actions at all (no approve/reset/remove). Share (#menu-share, the
   * three-dots menu) is read-only and allowed in every state. */
  function showActions(state) {
    var review = state === 'JUDGE_PASSED' || state === 'READY_TO_REVIEW';
    var reset = state === 'JUDGE_REJECTED' || state === 'SELF_CHECK_FAILED';
    var rules = { 'btn-approve': review, 'btn-reject': review, 'btn-reset': reset, 'btn-remove': state !== 'DONE', 'menu-share': true };
    Object.keys(rules).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', !rules[id]);
    });
  }

  // --- Task attribute display/edit helpers ---
  var PRIO_COLORS = { P0: 'bg-ev_fail/15 text-ev_fail', P1: 'bg-orange-500/15 text-orange-800 dark:text-orange-400', P2: 'bg-yellow-500/15 text-yellow-800 dark:text-yellow-400', P3: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' };

  function renderAttributesDisplay(t) {
    var tags = Array.isArray(t.tags) ? t.tags : [];
    var rows = '';
    rows += '<div class="flex items-center gap-2 py-1"><span class="text-[13px] text-muted w-24 shrink-0">Priority</span>' + (t.priority ? '<span role="img" aria-label="Priority ' + esc(t.priority) + '" class="mono text-[12px] px-1.5 py-0.5 rounded ' + (PRIO_COLORS[t.priority] || 'bg-white/5 text-muted') + '">' + esc(t.priority) + '</span>' : '<span class="text-[13px] text-muted">—</span>') + '</div>';
    rows += '<div class="flex items-center gap-2 py-1"><span class="text-[13px] text-muted w-24 shrink-0">Complexity</span><span class="text-[13px]">' + esc(t.complexity || '—') + '</span></div>';
    rows += '<div class="flex items-center gap-2 py-1"><span class="text-[13px] text-muted w-24 shrink-0">Estimate</span><span class="text-[13px]">' + (t.estimate_hours != null ? esc(String(t.estimate_hours)) + 'h' : '—') + '</span></div>';
    rows += '<div class="flex items-center gap-2 py-1 flex-wrap"><span class="text-[13px] text-muted w-24 shrink-0">Tags</span>';
    if (tags.length > 0) { tags.forEach(function (tag) { rows += '<span class="mono text-[11px] px-1.5 py-0.5 rounded bg-white/5 text-muted">' + esc(tag) + '</span>'; }); }
    else { rows += '<span class="text-[13px] text-muted">—</span>'; }
    rows += '</div>';
    rows += '<div class="flex items-center gap-2 py-1"><span class="text-[13px] text-muted w-24 shrink-0">Link Doc</span>';
    if (t.link_document) {
      var safeDoc = safeHttpHref(t.link_document);
      if (safeDoc) { rows += '<a href="' + esc(safeDoc) + '" target="_blank" rel="noopener noreferrer" class="text-[13px] text-accent hover:underline truncate max-w-[250px]">' + esc(t.link_document) + '</a>'; }
      else { rows += '<span class="text-[13px] text-muted truncate max-w-[250px]">' + esc(t.link_document) + '</span>'; }
    }
    else { rows += '<span class="text-[13px] text-muted">—</span>'; }
    rows += '</div>';
    // PR link (TASK-051): recorded by the pr-bot via PATCH; UI only displays.
    if (t.pr_url) {
      rows += '<div class="flex items-center gap-2 py-1"><span class="text-[13px] text-muted w-24 shrink-0">PR</span>';
      var safePr = safeHttpHref(t.pr_url);
      if (safePr) { rows += '<a href="' + esc(safePr) + '" target="_blank" rel="noopener noreferrer" class="text-[13px] text-accent hover:underline truncate max-w-[250px]"><i class="ph ph-git-pull-request text-[13px]"></i> Open PR</a>'; }
      else { rows += '<span class="text-[13px] text-muted truncate max-w-[250px]">' + esc(t.pr_url) + '</span>'; }
      rows += '</div>';
    }
    return '<div id="attrs-display" class="rounded-lg border border-border bg-panel2 divide-y divide-border px-3 mb-2">' + rows + '</div>';
  }

  function renderAttributesEdit(t) {
    var tags = Array.isArray(t.tags) ? t.tags : [];
    var h = '<div id="attrs-edit" class="hidden rounded-lg border border-accent/30 bg-panel2 p-3 space-y-2 mb-2">';
    h += '<div class="grid grid-cols-2 gap-2">';
    h += '<div><label class="text-[12px] text-muted block mb-1">Priority</label><select id="edit-priority" class="w-full rounded-md border border-border bg-panel px-2 h-8 text-[13px] outline-none"><option value="">—</option><option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option></select></div>';
    h += '<div><label class="text-[12px] text-muted block mb-1">Complexity</label><select id="edit-complexity" class="w-full rounded-md border border-border bg-panel px-2 h-8 text-[13px] outline-none"><option value="">—</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="5">5</option><option value="8">8</option><option value="13">13</option><option value="21">21</option></select></div>';
    h += '</div>';
    h += '<div><label class="text-[12px] text-muted block mb-1">Estimate (hours)</label><input id="edit-estimate_hours" type="number" min="0" step="0.5" class="w-full rounded-md border border-border bg-panel px-2 h-8 text-[13px] outline-none" /></div>';
    h += '<div><label class="text-[12px] text-muted block mb-1">Tags (comma-separated)</label><input id="edit-tags" type="text" class="w-full rounded-md border border-border bg-panel px-2 h-8 text-[13px] outline-none" /></div>';
    h += '<div><label class="text-[12px] text-muted block mb-1">Link Document (URL)</label><input id="edit-link_document" type="url" class="w-full rounded-md border border-border bg-panel px-2 h-8 text-[13px] outline-none" /></div>';
    h += '<div class="flex items-center gap-2 pt-1"><button onclick="window.__saveAttributes()" class="rounded-md bg-accent px-3 h-8 text-[13px] font-medium text-white hover:bg-accent/90">Save</button><button onclick="window.__toggleEditAttributes()" class="rounded-md border border-border px-3 h-8 text-[13px] text-muted hover:text-text">Cancel</button><span id="edit-attrs-msg" class="text-[12px] text-muted"></span></div>';
    h += '</div>';
    // Store initial values in data attributes so they can be applied after innerHTML insertion
    // (inline <script> tags don't execute when set via innerHTML)
    h += '<div id="attrs-edit-data" style="display:none" data-priority="' + esc(t.priority || '') + '" data-complexity="' + esc(t.complexity || '') + '" data-estimate="' + (t.estimate_hours != null ? t.estimate_hours : '') + '" data-tags="' + esc(tags.join(', ')) + '" data-link="' + esc(t.link_document || '') + '"></div>';
    return h;
  }

  /* Attributes section (display + hidden inline edit form). The inline
   * onclick handlers call window.__toggleEditAttributes / __saveAttributes,
   * which each page binds (see toggleEditAttributes / saveAttributes). */
  function renderAttributes(t) {
    var html = '<section id="drawer-attributes"><h3 class="text-[13px] uppercase tracking-wider text-muted mb-2 flex items-center gap-1.5"><i class="ph ph-sliders text-[14px]"></i> Attributes <button onclick="window.__toggleEditAttributes()" id="btn-edit-attrs" class="ml-auto text-[12px] normal-case tracking-normal text-accent hover:underline">Edit</button></h3>';
    html += renderAttributesDisplay(t);
    html += renderAttributesEdit(t);
    html += '</section>';
    return html;
  }

  // Populate edit form values (inline <script> tags don't execute via innerHTML)
  function populateEditForm() {
    var data = document.getElementById('attrs-edit-data');
    if (!data) return;
    var ep = document.getElementById('edit-priority');
    var ec = document.getElementById('edit-complexity');
    var ee = document.getElementById('edit-estimate_hours');
    var et = document.getElementById('edit-tags');
    var el = document.getElementById('edit-link_document');
    if (ep) ep.value = data.dataset.priority || '';
    if (ec) ec.value = data.dataset.complexity || '';
    if (ee) ee.value = data.dataset.estimate || '';
    if (et) et.value = data.dataset.tags || '';
    if (el) el.value = data.dataset.link || '';
  }

  function toggleEditAttributes() {
    var display = document.getElementById('attrs-display');
    var edit = document.getElementById('attrs-edit');
    var btn = document.getElementById('btn-edit-attrs');
    if (!edit) return;
    var hidden = edit.classList.contains('hidden');
    if (hidden) { edit.classList.remove('hidden'); if (display) display.classList.add('hidden'); if (btn) btn.textContent = 'Cancel'; }
    else { edit.classList.add('hidden'); if (display) display.classList.remove('hidden'); if (btn) btn.textContent = 'Edit'; }
  }

  /* PATCH the edited attributes of (project, key) via api.updateTask; on
   * success shows "Saved!" and calls onSaved() 600ms later so the page can
   * refetch/re-render the task. */
  function saveAttributes(api, project, key, onSaved) {
    var msg = document.getElementById('edit-attrs-msg');
    var patch = {};
    var p = document.getElementById('edit-priority').value;
    if (p) patch.priority = p;
    var c = document.getElementById('edit-complexity').value;
    if (c) patch.complexity = c;
    var e = document.getElementById('edit-estimate_hours').value;
    if (e) patch.estimate_hours = parseFloat(e);
    var t = document.getElementById('edit-tags').value.trim();
    if (t) patch.tags = t.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var l = document.getElementById('edit-link_document').value.trim();
    if (l) patch.link_document = l;
    if (Object.keys(patch).length === 0) { if (msg) { msg.textContent = 'Nothing to save.'; msg.className = 'text-[12px] text-muted'; } return; }
    api.updateTask(project, key, patch).then(function (res) {
      if (res && res.task) {
        if (msg) { msg.textContent = 'Saved!'; msg.className = 'text-[12px] text-ev_pass'; }
        setTimeout(function () { if (typeof onSaved === 'function') onSaved(); }, 600);
      } else {
        if (msg) { msg.textContent = 'Save failed.'; msg.className = 'text-[12px] text-ev_fail'; }
      }
    }).catch(function (err) {
      if (msg) { msg.textContent = 'Error: ' + err.message; msg.className = 'text-[12px] text-ev_fail'; }
    });
  }

  // Spec section
  function renderSpec(t) {
    var html = '<section><h3 class="text-[13px] uppercase tracking-wider text-muted mb-2 flex items-center gap-1.5"><i class="ph ph-file-text text-[14px]"></i> Spec</h3>';
    html += '<div class="text-[13px]">' + md(t.body_md || '(no spec)') + '</div></section>';
    return html;
  }

  /* Depends on section (only when the task declares dependencies). Each chip
   * is a real link to the upstream task's full-screen page (TASK-073). */
  function renderDependsOn(project, deps) {
    if (!deps || deps.length === 0) return '';
    var html = '<section><h3 class="text-[13px] uppercase tracking-wider text-muted mb-2 flex items-center gap-1.5"><i class="ph ph-link text-[14px]"></i> Depends on</h3><div class="flex flex-wrap gap-1.5">';
    deps.forEach(function (dep) {
      html += '<a href="' + esc(taskHref(project, dep)) + '" class="mono text-[13px] rounded border border-border bg-panel2 px-1.5 py-0.5 text-accent hover:underline">' + esc(dep) + '</a>';
    });
    html += '</div></section>';
    return html;
  }

  // Gitrefs (with PR link from mr_url)
  function renderGitrefs(gitrefs) {
    if (!gitrefs || gitrefs.length === 0) return '';
    var html = '<section><h3 class="text-[13px] uppercase tracking-wider text-muted mb-2 flex items-center gap-1.5"><i class="ph ph-git-branch text-[14px]"></i> Repos &amp; MR</h3><div class="space-y-2">';
    gitrefs.forEach(function (g) {
      html += '<div class="rounded-lg border border-border bg-panel2 p-2.5"><span class="mono text-[13px] font-medium">' + esc(g.repo || '') + '</span>';
      if (g.branch) html += '<div class="mt-1 mono text-[13px] text-muted">' + esc(g.branch) + '</div>';
      if (g.head_sha) html += '<div class="mt-0.5 mono text-[13px] text-muted">' + esc(g.head_sha.substring(0, 7)) + '</div>';
      if (g.mr_url) { var safeMr = safeHttpHref(g.mr_url); if (safeMr) html += '<div class="mt-1"><a href="' + esc(safeMr) + '" target="_blank" rel="noopener noreferrer" class="text-[13px] text-accent hover:underline flex items-center gap-1"><i class="ph ph-link text-[13px]"></i> PR/MR link</a></div>'; else html += '<div class="mt-1 text-[13px] text-muted flex items-center gap-1"><i class="ph ph-link text-[13px]"></i> ' + esc(g.mr_url) + '</div>'; }
      html += '</div>';
    });
    html += '</div></section>';
    return html;
  }

  /* Evidence (build/test exits) + "View full evidence" link. The caller
   * passes the link href: the board keeps its page-relative
   * 'evidence.html#<KEY>', task.html (two levels deep) passes the absolute
   * '/<project>/evidence.html#<KEY>'. */
  function renderEvidence(ev, evidenceHref) {
    if (!ev) return '';
    var html = '<section><h3 class="text-[13px] uppercase tracking-wider text-muted mb-2 flex items-center gap-1.5"><i class="ph ph-seal-check text-[14px]"></i> Evidence</h3>';
    html += '<div class="rounded-lg border border-border bg-panel2 divide-y divide-border">';
    if (ev.build_exit !== undefined) html += '<div class="flex items-center justify-between px-3 py-2"><span class="flex items-center gap-1.5 text-[13px] text-muted"><i class="ph-fill ph-hammer text-[14px]"></i> build</span><span class="mono text-[13px] ' + (ev.build_exit === 0 ? 'text-ev_pass' : 'text-ev_fail') + '">exit ' + ev.build_exit + '</span></div>';
    if (ev.test_exit !== undefined) html += '<div class="flex items-center justify-between px-3 py-2"><span class="flex items-center gap-1.5 text-[13px] text-muted"><i class="ph-fill ph-test-tube text-[14px]"></i> test</span><span class="mono text-[13px] ' + (ev.test_exit === 0 ? 'text-ev_pass' : 'text-ev_fail') + '">exit ' + ev.test_exit + '</span></div>';
    html += '</div>';
    html += '<a href="' + esc(evidenceHref) + '" class="mt-2 flex items-center gap-1.5 text-[13px] text-accent hover:underline"><i class="ph ph-caret-right text-[13px]"></i> View full evidence</a>';
    html += '</section>';
    return html;
  }

  window.__drawerSections = {
    renderTimeline: renderTimeline,
    renderComments: renderComments,
    wireComposer: wireComposer,
    taskHref: taskHref,
    STATE_LABEL: STATE_LABEL,
    stateLabel: stateLabel,
    showActions: showActions,
    renderAttributes: renderAttributes,
    populateEditForm: populateEditForm,
    toggleEditAttributes: toggleEditAttributes,
    saveAttributes: saveAttributes,
    renderSpec: renderSpec,
    renderDependsOn: renderDependsOn,
    renderGitrefs: renderGitrefs,
    renderEvidence: renderEvidence,
  };
})();
