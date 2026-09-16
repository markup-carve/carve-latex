import { fromAstJson, parse, toAstJson } from '@markup-carve/carve';
import { compileAst, assertToolchain, inspectLog } from './compile.js';
import { renderAst } from './render.js';
import type { AstNode, CompileOptions, PublishOptions } from './types.js';
export { reportFails, reportToSarif } from './diagnostics.js';
export { publishBundle, readProject, watchProject, type Project } from './project.js';
export { prepareDiagrams } from './assets.js';
export { cslToBiblatex, fetchDoiCitation } from './citations.js';

export function parseCarve(source: string): AstNode {
  return toAstJson(parse(source)) as unknown as AstNode;
}

export function readAst(value: unknown): AstNode {
  return toAstJson(fromAstJson(value as never)) as unknown as AstNode;
}

export function renderCarve(source: string, options: PublishOptions = {}) {
  return renderAst(parseCarve(source), options);
}

export function compileCarve(source: string, publish: PublishOptions = {}, compile: CompileOptions = {}) {
  return compileAst(parseCarve(source), publish, compile);
}

export { assertToolchain, compileAst, inspectLog, renderAst };
export type * from './types.js';
