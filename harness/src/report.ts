import { relative } from "node:path";
import type { SegmentsDocument } from "./types.ts";

export interface Failure {
  tool: string;
  error: string;
}

export interface ToolResult {
  doc: SegmentsDocument;
  frames: string[];
}

function seconds(msValue: number): string {
  return (msValue / 1000).toFixed(3);
}

// Presents each tool's segments and their representative frames as a contact
// sheet. Judging whether a cut lands at the right moment is left to the reader;
// the report only lays the material out.
export function renderReport(
  repoRoot: string,
  input: string,
  results: ToolResult[],
  failures: Failure[],
): string {
  const lines: string[] = [];
  lines.push("# Detection results");
  lines.push("");
  lines.push(`Input: \`${input}\``);
  lines.push("");

  for (const { doc, frames } of results) {
    lines.push(`## ${doc.meta.tool} — ${doc.segments.length} segments (${Math.round(doc.meta.elapsedMs)} ms)`);
    lines.push("");
    lines.push("| # | start (s) | end (s) | length (s) | frame |");
    lines.push("| --- | --- | --- | --- | --- |");
    doc.segments.forEach((segment, position) => {
      const framePath = frames[position] ? relative(repoRoot, frames[position]) : "";
      const image = framePath ? `![seg-${segment.index}](${framePath})` : "";
      lines.push(
        `| ${segment.index} | ${seconds(segment.startMs)} | ${seconds(segment.endMs)} | ${seconds(segment.endMs - segment.startMs)} | ${image} |`,
      );
    });
    lines.push("");
  }

  if (failures.length) {
    lines.push("## Failures");
    lines.push("");
    for (const failure of failures) {
      lines.push(`- ${failure.tool}: ${failure.error}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
