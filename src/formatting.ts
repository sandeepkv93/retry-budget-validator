import type { AnalysisReport } from './types.js';

export function formatText(report: AnalysisReport): string {
  let out = `Retry Budget Validator Report (v${report.reportVersion})\n`;
  out += `Mode: ${report.analysisMode}\n`;
  out += `Status: ${report.budgetStatus.toUpperCase()} (Slack: ${report.deadlineSlackMs}ms)\n`;
  out += `Deadline: ${report.deadlineMs}ms\n`;
  out += `Duration: ${report.durationMs.min}ms to ${report.durationMs.max}ms\n\n`;
  
  out += `Workload:\n`;
  out += `- Operation attempts: ${report.totalOperationAttempts}\n`;
  out += `- Leaf attempts: ${report.totalLeafAttempts}\n`;
  out += `- Leaf amplification: ${report.leafAmplification.numerator}/${report.leafAmplification.denominator}x\n\n`;
  
  if (report.findings.length > 0) {
    out += `Findings:\n`;
    for (const f of report.findings) {
      out += `[${f.severity.toUpperCase()}] ${f.code}`;
      if (f.nodeId) out += ` at ${f.nodeId} (${f.path?.join('.')})`;
      out += `\n  ${f.message}\n  ${f.suggestion}\n`;
    }
    out += `\n`;
  }
  
  out += `Timing Path (Critical contributors to ${report.durationMs.max}ms limit):\n`;
  for (const t of report.timingContributions) {
    out += `- ${t.durationMs.padStart(10)}ms [${t.kind}] ${t.nodeId} (${t.path.join('.')})\n`;
  }
  out += `\n`;
  
  if (report.retryAttribution.length > 0) {
    out += `Top Retry Counterfactuals (Reduction if node retries disabled):\n`;
    for (const r of report.retryAttribution.slice(0, 5)) {
      out += `- ${r.nodeId}: duration -${r.reductionDurationMs}ms, leaves -${r.reductionLeafAttempts}, total -${r.reductionOperationAttempts}\n`;
    }
    out += `\n`;
  }
  
  return out.trim() + '\n';
}
