import { parse as parseYaml } from 'yaml';
import type { AstNode, PublishOptions } from './types.js';

export function readMetadata(document: AstNode): Record<string, unknown> {
  const frontmatter = document.children?.find((node) => node.type === 'frontmatter');
  if (!frontmatter || typeof frontmatter.content !== 'string') return {};
  try {
    const value = parseYaml(frontmatter.content);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function metadataOptions(metadata: Record<string, unknown>): PublishOptions {
  const strings = (key: string): string | undefined => typeof metadata[key] === 'string' ? metadata[key] : undefined;
  const list = (key: string): string[] | undefined => {
    const value = metadata[key];
    if (typeof value === 'string') return [value];
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
  };
  const options: PublishOptions = {};
  const assign = (key: 'title' | 'author' | 'date' | 'lang' | 'margin' | 'citeStyle', value: string | undefined) => {
    if (value !== undefined) options[key] = value;
  };
  assign('title', strings('title')); assign('author', strings('author')); assign('date', strings('date'));
  assign('lang', strings('lang')); assign('margin', strings('margin')); assign('citeStyle', strings('citationStyle'));
  const bibliography = list('bibliography'); if (bibliography) options.bibliography = bibliography;
  if (metadata.tableOfContents === true) options.tableOfContents = true;
  if (metadata.index === true) options.index = true;
  if (metadata.glossaries === true) options.glossaries = true;
  return options;
}
