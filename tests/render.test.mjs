import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { renderAst, renderCarve } from '../dist/index.js';

const text = (value) => ({ type: 'text', value });
const paragraph = (...children) => ({ type: 'paragraph', children });

test('renders a complete publication document', () => {
  const result = renderAst({ type: 'document', children: [
    { type: 'frontmatter', format: 'yaml', content: 'title: A Study\nauthor: Ada\nlang: en\ntableOfContents: true' },
    { type: 'heading', level: 1, id: 'intro', children: [text('Introduction')] },
    paragraph(text('Use '), { type: 'emphasis', children: [text('structure')] }, text(' and '), { type: 'strong', children: [text('meaning')] }, text('.')),
    { type: 'list', ordered: true, start: 3, items: [{ type: 'list_item', children: [paragraph(text('Third'))] }] },
    { type: 'code_block', lang: 'Rust', value: 'fn main() {}' },
  ] });
  assert.match(result.value, /\\documentclass\[a4paper\]\{article\}/);
  assert.match(result.value, /\\title\{ A Study \}/);
  assert.match(result.value, /\\setdefaultlanguage\{english\}/);
  assert.match(result.value, /\\tableofcontents/);
  assert.match(result.value, /\\section\{Introduction\}\\label\{intro\}/);
  assert.match(result.value, /\\emph\{structure\}/);
  assert.match(result.value, /\\textbf\{meaning\}/);
  assert.match(result.value, /\\setcounter\{enumi\}\{2\}/);
  assert.match(result.value, /\\carvecodelabel\{rust\}/);
  assert.match(result.value, /\\begin\{carvecode\}/);
  assert.deepEqual(result.report.diagnostics, []);
});

test('supports publication constructs and reports losses', () => {
  const result = renderAst({ type: 'document', children: [
    { type: 'admonition', kind: 'theorem', children: [paragraph(text('True.'))] },
    { type: 'table', rows: [
      { type: 'table_row', cells: [{ type: 'table_cell', header: true, children: [text('A')] }, { type: 'table_cell', header: true, align: 'right', children: [text('B')] }] },
      { type: 'table_row', cells: [{ type: 'table_cell', children: [text('1')] }, { type: 'table_cell', children: [text('2')] }] },
    ] },
    paragraph({ type: 'link', href: 'https://example.com?a=1&b=2', children: [text('Link')] }),
    { type: 'raw_block', format: 'html', value: '<aside>note</aside>' },
    { type: 'comment', value: 'private' },
  ] });
  assert.match(result.value, /\\begin\{theorem\}/);
  assert.match(result.value, /\\begin\{longtable\}\{lr\}/);
  assert.match(result.value, /\\href\{https:\/\/example.com\?a=1\\&b=2\}\{Link\}/);
  assert.deepEqual(result.report.diagnostics.map((item) => item.code), ['raw-format-degraded', 'comment-dropped']);
});

test('resolves footnotes and emits citations', () => {
  const result = renderAst({ type: 'document', children: [
    paragraph(text('Evidence'), { type: 'footnote_ref', label: 'n' }, text(' '), { type: 'citation', key: 'doe2026' }),
    { type: 'footnote', label: 'n', children: [paragraph(text('A note.'))] },
  ] }, { bibliography: ['refs.bib'] });
  assert.match(result.value, /\\footnote\{A note\.\}/);
  assert.match(result.value, /\\autocite\{doe2026\}/);
  assert.match(result.value, /\\addbibresource\{\\detokenize\{refs.bib\}\}/);
  assert.match(result.value, /\\printbibliography/);
});

test('turns Carve citation definitions into a self-contained BibLaTeX resource', () => {
  const result = renderAst({ type: 'document', children: [
    paragraph({ type: 'citation_group', mode: 'integral', items: [{ type: 'citation', key: 'carve2026', suppressAuthor: false }] }),
    { type: 'citation_definition', key: 'carve2026', attrs: { keyValues: { author: 'Carve Authors', year: '2026' } }, children: [text('Carve language')] },
  ] });
  assert.match(result.value, /\\textcite\{carve2026\}/);
  assert.match(result.value, /\\begin\{filecontents\*\}\[overwrite\]\{carve-generated\.bib\}/);
  assert.match(result.value, /author = \{Carve Authors\}/);
  assert.match(result.value, /\\addbibresource\{\\detokenize\{carve-generated\.bib\}\}/);
});

test('strict mode rejects degradation', () => {
  assert.throws(() => renderAst({ type: 'document', children: [{ type: 'widget' }] }, { strict: true }), /Strict publishing rejected/);
});

