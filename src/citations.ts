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
