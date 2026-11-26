import { decodeTree, encodeTree, parse } from '@markup-carve/carve';
import { compileAst, assertToolchain, inspectLog, latexPasses } from './compile.js';
import { carveExtensions } from './citations.js';
import { renderAst } from './render.js';
import type { AstNode, CompileOptions, PublishOptions } from './types.js';
export { reportFails, reportToSarif } from './diagnostics.js';
export { publishBundle, readProject, watchProject, type Project } from './project.js';
export { prepareDiagrams } from './assets.js';
export { carveExtensions, citeExtension, cslToBiblatex, fetchDoiCitation } from './citations.js';

/** The resolved 0.2 tree (AST contract 2.0) as plain JSON data. */
export function parseCarve(source: string, options: PublishOptions = {}): AstNode {
  return JSON.parse(encodeTree(parse(source, { extensions: carveExtensions(options) }))) as AstNode;
}

/** Validates a tree of AST contract 2.0, bare or in an envelope, and returns it as plain JSON data. */
export function readAst(value: unknown, options: PublishOptions = {}): AstNode {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return JSON.parse(encodeTree(decodeTree(text, { extensions: carveExtensions(options) }))) as AstNode;
}

export function renderCarve(source: string, options: PublishOptions = {}) {
  return renderAst(parseCarve(source, options), options);
}

export function compileCarve(source: string, publish: PublishOptions = {}, compile: CompileOptions = {}) {
  return compileAst(parseCarve(source, publish), publish, compile);
}

export { assertToolchain, compileAst, inspectLog, latexPasses, renderAst };
export type * from './types.js';
