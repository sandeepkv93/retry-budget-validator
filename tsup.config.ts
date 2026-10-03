import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['cjs', 'esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: 'dist'
});
