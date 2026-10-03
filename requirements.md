# Retry Budget Validator — Implementation Requirements

Version: 1.0 specification • Date: 2026-10-03

## 1. Product and intended outcome

Build a production-quality, open-source TypeScript library and CLI that statically analyze a declared retry topology. Given attempt limits, execution duration bounds, backoff policies, and a request deadline, explain:

1. How many attempts each operation can receive for one incoming request.
2. How nested retries amplify downstream work.
3. The configured retry exhaustion duration envelope.
4. Whether that envelope exceeds a declared budget.
5. Which operations, backoffs, and retry layers contribute to the result.
6. How a proposed policy change affects demand and duration.

Working project/package name: `retry-budget-validator`. This is a placeholder, not a claim of npm name availability. Use an available scoped name if publication is later requested. CLI executable: `retry-budget`.

The first release must be complete and usable: package exports, strict runtime validation, exact arithmetic, reports, CLI, examples, documentation, tests, CI, and packaging checks. It must not execute requests or schedule retries.

## 2. Audience and use cases

- Backend engineers reviewing application + SDK + downstream retry policies.
- Platform engineers checking retry configuration in CI.
- SDK maintainers explaining the load implications of defaults.
- Reliability engineers comparing a current policy with a candidate policy.

Representative question: “My client makes four attempts; my service makes four downstream attempts per client attempt; the SDK makes four network attempts per downstream attempt. How much work is possible, and will the schedule fit within 10 seconds?”

Success means a user can install the package, model this in a short JSON file, and get an explainable answer without running a server.

## 3. Scope boundaries

### Required in v1

- A rooted operation tree with leaf, sequential, and parallel groups.
- Finite `maxAttempts`, including the first attempt.
- Zero, constant, capped exponential, and explicit backoff sequences.
- None, full, and equal jitter as declared mathematical policies.
- Exact integer arithmetic for milliseconds and attempt counts.
- Static, uncancelled exhaustion analysis and budget findings.
- Path-specific counts, amplification, critical timing path, and retry attribution.
- Deterministic library, text report, JSON report, CLI, and comparison API.
- JSON Schema corresponding to strict input validation.
- Test fixtures, independent oracle, property tests, package consumer tests.

### Explicit non-goals

- An HTTP client, retry executor, request simulator, scheduler, or rate limiter.
- Probability of success, expected attempts, percentiles, or inferred latency distributions.
- Exact attempts completed before a deadline.
- Cancellation propagation or orphaned-work simulation.
- Fail-fast branches, races, hedging, quorum, circuit breakers, shared quotas, or adaptive backoff.
- Server-supplied `Retry-After` unless represented by a supplied explicit delay sequence.
- Parsing arbitrary SDK configurations or claiming parity with their runtime behavior.
- Cyclic service graphs or shared mutable retry state.
- Automatic remediation or deployment changes.
- A website, hosted service, database, telemetry, or paid service.

List these limitations prominently in README and reports. A later adapter may translate SDK semantics into the explicit model, but v1 must not infer them.

## 4. Normative semantic contract

This section is authoritative. Do not silently choose more convenient semantics.

### 4.1 Attempts and retries

`maxAttempts = A` means A total attempts, including the initial attempt; retries = A − 1. A must be an integer from 1 to 100,000. Each invocation receives a fresh retry budget. When a parent repeats an attempt, every child invocation starts its own attempt sequence from attempt 1, including fresh backoff indexing.

### 4.2 Tree execution

Each node represents an operation with its own retry loop. The root is invoked once.

- Leaf: one attempt has the declared `attemptDurationMs` envelope.
- Sequential group: in each parent attempt, every child is invoked once, in declared order, and all child retry sequences are exhausted before the parent attempt ends.
- Parallel group: in each parent attempt, all children are invoked concurrently, and the group waits for all to settle before its attempt ends.
- Group `overheadMs` is serial work before its children on every parent attempt.
- All outcomes are modeled as retryable failures through exhaustion.
- No child is skipped because an earlier child failed. This is collect-all execution, not fail-fast.

This makes the declared exhaustion scenario coherent and computable. For a real system with different branching behavior, the result may be a conservative workload envelope rather than an attainable trace; the caller must model or interpret it accordingly.

