#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyze, compareModels, formatText } from './index.js';

function printHelp() {
  console.log(`
Usage: retry-budget <command> [options]

Commands:
  analyze <file>         Analyze a retry budget model
  compare <before> <after> Compare two models

Options:
  --strict               Fail with exit code 1 on warnings
  --amplification-threshold <int>
  --json                 Output raw JSON report
  --help                 Show this help message
  --version              Show version

Exit codes:
  0: Valid analyzed report (warnings allowed unless --strict)
  1: Valid model with error findings (or warnings with --strict)
  2: Invalid model, options, bad JSON, or I/O error
  3: Unexpected internal failure
  `);
}

function printVersion() {
  console.log('1.0.0');
}

function parseJsonOrDie(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch (e) {
    console.error("Parse Error: Invalid JSON");
    process.exit(2);
  }
}

function readInput(filePath: string): string {
  if (filePath === '-') {
    try {
      const buffer = fs.readFileSync(0); // stdin
      if (buffer.length > 1024 * 1024) {
        console.error("Input Error: Exceeded 1MiB size limit");
        process.exit(2);
      }
      return buffer.toString('utf8');
    } catch (e) {
      console.error("Input Error: Failed to read from stdin");
      process.exit(2);
    }
  } else {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 1024 * 1024) {
        console.error("Input Error: Exceeded 1MiB size limit");
        process.exit(2);
      }
      return fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      console.error(`Input Error: Failed to read file ${filePath}`);
      process.exit(2);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    printHelp();
    process.exit(0);
  }
  if (args.includes('--version')) {
    printVersion();
    process.exit(0);
  }

  let command = '';
  const positional: string[] = [];
  let isJson = false;
  let strict = false;
  let threshold: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === undefined) continue;
    if (arg === '--json') isJson = true;
    else if (arg === '--strict') strict = true;
    else if (arg === '--amplification-threshold') {
      threshold = parseInt(args[++i]!, 10);
      if (isNaN(threshold)) {
        console.error("Option Error: Invalid threshold");
        process.exit(2);
      }
    } else if (arg.startsWith('-')) {
      if (arg === '-' && positional.length < 2) {
        positional.push(arg); // stdin
      } else {
        console.error(`Option Error: Unknown option ${arg}`);
        process.exit(2);
      }
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  try {
    if (command === 'analyze') {
      if (positional.length !== 1) {
        console.error("Usage Error: analyze requires exactly one input file (or - for stdin)");
        process.exit(2);
      }
      const raw = readInput(positional[0]!);
      const input = parseJsonOrDie(raw);
      const analyzeOptions: any = {};
      if (threshold !== undefined) analyzeOptions.amplificationWarningThreshold = threshold;
      const res = analyze(input, analyzeOptions);
      
      if (res.kind === 'invalid') {
        if (isJson) console.log(JSON.stringify(res, null, 2));
        else {
          console.error("Validation Issues:");
          res.issues.forEach(iss => console.error(`- [${iss.pointer}] ${iss.code}: ${iss.message}`));
        }
        process.exit(2);
      }
      
      if (isJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatText(res.report));
      }
      
      const hasErrors = res.report.findings.some(f => f.severity === 'error');
      const hasWarnings = res.report.findings.some(f => f.severity === 'warning');
      
      if (hasErrors || (strict && hasWarnings)) {
        process.exit(1);
      }
      process.exit(0);

    } else if (command === 'compare') {
      if (positional.length !== 2) {
        console.error("Usage Error: compare requires exactly two input files");
        process.exit(2);
      }
      if (positional[0] === '-' && positional[1] === '-') {
        console.error("Usage Error: Only one input can be stdin");
        process.exit(2);
      }
      const beforeRaw = readInput(positional[0]!);
      const afterRaw = readInput(positional[1]!);
      
      const beforeInput = parseJsonOrDie(beforeRaw);
      const afterInput = parseJsonOrDie(afterRaw);
      
      const compareOptions: any = {};
      if (threshold !== undefined) compareOptions.amplificationWarningThreshold = threshold;
      const res = compareModels(beforeInput, afterInput, compareOptions);
      
      if (res.kind === 'invalid') {
        if (isJson) console.log(JSON.stringify(res, null, 2));
        else console.error("Comparison Validation failed");
        process.exit(2);
      }
      
      if (isJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`Comparison Results:\nDuration Max Delta: ${res.delta.durationMsMax}ms`);
        console.log(`Operation Attempts Delta: ${res.delta.totalOperationAttempts}`);
        console.log(`Slack Delta: ${res.delta.deadlineSlackMs}ms\n`);
        console.log(`Changed Nodes: ${res.nodeChanges.changed.join(', ')}`);
        console.log(`Added Nodes: ${res.nodeChanges.added.join(', ')}`);
        console.log(`Removed Nodes: ${res.nodeChanges.removed.join(', ')}`);
      }
      
      const hasErrors = res.after.findings.some((f: any) => f.severity === 'error');
      const hasWarnings = res.after.findings.some((f: any) => f.severity === 'warning');
      
      if (hasErrors || (strict && hasWarnings)) {
        process.exit(1);
      }
      process.exit(0);
      
    } else {
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(2);
    }
  } catch (e) {
    console.error(`Unexpected Internal Error`);
    process.exit(3);
  }
}

main();
