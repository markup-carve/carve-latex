import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeLiteralBlock, escapeIndex, escapeLatex, escapeUrl, safeLabel } from './escape.js';
import { metadataOptions, readMetadata } from './metadata.js';
import { applyTemplate, DEFAULT_TEMPLATE } from './template.js';
import { cslToBiblatex } from './citations.js';
import type { AstNode, PublishOptions, PublishingDiagnostic, RenderResult } from './types.js';

type Context = {
  options: Required<Pick<PublishOptions, 'documentClass' | 'paper' | 'margin' | 'numberedHeadings' | 'tableOfContents' | 'index' | 'glossaries'>> & PublishOptions;
  diagnostics: PublishingDiagnostic[];
  footnotes: Map<string, AstNode>;
  citations: Set<string>;
  citationDefinitions: Map<string, AstNode>;
  abbreviations: Map<string, AstNode>;
  path: string[];
};

const BLOCK_TYPES = new Set(['document', 'heading', 'paragraph', 'block_quote', 'list', 'definition_list',
  'code_block', 'table', 'figure', 'figure_group', 'admonition', 'div', 'line_block', 'raw_block',
  'thematic_break', 'comment', 'footnote', 'link_reference_definition', 'abbreviation_def', 'citation_definition']);

export function renderAst(document: AstNode, supplied: PublishOptions = {}): RenderResult {
  if (document.type !== 'document') throw new TypeError(`Expected a Carve document AST, got ${document.type}`);
  const metadata = readMetadata(document);
  const options = defaults({ ...metadataOptions(metadata), ...supplied });
  const context: Context = { options, diagnostics: [], footnotes: collect(document, 'footnote', 'label'),
    citations: new Set(), citationDefinitions: collect(document, 'citation_definition', 'key'),
    abbreviations: collect(document, 'abbreviation_def', 'abbr'), path: [] };
  const body = renderChildren(document.children ?? [], context, true);
  prepareBibliography(context);
  prepareGlossary(context);
  validatePreset(context, document);
  const preset = options.preset ? fileURLToPath(new URL(`../templates/${options.preset}.tex`, import.meta.url)) : undefined;
  const template = options.template ? readFileSync(options.template, 'utf8') : preset ? readFileSync(preset, 'utf8') : DEFAULT_TEMPLATE;
  const value = options.standalone === false ? body : applyTemplate(template, body, options);
  if (options.strict && context.diagnostics.some((item) => item.fidelity === 'degraded' || item.fidelity === 'dropped')) {
    throw new Error('Strict publishing rejected degraded or dropped content.');
  }
  const summary = { preserved: 0, normalized: 0, degraded: 0, dropped: 0 };
  for (const item of context.diagnostics) summary[item.fidelity] += 1;
  return {
    value,
    metadata,
    report: { schemaVersion: 2, sourceFormat: 'carve-ast', targetFormat: 'latex', diagnostics: context.diagnostics, summary },
  };
}

function validatePreset(context: Context, document: AstNode): void {
  const requirements: Record<string, Array<'title' | 'author'>> = { book: ['title'], thesis: ['title', 'author'], journal: ['title', 'author'], 'technical-report': ['title', 'author'] };
  for (const field of requirements[context.options.preset ?? ''] ?? []) if (!context.options[field]) diagnostic(context, document, 'missing-template-metadata', `The ${context.options.preset} preset requires ${field}.`, 'degraded');
}

function defaults(options: PublishOptions): Context['options'] {
  const { preset: ignoredPreset, citeStyle: ignoredCiteStyle, ...safeOptions } = options;
  const documentClass = ['article', 'report', 'book', 'thesis'].includes(String(options.documentClass)) ? options.documentClass! : 'article';
  const paper = ['a4paper', 'letterpaper'].includes(String(options.paper)) ? options.paper! : 'a4paper';
  const preset = ['article', 'book', 'thesis', 'journal', 'technical-report'].includes(String(options.preset)) ? options.preset : undefined;
  const margin = /^\d+(?:\.\d+)?(?:mm|cm|in|pt)$/.test(String(options.margin ?? '')) ? options.margin! : '25mm';
  return {
    ...safeOptions, documentClass, paper, margin, ...(preset ? { preset } : {}),
    lang: /^(?:en|de|fr|es|it|pt)$/.test(String(options.lang ?? 'en')) ? String(options.lang ?? 'en') : 'en',
    ...(/^[A-Za-z0-9_-]+$/.test(String(options.citeStyle ?? '')) ? { citeStyle: options.citeStyle } : {}),
    numberedHeadings: options.numberedHeadings ?? true,
    tableOfContents: options.tableOfContents ?? false, index: options.index ?? Boolean(options.indexes?.length),
    glossaries: options.glossaries ?? false, standalone: options.standalone ?? true,
  };
}

