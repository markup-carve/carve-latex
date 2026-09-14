import type { PublishOptions } from './types.js';
import { escapeLatex } from './escape.js';
import { isAbsolute, resolve } from 'node:path';

export const DEFAULT_TEMPLATE = String.raw`\documentclass[{{paper}}]{{{documentClass}}}
\usepackage{fontspec}
\usepackage{microtype}
\usepackage[margin={{margin}}]{geometry}
\usepackage{polyglossia}
\setdefaultlanguage{ {{language}} }
\usepackage{hyperref}
\usepackage{bookmark}
\usepackage{graphicx}
\usepackage{longtable,booktabs,array,tabularx}
\usepackage{enumitem}
\usepackage{csquotes}
\usepackage{amsmath,amssymb,mathtools}
\usepackage{amsthm}
\usepackage[normalem]{ulem}
\usepackage{soul}
\usepackage{xcolor}
\usepackage{caption}
\usepackage{subcaption}
\usepackage{cleveref}
\usepackage{imakeidx}
{{indexSetup}}
{{glossarySetup}}
{{bibliographySetup}}
\hypersetup{unicode=true,hidelinks,pdfauthor={{{author}}},pdftitle={{{title}}}}
\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\newtheorem{proposition}[theorem]{Proposition}
\newtheorem{corollary}[theorem]{Corollary}
\theoremstyle{definition}\newtheorem{definition}[theorem]{Definition}
\theoremstyle{remark}\newtheorem*{remark}{Remark}
\newenvironment{carvecode}{\par\smallskip\begingroup\ttfamily\small\raggedright\setlength{\parindent}{0pt}}{\par\endgroup\smallskip}
\newcommand{\carvecodelabel}[1]{\par\smallskip\noindent\colorbox{black!8}{\scriptsize\sffamily #1}\par\nobreak}
\title{ {{title}} }
\author{ {{author}} }
\date{ {{date}} }
\begin{document}
{{titleBlock}}
{{toc}}
{{body}}
{{bibliographyPrint}}
{{glossaryPrint}}
{{indexPrint}}
\end{document}
`;

export function applyTemplate(template: string, body: string, options: Required<Pick<PublishOptions,
  'documentClass' | 'paper' | 'margin' | 'numberedHeadings' | 'tableOfContents' | 'index' | 'glossaries'
>> & PublishOptions): string {
  const bibliography = options.bibliography ?? [];
  const citeStyle = /^[A-Za-z0-9_-]+$/.test(String(options.citeStyle ?? '')) ? options.citeStyle : undefined;
  const replacements: Record<string, string> = {
    documentClass: options.documentClass === 'thesis' ? 'report' : options.documentClass,
    paper: options.paper,
    margin: escapeLatex(options.margin),
    language: languageName(options.lang ?? 'en'),
    title: escapeLatex(options.title ?? ''),
    author: escapeLatex(options.author ?? ''),
    date: escapeLatex(options.date ?? ''),
    titleBlock: options.title ? '\\maketitle' : '',
    toc: options.tableOfContents ? '\\tableofcontents\\clearpage' : '',
    body,
    indexSetup: options.index ? '\\makeindex' : '',
    indexPrint: options.index ? '\\printindex' : '',
    glossarySetup: options.glossaries ? '\\usepackage[acronym]{glossaries-extra}\\makeglossaries' : '',
    glossaryPrint: options.glossaries ? '\\printglossaries' : '',
    bibliographySetup: bibliography.length || options.generatedBibliography
      ? `${options.generatedBibliography ? `\\begin{filecontents*}[overwrite]{carve-generated.bib}\n${options.generatedBibliography}\n\\end{filecontents*}\n` : ''}\\usepackage[backend=biber${citeStyle ? `,style=${citeStyle}` : ''}]{biblatex}\n${bibliography.map((file) => `\\addbibresource{${latexPath(file === 'carve-generated.bib' ? file : resolveAsset(file, options.assetRoot))}}`).join('\n')}`
      : '',
    bibliographyPrint: bibliography.length || options.generatedBibliography ? '\\printbibliography' : '',
  };
  return template.replace(/\{\{([A-Za-z]+)\}\}/g, (_, key: string) => replacements[key] ?? '');
}

function resolveAsset(value: string, root?: string): string { return root && !isAbsolute(value) ? resolve(root, value) : value; }
function latexPath(value: string): string { return `\\detokenize{${value.replaceAll('\\', '/').replace(/[{}%#\r\n]/g, '')}}`; }

function languageName(lang: string): string {
  return ({ en: 'english', de: 'german', fr: 'french', es: 'spanish', it: 'italian', pt: 'portuguese' } as Record<string, string>)[lang] ?? lang;
}
