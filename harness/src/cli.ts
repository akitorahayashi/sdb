// Orchestrator: run every discovered adapter on one input under the shared
// contract, extract a representative frame per segment, and lay the results out
// for a human to judge.
//
//   bun src/cli.ts [--input <video>]

import { writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { runAdapter } from "./detect.ts";
import { extractFrames } from "./frames.ts";
import { discoverAdapters } from "./registry.ts";
import { renderReport, type Failure, type ToolResult } from "./report.ts";

// harness/src -> harness -> repo root
const repoRoot = dirname(dirname(import.meta.dir));

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

// A supplied --input resolves against the caller's cwd (normal CLI behaviour);
// the default points at the bundled fixture under the repo.
const inputArg = option("input", "");
const videoAbs = inputArg
  ? (isAbsolute(inputArg) ? inputArg : resolve(process.cwd(), inputArg))
  : join(repoRoot, "fixtures", "sample.mp4");

const adapters = discoverAdapters(repoRoot);
if (adapters.length === 0) {
  console.error("No adapters found under adapters/*/adapter.json");
  process.exit(1);
}

const results: ToolResult[] = [];
const failures: Failure[] = [];

for (const adapter of adapters) {
  console.log(`\n=== ${adapter.name} ===`);
  try {
    const doc = await runAdapter(repoRoot, adapter, videoAbs, []);
    const frames = await extractFrames(repoRoot, videoAbs, doc);
    console.log(`[${adapter.name}] ${doc.segments.length} segments, ${frames.length} frame(s)`);
    results.push({ doc, frames });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ tool: adapter.name, error: message });
    console.error(`[${adapter.name}] ${message}`);
  }
}

const report = renderReport(repoRoot, videoAbs, results, failures);
const reportPath = join(repoRoot, "results", "report.md");
writeFileSync(reportPath, report);

console.log(`\nReport written to ${reportPath}`);

if (failures.length > 0) {
  process.exit(1);
}
