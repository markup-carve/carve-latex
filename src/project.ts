import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { expandIncludes, parse, toAstJson } from '@markup-carve/carve';
import { fileSystemResolver } from '@markup-carve/carve/node';
import { compileAst } from './compile.js';
import type { AstNode, CompileOptions, IncludeDiagnostic, ProjectManifest, ProjectOptions, PublishOptions } from './types.js';

export interface Project {
  document: AstNode;
  manifest: ProjectManifest;
  publish: PublishOptions;
  /** Include warnings, in chapter order. Never carries a resolver's raw text. */
  includeWarnings: IncludeDiagnostic[];
  /** Canonical paths of the files expansion read, de-duplicated. */
  includeDependencies: string[];
}

/**
 * The containment root for a project's includes.
 *
 * A manifest `includeRoot` reaches the resolver unchanged. Resolving it here
 * would defeat the resolver's own refusal of a relative root, which is what
 * keeps containment off the process working directory (PART 9 section 19 I10):
 * a relative spec resolves against exactly that, so `..` would root a build at
 * the parent of whatever directory it happened to run in.
 */
function includeResolver(manifest: ProjectManifest, root: string, options: ProjectOptions) {
  if (options.includes === false || manifest.includes === false) return undefined;
  const configured = manifest.includeRoot;
  try {
    return fileSystemResolver(configured ?? root);
  } catch (error) {
    throw new Error(`Project includeRoot: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function readProject(path: string, options: ProjectOptions = {}): Project {
  const absolute = resolve(path); const root = dirname(absolute);
  const manifest = parseYaml(readFileSync(absolute, 'utf8')) as ProjectManifest;
  if (manifest?.version !== 1 || !Array.isArray(manifest.chapters) || !manifest.chapters.every((item) => typeof item === 'string')) throw new Error('Project manifest requires version: 1 and a chapters string array.');
  const chapterPaths = manifest.chapters.map((chapter) => {
    const path = resolve(root, chapter); const local = relative(root, path);
    if (local.startsWith('..') || isAbsolute(local)) throw new Error(`Chapter must stay inside the project root: ${chapter}`);
    return path;
  });
  const resolver = includeResolver(manifest, root, options);
  const includeWarnings: IncludeDiagnostic[] = [];
  const includeDependencies: string[] = [];
  const children = chapterPaths.flatMap((chapter) => {
    const source = readFileSync(chapter, 'utf8');
    let document = parse(source);
    if (resolver) {
      const expanded = expandIncludes(document, source, { resolve: resolver, sourcePath: chapter });
      document = expanded.doc;
      // `detail` is the resolver's own error text and commonly embeds an
      // absolute host path, so it is dropped rather than reported (I7).
      for (const warning of expanded.warnings) includeWarnings.push({ rule: warning.rule, message: warning.message, line: warning.line, column: warning.column, ...(warning.file ? { file: warning.file } : {}) });
      for (const dependency of expanded.dependencies) if (dependency.resolved && !includeDependencies.includes(dependency.id)) includeDependencies.push(dependency.id);
    }
    return (toAstJson(document) as unknown as AstNode).children ?? [];
  });
  return { document: { type: 'document', children }, manifest, publish: { ...(manifest.publish ?? {}), assetRoot: root }, includeWarnings, includeDependencies };
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

export function watchProject(path: string, rebuild: () => void, options: ProjectOptions = {}): () => void {
  const absolute = resolve(path); const root = dirname(absolute); let timer: NodeJS.Timeout | undefined;
  const current = readProject(absolute, options);
  // Included files are rebuild inputs like the chapters that pull them in.
  // Only the targets that resolved can be watched: a refused one reaches the
  // host as the path the directive wrote, with no directory behind it, so
  // creating a missing target still needs a manual rebuild.
  const files = [absolute, ...current.manifest.chapters.map((chapter) => resolve(root, chapter)), ...current.includeDependencies];
  const watchers = [...new Set(files)].map((file) => watch(file, () => { if (timer) clearTimeout(timer); timer = setTimeout(rebuild, 100); }));
  return () => { if (timer) clearTimeout(timer); for (const watcher of watchers) watcher.close(); };
}
