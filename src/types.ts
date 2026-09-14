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
}

export interface PublishingReport {
  schemaVersion: 2;
  sourceFormat: 'carve-ast';
  targetFormat: 'latex';
  diagnostics: PublishingDiagnostic[];
}

export type DocumentClass = 'article' | 'report' | 'book' | 'thesis';

export interface PublishOptions {
  documentClass?: DocumentClass;
  template?: string;
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
  glossaries?: boolean;
  generatedBibliography?: string;
  strict?: boolean;
  allowRawLatex?: boolean;
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
}

export interface CompileResult extends RenderResult {
  pdfPath: string;
  texPath: string;
  commands: string[][];
}
