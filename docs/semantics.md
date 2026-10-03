# Analytical Semantics & Math Engine

This library uses strict mathematical semantics to compute the envelope of a retry budget without requiring a simulation or floating-point approximations. Everything relies on ES2020 `BigInt` exact math.

## Tree Execution Constraints
Nodes in the topology fall into three classes:
- **Leaf nodes**: Represent final workloads (network calls, DB queries). They execute and have an attempt duration.
- **Sequential groups**: Run children in order on each attempt.
- **Parallel groups**: Run children simultaneously on each attempt (wait for all).

## Bounds Arithmetic
For any node:
- Let $A$ be `maxAttempts`.
- Let $U_{min}, U_{max}$ be the execution duration bounds of one attempt.
- Let $B_{min}, B_{max}$ be the cumulative sum of backoffs across the $A-1$ retries.

The exact exhaustion duration of the node is:
$$T_{max} = A \times U_{max} + B_{max}$$
$$T_{min} = A \times U_{min} + B_{min}$$

For Sequential groups:
$U = \sum T_{child} + Overhead$

For Parallel groups:
$U_{max} = \max(T_{child.max}) + Overhead_{max}$
$U_{min} = \max(T_{child.min}) + Overhead_{min}$

## Jitter Bounds
When backoff jitter is applied, the bounds are scaled using exact rational bounds computation (preventing floating point decay).
- **none**: `[b, b]`
- **full**: `[0, b]`
- **equal**: `[ceil(b/2), b]`

## Counterfactual Attribution
The analyzer performs deep counterfactual analysis. For each node, it dynamically recalculates the global `deadlineSlackMs` and `totalOperationAttempts` assuming that node's `maxAttempts` is forced to `1`. 

Because parallel node boundaries are non-linear, a node's removal might not shift the global timeline if another parallel sibling masks its duration. This engine recalculates the complete spanning tree bounds accurately.
