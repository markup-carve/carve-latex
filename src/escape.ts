const TEXT_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&',
  '#': '\\#', '%': '\\%', '_': '\\_', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}',
};

export function escapeLatex(value: string): string {
  return value.replace(/[\\{}$&#%_^~]/g, (character) => TEXT_ESCAPES[character] ?? character);
}

export function escapeUrl(value: string): string {
  return value.replace(/[{}%\\#&_]/g, (character) => character === '\\' ? '%5C' : `\\${character}`);
}

export function encodeLiteralBlock(value: string): string {
  return [...value].map((character) => {
    if (character === '\n') return '\\par\n';
    if (character === '\r') return '';
    if (character === '\t') return '\\char32{}\\char32{}\\char32{}\\char32{}';
    return `\\char"${character.codePointAt(0)!.toString(16).toUpperCase()}{}`;
  }).join('');
}

export function safeLabel(value: string): string {
  const label = value.normalize('NFKD').replace(/[^A-Za-z0-9:._-]+/g, '-').replace(/^-+|-+$/g, '');
  return label || 'untitled';
}

export function escapeIndex(value: string): string {
  return escapeLatex(value).replace(/[!@|]/g, (character) => `"${character}`);
}
