import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { AstNode, CompileOptions, CompileResult, PdfQualityReport, PublishOptions } from './types.js';
import { renderAst } from './render.js';
import { prepareDiagrams } from './assets.js';

export function compileAst(document: AstNode, publish: PublishOptions = {}, compile: CompileOptions = {}): CompileResult {
  const temporary = compile.workDir ? resolve(compile.workDir) : mkdtempSync(join(tmpdir(), 'carve-latex-'));
  mkdirSync(temporary, { recursive: true });
  const rendered = renderAst(publish.renderDiagrams ? prepareDiagrams(document, temporary) : document, publish);
  const output = resolve(compile.output ?? 'document.pdf');
  const job = basename(output, '.pdf');
  const texPath = join(temporary, `${job}.tex`);
  writeFileSync(texPath, rendered.value, 'utf8');
  const environment = { ...process.env, SOURCE_DATE_EPOCH: String(compile.sourceDateEpoch ?? 0), FORCE_SOURCE_DATE: '1', TZ: 'UTC' };
  const commands: string[][] = [];
  const run = (command: string, args: string[], optional = false): void => {
    commands.push([command, ...args]);
    const result = spawnSync(command, args, { cwd: temporary, env: environment, encoding: 'utf8' });
    if (result.error && optional && (result.error as NodeJS.ErrnoException).code === 'ENOENT') return;
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  };
  const latex = ['--interaction=nonstopmode', '--halt-on-error', '--file-line-error', '--no-shell-escape', `${job}.tex`];
  run('lualatex', latex);
  if (rendered.value.includes('{biblatex}')) run('biber', [job]);
  if (rendered.value.includes('\\makeindex')) run('makeindex', [`${job}.idx`], true);
  for (const name of rendered.value.matchAll(/\\makeindex\[name=([A-Za-z][A-Za-z0-9_-]*)/g)) run('makeindex', [`${job}-${name[1]}.idx`], true);
  if (rendered.value.includes('\\makeglossaries')) run('makeglossaries', [job], true);
  for (let pass = 1; pass < (compile.runs ?? 2); pass += 1) run('lualatex', latex);
  const built = join(temporary, `${job}.pdf`);
  if (!existsSync(built)) throw new Error(`LuaLaTeX completed without producing ${built}`);
  const quality = inspectLog(existsSync(join(temporary, `${job}.log`)) ? readFileSync(join(temporary, `${job}.log`), 'utf8') : '');
  const fonts = spawnSync('pdffonts', [built], { encoding: 'utf8' });
  if (fonts.status === 0) quality.unembeddedFonts = String(fonts.stdout).split(/\r?\n/).slice(2).filter((line) => line.trim() && !/\byes\s+yes\b/i.test(line));
  const info = spawnSync('pdfinfo', [built], { encoding: 'utf8' });
  if (info.status === 0) {
    quality.tagged = /^Tagged:\s+yes$/im.test(String(info.stdout));
    const version = /^PDF version:\s+(.+)$/im.exec(String(info.stdout))?.[1]; if (version) quality.pdfVersion = version;
  }
  if (compile.verifyReproducible) {
    const before = createHash('sha256').update(readFileSync(built)).digest('hex'); run('lualatex', latex);
    quality.reproducible = before === createHash('sha256').update(readFileSync(built)).digest('hex');
  }
  const qualityFailed = Object.values(quality).some((items) => Array.isArray(items) && items.length > 0)
    || compile.verifyReproducible === true && quality.reproducible !== true
    || publish.taggedPdf === true && quality.tagged === false;
  if (compile.qualityGate && qualityFailed) throw new Error(`PDF quality gate failed: ${JSON.stringify(quality)}`);
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(built, output);
  if (!compile.keepIntermediate && !compile.workDir) rmSync(temporary, { recursive: true, force: true });
  return { ...rendered, pdfPath: output, texPath: compile.keepIntermediate || compile.workDir ? texPath : '', commands, quality };
}

export function inspectLog(log: string): PdfQualityReport {
  const lines = log.split(/\r?\n/);
  const matches = (pattern: RegExp) => lines.filter((line) => pattern.test(line));
  return {
    missingReferences: matches(/LaTeX Warning: Reference .* undefined|There were undefined references/),
    missingCitations: matches(/Citation .* undefined|undefined citations/i),
    missingGlyphs: matches(/Missing character:/),
    overfullBoxes: matches(/Overfull \\[hv]box/),
    unembeddedFonts: [],
  };
}

export function assertToolchain(): { lualatex: string; biber?: string } {
  const locate = (name: string): string | undefined => {
    const result = spawnSync(name, ['--version'], { encoding: 'utf8' });
    return result.status === 0 ? String(result.stdout).split('\n')[0] : undefined;
  };
  const lualatex = locate('lualatex');
  if (!lualatex) throw new Error('LuaLaTeX is required for --pdf. Install TeX Live or use --tex.');
  const biber = locate('biber');
  return { lualatex, ...(biber ? { biber } : {}) };
}
