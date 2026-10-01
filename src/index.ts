import { fromAstJson, parse, toAstJson } from '@markup-carve/carve';
import { compileAst, assertToolchain, inspectLog, latexPasses } from './compile.js';
import { carveExtensions } from './citations.js';
import { renderAst } from './render.js';
import type { AstNode, CompileOptions, PublishOptions } from './types.js';
export { reportFails, reportToSarif } from './diagnostics.js';
export { publishBundle, readProject, watchProject, type Project } from './project.js';
export { prepareDiagrams } from './assets.js';
export { carveExtensions, cslToBiblatex, fetchDoiCitation } from './citations.js';

export function parseCarve(source: string, options: PublishOptions = {}): AstNode {
  return toAstJson(parse(source, { extensions: carveExtensions(options) })) as unknown as AstNode;
}

export function readAst(value: unknown): AstNode {
  return toAstJson(fromAstJson(value as never)) as unknown as AstNode;
}

export function renderCarve(source: string, options: PublishOptions = {}) {
  return renderAst(parseCarve(source, options), options);
}

export function compileCarve(source: string, publish: PublishOptions = {}, compile: CompileOptions = {}) {
  return compileAst(parseCarve(source, publish), publish, compile);
}

export { assertToolchain, compileAst, inspectLog, latexPasses, renderAst };
export type * from './types.js';
