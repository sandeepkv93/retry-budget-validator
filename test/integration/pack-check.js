const fs = require('fs');
const cp = require('child_process');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'retry-pack-'));
console.log('Testing pack in', tmpDir);

cp.execSync('npm pack', { stdio: 'inherit' });
const tarball = fs.readdirSync('.').find(f => f.endsWith('.tgz'));
if (!tarball) {
  console.error('No tarball found');
  process.exit(1);
}

fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
  name: "test-consumer",
  version: "1.0.0",
  type: "module",
  dependencies: {
    "retry-budget-validator": `file:${path.resolve(tarball)}`
  }
}));

cp.execSync('npm install', { cwd: tmpDir, stdio: 'inherit' });

// Test ESM
fs.writeFileSync(path.join(tmpDir, 'test-esm.mjs'), `
import { analyze } from 'retry-budget-validator';
const res = analyze({ schemaVersion: 1, deadlineMs: 100, root: { id: "a", kind: "leaf", attemptDurationMs: {min:10, max:10}, retry: {maxAttempts: 1, backoff: {kind:"none"}} }});
if (res.kind !== 'analyzed') process.exit(1);
`);
cp.execSync('node test-esm.mjs', { cwd: tmpDir, stdio: 'inherit' });

// Test CJS
fs.writeFileSync(path.join(tmpDir, 'test-cjs.cjs'), `
const { analyze } = require('retry-budget-validator');
const res = analyze({ schemaVersion: 1, deadlineMs: 100, root: { id: "a", kind: "leaf", attemptDurationMs: {min:10, max:10}, retry: {maxAttempts: 1, backoff: {kind:"none"}} }});
if (res.kind !== 'analyzed') process.exit(1);
`);
cp.execSync('node test-cjs.cjs', { cwd: tmpDir, stdio: 'inherit' });

// Test schema subpath
fs.writeFileSync(path.join(tmpDir, 'test-schema.cjs'), `
const schema = require('retry-budget-validator/schema.json');
if (schema.title !== 'Retry Budget Validator Model') process.exit(1);
`);
cp.execSync('node test-schema.cjs', { cwd: tmpDir, stdio: 'inherit' });

// Test CLI
cp.execSync('npx retry-budget --version', { cwd: tmpDir, stdio: 'inherit' });

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('Pack check passed!');
