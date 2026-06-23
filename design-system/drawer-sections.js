/* drawer-sections.js — shared Comments + Timeline renderers for both task
 * drawers (board index.html + tasks-list tasks.js).
 *
 * TASK-060: the two drawers each rendered only half of the task-detail payload
 * (board had Timeline, tasks-list had Comments). This module is the single
 * source of truth for BOTH sections so the drawers render identical output and
 * cannot drift again. Loaded via <script src="/drawer-sections.js"> in both
 * pages (after /api.js,/shell.js,/md.js, before the page's own drawer script).
 *
 * Exposes window.__drawerSections = { renderTimeline, renderComments, wireComposer }.
 * Uses the global renderMarkdown (from /md.js) for comment bodies.
 */
(function () {
  'use strict';

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

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
   * when there are no transitions (callers pass res.timeline). */
  function renderTimeline(timeline) {
    timeline = timeline || [];
    if (!timeline.length) return '';
    var html = '<section data-timeline><h3 class="text-[13px] uppercase tracking-wider text-muted mb-3 flex items-center gap-1.5"><i class="ph ph-clock-counter-clockwise text-[14px]"></i> Timeline</h3>';
    html += '<ol class="relative border-l border-border ml-1.5 space-y-4 pl-4">';
    timeline.slice().reverse().forEach(function (tr) { // newest-first; copy so the original array stays untouched
      var dotColor = tr.to_state === 'DONE' ? 'bg-st_done' : tr.to_state === 'JUDGE_PASSED' ? 'bg-st_human' : tr.actor_role === 'judge' ? 'bg-st_self' : 'bg-border';
      html += '<li class="relative"><span class="absolute -left-[22px] top-1 w-3 h-3 rounded-full ' + dotColor + ' ring-4 ring-panel"></span>';
      html += '<p class="text-[13px]"><span class="mono px-1.5 py-0.5 rounded bg-white/5 text-text/70">' + esc(tr.actor_role || '') + '</span> ';
      html += '<span class="mono text-text/70">' + esc(tr.from_state || '') + '</span> &rarr; <span class="mono text-text">' + esc(tr.to_state || '') + '</span></p>';
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

  window.__drawerSections = {
    renderTimeline: renderTimeline,
    renderComments: renderComments,
    wireComposer: wireComposer,
  };
})();
