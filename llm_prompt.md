# Antigravity implementation prompt: Retry Budget Validator

Copy this prompt into antigravity with `requirements.md` available in the target repository. The intentional filename is `llm_promt.md` as requested.

---

You are implementing a complete open-source TypeScript library and CLI named `retry-budget-validator` (working name). Read `requirements.md` in full before changing code. Implement the entire v1 contract, verify it, and produce a usable repository. Do not stop after a plan, scaffold, illustrative code, or partial MVP.

## Goal

Given a declared operation tree and retry policies, calculate exact downstream attempt amplification, exhaustion duration bounds, deadline/attempt-budget findings, explainable timing contributions, counterfactual retry attribution, and before/after policy comparisons.

Users should be able to use this from TypeScript, JavaScript ESM/CommonJS, a browser bundle of the core, and a local CLI. This is a static analyzer, not a retry executor.

## Authority and working process

1. Follow repository AGENTS.md instructions and preserve unrelated user changes.
2. Treat requirements.md as the authoritative product contract. This prompt guides execution; it does not override the requirements.
3. Inspect repository state before editing. Adapt to an existing compatible project rather than replacing it blindly. In a blank directory, create the complete package.
4. Keep requirements.md and this prompt in the repository. Do not modify requirements to make failing implementations appear compliant.
5. Make routine implementation choices autonomously. Ask only if a genuine contradiction or missing essential input cannot be resolved from these files.
6. Choose maintained compatible build/test tooling using official documentation where needed; commit a lockfile. Never invent a package version or test result.
7. Do not push GitHub, publish npm, deploy, or create external resources. Prepare everything locally. Do not require those actions for definition of done.
8. Keep a concise implementation plan and progress updates. Execute work through verification, not just planning.

## Critical semantics to preserve

Read the full semantics section; the following are the errors most likely to invalidate the product:

- maxAttempts includes attempt one. A=4 means three retries.
- Every parent attempt invokes each child with a fresh child retry budget.
- Sequential groups execute every child and collect all results, even after failure. Parallel groups wait for all children. No inferred fail-fast or race behavior.
- Every attempt fails retryably in the analyzed exhaustion scenario.
- min duration is minimum EXHAUSTION duration, not earliest success time.
- All counts and aggregate duration arithmetic use BigInt. JSON report numbers representing aggregates are decimal strings.
- A deadline or attempt budget is advisory. Never clamp times or counts to it. Do not claim to calculate work completed before cancellation.
- Duration bounds are supplied, not measured or inferred from timeout names.
- No final backoff after the last attempt. Delay index one is before attempt two.
- Exponential cap is applied before jitter. Equal jitter lower bound is ceil(delay/2).
- All arithmetic and output are deterministic; no RNG, clock, network, sleeps, or environment access in core.
- Parallel work counts sum across all children; elapsed time uses maximum child duration.
- Counterfactual attribution requires recomputation because the dominant parallel branch can change. Attribution reductions are not additive.
- Timing contributions must sum exactly to the root upper duration.
- Inputs are strictly validated before analysis. Reject unknown fields, coercion, unsafe numbers, duplicate IDs, cycles/shared references, invalid explicit-delay lengths, and resource-limit violations.

## Suggested execution phases

### Phase 1: Inspect and establish a compliance checklist

- Read AGENTS.md, requirements.md, existing package configuration, and repository status.
- Create a compact mapping from normative requirements to implementation modules and tests. Use docs/implementation-checklist.md if useful; do not produce a bureaucracy-heavy planning system.
- Confirm the model and output discriminated unions, exact arithmetic strategy, validation limits, and package module strategy.
- Record existing user changes and avoid editing unrelated files.

### Phase 2: Bootstrap and strict public contracts

- Create package metadata, strict tsconfig, lint/test/build config, scripts and lockfile.
- Export readonly input types and documented result/report/finding/issue types.
- Implement strict unknown-input validation and defensive normalization/copying.
- Generate or author matching draft-2020-12 JSON Schema. Document runtime constraints beyond the schema.
- Test invalid input comprehensively before arithmetic is attached.
- Ensure getters are not invoked by validation; test accessor and repeated-reference input.

### Phase 3: Exact arithmetic and core analysis

- Implement zero/constant/exponential/explicit nominal delays and jitter interval sums.
- Use BigInt end to end for aggregate values and counterfactuals.
- Compute per-invocation duration bottom-up and invocation/attempt counts top-down.
- Implement deadline and group attempt-budget classifications separately.
- Implement deterministic findings with exact rational threshold comparisons.
- Keep core modules browser-compatible and zero runtime dependency.
- Do not enumerate real execution traces or allocate by multiplied attempt count.

### Phase 4: Explainability and comparison

- Implement selected timing path with deterministic ties.
- Implement additive root-duration decomposition that excludes non-dominant parallel time.
- Implement per-retry-layer counterfactual recomputation, stable sorting, and non-additivity notes.
- Implement compareModels, ID-based node changes, exact signed deltas, invalid-result unions, and topology changes.
- Add the parallel branch-switch regression before optimizing attribution.

