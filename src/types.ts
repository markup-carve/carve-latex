export type AstNode = {
  type: string;
  children?: AstNode[];
  items?: AstNode[];
  rows?: AstNode[];
  cells?: AstNode[];
  attrs?: Record<string, unknown>;
  [key: string]: unknown;
};

export type Fidelity = 'preserved' | 'normalized' | 'degraded' | 'dropped';
export type Confidence = 'exact' | 'inferred' | 'fallback';

export interface PublishingDiagnostic {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  fidelity: Fidelity;
  confidence: Confidence;
  path?: string;
  source?: { line?: number; column?: number; offset?: number };
}

export interface PublishingReport {
  schemaVersion: 2;
  sourceFormat: 'carve-ast';
  targetFormat: 'latex';
  diagnostics: PublishingDiagnostic[];
  summary: Record<Fidelity, number>;
}

export type DocumentClass = 'article' | 'report' | 'book' | 'thesis';

export interface PublishOptions {
  documentClass?: DocumentClass;
  template?: string;
  preset?: 'article' | 'book' | 'thesis' | 'journal' | 'technical-report';
  assetRoot?: string;
  standalone?: boolean;
  title?: string;
  author?: string;
  date?: string;
  lang?: string;
  paper?: 'a4paper' | 'letterpaper';
  margin?: string;
  bibliography?: string[];
  citeStyle?: string;
  numberedHeadings?: boolean;
  tableOfContents?: boolean;
  index?: boolean;
  indexes?: string[];
  glossaries?: boolean;
  abstract?: string;
  acknowledgements?: string;
  dedication?: string;
  keywords?: string[];
  appendices?: boolean;
  listOfFigures?: boolean;
  listOfTables?: boolean;
  generatedBibliography?: string;
  cslBibliography?: string[];
  generatedGlossary?: string;
  strict?: boolean;
  allowRawLatex?: boolean;
  failOn?: Exclude<Fidelity, 'preserved'>;
  pdfa?: boolean;
  taggedPdf?: boolean;
  renderDiagrams?: boolean;
}

export interface RenderResult {
  value: string;
  report: PublishingReport;
  metadata: Record<string, unknown>;
}

export interface CompileOptions {
  output?: string;
  workDir?: string;
  keepIntermediate?: boolean;
  sourceDateEpoch?: number;
  runs?: number;
  qualityGate?: boolean;
  verifyReproducible?: boolean;
}

export interface CompileResult extends RenderResult {
  pdfPath: string;
  texPath: string;
  commands: string[][];
  quality: PdfQualityReport;
}

export interface PdfQualityReport {
  missingReferences: string[];
  missingCitations: string[];
  missingGlyphs: string[];
  overfullBoxes: string[];
  unembeddedFonts: string[];
  tagged?: boolean;
  pdfVersion?: string;
  reproducible?: boolean;
}

export interface ProjectManifest {
  version: 1;
  chapters: string[];
  output?: string;
  /** Set false to leave `{{ path }}` directives literal. */
  includes?: boolean;
  /** Containment root for includes. Must be absolute; defaults to the project root. */
  includeRoot?: string;
  publish?: PublishOptions;
}

export interface ProjectOptions {
  /** False disables include expansion whatever the manifest says. */
  includes?: boolean;
}

export interface IncludeDiagnostic {
  rule: string;
  message: string;
  line: number;
  column: number;
  file?: string;
}