No shared retry state, cross-request traffic, CPU contention, admission waiting, or resource contention is inferred. A user must incorporate known waiting into duration envelopes.

### 4.3 Duration bounds

`MsRange = { min: number; max: number }`. Both values are nonnegative safe integers in milliseconds, with min ≤ max. Single-point values use equal endpoints. Require ranges explicitly; no implicit string durations or floating-point conversion.

Leaf duration describes the duration of one failed attempt, including all costs the caller wants modeled (connection establishment, request execution, and timeout handling). It does not assert that a configured socket/request timeout bounds every part of the real operation.

An optional group `attemptBudgetMs` is a diagnostic constraint on one full group attempt. It is NOT a timer and does NOT cap the recursion. Likewise, `deadlineMs` is a budget used for comparison, not an enforced cancellation mechanism.

### 4.4 Why budgets must not truncate the analysis

Reports describe configured demand without cancellation. They must not use `min(exhaustionDuration, deadline)` as the exhaustion duration. They must not divide a deadline by timeout to invent attempt counts. A caller timeout can leave downstream operations running, and v1 has no cancellation semantics.

If a duration exceeds a budget, return a finding and preserve the untruncated counts and duration. Reports always include `analysisMode: "uncancelled-exhaustion"` and a clear scope note.

### 4.5 Jitter semantics

Backoff delays are integer milliseconds. Delay index k starts at 1 for the wait before attempt 2. If the nominal delay is b:

| Jitter | Minimum delay | Maximum delay |
| --- | ---: | ---: |
| `none` | b | b |
| `full` | 0 | b |
| `equal` | ceil(b / 2) | b |

These are this library's discrete policies, not universal SDK definitions. There is no RNG or sampling in the core. Bounds assume endpoints can be chosen independently. Reject decorrelated jitter and custom callbacks as unsupported.

### 4.6 Backoff formulas

For a node with A attempts, there are exactly A − 1 delays. No delay before attempt 1 and no delay after attempt A.

- `none`: every nominal delay is 0.
- `constant`: b_k = delayMs.
- `exponential`: b_k = min(capDelayMs, initialDelayMs × multiplier^(k−1)). The multiplier is an integer ≥ 1; reject fractional factors in v1.
- `explicit`: b_k = delaysMs[k−1]; the array length must equal A − 1 exactly. It has no implicit repetition or truncation.

`capDelayMs` is mandatory for exponential policy, ≥ initialDelayMs. Apply the cap before deriving jitter bounds. Calculate with BigInt, without Number exponentiation. Stop growing the nominal value once capped. initialDelayMs = 0 is valid and stays zero regardless of multiplier.

## 5. Input contract

Provide exported readonly types equivalent to the following. Avoid changing field meanings. Implementation may split types across files.

```typescript
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
```

Node IDs must be globally unique, 1–64 ASCII characters, matching `[A-Za-z][A-Za-z0-9_-]*`. Labels are optional printable text, ≤ 120 Unicode code points, no C0/C1 controls or terminal escape characters. Budget and time numbers must be safe integers; deadline and attempt budgets must be positive. Multiplier must be a safe integer from 1 to 1,000. Explicit delays and all time fields may be zero where not explicitly positive.

No unknown fields, coercion, defaults inside model input, inherited required properties, accessors, functions, Date objects, class instances, or array holes. Accept plain data objects with Object.prototype or null prototype; never invoke getters during validation. Prototype inspection is allowed; reflection failures from hostile proxies are caught as invalid input, not trusted. Do not claim to sandbox arbitrary JavaScript objects.

Limits: ≤ 1,000 nodes, root depth 1 and maximum depth 32, ≤ 100,000 total retry delays across nodes (`sum(A−1)`), JSON input ≤ 1 MiB in CLI. Count repeated object references as invalid even if IDs differ: tree input must not be a DAG or cycle. Validate structure before arithmetic. Enforce limits during traversal, not after unbounded recursion or allocation.

Runtime unknown input must never cause arithmetic on unvalidated numbers. Validation issues include stable `code`, RFC 6901 JSON pointer, and human-readable `message`. Escape `~` and `/` correctly. Gather independent issues deterministically where safe; after hitting a structural limit, stop that subtree. Cap issues at 100 with a final truncation issue. The exact issue ordering must be documented and tested.

