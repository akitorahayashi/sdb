import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SegmentsDocument } from "./types.ts";

// Extracts one representative frame per segment (its midpoint) via ffmpeg, so
// a tool's cut decisions can be inspected visually, not just as timestamps.
export async function extractFrames(repoRoot: string, videoAbs: string, doc: SegmentsDocument): Promise<string[]> {
  const outDir = join(repoRoot, "results", doc.meta.tool, "frames");
  mkdirSync(outDir, { recursive: true });

  const paths: string[] = [];
  const width = String(doc.segments.length).length;
  for (const segment of doc.segments) {
    const midpointSeconds = (segment.startMs + segment.endMs) / 2 / 1000;
    const outPath = join(outDir, `seg-${String(segment.index).padStart(width, "0")}.jpg`);
    const proc = Bun.spawn(
      ["ffmpeg", "-y", "-loglevel", "error", "-i", videoAbs, "-ss", midpointSeconds.toFixed(3), "-frames:v", "1", "-q:v", "2", outPath],
      { stderr: "pipe" },
    );
    const code = await proc.exited;
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`ffmpeg failed for ${doc.meta.tool} segment ${segment.index}: ${stderr.trim()}`);
    }
    paths.push(outPath);
  }
  return paths;
}
