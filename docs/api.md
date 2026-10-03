# API Reference

Exported from `retry-budget-validator`:

```typescript
validateModel(input: unknown): ValidationResult;
analyze(input: unknown, options?: AnalysisOptions): AnalysisResult;
compareModels(before: unknown, after: unknown, options?: AnalysisOptions): ComparisonResult;
formatText(report: AnalysisReport): string;
```

See the TypeScript types in `src/types.ts` for a full schema of options and returned reports.