## 6. Analysis mathematics

All aggregate counts, durations, and arithmetic use BigInt. Report their JSON forms as canonical nonnegative decimal strings. No Infinity, NaN, scientific notation, or precision loss. Input values remain JSON numbers subject to safe-integer checks.

For node n:

- A(n): own attempt limit.
- Bmin(n), Bmax(n): sums of its A−1 delay lower/upper bounds.
- Umin(n), Umax(n): duration of one attempt, including children.
- Tmin(n), Tmax(n): duration of one full invocation, including retries.

Recurrences:

```text
Leaf:
  Umin = attemptDurationMs.min
  Umax = attemptDurationMs.max
Sequential:
  Umin = overheadMs.min + sum(Tmin(child))
  Umax = overheadMs.max + sum(Tmax(child))
Parallel:
  Umin = overheadMs.min + max(Tmin(child))
  Umax = overheadMs.max + max(Tmax(child))
All nodes:
  Tmin = A × Umin + Bmin
  Tmax = A × Umax + Bmax
```

These are exhaustion-duration bounds. `Tmin` is NOT earliest success latency; even minimum-duration analysis assumes every attempt fails and all retries occur.

Root invocations I(root) = 1. For each child c of n, I(c) = I(n) × A(n). Attempts received at n = I(n) × A(n). Child retries reset on each invocation.

Total operation attempts = sum(attempts received over every node). Leaf attempts = sum(attempts received over leaves). These are distinct metrics; never call their sum network requests without declared leaf interpretation.

Baseline leaf attempts: count of leaves when all maxAttempts are changed to 1. Aggregate leaf amplification = actual leaf attempts / baseline leaf attempts. Preserve an exact rational `{ numerator, denominator }`; do not round comparisons. Per-leaf amplification = that leaf's attempts received, because baseline is one invocation per leaf.

## 7. Public API and output contract

Export from package root:

```typescript
validateModel(input: unknown): ValidationResult;
analyze(input: unknown, options?: AnalysisOptions): AnalysisResult;
compareModels(before: unknown, after: unknown,
  options?: AnalysisOptions): ComparisonResult;
formatText(report: AnalysisReport): string;
```

`validateModel` returns `{ valid: true, model }` or `{ valid: false, issues }`. Make a validated defensive copy; mutations to the caller's input must not alter a report. Do not use a publicly forgeable validated marker to bypass checking in analyze.

`AnalysisResult` is a discriminated union:

- `{ kind: "invalid", issues }` for schema or option validation errors.
- `{ kind: "analyzed", report }` for valid models, including budget failures.

Budget failure is an analyzed result, not invalid input. Core public APIs must not throw for ordinary invalid input; documented unexpected internal programming errors may throw. No input mutation, I/O, clock, environment lookup, random calls, or process exit in core.

`AnalysisReport` must contain at least:

| Field | Meaning |
| --- | --- |
| `reportVersion` | 1 |
| `analysisMode` | `uncancelled-exhaustion` |
| `budgetStatus` | `fits`, `may-exceed`, or `exceeds` |
| `deadlineMs` | Decimal string |
| `durationMs` | `{ min, max }` decimal strings |
| `deadlineSlackMs` | Signed decimal string: deadline − Tmax |
| `totalOperationAttempts` | Decimal string |
| `totalLeafAttempts` | Decimal string |
| `baselineLeafAttempts` | Decimal string |
| `leafAmplification` | Exact rational strings |
| `nodes` | Preorder node reports |
| `criticalPath` | Root-to-leaf IDs contributing to upper timing bound |
| `timingContributions` | Exact decomposition of root upper duration |
| `retryAttribution` | One counterfactual per retry-enabled node |
| `findings` | Stable diagnostic records |
| `assumptions` | Scope notes described below |

Each node report contains id, optional label, kind, full root-to-node ID path, own maxAttempts (number), invocation count, total attempts, one-attempt duration range, one-invocation exhaustion range, per-invocation backoff range, and selected parallel child ID if applicable.

Budget status, with D = deadline:

- `fits` if Tmax ≤ D.
- `exceeds` if Tmin > D.
- Otherwise `may-exceed`.

Equality fits. For group attempt budgets apply the same classification to U, not T. Root status refers ONLY to the root deadline; group findings can still make CLI validation fail.

Assumptions explicitly state: all attempts fail retryably; all declared children execute; no cancellation inferred; fresh child retry budgets; no runtime contention; supplied duration envelopes trusted; jitter intervals are not probability distributions.

All arrays and findings have deterministic ordering. No timestamp, machine path, random ID, color code, or unstable map order in report JSON.

## 8. Explainability and attribution

### 8.1 Critical timing path

At parallel nodes select the child with largest Tmax, breaking ties by input order. At sequential nodes select the child with largest Tmax as the primary diagnostic path, also breaking ties by input order. Continue to a leaf.

For sequential groups this path is the largest contributor path, NOT the full critical execution chain: every child contributes to sequential elapsed time. Both docs and text labels must explain that distinction.

### 8.2 Timing decomposition

Produce one contribution per reachable leaf duration and per node overhead/backoff that contributes to the root upper bound. Traverse all sequential children but only the selected maximum-duration child at parallel nodes.

Let m start at 1. At node n:

- Add contribution `m × Bmax(n)` for node backoff if nonzero.
- Leaf: add `m × A(n) × leaf.max`.
- Group: add `m × A(n) × overhead.max` if nonzero.
- Descend relevant children with multiplier `m × A(n)`.

Contributions contain node ID/path, kind `leaf-attempt` / `group-overhead` / `backoff`, and decimal milliseconds. Their exact sum MUST equal root Tmax. Do not sum all parallel branch times into elapsed duration. Zero contributions may be omitted consistently.

### 8.3 Counterfactual retry attribution

For every node where A > 1, recompute with only that node changed to maxAttempts 1 and backoff none. Report reduction in root Tmax, total leaf attempts, and total operation attempts. All other policies remain unchanged. Explicit backoff is removed in the counterfactual; do not leave an invalid delay array.

Counterfactuals are separate alternatives, NOT additive components. State this in reports and README. A parallel node's retry removal may reduce workload but not elapsed time if another branch dominates. Critical branches may change; recompute rather than applying a local subtraction shortcut.

Attribution order: descending upper-duration reduction, then descending leaf-attempt reduction, then original preorder index. If attributions are all zero-duration reduction, still show their workload impact.

## 9. Findings and validation policy

Findings contain `code`, `severity`, `nodeId` when relevant, path, message, structured evidence, and actionable suggestion. Do not automatically rewrite user policies.

| Code | Severity | Trigger |
| --- | --- | --- |
| `DEADLINE_EXCEEDED` | error | Root Tmin > deadline |
| `DEADLINE_MAY_BE_EXCEEDED` | warning | Root Tmin ≤ deadline < Tmax |
| `ATTEMPT_BUDGET_EXCEEDED` | error | Group Umin > attemptBudget |
| `ATTEMPT_BUDGET_MAY_BE_EXCEEDED` | warning | Group Umin ≤ attemptBudget < Umax |
| `NESTED_RETRIES` | warning | A node has A > 1 and any ancestor has A > 1; once per such node |
| `HIGH_LEAF_AMPLIFICATION` | warning | Leaf attempts exceed options threshold; once per offending leaf |
| `ZERO_DELAY_RETRIES` | warning | A > 1 and every nominal delay is zero |

Full jitter with positive nominal delays is NOT a zero-delay policy merely because its lower bound is zero. Default amplification threshold is 10; equality does not warn.

Order findings by severity error before warning, then node preorder (root deadline uses root index), then lexicographic code. Suppress no budget finding because a different finding exists. Avoid warnings that claim retries are inherently wrong.

Stable invalid-input codes must cover missing/unknown fields, invalid types, invalid ranges, duplicate IDs, cycles/shared references, unsupported schema version, invalid backoff length, resource limits, and invalid options. Define a documented exported union. CLI parse errors are distinct from model issues.

## 10. Model comparison

