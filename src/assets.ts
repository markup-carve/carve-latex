import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { AstNode } from './types.js';

export function prepareDiagrams(document: AstNode, directory: string): AstNode {
  const copy = structuredClone(document); const assets = join(directory, 'assets'); mkdirSync(assets, { recursive: true });
  visit(copy, (node) => {
    if (node.type !== 'code_block') return;
    const lang = String(node.lang ?? '').toLowerCase(); const content = String(node.content ?? node.value ?? '');
    const id = createHash('sha256').update(`${lang}\0${content}`).digest('hex').slice(0, 16);
    const input = join(assets, `${id}.${lang === 'mermaid' ? 'mmd' : lang === 'plantuml' ? 'puml' : lang.startsWith('vega') ? 'json' : 'dot'}`); const output = join(assets, `${id}.pdf`);
    let command: [string, string[]] | undefined;
    if (lang === 'mermaid') command = ['mmdc', ['--input', input, '--output', output, '--pdfFit']];
    if (lang === 'plantuml') command = ['plantuml', ['-tpdf', input]];
    if (lang === 'graphviz' || lang === 'dot' || lang === 'chart') command = ['dot', ['-Tpdf', '-o', output, input]];
    if (lang === 'vega' || lang === 'vega-lite') {
      writeFileSync(input, content);
      const svg = spawnSync(lang === 'vega' ? 'vg2svg' : 'vl2svg', [input], { encoding: 'utf8', timeout: 60_000 });
      if (svg.status === 0) {
        const svgPath = join(assets, `${id}.svg`); writeFileSync(svgPath, svg.stdout);
        const converted = spawnSync('rsvg-convert', ['--format', 'pdf', '--output', output, svgPath], { encoding: 'utf8', timeout: 60_000 });
        if (converted.status === 0) Object.assign(node, { type: 'image', src: output, alt: `${lang} diagram`, attrs: { ...(node.attrs ?? {}), generated: true } });
      }
      return;
    }
    if (!command) return;
    writeFileSync(input, content);
    const run = spawnSync(command[0], command[1], { encoding: 'utf8', timeout: 60_000 });
    if (run.status === 0) Object.assign(node, { type: 'image', src: output, alt: `${lang} diagram`, attrs: { ...(node.attrs ?? {}), generated: true } });
  });
  return copy;
}

function visit(node: AstNode, callback: (node: AstNode) => void): void {
  callback(node);
  for (const key of ['children', 'items', 'rows', 'cells'] as const) for (const child of node[key] ?? []) visit(child, callback);
  if (node.target && typeof node.target === 'object') visit(node.target as AstNode, callback);
}
