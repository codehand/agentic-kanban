/* share-dialog.js — the task three-dots menu (Share + Remove) and the Share
 * dialog, shared by the full-screen task page (task.html) and the board and
 * Tasks drawers (index.html, tasks.html). TASK-076 built them on task.html;
 * TASK-077 moved them here so all three pages use one copy.
 *
 * Usage: put <div data-share-menu class="relative ..."></div> where the
 * three-dots trigger goes, load this script, then call
 *   window.__shareDialog.mount({ task, onRemove, toast })
 *   task()      -> {project, key} of the task being shown, or null
 *   onRemove()  -> the page's guarded remove flow (confirm() + POST)
 *   toast(msg)  -> the page's toast
 * mount() fills the placeholder with the trigger + menu (#btn-more,
 * #more-menu, #menu-share, #btn-remove) and appends the dialog (#share) to
 * <body>. The page keeps gating the items by toggling `hidden` on
 * #menu-share / #btn-remove; the trigger hides itself when no item is left.
 *
 * The link is always location.origin + '/s/<token>': the address the owner
 * is using right now. When that is a loopback host the dialog says so. */
(function () {
  'use strict';

  var LOCAL_HOSTS = { 'localhost': 1, '127.0.0.1': 1, '::1': 1, '[::1]': 1 };
  var COPY_TITLE_INACTIVE = 'Click Share to activate the link first';
  var COPY_FEEDBACK_MS = 1600;

  var MENU_HTML =
    '<button id="btn-more" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="more-menu" aria-label="More actions" title="More actions" class="grid place-items-center w-9 h-9 rounded-md border border-border bg-panel2 text-muted hover:text-text hover:border-borderlt">' +
      '<i class="ph ph-dots-three text-[18px]"></i>' +
    '</button>' +
    '<div id="more-menu" role="menu" aria-label="Task actions" class="hidden absolute right-0 top-full mt-1 z-50 w-44 rounded-md border border-border bg-panel2 shadow-lg py-1">' +
      '<button id="menu-share" type="button" role="menuitem" tabindex="-1" class="w-full flex items-center gap-2 px-2.5 py-2 text-left text-[13px] text-text hover:bg-white/5 focus:bg-white/5 outline-none">' +
        '<i class="ph ph-share-network text-[15px]"></i> Share' +
      '</button>' +
      '<button id="btn-remove" type="button" role="menuitem" tabindex="-1" title="Remove (guarded)" class="w-full flex items-center gap-2 px-2.5 py-2 text-left text-[13px] text-st_reject hover:bg-st_reject/10 focus:bg-st_reject/10 outline-none">' +
        '<i class="ph ph-trash text-[15px]"></i> Remove' +
      '</button>' +
    '</div>';

  var TTL_SPAN = 'block rounded px-2 py-1.5 text-center text-[13px] text-muted peer-checked:bg-accent peer-checked:text-white dark:peer-checked:text-bg peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60 peer-disabled:cursor-not-allowed hover:text-text';
  function ttlOption(value, label, checked) {
    return '<label class="cursor-pointer"><input type="radio" name="share-ttl" value="' + value + '" class="sr-only peer"' + (checked ? ' checked' : '') + ' /><span class="' + TTL_SPAN + '">' + label + '</span></label>';
  }

  var DIALOG_HTML =
    '<div id="share" class="fixed inset-0 z-[60] hidden items-center justify-center bg-black/60 p-4">' +
      '<div role="dialog" aria-modal="true" aria-labelledby="share-title" class="w-full max-w-md rounded-xl border border-accent/30 bg-panel p-5">' +
        '<div class="flex items-center gap-2.5">' +
          '<span class="grid place-items-center w-9 h-9 rounded-lg bg-accent/15 text-accent"><i class="ph ph-share-network text-[19px]"></i></span>' +
          '<h3 id="share-title" class="text-[16px] font-semibold">Share task</h3>' +
        '</div>' +
        '<p class="mt-3 text-[13px] text-muted leading-relaxed">' +
          'Anyone on your network with this link can view the task <span class="text-text font-medium">read-only</span> until it expires. The link only works after you click <span class="text-text font-medium">Share</span>.' +
        '</p>' +
        '<fieldset class="mt-3">' +
          '<legend class="text-[13px] text-muted">Link expires after</legend>' +
          '<div id="share-ttl" class="mt-1 grid grid-cols-5 gap-1 rounded-md border border-border bg-panel2 p-1">' +
            ttlOption('300', '5m', true) + ttlOption('900', '15m') + ttlOption('3600', '1h') +
            ttlOption('86400', '24h') + ttlOption('forever', 'Forever') +
          '</div>' +
        '</fieldset>' +
        '<div class="mt-3">' +
          '<label for="share-url" class="text-[13px] text-muted">Share link</label>' +
          '<div class="mt-1 flex items-center gap-2">' +
            '<input id="share-url" type="text" readonly spellcheck="false" class="flex-1 min-w-0 rounded-md border border-border bg-panel2 px-2.5 h-9 mono text-[13px] text-text outline-none focus:border-accent/60" />' +
            '<button id="share-copy" type="button" aria-label="Copy link" class="grid place-items-center w-9 h-9 shrink-0 rounded-md border border-border bg-panel2 text-muted hover:text-text hover:border-borderlt disabled:opacity-40 disabled:cursor-not-allowed">' +
              '<i id="share-copy-icon" class="ph ph-copy text-[16px]"></i>' +
            '</button>' +
          '</div>' +
          '<p id="share-local-warning" role="note" class="hidden mt-2 flex gap-1.5 text-[13px] text-muted leading-relaxed">' +
            '<i class="ph ph-warning text-[15px] text-st_selffail shrink-0 mt-0.5" aria-hidden="true"></i>' +
            '<span>You opened this page via localhost, so this link only works on this machine. Open the UI via its LAN address (e.g. http://&lt;LAN-IP&gt;:&lt;port&gt;) to share it.</span>' +
          '</p>' +
          '<p id="share-status" role="status" class="hidden mt-2 flex items-center gap-1.5 text-[13px] text-text">' +
            '<i class="ph-fill ph-check-circle text-[15px] text-st_done" aria-hidden="true"></i>' +
            '<span id="share-status-text"></span>' +
          '</p>' +
        '</div>' +
        '<div class="mt-4 flex items-center justify-end gap-2">' +
          '<button id="share-cancel" type="button" class="rounded-md border border-border bg-panel2 px-3 h-9 text-[13px] text-muted hover:text-text">Cancel</button>' +
          '<button id="share-submit" type="button" class="flex items-center gap-1.5 rounded-md bg-accent px-3.5 h-9 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed">' +
            '<i class="ph ph-share-network text-[15px]"></i> Share' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  // The link token is generated here (CSPRNG, 24 bytes -> 32 base64url chars)
  // but only becomes usable once the server accepts it on "Share".
  function newShareToken() {
    var bytes = new Uint8Array(24), bin = '';
    crypto.getRandomValues(bytes);
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fmtExpiry(iso) { return new Date(iso).toLocaleString(); }
  function byId(id) { return document.getElementById(id); }
  function show(el, on) { el.classList.toggle('hidden', !on); }

  function mount(opts) {
    var api = window.__kanban_api;
    var slot = document.querySelector('[data-share-menu]');
    slot.innerHTML = MENU_HTML;
    document.body.insertAdjacentHTML('beforeend', DIALOG_HTML);

    var moreBtn = byId('btn-more');
    var moreMenu = byId('more-menu');
    var shareEl = byId('share');
    var urlBox = byId('share-url');
    var copyBtn = byId('share-copy');
    var copyIcon = byId('share-copy-icon');
    var submitBtn = byId('share-submit');
    var cancelBtn = byId('share-cancel');
    var radios = shareEl.querySelectorAll('input[name="share-ttl"]');
    var shareToken = '';
    var copyTimer = 0;

    // --- Three-dots menu ---
    function menuItems() {
      return Array.prototype.filter.call(moreMenu.querySelectorAll('[role="menuitem"]'), function (el) { return !el.classList.contains('hidden'); });
    }
    function menuOpen() { return !moreMenu.classList.contains('hidden'); }
    function openMenu() {
      moreMenu.classList.remove('hidden');
      moreBtn.setAttribute('aria-expanded', 'true');
      var items = menuItems();
      if (items.length) items[0].focus();
    }
    function closeMenu(refocus) {
      if (!menuOpen()) return;
      moreMenu.classList.add('hidden');
      moreBtn.setAttribute('aria-expanded', 'false');
      if (refocus) moreBtn.focus();
    }
    // No item left (e.g. drawer still loading) -> no trigger either.
    function syncTrigger() {
      var any = menuItems().length > 0;
      show(moreBtn, any);
      if (!any) closeMenu(false);
    }
    // Observe only the menu (not the trigger) so syncTrigger cannot retrigger itself.
    new MutationObserver(syncTrigger).observe(moreMenu, { subtree: true, attributes: true, attributeFilter: ['class'] });
    syncTrigger();

    moreBtn.addEventListener('click', function () { menuOpen() ? closeMenu(true) : openMenu(); });
    moreMenu.addEventListener('keydown', function (e) {
      var items = menuItems(), i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var n = items.length, next = e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
        if (n) items[next].focus();
      } else if (e.key === 'Tab') {
        closeMenu(false);
      }
    });
    document.addEventListener('click', function (e) {
      if (menuOpen() && !moreBtn.contains(e.target) && !moreMenu.contains(e.target)) closeMenu(false);
    });
    byId('menu-share').addEventListener('click', function () { closeMenu(false); openShare(); });
    // Refocus the trigger first: a dismissed confirm() must leave focus on #btn-more, not <body>.
    byId('btn-remove').addEventListener('click', function () { closeMenu(true); opts.onRemove(); });

    // --- Share dialog ---
    function selectedTtl() {
      var v = shareEl.querySelector('input[name="share-ttl"]:checked').value;
      return v === 'forever' ? null : Number(v);
    }
    function shareFocusables() {
      return Array.prototype.filter.call(shareEl.querySelectorAll('input[name="share-ttl"]:checked, #share-url, button'), function (el) { return !el.disabled; });
    }
    function setActive(active) {
      Array.prototype.forEach.call(radios, function (r) { r.disabled = active; });
      submitBtn.disabled = active;
      copyBtn.disabled = !active;
      copyBtn.title = active ? 'Copy link' : COPY_TITLE_INACTIVE;
      cancelBtn.textContent = active ? 'Close' : 'Cancel';
      show(byId('share-status'), active);
    }
    function resetCopyIcon() {
      clearTimeout(copyTimer);
      copyIcon.className = 'ph ph-copy text-[16px]';
    }
    function openShare() {
      var task = opts.task();
      if (!task) return;
      shareToken = newShareToken(); // fresh token on every open; TTL changes keep it
      byId('share-title').textContent = 'Share ' + task.key;
      shareEl.querySelector('input[name="share-ttl"][value="300"]').checked = true;
      setActive(false);
      resetCopyIcon();
      urlBox.value = location.origin + '/s/' + shareToken;
      show(byId('share-local-warning'), LOCAL_HOSTS[location.hostname] === 1);
      shareEl.classList.remove('hidden'); shareEl.classList.add('flex');
      shareEl.querySelector('input[name="share-ttl"]:checked').focus();
    }
    function shareOpen() { return !shareEl.classList.contains('hidden'); }
    function closeShare() {
      if (!shareOpen()) return;
      shareEl.classList.add('hidden'); shareEl.classList.remove('flex');
      moreBtn.focus(); // back to the trigger that opened the dialog
    }
    // navigator.clipboard only exists in secure contexts (https, localhost).
    // Opened via a plain-http LAN address it is missing, so fall back to
    // copying the selected link box; focus goes back where it was.
    function execCopy() {
      var prev = document.activeElement, ok = false;
      urlBox.focus(); urlBox.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      if (prev && prev.focus) prev.focus();
      return ok ? Promise.resolve() : Promise.reject();
    }
    function writeClipboard(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(execCopy);
      return execCopy();
    }

    cancelBtn.addEventListener('click', closeShare);
    shareEl.addEventListener('click', function (e) { if (e.target === shareEl) closeShare(); });
    shareEl.addEventListener('keydown', function (e) { // keep Tab inside the dialog
      if (e.key !== 'Tab') return;
      var f = shareFocusables(), first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    urlBox.addEventListener('focus', function (e) { e.target.select(); });

    submitBtn.addEventListener('click', function () {
      var task = opts.task();
      if (!task || !api) return;
      var url = urlBox.value;
      submitBtn.disabled = true;
      api.createShare(task.project, task.key, shareToken, selectedTtl()).then(function (resp) {
        if (!resp || resp.status !== 201) {
          submitBtn.disabled = false;
          submitBtn.focus(); // disabling dropped focus to <body>; keep it inside the open dialog
          opts.toast('Share failed: ' + ((resp && resp.body && resp.body.error) || 'link not activated'));
          return;
        }
        // Link is live: keep the dialog open so it can be copied again; the TTL
        // is fixed now (a different TTL = close and reopen for a new token).
        var exp = resp.body ? resp.body.expires_at : null;
        byId('share-status-text').textContent = exp ? 'Active until ' + fmtExpiry(exp) : 'Active · never expires';
        setActive(true);
        copyBtn.focus();
        var msg = exp ? 'Share link active until ' + fmtExpiry(exp) + '.' : 'Share link active (never expires).';
        writeClipboard(url).then(function () { opts.toast(msg + ' Copied to clipboard.'); }, function () { opts.toast(msg); });
      }).catch(function (err) {
        submitBtn.disabled = false;
        submitBtn.focus();
        opts.toast('Share failed: ' + String(err && err.message || err));
      });
    });

    copyBtn.addEventListener('click', function () {
      writeClipboard(urlBox.value).then(function () {
        resetCopyIcon();
        copyIcon.className = 'ph ph-check text-[16px]';
        copyTimer = setTimeout(resetCopyIcon, COPY_FEEDBACK_MS);
        opts.toast('Link copied.');
      }, function () {
        opts.toast('Copy failed: the link is selected, copy it yourself.');
        urlBox.focus(); // the focus handler selects the whole link
      });
    });

    // Esc closes only the top layer (dialog, else menu). Capture phase on
    // window runs before the pages' own document-level Esc handlers (which
    // close the drawer), and stops them.
    window.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (shareOpen()) closeShare();
      else if (menuOpen()) closeMenu(true);
      else return;
      e.stopImmediatePropagation();
    }, true);
  }

  window.__shareDialog = { mount: mount };
})();