`compareModels` validates and analyzes both models. Return `{ kind: "invalid", beforeIssues, afterIssues }` if either is invalid; otherwise `{ kind: "compared", before, after, delta, nodeChanges }`.

Deltas are after − before, signed decimal strings for min duration, max duration, total attempts, leaf attempts, and deadline slack. Include status transitions. Do not subtract rational amplification using floating-point values; either return an exact signed rational delta or present the two exact ratios.

Match nodes by globally unique ID. Return added, removed, and changed nodes in a documented stable order (before preorder followed by after-only IDs). Expose changes in attempts and duration; identify kind/path changes. No requirement to infer semantic equivalence of renamed nodes. Models may differ in topology and deadline.

## 11. CLI contract

```bash
retry-budget analyze model.json
retry-budget analyze model.json --json
retry-budget analyze - --json < model.json
retry-budget analyze model.json --strict
retry-budget compare before.json after.json --json
retry-budget --help
retry-budget --version
```

- `--strict`: warnings also fail the check.
- `--amplification-threshold <integer>`: overrides default 10.
- `--json`: output the exact public API result envelope, not a separate invented shape.
- Text analyze output includes mode, root deadline/status, duration range, leaf/operation attempts, exact amplification, path table, findings, timing contributors, and top retry counterfactuals.
- Compare text shows before/after metrics, signed deltas, and status transitions.
- For compare, at most one input path may be `-`; reject both stdin inputs.
- Exit 0: valid analyzed report with no error finding; warnings allowed unless strict.
- Exit 1: valid model with error findings or strict warning failure. Compare bases this on AFTER report.
- Exit 2: invalid model/options, bad JSON, input too large, unreadable file, unsupported CLI syntax.
- Exit 3: unexpected internal failure; concise message on stderr, no misleading valid report.
- JSON result to stdout for model validation errors as well as success. Operational/usage failures go to stderr and leave stdout empty.
- No debug logs, colors, or progress output mixed into JSON. Text is also uncolored by default.
- Resolve file paths as local paths; never fetch URLs. Enforce byte limit before parsing and while reading stdin. Correctly handle UTF-8, empty input, and optional leading UTF-8 BOM.
- No prompts, shell execution, or external network requests.

## 12. Golden acceptance fixtures

Use fixtures as independent acceptance values. Times below are milliseconds. Abbreviations describe actual JSON fixtures to create, not alternate accepted input syntax.

### G01: One attempt

Leaf root: A=1, duration [100,100], backoff none, deadline 100.
Expected: duration [100,100], leaf attempts 1, operation attempts 1, status fits, slack 0, no findings.

### G02: Constant backoff

Leaf root: A=4, duration [200,200], constant delay 100, jitter none, deadline 1100.
Expected: duration [1100,1100], leaf attempts 4, operation attempts 4, slack 0. Backoff sum 300. No delay after final attempt.

### G03: Three layers, 64 leaf attempts

Root sequential R: A=4, zero overhead, constant 100 with no jitter; one sequential child S: A=4, zero overhead, constant 50 with no jitter; one leaf L: A=4, duration [100,100], constant 25 with no jitter. Deadline 10,000.

Expected:

- L per invocation duration = 4×100 + 3×25 = 475.
- S per invocation duration = 4×475 + 3×50 = 2050.
- R duration = 4×2050 + 3×100 = 8500.
- R attempts 4; S invocations 4, attempts 16; L invocations 16, attempts 64.
- Total operation attempts 84; total leaf attempts 64; baseline leaf attempts 1; amplification 64/1; slack 1500; fits.
- Timing contributions: R backoff 300, S backoff 600, L backoff 1200, L execution 6400; sum 8500.
- Disable R retries: duration 2050, leaf attempts 16, operation attempts 21; reductions 6450, 48, 63.
- Disable S retries: duration 2200, leaf attempts 16, operation attempts 24; reductions 6300, 48, 60.
- Disable L retries: duration 2500, leaf attempts 16, operation attempts 36; reductions 6000, 48, 48.
- Two NESTED_RETRIES findings (S,L), one HIGH_LEAF_AMPLIFICATION finding (L).

### G04: Untruncated deadline violation

Same topology as G03, deadline 8000. Expected duration still 8500, leaf attempts still 64, status exceeds, slack −500, DEADLINE_EXCEEDED. Never clamp duration or counts.