function collect(document: AstNode, type: string, key: string): Map<string, AstNode> {
  const values = new Map<string, AstNode>();
  visit(document, (node) => { if (node.type === type && typeof node[key] === 'string') values.set(String(node[key]), node); });
  return values;
}

function visit(node: AstNode, callback: (node: AstNode) => void): void {
  callback(node);
  for (const key of ['children', 'items', 'rows', 'cells'] as const) for (const child of node[key] ?? []) visit(child, callback);
}

function renderChildren(nodes: AstNode[], context: Context, blocks = false): string {
  const rendered = nodes.filter((node) => node.type !== 'frontmatter').map((node, index) => {
    context.path.push(`${node.type}[${index}]`);
    const value = blocks || BLOCK_TYPES.has(node.type) ? renderBlock(node, context) : renderInline(node, context);
    context.path.pop();
    return value;
  }).filter(Boolean);
  return blocks ? `${rendered.join('\n\n')}\n` : rendered.join('');
}

function renderBlock(node: AstNode, context: Context): string {
  switch (node.type) {
    case 'document': return renderChildren(node.children ?? [], context, true);
    case 'frontmatter': case 'footnote': case 'link_reference_definition': case 'abbreviation_def': case 'citation_definition': return '';
    case 'heading': return heading(node, context);
    case 'paragraph': return renderChildren(node.children ?? [], context);
    case 'block_quote': return environment('quote', renderChildren(node.children ?? [], context, true));
    case 'list': return list(node, context);
    case 'definition_list': return definitionList(node, context);
    case 'code_block': return codeBlock(node, context);
    case 'table': return table(node, context);
    case 'figure': return figure(node, context);
    case 'image': return `\\begin{center}${imageCommand(node, context)}\\end{center}`;
    case 'list_item': return `\\item ${renderChildren(node.children ?? [], context, true).trim()}`;
    case 'definition_term': return renderChildren(node.children ?? [], context);
    case 'definition_description': return renderChildren(node.children ?? [], context, true);
    case 'table_row': case 'table_cell': return renderChildren(node.children ?? [], context);
    case 'figure_group': return figureGroup(node, context);
    case 'admonition': return admonition(node, context);
    case 'div': return div(node, context);
    case 'line_block': return environment('verse', renderChildren(node.children ?? [], context).replaceAll('\n', '\\\\\n'));
    case 'raw_block': return raw(node, context, true);
    case 'thematic_break': return '\\par\\noindent\\rule{\\linewidth}{0.4pt}\\par';
    case 'comment': diagnostic(context, node, 'comment-dropped', 'Comments are not printed.', 'dropped'); return '';
    default:
      if (!BLOCK_TYPES.has(node.type)) return renderInline(node, context);
      diagnostic(context, node, 'unsupported-block', `Unsupported block ${node.type} was preserved as readable text.`, 'degraded');
      return environment('quote', `\\texttt{${escapeLatex(`[${node.type}]`)}} ${renderChildren(node.children ?? [], context)}`);
  }
}

