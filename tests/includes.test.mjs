import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readProject } from '../dist/index.js';

const project = (files, manifest = 'version: 1\nchapters: [one.crv]\n') => {
  const root = mkdtempSync(join(tmpdir(), 'carve-latex-includes-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  writeFileSync(join(root, 'book.yml'), manifest);
  return root;
};

const paragraphs = (document) => document.children.filter((node) => node.type === 'paragraph').map((node) => node.children.map((child) => child.value ?? '').join(''));

test('expands a contained include and resolves a nested path against the including file', () => {
  const root = project({
    'one.crv': 'Intro.\n\n{{ parts/child.crv }}\n',
    'parts/child.crv': 'Child.\n\n{{ grandchild.crv }}\n',
    'parts/grandchild.crv': 'Grandchild.\n',
  });
  const result = readProject(join(root, 'book.yml'));
  assert.deepEqual(paragraphs(result.document), ['Intro.', 'Child.', 'Grandchild.']);
  assert.deepEqual(result.includeWarnings, []);
});

test('reports every file expansion read as a rebuild input', () => {
  const root = project({
    'one.crv': '{{ parts/child.crv }}\n',
    'parts/child.crv': '{{ grandchild.crv }}\n',
    'parts/grandchild.crv': 'Grandchild.\n',
  });
  const result = readProject(join(root, 'book.yml'));
  assert.deepEqual(result.includeDependencies.map((path) => path.slice(root.length + 1)).sort(), ['parts/child.crv', 'parts/grandchild.crv']);
});

test('refuses a target above the project root and leaves the directive literal', () => {
  const root = project({ 'one.crv': '{{ ../escape.crv }}\n' });
  writeFileSync(join(root, '..', 'escape.crv'), 'Escaped.\n');
  const result = readProject(join(root, 'book.yml'));
  assert.deepEqual(paragraphs(result.document), ['{{ ../escape.crv }}']);
  assert.equal(result.includeWarnings.length, 1);
  assert.equal(result.includeWarnings[0].rule, 'include-unresolved');
});

test('refuses a symlink that points out of the project root', () => {
  const root = project({ 'one.crv': '{{ escape.crv }}\n' });
  const outside = mkdtempSync(join(tmpdir(), 'carve-latex-outside-'));
  writeFileSync(join(outside, 'secret.crv'), 'Secret.\n');
  symlinkSync(join(outside, 'secret.crv'), join(root, 'escape.crv'));
  const result = readProject(join(root, 'book.yml'));
  assert.deepEqual(paragraphs(result.document), ['{{ escape.crv }}']);
  assert.equal(result.includeWarnings[0].rule, 'include-unresolved');
});

test('breaks a cycle between two included files', () => {
  const root = project({ 'one.crv': '{{ two.crv }}\n', 'two.crv': 'Two.\n\n{{ one.crv }}\n' });
  const result = readProject(join(root, 'book.yml'));
  assert.equal(result.includeWarnings.some((warning) => warning.rule === 'include-cycle'), true);
});

test('a refused target is reported by the path the directive wrote, not by a host path', () => {
  // I7: the engine folds "outside the root" and "not found" into one class so
  // a host path cannot be read back out of the message.
  const root = project({ 'one.crv': '{{ missing.crv }}\n' });
  const [warning] = readProject(join(root, 'book.yml')).includeWarnings;
  assert.equal(warning.rule, 'include-unresolved');
  assert.match(warning.message, /missing\.crv/);
  assert.equal(warning.message.includes(tmpdir()), false);
});

test('a manifest can leave directives literal', () => {
  const root = project({ 'one.crv': '{{ child.crv }}\n', 'child.crv': 'Child.\n' }, 'version: 1\nchapters: [one.crv]\nincludes: false\n');
  const result = readProject(join(root, 'book.yml'));
  assert.deepEqual(paragraphs(result.document), ['{{ child.crv }}']);
  assert.deepEqual(result.includeWarnings, []);
  assert.deepEqual(result.includeDependencies, []);
});

test('a caller can leave directives literal against a manifest that enables them', () => {
  const root = project({ 'one.crv': '{{ child.crv }}\n', 'child.crv': 'Child.\n' });
  assert.deepEqual(paragraphs(readProject(join(root, 'book.yml'), { includes: false }).document), ['{{ child.crv }}']);
  assert.deepEqual(paragraphs(readProject(join(root, 'book.yml'), { includes: true }).document), ['Child.']);
});

test('an explicit includeRoot narrows containment below the project root', () => {
  const root = project({
    'one.crv': '{{ parts/child.crv }}\n',
    'parts/child.crv': 'Child.\n\n{{ ../sibling.crv }}\n',
    'sibling.crv': 'Sibling.\n',
  });
  writeFileSync(join(root, 'book.yml'), `version: 1\nchapters: [one.crv]\nincludeRoot: ${join(root, 'parts')}\n`);
  const result = readProject(join(root, 'book.yml'));
  assert.deepEqual(paragraphs(result.document), ['Child.', '{{ ../sibling.crv }}']);
});

for (const spec of ['..', '.', 'parts', './parts', '']) {
  test(`refuses a relative includeRoot: ${JSON.stringify(spec)}`, () => {
    // The configured value reaches the resolver unchanged on purpose. Resolving
    // it here would silently root containment at the process working directory,
    // which is the value PART 9 section 19 I10 forbids outright.
    const root = project({ 'one.crv': '{{ child.crv }}\n', 'child.crv': 'Child.\n' }, `version: 1\nchapters: [one.crv]\nincludeRoot: ${JSON.stringify(spec)}\n`);
    assert.throws(() => readProject(join(root, 'book.yml')), /includeRoot.*absolute/s);
  });
}

test('refuses an absolute includeRoot that does not exist', () => {
  const root = project({ 'one.crv': '{{ child.crv }}\n' }, 'version: 1\nchapters: [one.crv]\nincludeRoot: /nonexistent-carve-latex-root\n');
  assert.throws(() => readProject(join(root, 'book.yml')), /includeRoot/);
});
