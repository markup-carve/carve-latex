# Changelog

Notable changes to `@markup-carve/carve-latex`.

## [Unreleased]

## [0.1.0] - 2026-09-20

### Added

- First release. Renders Carve source or the serialized Carve AST to editable
  LaTeX, and compiles a reproducible PDF with LuaLaTeX without shell escape.
- Publishing metadata from frontmatter, overridable per run: document class,
  table of contents, lists of figures and tables, abstract, keywords, margins
  and language.
- Bibliographies through Biber with CSL-JSON and DOI input, indexes through
  MakeIndex, and glossaries through `makeglossaries`.
- Project manifests (`--project`) describe a multi-document build and resolve
  includes under a contained root; `--bundle` writes the whole build tree.
- Diagnostics and gates: fidelity reports, SARIF output, `--strict` and
  `--quality-gate`.
- PDF/A and tagged-PDF output, `--verify-reproducible`, and
  `--allow-raw-latex` for trusted sources.