function renderInline(node: AstNode, context: Context): string {
  const content = () => renderChildren(node.children ?? [], context);
  switch (node.type) {
    case 'text': case 'escaped_text': return escapeLatex(String(node.value ?? ''));
    case 'emphasis': return command('emph', content());
    case 'strong': return command('textbf', content());
    case 'underline': return command('uline', content());
    case 'strike': case 'delete': return command('sout', content());
    case 'highlight': return command('hl', content());
    case 'insert': return command('uline', content());
    case 'subscript': return `\\textsubscript{${content()}}`;
    case 'superscript': return `\\textsuperscript{${content()}}`;
    case 'code': case 'literal_inline': return `\\texttt{${escapeLatex(String(node.value ?? plain(node)))}}`;
    case 'math': return math(node, context);
    case 'link': return `\\href{${escapeUrl(String(node.href ?? ''))}}{${content()}}`;
    case 'autolink': return `\\url{${escapeUrl(String(node.href ?? node.value ?? ''))}}`;
    case 'image': return inlineImage(node, context);
    case 'footnote_ref': return footnoteReference(node, context);
    case 'inline_footnote': return `\\footnote{${renderChildren((node.inline as AstNode[] | undefined) ?? [], context)}}`;
    case 'citation': return citation(node, context);
    case 'citation_group': return citationGroup(node, context);
    case 'heading_ref': return `\\cref{${safeLabel(String(node.target ?? node.id ?? plain(node)))}}`;
    case 'caption_number': return typeof node.n === 'number' ? String(node.n) : '';
    case 'hard_break': return '\\\\';
    case 'soft_break': return '\n';
    case 'raw_inline': return raw(node, context, false);
    case 'comment': case 'critic_comment': diagnostic(context, node, 'comment-dropped', 'Comments are not printed.', 'dropped'); return '';
    case 'mention': return `@${escapeLatex(String(node.user ?? node.name ?? ''))}`;
    case 'tag': {
      const name = String(node.name ?? '');
      const action = node.attrs?.indexRange === 'start' ? '|(' : node.attrs?.indexRange === 'end' ? '|)' : typeof node.attrs?.see === 'string' ? `|see{${escapeIndex(node.attrs.see)}}` : '';
      const indexName = typeof node.attrs?.indexName === 'string' && context.options.indexes?.includes(node.attrs.indexName) ? `[${safeLabel(node.attrs.indexName)}]` : '';
      return `\\#${escapeLatex(name)}${context.options.index ? `\\index${indexName}{${escapeIndex(name)}${action}}` : ''}`;
    }
    case 'symbol': return escapeLatex(String(node.value ?? node.name ?? ''));
    case 'abbreviation': {
      const abbr = String(node.abbr ?? '');
      return context.options.glossaries && context.abbreviations.has(abbr) ? `\\gls{${safeLabel(abbr)}}` : `\\textsc{${escapeLatex(abbr)}}`;
    }
    case 'span': case 'inline_extension': return content();
    case 'smart_punctuation': return escapeLatex(String(node.value ?? ''));
    case 'substitution': return escapeLatex(String(node.newText ?? ''));
    default:
      diagnostic(context, node, 'unsupported-inline', `Unsupported inline ${node.type} was flattened.`, 'degraded');
      return content() || escapeLatex(String(node.value ?? ''));
  }
}

function heading(node: AstNode, context: Context): string {
  const level = Math.max(1, Math.min(6, Number(node.level ?? 1)));
  const book = context.options.documentClass === 'book' || context.options.documentClass === 'report' || context.options.documentClass === 'thesis';
  const names = book ? ['chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'] : ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph', 'subparagraph'];
  const name = names[level - 1] ?? 'paragraph';
  const star = context.options.numberedHeadings ? '' : '*';
  const id = node.id ?? node.attrs?.id;
  const label = id ? `\\label{${safeLabel(String(id))}}` : '';
  return `\\${name}${star}{${renderChildren(node.children ?? [], context)}}${label}`;
}

function list(node: AstNode, context: Context): string {
  const ordered = node.ordered === true;
  const name = ordered ? 'enumerate' : 'itemize';
  const start = ordered && typeof node.start === 'number' && node.start !== 1 ? `\n\\setcounter{enumi}{${node.start - 1}}` : '';
  const items = (node.items ?? node.children ?? []).map((item) => {
    const task = item.checked !== undefined || item.taskState !== undefined;
    const marker = task ? (item.checked === true ? '$\\boxtimes$ ' : '$\\square$ ') : '';
    return `\\item ${marker}${renderChildren(item.children ?? [], context, true).trim()}`;
  }).join('\n');
  return `\\begin{${name}}${start}\n${items}\n\\end{${name}}`;
}