### G05: Capped exponential

Leaf: A=5, duration [10,10], exponential initial 100, multiplier 2, cap 250, no jitter, deadline 850.
Delays [100,200,250,250], sum 800; duration [850,850], fits.

### G06: Full jitter

G05 with full jitter and deadline 500. Duration [50,850], status may-exceed, slack −350. No ZERO_DELAY_RETRIES finding.

### G07: Equal jitter, odd integer delay

Leaf A=2, duration [10,10], constant delay 5, equal jitter, deadline 24. Delay range [3,5]; duration [23,25]; may-exceed.

### G08: Sequential versus parallel

Group root A=2, overhead [5,5], constant delay 10 no jitter. Child a: A=2, duration [100,100], constant delay 20 no jitter. Child b: A=3, duration [50,50], no backoff. Deadline 1000.

- a invocation = 220; b invocation = 150.
- Sequential root = 2×(5+220+150)+10 = 760.
- Parallel root = 2×(5+max(220,150))+10 = 460.
- Either topology: root attempts 2, a attempts 4, b attempts 6; operation attempts 12, leaf attempts 10, baseline 2, amplification 10/2.
- Parallel decomposition: overhead 10 + root backoff 10 + a backoff 40 + a execution 400 = 460. Exclude b time from decomposition but retain b workload.
- Disable b retries in parallel: duration reduction 0, leaf attempts reduction 4, operation attempts reduction 4.

### G09: Critical branch switches

Parallel root A=1, zero overhead, no backoff. a: A=3, duration [100,100], no backoff. b: A=1, duration [250,250], no backoff. Root Tmax 300; selected child a. Disable a retries: Tmax 250; selected child b; reduction 50, NOT 200.

### G10: Advisory attempt budget

Sequential root A=2, zero overhead, no backoff, attemptBudget 100, single leaf child A=1 duration [150,150], deadline 1000. Root duration 300, fits root deadline; ATTEMPT_BUDGET_EXCEEDED at root. No truncation to 200 or 100.

### G11: Duration uncertainty

Leaf A=3, duration [20,100], constant 10 none; deadline 200. Duration [80,320], may-exceed. Tmin is exhaustion lower bound, not success latency.

### G12: Explicit delay list

Leaf A=4, duration [10,10], delays [0,5,15] none; deadline 60. Duration 60. Reject lists of length 2 or 4. A=1 requires [] if explicit policy chosen.

### G13: Exact counts beyond safe Number

Chain of nine nodes, each A=100, zero times, no backoff; eight groups then one leaf. Leaf attempts = 100^9 = 1000000000000000000. Root duration 0. JSON preserves exact decimal strings. Total attempts = sum(100^k, k=1..9) = 1010101010101010100. Input itself stays within limits.

### G14: Tie and boundary determinism

Equal parallel branches select first input child. A duration exactly equal to deadline fits. Leaf attempts exactly equal to warning threshold do not warn. Zero-duration attempts remain valid and finite.

### G15: Comparison

Compare G03 before with R changed to A=1/backoff none after, retaining deadline 10,000. Expected max/min duration delta −6450, leaf attempts delta −48, operation attempts delta −63, slack delta +6450, status fits → fits. Same changes must match retry attribution for R.

## 13. Verification requirements

### Unit and golden tests

- All G01–G15 expectations and findings, including stable ordering.
- Correct child reset behavior; no root-count multiplication mistake.
- Cap before jitter, odd equal-jitter rounding, factor 1, initial delay zero, constant zero.
- Invalid empty groups, IDs, duplicate IDs, schema versions, fields, NaN, Infinity, unsafe integers, negative values, decimals, array holes, malformed ranges and options.
- Cycles, repeated references, getters, prototype edge cases, excessive depth/nodes/delays, issue truncation.
- Input immutability and deterministic output.
- Zero and positive timing decomposition exactness.
- Parallel branch changes during counterfactual analysis.
- Large BigInt values and signed deltas.
- Text renderer snapshots for a few representative reports; do not make snapshots the numeric oracle.

### Independent execution oracle

