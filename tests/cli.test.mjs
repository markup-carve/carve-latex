import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('CLI writes TeX and a fidelity report', () => {
  const directory = mkdtempSync(join(tmpdir(), 'carve-latex-test-'));
  const input = join(directory, 'paper.crv'); const output = join(directory, 'paper.tex'); const report = join(directory, 'report.json');
  writeFileSync(input, '# Paper\n\nText.\n');
  const result = spawnSync(process.execPath, ['dist/cli.js', input, '--output', output, '--report', report], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(output, 'utf8'), /\\section\{Paper\}/);
  assert.equal(JSON.parse(readFileSync(report, 'utf8')).schemaVersion, 2);
});

test('CLI accepts canonical AST JSON', () => {
  const input = JSON.stringify({ type: 'document', srcByteLength: 3, children: [{ type: 'paragraph', children: [{ type: 'text', value: 'AST' }] }] });
  const result = spawnSync(process.execPath, ['dist/cli.js', '-', '--from-json', '--fragment'], { input, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'AST\n');
});
