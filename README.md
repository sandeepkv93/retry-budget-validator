# Retry Budget Validator

A production-quality, open-source TypeScript library and CLI that statically analyze a declared retry topology. 

Given attempt limits, execution duration bounds, backoff policies, and a request deadline, this library explains:
1. How many attempts each operation can receive for one incoming request.
2. How nested retries amplify downstream work.
3. The configured retry exhaustion duration envelope.
4. Whether that envelope exceeds a declared budget.
5. Which operations, backoffs, and retry layers contribute to the result.
6. How a proposed policy change affects demand and duration.

## How it works

### 1. Topology Modeling
Retry Budgets statically evaluate your retry and timing configurations across nested architectures:

```mermaid
flowchart TD
    client["client (Sequential Group)<br>maxAttempts: 4<br>backoff: 100ms"] --> service["service (Sequential Group)<br>maxAttempts: 4<br>backoff: 50ms"]
    service --> sdk["sdk-request (Leaf)<br>maxAttempts: 4<br>backoff: 25ms<br>execution: 100ms"]
    
    style client fill:#e1f5fe,stroke:#01579b,stroke-width:2px,color:#000
    style service fill:#e1f5fe,stroke:#01579b,stroke-width:2px,color:#000
    style sdk fill:#fff3e0,stroke:#e65100,stroke-width:2px,color:#000
```

*Nested retries lead to exponential request amplification. In the above example, a single failed client invocation can result in 64 total network requests (4 x 4 x 4).*

### 2. Timing Decomposition
The library performs deep static decomposition to pinpoint critical timing contributors for upper limits:

```mermaid
flowchart LR
    Total["Total Duration Bound<br>8500ms"] --> ClientB["Client Backoff<br>300ms"]
    Total --> ServiceB["Service Backoff<br>600ms"]
    Total --> SdkB["SDK Backoff<br>1200ms"]
    Total --> SdkExec["SDK Execution<br>6400ms"]
    
    style Total fill:#f1f8e9,stroke:#33691e,stroke-width:2px,color:#000
    style ClientB fill:#fafafa,stroke:#9e9e9e,stroke-width:1px,color:#000
    style ServiceB fill:#fafafa,stroke:#9e9e9e,stroke-width:1px,color:#000
    style SdkB fill:#fafafa,stroke:#9e9e9e,stroke-width:1px,color:#000
    style SdkExec fill:#ffebee,stroke:#b71c1c,stroke-width:1px,color:#000
```

## Installation

```bash
npm install retry-budget-validator
```

## Quickstart (CLI)

```bash
npx retry-budget analyze examples/nested-retries.json
```

## Quickstart (TypeScript)

```typescript
import { analyze, formatText } from "retry-budget-validator";

const model = {
  schemaVersion: 1,
  deadlineMs: 10000,
  root: {
    id: "r",
    kind: "leaf",
    attemptDurationMs: { min: 100, max: 100 },
    retry: { maxAttempts: 4, backoff: { kind: "constant", delayMs: 100, jitter: "none" } }
  }
};

const result = analyze(model);
if (result.kind === "invalid") {
  console.error(result.issues);
} else {
  console.log(formatText(result.report));
}
```

## Limits
- Trees up to 1000 nodes and depth 32
- Up to 100,000 total delays across all nodes
- Exact math via BigInt

## License
MIT
