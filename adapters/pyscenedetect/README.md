# pyscenedetect adapter

Wraps the PyPI `scenedetect` package (classic content-based cut detection) and
emits the shared segments contract.

## Requirements

- `uv`
- `ffmpeg` on PATH (PySceneDetect uses it for decoding)

## Run standalone

```bash
uv run src/cli.py detect \
  --input ../../fixtures/sample.mp4 \
  --output ../../results/pyscenedetect/segments.json \
  --threshold 27.0
```

The harness invokes the same CLI via `adapter.json`.
