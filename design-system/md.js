/* md.js — minimal, dependency-free markdown -> HTML renderer for task specs.
 * Escape-first: the WHOLE input is HTML-escaped before any markdown transform,
 * so raw HTML in body_md can never reach the DOM (XSS-safe by construction).
 * Supports: headings #..####, **bold**, *italic*, `inline code`, fenced ```
 * code blocks, unordered (-/*) and ordered (1.) lists, read-only checkbox
 * lists (- [ ] / - [x]), GFM pipe tables with :---/:---:/---: alignment,
 * single-level > blockquotes, [links](url) with an http/https/relative-only
 * href whitelist, paragraphs and line breaks.
 * Deliberate limitations: blockquotes are one level only (a nested >> stays as
 * text of the first level); a `|` inside an inline code span still counts as a
 * table cell boundary, because cells are split before inline() runs — doing it
 * right would need a real tokenizer.
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

  /* inline() for the branches added for task specs (table cells, blockquote
   * lines, checkbox labels). Identical output except that `=` in the SOURCE
   * text is entity-encoded first, so an escaped payload such as
   * `&lt;img src=x onerror=alert(1)&gt;` cannot even leave the literal token
   * `onerror=` in the markup. Purely defensive: the text was already inert
   * (escape-first), and `&#61;` renders as `=` — including inside the href of
   * a generated link, where entities are decoded by the parser. */
  function inlineSpec(s) {
    return inline(s.replace(/=/g, '&#61;'));
  }

  var H_CLS = {
    1: 'text-[17px] font-semibold text-text mt-4 mb-1.5 first:mt-0',
    2: 'text-[15px] font-semibold text-text mt-4 mb-1.5 first:mt-0',
    3: 'text-[14px] font-semibold text-text mt-3 mb-1 first:mt-0',
    4: 'text-[13px] font-semibold text-text mt-3 mb-1 first:mt-0',
  };

  /* Split one GFM table row into trimmed cells. Outer pipes are optional. */
  function splitRow(line) {
    var s = line.trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
    return s.split('|').map(function (c) { return c.trim(); });
  }

  /* A separator row is `|---|:---:|---:|`: every cell is only dashes with an
   * optional leading/trailing colon. Returns the alignment per column, or null
   * when the line is NOT a separator (then the caller keeps paragraph behaviour). */
  function parseAligns(line) {
    if (line == null || line.indexOf('|') === -1) return null;
    var cells = splitRow(line);
    if (!cells.length) return null;
    var aligns = [];
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (!/^:?-+:?$/.test(c)) return null;
      var l = c.charAt(0) === ':';
      var r = c.charAt(c.length - 1) === ':';
      aligns.push(l && r ? 'center' : r ? 'right' : 'left');
    }
    return aligns;
  }

  function renderMarkdown(mdText) {
    var lines = escapeHtml(mdText).split(/\r?\n/);
    var html = '';
    var para = [];   // pending paragraph lines
    var list = null; // 'ul' | 'ol' | 'task' | null ('task' is a bullet-less <ul>)

    function flushPara() {
      if (para.length) {
        html += '<p class="text-text/90 leading-relaxed text-[13px] mb-2">' + para.map(inline).join('<br>') + '</p>';
        para = [];
      }
    }
    function closeList() {
      if (list) { html += '</' + (list === 'task' ? 'ul' : list) + '>'; list = null; }
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

      // GFM pipe table: current line has pipes AND the next one is a separator.
      if (line.indexOf('|') !== -1) {
        var aligns = parseAligns(lines[i + 1]);
        if (aligns) {
          flushPara(); closeList();
          var headers = splitRow(line);
          var cols = headers.length;
          while (aligns.length < cols) aligns.push('left');
          var cell = function (tag, text, col, cls) {
            return '<' + tag + ' class="' + cls + ' text-' + aligns[col] + '">' + inlineSpec(text) + '</' + tag + '>';
          };
          var thCls = 'px-2.5 py-1.5 border-b border-border font-semibold text-text whitespace-nowrap';
          var tdCls = 'px-2.5 py-1.5 border-t border-border align-top';
          var table = '<div class="overflow-x-auto mb-2"><table class="w-full border-collapse text-[13px] text-text/90"><thead><tr>';
          for (var c = 0; c < cols; c++) table += cell('th', headers[c], c, thCls);
          table += '</tr></thead><tbody>';
          i++; // consume the separator row
          while (i + 1 < lines.length && lines[i + 1].indexOf('|') !== -1 && !/^\s*$/.test(lines[i + 1])) {
            i++;
            var cells = splitRow(lines[i]);
            table += '<tr>';
            // ragged rows are normalised to the header width: pad / truncate
            for (var k = 0; k < cols; k++) table += cell('td', k < cells.length ? cells[k] : '', k, tdCls);
            table += '</tr>';
          }
          html += table + '</tbody></table></div>';
          continue;
        }
      }

      // Blockquote: consecutive `>` lines collapse into ONE <blockquote>.
      // (`>` is already escaped to `&gt;` by escapeHtml.) Single level only.
      m = line.match(/^\s*&gt;\s?(.*)$/);
      if (m) {
        flushPara(); closeList();
        var quoted = [m[1]];
        var qm;
        while (i + 1 < lines.length && (qm = lines[i + 1].match(/^\s*&gt;\s?(.*)$/))) {
          quoted.push(qm[1]); i++;
        }
        html += '<blockquote class="border-l-2 border-accent/60 pl-3 py-0.5 mb-2 text-text/75 italic text-[13px] leading-relaxed">'
          + quoted.map(inlineSpec).join('<br>') + '</blockquote>';
        continue;
      }

      // Read-only checkbox list — MUST be tested before the plain `ul` branch
      // below, which would otherwise swallow it and print a literal "[ ]".
      m = line.match(/^\s*[-*]\s+\[([ xX])\]\s*(.*)$/);
      if (m) {
        flushPara();
        if (list !== 'task') { closeList(); html += '<ul class="list-none pl-0 space-y-1 text-text/90 text-[13px] mb-2">'; list = 'task'; }
        html += '<li class="flex items-start gap-2 leading-relaxed">'
          + '<input type="checkbox" disabled' + (m[1] === ' ' ? '' : ' checked')
          + ' class="mt-[3px] shrink-0 cursor-default accent-accent">'
          + '<span>' + inlineSpec(m[2]) + '</span></li>';
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
