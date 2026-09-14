import type { PublishingReport } from './types.js';

export function reportToSarif(report: PublishingReport, source = 'document.crv'): object {
  return { version: '2.1.0', $schema: 'https://json.schemastore.org/sarif-2.1.0.json', runs: [{
    tool: { driver: { name: 'carve-latex', informationUri: 'https://github.com/markup-carve/carve-latex' } },
    results: report.diagnostics.map((item) => ({ ruleId: item.code, level: item.severity === 'error' ? 'error' : item.severity === 'warning' ? 'warning' : 'note',
      message: { text: item.message }, locations: item.source ? [{ physicalLocation: { artifactLocation: { uri: source }, region: { startLine: item.source.line ?? 1, startColumn: item.source.column ?? 1 } } }] : [] })),
  }] };
}

export function reportFails(report: PublishingReport, threshold: 'normalized' | 'degraded' | 'dropped'): boolean {
  const ranks = { preserved: 0, normalized: 1, degraded: 2, dropped: 3 };
  return report.diagnostics.some((item) => ranks[item.fidelity] >= ranks[threshold]);
}
