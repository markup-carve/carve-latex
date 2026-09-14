# carve-latex

Publication-grade Carve to LaTeX and PDF publishing. `carve-latex` reads Carve source or the canonical serialized Carve AST, produces editable `.tex`, and can compile a reproducible PDF with LuaLaTeX.

It complements [`carve-pdf`](https://github.com/markup-carve/carve-pdf):

| Tool | Best for | Engine |
|---|---|---|
| `carve-pdf` | Fast, web-faithful documents | HTML/CSS + Chromium |
| `carve-latex` | Books, theses, papers and publisher workflows | LaTeX + LuaLaTeX |

## Install

```bash
npm install --global @markup-carve/carve-latex
```

Generating `.tex` needs only Node.js 20+. PDF compilation additionally needs LuaLaTeX. Bibliographies use Biber; indexes use MakeIndex; glossaries use `makeglossaries` when installed.

## Use

```bash
carve-latex paper.crv --output paper.tex
carve-latex paper.crv --pdf --output paper.pdf
carve-latex book.crv --pdf --class book --toc --index \
  --bibliography references.bib --cite-style authoryear
carve --json paper.crv | carve-latex - --from-json \
  --output paper.tex --report fidelity.json
carve-latex paper.crv --strict --output paper.tex
carve-latex trusted.crv --allow-raw-latex --pdf
```

LaTeX is the default output. Compilation never enables shell escape. `SOURCE_DATE_EPOCH`, a UTC build environment and deterministic command ordering support reproducible builds.

## Publishing metadata

Frontmatter supplies document settings; CLI options override it:

```carve
---yaml
title: A Reproducible Paper
author: Ada Example
date: 2026-09-14
lang: en
bibliography: [references.bib]
citationStyle: authoryear
tableOfContents: true
index: true
margin: 25mm
---
```

Supported document classes are `article`, `report`, `book`, and `thesis`. The bundled templates are starting points for publisher-specific work. A custom template uses placeholders such as `{{body}}`, `{{title}}`, `{{bibliographySetup}}`, and `{{indexPrint}}`.

## Publication features

- section, chapter and heading numbering
- labels and cross-references through `cleveref`
- inline and display mathematics with AMS packages
- theorem, lemma, proposition, corollary, definition, proof and remark environments
- BibLaTeX/Biber citations and bibliographies
- figures, captions and local image assets
- long tables with alignment and booktabs rules
- ordered, unordered, task and definition lists
- injection-safe code blocks with compact language labels
- footnotes and inline footnotes
- table of contents, indexes and glossaries
- article, report, book and thesis output
- editable `.tex` fragments or complete documents
- deterministic, no-shell-escape LuaLaTeX builds

## Fidelity contract

Rendering returns the generated value and a versioned report:

```json
{
  "schemaVersion": 2,
  "sourceFormat": "carve-ast",
  "targetFormat": "latex",
  "diagnostics": []
}
```

Every unsupported or target-specific construct is classified as `normalized`, `degraded`, or `dropped`; supported content is silent. Remote images are not downloaded implicitly. Non-LaTeX raw blocks are rendered visibly and diagnosed. Comments are intentionally dropped and diagnosed. `--strict` turns degradation or loss into a failed build.

## Library

```js
import { renderCarve, renderAst, compileCarve } from '@markup-carve/carve-latex'

const rendered = renderCarve('# Paper\n\nText.')
const fromAst = renderAst(canonicalAst, { documentClass: 'book' })
const compiled = compileCarve(source, { bibliography: ['refs.bib'] }, { output: 'paper.pdf' })
```

The renderer consumes the canonical AST directly. It does not translate rendered HTML back into document structure.

## Security

- LuaLaTeX runs with `--no-shell-escape`.
- Remote and `data:` images are never fetched automatically.
- TeX-sensitive authored text, URLs, labels and index entries are escaped separately.
- Code and inert raw blocks are emitted as character tokens, so environment delimiters cannot escape into executable TeX.
- Potentially executable TeX primitives in math are degraded to visible text and reported.
- Raw content is passed through only when explicitly labeled `latex` or `tex` and `--allow-raw-latex` is set.
- Compilation uses argument arrays rather than a command shell.
- Canonical AST validation remains the responsibility of the Carve engine at the input boundary.

Raw LaTeX is inert by default. `--allow-raw-latex` is a trust decision; never enable it for untrusted documents.

## Development

```bash
npm ci
npm run check
npm test
npm pack --dry-run
```

CI tests Node.js 20, 22 and 24 and performs a real LuaLaTeX PDF smoke build.

## License

MIT
