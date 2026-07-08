import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, SegmentsDocument } from "./types.ts";

// Invokes an adapter through the shared CLI contract:
//   <run...> detect --input <video> --output <segments.json>
// The adapter is a self-contained subprocess; the harness only reads the
// segments file it produces.
export async function runAdapter(
  repoRoot: string,
  adapter: Adapter,
  videoAbs: string,
  params: string[],
): Promise<SegmentsDocument> {
  const outDir = join(repoRoot, "results", adapter.name);
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "segments.json");

  const command = [...adapter.run, "detect", "--input", videoAbs, "--output", outPath, ...params];
  const proc = Bun.spawn(command, {
    cwd: join(repoRoot, adapter.cwd),
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`exited with code ${code}`);
  }

  return JSON.parse(readFileSync(outPath, "utf-8")) as SegmentsDocument;
}
