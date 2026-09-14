#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileAst, cslToBiblatex, fetchDoiCitation, parseCarve, publishBundle, readAst, readProject, renderAst, reportFails, reportToSarif, watchProject } from './index.js';
import type { DocumentClass, PublishOptions } from './types.js';

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) usage(0);
if (argv.includes('--version')) { console.log('0.1.0'); process.exit(0); }

const valueFlags = new Set(['--output', '-o', '--report', '--class', '--template', '--title', '--author', '--lang',
  '--margin', '--bibliography', '--cite-style', '--source-date-epoch', '--project', '--bundle', '--sarif', '--fail-on', '--preset', '--csl', '--doi']);
let input: string | undefined;
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index]!;
  if (valueFlags.has(arg)) { index += 1; continue; }
  if (arg === '-' || !arg.startsWith('-')) { input = arg; break; }
}
const projectArgument = argv.indexOf('--project');
if (!input && projectArgument >= 0) input = argv[projectArgument + 1];
if (!input) usage(2);
const flag = (...names: string[]): string | undefined => {
  const index = argv.findIndex((arg) => names.includes(arg));
  return index >= 0 ? argv[index + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(name);
const project = projectArgument >= 0 ? readProject(input) : undefined;
const source = project ? '' : input === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(input), 'utf8');
let ast;
try {
  ast = project?.document ?? (has('--from-json') ? readAst(JSON.parse(source)) : parseCarve(source));
} catch (error) {
  console.error(`Cannot read ${input}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
if (has('--watch')) {
  if (!project) { console.error('--watch requires --project.'); process.exit(2); }
  const childArgs = process.argv.slice(1).filter((arg) => arg !== '--watch');
  watchProject(input, () => { console.log('Rebuilding…'); spawnSync(process.execPath, childArgs, { stdio: 'inherit' }); });
  console.log(`Watching ${input}`);
  await new Promise(() => undefined);
}
const bibliography = flag('--bibliography')?.split(',').filter(Boolean);
const cslBibliography = flag('--csl')?.split(',').filter(Boolean);
let generatedBibliography: string | undefined;
if (flag('--doi')) {
  try { generatedBibliography = (await Promise.all(flag('--doi')!.split(',').map((doi) => fetchDoiCitation(doi).then(cslToBiblatex)))).join('\n\n'); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
}
const documentClass = flag('--class'); const template = flag('--template'); const title = flag('--title');
const author = flag('--author'); const lang = flag('--lang'); const margin = flag('--margin'); const citeStyle = flag('--cite-style');
const preset = flag('--preset') as PublishOptions['preset'];
const options: PublishOptions = {
  ...(project?.publish ?? {}),
  ...(documentClass ? { documentClass: documentClass as DocumentClass } : {}),
  ...(template ? { template: resolve(template) } : {}),
  ...(title ? { title } : {}),
  ...(author ? { author } : {}),
  ...(lang ? { lang } : {}),
  ...(margin ? { margin } : {}),
  ...(bibliography ? { bibliography } : {}),
  ...(cslBibliography ? { cslBibliography } : {}),
  ...(generatedBibliography ? { generatedBibliography } : {}),
  ...(citeStyle ? { citeStyle } : {}),
  ...(preset ? { preset } : {}),
  assetRoot: input === '-' ? process.cwd() : dirname(resolve(input)),
  ...(has('--toc') ? { tableOfContents: true } : {}),
  ...(has('--index') ? { index: true } : {}),
  ...(has('--glossaries') ? { glossaries: true } : {}),
  ...(has('--unnumbered') ? { numberedHeadings: false } : {}),
  ...(has('--strict') ? { strict: true } : {}),
  ...(has('--fragment') ? { standalone: false } : {}),
  ...(has('--allow-raw-latex') ? { allowRawLatex: true } : {}),
  ...(has('--pdfa') ? { pdfa: true } : {}),
  ...(has('--tagged-pdf') ? { taggedPdf: true } : {}),
  ...(has('--render-diagrams') ? { renderDiagrams: true } : {}),
};
const base = input === '-' ? 'document' : basename(input, extname(input));
const reportPath = flag('--report');
const requestedOutput = flag('--output', '-o') ?? project?.manifest.output;
const sarifPath = flag('--sarif');
const failOn = flag('--fail-on') as 'normalized' | 'degraded' | 'dropped' | undefined;
const finishReport = (result: ReturnType<typeof renderAst>): void => {
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(result.report, null, 2)}\n`);
  if (sarifPath) writeFileSync(sarifPath, `${JSON.stringify(reportToSarif(result.report, input), null, 2)}\n`);
  if (failOn && reportFails(result.report, failOn)) throw new Error(`Fidelity threshold ${failOn} was reached.`);
};
try {
  if (flag('--bundle')) {
    const result = publishBundle(ast, options, { sourceDateEpoch: Number(flag('--source-date-epoch') ?? 0), qualityGate: has('--quality-gate'), verifyReproducible: has('--verify-reproducible') }, flag('--bundle')!);
    finishReport(result);
    console.log(result.bundlePath);
  } else if (has('--pdf')) {
    const output = resolve(requestedOutput ?? `${base}.pdf`);
    const result = compileAst(ast, options, { output, keepIntermediate: has('--keep-tex'), sourceDateEpoch: Number(flag('--source-date-epoch') ?? 0), qualityGate: has('--quality-gate'), verifyReproducible: has('--verify-reproducible') });
    finishReport(result);
    console.log(result.pdfPath);
  } else {
    const result = renderAst(ast, options);
    const output = requestedOutput;
    if (output) writeFileSync(resolve(output), result.value); else process.stdout.write(result.value);
    finishReport(result);
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
  --sarif PATH             write diagnostics as SARIF
  --fail-on LEVEL          fail on normalized, degraded, or dropped
  --project PATH           build a multi-chapter project manifest
  --watch                  rebuild a project when its inputs change
  --bundle DIRECTORY       emit PDF, TeX, report, manifest, and checksums
  --class TYPE             article, report, book, or thesis
  --template PATH          custom {{body}} template
  --preset NAME            article, book, thesis, journal, or technical-report
  --bibliography A,B       BibLaTeX resource files
  --csl A,B                import CSL JSON bibliography files
  --doi A,B                resolve DOI metadata explicitly
  --cite-style STYLE       BibLaTeX style
  --toc --index            generate navigation aids
  --glossaries             enable glossaries-extra
  --strict                 reject degraded/dropped content
  --allow-raw-latex        execute trusted raw latex/tex nodes
  --fragment               emit a LaTeX fragment
  --unnumbered             disable heading numbers
  --keep-tex               retain compilation directory
  --quality-gate           fail on missing refs/citations/glyphs or overfull boxes
  --verify-reproducible    compare consecutive finalized PDF builds
  --pdfa                   request PDF/A-2b document metadata
  --tagged-pdf             enable experimental LaTeX tagged-PDF output
  --render-diagrams        run installed local diagram tools explicitly
  --source-date-epoch N    reproducible build timestamp`);
  process.exit(status);
}
