# Limitations & Non-goals

This library statically analyzes structural topologies and limits. 

It explicitly **DOES NOT**:
- **Simulate probabilistic outcomes:** It always assumes 100% failure rate leading to worst-case exhaustion.
- **Execute HTTP calls:** It is purely a static topological analyzer.
- **Use floating point values:** To guarantee deterministic output regardless of CPU arch or interpreter, BigInt boundaries and math are strictly enforced. (e.g. half-backoff jitter `ceil(b/2)`).
- **Truncate durations by budgets:** A `deadlineMs` or `attemptBudgetMs` will not mathematically crop $T_{max}$ bounds calculation. It simply issues an `ERROR` finding if the computed bound exceeds the stated budget.
