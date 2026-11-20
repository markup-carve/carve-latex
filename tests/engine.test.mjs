import assert from 'node:assert/strict';
import test from 'node:test';
import { parse, encodeTree } from '@markup-carve/carve';
import { carveExtensions, citeExtension, parseCarve, readAst, renderAst } from '../dist/index.js';

test('parseCarve returns a resolved tree of AST contract 2.0', () => {
  const tree = parseCarve('= Plan\n\nSee </#Plan>.\n');
  assert.equal(tree.astVersion, '2.0');
  assert.equal(tree.children[0].generatedId, 'Plan');
  assert.equal(tree.children[1].children[1].href, '#Plan');
});

test('readAst accepts a 2.0 tree, bare or as JSON text', () => {
  const tree = { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'A' }] }] };
  assert.equal(readAst(tree).children[0].children[0].value, 'A');
  assert.equal(readAst(JSON.stringify(tree)).children[0].children[0].value, 'A');
});

test('readAst refuses a 0.1 tree instead of rendering it wrong', () => {
  assert.throws(() => readAst({ type: 'document', children: [{ type: 'list', ordered: true, items: [] }] }), /astVersion/);
});

test('carveExtensions registers the cite matcher', () => {
  assert.deepEqual(carveExtensions().map((item) => item.name), [citeExtension.name]);
  const [node] = parseCarve('x :cite[doe]{locator="p. 4" mode=suppress-author}\n').children[0].children.filter((item) => item.type === 'inline_extension');
  assert.deepEqual(node.props, { key: 'doe', locator: 'p. 4', mode: 'suppress-author' });
});

test('an unclaimed cite from a tree written without the matcher still prints as a citation', () => {
  const tree = JSON.parse(encodeTree(parse('A :cite[doe]{locator="p. 4"}.\n')));
  const result = renderAst(readAst(tree), { standalone: false, bibliography: ['refs.bib'] });
  assert.match(result.value, /\\autocite\[p\. 4\]\{doe\}/);
});
