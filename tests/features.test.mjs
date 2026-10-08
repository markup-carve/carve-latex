import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectLog, latexPasses, prepareDiagrams, readProject, renderAst, renderCarve, reportFails, reportToSarif } from '../dist/index.js';
import { DEFAULT_TEMPLATE } from '../dist/template.js';

const text = (value) => ({ type: 'text', value });

test('renders academic front matter, numbered equations, acronyms, and navigation lists', () => {
  const result = renderAst({ type: 'document', children: [
    { type: 'frontmatter', content: 'title: Paper\nabstract: A concise abstract.\nkeywords: [carve, publishing]\nlistOfFigures: true\nglossaries: true' },
    { type: 'abbreviation_def', abbr: 'AST', expansion: 'abstract syntax tree' },
    { type: 'paragraph', children: [{ type: 'abbreviation', abbr: 'AST', expansion: 'abstract syntax tree' }, { type: 'math', display: true, content: 'x^2', attrs: { id: 'energy' } }] },
  ] });
  assert.match(result.value, /\\begin\{abstract\}A concise abstract\./);
  assert.match(result.value, /\\textbf\{Keywords:\} carve, publishing/);
  assert.match(result.value, /\\listoffigures/);
  assert.match(result.value, /\\newacronym\{AST\}\{AST\}\{abstract syntax tree\}/);
  assert.match(result.value, /\\gls\{AST\}/);
  assert.match(result.value, /\\begin\{equation\}\\label\{energy\}/);
});

test('renders spanning, captioned tables with repeated heads', () => {
  const result = renderAst({ type: 'document', children: [{ type: 'table', caption: [text('Results')], rowGroups: { headRows: 1, bodies: [{ headRows: 0, bodyRows: 2 }], footRows: 0 }, columns: [{ align: 'left' }, { align: 'right' }], rows: [
    { type: 'table_row', cells: [{ type: 'table_cell', header: true, children: [text('Head')] }, { type: 'table_cell', header: true, span: 'colspan', children: [] }] },
    { type: 'table_row', cells: [{ type: 'table_cell', header: false, children: [text('A')] }, { type: 'table_cell', header: false, children: [text('1')] }] },
    { type: 'table_row', cells: [{ type: 'table_cell', header: false, span: 'rowspan', children: [] }, { type: 'table_cell', header: false, children: [text('2')] }] },
  ] }] });
  assert.match(result.value, /\\caption\{Results\} \\\\\n\\toprule/);
  assert.match(result.value, /\\multicolumn\{2\}\{l\}\{Head\}/);
  assert.match(result.value, /\\endfirsthead/);
});

test('emits safe syntax color and richer BibLaTeX fields', () => {
  const result = renderAst({ type: 'document', children: [
    { type: 'code_block', lang: 'javascript', content: 'const answer = 42;' },
    { type: 'paragraph', children: [{ type: 'citation', key: 'paper' }] },
    { type: 'citation_definition', key: 'paper', attrs: { keyValues: { type: 'article', author: 'Ada', year: '2026', title: 'Carve', journal: 'Markup' } }, children: [text('Fallback')] },
  ] });
  assert.match(result.value, /\\textcolor\{carvekeyword\}/);
  assert.match(result.value, /@article\{paper/);
  assert.match(result.value, /journal = \{Markup\}/);
});

test('exports SARIF, thresholds, and source positions', () => {
  const result = renderAst({ type: 'document', children: [{ type: 'comment', value: 'x', pos: { startLine: 4, endLine: 4, startColumn: 2 } }] });
  assert.equal(result.report.summary.dropped, 1);
  assert.equal(reportFails(result.report, 'degraded'), true);
  const sarif = reportToSarif(result.report, 'paper.crv');
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine, 4);
});

test('loads multi-file projects and preserves chapter order', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-latex-project-'));
  writeFileSync(join(root, 'one.crv'), '# One\n'); writeFileSync(join(root, 'two.crv'), '# Two\n');
  writeFileSync(join(root, 'book.yml'), 'version: 1\nchapters: [one.crv, two.crv]\npublish:\n  documentClass: book\n');
  const project = readProject(join(root, 'book.yml'));
  assert.deepEqual(project.document.children.filter((node) => node.type === 'heading').map((node) => node.children[0].value), ['One', 'Two']);
  assert.equal(project.publish.documentClass, 'book');
  writeFileSync(join(root, 'bad.yml'), 'version: 1\nchapters: [../outside.crv]\n');
  assert.throws(() => readProject(join(root, 'bad.yml')), /inside the project root/);
});

test('reports PDF log quality and leaves unsupported diagram source intact', () => {
  const quality = inspectLog('LaTeX Warning: Reference `x` undefined\nMissing character: A\nOverfull \\hbox');
  assert.equal(quality.missingReferences.length, 1); assert.equal(quality.missingGlyphs.length, 1); assert.equal(quality.overfullBoxes.length, 1);
  const root = mkdtempSync(join(tmpdir(), 'carve-latex-assets-'));
  const ast = { type: 'document', children: [{ type: 'code_block', lang: 'unknown', content: 'x' }] };
  assert.equal(prepareDiagrams(ast, root).children[0].type, 'code_block');
});

