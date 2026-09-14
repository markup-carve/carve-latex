import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type { AstNode, CompileOptions, CompileResult, PublishOptions } from './types.js';
import { renderAst } from './render.js';

export function compileAst(document: AstNode, publish: PublishOptions = {}, compile: CompileOptions = {}): CompileResult {
  const rendered = renderAst(document, publish);
  const temporary = compile.workDir ? resolve(compile.workDir) : mkdtempSync(join(tmpdir(), 'carve-latex-'));
  mkdirSync(temporary, { recursive: true });
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
  if (rendered.value.includes('\\makeglossaries')) run('makeglossaries', [job], true);
  for (let pass = 1; pass < (compile.runs ?? 2); pass += 1) run('lualatex', latex);
  const built = join(temporary, `${job}.pdf`);
  if (!existsSync(built)) throw new Error(`LuaLaTeX completed without producing ${built}`);
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(built, output);
  if (!compile.keepIntermediate && !compile.workDir) rmSync(temporary, { recursive: true, force: true });
  return { ...rendered, pdfPath: output, texPath: compile.keepIntermediate || compile.workDir ? texPath : '', commands };
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
