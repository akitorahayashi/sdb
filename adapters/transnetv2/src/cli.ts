// Adapter CLI: `detect --input <video> --output <segments.json>`.
// Wraps seeknetic-shot-detection (TransNetV2 ONNX) and writes the
// language-neutral segments contract (../../contract/segments.schema.json).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
// Detector source is vendored under vendor/shot-detection (see its NOTICE.md);
// Bun runs the TypeScript directly.
import { detectShots } from "../vendor/shot-detection/index.ts";

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const input = flag("input");
const output = flag("output");
if (!input || !output) {
  console.error("usage: detect --input <video> --output <segments.json> [--threshold n]");
  process.exit(1);
}
const threshold = Number(flag("threshold") ?? 0.5);
const inputPath = resolve(input);

const started = performance.now();
const shots = await detectShots({ videoPath: inputPath, threshold });
const elapsedMs = performance.now() - started;

const segments = shots.map((shot, index) => ({
  index,
  startMs: shot.startMs,
  endMs: shot.endMs,
}));
const durationMs = segments.length ? segments[segments.length - 1].endMs : 0;

const document = {
  meta: {
    tool: "transnetv2",
    params: { threshold },
    input: inputPath,
    inputSha256: sha256(inputPath),
    elapsedMs,
    durationMs,
  },
  segments,
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
