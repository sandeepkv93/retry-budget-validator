import type { RetryBudgetModel, ValidationIssue, ValidationResult, OperationNode, MsRange, RetryPolicy, Backoff, AnalysisOptions, LeafNode, GroupNode } from './types.js';

const MAX_NODES = 1000;
const MAX_DEPTH = 32;
const MAX_DELAYS = 100000;

export function validateModel(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();
  const seenObjects = new Set<object>();
  
  let nodeCount = 0;
  let totalDelays = 0;

  function addIssue(pointer: string, code: string, message: string) {
    if (issues.length < 100) {
      issues.push({ pointer, code, message });
    } else if (issues.length === 100) {
      issues.push({ pointer: "", code: "TOO_MANY_ISSUES", message: "Maximum issue count reached. Truncating." });
    }
  }

  function isPlainObject(val: unknown): val is Record<string, unknown> {
    if (typeof val !== 'object' || val === null) return false;
    const proto = Object.getPrototypeOf(val);
    return proto === null || proto === Object.prototype;
  }

  function checkUnexpectedFields(val: Record<string, unknown>, allowed: Set<string>, pointer: string) {
    for (const key of Object.keys(val)) {
      if (!allowed.has(key)) {
        addIssue(`${pointer}/${escapePointer(key)}`, "UNKNOWN_FIELD", `Unexpected field '${key}'`);
      }
    }
  }

  function escapePointer(str: string) {
    return str.replace(/~/g, '~0').replace(/\//g, '~1');
  }

  function validateSafeInteger(val: unknown, pointer: string, min: number, max: number = Number.MAX_SAFE_INTEGER): number | undefined {
    if (typeof val !== 'number') {
      addIssue(pointer, "INVALID_TYPE", `Expected a number`);
      return undefined;
    }
    if (!Number.isSafeInteger(val)) {
      addIssue(pointer, "NOT_SAFE_INTEGER", `Expected a safe integer`);
      return undefined;
    }
    if (val < min || val > max) {
      addIssue(pointer, "OUT_OF_RANGE", `Value must be between ${min} and ${max}`);
      return undefined;
    }
    return val;
  }

  function validateMsRange(val: unknown, pointer: string): MsRange | undefined {
    if (!isPlainObject(val)) {
      addIssue(pointer, "INVALID_TYPE", "Expected an object for MsRange");
      return undefined;
    }
    checkUnexpectedFields(val, new Set(['min', 'max']), pointer);
    const min = validateSafeInteger(val['min'], `${pointer}/min`, 0);
    const max = validateSafeInteger(val['max'], `${pointer}/max`, 0);
    if (min !== undefined && max !== undefined && min > max) {
      addIssue(pointer, "INVALID_RANGE", `min (${min}) cannot be greater than max (${max})`);
    }
    if (min !== undefined && max !== undefined) {
      return { min, max };
    }
    return undefined;
  }

  function validateBackoff(val: unknown, pointer: string, maxAttempts: number): Backoff | undefined {
    if (!isPlainObject(val)) {
      addIssue(pointer, "INVALID_TYPE", "Expected an object for Backoff");
      return undefined;
    }
    
    const kind = val['kind'];
    if (kind === 'none') {
      checkUnexpectedFields(val, new Set(['kind']), pointer);
      return { kind: "none" };
    }
    
    const jitter = val['jitter'];
    if (jitter !== 'none' && jitter !== 'full' && jitter !== 'equal') {
      addIssue(`${pointer}/jitter`, "INVALID_ENUM", "jitter must be 'none', 'full', or 'equal'");
      return undefined;
    }
    
    if (kind === 'constant') {
      checkUnexpectedFields(val, new Set(['kind', 'delayMs', 'jitter']), pointer);
      const delayMs = validateSafeInteger(val['delayMs'], `${pointer}/delayMs`, 0);
      if (delayMs !== undefined) return { kind, delayMs, jitter };
    } else if (kind === 'exponential') {
      checkUnexpectedFields(val, new Set(['kind', 'initialDelayMs', 'multiplier', 'capDelayMs', 'jitter']), pointer);
      const initialDelayMs = validateSafeInteger(val['initialDelayMs'], `${pointer}/initialDelayMs`, 0);
      const multiplier = validateSafeInteger(val['multiplier'], `${pointer}/multiplier`, 1, 1000);
      const capDelayMs = validateSafeInteger(val['capDelayMs'], `${pointer}/capDelayMs`, 0);
      if (initialDelayMs !== undefined && capDelayMs !== undefined && capDelayMs < initialDelayMs) {
        addIssue(pointer, "INVALID_EXPONENTIAL", "capDelayMs must be >= initialDelayMs");
      }
      if (initialDelayMs !== undefined && multiplier !== undefined && capDelayMs !== undefined) {
        return { kind, initialDelayMs, multiplier, capDelayMs, jitter };
      }
    } else if (kind === 'explicit') {
      checkUnexpectedFields(val, new Set(['kind', 'delaysMs', 'jitter']), pointer);
      const delaysMs = val['delaysMs'];
      if (!Array.isArray(delaysMs)) {
        addIssue(`${pointer}/delaysMs`, "INVALID_TYPE", "Expected an array for delaysMs");
      } else {
        const parsedDelays: number[] = [];
        let ok = true;
        for (let i = 0; i < delaysMs.length; i++) {
          const d = validateSafeInteger(delaysMs[i], `${pointer}/delaysMs/${i}`, 0);
          if (d === undefined) ok = false;
          else parsedDelays.push(d);
        }
        if (parsedDelays.length !== maxAttempts - 1) {
          addIssue(`${pointer}/delaysMs`, "INVALID_LENGTH", `Explicit delaysMs length must be exactly maxAttempts - 1 (${maxAttempts - 1})`);
          ok = false;
        }
        if (ok) return { kind, delaysMs: parsedDelays, jitter };
      }
    } else {
      addIssue(`${pointer}/kind`, "INVALID_ENUM", "Unknown backoff kind");
    }
    return undefined;
  }

  function validateNode(val: unknown, pointer: string, depth: number): OperationNode | undefined {
    if (depth > MAX_DEPTH) {
      addIssue(pointer, "MAX_DEPTH_EXCEEDED", `Exceeded maximum tree depth of ${MAX_DEPTH}`);
      return undefined;
    }
    nodeCount++;
    if (nodeCount > MAX_NODES) {
      addIssue(pointer, "MAX_NODES_EXCEEDED", `Exceeded maximum node count of ${MAX_NODES}`);
      return undefined;
    }

    if (!isPlainObject(val)) {
      addIssue(pointer, "INVALID_TYPE", "Expected an object for Node");
      return undefined;
    }

    if (seenObjects.has(val)) {
      addIssue(pointer, "REFERENCE_CYCLE", "Cycle or shared object reference detected");
      return undefined;
    }
    seenObjects.add(val);

    const id = val['id'];
    if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(id) || id.length > 64) {
      addIssue(`${pointer}/id`, "INVALID_ID", "id must be 1-64 ASCII characters matching ^[A-Za-z][A-Za-z0-9_-]*$");
    } else {
      if (seenIds.has(id)) {
        addIssue(`${pointer}/id`, "DUPLICATE_ID", `Duplicate node id '${id}'`);
      }
      seenIds.add(id);
    }

    let label = val['label'];
    if (label !== undefined) {
      if (typeof label !== 'string' || [...label].length > 120 || /[\x00-\x1F\x7F-\x9F]/.test(label)) {
        addIssue(`${pointer}/label`, "INVALID_LABEL", "label must be <= 120 printable Unicode characters without C0/C1 controls");
      }
    }

    const retryVal = val['retry'];
    let retry: RetryPolicy | undefined = undefined;
    if (!isPlainObject(retryVal)) {
      addIssue(`${pointer}/retry`, "INVALID_TYPE", "Expected an object for retry");
    } else {
      checkUnexpectedFields(retryVal, new Set(['maxAttempts', 'backoff']), `${pointer}/retry`);
      const maxAttempts = validateSafeInteger(retryVal['maxAttempts'], `${pointer}/retry/maxAttempts`, 1, 100000);
      if (maxAttempts !== undefined) {
        totalDelays += (maxAttempts - 1);
        if (totalDelays > MAX_DELAYS) {
          addIssue(`${pointer}/retry/maxAttempts`, "MAX_DELAYS_EXCEEDED", `Exceeded total retry delays of ${MAX_DELAYS}`);
        }
        const backoff = validateBackoff(retryVal['backoff'], `${pointer}/retry/backoff`, maxAttempts);
        if (backoff !== undefined) {
          retry = { maxAttempts, backoff };
        }
      }
    }

    const kind = val['kind'];
    if (kind === 'leaf') {
      checkUnexpectedFields(val, new Set(['id', 'label', 'kind', 'retry', 'attemptDurationMs']), pointer);
      const attemptDurationMs = validateMsRange(val['attemptDurationMs'], `${pointer}/attemptDurationMs`);
      if (typeof id === 'string' && retry && attemptDurationMs) {
        const result: any = { id, kind: 'leaf', retry, attemptDurationMs };
        if (label !== undefined) result.label = label;
        return result as LeafNode;
      }
    } else if (kind === 'sequential' || kind === 'parallel') {
      checkUnexpectedFields(val, new Set(['id', 'label', 'kind', 'retry', 'overheadMs', 'attemptBudgetMs', 'children']), pointer);
      const overheadMs = validateMsRange(val['overheadMs'], `${pointer}/overheadMs`);
      let attemptBudgetMs: number | undefined = undefined;
      if (val['attemptBudgetMs'] !== undefined) {
        attemptBudgetMs = validateSafeInteger(val['attemptBudgetMs'], `${pointer}/attemptBudgetMs`, 1);
      }
      const childrenVal = val['children'];
      const children: OperationNode[] = [];
      if (!Array.isArray(childrenVal)) {
        addIssue(`${pointer}/children`, "INVALID_TYPE", "Expected an array for children");
      } else {
        for (let i = 0; i < childrenVal.length; i++) {
          const c = validateNode(childrenVal[i], `${pointer}/children/${i}`, depth + 1);
          if (c) children.push(c);
        }
      }
      if (typeof id === 'string' && retry && overheadMs && Array.isArray(childrenVal)) {
        const result: any = { id, kind, retry, overheadMs, children };
        if (label !== undefined) result.label = label;
        if (attemptBudgetMs !== undefined) result.attemptBudgetMs = attemptBudgetMs;
        return result as GroupNode;
      }
    } else {
      addIssue(`${pointer}/kind`, "INVALID_ENUM", "kind must be 'leaf', 'sequential', or 'parallel'");
    }

    return undefined;
  }

  if (!isPlainObject(input)) {
    addIssue("", "INVALID_TYPE", "Input must be an object");
    return { valid: false, issues };
  }

  checkUnexpectedFields(input, new Set(['schemaVersion', 'deadlineMs', 'root']), "");

  if (input['schemaVersion'] !== 1) {
    addIssue("/schemaVersion", "UNSUPPORTED_VERSION", "schemaVersion must be 1");
  }

  const deadlineMs = validateSafeInteger(input['deadlineMs'], "/deadlineMs", 1);
  const root = validateNode(input['root'], "/root", 1);

  if (issues.length > 0) {
    return { valid: false, issues };
  }

  if (deadlineMs !== undefined && root !== undefined) {
    return {
      valid: true,
      model: {
        schemaVersion: 1,
        deadlineMs,
        root
      }
    };
  }

  return { valid: false, issues: [{ pointer: "", code: "UNKNOWN_ERROR", message: "Failed to validate model completely" }] };
}

export function validateAnalysisOptions(options: unknown): AnalysisOptions | undefined {
  if (options === undefined) return {};
  if (typeof options !== 'object' || options === null) return undefined;
  const opt = options as Record<string, unknown>;
  let amplificationWarningThreshold = 10;
  if (opt['amplificationWarningThreshold'] !== undefined) {
    if (typeof opt['amplificationWarningThreshold'] !== 'number' || !Number.isSafeInteger(opt['amplificationWarningThreshold']) || opt['amplificationWarningThreshold'] < 1) {
      return undefined;
    }
    amplificationWarningThreshold = opt['amplificationWarningThreshold'];
  }
  return { amplificationWarningThreshold };
}
