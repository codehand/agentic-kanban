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

  // --- Public API ---
  window.__kanban_api = {
    listProjects: function () {
      return apiFetch('/projects').then(function (r) { return r ? r.json() : null; });
    },

    createProject: function (payload) {
      return apiFetch('/projects', {
        method: 'POST',
        headers: Object.assign(authHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      }).then(function (r) { return r ? r.json() : null; });
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
  };

  // --- SSE connection ---
  function connectSSE() {
    if (typeof EventSource === 'undefined') return;
    var es = new EventSource('/api/stream');

    es.addEventListener('connected', function () {
      var dot = document.querySelector('.heartbeat');
      if (dot) dot.style.opacity = '1';
    });

    es.addEventListener('created', function (evt) {
      try {
        var data = JSON.parse(evt.data);
        console.log('[sse] created', data);
        window.dispatchEvent(new CustomEvent('kanban:created', { detail: data }));
      } catch (e) {
        console.error('[sse] parse error', e);
      }
    });

    es.addEventListener('transition', function (evt) {
      try {
        var data = JSON.parse(evt.data);
        console.log('[sse] transition', data);
        // Dispatch a custom event so UI components can react with
        // soft-refetch + toast (no full page reload).
        window.dispatchEvent(new CustomEvent('kanban:transition', { detail: data }));
      } catch (e) {
        console.error('[sse] parse error', e);
      }
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
