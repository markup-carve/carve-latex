import type { ExtensionDefinition } from '@markup-carve/carve';
import type { PublishOptions } from './types.js';

type CslName = { family?: string; given?: string; literal?: string };
type CslItem = { id?: string; DOI?: string; URL?: string; type?: string; title?: string; author?: CslName[]; issued?: { 'date-parts'?: number[][] }; 'container-title'?: string; publisher?: string };

export function cslToBiblatex(input: unknown): string {
  const items = Array.isArray(input) ? input as CslItem[] : [input as CslItem];
  return items.map((item, index) => {
    const key = safe(String(item.id ?? item.DOI ?? `item-${index + 1}`));
    const types: Record<string, string> = { 'article-journal': 'article', book: 'book', chapter: 'incollection', paper: 'inproceedings', thesis: 'thesis', report: 'report', webpage: 'online' };
    const author = item.author?.map((name) => name.literal ?? [name.family, name.given].filter(Boolean).join(', ')).join(' and ');
    const year = item.issued?.['date-parts']?.[0]?.[0];
    const fields = { author, year, title: item.title, journaltitle: item['container-title'], publisher: item.publisher, doi: item.DOI, url: item.URL };
    return `@${types[item.type ?? ''] ?? 'misc'}{${key},\n${Object.entries(fields).filter(([, value]) => value !== undefined).map(([name, value]) => `  ${name} = {${bib(String(value))}}`).join(',\n')}\n}`;
  }).join('\n\n');
}

export async function fetchDoiCitation(doi: string): Promise<unknown> {
  if (!/^10\.\d{4,9}\/\S+$/.test(doi)) throw new Error(`Invalid DOI: ${doi}`);
  const response = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, { headers: { Accept: 'application/vnd.citationstyles.csl+json' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`DOI lookup failed (${response.status}) for ${doi}`);
  return response.json();
}

function safe(value: string): string { return value.replace(/[^A-Za-z0-9:._-]+/g, '-').replace(/^-|-$/g, '') || 'citation'; }
function bib(value: string): string { return value.replace(/[{}\\%#]/g, '').replace(/\s+/g, ' ').trim(); }

// Citations have no core form in 0.2 (C2-I-101): `:cite[key]` is the
// C2-X-058 inline extension, and carve-js keeps its own matcher internal, so
// the host registers it. Every parse in this package goes through here, because
// a set that differs between the single-file path and the project path means
// citations that work in one and vanish in the other.
export const CITE_EXTENSION = 'carve.cite';
const CITE_ATTRIBUTES = ['locator', 'prefix', 'suffix', 'mode'] as const;

export const citeExtension: ExtensionDefinition = {
  name: CITE_EXTENSION, version: '1', matcher: { form: 'inline', name: 'cite' },
  props: { key: 'string', locator: 'string', prefix: 'string', suffix: 'string', mode: 'string' }, slots: {}, children: 'none',
  transform: (claim) => {
    if (claim.form !== 'inline') return null;
    const key = claim.children.map((child) => ('value' in child && typeof child.value === 'string' ? child.value : '')).join('').trim();
    const props: Record<string, string> = { key };
    for (const [name, value] of claim.attrs?.keyValues ?? []) if ((CITE_ATTRIBUTES as readonly string[]).includes(name)) props[name] = value;
    return { type: 'inline_extension', name: CITE_EXTENSION, version: '1', children: [], props, fallback: [{ type: 'text', value: key }] };
  },
};

// The options stay in the signature so a later extension can depend on them;
// CSL files are read by renderAst, which owns the bibliography.
export function carveExtensions(_options: PublishOptions = {}): ExtensionDefinition[] {
  return [citeExtension];
}
