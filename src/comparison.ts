import type { AnalysisOptions, ComparisonResult } from './types.js';
import { analyze } from './analyzer.js';

export function compareModels(beforeModel: unknown, afterModel: unknown, options?: AnalysisOptions): ComparisonResult {
  const beforeRes = analyze(beforeModel, options);
  const afterRes = analyze(afterModel, options);
  
  if (beforeRes.kind === 'invalid' || afterRes.kind === 'invalid') {
    const inv: ComparisonResult = { kind: 'invalid' };
    if (beforeRes.kind === 'invalid') inv.beforeIssues = beforeRes.issues;
    if (afterRes.kind === 'invalid') inv.afterIssues = afterRes.issues;
    return inv;
  }
  
  const beforeReport = beforeRes.report;
  const afterReport = afterRes.report;
  
  const bDurMin = BigInt(beforeReport.durationMs.min);
  const aDurMin = BigInt(afterReport.durationMs.min);
  const bDurMax = BigInt(beforeReport.durationMs.max);
  const aDurMax = BigInt(afterReport.durationMs.max);
  const bOp = BigInt(beforeReport.totalOperationAttempts);
  const aOp = BigInt(afterReport.totalOperationAttempts);
  const bLeaf = BigInt(beforeReport.totalLeafAttempts);
  const aLeaf = BigInt(afterReport.totalLeafAttempts);
  const bSlack = BigInt(beforeReport.deadlineSlackMs);
  const aSlack = BigInt(afterReport.deadlineSlackMs);
  
  const beforeIds = new Set(beforeReport.nodes.map(n => n.id));
  const afterIds = new Set(afterReport.nodes.map(n => n.id));
  
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  
  const bNodes = new Map(beforeReport.nodes.map(n => [n.id, n]));
  const aNodes = new Map(afterReport.nodes.map(n => [n.id, n]));
  
  for (const n of beforeReport.nodes) {
    if (!afterIds.has(n.id)) {
      removed.push(n.id);
    } else {
      const b = bNodes.get(n.id)!;
      const a = aNodes.get(n.id)!;
      // If attempts, durations, kind, or path changes, mark as changed
      if (b.kind !== a.kind || 
          b.maxAttempts !== a.maxAttempts ||
          b.oneAttemptDurationMs.min !== a.oneAttemptDurationMs.min ||
          b.oneAttemptDurationMs.max !== a.oneAttemptDurationMs.max ||
          b.oneInvocationExhaustionMs.min !== a.oneInvocationExhaustionMs.min ||
          b.oneInvocationExhaustionMs.max !== a.oneInvocationExhaustionMs.max ||
          b.path.join('/') !== a.path.join('/')) {
        changed.push(n.id);
      }
    }
  }
  for (const n of afterReport.nodes) {
    if (!beforeIds.has(n.id)) {
      added.push(n.id);
    }
  }
  
  function fmtSigned(diff: bigint) {
    return diff > 0n ? `+${diff}` : diff.toString();
  }

  return {
    kind: 'compared',
    before: beforeReport,
    after: afterReport,
    delta: {
      durationMsMin: fmtSigned(aDurMin - bDurMin),
      durationMsMax: fmtSigned(aDurMax - bDurMax),
      totalOperationAttempts: fmtSigned(aOp - bOp),
      totalLeafAttempts: fmtSigned(aLeaf - bLeaf),
      deadlineSlackMs: fmtSigned(aSlack - bSlack)
    },
    nodeChanges: { added, removed, changed }
  };
}