function definitionList(node: AstNode, context: Context): string {
  const children = node.items ?? node.children ?? [];
  let value = '\\begin{description}\n';
  let terms: AstNode[] = [];
  for (const item of children) {
    if (item.type === 'definition_term') { terms.push(item); continue; }
    const label = terms.map((term) => renderChildren(term.children ?? [], context)).join('; ');
    value += `\\item[${label}] ${renderChildren(item.children ?? [], context, true).trim()}\n`;
    terms = [];
  }
  for (const term of terms) value += `\\item[${renderChildren(term.children ?? [], context)}]\n`;
  return `${value}\\end{description}`;
}

function codeBlock(node: AstNode, context: Context): string {
  const value = String(node.value ?? node.content ?? plain(node));
  const languageName = String(node.lang ?? '').toLowerCase();
  const diagram = ['mermaid', 'chart', 'vega', 'plantuml'].includes(languageName);
  if (diagram) {
    diagnostic(context, node, 'diagram-source-degraded', `${languageName} is printed as source; pre-render it to an image for publication.`, 'degraded');
  }
  const label = languageName ? `\\carvecodelabel{${escapeLatex(languageName)}}\n` : '';
  return `${label}\\begin{carvecode}\n${highlightCode(value, languageName)}\n\\end{carvecode}`;
}

