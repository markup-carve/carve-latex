import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parse, toAstJson } from '@markup-carve/carve';
import { compileAst } from './compile.js';
import type { AstNode, CompileOptions, ProjectManifest, PublishOptions } from './types.js';

export function readProject(path: string): { document: AstNode; manifest: ProjectManifest; publish: PublishOptions } {
  const absolute = resolve(path); const root = dirname(absolute);
  const manifest = parseYaml(readFileSync(absolute, 'utf8')) as ProjectManifest;
  if (manifest?.version !== 1 || !Array.isArray(manifest.chapters) || !manifest.chapters.every((item) => typeof item === 'string')) throw new Error('Project manifest requires version: 1 and a chapters string array.');
  const chapterPaths = manifest.chapters.map((chapter) => {
    const path = resolve(root, chapter); const local = relative(root, path);
    if (local.startsWith('..') || isAbsolute(local)) throw new Error(`Chapter must stay inside the project root: ${chapter}`);
    return path;
  });
  const children = chapterPaths.flatMap((chapter) => (toAstJson(parse(readFileSync(chapter, 'utf8'))) as unknown as AstNode).children ?? []);
  return { document: { type: 'document', children }, manifest, publish: { ...(manifest.publish ?? {}), assetRoot: root } };
}

export function publishBundle(document: AstNode, publish: PublishOptions, compile: CompileOptions, directory: string) {
  const root = resolve(directory); const workDir = resolve(root, 'build'); mkdirSync(workDir, { recursive: true });
  const output = resolve(root, 'publication.pdf');
  const result = compileAst(document, publish, { ...compile, output, workDir, keepIntermediate: true });
  const tex = resolve(root, 'publication.tex'); copyFileSync(result.texPath, tex);
  const report = resolve(root, 'fidelity.json'); writeFileSync(report, `${JSON.stringify(result.report, null, 2)}\n`);
  const files = [output, tex, report, ...walkFiles(join(workDir, 'assets'))];
  const manifest = { schemaVersion: 1, files: files.map((file) => ({ path: relative(root, file), sha256: createHash('sha256').update(readFileSync(file)).digest('hex') })), quality: result.quality, commands: result.commands };
  writeFileSync(resolve(root, 'publication-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...result, bundlePath: root, manifest };
}

function walkFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => { const path = join(directory, name); return statSync(path).isDirectory() ? walkFiles(path) : [path]; });
}

export function watchProject(path: string, rebuild: () => void): () => void {
  const absolute = resolve(path); const root = dirname(absolute); let timer: NodeJS.Timeout | undefined;
  const current = readProject(absolute);
  const files = [absolute, ...current.manifest.chapters.map((chapter) => resolve(root, chapter))];
  const watchers = files.map((file) => watch(file, () => { if (timer) clearTimeout(timer); timer = setTimeout(rebuild, 100); }));
  return () => { if (timer) clearTimeout(timer); for (const watcher of watchers) watcher.close(); };
}
