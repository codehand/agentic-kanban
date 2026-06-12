/* md.js — minimal, dependency-free markdown -> HTML renderer for task specs.
 * Escape-first: the WHOLE input is HTML-escaped before any markdown transform,
 * so raw HTML in body_md can never reach the DOM (XSS-safe by construction).
 * Supports: headings #..####, **bold**, *italic*, `inline code`, fenced ```
 * code blocks, unordered (-/*) and ordered (1.) lists, [links](url) with an
 * http/https/relative-only href whitelist, paragraphs and line breaks.
 * Loaded via <script src="/md.js"> in the browser (exposes window.renderMarkdown);
 * attaches to globalThis for the unit tests in tests/md-render.test.ts. */
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* Href whitelist: http(s) absolute URLs, or relative/anchor paths (no scheme
   * at all). Everything with another scheme (javascript:, data:, vbscript:,
   * file:, …) is rejected and the markdown stays plain text. */
  function isSafeHref(href) {
    if (/^https?:\/\//i.test(href)) return true;
    return href.indexOf(':') === -1;
  }

  /* Inline transforms on ALREADY-ESCAPED text. Code spans are pulled out
   * first (placeholders) so bold/italic/link markers inside them are kept
   * literal, then restored at the end. */
  function inline(s) {
    var codes = [];
    s = s.replace(/`([^`]+)`/g, function (m, code) {
      codes.push('<code class="mono text-[12px] px-1 py-0.5 rounded bg-white/5 text-text">' + code + '</code>');
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    s = s.replace(/\[([^\]]+)\]\(([^()\s]+)\)/g, function (m, label, href) {
      if (!isSafeHref(href)) return m; // unsafe scheme -> leave as plain text
      return '<a href="' + href + '" target="_blank" rel="noopener noreferrer" class="text-accent hover:underline">' + label + '</a>';
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-text">$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em class="italic">$1</em>');
    return s.replace(/\u0000(\d+)\u0000/g, function (m, i) { return codes[+i]; });
  }

  var H_CLS = {
    1: 'text-[17px] font-semibold text-text mt-4 mb-1.5 first:mt-0',
    2: 'text-[15px] font-semibold text-text mt-4 mb-1.5 first:mt-0',
    3: 'text-[14px] font-semibold text-text mt-3 mb-1 first:mt-0',
    4: 'text-[13px] font-semibold text-text mt-3 mb-1 first:mt-0',
  };

  function renderMarkdown(mdText) {
    var lines = escapeHtml(mdText).split(/\r?\n/);
    var html = '';
    var para = [];   // pending paragraph lines
    var list = null; // 'ul' | 'ol' | null

    function flushPara() {
      if (para.length) {
        html += '<p class="text-text/90 leading-relaxed text-[13px] mb-2">' + para.map(inline).join('<br>') + '</p>';
        para = [];
      }
    }
    function closeList() {
      if (list) { html += '</' + list + '>'; list = null; }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // Fenced code block: ``` ... ```
      if (/^```/.test(line)) {
        flushPara(); closeList();
        var code = [];
        for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
        html += '<pre class="mono text-[12px] leading-relaxed bg-white/5 border border-border rounded-lg p-3 overflow-x-auto mb-2"><code>' + code.join('\n') + '</code></pre>';
        continue;
      }

      var m = line.match(/^(#{1,4})\s+(.*)$/);
      if (m) {
        flushPara(); closeList();
        var lvl = m[1].length;
        html += '<h' + lvl + ' class="' + H_CLS[lvl] + '">' + inline(m[2]) + '</h' + lvl + '>';
        continue;
      }

      m = line.match(/^\s*[-*]\s+(.*)$/);
      if (m) {
        flushPara();
        if (list !== 'ul') { closeList(); html += '<ul class="list-disc pl-5 space-y-1 text-text/90 text-[13px] mb-2">'; list = 'ul'; }
        html += '<li class="leading-relaxed">' + inline(m[1]) + '</li>';
        continue;
      }

      m = line.match(/^\s*\d+\.\s+(.*)$/);
      if (m) {
        flushPara();
        if (list !== 'ol') { closeList(); html += '<ol class="list-decimal pl-5 space-y-1 text-text/90 text-[13px] mb-2">'; list = 'ol'; }
        html += '<li class="leading-relaxed">' + inline(m[1]) + '</li>';
        continue;
      }

      if (/^\s*$/.test(line)) { flushPara(); closeList(); continue; }

      closeList();
      para.push(line);
    }
    flushPara(); closeList();
    return html;
  }

  if (typeof window !== 'undefined') window.renderMarkdown = renderMarkdown;
  else globalThis.renderMarkdown = renderMarkdown;
})();