Implement a test-only exhaustive enumerator for tiny trees, ≤ 3 attempts per node and bounded depth/width. It must simulate loops and explicit start/end times with independent logic, not call production recurrence helpers. Check counts and deterministic durations against production results. For tiny integer jitter ranges, enumerate supported delay endpoint assignments and compare extrema. Keep generated cases small enough for fast tests.

### Property-based tests

Use a development dependency such as fast-check. Pin a reproducible seed in CI; print seed/path on failure. Required properties:

- Tmin ≤ Tmax; counts nonnegative.
- Timing contributions sum exactly to Tmax.
- One-attempt baseline has leaf amplification exactly 1.
- Increasing a deadline changes status/slack but never counts or durations.
- Increasing duration endpoints or explicit delays cannot reduce exhaustion bounds.
- Increasing maxAttempts with a valid extended policy cannot reduce workload or bounds.
- Disabling one retry loop cannot increase duration or workload.
- Sequential composition upper duration ≥ parallel composition upper duration for identical children.
- Changing jitter none → full keeps Tmax and cannot increase Tmin.
- compare(X,X) yields zero deltas.
- compare(X,counterfactual(X,n)) matches attribution(n).

Meaningful mathematical branch coverage matters more than raw test count. Target ≥ 95% lines and ≥ 90% branches for analyzer/validator, with explicit explanation for any justified exception; do not write implementation-mirroring tests solely to meet a percentage.

### CLI and package integration

- Spawn built CLI against valid, warning, error, invalid JSON, missing file, stdin, oversized input, and comparison fixtures; assert stdout/stderr/exit independently.
- `--help` and `--version` work without reading input.
- `npm pack --dry-run` and real tarball install in temporary consumer projects.
- Verify ESM import, CommonJS require, TypeScript declaration compilation, browser bundling of core without Node builtins, and executable CLI shebang.
- Docs examples execute against built public exports and match shown values.

## 14. Engineering and packaging

- Strict TypeScript; `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; no broad `any` in arithmetic/validation paths.
- Node.js supported versions: 22 and 24, CI on both; package engine ≥22. Browser core requires BigInt support.
- ESM and CommonJS package-root exports with declaration files; correct conditional `exports`, `types`, `files`, `bin`, and `sideEffects: false` where accurate.
- Core has zero runtime dependencies. Development/build/test dependencies are allowed. CLI may also use Node builtins with a small hand-written argument parser; avoid a general framework unless justified.
- JSON Schema uses draft 2020-12, strict fields, discriminators, descriptions, recursive definitions; document constraints JSON Schema cannot express (global IDs, dynamic explicit length, reference cycles, total limits).
- Export schema via an explicit package subpath such as `retry-budget-validator/schema.json`.
- Keep Node I/O out of core exports and browser bundle.
- Scripts: build, typecheck, lint, test, test:coverage, test:integration, check, pack:check. Clean reproducible build and lockfile.
- Suggested tools: TypeScript, a suitable bundler, Vitest, fast-check, ESLint. Check official docs/current compatible releases at implementation time; no invented versions.
- Do not publish npm, push GitHub, or create remote resources without explicit authorization. Make artifacts publish-ready locally.
- MIT license with copyright holder placeholder or user identity only if supplied; never invent an organization.
- Do not put authenticated registry settings, tokens, private configuration, or personal information in the repository.

## 15. Suggested repository layout

```text
src/
  index.ts
  types.ts
  validation.ts
  arithmetic.ts
  backoff.ts
  analyzer.ts
  attribution.ts
  comparison.ts
  formatting.ts
  cli.ts
schema/retry-budget.schema.json
test/
  fixtures/
  unit/
  properties/
  oracle/
  integration/
examples/
  single-layer.json
  nested-retries.json
  parallel-fanout.json
  deadline-violation.json
  compare-before.json
  compare-after.json
  usage.ts
docs/
  semantics.md
  api.md
  recipes.md
  limitations.md
