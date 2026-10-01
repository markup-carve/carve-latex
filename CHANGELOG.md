# Changelog

Notable changes to `@markup-carve/carve-latex`.

## [Unreleased]

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