### Phase 5: CLI and package usability

- Implement all analyze/compare/help/version flags from requirements.
- Keep JSON stdout clean and library result envelopes consistent.
- Correctly separate invalid models from operational/JSON parse errors.
- Enforce file/stdin byte limits during reads; never fetch URL inputs.
- Implement documented exit codes including strict warning failure and AFTER-based comparison checks.
- Build ESM, CommonJS, declarations, CLI executable, and schema subpath.
- Validate exports by installing a real packed tarball in fresh consumer projects.

### Phase 6: Tests and independent validation

- Implement every golden fixture G01–G15 as actual JSON/input fixtures and acceptance assertions.
- Build a small independent test-only execution oracle using explicit loops/time scheduling, not production recurrences.
- Add seeded property-based tests for stated invariants.
- Test CLI through spawned built executable with stdout, stderr and exit-code assertions.
- Execute documentation examples against public built exports.
- Check input immutability, ordering, huge exact numbers, strict thresholds, deadline equality, branch switching and invalid input resource limits.
- Meet meaningful analyzer/validator coverage targets; do not weaken tests or exclusions to conceal missed behavior.

### Phase 7: Documentation, CI, and final audit

- Write README, API reference, semantics, limitations, recipes, contributing guide, changelog and MIT license as required.
- Make quickstarts copy/paste runnable. Include exact G03 example and output.
- Add CI for Node 22/24 covering checks, package installation and examples.
- Run required checks locally and fix failures. Verify `npm pack` includes only distributable files.
- Audit every requirement and explicitly report blockers. Do not leave core branches stubbed.

## Numerical checkpoints

These are reminders, not substitutes for all golden cases in requirements.md:

1. Single leaf A=4, 200ms attempts, constant 100ms backoff: 1100ms, four attempts.
2. Nested R/S/L each A=4, backoffs 100/50/25ms, leaf attempts 100ms: root 8500ms; R/S/L attempts 4/16/64; total operation attempts 84; leaf attempts 64.
3. In #2, deadline 8000ms gives 8500ms unchanged, exceeds status, slack −500ms.
4. In #2, disabling R retries gives 2050ms, 16 leaf attempts, 21 operation attempts. Disabling S gives 2200ms, 16 leaves, 24 operations. Disabling L gives 2500ms, 16 leaves, 36 operations.
5. A=5, attempt 10ms, exponential initial 100, factor 2, cap 250: nominal waits 100/200/250/250; total 850ms. Full jitter gives [50,850].
6. Equal jitter on delay 5 has [3,5], not [2,5] or floating-point 2.5.
7. Parallel a=300ms, b=250ms: removing retries from a to make it 100ms reduces root from 300 to 250, not 100.
8. Nine retry layers of A=100: leaf attempts "1000000000000000000" and operation attempts "1010101010101010100", never rounded through Number.

## Quality rules

- Prefer small cohesive functions and explicit unions over a generic policy framework.
- Separate schema validation, mathematical analysis, reporting and Node I/O.
- Keep numeric conversion helpers centralized and reject precision loss.
- Comments should explain subtle semantics, not repeat code.
- No runtime dependencies in core; dev tools are fine.
- No hidden defaults for model fields. Options defaults are explicitly documented.
- Do not assume SDK/provider backoff implementations match this model.
- Do not add probability, runtime retries, cancellation simulation, a UI, SDK adapters, or new infrastructure to v1.
- Never treat generated snapshots as an independent arithmetic oracle.
- Never substitute `Math.min(deadline, duration)` for deadline validation.
- Never implement BigInt reporting by a global monkey-patch of BigInt.prototype.toJSON.
- Do not claim a timeout cancels work or that passing static analysis proves runtime safety.

## Required verification commands

Provide runnable scripts with these names and execute them (or explain environmental blockers):

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run test:coverage
npm run build
npm run test:integration
npm run pack:check
npm run check
```

`pack:check` must create a real tarball, install it into temporary consumers, test ESM/CommonJS/types/schema/CLI, and bundle core for a browser without Node builtins. Do not merely inspect package.json and call that consumer verification. Clean up temporary artifacts after tests.

If tools are unavailable or networking prevents installing dependencies, implement what can be completed, state the blocker precisely, and provide commands to reproduce the remaining checks. Never report them as passed. Do not request credentials or invent alternate registry settings.

## Final response requirements

When implementation is complete, report:

1. What was implemented and where to start.
2. A minimal TypeScript and CLI usage example using actual exports.
3. Checks actually run and their results.
4. Any unresolved requirement or environment blocker.
5. That publication/remote creation was not performed, if relevant to next steps.

Do not end with an offer to implement unfinished required work. Complete it now, unless a concrete blocker makes that impossible. Do not imply a verified empty market or promise universal correctness beyond the specified model.

Begin by reading requirements.md and repository instructions, then implement end to end.

