import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { renderAst, renderCarve } from '../dist/index.js';
import * as templateModule from '../dist/template.js';

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

test('a code payload that carries its terminating newline gains no trailing paragraph', () => {
  // `\par` also appears in the preamble (\parskip, \parindent), so count inside
  // the environment only.
  const codeEnvironment = (node) => {
    const value = renderAst({ type: 'document', children: [node] }).value;
    const found = value.match(/\\begin\{carvecode\}\n([\s\S]*?)\n\\end\{carvecode\}/);
    assert.ok(found, 'no carvecode environment was rendered');
    return found[1];
  };
  const breaks = (node) => (codeEnvironment(node).match(/\\par\n/g) ?? []).length;

  // carve 0.1.8+ puts the payload's final newline in `content`. The nodes are
  // built here rather than parsed, so the assertions hold on either contract.
  assert.equal(breaks({ type: 'code_block', lang: 'js', content: 'const a = 1;\nconst b = 2;\n' }), 1);
  // The unhighlighted path encodes the newline itself, so it needs its own case.
  assert.equal(breaks({ type: 'code_block', lang: 'unsupported-lang', content: 'one\ntwo\n' }), 1);
  // An authored blank final line is payload, not the contract's terminator, so
  // it still separates from the payload that has no blank line at all.
  assert.equal(breaks({ type: 'code_block', lang: 'js', content: 'a\n' }), 0);
  assert.equal(breaks({ type: 'code_block', lang: 'js', content: 'a\n\n' }), 1);
  // A payload with no terminator (pre-0.1.8, or a hand-built node) is unchanged,
  // and an empty one must not lose a byte it never had.
  assert.equal(breaks({ type: 'code_block', lang: 'js', content: 'const a = 1;' }), 0);
  assert.equal(codeEnvironment({ type: 'code_block', content: '' }), '');
});

// From SOURCE, so the payload shape comes from whichever engine is installed
// rather than from this file. The hand-built cases above cannot see the next
// move of a verbatim field; this one can, which is what gives the resolved-range
// CI job teeth on this surface.
test('a parsed code block emits one line per payload line', () => {
  const environment = (source) => {
    const found = renderCarve(source, { standalone: false }).value
      .match(/\\begin\{carvecode\}\n([\s\S]*?)\n\\end\{carvecode\}/);
    assert.ok(found, 'no carvecode environment was rendered');
    return found[1];
  };
  assert.equal((environment('``` js\nconst a = 1;\n```\n').match(/\\par\n/g) ?? []).length, 0);
  assert.equal((environment('``` js\nconst a = 1;\nconst b = 2;\n```\n').match(/\\par\n/g) ?? []).length, 1);
  assert.equal((environment('~~~\nplain\n~~~\n').match(/\\par\n/g) ?? []).length, 0);
});

