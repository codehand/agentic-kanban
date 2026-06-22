/**
 * api.js — Live data wiring for design-system/ UI.
 *
 * Replaces mock data with fetch calls to /api/* endpoints.
 * Connects to /api/stream via EventSource for real-time updates.
 * Token is stored in localStorage (set via S5 sign-in screen).
 */
(function () {
  'use strict';

  // --- Token management (S5 sign-in gate) ---
  function getToken() {
    return localStorage.getItem('kanban_token') || '';
  }
  window.__kanban_setToken = function (token) {
    localStorage.setItem('kanban_token', token);
  };
  window.__kanban_clearToken = function () {
    localStorage.removeItem('kanban_token');
  };

  function authHeaders() {
    const token = getToken();
    if (!token) return {};
    return { 'Authorization': 'Bearer ' + token };
  }

  // --- Fetch helpers ---
  async function apiFetch(path, opts) {
    const token = getToken();
    if (!token) {
      // Redirect to sign-in if no token
      if (location.pathname.indexOf('signin.html') === -1) {
        location.href = 'signin.html';
      }
      return null;
    }
    try {
      const res = await fetch('/api' + path, Object.assign({
        headers: authHeaders(),
      }, opts || {}));
      if (res.status === 401) {
        window.__kanban_clearToken();
        location.href = 'signin.html';
        return null;
      }
      return res;
    } catch (err) {
      console.error('[api] fetch error', path, err);
      return null;
    }
  }

  // Per-pageload cache of the projects promise so every consumer (rail
  // switcher, board, dropdowns, redirects) shares ONE GET /api/projects.
  var projectsPromise = null;

  // --- Public API ---
  window.__kanban_api = {
    listProjects: function () {
      if (!projectsPromise) {
        projectsPromise = apiFetch('/projects')
          .then(function (r) { return r ? r.json() : null; })
          .then(function (res) {
            if (!res) projectsPromise = null; // don't cache failures/auth redirects
            return res;
          }, function (err) {
            projectsPromise = null;
            throw err;
          });
      }
      return projectsPromise;
    },

    createProject: function (payload) {
      return apiFetch('/projects', {
        method: 'POST',
        headers: Object.assign(authHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      }).then(function (r) {
        projectsPromise = null; // project list changed — drop the cache
        return r ? r.json() : null;
      });
    },

    listTasks: function (project, state) {
      var qs = '?project=' + encodeURIComponent(project);
      if (state) qs += '&state=' + encodeURIComponent(state);
      return apiFetch('/tasks' + qs).then(function (r) { return r ? r.json() : null; });
    },

    getTask: function (project, key) {
      var qs = '?project=' + encodeURIComponent(project);
      return apiFetch('/tasks/' + encodeURIComponent(key) + qs).then(function (r) { return r ? r.json() : null; });
    },

    getEvidence: function (project, key) {
      var qs = '?project=' + encodeURIComponent(project);
      return apiFetch('/evidence/' + encodeURIComponent(key) + qs).then(function (r) { return r ? r.json() : null; });
    },

    listTokens: function () {
      return apiFetch('/tokens').then(function (r) { return r ? r.json() : null; });
    },

    mintToken: function (opts) {
      opts = opts || {};
      return apiFetch('/tokens', {
        method: 'POST',
        headers: Object.assign(authHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          role: opts.role || '',
          label: opts.label || '',
          project: opts.project || null,
        }),
      }).then(function (r) { return r ? r.json() : null; });
    },

    // DELETE /api/tokens/:id — resolves {status, body} so callers can surface
    // 409s ("already revoked" / "last active human token") visibly.
    revokeToken: function (id) {
      return apiFetch('/tokens/' + encodeURIComponent(id), {
        method: 'DELETE',
      }).then(function (r) {
        if (!r) return null;
        return r.json().then(
          function (body) { return { status: r.status, body: body }; },
          function () { return { status: r.status, body: null }; }
        );
      });
    },

    approveTask: function (project, key, note) {
      var qs = '?project=' + encodeURIComponent(project);
      return apiFetch('/tasks/' + encodeURIComponent(key) + '/approve' + qs, {
        method: 'POST',
        headers: Object.assign(authHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ note: note || '' }),
      }).then(function (r) { return r ? r.json() : null; });
    },

    resetTask: function (project, key) {
      var qs = '?project=' + encodeURIComponent(project);
      return apiFetch('/tasks/' + encodeURIComponent(key) + '/reset' + qs, {
        method: 'POST',
        headers: authHeaders(),
      }).then(function (r) { return r ? r.json() : null; });
    },

    removeTask: function (project, key) {
      var qs = '?project=' + encodeURIComponent(project);
      return apiFetch('/tasks/' + encodeURIComponent(key) + '/remove' + qs, {
        method: 'POST',
        headers: authHeaders(),
      }).then(function (r) { return r ? r.json() : null; });
    },

    createTask: function (payload) {
      return apiFetch('/tasks', {
        method: 'POST',
        headers: Object.assign(authHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      }).then(function (r) { return r ? r.json() : null; });
    },

    updateTask: function (project, key, patch) {
      var qs = '?project=' + encodeURIComponent(project);
      return apiFetch('/tasks/' + encodeURIComponent(key) + qs, {
        method: 'PATCH',
        headers: Object.assign(authHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify(patch),
      }).then(function (r) { return r ? r.json() : null; });
    },

    // POST /api/tasks/:key/comments — add a review comment. Resolves
    // {status, body} so the composer can surface a failed POST (e.g. 403)
    // inline rather than silently swallowing it.
    addComment: function (project, key, body) {
      var qs = '?project=' + encodeURIComponent(project);
      return apiFetch('/tasks/' + encodeURIComponent(key) + '/comments' + qs, {
        method: 'POST',
        headers: Object.assign(authHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ body_md: body || '' }),
      }).then(function (r) {
        if (!r) return null;
        return r.json().then(
          function (b) { return { status: r.status, body: b }; },
          function () { return { status: r.status, body: null }; }
        );
      });
    },
  };

  // --- SSE connection ---
  function connectSSE() {
    if (typeof EventSource === 'undefined') return;
    var es = new EventSource('/api/stream');

    es.addEventListener('connected', function () {
      var dot = document.querySelector('.heartbeat');
      if (dot) dot.style.opacity = '1';
    });

    // One listener body for all task events: re-dispatch each SSE event as a
    // 'kanban:<name>' CustomEvent so UI components can react with
    // soft-refetch + toast (no full page reload).
    ['created', 'transition', 'removed'].forEach(function (name) {
      es.addEventListener(name, function (evt) {
        try {
          var data = JSON.parse(evt.data);
          console.log('[sse] ' + name, data);
          window.dispatchEvent(new CustomEvent('kanban:' + name, { detail: data }));
        } catch (e) {
          console.error('[sse] parse error', e);
        }
      });
    });

    es.onerror = function () {
      var dot = document.querySelector('.heartbeat');
      if (dot) dot.style.opacity = '0.4';
      // Reconnect handled by EventSource automatically
    };

    window.__kanban_sse = es;
  }

  // Auto-connect SSE if we have a token
  if (getToken()) {
    connectSSE();
  } else {
    // Listen for token being set (e.g. after sign-in)
    var origSet = window.__kanban_setToken;
    window.__kanban_setToken = function (token) {
      origSet(token);
      if (token && !window.__kanban_sse) connectSSE();
    };
  }
})();