README.md
CONTRIBUTING.md
CHANGELOG.md
LICENSE
requirements.md
llm_promt.md
.github/workflows/ci.yml
```

Layout is advisory, exported behavior is normative. Avoid sprawling modules for trivial functions; keep test oracle independent. Limit counterfactual work to O(nodes × (nodes + total delays)) under stated limits; do not expand full execution traces. Cache immutable local backoff sums across counterfactuals when safe. Never allocate arrays proportional to multiplicative downstream attempt counts.

## 16. Documentation deliverables

README must contain problem/solution, installation placeholder, TypeScript quickstart, CLI quickstart, G03 worked example, sample output, attempts-versus-retries explanation, model semantics, limits, API links, supported runtime, license, and contribution guide.

Explain why 4×4×4=64 leaf attempts but 84 total operation attempts, and why the chosen tree shape matters. Explain input duration responsibility, collect-all groups, jitter definitions, advisory deadlines, and non-additive attribution. Do not market as a runtime safety guarantee, universal SDK validator, or novel invention without evidence.

Recipes: one retry layer; nested client/service/SDK; sequential downstream calls; parallel fan-out; deadline policy check in CI; before/after policy comparison.

Include an implementation completion report describing changes, exact commands run, results, limitations, and any blocked checks. No passing badges or screenshots for checks not actually run.

## 17. Acceptance and definition of done

The release is complete when:

1. Every normative requirement maps to implementation/tests or an explicitly recorded blocker.
2. Core math matches all golden cases and independent tiny-tree oracle.
3. Output remains exact beyond Number.MAX_SAFE_INTEGER.
4. CLI budget checks have correct exit codes and parseable JSON.
5. Both package module formats and declarations work from an installed tarball.
6. Browser core has no Node I/O dependency.
7. CI, schema, examples, API/semantics docs, license and changelog are present.
8. All required local checks pass, or environmental blockers are truthfully reported with a reproducible command.
9. There are no stubbed analysis branches, core TODOs, fake outputs, hidden timers, or unrequested remote publication.

## 18. Complete reference input and API usage

The following JSON is the canonical G03 model. Check it into examples/nested-retries.json and run documentation examples against it.

```json
{
  "schemaVersion": 1,
  "deadlineMs": 10000,
  "root": {
    "id": "client",
    "kind": "sequential",
    "overheadMs": { "min": 0, "max": 0 },
    "retry": {
      "maxAttempts": 4,
      "backoff": { "kind": "constant", "delayMs": 100, "jitter": "none" }
    },
    "children": [
      {
        "id": "service",
        "kind": "sequential",
        "overheadMs": { "min": 0, "max": 0 },
        "retry": {
          "maxAttempts": 4,
          "backoff": { "kind": "constant", "delayMs": 50, "jitter": "none" }
        },
        "children": [
          {
            "id": "sdk-request",
            "kind": "leaf",
            "attemptDurationMs": { "min": 100, "max": 100 },
            "retry": {
              "maxAttempts": 4,
              "backoff": { "kind": "constant", "delayMs": 25, "jitter": "none" }
            }
          }
        ]
      }
    ]
  }
}
```

The public usage pattern must support this code (the model is loaded separately by the consumer):

```typescript
import { analyze, formatText } from "retry-budget-validator";

const result = analyze(model);
if (result.kind === "invalid") {
  console.error(result.issues);
} else {
  console.log(result.report.totalLeafAttempts); // "64"
  console.log(result.report.durationMs.max); // "8500"
  console.log(formatText(result.report));
  console.log(JSON.stringify(result)); // No BigInt serialization error.
}
```

Example CI check: `retry-budget analyze examples/nested-retries.json --strict`. It exits 1 because nested retries and high amplification are warnings, even though the deadline fits. Without strict it exits 0. With an 8000ms deadline it exits 1 either way.

## 19. Source references and design provenance

The retry multiplication and backoff motivation aligns with established distributed-systems guidance. The specific API, collect-all model, discrete jitter conventions, and budget diagnostic semantics above are product design decisions, not a claim of standardized behavior.

- AWS Builders' Library, timeouts/retries/backoff: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
- AWS Architecture Blog, jitter: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
- AWS SDK retry behavior (illustrates why explicit attempts semantics matter): https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html
- Node.js release schedule: https://github.com/nodejs/Release

Consult primary tool documentation for build/test implementation. Do not copy source implementations or promise behavioral compatibility with an SDK without adapter-specific tests.

