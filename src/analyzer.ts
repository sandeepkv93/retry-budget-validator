import { computeBackoffBounds } from './backoff.js';
import type { OperationNode, AnalysisReport, NodeReport, TimingContribution, Finding, RetryAttribution, AnalysisOptions, RetryBudgetModel, AnalysisResult } from './types.js';

type NodeMetrics = {
  A: bigint;
  Bmin: bigint;
  Bmax: bigint;
  Umin: bigint;
  Umax: bigint;
  Tmin: bigint;
  Tmax: bigint;
  invocations: bigint;
  attemptsReceived: bigint;
  selectedChildId?: string;
  isLeaf: boolean;
};

import { validateModel, validateAnalysisOptions } from './validation.js';

export function analyze(input: unknown, options?: AnalysisOptions): AnalysisResult {
  const validationResult = validateModel(input);
  if (!validationResult.valid) {
    return { kind: "invalid", issues: validationResult.issues };
  }
  
  const opts = validateAnalysisOptions(options);
  if (!opts) {
    return { kind: "invalid", issues: [{ code: "INVALID_OPTIONS", pointer: "", message: "Invalid options provided" }] };
  }

  const model = validationResult.model;
  return { kind: "analyzed", report: generateReport(model, opts) };
}

function generateReport(model: RetryBudgetModel, options: AnalysisOptions): AnalysisReport {
  const nodes = new Map<string, { node: OperationNode, path: string[], metrics: NodeMetrics }>();
  const findings: Finding[] = [];
  const amplificationThreshold = BigInt(options.amplificationWarningThreshold ?? 10);
  
  // Pass 1: Bottom-up bounds (Tmin, Tmax, Umin, Umax)
  function computeBounds(n: OperationNode, path: string[]): NodeMetrics {
    const A = BigInt(n.retry.maxAttempts);
    const { min: Bmin, max: Bmax } = computeBackoffBounds(n.retry.maxAttempts, n.retry.backoff);
    let Umin = 0n;
    let Umax = 0n;
    let selectedChildId: string | undefined;

    if (n.kind === 'leaf') {
      Umin = BigInt(n.attemptDurationMs.min);
      Umax = BigInt(n.attemptDurationMs.max);
    } else {
      Umin = BigInt(n.overheadMs.min);
      Umax = BigInt(n.overheadMs.max);
      
      let sumChildTmin = 0n;
      let sumChildTmax = 0n;
      let maxChildTmin = 0n;
      let maxChildTmax = 0n;
      let maxChildId: string | undefined;

      for (const child of n.children) {
        const childMetrics = computeBounds(child, [...path, 'children', n.children.indexOf(child).toString()]);
        
        if (n.kind === 'sequential') {
          sumChildTmin += childMetrics.Tmin;
          sumChildTmax += childMetrics.Tmax;
          if (childMetrics.Tmax > maxChildTmax || (childMetrics.Tmax === maxChildTmax && !maxChildId)) {
            maxChildTmax = childMetrics.Tmax;
            maxChildId = child.id;
          }
        } else { // parallel
          if (childMetrics.Tmin > maxChildTmin) maxChildTmin = childMetrics.Tmin;
          if (childMetrics.Tmax > maxChildTmax || (childMetrics.Tmax === maxChildTmax && !maxChildId)) {
            maxChildTmax = childMetrics.Tmax;
            maxChildId = child.id;
          }
        }
      }

      if (n.kind === 'sequential') {
        Umin += sumChildTmin;
        Umax += sumChildTmax;
        selectedChildId = maxChildId;
      } else {
        Umin += maxChildTmin;
        Umax += maxChildTmax;
        selectedChildId = maxChildId;
      }

      if (n.attemptBudgetMs !== undefined) {
        const budget = BigInt(n.attemptBudgetMs);
        if (Umin > budget) {
          findings.push({
            code: "ATTEMPT_BUDGET_EXCEEDED",
            severity: "error",
            nodeId: n.id,
            path,
            message: `Group attempt duration minimum ${Umin}ms exceeds budget of ${budget}ms`,
            suggestion: "Reduce retries or envelopes in children, or increase attemptBudgetMs."
          });
        } else if (Umax > budget) {
          findings.push({
            code: "ATTEMPT_BUDGET_MAY_BE_EXCEEDED",
            severity: "warning",
            nodeId: n.id,
            path,
            message: `Group attempt duration maximum ${Umax}ms may exceed budget of ${budget}ms`,
            suggestion: "Review child durations or increase attemptBudgetMs."
          });
        }
      }
    }

    const Tmin = A * Umin + Bmin;
    const Tmax = A * Umax + Bmax;

    const metrics: NodeMetrics = { A, Bmin, Bmax, Umin, Umax, Tmin, Tmax, invocations: 0n, attemptsReceived: 0n, isLeaf: n.kind === 'leaf' };
    if (selectedChildId !== undefined) metrics.selectedChildId = selectedChildId;
    nodes.set(n.id, { node: n, path, metrics });
    
    // Check nested retries
    if (A > 1n) {
      if (path.length > 1) { // Not root, maybe ancestor has A > 1
        // We will check nested retries properly in top-down pass
      }
      
      // Check zero delay retries
      if (n.retry.backoff.kind === 'none' || (n.retry.backoff.kind === 'constant' && n.retry.backoff.delayMs === 0) || (n.retry.backoff.kind === 'explicit' && n.retry.backoff.delaysMs.every(d => d === 0))) {
        findings.push({
          code: "ZERO_DELAY_RETRIES",
          severity: "warning",
          nodeId: n.id,
          path,
          message: `Node has retries configured with zero delays between attempts`,
          suggestion: "Add delay or jitter to prevent traffic spikes."
        });
      }
    }

    return metrics;
  }

  const rootMetrics = computeBounds(model.root, ["root"]);
  
  // Pass 2: Top-down counts (invocations, attempts)
  let totalOperationAttempts = 0n;
  let totalLeafAttempts = 0n;
  let baselineLeafAttempts = 0n; // Leaves count in a 1-attempt world
  
  function computeCounts(id: string, parentInvocations: bigint, parentHasRetries: boolean) {
    const entry = nodes.get(id)!;
    const { node, path, metrics } = entry;
    const I = parentInvocations;
    metrics.invocations = I;
    metrics.attemptsReceived = I * metrics.A;
    
    totalOperationAttempts += metrics.attemptsReceived;
    if (metrics.isLeaf) {
      totalLeafAttempts += metrics.attemptsReceived;
      baselineLeafAttempts += 1n; // since I(root)=1 and baseline A=1 everywhere, leaf gets 1 invocation
      
      const leafAmp = metrics.attemptsReceived; // denominator is 1
      if (leafAmp >= amplificationThreshold && amplificationThreshold > 1n) {
        findings.push({
          code: "HIGH_LEAF_AMPLIFICATION",
          severity: "warning",
          nodeId: node.id,
          path,
          message: `Leaf amplification is ${leafAmp}x, meeting or exceeding threshold ${amplificationThreshold}`,
          suggestion: "Reduce maxAttempts in this node or its ancestors."
        });
      }
    }
    
    if (parentHasRetries && metrics.A > 1n) {
      findings.push({
        code: "NESTED_RETRIES",
        severity: "warning",
        nodeId: node.id,
        path,
        message: "Nested retries detected. Both this node and an ancestor have maxAttempts > 1",
        suggestion: "Consolidate retries at a single layer to avoid multiplicative amplification."
      });
    }
    
    const hasRetries = parentHasRetries || metrics.A > 1n;
    if (node.kind !== 'leaf') {
      for (const child of node.children) {
        computeCounts(child.id, metrics.attemptsReceived, hasRetries);
      }
    }
  }

  computeCounts(model.root.id, 1n, false);
  
  // Deadline check
  const D = BigInt(model.deadlineMs);
  let budgetStatus: AnalysisReport["budgetStatus"] = "fits";
  let slack = D - rootMetrics.Tmax;
  
  if (rootMetrics.Tmin > D) {
    budgetStatus = "exceeds";
    findings.push({
      code: "DEADLINE_EXCEEDED",
      severity: "error",
      nodeId: model.root.id,
      path: ["root"],
      message: `Root minimum duration ${rootMetrics.Tmin}ms exceeds deadline of ${D}ms`,
      suggestion: "Increase deadline or reduce retries/envelopes."
    });
  } else if (rootMetrics.Tmax > D) {
    budgetStatus = "may-exceed";
    findings.push({
      code: "DEADLINE_MAY_BE_EXCEEDED",
      severity: "warning",
      nodeId: model.root.id,
      path: ["root"],
      message: `Root maximum duration ${rootMetrics.Tmax}ms may exceed deadline of ${D}ms`,
      suggestion: "Increase deadline, reduce retries, or lower duration bounds."
    });
  }

  // Critical path & decomposition
  const criticalPath: string[] = [];
  const timingContributions: TimingContribution[] = [];
  
  function traceCriticalPath(id: string, m: bigint) {
    criticalPath.push(id);
    const entry = nodes.get(id)!;
    const { node, path, metrics } = entry;
    
    if (metrics.Bmax > 0n) {
      timingContributions.push({
        nodeId: id,
        path,
        kind: "backoff",
        durationMs: (m * metrics.Bmax).toString()
      });
    }
    
    if (node.kind === 'leaf') {
      const leafExec = m * metrics.A * BigInt(node.attemptDurationMs.max);
      if (leafExec > 0n) {
        timingContributions.push({
          nodeId: id,
          path,
          kind: "leaf-attempt",
          durationMs: leafExec.toString()
        });
      }
    } else {
      const groupExec = m * metrics.A * BigInt(node.overheadMs.max);
      if (groupExec > 0n) {
        timingContributions.push({
          nodeId: id,
          path,
          kind: "group-overhead",
          durationMs: groupExec.toString()
        });
      }
      
      const childMult = m * metrics.A;
      if (node.kind === 'sequential') {
        for (const child of node.children) {
          traceCriticalPath(child.id, childMult);
        }
      } else if (node.kind === 'parallel') {
        if (metrics.selectedChildId) {
          traceCriticalPath(metrics.selectedChildId, childMult);
        }
      }
    }
  }
  
  traceCriticalPath(model.root.id, 1n);

  // Counterfactuals
  const retryAttribution: RetryAttribution[] = [];
  for (const [id, entry] of nodes.entries()) {
    if (entry.metrics.A > 1n) {
      const { TmaxRed, leafRed, opRed } = computeCounterfactual(model.root, id, rootMetrics.Tmax, totalLeafAttempts, totalOperationAttempts);
      retryAttribution.push({
        nodeId: id,
        path: entry.path,
        reductionDurationMs: TmaxRed.toString(),
        reductionLeafAttempts: leafRed.toString(),
        reductionOperationAttempts: opRed.toString()
      });
    }
  }
  
  // Sort findings: error before warning, preorder path, then code lexicographic
  findings.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    const pathA = (a.path || []).join('/');
    const pathB = (b.path || []).join('/');
    if (pathA !== pathB) return pathA.localeCompare(pathB); // basic preorder string proxy
    return a.code.localeCompare(b.code);
  });
  
  // Sort attributions: desc duration red, desc leaf red, original preorder (we pushed in preorder)
  retryAttribution.sort((a, b) => {
    const durA = BigInt(a.reductionDurationMs);
    const durB = BigInt(b.reductionDurationMs);
    if (durA !== durB) return durA > durB ? -1 : 1;
    const leafA = BigInt(a.reductionLeafAttempts);
    const leafB = BigInt(b.reductionLeafAttempts);
    if (leafA !== leafB) return leafA > leafB ? -1 : 1;
    return 0;
  });

  const nodeReports: NodeReport[] = Array.from(nodes.values()).map(e => {
    const rep: NodeReport = {
      id: e.node.id,
      kind: e.node.kind as "leaf"|"sequential"|"parallel",
      path: e.path,
      maxAttempts: Number(e.metrics.A),
      invocationCount: e.metrics.invocations.toString(),
      totalAttempts: e.metrics.attemptsReceived.toString(),
      oneAttemptDurationMs: { min: e.metrics.Umin.toString(), max: e.metrics.Umax.toString() },
      oneInvocationExhaustionMs: { min: e.metrics.Tmin.toString(), max: e.metrics.Tmax.toString() },
      perInvocationBackoffMs: { min: e.metrics.Bmin.toString(), max: e.metrics.Bmax.toString() }
    };
    if (e.node.label !== undefined) rep.label = e.node.label;
    if (e.metrics.selectedChildId !== undefined) rep.selectedChildId = e.metrics.selectedChildId;
    return rep;
  });

  return {
    reportVersion: 1,
    analysisMode: "uncancelled-exhaustion",
    budgetStatus,
    deadlineMs: model.deadlineMs.toString(),
    durationMs: { min: rootMetrics.Tmin.toString(), max: rootMetrics.Tmax.toString() },
    deadlineSlackMs: slack.toString(),
    totalOperationAttempts: totalOperationAttempts.toString(),
    totalLeafAttempts: totalLeafAttempts.toString(),
    baselineLeafAttempts: baselineLeafAttempts.toString(),
    leafAmplification: { numerator: totalLeafAttempts.toString(), denominator: baselineLeafAttempts.toString() },
    nodes: nodeReports,
    criticalPath,
    timingContributions,
    retryAttribution,
    findings,
    assumptions: [
      "All attempts fail retryably.",
      "All declared children execute.",
      "No cancellation inferred.",
      "Fresh child retry budgets on each invocation.",
      "No runtime contention.",
      "Supplied duration envelopes trusted.",
      "Jitter intervals are not probability distributions."
    ]
  };
}

