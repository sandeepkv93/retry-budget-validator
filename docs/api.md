# API Reference

The library exports strict TypeScript types and validation boundaries.

## Core Exports

```typescript
validateModel(input: unknown): ValidationResult;
analyze(input: unknown, options?: AnalysisOptions): AnalysisResult;
compareModels(before: unknown, after: unknown, options?: AnalysisOptions): ComparisonResult;
formatText(report: AnalysisReport): string;
```

### `validateModel(input: unknown)`
Takes an unknown JSON object and validates it against the `RetryBudgetModel` strict schema.
- Returns `{ valid: true, model: RetryBudgetModel }` if successful.
- Returns `{ valid: false, issues: ValidationIssue[] }` if failed. Issues include a `code`, RFC 6901 JSON `pointer`, and human-readable `message`.

### `analyze(input: unknown, options?: AnalysisOptions)`
Analyzes the model for exhaustion durations and amplifications.
- **`options.amplificationWarningThreshold`**: Default is 10. The threshold for issuing a `HIGH_LEAF_AMPLIFICATION` warning.

### `compareModels(before: unknown, after: unknown)`
Compares two models and generates an exact delta between them. Matches nodes by globally unique ID and reports added, removed, and changed nodes alongside workload and duration deltas.

## Schema Types

### Backoff Strategies
- `none`: No backoff between attempts.
- `constant`: Fixed wait time. `delayMs` is provided.
- `exponential`: Multiplies `initialDelayMs` by `multiplier` up to `capDelayMs`.
- `explicit`: Takes a precise array of `delaysMs`. Must exactly equal `maxAttempts - 1`.

### Jitter
- `none`: Use nominal delay `b`.
- `full`: Random value between `0` and `b`.
- `equal`: `ceil(b / 2)` plus random value up to `b`. 
*(Note: Bounds analysis utilizes `[0, b]` and `[ceil(b/2), b]` respectively)*.

## JSON Schema
The canonical Draft 2020-12 JSON Schema can be required via the subpath export:
```javascript
const schema = require('retry-budget-validator/schema.json');
```