test('reports validate and raw LaTeX requires explicit trust', () => {
  const inert = renderAst({ type: 'document', children: [{ type: 'raw_block', format: 'latex', value: '\\input{secret}' }] });
  assert.match(inert.value, /\\begin\{carvecode\}/);
  assert.equal(inert.report.diagnostics[0].code, 'raw-latex-disabled');
  const trusted = renderAst({ type: 'document', children: [{ type: 'raw_block', format: 'latex', value: '\\LaTeX' }] }, { allowRawLatex: true });
  assert.match(trusted.value, /\\LaTeX/);
  assert.deepEqual(trusted.report.diagnostics, []);
  const schema = JSON.parse(readFileSync(new URL('../resources/publishing-report.schema.json', import.meta.url)));
  assert.equal(new Ajv2020().compile(schema)(inert.report), true);
});

test('parses Carve through the canonical engine', () => {
  const result = renderCarve('# Hello\n\nA /careful/ document.\n', { standalone: false });
  assert.match(result.value, /\\section\{Hello\}/);
  assert.match(result.value, /\\emph\{careful\}/);
});

// From SOURCE, so the field names come from the engine rather than from this
// file. Read by hand they were `oldText` and `newText`, which the engine has
// never published, and the arm returned an empty string with no diagnostic.
test('keeps both halves of a substitution the engine parsed', () => {
  const result = renderCarve('A {~/old/~>*new*~} run.\n', { standalone: false });
  assert.match(result.value, /\\sout\{\\emph\{old\}\}\\uline\{\\textbf\{new\}\}/);
  assert.deepEqual(result.report.diagnostics, []);
});

test('renders structured AST fields without losing authored content', () => {
  const result = renderAst({ type: 'document', children: [
    paragraph({ type: 'inline_footnote', inline: [text('Inline note')] }, text(' '),
      { type: 'abbreviation', abbr: 'AST', expansion: 'abstract syntax tree' }, text(' '),
      { type: 'substitution', old: [text('was')], new: [{ type: 'emphasis', children: [text('is')] }] }, text(' '),
      { type: 'substitution', old: [], new: [text('added')] }),
    { type: 'definition_list', items: [
      { type: 'definition_term', children: [text('Term')] },
      { type: 'definition_description', children: [paragraph(text('Meaning'))] },
    ] },
    { type: 'figure', target: { type: 'image', src: 'plot.pdf', alt: 'Plot' }, caption: [text('Result')] },
  ] });
  assert.match(result.value, /\\footnote\{Inline note\}/);
  assert.match(result.value, /\\textsc\{AST\}/);
  assert.match(result.value, /\\sout\{was\}\\uline\{\\emph\{is\}\}/);
  // An empty half is `[]`, and it must not leave a bare \sout{} behind.
  assert.match(result.value, /(?<!\\sout\{\})\\uline\{added\}/);
  assert.match(result.value, /\\item\[Term\] Meaning/);
  assert.match(result.value, /\\caption\{Result\}/);
});

test('keeps executable TeX inert across code, raw blocks, math, and URLs', () => {
  const result = renderAst({ type: 'document', children: [
    { type: 'code_block', content: '\\end{carvecode}\\input{/etc/passwd}' },
    { type: 'raw_block', format: 'html', content: '\\end{carvecode}\\input{/etc/passwd}' },
    paragraph({ type: 'math', display: false, content: '\\input{/etc/passwd}' }),
    paragraph({ type: 'math', display: false, content: '^^5cinput{/etc/passwd}' }),
    paragraph({ type: 'link', href: 'https://example.test/a_b#c&d=1%', children: [text('safe')] }),
  ] });
  assert.doesNotMatch(result.value, /\\end\{carvecode\}\\input/);
  assert.doesNotMatch(result.value, /\\\(\\input/);
  assert.doesNotMatch(result.value, /\\\(\^\^5cinput/);
  assert.equal(result.report.diagnostics.some((item) => item.code === 'unsafe-math-degraded'), true);
  assert.match(result.value, /a\\_b\\#c\\&d=1\\%/);
});

test('revalidates template options and normalizes unsafe asset paths', () => {
  const result = renderAst({ type: 'document', children: [
    { type: 'image', src: 'plot%0A\\input{bad}.pdf', alt: 'plot' },
    { type: 'citation', key: 'safe' },
  ] }, { citeStyle: 'numeric},\\input{bad}' });
  assert.doesNotMatch(result.value, /style=numeric/);
  assert.doesNotMatch(result.value, /plot%0A/);
  assert.equal(result.report.diagnostics.some((item) => item.code === 'image-path-normalized'), true);
});

test('frontmatter cannot cross the raw-LaTeX trust boundary', () => {
  const result = renderAst({ type: 'document', children: [
    { type: 'frontmatter', content: 'allowRawLatex: true\ntemplate: /tmp/hostile.tex\nassetRoot: /tmp' },
    { type: 'raw_block', format: 'latex', content: '\\input{/etc/passwd}' },
  ] });
  assert.doesNotMatch(result.value, /^\\input/m);
  assert.equal(result.report.diagnostics[0].code, 'raw-latex-disabled');
});