test('a line block keeps the indentation the engine encodes as non-breaking spaces', () => {
  const result = renderCarve('::: |\nflush\n   indented\n:::\n', { standalone: false });
  assert.match(result.value, /flush\\\\~~~indented/);
  assert.deepEqual(result.report.diagnostics, []);
});

test('a diagnostic carries the source position SARIF needs', () => {
  const result = renderCarve('Text.\n\n%% a dropped comment\n');
  const dropped = result.report.diagnostics.find((item) => item.code === 'comment-dropped');
  assert.equal(dropped.source.line, 3);
  const [first] = reportToSarif(result.report, 'doc.crv').runs[0].results;
  assert.equal(first.locations[0].physicalLocation.artifactLocation.uri, 'doc.crv');
  assert.equal(first.locations[0].physicalLocation.region.startLine, 3);
});

// Every environment `admonition()` and `div()` can name has to exist in every
// shipped template, or an ordinary document does not compile under a preset.
// `remark` is the fallback for every non-theorem admonition kind, so it is the
// one that breaks first; `proof` comes from amsthm and needs no declaration.
test('every shipped template declares the theorem environments the renderer emits', () => {
  const environments = ['theorem', 'lemma', 'proposition', 'corollary', 'definition', 'remark'];
  const sources = { '(default)': DEFAULT_TEMPLATE };
  for (const preset of ['article', 'book', 'thesis', 'journal', 'technical-report']) {
    sources[preset] = readFileSync(new URL(`../templates/${preset}.tex`, import.meta.url), 'utf8');
  }
  const missing = [];
  for (const [name, source] of Object.entries(sources)) {
    for (const environment of environments) {
      if (!new RegExp(String.raw`\\newtheorem\*?(\[[a-z]+\])?\{${environment}\}`).test(source)) {
        missing.push(`${name}: ${environment}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

// The book preset is the only template that uses \frontmatter and \mainmatter,
// which the article class does not define. Its class cannot come from an option
// that defaults to article.
test('the book preset pairs its class with the sectioning commands it uses', () => {
  const template = readFileSync(new URL('../templates/book.tex', import.meta.url), 'utf8');
  assert.match(template, /\\documentclass\[[^\]]*\]\{book\}/);
  const rendered = renderCarve('# Chapter\n\nText.\n', { preset: 'book' });
  assert.match(rendered.value, /\\documentclass\[a4paper,openany\]\{book\}/);
  assert.match(rendered.value, /\\begin\{document\}\\frontmatter/);
});

// From Carve SOURCE, not a hand-built node. Citations are Tier-2 and off in the
// engine by default, so the renderer's cite path was unreachable from a real
// document while the AST-level tests passed.
test('a cite written in Carve source reaches \\autocite', () => {
  const result = renderCarve('---yaml\ntitle: T\nbibliography: [refs.bib]\n---\n\nA cite [@key1].\n');
  assert.match(result.value, /\\autocite\{key1\}/);
});

test('an integral cite written in source reaches \\textcite', () => {
  const result = renderCarve('---yaml\ntitle: T\nbibliography: [refs.bib]\n---\n\nSee [+@key1].\n');
  assert.match(result.value, /\\textcite\{key1\}/);
});

test('an author-suppressed cite written in source reaches \\autocite*', () => {
  const result = renderCarve('---yaml\ntitle: T\nbibliography: [refs.bib]\n---\n\nSee [-@key1].\n');
  assert.match(result.value, /\\autocite\*\{key1\}/);
});

test('a cite against a declared bibliography needs no generated entry', () => {
  const result = renderCarve('---yaml\ntitle: T\nbibliography: [refs.bib]\n---\n\nA cite [@key1].\n');
  assert.doesNotMatch(result.value, /carve-generated\.bib/);
});

test('a source bibliography definition becomes a resolvable BibLaTeX entry', () => {
  const result = renderCarve('A cite [@key1].\n\n[@key1]: Ada Example. A Title. 2026.\n');
  assert.match(result.value, /@misc\{key1,/);
});

test('a cite in a project chapter reaches \\autocite too', () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-latex-cite-'));
  writeFileSync(join(root, 'one.crv'), 'A cite [@key1].\n\n[@key1]: Ada Example. A Title. 2026.\n');
  writeFileSync(join(root, 'book.yml'), 'version: 1\nchapters: [one.crv]\n');
  const result = renderAst(readProject(join(root, 'book.yml')).document);
  assert.match(result.value, /\\autocite\{key1\}/);
});

// `^ Figure #:` asks the host to number the caption and \caption already
// supplies "Figure 1:", so rendering the authored label gave "Figure 1:
// Figure : A plot".
test('an auto-numbered figure caption drops the authored label', () => {
  const result = renderCarve('![a](p.png)\n^ Figure #: A plot\n', { standalone: false });
  assert.match(result.value, /\\caption\{A plot\}/);
});

test('an auto-numbered table caption drops the authored label', () => {
  const result = renderCarve('| a |\n|---|\n| 1 |\n^ Table #: Results\n', { standalone: false });
  assert.match(result.value, /\\caption\{Results\} \\\\\n\\toprule/);
});

test('a caption that merely starts with the word Figure survives verbatim', () => {
  const result = renderCarve('![a](p.png)\n^ Figure of the result\n', { standalone: false });
  assert.match(result.value, /\\caption\{Figure of the result\}/);
});

test('a caption with a colon but no number placeholder survives verbatim', () => {
  const result = renderCarve('![a](p.png)\n^ Figure: A plot\n', { standalone: false });
  assert.match(result.value, /\\caption\{Figure: A plot\}/);
});

// A number placeholder away from the label position still takes a counter: it
// is not a LABEL, which is what the colon form makes it, but the number is
// printed where it stands. Measured against the engine, which is the oracle
// here - `carveToHtml` on the same source renders
// `<figcaption>A plot 1 of values: revised</figcaption>`.
//
// This file asserted the number was DROPPED, and the renderer obliged with a
// `caption-number-normalized` diagnostic. Both were wrong about the engine:
// the resolution pass assigns the counter and the published HTML prints it.
test('a number placeholder away from the label position still takes its counter', () => {
  const result = renderCarve('![a](p.png)\n^ A plot # of values: revised\n', { standalone: false });
  assert.match(result.value, /\\caption\{A plot 1 of values: revised\}/);
});

test('only the first colon after the number ends the label', () => {
  const result = renderCarve('![a](p.png)\n^ Figure #: A plot: revised\n', { standalone: false });
  assert.match(result.value, /\\caption\{A plot: revised\}/);
});

// A warning printed "Remark", and the title the AST carries was read by
// nothing at all.
test('an admonition renders the title the engine parsed', () => {
  const result = renderCarve('::: note "A titled note"\nbody\n:::\n', { standalone: false });
  assert.match(result.value, /\\begin\{carvenote\}\[\{A titled note\}\]/);
});

test('a title containing a bracket stays inside the optional argument', () => {
  const result = renderCarve('::: tip "With a ] bracket"\nbody\n:::\n', { standalone: false });
  assert.match(result.value, /\\begin\{carvetip\}\[\{With a \] bracket\}\]/);
});

test('each notice kind gets its own environment', () => {
  const kinds = ['note', 'tip', 'warning', 'danger', 'info', 'success', 'example', 'quote'];
  const seen = kinds.map((kind) => {
    const result = renderCarve(`::: ${kind}\nbody\n:::\n`, { standalone: false });
    return new RegExp(String.raw`\\begin\{carve${kind}\}`).test(result.value) ? kind : `${kind}: wrong environment`;
  });
  assert.deepEqual(seen, kinds);
});

test('a theorem kind carries its title as the amsthm optional argument', () => {
  const result = renderCarve('::: theorem "Pythagoras"\nbody\n:::\n', { standalone: false });
  assert.match(result.value, /\\begin\{theorem\}\[\{Pythagoras\}\]/);
});

test('a structural container reaches its own environment, not remark', () => {
  const result = renderCarve('::: abstract\nAn abstract.\n:::\n', { standalone: false });
  assert.match(result.value, /\\begin\{abstract\}/);
});

test('a title a structural container cannot carry is reported, not dropped in silence', () => {
  const result = renderCarve('::: abstract "A dropped title"\nBody.\n:::\n', { standalone: false });
  assert.equal(result.report.diagnostics[0].code, 'admonition-title-dropped');
});

test('an unrecognized kind still falls back to remark and says so', () => {
  const result = renderCarve('::: sidebar\nbody\n:::\n', { standalone: false });
  assert.equal(result.report.diagnostics[0].code, 'admonition-normalized');
});

test('every shipped template declares the notice environments the renderer emits', () => {
  const notices = ['note', 'tip', 'warning', 'danger', 'info', 'success', 'example', 'quote'];
  const sources = { '(default)': DEFAULT_TEMPLATE };
  for (const preset of ['article', 'book', 'thesis', 'journal', 'technical-report']) {
    sources[preset] = readFileSync(new URL(`../templates/${preset}.tex`, import.meta.url), 'utf8');
  }
  const missing = [];
  for (const [name, source] of Object.entries(sources)) {
    for (const notice of notices) {
      if (!new RegExp(String.raw`\\newtheorem\*\{carve${notice}\}`).test(source)) missing.push(`${name}: carve${notice}`);
    }
  }
  assert.deepEqual(missing, []);
});

// Two passes leave a bibliography's own labels unresolved, which the quality
// gate reports as a real undefined reference.
test('a document with a bibliography gets a third LaTeX pass', () => {
  assert.equal(latexPasses('\\usepackage[backend=biber]{biblatex}'), 3);
});

test('a document with no auxiliary tool keeps two passes', () => {
  assert.equal(latexPasses('\\documentclass{article}'), 2);
});

test('an explicit pass count still wins', () => {
  assert.equal(latexPasses('\\usepackage[backend=biber]{biblatex}', 1), 1);
});
