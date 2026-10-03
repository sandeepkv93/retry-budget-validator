export type MsRange = Readonly<{ min: number; max: number }>;
export type Jitter = "none" | "full" | "equal";
export type Backoff =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "constant"; delayMs: number; jitter: Jitter }>
  | Readonly<{
      kind: "exponential";
      initialDelayMs: number;
      multiplier: number;
      capDelayMs: number;
      jitter: Jitter;
    }>
  | Readonly<{ kind: "explicit"; delaysMs: readonly number[]; jitter: Jitter }>;
export type RetryPolicy = Readonly<{
  maxAttempts: number;
  backoff: Backoff;
}>;
export type NodeBase = Readonly<{
  id: string;
  label?: string;
  retry: RetryPolicy;
}>;
export type LeafNode = NodeBase & Readonly<{
  kind: "leaf";
  attemptDurationMs: MsRange;
}>;
export type GroupNode = NodeBase & Readonly<{
  kind: "sequential" | "parallel";
  overheadMs: MsRange;
  attemptBudgetMs?: number;
  children: readonly OperationNode[];
}>;
export type OperationNode = LeafNode | GroupNode;
export type RetryBudgetModel = Readonly<{
  schemaVersion: 1;
  deadlineMs: number;
  root: OperationNode;
}>;
export type AnalysisOptions = Readonly<{
  amplificationWarningThreshold?: number; // default 10; safe integer >= 1
}>;

export type Finding = {
  code:
    | "DEADLINE_EXCEEDED"
    | "DEADLINE_MAY_BE_EXCEEDED"
    | "ATTEMPT_BUDGET_EXCEEDED"
    | "ATTEMPT_BUDGET_MAY_BE_EXCEEDED"
    | "NESTED_RETRIES"
    | "HIGH_LEAF_AMPLIFICATION"
    | "ZERO_DELAY_RETRIES";
  severity: "error" | "warning";
  nodeId?: string;
  path?: readonly string[];
  message: string;
  suggestion: string;
};

export type ValidationIssue = {
  code: string;
  pointer: string;
  message: string;
};

export type NodeReport = {
  id: string;
  label?: string;
  kind: "leaf" | "sequential" | "parallel";
  path: readonly string[];
  maxAttempts: number;
  invocationCount: string;
  totalAttempts: string;
  oneAttemptDurationMs: { min: string; max: string };
  oneInvocationExhaustionMs: { min: string; max: string };
  perInvocationBackoffMs: { min: string; max: string };
  selectedChildId?: string;
};

export type TimingContribution = {
  nodeId: string;
  path: readonly string[];
  kind: "leaf-attempt" | "group-overhead" | "backoff";
  durationMs: string;
};

export type RetryAttribution = {
  nodeId: string;
  path: readonly string[];
  reductionDurationMs: string;
  reductionLeafAttempts: string;
  reductionOperationAttempts: string;
};

export type AnalysisReport = {
  reportVersion: 1;
  analysisMode: "uncancelled-exhaustion";
  budgetStatus: "fits" | "may-exceed" | "exceeds";
  deadlineMs: string;
  durationMs: { min: string; max: string };
  deadlineSlackMs: string;
  totalOperationAttempts: string;
  totalLeafAttempts: string;
  baselineLeafAttempts: string;
  leafAmplification: { numerator: string; denominator: string };
  nodes: NodeReport[];
  criticalPath: string[];
  timingContributions: TimingContribution[];
  retryAttribution: RetryAttribution[];
  findings: Finding[];
  assumptions: string[];
};

export type ValidationResult =
  | { valid: true; model: RetryBudgetModel }
  | { valid: false; issues: ValidationIssue[] };

export type AnalysisResult =
  | { kind: "invalid"; issues: ValidationIssue[] }
  | { kind: "analyzed"; report: AnalysisReport };

export type ComparisonResult =
  | { kind: "invalid"; beforeIssues?: ValidationIssue[]; afterIssues?: ValidationIssue[] }
  | {
      kind: "compared";
      before: AnalysisReport;
      after: AnalysisReport;
      delta: {
        durationMsMin: string;
        durationMsMax: string;
        totalOperationAttempts: string;
        totalLeafAttempts: string;
        deadlineSlackMs: string;
      };
      nodeChanges: { added: string[]; removed: string[]; changed: string[] };
    };