function highlightCode(value: string, language: string): string {
  const supported = new Set(['javascript', 'js', 'typescript', 'ts', 'rust', 'python', 'py', 'java', 'c', 'cpp', 'css', 'html', 'xml', 'json', 'bash', 'sh', 'sql']);
  if (!supported.has(language)) return encodeLiteralBlock(value);
  const keywords = new Set(['as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'def', 'do', 'else', 'enum', 'export', 'false', 'fn', 'for', 'from', 'function', 'if', 'impl', 'import', 'in', 'interface', 'let', 'match', 'mod', 'new', 'null', 'pub', 'return', 'self', 'static', 'struct', 'super', 'switch', 'this', 'throw', 'trait', 'true', 'try', 'type', 'use', 'var', 'void', 'where', 'while', 'yield']);
  return value.split('\n').map((line) => {
    const tokens = line.match(/\/\/.*|#.*|--.*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|[^A-Za-z0-9_$]+/g) ?? [line];
    return tokens.map((token) => {
      const encoded = encodeLiteralBlock(token);
      if (/^(?:\/\/|#|--|\/\*)/.test(token)) return `\\textcolor{carvecomment}{${encoded}}`;
      if (/^["']/.test(token)) return `\\textcolor{carvestring}{${encoded}}`;
      if (/^\d/.test(token)) return `\\textcolor{carvenumber}{${encoded}}`;
      if (keywords.has(token)) return `\\textcolor{carvekeyword}{${encoded}}`;
      return encoded;
    }).join('');
  }).join('\\par\n');
}

function table(node: AstNode, context: Context): string {
  const rows = node.rows ?? node.children ?? [];
  const columns = Math.max(1, ...rows.map((row) => (row.cells ?? row.children ?? []).length));
  const first = rows[0];
  const columnsMetadata = (node.columns as Array<Record<string, unknown>> | undefined) ?? [];
  const alignmentNames = Array.from({ length: columns }, (_, index) => String((first?.cells ?? first?.children ?? [])[index]?.align ?? columnsMetadata[index]?.align ?? 'left'));
  const alignments = alignmentNames.map((name) => ({ left: 'l', center: 'c', right: 'r' } as Record<string, string>)[name] ?? 'l');
  const columnSpecs = columnsMetadata.map((column, index) => {
    if (typeof column.width !== 'number') return alignments[index] ?? 'l';
    const family = column.valign === 'middle' ? 'm' : column.valign === 'bottom' ? 'b' : 'p';
    const alignment = alignmentNames[index] === 'right' ? '>{\\raggedleft\\arraybackslash}' : alignmentNames[index] === 'center' ? '>{\\centering\\arraybackslash}' : '>{\\raggedright\\arraybackslash}';
    return `${alignment}${family}{${Math.max(0.01, Math.min(1, column.width))}\\linewidth}`;
  });
  while (columnSpecs.length < columns) columnSpecs.push(alignments[columnSpecs.length] ?? 'l');
  while (alignments.length < columns) alignments.push('l');
  const lines = rows.map((row, rowIndex) => {
    const cells = row.cells ?? row.children ?? [];
    const values: string[] = [];
    for (let column = 0; column < cells.length; column += 1) {
      const cell = cells[column]!;
      if (cell.span === 'rowspan') { values.push(''); continue; }
      if (cell.span === 'colspan') continue;
      let colspan = 1; while (cells[column + colspan]?.span === 'colspan') colspan += 1;
      let rowspan = 1; while ((rows[rowIndex + rowspan]?.cells ?? rows[rowIndex + rowspan]?.children ?? [])[column]?.span === 'rowspan') rowspan += 1;
      let rendered = renderChildren(cell.children ?? [], context);
      if (rowspan > 1) rendered = `\\multirow{${rowspan}}{*}{${rendered}}`;
      if (colspan > 1) rendered = `\\multicolumn{${colspan}}{${alignments[column]}}{${rendered}}`;
      values.push(rendered); column += colspan - 1;
    }
    return `${values.join(' & ')} \\\\${rowIndex === 0 && cells.some((cell) => cell.header === true) ? ' \\midrule' : ''}`;
  });
  const caption = Array.isArray(node.caption) ? `\\caption${Array.isArray(node.shortCaption) ? `[${renderChildren(node.shortCaption as AstNode[], context)}]` : ''}{${renderChildren(node.caption as AstNode[], context)}} \\\\n` : '';
  const explicitHeadRows = (node.rowGroups as { headRows?: number } | undefined)?.headRows;
  const headRows = typeof explicitHeadRows === 'number' ? explicitHeadRows : (rows[0]?.cells ?? []).some((cell) => cell.header) ? 1 : 0;
  const repeatedHead = headRows > 0 ? `\\toprule\n${lines.slice(0, headRows).join('\n')}\n\\bottomrule\n\\endfirsthead\n\\toprule\n${lines.slice(0, headRows).join('\n')}\n\\bottomrule\n\\endhead\n${lines.slice(headRows).join('\n')}` : `\\toprule\n${lines.join('\n')}`;
  const note = typeof node.attrs?.note === 'string' ? `\n\\multicolumn{${columns}}{l}{\\footnotesize ${escapeLatex(node.attrs.note)}} \\\\` : '';
  const renderedTable = `\\begin{longtable}{${columnSpecs.join('')}}\n${caption}${repeatedHead}${note}\n\\bottomrule\n\\end{longtable}`;
  return node.attrs?.landscape === true ? environment('landscape', renderedTable) : renderedTable;
}

function figure(node: AstNode, context: Context): string {
  const target = node.target as AstNode | undefined;
  const rendered = target ? (target.type === 'image' ? imageCommand(target, context) : renderBlock(target, context)) : renderChildren(node.children ?? [], context, true);
  const captionNodes = node.caption as AstNode[] | undefined;
  const short = Array.isArray(node.shortCaption) ? `[${renderChildren(node.shortCaption as AstNode[], context)}]` : '';
  const caption = captionNodes ? `\n\\caption${short}{${renderChildren(captionNodes, context)}}` : '';
  const id = node.id ?? node.attrs?.id;
  const label = id ? `\n\\label{${safeLabel(String(id))}}` : '';
  const placement = /^(?:h|t|b|p|!)+$/.test(String(node.attrs?.placement ?? '')) ? String(node.attrs?.placement) : 'htbp';
  return `\\begin{figure}[${placement}]\n\\centering\n${rendered}${caption}${label}\n\\end{figure}`;
}

function figureGroup(node: AstNode, context: Context): string {
  const rendered = (node.children ?? []).map((panel) => `\\begin{minipage}{0.48\\linewidth}\n\\centering\n${panel.type === 'figure' ? figureTarget(panel, context) : renderBlock(panel, context)}\n\\end{minipage}`).join('\\hfill\n');
  const caption = Array.isArray(node.caption) ? `\n\\caption{${renderChildren(node.caption as AstNode[], context)}}` : '';
  return `\\begin{figure}[htbp]\n\\centering\n${rendered}${caption}\n\\end{figure}`;
}

function figureTarget(node: AstNode, context: Context): string {
  const target = node.target as AstNode | undefined;
  const body = target ? (target.type === 'image' ? imageCommand(target, context) : renderBlock(target, context)) : '';
  const caption = Array.isArray(node.caption) ? `\n\\captionof{subfigure}{${renderChildren(node.caption as AstNode[], context)}}` : '';
  return `${body}${caption}`;
}

function admonition(node: AstNode, context: Context): string {
  const kind = String(node.kind ?? node.name ?? node.variant ?? 'remark').toLowerCase();
  const theorem = ['theorem', 'lemma', 'proposition', 'corollary', 'definition', 'proof', 'remark'].includes(kind) ? kind : 'remark';
  if (theorem !== kind) diagnostic(context, node, 'admonition-normalized', `Admonition ${kind} uses the remark environment.`, 'normalized');
  return environment(theorem, renderChildren(node.children ?? [], context, true));
}

function div(node: AstNode, context: Context): string {
  const name = String(node.name ?? node.kind ?? '');
  if (name === 'appendix' || name === 'appendices') return `\\appendix\n${renderChildren(node.children ?? [], context, true)}`;
  if (name === 'abstract' || name === 'acknowledgements') return environment(name === 'abstract' ? 'abstract' : 'quote', renderChildren(node.children ?? [], context, true));
  if (name === 'epigraph') return `\\begin{flushright}\\itshape\n${renderChildren(node.children ?? [], context, true)}\\end{flushright}`;
  if (['theorem', 'lemma', 'proposition', 'corollary', 'definition', 'proof', 'remark'].includes(name)) return environment(name, renderChildren(node.children ?? [], context, true));
  diagnostic(context, node, 'container-flattened', `Container ${name || 'div'} was flattened without its visual wrapper.`, 'degraded');
  return renderChildren(node.children ?? [], context, true);
}

function raw(node: AstNode, context: Context, block: boolean): string {
  const format = String(node.format ?? '').toLowerCase();
  const value = String(node.value ?? node.content ?? '');
  if ((format === 'latex' || format === 'tex') && context.options.allowRawLatex) return value;
  if (format === 'latex' || format === 'tex') {
    diagnostic(context, node, 'raw-latex-disabled', 'Raw LaTeX is visible but inert; enable it explicitly only for trusted input.', 'degraded');
    return block ? literalBlock(value) : `\\texttt{${escapeLatex(value)}}`;
  }
  diagnostic(context, node, 'raw-format-degraded', `Raw ${format || 'unknown'} content cannot be executed in LaTeX.`, 'degraded');
  return block ? literalBlock(value) : `\\texttt{${escapeLatex(value)}}`;
}

function math(node: AstNode, context: Context): string {
  const value = String(node.content ?? node.value ?? plain(node));
  const allowed = new Set(['frac', 'dfrac', 'tfrac', 'sqrt', 'sum', 'prod', 'int', 'iint', 'iiint', 'oint', 'lim', 'log', 'ln', 'exp', 'sin', 'cos', 'tan', 'min', 'max', 'inf', 'sup', 'det', 'gcd', 'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'varpi', 'rho', 'varrho', 'sigma', 'varsigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'mathcal', 'mathbb', 'mathfrak', 'operatorname', 'text', 'left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'cdot', 'times', 'div', 'pm', 'mp', 'le', 'leq', 'ge', 'geq', 'ne', 'neq', 'approx', 'equiv', 'in', 'notin', 'subset', 'subseteq', 'supset', 'supseteq', 'cup', 'cap', 'land', 'lor', 'neg', 'forall', 'exists', 'partial', 'nabla', 'infty', 'ell', 'hbar', 'prime', 'dots', 'ldots', 'cdots', 'vdots', 'ddots', 'overline', 'underline', 'hat', 'widehat', 'bar', 'vec', 'dot', 'ddot', 'binom']);
  const permittedEnvironments = /\\(?:begin|end)\{(?:matrix\*?|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|cases|aligned|gathered|split)\}/g;
  const commands = [...value.replace(permittedEnvironments, '').matchAll(/\\([A-Za-z@]+|.)/g)].map((match) => match[1]!);
  const unsafe = /[%#]|\^\^|\$/.test(value) || commands.some((name) => /^[A-Za-z@]+$/.test(name) && !allowed.has(name));
  if (unsafe) {
    diagnostic(context, node, 'unsafe-math-degraded', 'Potentially executable TeX in math was rendered as inert text.', 'degraded');
    return `\\texttt{${escapeLatex(value)}}`;
  }
  const id = node.attrs?.id;
  if (node.display === true && id) return `\\begin{equation}\\label{${safeLabel(String(id))}}\n${value}\n\\end{equation}`;
  return node.display === true ? `\\[${value}\\]` : `\\(${value}\\)`;
}

function literalBlock(value: string): string { return `\\begin{carvecode}\n${encodeLiteralBlock(value)}\n\\end{carvecode}`; }

function inlineImage(node: AstNode, context: Context): string { return imageCommand(node, context); }
function imageCommand(node: AstNode, context: Context): string {
  const source = String(node.src ?? node.href ?? '');
  if (/^(?:https?:|data:)/i.test(source)) {
    diagnostic(context, node, 'remote-image-dropped', `Remote image ${source} must be downloaded explicitly.`, 'dropped');
    return `\\fbox{${escapeLatex(String(node.alt ?? 'image'))}}`;
  }
  const path = context.options.assetRoot && !isAbsolute(source) ? resolve(context.options.assetRoot, source) : source;
  const safePath = path.replaceAll('\\', '/').replace(/[{}%#\r\n]/g, '');
  if (safePath !== path) diagnostic(context, node, 'image-path-normalized', 'TeX-special characters were removed from the local image path.', 'normalized');
  const authoredWidth = node.attrs?.width;
  const width = typeof authoredWidth === 'number' && authoredWidth > 0 && authoredWidth <= 1 ? `${authoredWidth}\\linewidth` : typeof authoredWidth === 'string' && /^\d+(?:\.\d+)?(?:mm|cm|in|pt)$/.test(authoredWidth) ? authoredWidth : '\\linewidth';
  const graphic = `\\includegraphics[width=${width}]{\\detokenize{${safePath}}}`;
  return context.options.taggedPdf ? `\\tagstructbegin[tag=Figure,alttext={${escapeLatex(String(node.alt ?? ''))}}]${graphic}\\tagstructend` : graphic;
}

function footnoteReference(node: AstNode, context: Context): string {
  const label = String(node.label ?? node.id ?? ''); const definition = context.footnotes.get(label);
  if (!definition) { diagnostic(context, node, 'footnote-unresolved', `Footnote ${label} has no definition.`, 'degraded'); return `[^${escapeLatex(label)}]`; }
  return `\\footnote{${renderChildren(definition.children ?? [], context, true).trim()}}`;
}

function citation(node: AstNode, context: Context): string {
  const key = safeLabel(String(node.key ?? node.id ?? node.label ?? 'citation'));
  context.citations.add(key);
  const prefixValue = Array.isArray(node.prefix) ? renderChildren(node.prefix as AstNode[], context) : '';
  const locator = typeof node.locatorValue === 'string' ? node.locatorValue : Array.isArray(node.locator) ? renderChildren(node.locator as AstNode[], context) : '';
  const suffixValue = Array.isArray(node.suffix) ? renderChildren(node.suffix as AstNode[], context) : '';
  const prefix = prefixValue ? `[${prefixValue}]` : '';
  const suffix = locator || suffixValue ? `[${[locator, suffixValue].filter(Boolean).join(', ')}]` : '';
  const mode = node.mode === 'integral' || node.suppressAuthor === false && node.integral === true ? 'textcite' : node.suppressAuthor === true ? 'autocite*' : 'autocite';
  return `\\${mode}${prefix}${suffix}{${key}}`;
}

function citationGroup(node: AstNode, context: Context): string {
  const citations = (node.children ?? node.items ?? []).filter((child) => child.type === 'citation');
  if (citations.length === 0) return renderChildren(node.children ?? [], context);
  return citations.map((item, index) => citation(node.mode === 'integral' && index === 0 ? { ...item, integral: true } : item, context)).join('');
}

function prepareBibliography(context: Context): void {
  const entries: string[] = [];
  for (const file of context.options.cslBibliography ?? []) {
    const path = context.options.assetRoot && !isAbsolute(file) ? resolve(context.options.assetRoot, file) : file;
    try { entries.push(cslToBiblatex(JSON.parse(readFileSync(path, 'utf8')))); }
    catch { diagnostic(context, { type: 'citation_definition' }, 'csl-import-degraded', `Could not import CSL JSON resource ${file}.`, 'degraded'); }
  }
  if (context.citations.size === 0 && entries.length === 0 && !context.options.generatedBibliography) return;
  for (const key of context.citations) {
    const definition = context.citationDefinitions.get(key);
    if (!definition) {
      if ((context.options.bibliography?.length ?? 0) === 0) {
        diagnostic(context, { type: 'citation' }, 'citation-unresolved', `Citation ${key} needs a definition or bibliography resource.`, 'degraded');
        entries.push(`@misc{${key},\n  author = {Unknown},\n  year = {n.d.},\n  note = {Unresolved Carve citation}\n}`);
      }
      continue;
    }
    const values = definition.attrs?.keyValues as Record<string, string> | undefined;
    const author = bibtex(values?.author ?? 'Unknown'); const year = bibtex(values?.year ?? 'n.d.');
    const note = bibtex(plain(definition));
    const type = ['article', 'book', 'inproceedings', 'incollection', 'thesis', 'report', 'online', 'misc'].includes(String(values?.type)) ? values!.type : 'misc';
    const fields = { author, year, title: bibtex(values?.title ?? note), journal: bibtex(values?.journal ?? ''), publisher: bibtex(values?.publisher ?? ''), doi: bibtex(values?.doi ?? ''), url: bibtex(values?.url ?? ''), note };
    entries.push(`@${type}{${key},\n${Object.entries(fields).filter(([, value]) => value).map(([name, value]) => `  ${name} = {${value}}`).join(',\n')}\n}`);
  }
  if (entries.length > 0) {
    context.options.generatedBibliography = [context.options.generatedBibliography, ...entries].filter(Boolean).join('\n\n');
  }
  if (context.options.generatedBibliography && !(context.options.bibliography ?? []).includes('carve-generated.bib')) context.options.bibliography = [...(context.options.bibliography ?? []), 'carve-generated.bib'];
}

function prepareGlossary(context: Context): void {
  if (!context.options.glossaries || context.abbreviations.size === 0) return;
  context.options.generatedGlossary = [...context.abbreviations].map(([abbr, node]) => `\\newacronym{${safeLabel(abbr)}}{${escapeLatex(abbr)}}{${escapeLatex(String(node.expansion ?? ''))}}`).join('\n');
}

function bibtex(value: string): string { return value.replace(/[{}\\%#]/g, '').replace(/\s+/g, ' ').trim(); }

function diagnostic(context: Context, node: AstNode, code: string, message: string, fidelity: PublishingDiagnostic['fidelity']): void {
  const start = (node.pos as { start?: { line?: number; column?: number; offset?: number } } | undefined)?.start;
  context.diagnostics.push({ code, message, severity: fidelity === 'dropped' ? 'warning' : 'info', fidelity,
    confidence: 'exact', path: context.path.join('/') || node.type, ...(start ? { source: start } : {}) });
}

function command(name: string, value: string): string { return `\\${name}{${value}}`; }
function environment(name: string, value: string): string { return `\\begin{${name}}\n${value.trim()}\n\\end{${name}}`; }
function plain(node: AstNode): string { return (node.children ?? []).map((child) => String(child.value ?? plain(child))).join(''); }
function find(node: AstNode, type: string): AstNode | undefined {
  if (node.type === type) return node;
  for (const child of node.children ?? []) { const match = find(child, type); if (match) return match; }
  return undefined;
}
