import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { citations } from '@markup-carve/carve';
import type { CarveExtension, CslEntry } from '@markup-carve/carve';
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

// Citations are Tier-2 and off in the engine by default, so without this the
// `[@key]` spelling stays literal text and the renderer's cite path is
// unreachable. Every parse in this package goes through here, because a set
// that differs between the single-file path and the project path means
// citations that work in one and vanish in the other.
export function carveExtensions(options: PublishOptions = {}): CarveExtension[] {
  const pool = cslPool(options);
  return [citations(pool.length > 0 ? { bibliography: pool } : undefined)];
}

// The engine resolves a key against in-document definitions first and this
// pool second, and does no file I/O of its own, so the host reads the files.
// An unreadable one is reported by renderAst as `csl-import-degraded`.
function cslPool(options: PublishOptions): CslEntry[] {
  const entries: CslEntry[] = [];
  for (const file of options.cslBibliography ?? []) {
    const path = options.assetRoot && !isAbsolute(file) ? resolve(options.assetRoot, file) : file;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
      if (entry && typeof (entry as CslEntry).id === 'string') entries.push(entry as CslEntry);
    }
  }
  return entries;
}
