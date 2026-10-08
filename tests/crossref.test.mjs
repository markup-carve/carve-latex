import assert from 'node:assert/strict';
import test from 'node:test';
import { carveToHtml } from '@markup-carve/carve';
import { renderCarve } from '../dist/index.js';

/**
 * Cross-references, labels, and the engine as the oracle.
 *
 * `\cref` to a label that was never written compiles to `??` and only warns, so
 * a missing `\label` and a dangling `\cref` are both silent in TeX. Three
 * divergences from the engine lived here behind that silence:
 *
 *   * a heading with an AUTO id got no `\label` at all - this renderer only
 *     emitted one for an explicit id - while every `</#Name>` pointing at it
 *     emitted a `\cref`. `# Plan` plus `See </#Plan>.` produced
 *     `\section{Plan}` with no label and `See \cref{Plan}.`;
 *   * an UNRESOLVED reference emitted a `\cref` all the same, so under exact
 *     case (carve 0.1.8) any case mismatch became a dangling reference rather
 *     than text;
 *   * a caption number away from the label position was dropped, which the
 *     engine prints.
 *
 * All three are gone because the document is run through the engine's own
 * resolution pass instead of this renderer deriving ids and resolution itself.
 * The id rule is not one worth owning twice: `# 1. First` takes `s-1-First`,
 * since an id may not open with a digit.
 */

function tex(source) {
  return renderCarve(source, { standalone: false }).value;
}

function labels(source) {
  return [...tex(source).matchAll(/\\label\{([^}]*)\}/g)].map((m) => m[1]);
}

function crefs(source) {
  return [...tex(source).matchAll(/\\cref\{([^}]*)\}/g)].map((m) => m[1]);
}

/** The ids the ENGINE assigns, read off its own HTML. */
function engineIds(source) {
  return [...carveToHtml(source).matchAll(/<section id="([^"]*)"/g)].map((m) => m[1]);
}

test('a heading with an auto id gets a label, so a reference to it resolves', () => {
  const source = '# Plan\n\nSee </#Plan>.\n';
  assert.deepEqual(labels(source), ['Plan']);
  assert.deepEqual(crefs(source), ['Plan']);
});

/**
 * The id rule is the engine's. `# 1. First` cannot take the id `1-First`
 * because an id may not open with a digit, and a renderer deriving its own slug
 * would have to know that.
 */
test('the label is the id the engine assigns, not a slug invented here', () => {
  const source = '# 1. First\n\nSee </#s-1-First>.\n';
  assert.deepEqual(engineIds(source), ['s-1-First']);
  assert.deepEqual(labels(source), ['s-1-First']);
  assert.deepEqual(crefs(source), ['s-1-First']);
});

/** Every label this renderer writes is an id the engine agrees exists. */
test('no label is invented that the engine does not assign', () => {
  for (const source of [
    '# Plan\n',
    '# 1. First\n',
    '# Plain One\n\n# Hello, World!\n',
    '{#Explicit}\n# Titled\n',
  ]) {
    for (const label of labels(source)) {
      const ids = engineIds(source);
      assert.ok(
        ids.includes(label),
        `label ${JSON.stringify(label)} is not among the engine's ids ${JSON.stringify(ids)} for ${JSON.stringify(source)}`,
      );
    }
  }
});

test('an unresolved cross-reference is written as text, not as a dangling cref', () => {
  const source = '{#Plan}\n# Plan\n\nSee </#plan>.\n';
  assert.deepEqual(crefs(source), [], 'a reference that resolves to nothing must not emit \\cref');
  assert.match(tex(source), /<\/\\#plan>/);
});

test('an unresolved cross-reference is reported, not dropped quietly', () => {
  const report = renderCarve('{#Plan}\n# Plan\n\nSee </#plan>.\n', { standalone: false }).report;
  const codes = report.diagnostics.map((d) => d.code);
  assert.ok(codes.includes('crossref-unresolved'), `expected crossref-unresolved, got ${JSON.stringify(codes)}`);
});

/**
 * Ids differing only by case are two targets under exact-case lookup, so they
 * must stay two labels. `safeLabel` keeps case, and this holds it to that.
 */
test('ids differing only by case stay two labels and two references', () => {
  const source = '{#Fig}\n# Fig\n\n{#fig}\n# fig\n\nSee </#Fig> and </#fig>.\n';
  assert.deepEqual(labels(source), ['Fig', 'fig']);
  assert.deepEqual(crefs(source), ['Fig', 'fig']);
});

/**
 * The discriminator. Every assertion above would hold over a renderer that
 * emitted no TeX at all, and the suite would read as healthy over empty output.
 */
test('the renderer still produces the document around the references', () => {
  const out = tex('# Plan\n\nBody text.\n\nSee </#Plan>.\n');
  assert.match(out, /\\section\{Plan\}/);
  assert.match(out, /Body text\./);
});
