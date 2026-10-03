# Semantics

- **Attempts and retries:** `maxAttempts = A` means A total attempts. Retries = A - 1.
- **Tree execution:** Sequential groups execute children in order on each parent attempt. Parallel groups execute concurrently.
- **Budgets:** Budgets never truncate the duration. They are for diagnostics.
- **Jitter:** Jitter bounds are strictly computed mathematically as requested.
