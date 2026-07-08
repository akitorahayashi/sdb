"""Adapter CLI: `detect --input <video> --output <segments.json>`.

Wraps PySceneDetect's content detector and writes the language-neutral
segments contract (../../contract/segments.schema.json).
"""

import argparse
import hashlib
import importlib.metadata
import json
import os
import time

from scenedetect import ContentDetector, detect


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _version() -> str:
    try:
        return importlib.metadata.version("scenedetect")
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["detect"])
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--threshold", type=float, default=27.0)
    args = parser.parse_args()

    started = time.perf_counter()
    scenes = detect(args.input, ContentDetector(threshold=args.threshold))
    elapsed_ms = (time.perf_counter() - started) * 1000

    segments = [
        {
            "index": index,
            "startMs": start.seconds * 1000,
            "endMs": end.seconds * 1000,
        }
        for index, (start, end) in enumerate(scenes)
    ]
    duration_ms = segments[-1]["endMs"] if segments else 0.0

    document = {
        "meta": {
            "tool": "pyscenedetect",
            "version": _version(),
            "params": {"threshold": args.threshold},
            "input": args.input,
            "inputSha256": _sha256(args.input),
            "elapsedMs": elapsed_ms,
            "durationMs": duration_ms,
        },
        "segments": segments,
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2)


if __name__ == "__main__":
    main()
