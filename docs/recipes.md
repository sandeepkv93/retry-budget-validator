# Recipes

- One retry layer: Define a single leaf node.
- Nested retries: Use sequential or parallel groups with their own maxAttempts.
- Deadline check in CI: run `retry-budget analyze model.json --strict`
- Policy comparison: run `retry-budget compare before.json after.json`
