import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { encodeTree, includeDependencies, parseWithDiagnostics, type Diagnostic } from '@markup-carve/carve';
import { fileSystemResolver } from '@markup-carve/carve/node';
import { carveExtensions } from './citations.js';
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
 * The containment root for a project's includes, or undefined when includes are off.
 *
 * A relative `includeRoot` is refused rather than resolved: resolving it would
 * root containment at the process working directory (C2-N clauses of
 * `spec/0.2/includes.md` give the resolver an absolute root), so `..` would
 * root a build at the parent of whatever directory it happened to run in.
 */
function includeRoot(manifest: ProjectManifest, root: string, options: ProjectOptions): string | undefined {
  if (options.includes === false || manifest.includes === false) return undefined;
  const configured = manifest.includeRoot;
  if (configured === undefined) return root;
  if (typeof configured !== 'string' || !isAbsolute(configured)) throw new Error(`Project includeRoot must be an absolute path, got ${JSON.stringify(configured)}.`);
  if (!existsSync(configured) || !statSync(configured).isDirectory()) throw new Error(`Project includeRoot does not exist: ${configured}`);
  return configured;
}

type Located = { file?: string; line: number; column: number };

/**
 * The tree with every include node replaced by what it stands for: an expanded
 * include by its children, a refused one by its directive as literal text (the
 * HTML writer renders it the same way, C2-N include-unresolved). Positions in
 * included content name their file by the resolver id; it becomes an absolute path.
 */
function flattenIncludes(nodes: AstNode[], source: (file: string | undefined) => string, absolute: (file: string | undefined) => string | undefined): AstNode[] {
  return nodes.flatMap((node): AstNode[] => {
    if (node.type === 'include') {
      if (Array.isArray(node.children)) return flattenIncludes(node.children, source, absolute);
      const pos = node.pos as { startOffset?: number; endOffset?: number; file?: string } | undefined;
      const text = pos && typeof pos.startOffset === 'number' && typeof pos.endOffset === 'number'
        ? Buffer.from(source(pos.file), 'utf8').subarray(pos.startOffset, pos.endOffset).toString('utf8')
        : `{{ ${String(node.path ?? '')} }}`;
      return [{ type: 'paragraph', children: [{ type: 'text', value: text }], ...(pos ? { pos: relocate(pos, absolute) } : {}) }];
    }
    const copy: AstNode = { ...node };
    if (node.pos) copy.pos = relocate(node.pos as Record<string, unknown>, absolute);
    for (const key of Object.keys(copy)) {
      const value = copy[key];
      if (Array.isArray(value) && value.some((item) => item && typeof item === 'object' && typeof (item as AstNode).type === 'string')) copy[key] = flattenIncludes(value as AstNode[], source, absolute);
      else if (value && typeof value === 'object' && typeof (value as AstNode).type === 'string' && key !== 'pos') copy[key] = flattenIncludes([value as AstNode], source, absolute)[0];
    }
    return [copy];
  });
}

function relocate(pos: Record<string, unknown>, absolute: (file: string | undefined) => string | undefined): Record<string, unknown> {
  if (typeof pos.file !== 'string') return pos;
  return { ...pos, file: absolute(pos.file) };
}

/** The include warning a 0.2 parse diagnostic stands for, with the chain of include sites that reached it. */
function includeWarning(diagnostic: Diagnostic, document: AstNode, chapter: string, absolute: (file: string | undefined) => string | undefined): IncludeDiagnostic {
  const chain: AstNode[] = [];
  let node: AstNode | undefined = document;
  for (const segment of (diagnostic.path ?? '').split('/').slice(1)) {
    const next: unknown = node?.[segment] ?? (Array.isArray(node) ? node[Number(segment)] : undefined);
    node = next as AstNode | undefined;
    if (node && !Array.isArray(node) && node.type === 'include') chain.push(node);
  }
  const site = (include: AstNode | undefined): Located => {
    const pos = include?.pos as { startLine?: number; startColumn?: number; file?: string } | undefined;
    return { file: absolute(pos?.file) ?? chapter, line: pos?.startLine ?? 1, column: pos?.startColumn ?? 1 };
  };
  const own = site(chain.at(-1));
  const includedBy = chain.slice(0, -1).map(site);
  return { rule: diagnostic.code, message: diagnostic.message, line: own.line, column: own.column, file: own.file ?? chapter,
    ...(includedBy.length ? { includedBy } : {}) };
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
  const containment = includeRoot(manifest, root, options);
  let resolver: ReturnType<typeof fileSystemResolver> | undefined;
  try {
    resolver = containment === undefined ? undefined : fileSystemResolver(containment);
  } catch (error) {
    throw new Error(`Project includeRoot: ${error instanceof Error ? error.message : String(error)}`);
  }
  const includeWarnings: IncludeDiagnostic[] = [];
  const includeDependencies: string[] = [];
  const extensions = carveExtensions({ ...(manifest.publish ?? {}), assetRoot: root });
  const children = chapterPaths.flatMap((chapter) => {
    const source = readFileSync(chapter, 'utf8');
    const toAbsolute = (file: string | undefined) => (file === undefined || containment === undefined ? undefined : resolve(containment, file));
    const readSource = (file: string | undefined) => {
      const target = toAbsolute(file);
      try { return target ? readFileSync(target, 'utf8') : source; } catch { return ''; }
    };
    const parsed = parseWithDiagnostics(source, { extensions,
      ...(resolver && containment !== undefined ? { includes: { resolver, file: relative(containment, chapter) } } : {}) });
    const document = JSON.parse(encodeTree(parsed.document)) as AstNode;
    if (resolver) {
      // A warning carries the path the directive wrote and the engine's own
      // message, never the resolver's host path (C2-N include diagnostics).
      for (const item of parsed.diagnostics) if (item.code.startsWith('include-')) includeWarnings.push(includeWarning(item, document, chapter, toAbsolute));
      for (const dependency of includeDependencies_(parsed.document)) {
        const file = toAbsolute(dependency);
        if (file && !includeDependencies.includes(file)) includeDependencies.push(file);
      }
    }
    return flattenIncludes(document.children ?? [], readSource, toAbsolute);
  });
  return { document: { type: 'document', astVersion: '2.0', children }, manifest, publish: { ...(manifest.publish ?? {}), assetRoot: root }, includeWarnings, includeDependencies };
}

function includeDependencies_(document: Parameters<typeof includeDependencies>[0]): string[] {
  return includeDependencies(document).flatMap((dependency) => (dependency.read && typeof dependency.file === 'string' ? [dependency.file] : []));
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