function computeCounterfactual(root: OperationNode, targetId: string, baseTmax: bigint, baseLeaf: bigint, baseOp: bigint) {
  let cfLeaf = 0n;
  let cfOp = 0n;
  
  function evalBounds(n: OperationNode): bigint {
    const isTarget = n.id === targetId;
    const A = isTarget ? 1n : BigInt(n.retry.maxAttempts);
    let Bmax = 0n;
    if (!isTarget) {
      Bmax = computeBackoffBounds(n.retry.maxAttempts, n.retry.backoff).max;
    }
    
    let Umax = 0n;
    if (n.kind === 'leaf') {
      Umax = BigInt(n.attemptDurationMs.max);
    } else {
      Umax = BigInt(n.overheadMs.max);
      let childSums = 0n;
      let childMax = 0n;
      for (const child of n.children) {
        const childTmax = evalBounds(child);
        childSums += childTmax;
        if (childTmax > childMax) childMax = childTmax;
      }
      if (n.kind === 'sequential') {
        Umax += childSums;
      } else {
        Umax += childMax;
      }
    }
    return A * Umax + Bmax;
  }
  
  const cfTmax = evalBounds(root);
  
  function evalCounts(n: OperationNode, I: bigint) {
    const isTarget = n.id === targetId;
    const A = isTarget ? 1n : BigInt(n.retry.maxAttempts);
    const attempts = I * A;
    cfOp += attempts;
    if (n.kind === 'leaf') {
      cfLeaf += attempts;
    } else {
      for (const child of n.children) {
        evalCounts(child, attempts);
      }
    }
  }
  
  evalCounts(root, 1n);
  
  return {
    TmaxRed: baseTmax - cfTmax,
    leafRed: baseLeaf - cfLeaf,
    opRed: baseOp - cfOp
  };
}
