import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// md.js is a plain browser script (no module system, matching the rest of
// design-system/). It attaches renderMarkdown to window when present, else to
// globalThis — evaluate it in a function scope and pull the export out.
const src = readFileSync(fileURLToPath(new URL('../design-system/md.js', import.meta.url)), 'utf8')
const renderMarkdown = new Function(`${src}; return globalThis.renderMarkdown;`)() as (
  md: string,
) => string

describe('renderMarkdown — markdown features', () => {
  it('renders headings # through ####', () => {
    const html = renderMarkdown('# H1\n## H2\n### H3\n#### H4')
    expect(html).toContain('<h1')
    expect(html).toContain('>H1</h1>')
    expect(html).toContain('<h2')
    expect(html).toContain('>H2</h2>')
    expect(html).toContain('>H3</h3>')
    expect(html).toContain('>H4</h4>')
  })

  it('renders unordered lists from - and * markers', () => {
    const html = renderMarkdown('- one\n- two\n\n* three')
    expect(html).toContain('<ul')
    expect(html).toContain('>one</li>')
    expect(html).toContain('>two</li>')
    expect(html).toContain('>three</li>')
  })

  it('renders ordered lists', () => {
    const html = renderMarkdown('1. first\n2. second')
    expect(html).toContain('<ol')
    expect(html).toContain('>first</li>')
    expect(html).toContain('>second</li>')
  })

  it('renders inline code', () => {
    const html = renderMarkdown('run `pnpm test` locally')
    expect(html).toContain('<code')
    expect(html).toContain('>pnpm test</code>')
  })

  it('keeps bold/italic markers literal inside inline code', () => {
    const html = renderMarkdown('see `**not bold**`')
    expect(html).toContain('**not bold**')
    expect(html).not.toContain('<strong')
  })

  it('renders fenced code blocks verbatim (no inline transforms)', () => {
    const html = renderMarkdown('```\nconst x = 1\n**raw**\n```')
    expect(html).toContain('<pre')
    expect(html).toContain('const x = 1\n**raw**')
    expect(html).not.toContain('<strong')
  })

  it('renders bold and italic', () => {
    const html = renderMarkdown('**bold** and *italic*')
    expect(html).toContain('<strong')
    expect(html).toContain('>bold</strong>')
    expect(html).toContain('<em')
    expect(html).toContain('>italic</em>')
  })

  it('renders http/https links with noopener + _blank', () => {
    const html = renderMarkdown('[docs](https://example.com/docs)')
    expect(html).toContain('href="https://example.com/docs"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('>docs</a>')
  })

  it('renders relative links', () => {
    const html = renderMarkdown('[evidence](evidence.html)')
    expect(html).toContain('href="evidence.html"')
  })

  it('renders paragraphs and line breaks', () => {
    const html = renderMarkdown('line one\nline two\n\nnext para')
    expect(html).toContain('<p')
    expect(html).toContain('line one<br>line two')
    expect(html).toContain('next para')
  })

  it('renders a realistic task spec (heading + list + code)', () => {
    const html = renderMarkdown('## Spec\n\n- step one\n- step two\n\nrun `pnpm build`')
    expect(html).toContain('<h2')
    expect(html).toContain('<li')
    expect(html).toContain('<code')
  })
})

describe('renderMarkdown — XSS neutralization (escape-first)', () => {
  it('escapes <script> tags so they are inert text', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapes <img onerror> so no element/attribute reaches the DOM', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('rejects javascript: links — no anchor, no javascript: href', () => {
    const html = renderMarkdown('[x](javascript:alert(1))')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('<a')
    expect(html).toContain('[x](javascript:alert(1))') // left as plain text
  })

  it('rejects data: links', () => {
    const html = renderMarkdown('[x](data:text/html;base64,PHNjcmlwdD4=)')
    expect(html).not.toContain('href="data:')
    expect(html).not.toContain('<a')
  })

  it('escapes raw HTML inside code spans and fenced blocks', () => {
    const html = renderMarkdown('`<b>hi</b>`\n\n```\n<script>alert(2)</script>\n```')
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;')
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;')
  })

  it('cannot break out of the href attribute via quotes in the URL', () => {
    const html = renderMarkdown('[x](https://e.com/"onmouseover="alert(1))')
    expect(html).not.toContain('"onmouseover')
    expect(html).not.toContain('onmouseover="alert')
  })
})
