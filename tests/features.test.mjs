import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectLog, prepareDiagrams, readProject, renderAst, reportFails, reportToSarif } from '../dist/index.js';

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
  assert.match(result.value, /\\caption\{Results\}/);
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
  const result = renderAst({ type: 'document', children: [{ type: 'comment', value: 'x', pos: { start: { line: 4, column: 2 } } }] });
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