test('CSV and TSV fences highlight delimited fields', () => {
  const body = (language, value) => {
    const rendered = renderAst({ type: 'document', children: [{ type: 'code_block', lang: language, value }] }, { standalone: false }).value;
    const found = rendered.match(/\\begin\{carvecode\}\n([\s\S]*?)\n\\end\{carvecode\}/);
    assert.ok(found);
    return found[1];
  };
  const encoded = (value) => [...value].map((character) => character === '\n' ? '\\par\n' : character === '\t' ? '\\char32{}\\char32{}\\char32{}\\char32{}' : `\\char"${character.codePointAt(0).toString(16).toUpperCase()}{}`).join('');
  const bold = (inner, header) => header ? `\\textbf{${inner}}` : inner;
  const separator = (character, header = false) => bold(`\\textcolor{carvepunctuation}{${encoded(character)}}`, header);
  const string = (value, header = false) => bold(`\\textcolor{carvestring}{${encoded(value)}}`, header);
  const value = (text, header = false) => bold(`\\textcolor{carvevalue}{${encoded(text)}}`, header);
  const stripTyped = (rendered) => rendered
    .replace(/\\textbf\{/g, '{')
    .replace(/\\textcolor\{carve(?:value|string|punctuation)\}\{(?:\\char"[0-9A-F]+\{\}|\\char32\{\}|\\par\n)*\}/g, '')
    .replace(/\\par\n/g, '').replace(/[{}]/g, '');
  const csv = body('csv', 'Plan,Seats,Price per month\nStarter,1,"$0"\nTeam,10,"$49, billed yearly"');
  assert.equal((csv.match(/carvepunctuation/g) ?? []).length, 6);
  assert.ok(csv.startsWith(`${value('Plan', true)}${separator(',', true)}${value('Seats', true)}${separator(',', true)}${value('Price per month', true)}`));
  assert.ok(csv.includes(`${value('Starter')}${separator(',')}${value('1')}${separator(',')}${string('"$0"')}`));
  assert.ok(csv.includes(`${value('Team')}${separator(',')}${value('10')}${separator(',')}${string('"$49, billed yearly"')}`));
  assert.ok(!csv.includes('carvenumber'));
  assert.equal(stripTyped(csv), '', 'no untyped text is left in the body');

  const multiline = body('csv', 'a,"first\nsecond",z\nx,"a""b",y\nmid"quote,plain\nunterminated,"last');
  assert.ok(multiline.includes(string('"first\nsecond"', true)));
  assert.ok(multiline.includes(string('"a""b"')));
  assert.ok(multiline.includes(`${value('mid"quote')}${separator(',')}${value('plain')}`));
  assert.ok(multiline.endsWith(string('"last')));
  assert.equal((multiline.match(/carvepunctuation/g) ?? []).length, 6);
  assert.equal(stripTyped(multiline), '', 'no untyped text is left in the body');

  const tsv = body('tsv', 'left,right\t"one\ttwo"\tend');
  assert.equal((tsv.match(/carvepunctuation/g) ?? []).length, 2);
  assert.ok(tsv.includes(string('"one\ttwo"', true)));
  assert.ok(tsv.includes(value('left,right', true)));
  assert.ok(tsv.includes(separator('\t', true)));
  assert.ok(tsv.endsWith(value('end', true)));
});

test('parsed CSV fences use the delimited highlighter', () => {
  const rendered = renderCarve('```csv\nPlan,Seats,Price per month\nStarter,1,"$0"\nTeam,10,"$49, billed yearly"\n```\n', { standalone: false }).value;
  assert.match(rendered, /\\carvecodelabel\{csv\}/);
  assert.equal((rendered.match(/carvepunctuation/g) ?? []).length, 6);
  assert.equal((rendered.match(/carvestring/g) ?? []).length, 2);
  assert.ok((rendered.match(/carvevalue/g) ?? []).length >= 7);
});

test('the separator color is a red-family hue distinct from the comment grey', () => {
  const { DEFAULT_TEMPLATE } = templateModule;
  const rgb = (name) => DEFAULT_TEMPLATE.match(new RegExp(`definecolor\\{${name}\\}\\{RGB\\}\\{(\\d+),(\\d+),(\\d+)\\}`)).slice(1).map(Number);
  const [r, g, b] = rgb('carvepunctuation');
  assert.ok(r > 150 && r > g + 80 && r > b + 80, `carvepunctuation is ${r},${g},${b}`);
  assert.notDeepEqual(rgb('carvepunctuation'), rgb('carvecomment'));
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

test('a table continuation join (cell_wrap) renders as one space', () => {
  const result = renderCarve('| a | x |\n+ b | y |\n');
  assert.match(result.value, /a b & x y \\\\/);
  assert.deepEqual(result.report.diagnostics, []);
});

test('a blocked span marker stays a cell and keeps its continuation text', () => {
  const result = renderCarve('| a | b |\n| < | c |\n+ d | e |\n');
  assert.match(result.value, /a & b \\\\\nd & c e \\\\/);
});

test('resolved spans still merge cells', () => {
  const result = renderCarve('| a | < |\n| ^ | ^ |\n| x | y |\n');
  assert.match(result.value, /\\multicolumn\{2\}\{l\}\{\\multirow\{2\}\{\*\}\{a\}\} \\\\\n &  \\\\\nx & y \\\\/);
});

const codes = (result) => result.report.diagnostics.map((item) => item.code);

test('a toc placement prints the table of contents where it stands, not also at the template slot', () => {
  const result = renderCarve('# Intro\n\n::: toc\n:::\n\nText.\n', { tableOfContents: true });
  assert.equal(result.value.match(/\\tableofcontents/g)?.length, 1);
  assert.ok(result.value.indexOf('\\tableofcontents') > result.value.indexOf('\\section{Intro}'));
  assert.ok(!codes(result).some((code) => code.startsWith('unsupported')));
});

test('a footnotes placement adds nothing and is reported as a block, not an inline', () => {
  const result = renderCarve('Text[^a].\n\n[^a]: A note.\n\n::: footnotes\n:::\n', { standalone: false });
  assert.match(result.value, /\\footnote\{A note\.\}/);
  assert.deepEqual(codes(result), ['directive-normalized']);
});

test('a generated-content placement renders the blocks written inside it', () => {
  const result = renderCarve('::: glossary\nSee also the index.\n:::\n', { standalone: false });
  assert.match(result.value, /See also the index\./);
  assert.deepEqual(codes(result), ['directive-normalized']);
});

test('a block extension renders its fallback, or reports the loss as a block', () => {
  const paragraph = { type: 'paragraph', children: [{ type: 'text', value: 'Fallback text.' }] };
  const withFallback = renderAst({ type: 'document', children: [
    { type: 'block_extension', name: 'chart', payload: { format: 'json', value: '{}' }, fallback: paragraph },
  ] }, { standalone: false });
  assert.match(withFallback.value, /Fallback text\./);
  assert.deepEqual(codes(withFallback), ['block-extension-fallback-rendered']);
  const bare = renderAst({ type: 'document', children: [
    { type: 'block_extension', name: 'chart', payload: { format: 'json', value: '{"a":1}' } },
  ] }, { standalone: false });
  assert.match(bare.value, /\\begin\{carvecode\}/);
  assert.deepEqual(codes(bare), ['block-extension-degraded']);
});

const inline = (...children) => renderAst({ type: 'document', children: [paragraph(...children)] }, { standalone: false });

test('small caps render as textsc and keep nested marks', () => {
  const result = inline({ type: 'small_caps', children: [text('Carve '), { type: 'emphasis', children: [text('A&B')] }] });
  assert.equal(result.value.trim(), '\\textsc{Carve \\emph{A\\&B}}');
  assert.deepEqual(codes(result), []);
});

test('ruby stacks each annotation over its own base', () => {
  const result = inline({ type: 'ruby', pairs: [
    { base: [text('漢')], annotation: [text('kan')] },
    { base: [{ type: 'strong', children: [text('字')] }], annotation: [{ type: 'emphasis', children: [text('ji')] }] },
  ] });
  assert.equal(result.value.trim(), '\\shortstack{{\\scriptsize kan}\\\\漢}\\shortstack{{\\scriptsize \\emph{ji}}\\\\\\textbf{字}}');
  assert.deepEqual(codes(result), []);
});

test('a ruby pair with an empty annotation prints its base alone', () => {
  const result = inline({ type: 'ruby', pairs: [{ base: [text('字')], annotation: [] }, { base: [text('X')], annotation: [text('x')] }] });
  assert.equal(result.value.trim(), '字\\shortstack{{\\scriptsize x}\\\\X}');
  assert.deepEqual(codes(result), []);
});
