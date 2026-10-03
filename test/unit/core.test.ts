import { describe, it, expect } from 'vitest';
import { analyze, compareModels } from '../../src/index.js';

describe('Golden acceptance fixtures', () => {
  it('G01: One attempt', () => {
    const model = {
      schemaVersion: 1,
      deadlineMs: 100,
      root: {
        id: "r",
        kind: "leaf",
        attemptDurationMs: { min: 100, max: 100 },
        retry: { maxAttempts: 1, backoff: { kind: "none" } }
      }
    };
    const res = analyze(model) as any;
    expect(res.kind).toBe("analyzed");
    expect(res.report.durationMs.max).toBe("100");
    expect(res.report.durationMs.min).toBe("100");
    expect(res.report.totalLeafAttempts).toBe("1");
    expect(res.report.totalOperationAttempts).toBe("1");
    expect(res.report.budgetStatus).toBe("fits");
    expect(res.report.deadlineSlackMs).toBe("0");
    expect(res.report.findings.length).toBe(0);
  });

  it('G02: Constant backoff', () => {
    const model = {
      schemaVersion: 1,
      deadlineMs: 1100,
      root: {
        id: "r",
        kind: "leaf",
        attemptDurationMs: { min: 200, max: 200 },
        retry: { maxAttempts: 4, backoff: { kind: "constant", delayMs: 100, jitter: "none" } }
      }
    };
    const res = analyze(model) as any;
    expect(res.kind).toBe("analyzed");
    expect(res.report.durationMs.max).toBe("1100");
    expect(res.report.totalLeafAttempts).toBe("4");
    expect(res.report.totalOperationAttempts).toBe("4");
    expect(res.report.deadlineSlackMs).toBe("0");
    expect(res.report.nodes[0].perInvocationBackoffMs.max).toBe("300");
  });

  it('G03: Three layers, 64 leaf attempts', () => {
    const model = {
      schemaVersion: 1,
      deadlineMs: 10000,
      root: {
        id: "R",
        kind: "sequential",
        overheadMs: { min: 0, max: 0 },
        retry: { maxAttempts: 4, backoff: { kind: "constant", delayMs: 100, jitter: "none" } },
        children: [
          {
            id: "S",
            kind: "sequential",
            overheadMs: { min: 0, max: 0 },
            retry: { maxAttempts: 4, backoff: { kind: "constant", delayMs: 50, jitter: "none" } },
            children: [
              {
                id: "L",
                kind: "leaf",
                attemptDurationMs: { min: 100, max: 100 },
                retry: { maxAttempts: 4, backoff: { kind: "constant", delayMs: 25, jitter: "none" } }
              }
            ]
          }
        ]
      }
    };
    const res = analyze(model) as any;
    expect(res.report.durationMs.max).toBe("8500");
    expect(res.report.totalOperationAttempts).toBe("84");
    expect(res.report.totalLeafAttempts).toBe("64");
    expect(res.report.leafAmplification.numerator).toBe("64");
    expect(res.report.leafAmplification.denominator).toBe("1");
    expect(res.report.deadlineSlackMs).toBe("1500");
    expect(res.report.budgetStatus).toBe("fits");
    
    // Disable R retries:
    const cfR = res.report.retryAttribution.find((a: any) => a.nodeId === "R");
    expect(cfR.reductionDurationMs).toBe("6450");
    expect(cfR.reductionLeafAttempts).toBe("48");
    expect(cfR.reductionOperationAttempts).toBe("63");
    
    // Disable S retries:
    const cfS = res.report.retryAttribution.find((a: any) => a.nodeId === "S");
    expect(cfS.reductionDurationMs).toBe("6300");
    
    // Disable L retries:
    const cfL = res.report.retryAttribution.find((a: any) => a.nodeId === "L");
    expect(cfL.reductionDurationMs).toBe("6000");
  });

  // Just check validation works for now
});
