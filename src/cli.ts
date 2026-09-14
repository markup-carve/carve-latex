#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { compileAst, parseCarve, readAst, renderAst } from './index.js';
import type { DocumentClass, PublishOptions } from './types.js';

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) usage(0);
if (argv.includes('--version')) { console.log('0.1.0'); process.exit(0); }

const valueFlags = new Set(['--output', '-o', '--report', '--class', '--template', '--title', '--author', '--lang',
  '--margin', '--bibliography', '--cite-style', '--source-date-epoch']);
let input: string | undefined;
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index]!;
  if (valueFlags.has(arg)) { index += 1; continue; }
  if (arg === '-' || !arg.startsWith('-')) { input = arg; break; }
}
if (!input) usage(2);
const flag = (...names: string[]): string | undefined => {
  const index = argv.findIndex((arg) => names.includes(arg));
  return index >= 0 ? argv[index + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(name);
const source = input === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(input), 'utf8');
let ast;
try {
  ast = has('--from-json') ? readAst(JSON.parse(source)) : parseCarve(source);
} catch (error) {
  console.error(`Cannot read ${input}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const bibliography = flag('--bibliography')?.split(',').filter(Boolean);
const documentClass = flag('--class'); const template = flag('--template'); const title = flag('--title');
const author = flag('--author'); const lang = flag('--lang'); const margin = flag('--margin'); const citeStyle = flag('--cite-style');
const options: PublishOptions = {
  ...(documentClass ? { documentClass: documentClass as DocumentClass } : {}),
  ...(template ? { template: resolve(template) } : {}),
  ...(title ? { title } : {}),
  ...(author ? { author } : {}),
  ...(lang ? { lang } : {}),
  ...(margin ? { margin } : {}),
  ...(bibliography ? { bibliography } : {}),
  ...(citeStyle ? { citeStyle } : {}),
  assetRoot: input === '-' ? process.cwd() : dirname(resolve(input)),
  ...(has('--toc') ? { tableOfContents: true } : {}),
  ...(has('--index') ? { index: true } : {}),
  ...(has('--glossaries') ? { glossaries: true } : {}),
  ...(has('--unnumbered') ? { numberedHeadings: false } : {}),
  ...(has('--strict') ? { strict: true } : {}),
  ...(has('--fragment') ? { standalone: false } : {}),
  ...(has('--allow-raw-latex') ? { allowRawLatex: true } : {}),
};
const base = input === '-' ? 'document' : basename(input, extname(input));
const reportPath = flag('--report');
try {
  if (has('--pdf')) {
    const output = resolve(flag('--output', '-o') ?? `${base}.pdf`);
    const result = compileAst(ast, options, { output, keepIntermediate: has('--keep-tex'), sourceDateEpoch: Number(flag('--source-date-epoch') ?? 0) });
    if (reportPath) writeFileSync(reportPath, `${JSON.stringify(result.report, null, 2)}\n`);
    console.log(result.pdfPath);
  } else {
    const result = renderAst(ast, options);
    const output = flag('--output', '-o');
    if (output) writeFileSync(resolve(output), result.value); else process.stdout.write(result.value);
    if (reportPath) writeFileSync(reportPath, `${JSON.stringify(result.report, null, 2)}\n`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function usage(status: number): never {
  console.log(`Usage: carve-latex <document.crv|tree.json|-> [options]

Outputs LaTeX by default. Use --pdf to compile with LuaLaTeX.

  --from-json              read canonical Carve AST JSON
  --pdf                    compile a PDF
  -o, --output PATH        output path
  --report PATH            write fidelity report JSON
  --class TYPE             article, report, book, or thesis
  --template PATH          custom {{body}} template
  --bibliography A,B       BibLaTeX resource files
  --cite-style STYLE       BibLaTeX style
  --toc --index            generate navigation aids
  --glossaries             enable glossaries-extra
  --strict                 reject degraded/dropped content
  --allow-raw-latex        execute trusted raw latex/tex nodes
  --fragment               emit a LaTeX fragment
  --unnumbered             disable heading numbers
  --keep-tex               retain compilation directory
  --source-date-epoch N    reproducible build timestamp`);
  process.exit(status);
}
