# Changelog

Notable changes to `@markup-carve/carve-latex`.

## [Unreleased]

## [0.1.1] - 2026-10-08

### Fixed

- **Cross-references resolve instead of compiling to `??`.** A heading without
  an attribute block got no `\label`, because only an explicit id produced one,
  while every `</#Name>` pointing at it still emitted a `\cref`. `# Plan` plus
  `See </#Plan>.` wrote `\section{Plan}` with no label and a reference to it.
  The document now goes through the engine's own resolution pass, so a heading
  is labelled with the id the engine assigns - `# 1. First` takes `s-1-First`,
  since an id may not open with a digit. markup-carve/carve-latex#18
- **A reference that resolves to nothing is written as text.** It used to emit a
  `\cref` to a label that was never written, which compiles to `??` with only a
  LaTeX warning. It is now emitted as its own source text and reported under the
  new `crossref-unresolved` diagnostic code at `degraded` fidelity. This matters
  more since carve 0.1.8: names compare case exactly, so `</#plan>` against a
  heading written `{#Plan}` resolves to nothing rather than to the
  differently-cased target. markup-carve/carve-latex#18
- **A caption number away from the label position is printed.** It was dropped
  with a `caption-number-normalized` diagnostic, where the engine renders
  `A plot 1 of values: revised` for the same source. markup-carve/carve-latex#18

### Changed

- Requires `@markup-carve/carve` 0.1.10.

## [0.1.0] - 2026-10-01

### Added

- First release. Renders Carve source or the serialized Carve AST to editable
  LaTeX, and compiles a reproducible PDF with LuaLaTeX without shell escape.
- Publishing metadata from frontmatter, overridable per run: document class,
  table of contents, lists of figures and tables, abstract, keywords, margins
  and language.
- Five document presets selected with `--preset`: article, book, thesis,
  journal and technical report. Each is compiled in CI.
- Citations written in Carve source reach BibLaTeX, with bibliographies
  through Biber from `--bibliography`, CSL-JSON (`--csl`) and DOI (`--doi`)
  input, indexes through MakeIndex, and glossaries through `makeglossaries`.
- Admonitions and theorem kinds each render their own environment and carry
  their title.
- An auto-numbered caption draws its number from LaTeX's own counter.
- Project manifests (`--project`) describe a multi-document build and resolve
  includes under a contained root; `--bundle` writes the whole build tree.
- Diagnostics and gates: fidelity reports, SARIF output with source positions,
  `--strict` and `--quality-gate`.
- PDF/A and tagged-PDF output, `--verify-reproducible`, and
  `--allow-raw-latex` for trusted sources.
