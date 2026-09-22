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

describe('renderMarkdown — GFM pipe tables', () => {
  const table = '| Name | Qty | Note |\n|:---|:---:|---:|\n| a | 1 | x |\n| b | 2 | y |'

  it('renders a header row, a body row per line and no literal pipes', () => {
    const html = renderMarkdown(table)
    expect(html).toContain('<table')
    expect(html).toContain('<thead')
    expect(html.match(/<th\b/g) ?? []).toHaveLength(3)
    expect(html.match(/<tr\b/g) ?? []).toHaveLength(3)
    expect(html).toContain('>Name</th>')
    expect(html).toContain('>y</td>')
    expect(html.replace(/<[^>]*>/g, '')).not.toContain('|')
  })

  it('maps :---/:---:/---: to left/center/right alignment classes', () => {
    const html = renderMarkdown(table)
    expect(html).toMatch(/<th[^>]*text-left[^>]*>Name<\/th>/)
    expect(html).toMatch(/<th[^>]*text-center[^>]*>Qty<\/th>/)
    expect(html).toMatch(/<th[^>]*text-right[^>]*>Note<\/th>/)
  })

  it('wraps the table so wide tables scroll instead of overflowing the drawer', () => {
    expect(renderMarkdown(table)).toContain('overflow-x-auto')
  })

  it('accepts rows without outer pipes', () => {
    const html = renderMarkdown('A | B\n--- | ---\n1 | 2')
    expect(html).toContain('>A</th>')
    expect(html).toContain('>B</th>')
    expect(html).toContain('>1</td>')
    expect(html).toContain('>2</td>')
  })

  it('normalises ragged body rows to the header width', () => {
    const html = renderMarkdown('| A | B |\n|---|---|\n| only-one |\n| x | y | z |')
    expect(html.match(/<tr\b/g) ?? []).toHaveLength(3)
    expect(html.match(/<td\b/g) ?? []).toHaveLength(4) // 2 columns × 2 rows
    expect(html).not.toContain('>z</td>') // extra cell truncated
  })

  it('does not treat pipe-bearing text as a table without a separator row', () => {
    const html = renderMarkdown('a | b | c\nplain text line')
    expect(html).not.toContain('<table')
    expect(html).toContain('<p')
    expect(html).toContain('a | b | c<br>plain text line')
  })

  it('ends the table at a blank line and keeps following text as a paragraph', () => {
    const html = renderMarkdown('| A |\n|---|\n| 1 |\n\nafter')
    expect(html.match(/<tr\b/g) ?? []).toHaveLength(2)
    expect(html).toContain('</table>')
    expect(html).toContain('>after</p>')
  })

  it('applies inline formatting inside cells', () => {
    const html = renderMarkdown('| A |\n|---|\n| **bold** |')
    expect(html).toContain('<strong')
    expect(html).toContain('>bold</strong>')
  })

  it('still renders links with query strings inside cells', () => {
    const html = renderMarkdown('| A |\n|---|\n| [docs](https://example.com/?q=1) |')
    // `=` is entity-encoded in the text pipeline; the parser decodes it inside
    // the attribute, so the link target is unchanged
    expect(html).toContain('href="https://example.com/?q&#61;1"')
    expect(html).toContain('>docs</a>')
  })

  // Documented limitation: cells are split before inline() runs, so a pipe
  // inside a code span still ends the cell. Asserted so the real behaviour is
  // visible rather than pretended away.
  it('KNOWN LIMITATION: a | inside an inline code span still splits the cell', () => {
    const html = renderMarkdown('| A | B |\n|---|---|\n| `a|b` | c |')
    expect(html).toContain('>`a</td>') // first cell keeps the opening backtick
    expect(html).toContain('>b`</td>') // the code span is torn in two
    expect(html).not.toContain('<code')
  })
})

describe('renderMarkdown — blockquotes', () => {
  it('collapses consecutive > lines into exactly one blockquote', () => {
    const html = renderMarkdown('> first\n> second')
    expect(html.match(/<blockquote/g) ?? []).toHaveLength(1)
    expect(html).toContain('first<br>second')
    expect(html).not.toContain('&gt; first')
  })

  it('starts a new blockquote after a blank line', () => {
    const html = renderMarkdown('> one\n\n> two')
    expect(html.match(/<blockquote/g) ?? []).toHaveLength(2)
  })

  it('applies inline formatting inside a quote', () => {
    const html = renderMarkdown('> see `pnpm test`')
    expect(html).toContain('<code')
    expect(html).toContain('>pnpm test</code>')
  })

  it('keeps a nested >> as text of the single supported level', () => {
    const html = renderMarkdown('>> deep')
    expect(html.match(/<blockquote/g) ?? []).toHaveLength(1)
    expect(html).toContain('&gt; deep')
  })

  it('does not swallow the paragraph that follows the quote', () => {
    const html = renderMarkdown('> quoted\nplain')
    expect(html).toContain('>quoted</blockquote>')
    expect(html).toContain('>plain</p>')
  })
})

describe('renderMarkdown — read-only checkbox lists', () => {
  it('renders - [ ] / - [x] as disabled checkboxes with no literal brackets', () => {
    const html = renderMarkdown('- [ ] todo\n- [x] done')
    expect(html.match(/<input[^>]*type="checkbox"/g) ?? []).toHaveLength(2)
    expect(html.match(/disabled/g) ?? []).toHaveLength(2)
    expect(html.match(/checked/g) ?? []).toHaveLength(1)
    expect(html).toMatch(/<input[^>]*checked[^>]*>\s*<span>done<\/span>/)
    expect(html.replace(/<[^>]*>/g, '')).not.toMatch(/\[\s?\]|\[[xX]\]/)
  })

  it('accepts uppercase [X] and the * marker', () => {
    const html = renderMarkdown('* [X] done')
    expect(html.match(/checked/g) ?? []).toHaveLength(1)
  })

  it('drops the bullet for task lists but keeps it for plain lists', () => {
    expect(renderMarkdown('- [ ] a')).toContain('list-none')
    expect(renderMarkdown('- a')).toContain('list-disc')
  })

  it('is tested before the ul branch, so mixed lists split correctly', () => {
    const html = renderMarkdown('- plain\n- [ ] task')
    expect(html.match(/<ul/g) ?? []).toHaveLength(2)
    expect(html).toContain('list-disc')
    expect(html).toContain('list-none')
    expect(html).toContain('>plain</li>')
  })

  it('applies inline formatting to the label', () => {
    const html = renderMarkdown('- [x] ship **now**')
    expect(html).toContain('<strong')
    expect(html).toContain('>now</strong>')
  })
})

describe('renderMarkdown — XSS neutralization (escape-first)', () => {
  const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>'

  it('escapes raw HTML inside table cells', () => {
    const html = renderMarkdown(`| h |\n|---|\n| ${payload} |`)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    // the new branches also entity-encode `=`, so not even the literal token
    // `onerror=` survives in the markup
    expect(html).not.toMatch(/onerror\s*=/)
    expect(html).toContain('&lt;img src&#61;x onerror&#61;alert(1)&gt;')
  })

  it('escapes raw HTML inside blockquotes', () => {
    const html = renderMarkdown(`> ${payload}`)
    expect(html).toContain('<blockquote')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).not.toMatch(/onerror\s*=/)
  })

  it('escapes raw HTML inside checkbox labels', () => {
    const html = renderMarkdown(`- [ ] ${payload}`)
    expect(html).toContain('type="checkbox"')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).not.toMatch(/onerror\s*=/)
  })


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
