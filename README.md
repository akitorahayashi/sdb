# sdb

A harness for evaluating video shot/scene detectors — the tools that split a
video into time ranges so a vision-language model can read it segment by segment.

Every detector is wrapped as an isolated adapter that emits one shared output
contract. The harness runs each adapter on the same input and lays out their
segments and representative frames side by side; judging whether the cuts land
at the right moments is left to the reader. Adding the next tool is one
directory, not a rewrite.

## Layout

```
contract/segments.schema.json   Language-neutral output every adapter emits
fixtures/                        Shared input media
adapters/
  pyscenedetect/                 uv project: PySceneDetect (classic content detection)
  transnetv2/                    bun project: seeknetic-shot-detection (TransNetV2 ONNX)
harness/                         bun project: run adapters, extract frames, report
results/                         Run artifacts (gitignored)
```

## Design

- The boundary between the harness and any tool is a CLI plus a JSON schema:
  `<adapter> detect --input <video> --output <segments.json>`. Language is a
  private detail of each adapter.
- Each adapter is a self-contained project with its own package manager and
  lockfile (uv for Python, bun for TypeScript). Tools stay isolated and
  reproducible; they share no code.
- Adapters are discovered from `adapters/*/adapter.json`, never hardcoded.

## Add a detector

1. Create `adapters/<name>/` as a standalone uv or bun project depending on the
   tool's language.
2. Expose the CLI contract and emit `contract/segments.schema.json`.
3. Add `adapters/<name>/adapter.json` with `{ "name", "run", "cwd" }`.

The harness picks it up automatically.

## Run

Prerequisites: `uv`, `bun`, and `ffmpeg`/`ffprobe` on PATH.

```bash
# one-time install per adapter/harness
(cd adapters/transnetv2 && bun install)
(cd harness && bun install)

# run every adapter on the sample and write results/report.md
cd harness && bun src/cli.ts --input ../fixtures/sample.mp4
```
