# transnetv2 adapter

Wraps the TransNetV2 ONNX shot detector and emits the shared segments contract.

The detector source is vendored under `vendor/shot-detection/` (upstream is not
published to npm; see that directory's `NOTICE.md`). Its only runtime dependency,
`onnxruntime-node`, is declared here.

## Requirements

- `bun`
- `ffmpeg` and `ffprobe` on PATH
- Network on first run: the detector downloads its ONNX model into a user cache.

## Run standalone

```bash
bun install
bun src/cli.ts detect \
  --input ../../fixtures/sample.mp4 \
  --output ../../results/transnetv2/segments.json \
  --threshold 0.5
```
